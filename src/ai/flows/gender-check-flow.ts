'use server';
/**
 * @fileOverview An AI flow for checking the gender from a user's photo.
 *
 * - genderCheck - A function that handles the gender check process.
 */
import {ai} from '@/ai/genkit';
import { GenderCheckInputSchema, GenderCheckOutputSchema, type GenderCheckInput, type GenderCheckOutput } from '@/ai/types';

const genderCheckPrompt = ai.definePrompt({
    name: 'genderCheckPrompt',
    input: { schema: GenderCheckInputSchema },
    output: { schema: GenderCheckOutputSchema },
    model: 'googleai/gemini-2.5-flash',
    prompt: `You are an AI security agent for Femigo, a women's safety app. Your primary task is to verify a user's live photo during onboarding.

    You must perform the following checks in order, and stop at the first failure:

    1.  **Authenticity Check:** Does this look like a real, unedited live photo taken by a phone/webcam camera of an actual person in front of it? Reject it if it looks like: a screenshot, a photo of a photo/screen (look for glare, screen bezels, moiré patterns), an AI-generated or synthetic face (look for unnatural skin texture, asymmetric or malformed features, inconsistent lighting/shadows, artifacts around hair or ears), a stock photo, a cartoon/drawing, or a photo of a printout.
    2.  **Face Detection:** Is there a single, clear human face in the photo, and is it the main subject?
    3.  **Photo Quality:** Is the image clear, well-lit, and not blurry?
    4.  **Glasses Check:** Is the person wearing glasses (prescription or sunglasses) that cover or obscure their eyes?
    5.  **Gender Identification:** Does the person present as female?

    **Rules:**
    - If the photo appears to be AI-generated, a screenshot, a photo of a screen/printout, or otherwise not a genuine live camera capture, fail. Set 'isFemale' to false and 'reason' to "This doesn't look like a live photo. Please take a real-time photo using your camera."
    - If no clear face is detected, fail. Set 'isFemale' to false and 'reason' to "No clear face was detected. Please take another photo."
    - If the photo is blurry, dark, or of poor quality, fail. Set 'isFemale' to false and 'reason' to "The photo is too blurry or dark. Please ensure good lighting."
    - If the person is wearing glasses, fail. Set 'isFemale' to false and 'reason' to "Please remove your glasses and take the photo again."
    - If the person detected does not present as female, fail. Set 'isFemale' to false and 'reason' to "Verification is for female users only."
    - If all checks pass, set 'isFemale' to true and 'reason' to "Verification successful."

    Analyze the provided user photo and return your structured response.
    Photo: {{media url=photoDataUri}}
    `,
});

const genderCheckFlow = ai.defineFlow(
  {
    name: 'genderCheckFlow',
    inputSchema: GenderCheckInputSchema,
    outputSchema: GenderCheckOutputSchema,
  },
  async (input) => {
    try {
        const { output } = await genderCheckPrompt(input);
        if (!output) {
            throw new Error("The AI model did not return a valid response.");
        }
        return output;
    } catch(e) {
        console.error("Gender check flow failed", e);
        // Fallback to a user-friendly error message if the AI call fails for network/other reasons
        return {
            isFemale: false,
            reason: "Could not process the image at this time. Please try again in a moment."
        }
    }
  }
);

export async function genderCheck(input: GenderCheckInput): Promise<GenderCheckOutput> {
    return genderCheckFlow(input);
}
