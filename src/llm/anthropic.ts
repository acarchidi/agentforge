import { config } from '../config.js';

interface ClaudeCallParams {
  system: string;
  userMessage: string;
  maxTokens: number;
  temperature?: number;
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
      model: 'claude-sonnet-4-20250514',
      max_tokens: params.maxTokens,
      temperature: params.temperature ?? 0.3,
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

  // Claude Sonnet 4 pricing: Input $3/1M tokens, Output $15/1M tokens
  const inputCost = (data.usage.input_tokens / 1_000_000) * 3;
  const outputCost = (data.usage.output_tokens / 1_000_000) * 15;

  return {
    text: textBlock.text,
    usage: {
      inputTokens: data.usage.input_tokens,
      outputTokens: data.usage.output_tokens,
      estimatedCostUsd: inputCost + outputCost,
    },
  };
}
