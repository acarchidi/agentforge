import { callClaude, type ClaudeResponse } from '../llm/anthropic.js';
import { cleanLlmJson } from '../utils/cleanJson.js';
import {
  sentimentInput,
  sentimentOutput,
  type SentimentInput,
  type SentimentOutput,
} from '../schemas/sentiment.js';

const SYSTEM_PROMPT = `You are a precision financial sentiment analyzer. You must return ONLY a JSON object. No markdown. No code fences. No preamble. No explanation.

Output JSON schema:
{
  "sentiment": <number -1.0 to 1.0>,
  "confidence": <number 0.0 to 1.0>,
  "label": <"very_bearish"|"bearish"|"neutral"|"bullish"|"very_bullish">,
  "reasoning": <string, one sentence explaining the score>,
  "entities": [{"name": <string>, "sentiment": <number -1.0 to 1.0>}]
}

Scoring guide:
- [-1.0, -0.6]: very_bearish — strong negative signals, fear, capitulation language
- [-0.6, -0.2]: bearish — cautious, concerned, risk-off sentiment
- [-0.2, 0.2]: neutral — balanced, factual, no strong directional signal
- [0.2, 0.6]: bullish — optimistic, confident, accumulation language
- [0.6, 1.0]: very_bullish — euphoric, extremely positive, FOMO language

For crypto context: weigh on-chain metrics, whale activity, protocol developments heavily.
For social_media context: account for irony, sarcasm, and hype cycles.

You must return ONLY a JSON object. No markdown. No code fences. No preamble. No explanation.`;

export interface SentimentResult {
  output: SentimentOutput;
  estimatedCostUsd: number;
}

export async function analyzeSentiment(
  input: SentimentInput,
): Promise<SentimentOutput> {
  const result = await analyzeSentimentWithCost(input);
  return result.output;
}

export async function analyzeSentimentWithCost(
  input: SentimentInput,
): Promise<SentimentResult> {
  const validated = sentimentInput.parse(input);
  const startTime = Date.now();

  const prompt = `Context type: ${validated.context}\n\nText to analyze:\n${validated.text}`;

  const response: ClaudeResponse = await callClaude({
    system: SYSTEM_PROMPT,
    userMessage: prompt,
    maxTokens: 500,
    temperature: 0.1,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleanLlmJson(response.text));
  } catch {
    throw new Error(
      `LLM returned invalid JSON: ${response.text.slice(0, 200)}`,
    );
  }

  const output = sentimentOutput.parse({
    ...(parsed as Record<string, unknown>),
    metadata: {
      model: 'claude-sonnet-4-20250514',
      processingTimeMs: Date.now() - startTime,
    },
  });

  return { output, estimatedCostUsd: response.usage.estimatedCostUsd };
}
