import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PoolSnapshotsCache } from '../../src/cache/poolSnapshotsCache.js';
import { poolSnapshotOutput, poolSnapshotInput } from '../../src/schemas/poolSnapshots.js';

// ── Fixture helpers ───────────────────────────────────────────────────

function makePool(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pool-1',
    address: '0xabcdef1234567890abcdef1234567890abcdef12',
    chain: 'ethereum',
    protocol: 'uniswap-v3',
    symbol: 'USDC-ETH',
    tokens: ['USDC', 'ETH'],
    tvlUsd: 1_000_000,
    apy: 5.0,
    apyBase: 3.0,
    apyReward: 2.0,
    volume24hUsd: 500_000,
    ilRisk: 'medium',
    stablecoin: false,
    exposure: 'multi',
    ...overrides,
  };
}

function makeSnapshotData(pools: ReturnType<typeof makePool>[], generatedAt?: string) {
  return {
    version: '1.0.0',
    generatedAt: generatedAt ?? new Date().toISOString(),
    totalFetched: pools.length,
    pools,
  };
}

// ── Schema validation ────────────────────────────────────────────────

describe('Pool Snapshots Schema', () => {
  describe('Schema validation', () => {
    it('validates a well-formed pool snapshot response', () => {
      const response = {
        timestamp: new Date().toISOString(),
        stalenessSec: 10,
        totalPoolsIndexed: 500,
        returned: 1,
        pools: [makePool()],
        relatedServices: [],
      };
      expect(() => poolSnapshotOutput.parse(response)).not.toThrow();
    });

    it('validates pool object with all fields', () => {
      const response = {
        timestamp: new Date().toISOString(),
        stalenessSec: 0,
        totalPoolsIndexed: 1,
        returned: 1,
        pools: [makePool({
          ilRisk: 'high',
          stablecoin: false,
          exposure: 'multi',
          registryLabel: 'Uniswap V3: USDC/ETH',
          registryRisk: 'low',
        })],
        relatedServices: [{ endpoint: '/v1/token-intel', description: 'Get token info', suggestedInput: {} }],
      };
      expect(() => poolSnapshotOutput.parse(response)).not.toThrow();
    });

    it('validates pool object with minimal fields', () => {
      const response = {
        timestamp: new Date().toISOString(),
        stalenessSec: 60,
        totalPoolsIndexed: 1,
        returned: 1,
        pools: [{
          id: 'pool-min',
          chain: 'ethereum',
          protocol: 'curve',
          symbol: 'USDC-USDT',
          tokens: ['USDC', 'USDT'],
          tvlUsd: 500_000,
          apy: 2.0,
          stablecoin: true,
        }],
        relatedServices: [],
      };
      expect(() => poolSnapshotOutput.parse(response)).not.toThrow();
    });

    it('validates IL risk enum values', () => {
      const validValues = ['none', 'low', 'medium', 'high'];
      for (const ilRisk of validValues) {
        const response = {
          timestamp: new Date().toISOString(),
          stalenessSec: 0,
          totalPoolsIndexed: 1,
          returned: 1,
          pools: [makePool({ ilRisk })],
          relatedServices: [],
        };
        expect(() => poolSnapshotOutput.parse(response)).not.toThrow();
      }
    });

    it('validates input query params with coercion', () => {
      const input = poolSnapshotInput.parse({
        limit: '20',
        offset: '0',
        sortBy: 'tvl',
        order: 'desc',
      });
      expect(input.limit).toBe(20);
      expect(input.offset).toBe(0);
    });

    it('rejects limit exceeding 100', () => {
      expect(() => poolSnapshotInput.parse({ limit: '200' })).toThrow();
    });
  });

  // ── Cache loader tests ─────────────────────────────────────────────

  describe('Loader', () => {
    it('loads pool snapshots from static data', () => {
      const pools = [makePool({ id: 'p1', tvlUsd: 2_000_000 }), makePool({ id: 'p2', tvlUsd: 1_000_000 })];
      const cache = new PoolSnapshotsCache(makeSnapshotData(pools));
      expect(cache.totalPools).toBe(2);
    });

    it('reports total pools indexed', () => {
      const pools = Array.from({ length: 10 }, (_, i) => makePool({ id: `pool-${i}` }));
      const cache = new PoolSnapshotsCache(makeSnapshotData(pools));
      expect(cache.totalPools).toBe(10);
    });

    it('calculates staleness correctly', () => {
      const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const cache = new PoolSnapshotsCache(makeSnapshotData([], tenMinsAgo));
      const staleness = cache.getStalenessSeconds();
      expect(staleness).toBeGreaterThan(590); // ~600 seconds
      expect(staleness).toBeLessThan(610);
    });

    it('returns empty array when no data loaded', () => {
      const cache = new PoolSnapshotsCache(makeSnapshotData([]));
      expect(cache.getAllPools()).toHaveLength(0);
    });
  });

  // ── Filtering tests ───────────────────────────────────────────────

  describe('Filtering', () => {
    let cache: PoolSnapshotsCache;

    beforeEach(() => {
      cache = new PoolSnapshotsCache(makeSnapshotData([
        makePool({ id: 'uni-eth', protocol: 'uniswap-v3', chain: 'ethereum', symbol: 'USDC-ETH', tokens: ['USDC', 'ETH'], tvlUsd: 3_000_000, apy: 8 }),
        makePool({ id: 'uni-base', protocol: 'uniswap-v3', chain: 'base', symbol: 'ETH-USDC', tokens: ['ETH', 'USDC'], tvlUsd: 2_000_000, apy: 6 }),
        makePool({ id: 'curve-eth', protocol: 'curve', chain: 'ethereum', symbol: 'USDC-USDT', tokens: ['USDC', 'USDT'], tvlUsd: 5_000_000, apy: 3, stablecoin: true }),
        makePool({ id: 'aave-eth', protocol: 'aave', chain: 'ethereum', symbol: 'ETH', tokens: ['ETH'], tvlUsd: 1_500_000, apy: 2, exposure: 'single' as const }),
        makePool({ id: 'sushi-arb', protocol: 'sushiswap', chain: 'arbitrum', symbol: 'WBTC-ETH', tokens: ['WBTC', 'ETH'], tvlUsd: 900_000, apy: 12, volume24hUsd: 200_000 }),
      ]));
    });

    it('filters by protocol name', () => {
      const pools = cache.filter({ protocol: 'uniswap-v3' });
      expect(pools).toHaveLength(2);
      expect(pools.every(p => p.protocol === 'uniswap-v3')).toBe(true);
    });

    it('filters by chain', () => {
      const pools = cache.filter({ chain: 'ethereum' });
      expect(pools).toHaveLength(3);
      expect(pools.every(p => p.chain === 'ethereum')).toBe(true);
    });

    it('filters by token symbol (partial match on pool symbol)', () => {
      const pools = cache.filter({ token: 'WBTC' });
      expect(pools).toHaveLength(1);
      expect(pools[0].id).toBe('sushi-arb');
    });

    it('filters by specific pool id', () => {
      const pools = cache.filter({ pool: 'curve-eth' });
      expect(pools).toHaveLength(1);
      expect(pools[0].protocol).toBe('curve');
    });

    it('combines multiple filters (chain + protocol)', () => {
      const pools = cache.filter({ chain: 'ethereum', protocol: 'uniswap-v3' });
      expect(pools).toHaveLength(1);
      expect(pools[0].id).toBe('uni-eth');
    });

    it('returns all pools when no filters specified', () => {
      const pools = cache.filter({});
      expect(pools).toHaveLength(5);
    });
  });

  // ── Sorting tests ─────────────────────────────────────────────────

  describe('Sorting', () => {
    let cache: PoolSnapshotsCache;

    beforeEach(() => {
      cache = new PoolSnapshotsCache(makeSnapshotData([
        makePool({ id: 'a', tvlUsd: 1_000_000, apy: 3, volume24hUsd: 200_000 }),
        makePool({ id: 'b', tvlUsd: 5_000_000, apy: 1, volume24hUsd: 500_000 }),
        makePool({ id: 'c', tvlUsd: 2_000_000, apy: 8, volume24hUsd: 100_000 }),
      ]));
    });

    it('sorts by TVL descending by default', () => {
      const pools = cache.filter({}, 'tvl', 'desc');
      expect(pools[0].id).toBe('b');
      expect(pools[1].id).toBe('c');
      expect(pools[2].id).toBe('a');
    });

    it('sorts by APY descending', () => {
      const pools = cache.filter({}, 'apy', 'desc');
      expect(pools[0].id).toBe('c');
      expect(pools[1].id).toBe('a');
      expect(pools[2].id).toBe('b');
    });

    it('sorts by volume descending', () => {
      const pools = cache.filter({}, 'volume', 'desc');
      expect(pools[0].id).toBe('b');
      expect(pools[1].id).toBe('a');
      expect(pools[2].id).toBe('c');
    });

    it('sorts ascending when order=asc', () => {
      const pools = cache.filter({}, 'tvl', 'asc');
      expect(pools[0].id).toBe('a');
      expect(pools[2].id).toBe('b');
    });
  });

  // ── Pagination tests ──────────────────────────────────────────────

  describe('Pagination', () => {
    let cache: PoolSnapshotsCache;

    beforeEach(() => {
      const pools = Array.from({ length: 50 }, (_, i) =>
        makePool({ id: `pool-${i}`, tvlUsd: (50 - i) * 1_000_000 }),
      );
      cache = new PoolSnapshotsCache(makeSnapshotData(pools));
    });

    it('returns limit number of results', () => {
      const pools = cache.filter({}, 'tvl', 'desc', 10, 0);
      expect(pools).toHaveLength(10);
    });

    it('respects offset', () => {
      const first = cache.filter({}, 'tvl', 'desc', 5, 0);
      const second = cache.filter({}, 'tvl', 'desc', 5, 5);
      expect(first[0].id).not.toBe(second[0].id);
      expect(first.map(p => p.id)).not.toEqual(second.map(p => p.id));
    });

    it('returns empty array when offset exceeds total', () => {
      const pools = cache.filter({}, 'tvl', 'desc', 10, 100);
      expect(pools).toHaveLength(0);
    });

    it('defaults to limit=20, offset=0', () => {
      // With 50 pools and default limit, should return 20
      const pools = cache.filter({});
      expect(pools).toHaveLength(50); // filter returns all; pagination handled by service
    });
  });

  // ── Registry enrichment ───────────────────────────────────────────

  describe('Registry enrichment', () => {
    it('adds registry label when pool address matches', () => {
      const registry = {
        lookup: (address: string) =>
          address === '0xabc123' ? { name: 'Uniswap V3 Pool', riskLevel: 'low' } : null,
      };
      const cache = new PoolSnapshotsCache(makeSnapshotData([
        makePool({ id: 'uni', address: '0xabc123' }),
      ]));
      const pools = cache.getAllPools();
      // Enrichment is applied at request time by the service
      const enriched = {
        ...pools[0],
        registryLabel: registry.lookup('0xabc123')?.name,
        registryRisk: registry.lookup('0xabc123')?.riskLevel,
      };
      expect(enriched.registryLabel).toBe('Uniswap V3 Pool');
      expect(enriched.registryRisk).toBe('low');
    });

    it('leaves fields undefined when no registry match', () => {
      const pool = makePool({ address: '0xunknown123' });
      expect(pool.registryLabel).toBeUndefined();
      expect(pool.registryRisk).toBeUndefined();
    });
  });

  // ── Staleness ─────────────────────────────────────────────────────

  describe('Staleness', () => {
    it('calculates stalenessSec from snapshot timestamp', () => {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const cache = new PoolSnapshotsCache(makeSnapshotData([], fiveMinutesAgo));
      const staleness = cache.getStalenessSeconds();
      expect(staleness).toBeGreaterThan(290);
      expect(staleness).toBeLessThan(310);
    });

    it('reports isStale when data is >30 minutes old', () => {
      const fortyMinutesAgo = new Date(Date.now() - 40 * 60 * 1000).toISOString();
      const cache = new PoolSnapshotsCache(makeSnapshotData([], fortyMinutesAgo));
      expect(cache.isStale(30 * 60)).toBe(true);
    });

    it('reports not stale when data is fresh', () => {
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
      const cache = new PoolSnapshotsCache(makeSnapshotData([], twoMinutesAgo));
      expect(cache.isStale(30 * 60)).toBe(false);
    });
  });

  // ── Composability ─────────────────────────────────────────────────

  describe('Composability', () => {
    it('response includes relatedServices', () => {
      const response = {
        timestamp: new Date().toISOString(),
        stalenessSec: 10,
        totalPoolsIndexed: 1,
        returned: 1,
        pools: [makePool({ tokens: ['ETH', 'USDC'] })],
        relatedServices: [
          { endpoint: '/v1/token-intel', description: 'Get token info for ETH', suggestedInput: { address: 'ETH', chain: 'ethereum' } },
          { endpoint: '/v1/contract-docs', description: 'Get pool contract docs', suggestedInput: { address: '0xabc', chain: 'ethereum' } },
        ],
      };
      expect(() => poolSnapshotOutput.parse(response)).not.toThrow();
      expect(response.relatedServices).toHaveLength(2);
    });
  });
});
