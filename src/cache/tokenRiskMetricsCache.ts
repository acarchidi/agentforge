/**
 * Token Risk Metrics Cache — static JSON loaded at cold start.
 *
 * Follows the same pattern as precomputedDocs.ts:
 * imports a committed JSON file, indexes entries for O(1) lookup,
 * and exposes a singleton getter.
 */

import type { TokenRiskMetricsOutput } from '../schemas/tokenRiskMetrics.js';
import metricsData from './data/token-risk-metrics.json' with { type: 'json' };

// ── Types ─────────────────────────────────────────────────────────────

export interface TokenRiskMetricsEntry {
  address: string;
  chain: string;
  metrics: TokenRiskMetricsOutput;
}

export interface TokenRiskMetricsData {
  version: string;
  generatedAt: string;
  entries: TokenRiskMetricsEntry[];
}

// ── Cache Class ───────────────────────────────────────────────────────

export class TokenRiskMetricsCache {
  /** chain:address → TokenRiskMetricsOutput */
  private readonly cache = new Map<string, TokenRiskMetricsOutput>();
  private readonly data: TokenRiskMetricsData;

  constructor(data: TokenRiskMetricsData) {
    this.data = data;
    for (const entry of data.entries) {
      const key = `${entry.chain}:${entry.address.toLowerCase()}`;
      this.cache.set(key, entry.metrics);
    }
  }

  get size(): number {
    return this.cache.size;
  }

  /**
   * Look up pre-computed metrics by address + chain.
   * Returns null on cache miss (caller should fall through to live pipeline).
   */
  lookup(address: string, chain: string): TokenRiskMetricsOutput | null {
    const key = `${chain}:${address.toLowerCase()}`;
    return this.cache.get(key) ?? null;
  }

  /** Add or replace an entry (used after live computation). */
  set(address: string, chain: string, metrics: TokenRiskMetricsOutput): void {
    const key = `${chain}:${address.toLowerCase()}`;
    this.cache.set(key, metrics);
  }

  getStats() {
    return {
      totalCached: this.cache.size,
      generatedAt: this.data.generatedAt,
      version: this.data.version,
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────

let instance: TokenRiskMetricsCache | null = null;

export function getTokenRiskMetricsCache(): TokenRiskMetricsCache {
  if (!instance) {
    instance = new TokenRiskMetricsCache(metricsData as unknown as TokenRiskMetricsData);
  }
  return instance;
}

/** Reset the singleton (for testing only). */
export function _resetTokenRiskMetricsCache(): void {
  instance = null;
}
