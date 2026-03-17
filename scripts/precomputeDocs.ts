#!/usr/bin/env tsx
/**
 * Pre-Compute Contract Docs — Stage 1
 *
 * Generates contract documentation for high-value contracts from the
 * registry and stores results in the CacheStore. On subsequent paid
 * requests for these contracts, the cached result is returned instantly
 * at zero LLM cost.
 *
 * Usage:
 *   npm run precompute:docs
 *   npm run precompute:docs -- --limit 5
 *   npm run precompute:docs -- --sample 3
 */

import dotenv from 'dotenv';
dotenv.config();

import { getRegistry } from '../src/registry/lookup.js';
import { contractDocsWithCost } from '../src/services/contractDocs.js';
import { getCacheStore } from '../src/cache/store.js';
import type { ContractLabel } from '../src/registry/types.js';

// ── CLI args ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name: string, defaultVal: number): number {
  const idx = args.indexOf(`--${name}`);
  if (idx >= 0 && args[idx + 1]) return Number(args[idx + 1]);
  return defaultVal;
}

const LIMIT = getArg('limit', 10);
const SAMPLE_COUNT = getArg('sample', 3);

// ── Priority scoring ─────────────────────────────────────────────────

/**
 * Score a registry entry for pre-computation priority.
 * Higher score = more valuable to pre-compute.
 */
function priorityScore(entry: ContractLabel): number {
  let score = 0;

  // Prefer ethereum (most queried chain)
  if (entry.chain === 'ethereum') score += 10;
  else if (entry.chain === 'base') score += 5;
  else score += 2;

  // Prefer well-known categories
  const highValueCats = ['dex', 'lending', 'stablecoin', 'liquid-staking', 'bridge'];
  if (entry.category && highValueCats.includes(entry.category)) score += 8;

  // Prefer entries with known protocols
  if (entry.protocol) score += 3;

  // Prefer safe contracts (more likely to be queried)
  if (entry.riskLevel === 'safe') score += 4;
  else if (entry.riskLevel === 'low') score += 2;

  // Manual entries are hand-curated — higher quality
  if (entry.source === 'manual') score += 5;

  return score;
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║      Contract Docs Pre-Compute — Stage 1               ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log();

  const registry = getRegistry();
  const stats = registry.getStats();
  console.log(`  Registry: ${stats.totalEntries} entries across ${stats.chains.length} chains`);

  // Get all ethereum entries (most likely to be verified on Etherscan)
  const allEntries = registry.getByCategory('dex')
    .concat(registry.getByCategory('lending'))
    .concat(registry.getByCategory('stablecoin'))
    .concat(registry.getByCategory('liquid-staking'))
    .concat(registry.getByCategory('bridge'))
    .concat(registry.getByCategory('token'))
    .concat(registry.getByCategory('governance'))
    .concat(registry.getByCategory('derivatives'));

  // Deduplicate by address+chain
  const seen = new Set<string>();
  const unique: ContractLabel[] = [];
  for (const entry of allEntries) {
    const key = `${entry.address}:${entry.chain}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(entry);
    }
  }

  // Sort by priority score (descending)
  const sorted = unique.sort((a, b) => priorityScore(b) - priorityScore(a));
  const targets = sorted.slice(0, LIMIT);

  console.log(`  Selected ${targets.length} high-value contracts (limit: ${LIMIT})`);
  console.log();

  const cache = getCacheStore();
  const results: Array<{
    address: string;
    chain: string;
    name: string;
    status: 'computed' | 'cached' | 'failed';
    timeMs: number;
    costUsd: number;
    output?: unknown;
    error?: string;
  }> = [];

  for (let i = 0; i < targets.length; i++) {
    const entry = targets[i];
    const label = `[${i + 1}/${targets.length}]`;
    const cacheKey = `docs:${entry.chain}:${entry.address}`;

    // Check if already cached
    const existing = await cache.has(cacheKey);
    if (existing) {
      console.log(`  ${label} ✓ CACHED  ${entry.name} (${entry.chain})`);
      results.push({
        address: entry.address,
        chain: entry.chain,
        name: entry.name,
        status: 'cached',
        timeMs: 0,
        costUsd: 0,
      });
      continue;
    }

    process.stdout.write(`  ${label} ⏳ Computing ${entry.name} (${entry.chain})...`);
    const start = Date.now();

    try {
      const result = await contractDocsWithCost({
        address: entry.address,
        chain: entry.chain as 'ethereum' | 'base' | 'polygon' | 'arbitrum' | 'optimism' | 'avalanche',
      });

      const elapsed = Date.now() - start;
      const isVerified = result.output.contract.isVerified;

      if (!isVerified) {
        console.log(` unverified (${elapsed}ms)`);
        results.push({
          address: entry.address,
          chain: entry.chain,
          name: entry.name,
          status: 'failed',
          timeMs: elapsed,
          costUsd: 0,
          error: 'Contract not verified on Etherscan',
        });
      } else {
        console.log(` ✓ ${result.output.summary.totalFunctions} functions (${elapsed}ms, $${result.estimatedCostUsd.toFixed(4)})`);
        results.push({
          address: entry.address,
          chain: entry.chain,
          name: entry.name,
          status: 'computed',
          timeMs: elapsed,
          costUsd: result.estimatedCostUsd,
          output: result.output,
        });
      }
    } catch (error) {
      const elapsed = Date.now() - start;
      const msg = error instanceof Error ? error.message : String(error);
      console.log(` ✗ FAILED (${elapsed}ms): ${msg.slice(0, 80)}`);
      results.push({
        address: entry.address,
        chain: entry.chain,
        name: entry.name,
        status: 'failed',
        timeMs: elapsed,
        costUsd: 0,
        error: msg,
      });
    }

    // Rate limit — don't hammer Etherscan
    if (i < targets.length - 1) {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────

  console.log();
  console.log('════════════════════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('════════════════════════════════════════════════════════════');

  const computed = results.filter((r) => r.status === 'computed');
  const cached = results.filter((r) => r.status === 'cached');
  const failed = results.filter((r) => r.status === 'failed');
  const totalCost = results.reduce((sum, r) => sum + r.costUsd, 0);
  const totalTime = results.reduce((sum, r) => sum + r.timeMs, 0);

  console.log(`  Computed:  ${computed.length}`);
  console.log(`  Cached:    ${cached.length}`);
  console.log(`  Failed:    ${failed.length}`);
  console.log(`  Total cost: $${totalCost.toFixed(4)}`);
  console.log(`  Total time: ${(totalTime / 1000).toFixed(1)}s`);

  if (failed.length > 0) {
    console.log();
    console.log('  Failed contracts:');
    for (const f of failed) {
      console.log(`    - ${f.name} (${f.chain}): ${f.error}`);
    }
  }

  // ── Sample outputs ──────────────────────────────────────────────────

  const sampleOutputs = computed.slice(0, SAMPLE_COUNT);
  if (sampleOutputs.length > 0) {
    console.log();
    console.log('════════════════════════════════════════════════════════════');
    console.log(`  SAMPLE OUTPUTS (${sampleOutputs.length} of ${computed.length} computed)`);
    console.log('════════════════════════════════════════════════════════════');

    for (const sample of sampleOutputs) {
      console.log();
      console.log(`──── ${sample.name} (${sample.chain}) ────`);
      console.log(JSON.stringify(sample.output, null, 2));
    }
  }

  // ── Cache stats ─────────────────────────────────────────────────────

  console.log();
  const cacheStats = await cache.stats();
  console.log(`  Cache: ${cacheStats.totalKeys} keys, backend=${cacheStats.backend}`);
  console.log();
}

main().catch((err) => {
  console.error('Pre-compute failed:', err);
  process.exit(1);
});
