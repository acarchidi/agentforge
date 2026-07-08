/**
 * Solana Token Risk Scan Cache — "trending" tokens.
 *
 * Mirrors tokenRiskMetricsCache.ts: a small static JSON seed loaded at cold
 * start (well-known tokens so the cache is never empty), plus in-memory
 * writes after each live computation so repeat/trending lookups on a warm
 * instance skip the full Helius + DexScreener + RPC pipeline.
 */

import type { SolanaTokenRiskScanOutput } from '../schemas/solanaTokenRiskScan.js';
import scanData from './data/solana-token-risk-scan.json' with { type: 'json' };

// ── Types ─────────────────────────────────────────────────────────────

export interface SolanaTokenRiskScanEntry {
  mint: string;
  scan: SolanaTokenRiskScanOutput;
}

export interface SolanaTokenRiskScanData {
  version: string;
  generatedAt: string;
  entries: SolanaTokenRiskScanEntry[];
}

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 min — mint/freeze authority rarely changes, but liquidity does

// ── Cache Class ───────────────────────────────────────────────────────

export class SolanaTokenRiskScanCache {
  private readonly cache = new Map<string, { scan: SolanaTokenRiskScanOutput; cachedAt: number }>();
  private readonly data: SolanaTokenRiskScanData;

  constructor(data: SolanaTokenRiskScanData) {
    this.data = data;
    const now = Date.now();
    for (const entry of data.entries) {
      this.cache.set(entry.mint, { scan: entry.scan, cachedAt: now });
    }
  }

  get size(): number {
    return this.cache.size;
  }

  /** Returns null on cache miss or expiry — caller falls through to the live pipeline. */
  lookup(mint: string): SolanaTokenRiskScanOutput | null {
    const hit = this.cache.get(mint);
    if (!hit) return null;
    if (Date.now() - hit.cachedAt > CACHE_TTL_MS) {
      this.cache.delete(mint);
      return null;
    }
    return {
      ...hit.scan,
      source: 'cached',
      stalenessSec: Math.floor((Date.now() - hit.cachedAt) / 1000),
    };
  }

  /** Stores a freshly-computed scan (used after live computation, for trending-token memoization). */
  set(mint: string, scan: SolanaTokenRiskScanOutput): void {
    this.cache.set(mint, { scan, cachedAt: Date.now() });
  }

  getStats() {
    return {
      totalCached: this.cache.size,
      seedVersion: this.data.version,
      seedGeneratedAt: this.data.generatedAt,
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────

let instance: SolanaTokenRiskScanCache | null = null;

export function getSolanaTokenRiskScanCache(): SolanaTokenRiskScanCache {
  if (!instance) {
    instance = new SolanaTokenRiskScanCache(scanData as unknown as SolanaTokenRiskScanData);
  }
  return instance;
}

/** Reset the singleton (for testing only). */
export function _resetSolanaTokenRiskScanCache(): void {
  instance = null;
}
