import { describe, it, expect } from 'vitest';
import {
  tokenIntelInput,
  tokenIntelOutput,
} from '../../src/schemas/tokenIntel.js';

describe('Token Intel Schema Validation', () => {
  it('accepts valid input with defaults', () => {
    const result = tokenIntelInput.parse({
      address: '0x1234567890abcdef1234567890abcdef12345678',
    });
    expect(result.chain).toBe('ethereum');
  });

  it('accepts all valid chains', () => {
    for (const chain of [
      'ethereum',
      'base',
      'solana',
      'polygon',
      'arbitrum',
    ] as const) {
      const result = tokenIntelInput.parse({ address: '0xabc', chain });
      expect(result.chain).toBe(chain);
    }
  });

  it('rejects empty address', () => {
    expect(() => tokenIntelInput.parse({ address: '' })).toThrow();
  });

  it('validates output schema', () => {
    const output = tokenIntelOutput.parse({
      token: {
        name: 'Test Token',
        symbol: 'TEST',
        address: '0xabc',
        chain: 'ethereum',
        decimals: 18,
      },
      market: {
        priceUsd: 1.5,
        marketCap: 1000000,
        volume24h: 50000,
        priceChange24h: -2.5,
      },
      risk: {
        score: 35,
        flags: ['low_liquidity'],
        assessment: 'Moderate risk token',
      },
      metadata: {
        sources: ['coingecko', 'llm-analysis'],
        processingTimeMs: 500,
      },
    });
    expect(output.risk.score).toBe(35);
  });

  it('accepts output with relatedServices', () => {
    const output = tokenIntelOutput.parse({
      token: { name: 'T', symbol: 'T', address: '0x', chain: 'eth' },
      market: { priceUsd: 1, marketCap: null, volume24h: null, priceChange24h: null },
      risk: { score: 10, flags: [], assessment: 'ok' },
      metadata: { sources: ['coingecko'], processingTimeMs: 100 },
      relatedServices: [
        {
          endpoint: '/v1/token-research',
          description: 'Deep research on this token',
          suggestedInput: { query: '0x', chain: 'ethereum' },
        },
      ],
    });
    expect(output.relatedServices).toHaveLength(1);
    expect(output.relatedServices![0].endpoint).toBe('/v1/token-research');
  });

  it('accepts output without relatedServices', () => {
    const output = tokenIntelOutput.parse({
      token: { name: 'T', symbol: 'T', address: '0x', chain: 'eth' },
      market: { priceUsd: 1, marketCap: null, volume24h: null, priceChange24h: null },
      risk: { score: 10, flags: [], assessment: 'ok' },
      metadata: { sources: ['coingecko'], processingTimeMs: 100 },
    });
    expect(output.relatedServices).toBeUndefined();
  });

  it('rejects risk score outside 0-100', () => {
    expect(() =>
      tokenIntelOutput.parse({
        token: {
          name: 'T',
          symbol: 'T',
          address: '0x',
          chain: 'eth',
        },
        market: {
          priceUsd: null,
          marketCap: null,
          volume24h: null,
          priceChange24h: null,
        },
        risk: { score: 101, flags: [], assessment: 'test' },
        metadata: { sources: [], processingTimeMs: 0 },
      }),
    ).toThrow();
  });
});
