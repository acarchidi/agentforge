import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Fixture: a minimal valid ContractDocsOutput ──────────────────────

const WETH_ADDRESS = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const USDC_ADDRESS = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const AAVE_ADDRESS = '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9';

function makeFakeDoc(overrides: Partial<{
  address: string;
  chain: string;
  name: string;
  isProxy: boolean;
  implementationAddress: string | null;
  totalFunctions: number;
}> = {}) {
  const addr = overrides.address ?? '0xabc';
  const chain = overrides.chain ?? 'ethereum';
  return {
    contract: {
      address: addr,
      chain,
      name: overrides.name ?? 'TestContract',
      compilerVersion: 'v0.8.0',
      isVerified: true,
      isProxy: overrides.isProxy ?? false,
      implementationAddress: overrides.implementationAddress ?? null,
    },
    functions: [{
      name: 'transfer',
      signature: 'transfer(address,uint256)',
      type: 'write' as const,
      description: 'Transfer tokens',
      parameters: [
        { name: 'to', type: 'address', description: 'Recipient' },
        { name: 'amount', type: 'uint256', description: 'Amount' },
      ],
      returns: [{ type: 'bool', description: 'Success' }],
      riskFlags: ['can_transfer_funds' as const],
    }],
    events: [{
      name: 'Transfer',
      description: 'Emitted on transfer',
      parameters: [
        { name: 'from', type: 'address', indexed: true },
        { name: 'to', type: 'address', indexed: true },
        { name: 'value', type: 'uint256', indexed: false },
      ],
    }],
    summary: {
      totalFunctions: overrides.totalFunctions ?? 1,
      readFunctions: 0,
      writeFunctions: 1,
      adminFunctions: 0,
      riskLevel: 'low' as const,
      overview: 'A test contract.',
    },
    metadata: {
      model: 'claude-sonnet-4-20250514',
      processingTimeMs: 3000,
      estimatedCostUsd: 0.005,
      abiSize: 10,
    },
  };
}

// ── PrecomputedDocsCache tests ────────────────────────────────────────

describe('PrecomputedDocsCache', () => {
  // We test the class directly by importing and constructing with test data
  // rather than relying on the JSON import (which is for production).

  let PrecomputedDocsCache: typeof import('../../src/cache/precomputedDocs.js').PrecomputedDocsCache;

  beforeEach(async () => {
    const mod = await import('../../src/cache/precomputedDocs.js');
    PrecomputedDocsCache = mod.PrecomputedDocsCache;
  });

  describe('constructor and lookup', () => {
    it('constructs from an entries array', () => {
      const cache = new PrecomputedDocsCache({
        version: '1.0.0',
        generatedAt: '2026-03-17T00:00:00Z',
        entries: [
          { address: WETH_ADDRESS, chain: 'ethereum', docs: makeFakeDoc({ address: WETH_ADDRESS, name: 'WETH9' }) },
        ],
      });
      expect(cache.size).toBe(1);
    });

    it('lookup returns cached doc by address + chain', () => {
      const doc = makeFakeDoc({ address: WETH_ADDRESS, name: 'WETH9', totalFunctions: 9 });
      const cache = new PrecomputedDocsCache({
        version: '1.0.0',
        generatedAt: '2026-03-17T00:00:00Z',
        entries: [
          { address: WETH_ADDRESS, chain: 'ethereum', docs: doc },
        ],
      });

      const result = cache.lookup(WETH_ADDRESS, 'ethereum');
      expect(result).not.toBeNull();
      expect(result!.contract.name).toBe('WETH9');
      expect(result!.summary.totalFunctions).toBe(9);
    });

    it('lookup is case-insensitive on address', () => {
      const doc = makeFakeDoc({ address: WETH_ADDRESS, name: 'WETH9' });
      const cache = new PrecomputedDocsCache({
        version: '1.0.0',
        generatedAt: '2026-03-17T00:00:00Z',
        entries: [
          { address: WETH_ADDRESS, chain: 'ethereum', docs: doc },
        ],
      });

      // Uppercase lookup
      const result = cache.lookup('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', 'ethereum');
      expect(result).not.toBeNull();
      expect(result!.contract.name).toBe('WETH9');
    });

    it('lookup returns null for unknown address', () => {
      const cache = new PrecomputedDocsCache({
        version: '1.0.0',
        generatedAt: '2026-03-17T00:00:00Z',
        entries: [
          { address: WETH_ADDRESS, chain: 'ethereum', docs: makeFakeDoc({ address: WETH_ADDRESS }) },
        ],
      });

      expect(cache.lookup('0x0000000000000000000000000000000000000000', 'ethereum')).toBeNull();
    });

    it('lookup returns null when chain does not match', () => {
      const cache = new PrecomputedDocsCache({
        version: '1.0.0',
        generatedAt: '2026-03-17T00:00:00Z',
        entries: [
          { address: WETH_ADDRESS, chain: 'ethereum', docs: makeFakeDoc({ address: WETH_ADDRESS }) },
        ],
      });

      expect(cache.lookup(WETH_ADDRESS, 'base')).toBeNull();
    });
  });

  describe('multiple entries', () => {
    it('handles multiple contracts', () => {
      const cache = new PrecomputedDocsCache({
        version: '1.0.0',
        generatedAt: '2026-03-17T00:00:00Z',
        entries: [
          { address: WETH_ADDRESS, chain: 'ethereum', docs: makeFakeDoc({ address: WETH_ADDRESS, name: 'WETH9' }) },
          { address: USDC_ADDRESS, chain: 'ethereum', docs: makeFakeDoc({ address: USDC_ADDRESS, name: 'USDC', isProxy: true, implementationAddress: '0x123' }) },
          { address: AAVE_ADDRESS, chain: 'ethereum', docs: makeFakeDoc({ address: AAVE_ADDRESS, name: 'AAVE', totalFunctions: 25 }) },
        ],
      });

      expect(cache.size).toBe(3);
      expect(cache.lookup(WETH_ADDRESS, 'ethereum')!.contract.name).toBe('WETH9');
      expect(cache.lookup(USDC_ADDRESS, 'ethereum')!.contract.isProxy).toBe(true);
      expect(cache.lookup(AAVE_ADDRESS, 'ethereum')!.summary.totalFunctions).toBe(25);
    });

    it('handles same address on different chains', () => {
      const cache = new PrecomputedDocsCache({
        version: '1.0.0',
        generatedAt: '2026-03-17T00:00:00Z',
        entries: [
          { address: USDC_ADDRESS, chain: 'ethereum', docs: makeFakeDoc({ address: USDC_ADDRESS, name: 'USDC (Ethereum)' }) },
          { address: USDC_ADDRESS, chain: 'base', docs: makeFakeDoc({ address: USDC_ADDRESS, chain: 'base', name: 'USDC (Base)' }) },
        ],
      });

      expect(cache.size).toBe(2);
      expect(cache.lookup(USDC_ADDRESS, 'ethereum')!.contract.name).toBe('USDC (Ethereum)');
      expect(cache.lookup(USDC_ADDRESS, 'base')!.contract.name).toBe('USDC (Base)');
    });
  });

  describe('stats', () => {
    it('returns correct stats for populated cache', () => {
      const cache = new PrecomputedDocsCache({
        version: '1.0.0',
        generatedAt: '2026-03-17T00:00:00Z',
        entries: [
          { address: WETH_ADDRESS, chain: 'ethereum', docs: makeFakeDoc({ address: WETH_ADDRESS, name: 'WETH9' }) },
          { address: USDC_ADDRESS, chain: 'ethereum', docs: makeFakeDoc({ address: USDC_ADDRESS, name: 'USDC', isProxy: true, implementationAddress: '0x123' }) },
          { address: AAVE_ADDRESS, chain: 'ethereum', docs: makeFakeDoc({ address: AAVE_ADDRESS, name: 'AAVE' }) },
        ],
      });

      const stats = cache.getStats();
      expect(stats.totalCached).toBe(3);
      expect(stats.proxyResolved).toBe(1);
      expect(stats.direct).toBe(2);
      expect(stats.version).toBe('1.0.0');
    });

    it('returns zero stats for empty cache', () => {
      const cache = new PrecomputedDocsCache({
        version: '1.0.0',
        generatedAt: '2026-03-17T00:00:00Z',
        entries: [],
      });

      const stats = cache.getStats();
      expect(stats.totalCached).toBe(0);
      expect(stats.proxyResolved).toBe(0);
      expect(stats.direct).toBe(0);
    });
  });

  describe('entries listing', () => {
    it('lists all entries with summary info', () => {
      const cache = new PrecomputedDocsCache({
        version: '1.0.0',
        generatedAt: '2026-03-17T00:00:00Z',
        entries: [
          { address: WETH_ADDRESS, chain: 'ethereum', docs: makeFakeDoc({ address: WETH_ADDRESS, name: 'WETH9', totalFunctions: 9 }) },
          { address: USDC_ADDRESS, chain: 'ethereum', docs: makeFakeDoc({ address: USDC_ADDRESS, name: 'USDC', isProxy: true, implementationAddress: '0x123', totalFunctions: 35 }) },
        ],
      });

      const entries = cache.listEntries();
      expect(entries).toHaveLength(2);

      const weth = entries.find(e => e.name === 'WETH9');
      expect(weth).toBeDefined();
      expect(weth!.address).toBe(WETH_ADDRESS);
      expect(weth!.chain).toBe('ethereum');
      expect(weth!.functionCount).toBe(9);
      expect(weth!.isProxy).toBe(false);

      const usdc = entries.find(e => e.name === 'USDC');
      expect(usdc).toBeDefined();
      expect(usdc!.isProxy).toBe(true);
      expect(usdc!.functionCount).toBe(35);
    });
  });

  describe('getPrecomputedDocs singleton', () => {
    it('returns a PrecomputedDocsCache instance', async () => {
      const mod = await import('../../src/cache/precomputedDocs.js');
      const cache = mod.getPrecomputedDocs();
      expect(cache).toBeInstanceOf(mod.PrecomputedDocsCache);
      expect(typeof cache.lookup).toBe('function');
      expect(typeof cache.getStats).toBe('function');
      expect(typeof cache.size).toBe('number');
    });

    it('returns the same instance on repeated calls', async () => {
      const mod = await import('../../src/cache/precomputedDocs.js');
      const a = mod.getPrecomputedDocs();
      const b = mod.getPrecomputedDocs();
      expect(a).toBe(b);
    });
  });
});
