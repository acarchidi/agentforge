/**
 * Token Risk Metrics service.
 *
 * Two paths:
 *
 * CACHED PATH (pre-computed tokens, <6 hours old):
 *   1. Check token-risk-metrics.json cache
 *   2. Return immediately with enriched registry labels
 *
 * LIVE PATH (uncached or stale):
 *   1. Fetch top 10 holders from Etherscan
 *   2. Fetch token total supply from Etherscan
 *   3. Fetch contract ABI (reuse contract-docs cache if available)
 *   4. Fetch deployer from Etherscan
 *   5. Look up liquidity from pool-snapshots cache
 *   6. Compute all metrics
 *   7. Cache result (in-memory)
 *   8. Return response
 *
 * No LLM calls. Pure computation.
 */

import {
  tokenRiskMetricsInput,
  type TokenRiskMetricsInput,
  type TokenRiskMetricsOutput,
} from '../../schemas/tokenRiskMetrics.js';
import { getTokenRiskMetricsCache } from '../../cache/tokenRiskMetricsCache.js';
import { getPrecomputedDocs } from '../../cache/precomputedDocs.js';
import { getPoolSnapshotsCache } from '../../cache/poolSnapshotsCache.js';
import { getRegistry } from '../../registry/lookup.js';
import { config } from '../../config.js';
import {
  detectPermissions,
  scorePermissionRisk,
  type AbiFunction,
} from './permissions.js';
import {
  parseHolderList,
  computeHolderPct,
  computeConcentrationRisk,
  scoreConcentration,
} from './concentration.js';
import {
  scoreLiquidityRisk,
  capLiquidityRiskByDepth,
  computeLiquidityRatio,
} from './liquidity.js';
import { computeCompositeScore } from './composite.js';
import { etherscanSlot, isEtherscanRateLimit } from '../../utils/etherscanPacer.js';
import { CHAIN_IDS as CHAIN_ID_MAP } from '../../utils/chains.js';
import { fetchDexScreenerEvmTokens, type DexScreenerEvmMarket } from '../dataSources/dexscreener.js';

// ── Etherscan API helper ───────────────────────────────────────────────

const CHAIN_IDS: Record<string, number> = CHAIN_ID_MAP;

async function etherscanFetch(
  chainId: number,
  params: Record<string, string>,
  retried = false,
): Promise<unknown> {
  await etherscanSlot();
  const apiKey = config.ETHERSCAN_API_KEY;
  const searchParams = new URLSearchParams({
    chainid: String(chainId),
    ...params,
    ...(apiKey ? { apikey: apiKey } : {}),
  });
  const res = await fetch(
    `https://api.etherscan.io/v2/api?${searchParams.toString()}`,
    { signal: AbortSignal.timeout(10_000) },
  );
  if (!res.ok) throw new Error(`Etherscan API error: ${res.status}`);
  const data = (await res.json()) as { status: string; message: string; result: unknown };
  if (data.status === '0' && isEtherscanRateLimit(data.result)) {
    if (!retried) return etherscanFetch(chainId, params, true);
    throw new Error('Etherscan rate limit reached');
  }
  if (data.status === '0' && String(data.result).includes('error')) {
    throw new Error(`Etherscan error: ${data.result}`);
  }
  return data.result;
}

// ── Cache TTL ─────────────────────────────────────────────────────────

const CACHE_TTL_SEC = 6 * 60 * 60; // 6 hours

function isCacheStale(computedAt: string): boolean {
  const ageMs = Date.now() - new Date(computedAt).getTime();
  return ageMs > CACHE_TTL_SEC * 1000;
}

// ── Live computation ───────────────────────────────────────────────────

/**
 * Etherscan's tokenholderlist is an API Pro endpoint; on the free plan it
 * answers with a "Pro endpoint" notice instead of holders. Remember that per
 * process so live computations stop spending a rate-limited call on it.
 */
let holderListUnavailable = false;

/**
 * @param market DexScreener market data. `undefined` = fetch it here; `null` =
 *   caller already looked and found none (batch callers prefetch 30 at a time).
 */
async function computeLive(
  address: string,
  chain: string,
  chainId: number,
  market?: DexScreenerEvmMarket | null,
): Promise<Omit<TokenRiskMetricsOutput, 'relatedServices'>> {
  const registry = getRegistry();
  const computedAt = new Date().toISOString();

  // 1. Fetch holder list (top 10)
  let holderData: Array<{ TokenHolderAddress: string; TokenHolderQuantity: string }> = [];
  let totalSupply = 0n;

  if (!holderListUnavailable) {
    try {
      const holdersRaw = await etherscanFetch(chainId, {
        module: 'token',
        action: 'tokenholderlist',
        contractaddress: address,
        page: '1',
        offset: '10',
      }) as Array<{ TokenHolderAddress: string; TokenHolderQuantity: string }> | string;
      if (Array.isArray(holdersRaw)) holderData = holdersRaw;
      else if (typeof holdersRaw === 'string' && /api pro/i.test(holdersRaw)) holderListUnavailable = true;
    } catch {
      // Non-fatal: proceed with empty holder data
    }
  }

  // 2. Fetch total supply
  try {
    const supplyRaw = await etherscanFetch(chainId, {
      module: 'stats',
      action: 'tokensupply',
      contractaddress: address,
    }) as string;
    if (supplyRaw && supplyRaw !== '0') {
      totalSupply = BigInt(supplyRaw);
    }
  } catch {
    // Non-fatal
  }

  // 3. Get ABI from precomputed docs cache (avoids redundant Etherscan calls)
  let abi: AbiFunction[] = [];
  let isProxy = false;

  const precomputed = getPrecomputedDocs().lookup(address, chain);
  if (precomputed) {
    isProxy = precomputed.contract.isProxy;
    // Reconstruct minimal ABI from function names in docs
    abi = precomputed.functions.map((fn) => ({
      name: fn.name,
      type: 'function',
      stateMutability: fn.type === 'read' ? 'view' : 'nonpayable',
      inputs: [],
      outputs: [],
    }));
  } else {
    // Fetch ABI from Etherscan
    try {
      const abiRaw = await etherscanFetch(chainId, {
        module: 'contract',
        action: 'getabi',
        address,
      }) as string;
      if (typeof abiRaw === 'string' && abiRaw.startsWith('[')) {
        abi = JSON.parse(abiRaw) as AbiFunction[];
      }
    } catch {
      // Non-fatal
    }
  }

  // 4. Fetch deployer
  let deployerAddress: string | undefined;
  try {
    const creationRaw = await etherscanFetch(chainId, {
      module: 'contract',
      action: 'getcontractcreation',
      contractaddresses: address,
    }) as Array<{ contractAddress: string; contractCreator: string; txHash: string }>;
    if (Array.isArray(creationRaw) && creationRaw[0]) {
      deployerAddress = creationRaw[0].contractCreator?.toLowerCase();
    }
  } catch {
    // Non-fatal
  }

  // 5. Look up liquidity from pool-snapshots cache
  const poolsCache = getPoolSnapshotsCache();
  const allPools = poolsCache.getAllPools();
  const tokenPools = allPools
    .filter((p) => p.address?.toLowerCase() === address.toLowerCase())
    .sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0));

  // Pool snapshots only cover the top 500 pools; fall back to DexScreener,
  // which also supplies the market cap the liquidity ratio needs.
  const dex = market === undefined
    ? (await fetchDexScreenerEvmTokens(chain, [address])).get(address.toLowerCase()) ?? null
    : market;
  const totalLiquidityUsd = tokenPools.reduce((s, p) => s + (p.tvlUsd ?? 0), 0) || dex?.totalLiquidityUsd || undefined;
  const marketCapUsd = dex?.marketCapUsd ?? undefined;
  const topPools = tokenPools.slice(0, 5).map((p) => ({
    dex: p.protocol,
    pair: p.symbol,
    tvlUsd: p.tvlUsd,
  }));

  // Fetch market cap from registry or leave undefined
  const registryEntry = registry.lookup(address, chain);

  // 6. Compute all metrics

  // Permissions
  const permFlags = detectPermissions(abi, { canUpgrade: isProxy });
  const permissionRisk = scorePermissionRisk(permFlags);

  // Concentration
  const holders = parseHolderList(holderData).map((h) => ({
    ...h,
    pct: totalSupply > 0n ? computeHolderPct(h.rawBalance, totalSupply) : 0,
  }));
  const concentrationResult = computeConcentrationRisk(holders, totalSupply, registry);
  const holdersAvailable = holders.length > 0 && totalSupply > 0n;

  // Liquidity
  const liquidityRatio = computeLiquidityRatio(totalLiquidityUsd, marketCapUsd);
  const liquidityRisk = capLiquidityRiskByDepth(scoreLiquidityRisk(liquidityRatio), totalLiquidityUsd);

  // Deployer
  const deployerEntry = deployerAddress ? registry.lookup(deployerAddress) : null;
  const deployerRisk = deployerEntry ? 'low' : deployerAddress ? 'unknown' : 'unknown';

  // Composite
  const composite = computeCompositeScore({
    concentrationRisk: holdersAvailable ? concentrationResult.concentrationRisk : undefined,
    liquidityRisk,
    permissionRisk,
    deployerRisk: deployerRisk as any,
    top10HolderPct: concentrationResult.top10HolderPct,
    canMint: permFlags.canMint,
    canBlacklist: permFlags.canBlacklist,
    canPause: permFlags.canPause,
    liquidityToMcapRatio: liquidityRatio,
  });

  return {
    address,
    chain,
    symbol: registryEntry?.name,
    source: 'live' as const,
    computedAt,
    stalenessSec: 0,
    holders: holdersAvailable
      ? { ...concentrationResult, dataAvailable: true }
      : { top10HolderPct: 0, top10Addresses: [], concentrationRisk: 'unknown' as const, dataAvailable: false },
    liquidity: {
      totalLiquidityUsd,
      marketCapUsd,
      liquidityToMcapRatio: liquidityRatio,
      liquidityRisk,
      topPools: topPools.length > 0 ? topPools : undefined,
    },
    permissions: {
      ...permFlags,
      permissionRisk,
    },
    deployer: {
      address: deployerAddress,
      label: deployerEntry?.name,
      deployerRisk: deployerRisk as any,
    },
    overallRisk: composite,
  };
}

// ── Related services ──────────────────────────────────────────────────

function buildRelatedServices(
  address: string,
  chain: string,
  symbol?: string,
): TokenRiskMetricsOutput['relatedServices'] {
  return [
    {
      endpoint: '/v1/contract-docs',
      description: `Generate documentation for this token contract`,
      suggestedInput: { address, chain },
    },
    {
      endpoint: '/v1/wallet-safety',
      description: `Check wallet safety before holding this token`,
      suggestedInput: { walletAddress: '0x…your-wallet', targetContract: address, chain },
    },
    {
      endpoint: '/v1/risk-batch',
      description: 'Scoring several tokens? Batch 2-25 in one call at a lower per-token price',
      suggestedInput: { chain, tokens: [{ address }, { address: '0x…another-token' }] },
    },
    {
      endpoint: '/v1/pool-snapshot',
      description: `Find liquidity pools containing ${symbol ?? 'this token'}`,
      suggestedInput: { token: symbol ?? address, chain },
    },
  ];
}

// ── Public service function ───────────────────────────────────────────

export interface TokenRiskMetricsResult {
  output: TokenRiskMetricsOutput;
  estimatedCostUsd: number;
}

export async function getTokenRiskMetricsWithCost(
  rawInput: unknown,
  opts: { market?: DexScreenerEvmMarket | null } = {},
): Promise<TokenRiskMetricsResult> {
  const input: TokenRiskMetricsInput = tokenRiskMetricsInput.parse(rawInput);
  const { address, chain } = input;

  const metricsCache = getTokenRiskMetricsCache();
  const chainId = CHAIN_IDS[chain] ?? 1;

  // CACHED PATH
  const cached = metricsCache.lookup(address, chain);
  if (cached && !isCacheStale(cached.computedAt)) {
    const stalenessSec = Math.floor((Date.now() - new Date(cached.computedAt).getTime()) / 1000);
    const output: TokenRiskMetricsOutput = {
      ...cached,
      source: 'cached' as const,
      stalenessSec,
      relatedServices: buildRelatedServices(address, chain, cached.symbol),
    };
    return { output, estimatedCostUsd: 0 };
  }

  // LIVE PATH
  const live = await computeLive(address, chain, chainId, opts.market);
  const output: TokenRiskMetricsOutput = {
    ...live,
    relatedServices: buildRelatedServices(address, chain, live.symbol),
  };

  // Cache for future requests
  metricsCache.set(address, chain, output);

  return { output, estimatedCostUsd: 0 };
}
