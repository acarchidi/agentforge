/**
 * Precomputed Contract Docs — static JSON cache loaded at cold start.
 *
 * Mirrors the pattern in src/registry/lookup.ts:
 * a JSON file is imported at module level, indexed into a Map for O(1)
 * lookups, and exposed via a singleton getter.
 *
 * The JSON file is generated offline by scripts/precomputeDocs.ts and
 * committed to the repo — no external KV store needed.
 */

import type { ContractDocsOutput } from '../schemas/contractDocs.js';
import precomputedData from './data/precomputed-docs.json' with { type: 'json' };

// ── Types ─────────────────────────────────────────────────────────────

export interface PrecomputedDocsEntry {
  address: string;
  chain: string;
  docs: ContractDocsOutput;
}

export interface PrecomputedDocsData {
  version: string;
  generatedAt: string;
  entries: PrecomputedDocsEntry[];
}

export interface PrecomputedDocsStats {
  totalCached: number;
  proxyResolved: number;
  direct: number;
  version: string;
  generatedAt: string;
}

export interface PrecomputedDocsSummary {
  address: string;
  chain: string;
  name: string;
  functionCount: number;
  isProxy: boolean;
}

// ── Cache Class ───────────────────────────────────────────────────────

export class PrecomputedDocsCache {
  /** chain:address → ContractDocsOutput */
  private readonly cache = new Map<string, ContractDocsOutput>();
  private readonly data: PrecomputedDocsData;

  constructor(data: PrecomputedDocsData) {
    this.data = data;
    for (const entry of data.entries) {
      const key = `${entry.chain}:${entry.address.toLowerCase()}`;
      this.cache.set(key, entry.docs);
    }
  }

  /** Number of cached contract docs. */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Look up precomputed docs by address + chain.
   * Returns null on cache miss (caller should fall through to live pipeline).
   */
  lookup(address: string, chain: string): ContractDocsOutput | null {
    const key = `${chain}:${address.toLowerCase()}`;
    return this.cache.get(key) ?? null;
  }

  /** Aggregate stats about the precomputed cache. */
  getStats(): PrecomputedDocsStats {
    let proxyResolved = 0;
    let direct = 0;

    for (const entry of this.data.entries) {
      if (entry.docs.contract.isProxy && entry.docs.contract.implementationAddress) {
        proxyResolved++;
      } else {
        direct++;
      }
    }

    return {
      totalCached: this.cache.size,
      proxyResolved,
      direct,
      version: this.data.version,
      generatedAt: this.data.generatedAt,
    };
  }

  /** List all cached entries with summary info (for reporting). */
  listEntries(): PrecomputedDocsSummary[] {
    return this.data.entries.map((entry) => ({
      address: entry.address,
      chain: entry.chain,
      name: entry.docs.contract.name ?? entry.address,
      functionCount: entry.docs.summary.totalFunctions,
      isProxy: entry.docs.contract.isProxy,
    }));
  }
}

// ── Singleton ─────────────────────────────────────────────────────────

let instance: PrecomputedDocsCache | null = null;

export function getPrecomputedDocs(): PrecomputedDocsCache {
  if (!instance) {
    instance = new PrecomputedDocsCache(precomputedData as unknown as PrecomputedDocsData);
  }
  return instance;
}

/**
 * Reset the singleton (for testing only).
 */
export function _resetPrecomputedDocs(): void {
  instance = null;
}
