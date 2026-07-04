
'use server';
/**
 * @fileOverview An AI flow for generating plausible safety details for a given route.
 *
 * - getRouteSafetyDetails - A function that returns safety insights for a route.
 */
import {ai} from '@/ai/genkit';
import { RouteSafetyInputSchema, RouteSafetyOutputSchema, type RouteSafetyInput, type RouteSafetyOutput } from '@/ai/types';

const routeSafetyPrompt = ai.definePrompt({
  name: 'routeSafetyPrompt',
  input: { schema: RouteSafetyInputSchema },
  output: { schema: RouteSafetyOutputSchema },
  model: 'googleai/gemini-2.5-flash',
  prompt: `You are a route safety analyst for Femigo, a women's safety app in India. You're given basic route information and must produce a realistic safety assessment.

  Route summary: {{summary}}
  Distance: {{distance}}
  Duration: {{duration}}

  Since you don't have live traffic/crime feeds, use your general knowledge of typical Indian urban/suburban road conditions to produce a REALISTIC, PLAUSIBLE assessment — not overly optimistic, not alarmist. Vary your assessment sensibly based on the route summary and distance (e.g. a route through a named market or narrow lane may warrant more caution than a route along a main highway).

  Be clear and honest in your written fields that this is a general estimate, not verified real-time data — e.g. "Typically a well-traveled route, though always stay alert" rather than an authoritative claim.

  Return your structured assessment now.
  `,
});

const routeSafetyFlow = ai.defineFlow(
    {
      name: 'routeSafetyFlow',
      inputSchema: RouteSafetyInputSchema,
      outputSchema: RouteSafetyOutputSchema,
    },
    async (input) => {
      try {
        const { output } = await routeSafetyPrompt(input);
        if (!output) {
          throw new Error("The AI model did not return a valid response.");
        }
        return output;
      } catch (e) {
        console.error("Route safety flow failed, falling back to a generic assessment", e);
        // Fallback so the UI never breaks even if the AI call fails — clearly generic, not fake-specific.
        return {
          roadQuality: 'Moderate',
          incidents: 'No data available',
          reviewsCount: 0,
          lighting: 'Partially-lit',
          crowdedness: 'Medium',
          safetySummary: 'Could not generate a safety assessment for this route right now.',
          crimeSummary: 'No data available.',
          policeInfo: 'No data available.',
          weatherInfo: 'No data available.',
        };
      }
    }
);

export async function getRouteSafetyDetails(input: RouteSafetyInput): Promise<RouteSafetyOutput> {
    return routeSafetyFlow(input);
}
