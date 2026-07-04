'use server';
/**
 * @fileOverview An AI flow for recommending the safest route from a list of options.
 *
 * - recommendSafestRoute - A function that returns the index of the safest route.
 */
import {ai} from '@/ai/genkit';
import {z} from 'genkit';
import { RecommendSafestRouteInputSchema, RecommendSafestRouteOutputSchema, type RecommendSafestRouteInput, type RecommendSafestRouteOutput } from '@/ai/types';

const recommendationPrompt = ai.definePrompt({
    name: 'recommendationPrompt',
    model: 'googleai/gemini-2.5-flash',
    inputSchema: z.object({ routes: RecommendSafestRouteInputSchema }),
    outputSchema: RecommendSafestRouteOutputSchema,
    prompt: `You are a safety advisor for Femigo, a women's safety app.
    Your task is to analyze a list of potential routes and recommend the safest one.
    The routes are provided as a JSON array below.
    Consider the following criteria, in order of importance:
    1.  **Lighting:** 'Well-lit' is strongly preferred over 'Partially-lit' or 'Poorly-lit'.
    2.  **Incidents:** Fewer reported incidents are better. A route with '0-2 incidents' is safer than one with '3 minor delays'.
    3.  **Road Quality:** 'Good' is better than 'Moderate' or 'Poor'.
    4.  **Crowdedness:** 'Medium' or 'High' crowdedness can be safer than 'Low', especially for night travel.
    5.  **User Reviews:** A higher number of reviews can indicate a more popular and potentially vetted route.
    6.  **Duration:** All else being equal, a shorter duration is preferred, but safety is the absolute primary concern. Do not pick a route just because it is faster if it is less safe.
    Analyze the routes provided below and return the 0-based index of the route you recommend as the safest option. Provide a concise, user-friendly reason for your choice, mentioning 1-2 key positive factors.
    Routes:
    {{{json routes}}}
    `
});

const recommendSafestRouteFlow = ai.defineFlow(
    {
      name: 'recommendSafestRouteFlow',
      inputSchema: RecommendSafestRouteInputSchema,
      outputSchema: RecommendSafestRouteOutputSchema,
    },
    async (routes) => {
      try {
        const { output } = await recommendationPrompt({ routes });
        if (!output || output.recommendedRouteIndex === undefined || output.recommendedRouteIndex >= routes.length) {
          return { recommendedRouteIndex: 0, reason: "This is the primary suggested route." };
        }
        return output;
      } catch (e) {
        console.error("Recommend safest route flow failed, falling back to first route", e);
        return { recommendedRouteIndex: 0, reason: "This is the primary suggested route." };
      }
    }
);

export async function recommendSafestRoute(input: RecommendSafestRouteInput): Promise<RecommendSafestRouteOutput> {
    return recommendSafestRouteFlow(input);
}
