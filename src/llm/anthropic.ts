import { config } from '../config.js';

interface ClaudeCallParams {
  system: string;
  userMessage: string;
  maxTokens: number;
  temperature?: number;
  model?: 'claude-sonnet-5' | 'claude-haiku-4-5-20251001';
}

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

  // Sonnet 5: Input $3/1M, Output $15/1M. Haiku 4.5: Input $0.25/1M, Output $1.25/1M (estimate).
  const isHaiku = params.model === 'claude-haiku-4-5-20251001';
  const inputRate = isHaiku ? 0.25 : 3;
  const outputRate = isHaiku ? 1.25 : 15;
  const inputCost = (data.usage.input_tokens / 1_000_000) * inputRate;
  const outputCost = (data.usage.output_tokens / 1_000_000) * outputRate;

  return {
    text: textBlock.text,
    usage: {
      inputTokens: data.usage.input_tokens,
      outputTokens: data.usage.output_tokens,
      estimatedCostUsd: inputCost + outputCost,
    },
  };
}
