import { describe, it, expect } from 'vitest';
import {
  summarizeInput,
  summarizeOutput,
} from '../../src/schemas/summarize.js';

describe('Summarize Schema Validation', () => {
  it('accepts valid input with defaults', () => {
    const result = summarizeInput.parse({ text: 'A long document about blockchain technology.' });
    expect(result.maxLength).toBe('standard');
    expect(result.format).toBe('structured');
    expect(result.focus).toBeUndefined();
  });

  it('accepts all valid maxLength options', () => {
    for (const maxLength of ['brief', 'standard', 'detailed'] as const) {
      const result = summarizeInput.parse({ text: 'test', maxLength });
      expect(result.maxLength).toBe(maxLength);
    }
  });

  it('accepts all valid format options', () => {
    for (const format of ['prose', 'bullet_points', 'structured'] as const) {
      const result = summarizeInput.parse({ text: 'test', format });
      expect(result.format).toBe(format);
    }
  });

  it('accepts focus parameter', () => {
    const result = summarizeInput.parse({ text: 'test', focus: 'key findings' });
    expect(result.focus).toBe('key findings');
  });

  it('rejects empty text', () => {
    expect(() => summarizeInput.parse({ text: '' })).toThrow();
  });

  it('rejects text over 50000 chars', () => {
    expect(() => summarizeInput.parse({ text: 'x'.repeat(50001) })).toThrow();
  });

  it('rejects focus over 200 chars', () => {
    expect(() => summarizeInput.parse({ text: 'test', focus: 'x'.repeat(201) })).toThrow();
  });

  it('validates output schema', () => {
    const output = summarizeOutput.parse({
      summary: 'This is a summary.',
      keyPoints: ['Point 1', 'Point 2', 'Point 3'],
      wordCount: 4,
      compressionRatio: 10.5,
      metadata: { model: 'claude-sonnet-4-20250514', processingTimeMs: 1200 },
    });
    expect(output.summary).toBe('This is a summary.');
    expect(output.keyPoints).toHaveLength(3);
    expect(output.compressionRatio).toBe(10.5);
  });

  it('accepts output with empty keyPoints', () => {
    const output = summarizeOutput.parse({
      summary: 'Short.',
      keyPoints: [],
      wordCount: 1,
      compressionRatio: 100,
      metadata: { model: 'test', processingTimeMs: 0 },
    });
    expect(output.keyPoints).toHaveLength(0);
  });

  it('rejects output missing required fields', () => {
    expect(() =>
      summarizeOutput.parse({
        summary: 'test',
        keyPoints: [],
        // missing wordCount, compressionRatio, metadata
      }),
    ).toThrow();
  });
});
