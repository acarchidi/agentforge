import { describe, it, expect } from 'vitest';
import {
  sentimentInput,
  sentimentOutput,
} from '../../src/schemas/sentiment.js';

describe('Sentiment Schema Validation', () => {
  it('accepts valid input with defaults', () => {
    const result = sentimentInput.parse({ text: 'ETH is pumping hard' });
    expect(result.context).toBe('crypto');
  });

  it('accepts all valid contexts', () => {
    for (const context of ['crypto', 'finance', 'general', 'social_media'] as const) {
      const result = sentimentInput.parse({ text: 'test', context });
      expect(result.context).toBe(context);
    }
  });

  it('rejects empty text', () => {
    expect(() => sentimentInput.parse({ text: '' })).toThrow();
  });

  it('rejects text over 10000 chars', () => {
    expect(() => sentimentInput.parse({ text: 'x'.repeat(10001) })).toThrow();
  });

  it('rejects invalid context', () => {
    expect(() => sentimentInput.parse({ text: 'test', context: 'invalid' })).toThrow();
  });

  it('validates output schema', () => {
    const output = sentimentOutput.parse({
      sentiment: 0.7,
      confidence: 0.9,
      label: 'bullish',
      reasoning: 'Strong positive signals',
      entities: [{ name: 'ETH', sentiment: 0.8 }],
      metadata: { model: 'claude-sonnet-4-20250514', processingTimeMs: 500 },
    });
    expect(output.sentiment).toBe(0.7);
    expect(output.label).toBe('bullish');
    expect(output.entities).toHaveLength(1);
  });

  it('rejects sentiment out of range', () => {
    expect(() =>
      sentimentOutput.parse({
        sentiment: 1.5,
        confidence: 0.9,
        label: 'bullish',
        reasoning: 'test',
        entities: [],
        metadata: { model: 'test', processingTimeMs: 0 },
      }),
    ).toThrow();
  });

  it('rejects invalid label', () => {
    expect(() =>
      sentimentOutput.parse({
        sentiment: 0.5,
        confidence: 0.9,
        label: 'invalid_label',
        reasoning: 'test',
        entities: [],
        metadata: { model: 'test', processingTimeMs: 0 },
      }),
    ).toThrow();
  });

  it('accepts output with empty entities array', () => {
    const output = sentimentOutput.parse({
      sentiment: 0,
      confidence: 0.5,
      label: 'neutral',
      reasoning: 'No clear signals',
      entities: [],
      metadata: { model: 'test', processingTimeMs: 100 },
    });
    expect(output.entities).toHaveLength(0);
  });

  it('accepts all valid labels', () => {
    for (const label of ['very_bearish', 'bearish', 'neutral', 'bullish', 'very_bullish'] as const) {
      const output = sentimentOutput.parse({
        sentiment: 0,
        confidence: 0.5,
        label,
        reasoning: 'test',
        entities: [],
        metadata: { model: 'test', processingTimeMs: 0 },
      });
      expect(output.label).toBe(label);
    }
  });
});
