import { config } from '../config.js';

interface ClaudeCallParams {
  system: string;
  userMessage: string;
  maxTokens: number;
  temperature?: number;
  model?: ClaudeModel;
}

export type ClaudeModel = 'claude-sonnet-5' | 'claude-haiku-4-5-20251001' | 'claude-haiku-5-5';

/** Anthropic list prices, USD per 1M tokens (Haiku 5.5: prompts up to 100K tokens). */
const RATES: Record<ClaudeModel, { input: number; output: number }> = {
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
};

export interface ClaudeResponse {
  text: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
  };
}

export async function callClaude(
  params: ClaudeCallParams,
): Promise<ClaudeResponse> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: params.model ?? 'claude-sonnet-5',
      max_tokens: params.maxTokens,
      // Haiku 5.5 thinks by default; these are short single-shot tasks, so keep
      // max_tokens for the answer (disabled is accepted at its default effort).
      ...(params.model === 'claude-haiku-5-5' ? { thinking: { type: 'disabled' } } : {}),
      system: params.system,
      messages: [{ role: 'user', content: params.userMessage }],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude API error ${response.status}: ${error}`);
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text?: string }>;
    usage: { input_tokens: number; output_tokens: number };
  };

  const textBlock = data.content.find((b) => b.type === 'text');
  if (!textBlock?.text) {
    throw new Error('Claude returned no text content');
  }

  const rate = RATES[params.model ?? 'claude-sonnet-5'];
  const inputCost = (data.usage.input_tokens / 1_000_000) * rate.input;
  const outputCost = (data.usage.output_tokens / 1_000_000) * rate.output;

  return {
    text: textBlock.text,
    usage: {
      inputTokens: data.usage.input_tokens,
      outputTokens: data.usage.output_tokens,
      estimatedCostUsd: inputCost + outputCost,
    },
  };
}
