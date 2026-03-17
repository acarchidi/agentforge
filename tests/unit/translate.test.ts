import { describe, it, expect } from 'vitest';
import {
  translateInput,
  translateOutput,
} from '../../src/schemas/translate.js';

describe('Translate Schema Validation', () => {
  it('accepts valid input with defaults', () => {
    const result = translateInput.parse({
      text: 'Hello, how are you?',
      targetLanguage: 'Spanish',
    });
    expect(result.tone).toBe('formal');
    expect(result.sourceLanguage).toBeUndefined();
  });

  it('accepts all valid tone options', () => {
    for (const tone of ['formal', 'casual', 'technical'] as const) {
      const result = translateInput.parse({
        text: 'test',
        targetLanguage: 'French',
        tone,
      });
      expect(result.tone).toBe(tone);
    }
  });

  it('accepts sourceLanguage', () => {
    const result = translateInput.parse({
      text: 'Hola',
      targetLanguage: 'English',
      sourceLanguage: 'Spanish',
    });
    expect(result.sourceLanguage).toBe('Spanish');
  });

  it('rejects empty text', () => {
    expect(() =>
      translateInput.parse({ text: '', targetLanguage: 'Spanish' }),
    ).toThrow();
  });

  it('rejects text over 20000 chars', () => {
    expect(() =>
      translateInput.parse({ text: 'x'.repeat(20001), targetLanguage: 'Spanish' }),
    ).toThrow();
  });

  it('rejects targetLanguage under 2 chars', () => {
    expect(() =>
      translateInput.parse({ text: 'test', targetLanguage: 'x' }),
    ).toThrow();
  });

  it('rejects missing targetLanguage', () => {
    expect(() => translateInput.parse({ text: 'test' })).toThrow();
  });

  it('validates output schema', () => {
    const output = translateOutput.parse({
      translatedText: 'Hola, ¿cómo estás?',
      detectedSourceLanguage: 'English',
      targetLanguage: 'Spanish',
      metadata: { model: 'claude-sonnet-4-20250514', processingTimeMs: 800 },
    });
    expect(output.translatedText).toBe('Hola, ¿cómo estás?');
    expect(output.detectedSourceLanguage).toBe('English');
    expect(output.targetLanguage).toBe('Spanish');
  });

  it('rejects output missing translatedText', () => {
    expect(() =>
      translateOutput.parse({
        detectedSourceLanguage: 'English',
        targetLanguage: 'Spanish',
        metadata: { model: 'test', processingTimeMs: 0 },
      }),
    ).toThrow();
  });

  it('rejects output missing metadata', () => {
    expect(() =>
      translateOutput.parse({
        translatedText: 'test',
        detectedSourceLanguage: 'English',
        targetLanguage: 'Spanish',
      }),
    ).toThrow();
  });
});
