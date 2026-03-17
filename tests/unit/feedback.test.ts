import { describe, it, expect } from 'vitest';
import { feedbackInput } from '../../src/schemas/feedback.js';

describe('Feedback Schema Validation', () => {
  it('accepts valid feature request', () => {
    const result = feedbackInput.parse({
      type: 'feature_request',
      message: 'Add support for Solana tokens in contract-monitor',
    });
    expect(result.type).toBe('feature_request');
    expect(result.endpoint).toBeUndefined();
    expect(result.contact).toBeUndefined();
  });

  it('accepts all valid types', () => {
    for (const type of [
      'feature_request', 'bug_report', 'service_request', 'general',
    ] as const) {
      const result = feedbackInput.parse({ type, message: 'test' });
      expect(result.type).toBe(type);
    }
  });

  it('accepts optional endpoint and contact', () => {
    const result = feedbackInput.parse({
      type: 'bug_report',
      endpoint: '/v1/token-intel',
      message: 'Getting 500 errors intermittently',
      contact: 'user@example.com',
    });
    expect(result.endpoint).toBe('/v1/token-intel');
    expect(result.contact).toBe('user@example.com');
  });

  it('rejects invalid type', () => {
    expect(() =>
      feedbackInput.parse({ type: 'complaint', message: 'test' }),
    ).toThrow();
  });

  it('rejects empty message', () => {
    expect(() =>
      feedbackInput.parse({ type: 'general', message: '' }),
    ).toThrow();
  });

  it('rejects message over 2000 chars', () => {
    expect(() =>
      feedbackInput.parse({ type: 'general', message: 'a'.repeat(2001) }),
    ).toThrow();
  });

  it('rejects contact over 200 chars', () => {
    expect(() =>
      feedbackInput.parse({
        type: 'general',
        message: 'test',
        contact: 'a'.repeat(201),
      }),
    ).toThrow();
  });

  it('rejects missing type', () => {
    expect(() => feedbackInput.parse({ message: 'test' })).toThrow();
  });

  it('rejects missing message', () => {
    expect(() => feedbackInput.parse({ type: 'general' })).toThrow();
  });
});
