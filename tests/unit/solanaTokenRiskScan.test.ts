import { describe, it, expect } from 'vitest';
import { solanaTokenRiskScanInput, solanaTokenRiskScanOutput } from '../../src/schemas/solanaTokenRiskScan.js';
import {
  computeAuthorityFlags,
  excludePoolAccounts,
  computeTop10Concentration,
  computeCompositeScore,
} from '../../src/services/solana/tokenRiskScan.js';

describe('solanaTokenRiskScanInput', () => {
  it('accepts a mint address', () => {
    const result = solanaTokenRiskScanInput.parse({ mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' });
    expect(result.mint).toBeTruthy();
  });

  it('rejects an empty mint', () => {
    expect(() => solanaTokenRiskScanInput.parse({ mint: '' })).toThrow();
  });
});

describe('computeAuthorityFlags — all four combinations', () => {
  it('mint=null, freeze=null -> both false', () => {
    expect(computeAuthorityFlags({ mintAuthority: null, freezeAuthority: null })).toEqual({
      canMint: false,
      canFreeze: false,
    });
  });

  it('mint=set, freeze=null -> canMint true only', () => {
    expect(computeAuthorityFlags({ mintAuthority: 'abc', freezeAuthority: null })).toEqual({
      canMint: true,
      canFreeze: false,
    });
  });

  it('mint=null, freeze=set -> canFreeze true only', () => {
    expect(computeAuthorityFlags({ mintAuthority: null, freezeAuthority: 'abc' })).toEqual({
      canMint: false,
      canFreeze: true,
    });
  });

  it('mint=set, freeze=set -> both true', () => {
    expect(computeAuthorityFlags({ mintAuthority: 'abc', freezeAuthority: 'def' })).toEqual({
      canMint: true,
      canFreeze: true,
    });
  });
});

describe('excludePoolAccounts', () => {
  it('flags a known AMM program as a pool', () => {
    const { nonPool, poolCount } = excludePoolAccounts([
      { address: 'acc1', owner: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', pct: 40 }, // Jupiter (dex category)
    ]);
    expect(poolCount).toBe(1);
    expect(nonPool[0].isPool).toBe(true);
  });

  it('does not flag a regular wallet as a pool', () => {
    const { nonPool, poolCount } = excludePoolAccounts([
      { address: 'acc1', owner: 'SomeRandomWallet1111111111111111111111111', pct: 10 },
    ]);
    expect(poolCount).toBe(0);
    expect(nonPool[0].isPool).toBe(false);
  });
});

describe('computeTop10Concentration', () => {
  it('sums top 10 non-pool holder percentages', () => {
    const holders = Array.from({ length: 12 }, (_, i) => ({ address: `a${i}`, pct: 5, isPool: false }));
    // only first 10 count -> 50%
    expect(computeTop10Concentration(holders)).toBe(50);
  });

  it('excludes pool holders from the sum entirely', () => {
    const holders = [
      { address: 'pool', pct: 80, isPool: true },
      { address: 'wallet1', pct: 5, isPool: false },
      { address: 'wallet2', pct: 3, isPool: false },
    ];
    expect(computeTop10Concentration(holders)).toBe(8);
  });

  it('caps at 100', () => {
    const holders = Array.from({ length: 10 }, (_, i) => ({ address: `a${i}`, pct: 20, isPool: false }));
    expect(computeTop10Concentration(holders)).toBe(100);
  });
});

describe('computeCompositeScore', () => {
  it('scores 0 for a fully safe token (no authorities, no concentration, deep liquidity, immutable metadata)', () => {
    const result = computeCompositeScore({
      canMint: false,
      canFreeze: false,
      top10ConcentrationPct: 0,
      liquidityUsd: 1_000_000,
      metadataMutable: false,
    });
    expect(result.score).toBe(0);
    expect(result.level).toBe('safe');
  });

  it('scores near-max for a fully risky token (both authorities, full concentration, zero liquidity, mutable metadata)', () => {
    const result = computeCompositeScore({
      canMint: true,
      canFreeze: true,
      top10ConcentrationPct: 100,
      liquidityUsd: 0,
      metadataMutable: true,
    });
    expect(result.score).toBeGreaterThanOrEqual(95);
    expect(result.level).toBe('critical');
  });

  it('weights redistribute to sum to 100 when liquidity is unavailable', () => {
    const result = computeCompositeScore({
      canMint: true,
      canFreeze: true,
      top10ConcentrationPct: 100,
      liquidityUsd: null,
      metadataMutable: true,
    });
    const total = result.weightsUsed.mint + result.weightsUsed.freeze + result.weightsUsed.concentration + result.weightsUsed.liquidity + result.weightsUsed.metadata;
    expect(result.weightsUsed.liquidity).toBe(0);
    expect(total).toBeCloseTo(100, 1);
  });

  it('weights redistribute to sum to 100 when both liquidity and metadata are unavailable', () => {
    const result = computeCompositeScore({
      canMint: false,
      canFreeze: false,
      top10ConcentrationPct: 0,
      liquidityUsd: null,
      metadataMutable: null,
    });
    const total = result.weightsUsed.mint + result.weightsUsed.freeze + result.weightsUsed.concentration + result.weightsUsed.liquidity + result.weightsUsed.metadata;
    expect(total).toBeCloseTo(100, 1);
  });

  it('flags active mint authority', () => {
    const result = computeCompositeScore({
      canMint: true,
      canFreeze: false,
      top10ConcentrationPct: 0,
      liquidityUsd: 1_000_000,
      metadataMutable: false,
    });
    expect(result.flags.some((f) => f.includes('Mint authority'))).toBe(true);
  });

  it('flags active freeze authority', () => {
    const result = computeCompositeScore({
      canMint: false,
      canFreeze: true,
      top10ConcentrationPct: 0,
      liquidityUsd: 1_000_000,
      metadataMutable: false,
    });
    expect(result.flags.some((f) => f.includes('Freeze authority'))).toBe(true);
  });

  it('flags thin liquidity', () => {
    const result = computeCompositeScore({
      canMint: false,
      canFreeze: false,
      top10ConcentrationPct: 0,
      liquidityUsd: 500,
      metadataMutable: false,
    });
    expect(result.flags.some((f) => f.includes('Thin liquidity'))).toBe(true);
  });

  it('score is monotonically non-decreasing as concentration increases (boundary check)', () => {
    const low = computeCompositeScore({ canMint: false, canFreeze: false, top10ConcentrationPct: 10, liquidityUsd: 1_000_000, metadataMutable: false });
    const high = computeCompositeScore({ canMint: false, canFreeze: false, top10ConcentrationPct: 90, liquidityUsd: 1_000_000, metadataMutable: false });
    expect(high.score).toBeGreaterThan(low.score);
  });

  it('assigns risk level bucket boundaries correctly', () => {
    expect(computeCompositeScore({ canMint: false, canFreeze: false, top10ConcentrationPct: 0, liquidityUsd: 1_000_000, metadataMutable: false }).level).toBe('safe');
    expect(computeCompositeScore({ canMint: true, canFreeze: false, top10ConcentrationPct: 0, liquidityUsd: 1_000_000, metadataMutable: false }).level).toBe('low');
  });
});

describe('solanaTokenRiskScanOutput', () => {
  it('validates a fully-populated output', () => {
    const output = solanaTokenRiskScanOutput.parse({
      mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      authorities: { mintAuthority: null, canMint: false, freezeAuthority: null, canFreeze: false, supply: '1000000', decimals: 6 },
      holders: { top10Pct: 12.5, entries: [{ address: 'a', pct: 5, isPool: false }] },
      liquidity: { totalUsd: 500000, volume24hUsd: 100000, ageDays: 30, available: true },
      metadata: { name: 'USDC', symbol: 'USDC', mutable: false },
      score: 5,
      level: 'safe',
      flags: [],
      dataCompleteness: { holdersAvailable: true, liquidityAvailable: true, metadataAvailable: true },
      relatedServices: [],
    });
    expect(output.level).toBe('safe');
  });

  it('validates degraded output with liquidity unavailable', () => {
    const output = solanaTokenRiskScanOutput.parse({
      mint: 'somemint',
      authorities: { mintAuthority: 'x', canMint: true, freezeAuthority: null, canFreeze: false },
      holders: { top10Pct: 0, entries: [] },
      liquidity: { totalUsd: null, volume24hUsd: null, ageDays: null, available: false },
      metadata: {},
      score: 50,
      level: 'medium',
      flags: ['Liquidity data unavailable'],
      dataCompleteness: { holdersAvailable: false, liquidityAvailable: false, metadataAvailable: false },
      relatedServices: [],
    });
    expect(output.liquidity.available).toBe(false);
  });

  it('rejects an invalid level value', () => {
    expect(() =>
      solanaTokenRiskScanOutput.parse({
        mint: 'x',
        authorities: { mintAuthority: null, canMint: false, freezeAuthority: null, canFreeze: false },
        holders: { top10Pct: 0, entries: [] },
        liquidity: { totalUsd: null, volume24hUsd: null, ageDays: null, available: false },
        metadata: {},
        score: 5,
        level: 'super-dangerous',
        flags: [],
        dataCompleteness: { holdersAvailable: false, liquidityAvailable: false, metadataAvailable: false },
        relatedServices: [],
      }),
    ).toThrow();
  });
});
