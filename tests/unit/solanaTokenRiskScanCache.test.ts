import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SolanaTokenRiskScanCache } from '../../src/cache/solanaTokenRiskScanCache.js';
import type { SolanaTokenRiskScanData } from '../../src/cache/solanaTokenRiskScanCache.js';
import type { SolanaTokenRiskScanOutput } from '../../src/schemas/solanaTokenRiskScan.js';

function makeScan(overrides: Partial<SolanaTokenRiskScanOutput> = {}): SolanaTokenRiskScanOutput {
  return {
    mint: 'MintAddress11111111111111111111111111111',
    source: 'live',
    authorities: { mintAuthority: null, canMint: false, freezeAuthority: null, canFreeze: false },
    holders: { top10Pct: 0, entries: [] },
    liquidity: { totalUsd: 10_000, volume24hUsd: 5_000, ageDays: 30, available: true },
    metadata: { name: 'Test', symbol: 'TST', mutable: false },
    score: 10,
    level: 'low',
    flags: [],
    dataCompleteness: { holdersAvailable: true, liquidityAvailable: true, metadataAvailable: true },
    relatedServices: [],
    ...overrides,
  };
}

function makeData(entries: SolanaTokenRiskScanData['entries'] = []): SolanaTokenRiskScanData {
  return { version: '1.0.0', generatedAt: '2026-01-01T00:00:00.000Z', entries };
}

describe('SolanaTokenRiskScanCache', () => {
  it('seeds from provided data on construction', () => {
    const cache = new SolanaTokenRiskScanCache(
      makeData([{ mint: 'MintA', scan: makeScan({ mint: 'MintA' }) }]),
    );
    expect(cache.size).toBe(1);
  });

  it('returns null on a cache miss', () => {
    const cache = new SolanaTokenRiskScanCache(makeData());
    expect(cache.lookup('Unseen')).toBeNull();
  });

  it('returns a hit with source overridden to cached', () => {
    const cache = new SolanaTokenRiskScanCache(
      makeData([{ mint: 'MintA', scan: makeScan({ mint: 'MintA', source: 'live' }) }]),
    );
    const hit = cache.lookup('MintA');
    expect(hit).not.toBeNull();
    expect(hit!.source).toBe('cached');
    expect(hit!.mint).toBe('MintA');
  });

  it('reports staleness in seconds on a hit', () => {
    const cache = new SolanaTokenRiskScanCache(
      makeData([{ mint: 'MintA', scan: makeScan({ mint: 'MintA' }) }]),
    );
    const hit = cache.lookup('MintA');
    expect(hit!.stalenessSec).toBeGreaterThanOrEqual(0);
  });

  it('stores a freshly-computed scan via set() and serves it back', () => {
    const cache = new SolanaTokenRiskScanCache(makeData());
    cache.set('MintB', makeScan({ mint: 'MintB' }));
    const hit = cache.lookup('MintB');
    expect(hit).not.toBeNull();
    expect(hit!.mint).toBe('MintB');
    expect(hit!.source).toBe('cached');
  });

  it('expires entries past the TTL', () => {
    vi.useFakeTimers();
    try {
      const cache = new SolanaTokenRiskScanCache(makeData());
      cache.set('MintC', makeScan({ mint: 'MintC' }));
      expect(cache.lookup('MintC')).not.toBeNull();

      vi.advanceTimersByTime(16 * 60 * 1000); // > 15 min TTL
      expect(cache.lookup('MintC')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('removes expired entries from the underlying map', () => {
    vi.useFakeTimers();
    try {
      const cache = new SolanaTokenRiskScanCache(makeData());
      cache.set('MintD', makeScan({ mint: 'MintD' }));
      expect(cache.size).toBe(1);

      vi.advanceTimersByTime(16 * 60 * 1000);
      cache.lookup('MintD');
      expect(cache.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('exposes seed metadata via getStats', () => {
    const cache = new SolanaTokenRiskScanCache(
      makeData([{ mint: 'MintA', scan: makeScan({ mint: 'MintA' }) }]),
    );
    const stats = cache.getStats();
    expect(stats.totalCached).toBe(1);
    expect(stats.seedVersion).toBe('1.0.0');
    expect(stats.seedGeneratedAt).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('getSolanaTokenRiskScanCache singleton', () => {
  beforeEach(async () => {
    const mod = await import('../../src/cache/solanaTokenRiskScanCache.js');
    mod._resetSolanaTokenRiskScanCache();
  });

  it('loads the real committed seed file with at least one entry', async () => {
    const { getSolanaTokenRiskScanCache } = await import('../../src/cache/solanaTokenRiskScanCache.js');
    const cache = getSolanaTokenRiskScanCache();
    expect(cache.size).toBeGreaterThanOrEqual(1);
  });

  it('serves the seeded USDC entry', async () => {
    const { getSolanaTokenRiskScanCache } = await import('../../src/cache/solanaTokenRiskScanCache.js');
    const cache = getSolanaTokenRiskScanCache();
    const usdc = cache.lookup('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    expect(usdc).not.toBeNull();
    expect(usdc!.metadata.symbol).toBe('USDC');
  });
});
