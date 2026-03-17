import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Type-only imports for assertions ──────────────────────────────────
import type { CacheStore, CacheStats } from '../../src/cache/store.js';

describe('CacheStore', () => {
  // ── MemoryCacheStore ────────────────────────────────────────────────

  describe('MemoryCacheStore', () => {
    let store: CacheStore;

    beforeEach(async () => {
      const mod = await import('../../src/cache/store.js');
      store = new mod.MemoryCacheStore();
    });

    it('returns null for missing key', async () => {
      const result = await store.get('nonexistent');
      expect(result).toBeNull();
    });

    it('stores and retrieves a value', async () => {
      await store.set('key1', { hello: 'world' });
      const result = await store.get('key1');
      expect(result).toEqual({ hello: 'world' });
    });

    it('stores and retrieves a string value', async () => {
      await store.set('str', 'just a string');
      expect(await store.get('str')).toBe('just a string');
    });

    it('stores and retrieves a complex object', async () => {
      const complex = {
        contract: { address: '0xabc', chain: 'ethereum' },
        functions: [{ name: 'transfer', riskFlags: ['can_transfer_funds'] }],
        summary: { totalFunctions: 5 },
      };
      await store.set('complex', complex);
      expect(await store.get('complex')).toEqual(complex);
    });

    it('overwrites existing key', async () => {
      await store.set('key', 'first');
      await store.set('key', 'second');
      expect(await store.get('key')).toBe('second');
    });

    it('deletes a key', async () => {
      await store.set('key', 'value');
      await store.delete('key');
      expect(await store.get('key')).toBeNull();
    });

    it('delete on missing key does not throw', async () => {
      await expect(store.delete('nope')).resolves.not.toThrow();
    });

    it('has() returns true for existing key', async () => {
      await store.set('exists', 42);
      expect(await store.has('exists')).toBe(true);
    });

    it('has() returns false for missing key', async () => {
      expect(await store.has('nope')).toBe(false);
    });

    it('respects TTL — expired entries return null', async () => {
      vi.useFakeTimers();
      try {
        await store.set('ttl-key', 'alive', 10); // 10-second TTL
        expect(await store.get('ttl-key')).toBe('alive');

        // Advance 11 seconds
        vi.advanceTimersByTime(11_000);
        expect(await store.get('ttl-key')).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('has() returns false for expired key', async () => {
      vi.useFakeTimers();
      try {
        await store.set('ttl-key', 'alive', 5);
        vi.advanceTimersByTime(6_000);
        expect(await store.has('ttl-key')).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('uses default TTL when none specified', async () => {
      vi.useFakeTimers();
      try {
        // Default TTL is 86400 (24 hours)
        await store.set('default-ttl', 'value');
        // Still alive after 23 hours
        vi.advanceTimersByTime(23 * 60 * 60 * 1000);
        expect(await store.get('default-ttl')).toBe('value');
        // Gone after 25 hours
        vi.advanceTimersByTime(2 * 60 * 60 * 1000);
        expect(await store.get('default-ttl')).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('returns correct stats', async () => {
      await store.set('a', 1);
      await store.set('b', 2);
      await store.set('c', 3);

      const stats = await store.stats();
      expect(stats.totalKeys).toBe(3);
      expect(stats.backend).toBe('memory');
    });

    it('stats reflect deletes', async () => {
      await store.set('a', 1);
      await store.set('b', 2);
      await store.delete('a');

      const stats = await store.stats();
      expect(stats.totalKeys).toBe(1);
    });

    it('stats exclude expired entries', async () => {
      vi.useFakeTimers();
      try {
        await store.set('short', 'val', 5);
        await store.set('long', 'val', 3600);

        vi.advanceTimersByTime(6_000);
        const stats = await store.stats();
        expect(stats.totalKeys).toBe(1); // only 'long' remains
      } finally {
        vi.useRealTimers();
      }
    });

    it('tracks hit count', async () => {
      await store.set('popular', 'data');
      await store.get('popular');
      await store.get('popular');
      await store.get('popular');

      const stats = await store.stats();
      expect(stats.hits).toBe(3);
    });

    it('tracks miss count', async () => {
      await store.get('nope1');
      await store.get('nope2');

      const stats = await store.stats();
      expect(stats.misses).toBe(2);
    });

    it('tracks hits vs misses together', async () => {
      await store.set('exists', 'yes');
      await store.get('exists'); // hit
      await store.get('nope');   // miss
      await store.get('exists'); // hit

      const stats = await store.stats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
    });

    it('lists keys matching a prefix', async () => {
      await store.set('docs:ethereum:0xabc', 'doc1');
      await store.set('docs:ethereum:0xdef', 'doc2');
      await store.set('other:key', 'val');

      const keys = await store.keys('docs:');
      expect(keys).toHaveLength(2);
      expect(keys).toContain('docs:ethereum:0xabc');
      expect(keys).toContain('docs:ethereum:0xdef');
    });

    it('keys() returns empty array for no matches', async () => {
      await store.set('foo', 1);
      const keys = await store.keys('bar:');
      expect(keys).toHaveLength(0);
    });

    it('keys() excludes expired entries', async () => {
      vi.useFakeTimers();
      try {
        await store.set('docs:a', 'val', 5);
        await store.set('docs:b', 'val', 3600);
        vi.advanceTimersByTime(6_000);
        const keys = await store.keys('docs:');
        expect(keys).toHaveLength(1);
        expect(keys[0]).toBe('docs:b');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // ── createCacheStore factory ────────────────────────────────────────

  describe('createCacheStore', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('returns MemoryCacheStore when no KV credentials', async () => {
      delete process.env.KV_REST_API_URL;
      delete process.env.KV_REST_API_TOKEN;

      // Re-import to get fresh factory
      const mod = await import('../../src/cache/store.js');
      const store = mod.createCacheStore();
      const stats = await store.stats();
      expect(stats.backend).toBe('memory');
    });

    it('logs warning when KV credentials are missing', async () => {
      delete process.env.KV_REST_API_URL;
      delete process.env.KV_REST_API_TOKEN;

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const mod = await import('../../src/cache/store.js');
        mod.createCacheStore();
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('KV credentials missing'),
        );
      } finally {
        warnSpy.mockRestore();
      }
    });
  });

  // ── getCacheStore singleton ─────────────────────────────────────────

  describe('getCacheStore', () => {
    it('returns a CacheStore instance', async () => {
      const mod = await import('../../src/cache/store.js');
      const store = mod.getCacheStore();
      expect(store).toBeDefined();
      expect(typeof store.get).toBe('function');
      expect(typeof store.set).toBe('function');
      expect(typeof store.delete).toBe('function');
      expect(typeof store.has).toBe('function');
      expect(typeof store.stats).toBe('function');
      expect(typeof store.keys).toBe('function');
    });

    it('returns the same instance on repeated calls', async () => {
      const mod = await import('../../src/cache/store.js');
      const a = mod.getCacheStore();
      const b = mod.getCacheStore();
      expect(a).toBe(b);
    });
  });

  // ── CacheStats shape ───────────────────────────────────────────────

  describe('CacheStats shape', () => {
    it('has all required fields', async () => {
      const mod = await import('../../src/cache/store.js');
      const store = new mod.MemoryCacheStore();
      const stats: CacheStats = await store.stats();

      expect(typeof stats.totalKeys).toBe('number');
      expect(typeof stats.hits).toBe('number');
      expect(typeof stats.misses).toBe('number');
      expect(typeof stats.backend).toBe('string');
      expect(['memory', 'kv']).toContain(stats.backend);
    });
  });
});
