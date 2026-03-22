#!/usr/bin/env tsx
/**
 * Token Risk Metrics Pre-compute Script
 *
 * Usage:
 *   npx tsx scripts/refreshTokenRiskMetrics.ts --limit 50
 *   npx tsx scripts/refreshTokenRiskMetrics.ts --limit 200 --resume 0xabc123
 *
 * Pre-computes risk metrics for top tokens in the registry.
 * Reuses ABI data from contract-docs cache where available.
 *
 * Rate limiting: 3 calls/sec to Etherscan (conservative)
 * Expected: ~2 seconds per token, ~2 min for 50 tokens
 *
 * Staged rollout:
 *   Stage 1: --limit 50 (review output quality before continuing)
 *   Stage 2: --limit 200 --resume <last_address>
 */

import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '../src/cache/data/token-risk-metrics.json');

// Parse CLI args
const { values: args } = parseArgs({
  options: {
    limit: { type: 'string', default: '50' },
    resume: { type: 'string' },
  },
  strict: false,
});

const LIMIT = parseInt(args.limit ?? '50', 10);
const RESUME_FROM = args.resume as string | undefined;

// Etherscan
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY;
const RATE_LIMIT_MS = 350; // ~3 calls/sec conservative

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function etherscanFetch(params: Record<string, string>): Promise<unknown> {
  const searchParams = new URLSearchParams({
    chainid: '1', // Ethereum mainnet for now
    ...params,
    ...(ETHERSCAN_API_KEY ? { apikey: ETHERSCAN_API_KEY } : {}),
  });

  const res = await fetch(`https://api.etherscan.io/v2/api?${searchParams.toString()}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Etherscan ${res.status}`);

  const data = (await res.json()) as { status: string; result: unknown };
  if (data.status === '0') throw new Error(`Etherscan error: ${JSON.stringify(data.result)}`);
  return data.result;
}

async function fetchHolders(address: string) {
  await sleep(RATE_LIMIT_MS);
  try {
    return await etherscanFetch({
      module: 'token',
      action: 'tokenholderlist',
      contractaddress: address,
      page: '1',
      offset: '10',
    }) as Array<{ TokenHolderAddress: string; TokenHolderQuantity: string }>;
  } catch (e) {
    console.warn(`    ⚠ Holders fetch failed: ${e instanceof Error ? e.message : e}`);
    return [];
  }
}

async function fetchTotalSupply(address: string): Promise<bigint> {
  await sleep(RATE_LIMIT_MS);
  try {
    const raw = await etherscanFetch({
      module: 'stats',
      action: 'tokensupply',
      contractaddress: address,
    }) as string;
    return BigInt(raw ?? '0');
  } catch {
    return 0n;
  }
}

async function fetchAbi(address: string): Promise<unknown[]> {
  await sleep(RATE_LIMIT_MS);
  try {
    const raw = await etherscanFetch({
      module: 'contract',
      action: 'getabi',
      address,
    }) as string;
    if (typeof raw === 'string' && raw.startsWith('[')) return JSON.parse(raw);
    return [];
  } catch {
    return [];
  }
}

async function fetchDeployer(address: string): Promise<string | undefined> {
  await sleep(RATE_LIMIT_MS);
  try {
    const raw = await etherscanFetch({
      module: 'contract',
      action: 'getcontractcreation',
      contractaddresses: address,
    }) as Array<{ contractCreator: string }>;
    return raw?.[0]?.contractCreator?.toLowerCase();
  } catch {
    return undefined;
  }
}

async function main() {
  console.log('🔬 Token Risk Metrics Pre-compute');
  console.log('==================================');
  console.log(`Limit: ${LIMIT} | Resume: ${RESUME_FROM ?? 'none'}`);

  // Dynamically import the modules we need after env is set
  const { getRegistry } = await import('../src/registry/lookup.js');
  const { getPrecomputedDocs } = await import('../src/cache/precomputedDocs.js');
  const { getPoolSnapshotsCache } = await import('../src/cache/poolSnapshotsCache.js');
  const { detectPermissions, scorePermissionRisk } = await import('../src/services/tokenRiskMetrics/permissions.js');
  const { parseHolderList, computeHolderPct, computeConcentrationRisk } = await import('../src/services/tokenRiskMetrics/concentration.js');
  const { scoreLiquidityRisk, computeLiquidityRatio } = await import('../src/services/tokenRiskMetrics/liquidity.js');
  const { computeCompositeScore } = await import('../src/services/tokenRiskMetrics/composite.js');
  const { shouldResumeFrom, computeStage } = await import('../src/services/tokenRiskMetrics/refresh.js');
  const { tokenRiskMetricsOutput } = await import('../src/schemas/tokenRiskMetrics.js');

  const registry = getRegistry();
  const precomputed = getPrecomputedDocs();
  const poolsCache = getPoolSnapshotsCache();

  // Get token addresses from registry
  const allEntries = registry.getStats();
  console.log(`Registry has ${allEntries.totalEntries} entries`);

  // Get all token-category entries (or all entries with addresses)
  const stats = registry.getStats();
  console.log(`Registry stats: ${JSON.stringify(stats)}`);

  // We need addresses from the registry — get them via a different approach
  // Since getByCategory may not be available for all categories, we'll use
  // the precomputed docs entries as our source of truth
  const precomputedList = precomputed.listEntries();
  let addresses = precomputedList.map((e) => e.address);
  console.log(`Found ${addresses.length} addresses from precomputed-docs cache`);

  // Resume support
  if (RESUME_FROM) {
    addresses = shouldResumeFrom(addresses, RESUME_FROM);
    console.log(`Resuming from ${RESUME_FROM} — ${addresses.length} addresses remaining`);
  }

  // Apply limit
  addresses = computeStage(addresses, LIMIT);
  console.log(`Processing ${addresses.length} addresses (limit: ${LIMIT})`);

  // Load existing output if present
  let existingEntries: unknown[] = [];
  if (existsSync(OUTPUT_PATH)) {
    try {
      const existing = JSON.parse(readFileSync(OUTPUT_PATH, 'utf-8'));
      existingEntries = existing.entries ?? [];
      console.log(`Loaded ${existingEntries.length} existing entries`);
    } catch {
      existingEntries = [];
    }
  }

  const newEntries: unknown[] = [];
  let processed = 0;
  let errored = 0;

  for (const address of addresses) {
    const precomputedDoc = precomputed.lookup(address, 'ethereum');
    const chain = 'ethereum';

    console.log(`\n[${processed + 1}/${addresses.length}] ${address}`);

    try {
      const computedAt = new Date().toISOString();

      // ABI — reuse precomputed docs
      let abi: Array<{ name: string; type: string; stateMutability?: string }> = [];
      let isProxy = false;

      if (precomputedDoc) {
        isProxy = precomputedDoc.contract.isProxy;
        abi = precomputedDoc.functions.map((fn) => ({
          name: fn.name,
          type: 'function',
          stateMutability: fn.type === 'read' ? 'view' : 'nonpayable',
        }));
        console.log(`  ✓ ABI from precomputed docs (${abi.length} functions)`);
      } else {
        abi = await fetchAbi(address) as typeof abi;
        console.log(`  ✓ ABI from Etherscan (${abi.length} functions)`);
      }

      // Holders + supply
      const [holderRaw, totalSupply, deployerAddress] = await Promise.all([
        fetchHolders(address),
        fetchTotalSupply(address),
        fetchDeployer(address),
      ]);

      console.log(`  ✓ ${holderRaw.length} holders, supply: ${totalSupply}, deployer: ${deployerAddress ?? 'unknown'}`);

      // Permissions
      const permFlags = detectPermissions(abi as any, { canUpgrade: isProxy });
      const permissionRisk = scorePermissionRisk(permFlags);

      // Concentration
      const holders = parseHolderList(holderRaw).map((h) => ({
        ...h,
        pct: totalSupply > 0n ? computeHolderPct(h.rawBalance, totalSupply) : 0,
      }));
      const concentrationResult = computeConcentrationRisk(holders, totalSupply, registry);

      // Liquidity from pool snapshots
      const allPools = poolsCache.getAllPools();
      const tokenPools = allPools
        .filter((p) => p.address?.toLowerCase() === address.toLowerCase())
        .sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0));
      const totalLiquidityUsd = tokenPools.reduce((s, p) => s + (p.tvlUsd ?? 0), 0) || undefined;
      const liquidityRatio = computeLiquidityRatio(totalLiquidityUsd, undefined);
      const liquidityRisk = scoreLiquidityRisk(liquidityRatio);
      const topPools = tokenPools.slice(0, 5).map((p) => ({ dex: p.protocol, pair: p.symbol, tvlUsd: p.tvlUsd }));

      // Deployer
      const deployerEntry = deployerAddress ? registry.lookup(deployerAddress) : null;
      const deployerRisk = deployerEntry ? 'low' : (deployerAddress ? 'unknown' : 'unknown');

      // Composite
      const composite = computeCompositeScore({
        concentrationRisk: concentrationResult.concentrationRisk,
        liquidityRisk,
        permissionRisk,
        deployerRisk: deployerRisk as any,
        top10HolderPct: concentrationResult.top10HolderPct,
        canMint: permFlags.canMint,
        canBlacklist: permFlags.canBlacklist,
        canPause: permFlags.canPause,
        liquidityToMcapRatio: liquidityRatio,
      });

      const metrics = {
        address,
        chain,
        symbol: precomputedDoc?.contract.name,
        source: 'cached' as const,
        computedAt,
        stalenessSec: 0,
        holders: concentrationResult,
        liquidity: {
          totalLiquidityUsd,
          liquidityToMcapRatio: liquidityRatio,
          liquidityRisk,
          topPools: topPools.length > 0 ? topPools : undefined,
        },
        permissions: { ...permFlags, permissionRisk },
        deployer: {
          address: deployerAddress,
          label: deployerEntry?.name,
          deployerRisk: deployerRisk as any,
        },
        overallRisk: composite,
        relatedServices: [],
      };

      // Validate against schema
      tokenRiskMetricsOutput.parse(metrics);

      newEntries.push({ address, chain, metrics });
      console.log(`  ✅ Risk: ${composite.level} (${composite.score}/100) — perms:${permissionRisk} conc:${concentrationResult.concentrationRisk} liq:${liquidityRisk}`);
      processed++;
    } catch (err) {
      console.error(`  ❌ Error: ${err instanceof Error ? err.message : err}`);
      errored++;
    }
  }

  // Merge with existing (new entries override existing by address:chain)
  const existingMap = new Map<string, unknown>();
  for (const e of existingEntries as Array<{ address: string; chain: string }>) {
    existingMap.set(`${e.chain}:${e.address.toLowerCase()}`, e);
  }
  for (const e of newEntries as Array<{ address: string; chain: string }>) {
    existingMap.set(`${e.chain}:${e.address.toLowerCase()}`, e);
  }

  const output = {
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    entries: [...existingMap.values()],
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));

  console.log(`\n✅ Done!`);
  console.log(`   Processed: ${processed} | Errors: ${errored}`);
  console.log(`   Total cached entries: ${output.entries.length}`);
  console.log(`   Written to: ${OUTPUT_PATH}`);

  if (LIMIT <= 50 && addresses.length >= LIMIT) {
    console.log('\n💡 Stage 1 complete. Review output, then run:');
    console.log(`   npx tsx scripts/refreshTokenRiskMetrics.ts --limit 200 --resume <next_address>`);
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
