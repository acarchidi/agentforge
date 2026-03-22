import { describe, it, expect, vi, afterEach } from 'vitest';

// Tests for the pool snapshot refresh script logic.
// We test the pure functions extracted from the script rather than the script itself.

import {
  computeIlRisk,
  mapLlamaPool,
  filterTopByTvl,
} from '../../src/services/poolSnapshotRefresh.js';

describe('Pool snapshot refresh script', () => {
  describe('IL risk computation', () => {
    it('computes IL risk for stablecoin pairs as "none"', () => {
      expect(computeIlRisk(['USDC', 'USDT'], true)).toBe('none');
      expect(computeIlRisk(['DAI', 'USDC'], true)).toBe('none');
      expect(computeIlRisk(['FRAX', 'USDT'], true)).toBe('none');
    });

    it('computes IL risk for correlated pairs as "low"', () => {
      expect(computeIlRisk(['ETH', 'stETH'], false)).toBe('low');
      expect(computeIlRisk(['WBTC', 'BTC'], false)).toBe('low');
      expect(computeIlRisk(['ETH', 'wstETH'], false)).toBe('low');
      expect(computeIlRisk(['WETH', 'stETH'], false)).toBe('low');
    });

    it('computes IL risk for major pairs as "medium"', () => {
      expect(computeIlRisk(['ETH', 'USDC'], false)).toBe('medium');
      expect(computeIlRisk(['WBTC', 'USDT'], false)).toBe('medium');
      expect(computeIlRisk(['BTC', 'USDC'], false)).toBe('medium');
    });

    it('computes IL risk for exotic pairs as "high"', () => {
      expect(computeIlRisk(['SHIB', 'PEPE'], false)).toBe('high');
      expect(computeIlRisk(['LINK', 'UNI'], false)).toBe('high');
      expect(computeIlRisk(['DOGE', 'FLOKI'], false)).toBe('high');
    });

    it('handles single-token pools (lending) as "none"', () => {
      expect(computeIlRisk(['USDC'], false)).toBe('none');
    });
  });

  describe('Pool mapping from DeFi Llama format', () => {
    it('maps a DeFi Llama pool object correctly', () => {
      const llamaPool = {
        pool: 'llama-pool-id-123',
        chain: 'Ethereum',
        project: 'uniswap-v3',
        symbol: 'USDC-ETH',
        tvlUsd: 5_000_000,
        apy: 8.5,
        apyBase: 5.0,
        apyReward: 3.5,
        volumeUsd1d: 1_000_000,
        stablecoin: false,
        exposure: 'multi',
        poolMeta: null,
      };

      const pool = mapLlamaPool(llamaPool);
      expect(pool.id).toBe('llama-pool-id-123');
      expect(pool.chain).toBe('ethereum'); // lowercased
      expect(pool.protocol).toBe('uniswap-v3');
      expect(pool.symbol).toBe('USDC-ETH');
      expect(pool.tvlUsd).toBe(5_000_000);
      expect(pool.apy).toBe(8.5);
      expect(pool.apyBase).toBe(5.0);
      expect(pool.apyReward).toBe(3.5);
      expect(pool.volume24hUsd).toBe(1_000_000);
      expect(pool.stablecoin).toBe(false);
      expect(pool.tokens).toEqual(['USDC', 'ETH']);
    });

    it('splits symbol into tokens on hyphen', () => {
      const pool = mapLlamaPool({ pool: 'x', chain: 'Base', project: 'curve', symbol: 'USDC-USDT-DAI', tvlUsd: 100, apy: 1, stablecoin: true });
      expect(pool.tokens).toEqual(['USDC', 'USDT', 'DAI']);
    });

    it('handles pools with no volume data', () => {
      const pool = mapLlamaPool({ pool: 'x', chain: 'Ethereum', project: 'aave', symbol: 'USDC', tvlUsd: 100, apy: 2, stablecoin: false });
      expect(pool.volume24hUsd).toBeUndefined();
    });

    it('lowercases chain name', () => {
      const pool = mapLlamaPool({ pool: 'x', chain: 'ARBITRUM', project: 'test', symbol: 'ETH', tvlUsd: 100, apy: 1, stablecoin: false });
      expect(pool.chain).toBe('arbitrum');
    });
  });

  describe('Top pool filtering', () => {
    it('filters to top N by TVL', () => {
      const pools = Array.from({ length: 20 }, (_, i) => ({
        id: `pool-${i}`,
        tvlUsd: i * 1_000_000,
        chain: 'ethereum',
        protocol: 'test',
        symbol: 'A-B',
        tokens: ['A', 'B'],
        apy: 1,
        stablecoin: false,
      }));

      const top5 = filterTopByTvl(pools as any, 5);
      expect(top5).toHaveLength(5);
      expect(top5[0].tvlUsd).toBe(19 * 1_000_000); // highest TVL first
    });

    it('returns all if fewer than limit', () => {
      const pools = [{ id: 'a', tvlUsd: 100 }];
      const result = filterTopByTvl(pools as any, 500);
      expect(result).toHaveLength(1);
    });
  });

  describe('Error handling', () => {
    it('handles missing TVL gracefully (treats as 0)', () => {
      const pool = mapLlamaPool({ pool: 'x', chain: 'Ethereum', project: 'test', symbol: 'A-B', apy: 1, stablecoin: false });
      expect(pool.tvlUsd).toBe(0);
    });

    it('handles missing APY gracefully (treats as 0)', () => {
      const pool = mapLlamaPool({ pool: 'x', chain: 'Ethereum', project: 'test', symbol: 'A-B', tvlUsd: 1000, stablecoin: false });
      expect(pool.apy).toBe(0);
    });
  });
});
