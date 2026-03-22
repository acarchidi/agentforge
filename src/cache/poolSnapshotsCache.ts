/**
 * Pool Snapshots Cache — static JSON loaded at cold start, updatable on live refresh.
 *
 * Mirrors the pattern in src/cache/precomputedDocs.ts:
 * a JSON file is imported at module level and exposed via a singleton getter.
 * Unlike precomputedDocs, this cache supports in-memory updates when a live
 * refresh is triggered for stale data.
 */

import type { Pool } from '../schemas/poolSnapshots.js';
import snapshotData from './data/pool-snapshots.json' with { type: 'json' };

// ── Types ─────────────────────────────────────────────────────────────

export interface PoolSnapshotData {
  version: string;
  generatedAt: string;
  totalFetched: number;
  pools: Pool[];
}

// ── Cache Class ───────────────────────────────────────────────────────

export class PoolSnapshotsCache {
  private data: PoolSnapshotData;

  constructor(data: PoolSnapshotData) {
    this.data = data;
  }

  get generatedAt(): string {
    return this.data.generatedAt;
  }

  get totalPools(): number {
    return this.data.pools.length;
  }

  getAllPools(): Pool[] {
    return this.data.pools;
  }

  /** Replace in-memory data with a live-refreshed snapshot. */
  update(newData: PoolSnapshotData): void {
    this.data = newData;
  }

  /** Seconds elapsed since snapshot was generated. */
  getStalenessSeconds(): number {
    const generatedMs = new Date(this.data.generatedAt).getTime();
    return Math.floor((Date.now() - generatedMs) / 1000);
  }

  /** Returns true if data is older than thresholdSec seconds. */
  isStale(thresholdSec: number): boolean {
    return this.getStalenessSeconds() > thresholdSec;
  }

  /**
   * Filter pools by optional criteria, then sort and paginate.
   * @param filters  - optional protocol/chain/token/pool filters
   * @param sortBy   - field to sort by (default: 'tvl')
   * @param order    - 'asc' | 'desc' (default: 'desc')
   * @param limit    - max results (default: all — pagination handled by caller)
   * @param offset   - skip N results (default: 0)
   */
  filter(
    filters: {
      pool?: string;
      protocol?: string;
      chain?: string;
      token?: string;
    },
    sortBy: 'tvl' | 'apy' | 'volume' = 'tvl',
    order: 'asc' | 'desc' = 'desc',
    limit?: number,
    offset?: number,
  ): Pool[] {
    let results = this.data.pools;

    // Filter by pool id or address
    if (filters.pool) {
      const q = filters.pool.toLowerCase();
      results = results.filter(
        (p) => p.id.toLowerCase() === q || (p.address?.toLowerCase() === q),
      );
    }

    // Filter by protocol
    if (filters.protocol) {
      const q = filters.protocol.toLowerCase();
      results = results.filter((p) => p.protocol.toLowerCase().includes(q));
    }

    // Filter by chain
    if (filters.chain) {
      const q = filters.chain.toLowerCase();
      results = results.filter((p) => p.chain.toLowerCase() === q);
    }

    // Filter by token (partial match on symbol or tokens array)
    if (filters.token) {
      const q = filters.token.toUpperCase();
      results = results.filter(
        (p) => p.tokens.some((t) => t.toUpperCase().includes(q)) || p.symbol.toUpperCase().includes(q),
      );
    }

    // Sort
    const dir = order === 'desc' ? -1 : 1;
    results = [...results].sort((a, b) => {
      switch (sortBy) {
        case 'apy':
          return ((a.apy ?? 0) - (b.apy ?? 0)) * dir;
        case 'volume':
          return ((a.volume24hUsd ?? 0) - (b.volume24hUsd ?? 0)) * dir;
        default: // 'tvl'
          return ((a.tvlUsd ?? 0) - (b.tvlUsd ?? 0)) * dir;
      }
    });

    // Paginate
    const start = offset ?? 0;
    const end = limit !== undefined ? start + limit : results.length;
    return results.slice(start, end);
  }

  getStats() {
    return {
      totalPools: this.data.pools.length,
      generatedAt: this.data.generatedAt,
      version: this.data.version,
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────

let instance: PoolSnapshotsCache | null = null;

export function getPoolSnapshotsCache(): PoolSnapshotsCache {
  if (!instance) {
    instance = new PoolSnapshotsCache(snapshotData as unknown as PoolSnapshotData);
  }
  return instance;
}

/** Reset the singleton (for testing only). */
export function _resetPoolSnapshotsCache(): void {
  instance = null;
}
