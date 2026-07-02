'use server';
/**
 * @fileOverview An AI flow for verifying an Aadhaar card.
 *
 * - verifyAadhaar - A function that handles the Aadhaar card verification process.
 */

import {ai} from '@/ai/genkit';
import { z } from 'zod';
import { AadhaarVerificationInputSchema, AadhaarVerificationOutputSchema, type AadhaarVerificationInput, type AadhaarVerificationOutput } from '@/ai/types';

// ---- Verhoeff checksum algorithm (used by UIDAI for Aadhaar numbers) ----
const d = [
  [0,1,2,3,4,5,6,7,8,9],
  [1,2,3,4,0,6,7,8,9,5],
  [2,3,4,0,1,7,8,9,5,6],
  [3,4,0,1,2,8,9,5,6,7],
  [4,0,1,2,3,9,5,6,7,8],
  [5,9,8,7,6,0,4,3,2,1],
  [6,5,9,8,7,1,0,4,3,2],
  [7,6,5,9,8,2,1,0,4,3],
  [8,7,6,5,9,3,2,1,0,4],
  [9,8,7,6,5,4,3,2,1,0],
];
const p = [
  [0,1,2,3,4,5,6,7,8,9],
  [1,5,7,6,2,8,3,0,9,4],
  [5,8,0,3,7,9,6,1,4,2],
  [8,9,1,6,0,4,3,5,2,7],
  [9,4,5,3,1,2,6,8,7,0],
  [4,2,8,6,5,7,3,9,0,1],
  [2,7,9,3,8,0,6,4,1,5],
  [7,0,4,6,9,1,3,2,5,8],
];

function isValidVerhoeff(numStr: string): boolean {
  let c = 0;
  const reversed = numStr.split('').reverse().map(Number);
  for (let i = 0; i < reversed.length; i++) {
    c = d[c][p[i % 8][reversed[i]]];
  }
  return c === 0;
}

// Define a new, simpler schema for what the AI should extract.
const ExtractedAadhaarDataSchema = z.object({
    name: z.string().optional().describe("The full name extracted from the card."),
    gender: z.string().optional().describe("The gender extracted from the card (e.g., 'Male', 'Female')."),
    aadhaarNumber: z.string().optional().describe("The 12-digit Aadhaar number extracted from the card."),
});

const FaceMatchSchema = z.object({
    isSamePerson: z.boolean().describe("Whether the face on the Aadhaar card photo appears to be the same person as the reference selfie."),
    confidence: z.enum(['high', 'medium', 'low']).describe("Confidence level of the match."),
    reason: z.string().describe("Brief explanation of the comparison result."),
});

// This is the prompt that ONLY asks the AI to extract data.
const dataExtractionPrompt = ai.definePrompt({
    name: 'aadhaarDataExtractionPrompt',
    model: 'googleai/gemini-2.5-flash',
    input: { schema: z.object({ aadhaarPhotoDataUri: z.string() }) },
    output: { schema: ExtractedAadhaarDataSchema },
    prompt: `You are an expert data extraction agent.
    Your task is to analyze an image of an Aadhaar card and extract the following details:
    - The full name of the person.
    - The gender of the person.
    - The 12-digit Aadhaar number.

    If any detail is unclear or unreadable, do not return a value for that field.

    Photo: {{media url=aadhaarPhotoDataUri}}
    `,
});

// This prompt compares the Aadhaar card's photo against the earlier live selfie.
const faceMatchPrompt = ai.definePrompt({
    name: 'aadhaarFaceMatchPrompt',
    model: 'googleai/gemini-2.5-flash',
    input: { schema: z.object({ aadhaarPhotoDataUri: z.string(), referencePhotoDataUri: z.string() }) },
    output: { schema: FaceMatchSchema },
    prompt: `You are comparing two photos to check if they show the same person.

    Image 1 is a photo taken from an Aadhaar identity card.
    Image 2 is a live selfie taken by the same user during app onboarding.

    Compare facial features (face shape, eyes, nose, mouth, overall structure) while accounting for
    differences in photo quality, lighting, angle, and age of the ID photo.

    Set 'isSamePerson' to true only if you are reasonably confident it's the same person.
    If the Aadhaar photo has no visible face, or is too low quality to compare, set 'isSamePerson' to false
    and explain that in 'reason'.

    Aadhaar card photo: {{media url=aadhaarPhotoDataUri}}
    Reference selfie: {{media url=referencePhotoDataUri}}
    `,
});

// This is the main flow that now contains the verification LOGIC.
const aadhaarVerificationFlow = ai.defineFlow(
    {
      name: 'aadhaarVerificationFlow',
      inputSchema: AadhaarVerificationInputSchema,
      outputSchema: AadhaarVerificationOutputSchema,
    },
    async (input): Promise<AadhaarVerificationOutput> => {
        try {
            // Step 1: Call the AI to extract data.
            const { output: extractedData } = await dataExtractionPrompt({ aadhaarPhotoDataUri: input.aadhaarPhotoDataUri });

            if (!extractedData) {
                return {
                    verificationPassed: false,
                    reason: "Could not read any details from the card. Please provide a clearer image.",
                };
            }

            const extractedName = extractedData.name;
            const extractedGender = extractedData.gender;
            const extractedAadhaarNumber = extractedData.aadhaarNumber?.replace(/\s+/g, ''); // Remove spaces from Aadhaar number

            // Step 2: Perform verification logic in TypeScript.
            if (!extractedName) {
                return { verificationPassed: false, reason: "Could not read the name from the card." };
            }
            if (extractedName.toLowerCase() !== input.userName.toLowerCase()) {
                return {
                    verificationPassed: false,
                    reason: `Name does not match. Expected "${input.userName}", but card says "${extractedName}".`,
                    extractedName,
                };
            }
            if (!extractedGender) {
                return { verificationPassed: false, reason: "Could not read the gender from the card.", extractedName };
            }
            if (extractedGender.toLowerCase() !== 'female') {
                return {
                    verificationPassed: false,
                    reason: `Verification is for female users only. Gender on card is '${extractedGender}'.`,
                    extractedName,
                    extractedGender,
                };
            }
            if (!extractedAadhaarNumber || !/^\d{12}$/.test(extractedAadhaarNumber)) {
                 return {
                    verificationPassed: false,
                    reason: `The Aadhaar number is invalid or unreadable. Expected 12 digits.`,
                    extractedName,
                    extractedGender,
                    extractedAadhaarNumber: extractedData.aadhaarNumber,
                };
            }
            // Step 2b: Validate the Aadhaar number's checksum digit (Verhoeff algorithm).
            // This confirms the number is well-formed like a real Aadhaar number;
            // it does NOT confirm the number is actually registered with UIDAI.
            if (!isValidVerhoeff(extractedAadhaarNumber)) {
                return {
                    verificationPassed: false,
                    reason: `The Aadhaar number failed validation and does not appear to be genuine. Please check the card and try again.`,
                    extractedName,
                    extractedGender,
                    extractedAadhaarNumber,
                };
            }

            // Step 3: Compare the Aadhaar photo against the earlier live selfie, if provided.
            if (input.referencePhotoDataUri) {
                const { output: faceMatch } = await faceMatchPrompt({
                    aadhaarPhotoDataUri: input.aadhaarPhotoDataUri,
                    referencePhotoDataUri: input.referencePhotoDataUri,
                });

                if (!faceMatch || !faceMatch.isSamePerson) {
                    return {
                        verificationPassed: false,
                        reason: faceMatch
                            ? `The photo on the Aadhaar card doesn't appear to match your verification selfie. ${faceMatch.reason}`
                            : "Could not compare the Aadhaar photo with your selfie. Please try again.",
                        extractedName,
                        extractedGender,
                        extractedAadhaarNumber,
                    };
                }
            }

            // Step 4: If all checks pass, return success.
            return {
                verificationPassed: true,
                reason: "Aadhaar verification successful.",
                extractedName,
                extractedGender,
                extractedAadhaarNumber,
            };

        } catch(e) {
            console.error("Aadhaar verification flow failed", e);
            // This catches network errors or other exceptions during the AI call.
            return {
                verificationPassed: false,
                reason: "Could not process the document at this time. Please try again."
            }
        }
    }
);

export async function verifyAadhaar(input: AadhaarVerificationInput): Promise<AadhaarVerificationOutput> {
    return aadhaarVerificationFlow(input);
}
