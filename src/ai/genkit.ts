
import {genkit, GenkitPlugin} from 'genkit';
import {googleAI} from '@genkit-ai/googleai';

// This is a critical fix to prevent server crashes when the API key is missing.
const googleAiApiKey = process.env.GOOGLE_AI_KEY;
const plugins: GenkitPlugin[] = [];

if (googleAiApiKey && !googleAiApiKey.includes('YOUR_')) {
  plugins.push(
    googleAI({
      apiKey: googleAiApiKey,
    })
  );
} else {
    // This console log is important for developers to know why AI features might be disabled.
    console.warn(
      `
      ***************************************************************************************
      * WARNING: NEXT_PUBLIC_GOOGLE_AI_KEY is not set or is invalid in your environment.    *
      * The Google AI plugin for Genkit will be disabled.                                   *
      * AI-powered features like photo analysis and route safety will not work.             *
      * To enable these features, please add a valid key to your .env file.                 *
      ***************************************************************************************
      `
    );
}

export const ai = genkit({
  plugins: plugins,
});
