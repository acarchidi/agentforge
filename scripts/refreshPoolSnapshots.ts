#!/usr/bin/env tsx
/**
 * Pool Snapshots Refresh Script
 *
 * Usage: npx tsx scripts/refreshPoolSnapshots.ts
 *
 * Fetches top 500 liquidity pools from DeFi Llama yields API and writes to
 * src/cache/data/pool-snapshots.json for commit.
 *
 * Run this manually or hook it up as a Vercel cron job (every 15 minutes):
 *   https://vercel.com/docs/cron-jobs
 */

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchLivePools, mapLlamaPool, filterTopByTvl } from '../src/services/poolSnapshotRefresh.js';
import { getRegistry } from '../src/registry/lookup.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '../src/cache/data/pool-snapshots.json');

async function main() {
  console.log('🌊 Pool Snapshots Refresh');
  console.log('========================');
  console.log(`Fetching from DeFi Llama yields API...`);

  const startTime = Date.now();

  let snapshotData;
  try {
    snapshotData = await fetchLivePools(30_000); // 30 second timeout for script
  } catch (err) {
    console.error('❌ Failed to fetch from DeFi Llama:', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  const elapsedMs = Date.now() - startTime;
  console.log(`✅ Fetched ${snapshotData.totalFetched} pools in ${elapsedMs}ms`);
  console.log(`📊 Keeping top ${snapshotData.pools.length} by TVL`);

  // Stats
  const registry = getRegistry();
  const chains = new Map<string, number>();
  const protocols = new Map<string, number>();
  let registryMatches = 0;
  let stablecoinPools = 0;
  let ilNone = 0, ilLow = 0, ilMedium = 0, ilHigh = 0;

  for (const pool of snapshotData.pools) {
    // Chain stats
    chains.set(pool.chain, (chains.get(pool.chain) ?? 0) + 1);
    // Protocol stats
    protocols.set(pool.protocol, (protocols.get(pool.protocol) ?? 0) + 1);
    // Registry match
    if (pool.address && registry.lookup(pool.address, pool.chain)) registryMatches++;
    // Stablecoin
    if (pool.stablecoin) stablecoinPools++;
    // IL risk
    switch (pool.ilRisk) {
      case 'none': ilNone++; break;
      case 'low': ilLow++; break;
      case 'medium': ilMedium++; break;
      case 'high': ilHigh++; break;
    }
  }

  // Sort chains and protocols by count
  const topChains = [...chains.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const topProtocols = [...protocols.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

  console.log('\n📋 Stats:');
  console.log(`  Total TVL: $${(snapshotData.pools.reduce((s, p) => s + p.tvlUsd, 0) / 1e9).toFixed(2)}B`);
  console.log(`  Registry matches: ${registryMatches}`);
  console.log(`  Stablecoin pools: ${stablecoinPools}`);
  console.log(`  IL Risk — none:${ilNone} low:${ilLow} medium:${ilMedium} high:${ilHigh}`);

  console.log('\n🔗 Top chains:');
  for (const [chain, count] of topChains) {
    console.log(`  ${chain}: ${count}`);
  }

  console.log('\n🏗️  Top protocols:');
  for (const [protocol, count] of topProtocols) {
    console.log(`  ${protocol}: ${count}`);
  }

  // Preview top 5 pools
  console.log('\n🏆 Top 5 pools by TVL:');
  for (const pool of snapshotData.pools.slice(0, 5)) {
    console.log(`  [${pool.chain}] ${pool.symbol} (${pool.protocol}) — $${(pool.tvlUsd / 1e6).toFixed(1)}M TVL, ${pool.apy.toFixed(2)}% APY`);
  }

  // Write JSON
  writeFileSync(OUTPUT_PATH, JSON.stringify(snapshotData, null, 2));
  console.log(`\n✅ Written to ${OUTPUT_PATH}`);
  console.log(`   Timestamp: ${snapshotData.generatedAt}`);
  console.log(`   Pools: ${snapshotData.pools.length}`);
  console.log('\nDone! Commit pool-snapshots.json to deploy fresh data.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
