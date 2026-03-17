import { callClaude, type ClaudeResponse } from '../llm/anthropic.js';
import { cleanLlmJson } from '../utils/cleanJson.js';
import {
  translateInput,
  translateOutput,
  type TranslateInput,
  type TranslateOutput,
} from '../schemas/translate.js';

const SYSTEM_PROMPT = `You are a professional translator. Given text, a target language, and a tone, produce an accurate translation. You must return ONLY a JSON object. No markdown. No code fences. No preamble. No explanation.

Output JSON schema:
{
  "translatedText": <string>,
  "detectedSourceLanguage": <string, full language name e.g. "English", "Spanish">
}

Tone guide:
- "formal": professional, polished register
- "casual": everyday, conversational register
- "technical": domain-specific terminology preserved, precise

If source language is not provided, detect it from the text.
Preserve meaning, cultural nuances, and formatting (paragraphs, lists, etc).

You must return ONLY a JSON object. No markdown. No code fences. No preamble. No explanation.`;

export interface TranslateResult {
  output: TranslateOutput;
  estimatedCostUsd: number;
}

export async function translate(
  input: TranslateInput,
): Promise<TranslateOutput> {
  const result = await translateWithCost(input);
  return result.output;
}

export async function translateWithCost(
  input: TranslateInput,
): Promise<TranslateResult> {
  const validated = translateInput.parse(input);
  const startTime = Date.now();

  let prompt = `Target language: ${validated.targetLanguage}\nTone: ${validated.tone}\n`;
  if (validated.sourceLanguage) {
    prompt += `Source language: ${validated.sourceLanguage}\n`;
  }
  prompt += `\nText to translate:\n${validated.text}`;

  const response: ClaudeResponse = await callClaude({
    system: SYSTEM_PROMPT,
    userMessage: prompt,
    maxTokens: 4000,
    temperature: 0.2,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleanLlmJson(response.text));
  } catch {
    throw new Error(
      `LLM returned invalid JSON: ${response.text.slice(0, 200)}`,
    );
  }

  const output = translateOutput.parse({
    ...(parsed as Record<string, unknown>),
    targetLanguage: validated.targetLanguage,
    metadata: {
      model: 'claude-sonnet-4-20250514',
      processingTimeMs: Date.now() - startTime,
    },
  });

  return { output, estimatedCostUsd: response.usage.estimatedCostUsd };
}
