import { callClaude, type ClaudeResponse } from '../llm/anthropic.js';
import { cleanLlmJson } from '../utils/cleanJson.js';
import {
  summarizeInput,
  summarizeOutput,
  type SummarizeInput,
  type SummarizeOutput,
} from '../schemas/summarize.js';

const SYSTEM_PROMPT = `You are a precision text summarizer. You must return ONLY a JSON object. No markdown. No code fences. No preamble. No explanation.

Output JSON schema:
{
  "summary": <string>,
  "keyPoints": [<string>, ...],
  "wordCount": <number, word count of the summary>
}

Length guide:
- "brief": 1-2 sentences summary, 3-4 key points
- "standard": 3-5 sentences summary, 5-7 key points
- "detailed": 1-2 paragraphs summary, 7-10 key points

Format guide:
- "prose": flowing paragraph style
- "bullet_points": each key point as a standalone bullet
- "structured": organized with clear topic sentences

If a focus area is given, weight the summary toward that topic.

You must return ONLY a JSON object. No markdown. No code fences. No preamble. No explanation.`;

export interface SummarizeResult {
  output: SummarizeOutput;
  estimatedCostUsd: number;
}

export async function summarize(
  input: SummarizeInput,
): Promise<SummarizeOutput> {
  const result = await summarizeWithCost(input);
  return result.output;
}

export async function summarizeWithCost(
  input: SummarizeInput,
): Promise<SummarizeResult> {
  const validated = summarizeInput.parse(input);
  const startTime = Date.now();

  let prompt = `Length: ${validated.maxLength}\nFormat: ${validated.format}\n`;
  if (validated.focus) {
    prompt += `Focus area: ${validated.focus}\n`;
  }
  prompt += `\nText to summarize:\n${validated.text}`;

  const response: ClaudeResponse = await callClaude({
    system: SYSTEM_PROMPT,
    userMessage: prompt,
    maxTokens: 2000,
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

  const p = parsed as Record<string, unknown>;
  const summaryText = typeof p.summary === 'string' ? p.summary : '';
  const originalWordCount = validated.text.split(/\s+/).length;
  const summaryWordCount =
    typeof p.wordCount === 'number'
      ? p.wordCount
      : summaryText.split(/\s+/).length;

  const output = summarizeOutput.parse({
    ...p,
    wordCount: summaryWordCount,
    compressionRatio:
      summaryWordCount > 0 ? originalWordCount / summaryWordCount : 0,
    metadata: {
      model: 'claude-sonnet-4-20250514',
      processingTimeMs: Date.now() - startTime,
    },
  });

  return { output, estimatedCostUsd: response.usage.estimatedCostUsd };
}
