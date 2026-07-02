import { z } from 'zod';

// For aadhaar-verification-flow.ts
export const AadhaarVerificationInputSchema = z.object({
  aadhaarPhotoDataUri: z
    .string()
    .describe(
      "A photo of an Aadhaar card, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
  userName: z.string().describe("The user's full name, as provided during signup."),
  referencePhotoDataUri: z
    .string()
    .optional()
    .describe(
      "The user's live selfie taken during gender verification, used to compare against the Aadhaar card photo."
    ),
});
export type AadhaarVerificationInput = z.infer<typeof AadhaarVerificationInputSchema>;

export const AadhaarVerificationOutputSchema = z.object({
    verificationPassed: z.boolean().describe("Whether the overall verification passed."),
    reason: z.string().describe("A summary of the verification outcome. If failed, this explains why."),
    extractedName: z.string().optional().describe("The name extracted from the Aadhaar card."),
    extractedGender: z.string().optional().describe("The gender extracted from the Aadhaar card."),
    extractedAadhaarNumber: z.string().optional().describe("The 12-digit Aadhaar number extracted from the card."),
});
export type AadhaarVerificationOutput = z.infer<typeof AadhaarVerificationOutputSchema>;


// For gender-check-flow.ts
export const GenderCheckInputSchema = z.object({
  photoDataUri: z
    .string()
    .describe(
      "A live photo of the user, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
});
export type GenderCheckInput = z.infer<typeof GenderCheckInputSchema>;

export const GenderCheckOutputSchema = z.object({
  isFemale: z.boolean().describe('Whether the person in the photo is identified as female.'),
  reason: z.string().describe('A brief explanation of the outcome.'),
});
export type GenderCheckOutput = z.infer<typeof GenderCheckOutputSchema>;


// For route-safety-flow.ts and recommend-safest-route-flow.ts
export const RouteSafetyOutputSchema = z.object({
  roadQuality: z.enum(['Good', 'Moderate', 'Poor']).describe("The overall quality of the road surface."),
  incidents: z.string().describe("A plausible number of recent minor incidents or accidents reported, e.g., '0-2 incidents' or '3 minor delays'."),
  reviewsCount: z.number().describe("A realistic number of user reviews for this route."),
  lighting: z.enum(['Well-lit', 'Partially-lit', 'Poorly-lit']).describe("The general lighting condition of the route, especially for night travel."),
  crowdedness: z.enum(['Low', 'Medium', 'High']).describe("The typical traffic level or crowdedness of the route."),
  safetySummary: z.string().describe("A brief, one-sentence summary of the route's safety profile."),
  crimeSummary: z.string().describe("A brief, one-sentence summary of the area's crime reports."),
  policeInfo: z.string().describe("A brief, one-sentence summary of local police presence or station info."),
  weatherInfo: z.string().describe("A brief, one-sentence summary of the current weather and visibility."),
});
export type RouteSafetyOutput = z.infer<typeof RouteSafetyOutputSchema>;

export const RouteSafetyInputSchema = z.object({
  summary: z.string().describe("The summary of the route, e.g., 'US-101 S'"),
  distance: z.string().describe("The total distance of the route, e.g., '15.3 km'"),
  duration: z.string().describe("The estimated travel time for the route, e.g., '25 mins'"),
});
export type RouteSafetyInput = z.infer<typeof RouteSafetyInputSchema>;


// For recommend-safest-route-flow.ts
export const RecommendSafestRouteInputSchema = z.array(RouteSafetyOutputSchema);
export type RecommendSafestRouteInput = z.infer<typeof RecommendSafestRouteInputSchema>;

export const RecommendSafestRouteOutputSchema = z.object({
    recommendedRouteIndex: z.number().describe("The 0-based array index of the recommended safest route."),
    reason: z.string().describe("A brief explanation for why this route was recommended, highlighting its key safety advantages."),
});
export type RecommendSafestRouteOutput = z.infer<typeof RecommendSafestRouteOutputSchema>;


// For sangini-chat-flow.ts
export const MessageSchema = z.object({
  role: z.enum(['user', 'model']),
  content: z.string(),
});
export type Message = z.infer<typeof MessageSchema>;

export const SanginiChatInputSchema = z.object({
  history: z.array(MessageSchema),
  prompt: z.string().describe('The latest message from the user.'),
});
export type SanginiChatInput = z.infer<typeof SanginiChatInputSchema>;
