import { describe, it, expect } from 'vitest';
import {
  gasOracleInput,
  gasOracleOutput,
} from '../../src/schemas/gasOracle.js';

describe('Gas Oracle Schema Validation', () => {
  // ── Input schema ──────────────────────────────────────────────────

  it('accepts valid chain with defaults', () => {
    const result = gasOracleInput.parse({});
    expect(result.chain).toBe('ethereum');
  });

  it('accepts all valid chains', () => {
    for (const chain of [
      'ethereum', 'base', 'polygon', 'arbitrum', 'optimism', 'avalanche',
    ] as const) {
      const result = gasOracleInput.parse({ chain });
      expect(result.chain).toBe(chain);
    }
  });

  it('rejects invalid chain', () => {
    expect(() => gasOracleInput.parse({ chain: 'solana' })).toThrow();
  });

  // ── Output schema ─────────────────────────────────────────────────

  it('validates full output', () => {
    const output = gasOracleOutput.parse({
      chain: 'ethereum',
      currentPrices: {
        slow: { gwei: 10, estimatedSeconds: 120 },
        standard: { gwei: 15, estimatedSeconds: 30 },
        fast: { gwei: 25, estimatedSeconds: 15 },
      },
      baseFee: 12.5,
      trend: 'stable',
      timestamp: '2025-01-01T00:00:00.000Z',
      metadata: { source: 'etherscan', processingTimeMs: 200 },
    });
    expect(output.chain).toBe('ethereum');
    expect(output.currentPrices.slow.gwei).toBe(10);
    expect(output.currentPrices.standard.gwei).toBe(15);
    expect(output.currentPrices.fast.gwei).toBe(25);
    expect(output.baseFee).toBe(12.5);
    expect(output.trend).toBe('stable');
  });

  it('accepts null baseFee', () => {
    const output = gasOracleOutput.parse({
      chain: 'base',
      currentPrices: {
        slow: { gwei: 0.001, estimatedSeconds: 120 },
        standard: { gwei: 0.005, estimatedSeconds: 30 },
        fast: { gwei: 0.01, estimatedSeconds: 15 },
      },
      baseFee: null,
      trend: 'falling',
      timestamp: '2025-01-01T00:00:00.000Z',
      metadata: { source: 'etherscan', processingTimeMs: 150 },
    });
    expect(output.baseFee).toBeNull();
    expect(output.trend).toBe('falling');
  });

  it('accepts all valid trends', () => {
    for (const trend of ['rising', 'falling', 'stable'] as const) {
      const output = gasOracleOutput.parse({
        chain: 'ethereum',
        currentPrices: {
          slow: { gwei: 10, estimatedSeconds: 120 },
          standard: { gwei: 15, estimatedSeconds: 30 },
          fast: { gwei: 25, estimatedSeconds: 15 },
        },
        baseFee: null,
        trend,
        timestamp: '2025-01-01T00:00:00.000Z',
        metadata: { source: 'etherscan', processingTimeMs: 0 },
      });
      expect(output.trend).toBe(trend);
    }
  });

  it('rejects invalid trend', () => {
    expect(() =>
      gasOracleOutput.parse({
        chain: 'ethereum',
        currentPrices: {
          slow: { gwei: 10, estimatedSeconds: 120 },
          standard: { gwei: 15, estimatedSeconds: 30 },
          fast: { gwei: 25, estimatedSeconds: 15 },
        },
        baseFee: null,
        trend: 'volatile',
        timestamp: '2025-01-01T00:00:00.000Z',
        metadata: { source: 'etherscan', processingTimeMs: 0 },
      }),
    ).toThrow();
  });

  it('rejects invalid source', () => {
    expect(() =>
      gasOracleOutput.parse({
        chain: 'ethereum',
        currentPrices: {
          slow: { gwei: 10, estimatedSeconds: 120 },
          standard: { gwei: 15, estimatedSeconds: 30 },
          fast: { gwei: 25, estimatedSeconds: 15 },
        },
        baseFee: null,
        trend: 'stable',
        timestamp: '2025-01-01T00:00:00.000Z',
        metadata: { source: 'other', processingTimeMs: 0 },
      }),
    ).toThrow();
  });
});
