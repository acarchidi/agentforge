import { describe, it, expect } from 'vitest';
import {
  tokenCompareInput,
  tokenCompareOutput,
} from '../../src/schemas/tokenCompare.js';

describe('Token Compare Schema Validation', () => {
  // ── Input schema ──────────────────────────────────────────────────

  it('accepts valid input with defaults', () => {
    const result = tokenCompareInput.parse({
      primary: 'ethereum',
      compare: ['solana'],
    });
    expect(result.chain).toBe('ethereum');
    expect(result.compare).toHaveLength(1);
  });

  it('accepts up to 3 comparisons', () => {
    const result = tokenCompareInput.parse({
      primary: 'ethereum',
      compare: ['solana', 'avalanche', 'polygon'],
    });
    expect(result.compare).toHaveLength(3);
  });

  it('accepts all valid chains', () => {
    for (const chain of [
      'ethereum', 'base', 'polygon', 'arbitrum', 'optimism', 'avalanche',
    ] as const) {
      const result = tokenCompareInput.parse({
        primary: 'ETH',
        compare: ['SOL'],
        chain,
      });
      expect(result.chain).toBe(chain);
    }
  });

  it('rejects empty primary', () => {
    expect(() =>
      tokenCompareInput.parse({ primary: '', compare: ['solana'] }),
    ).toThrow();
  });

  it('rejects empty compare array', () => {
    expect(() =>
      tokenCompareInput.parse({ primary: 'ethereum', compare: [] }),
    ).toThrow();
  });

  it('rejects more than 3 comparisons', () => {
    expect(() =>
      tokenCompareInput.parse({
        primary: 'ethereum',
        compare: ['solana', 'avalanche', 'polygon', 'arbitrum'],
      }),
    ).toThrow();
  });

  it('rejects invalid chain', () => {
    expect(() =>
      tokenCompareInput.parse({
        primary: 'ETH',
        compare: ['SOL'],
        chain: 'solana',
      }),
    ).toThrow();
  });

  // ── Output schema ─────────────────────────────────────────────────

  const minimalPrimaryResearch = {
    token: { name: 'Ethereum', symbol: 'ETH', chain: 'ethereum' },
    metadata: {
      sourcesQueried: ['coingecko'],
      sourcesSucceeded: ['coingecko'],
      sourcesFailed: [],
      processingTimeMs: 500,
      estimatedCostUsd: 0.003,
      cachedSources: [],
    },
  };

  it('validates minimal output', () => {
    const output = tokenCompareOutput.parse({
      primary: minimalPrimaryResearch,
      comparisons: [
        {
          query: 'solana',
          symbol: 'SOL',
          priceUsd: 150,
          marketCap: 65000000000,
          tvl: 10000000000,
          riskScore: 25,
        },
      ],
      analysis: 'Ethereum has higher TVL and market cap compared to Solana.',
      metadata: {
        processingTimeMs: 5000,
        estimatedCostUsd: 0.02,
      },
    });
    expect(output.comparisons).toHaveLength(1);
    expect(output.comparisons[0].symbol).toBe('SOL');
  });

  it('validates output with multiple comparisons and null fields', () => {
    const output = tokenCompareOutput.parse({
      primary: minimalPrimaryResearch,
      comparisons: [
        {
          query: 'solana',
          symbol: 'SOL',
          priceUsd: 150,
          marketCap: 65000000000,
          tvl: null,
          riskScore: 25,
        },
        {
          query: 'avalanche',
          symbol: 'AVAX',
          priceUsd: null,
          marketCap: null,
          tvl: null,
          riskScore: 50,
        },
      ],
      analysis: 'Comparative analysis text.',
      metadata: {
        processingTimeMs: 8000,
        estimatedCostUsd: 0.04,
      },
    });
    expect(output.comparisons).toHaveLength(2);
    expect(output.comparisons[1].priceUsd).toBeNull();
  });

  it('accepts output with relatedServices', () => {
    const output = tokenCompareOutput.parse({
      primary: minimalPrimaryResearch,
      comparisons: [{ query: 'solana', symbol: 'SOL', priceUsd: 150, marketCap: 65e9, tvl: null, riskScore: 25 }],
      analysis: 'test',
      metadata: { processingTimeMs: 1000, estimatedCostUsd: 0.01 },
      relatedServices: [
        { endpoint: '/v1/token-research', description: 'Deep research on SOL', suggestedInput: { query: 'solana' } },
      ],
    });
    expect(output.relatedServices).toHaveLength(1);
  });
});
