/**
 * Pool Snapshots service.
 *
 * Serves pre-computed DeFi Llama pool state snapshots.
 * No LLM calls. No external API calls at request time (except stale refresh).
 * Pure data retrieval from pre-computed cache → near-100% margin.
 *
 * Staleness handling:
 *  - <30 min: serve fresh, no warning
 *  - 30 min – 2 hours: include staleWarning in response
 *  - >2 hours: attempt live refresh from DeFi Llama (5s timeout)
 *              if refresh fails, serve stale with warning
 */

import {
  poolSnapshotInput,
  type PoolSnapshotInput,
  type PoolSnapshotOutput,
  type Pool,
} from '../schemas/poolSnapshots.js';
import { getPoolSnapshotsCache } from '../cache/poolSnapshotsCache.js';
import { getRegistry } from '../registry/lookup.js';
import { fetchLivePools } from './poolSnapshotRefresh.js';

const WARN_THRESHOLD_SEC = 30 * 60;      // 30 min → include warning
const REFRESH_THRESHOLD_SEC = 2 * 60 * 60; // 2 hours → attempt live refresh

export interface PoolSnapshotResult {
  output: PoolSnapshotOutput;
  estimatedCostUsd: number;
}

/** Enrich a pool with registry labels if the address is known. */
function enrichPool(pool: Pool): Pool {
  if (!pool.address) return pool;
  const entry = getRegistry().lookup(pool.address, pool.chain);
  if (!entry) return pool;
  return {
    ...pool,
    registryLabel: entry.name,
    registryRisk: entry.riskLevel,
  };
}

/** Build relatedServices suggestions based on returned pools. */
function buildRelatedServices(pools: Pool[], chain?: string): PoolSnapshotOutput['relatedServices'] {
  const related: PoolSnapshotOutput['relatedServices'] = [];

  // Suggest token-intel for the first pool's tokens
  const firstPool = pools[0];
  if (firstPool && firstPool.tokens.length > 0) {
    related.push({
      endpoint: '/v1/token-intel',
      description: `Get token intelligence for ${firstPool.tokens[0]}`,
      suggestedInput: { address: firstPool.tokens[0], chain: chain ?? 'ethereum' },
    });
  }

  // Suggest contract-docs for first pool with an address
  const poolWithAddr = pools.find((p) => p.address);
  if (poolWithAddr?.address) {
    related.push({
      endpoint: '/v1/contract-docs',
      description: `Get documentation for pool contract ${poolWithAddr.symbol}`,
      suggestedInput: { address: poolWithAddr.address, chain: poolWithAddr.chain },
    });
  }

  // Suggest token-risk-metrics if token found
  if (firstPool && firstPool.tokens.length > 0) {
    related.push({
      endpoint: '/v1/token-risk-metrics',
      description: `Get quantitative risk metrics for tokens in ${firstPool.symbol}`,
      suggestedInput: { address: firstPool.tokens[0], chain: chain ?? 'ethereum' },
    });
  }

  return related;
}

export async function getPoolSnapshotWithCost(
  rawInput: unknown,
): Promise<PoolSnapshotResult> {
  const input: PoolSnapshotInput = poolSnapshotInput.parse(rawInput);
  const cache = getPoolSnapshotsCache();

  const stalenessSec = cache.getStalenessSeconds();

  // Attempt live refresh if >2 hours old
  if (stalenessSec > REFRESH_THRESHOLD_SEC) {
    try {
      const fresh = await fetchLivePools(5_000);
      cache.update(fresh);
    } catch {
      // DeFi Llama slow or down — continue with stale data
    }
  }

  const { sortBy = 'tvl', order = 'desc', limit = 20, offset = 0 } = input;

  // Filter
  const filtered = cache.filter(
    {
      pool: input.pool,
      protocol: input.protocol,
      chain: input.chain,
      token: input.token,
    },
    sortBy,
    order,
  );

  // Paginate
  const paginated = filtered.slice(offset, offset + limit);

  // Enrich with registry labels
  const enriched = paginated.map(enrichPool);

  // Build staleness warning
  const finalStalenessSec = cache.getStalenessSeconds();
  const warning =
    finalStalenessSec > WARN_THRESHOLD_SEC
      ? `Pool data is ${Math.floor(finalStalenessSec / 60)} minutes old. Refresh with the pre-compute script for latest data.`
      : undefined;

  const output: PoolSnapshotOutput = {
    timestamp: cache.generatedAt,
    stalenessSec: finalStalenessSec,
    totalPoolsIndexed: cache.totalPools,
    returned: enriched.length,
    warning,
    pools: enriched,
    relatedServices: buildRelatedServices(enriched, input.chain),
  };

  return { output, estimatedCostUsd: 0 };
}
