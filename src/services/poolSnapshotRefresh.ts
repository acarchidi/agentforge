/**
 * Pure functions for DeFi Llama pool data transformation.
 * Used by both the service (live refresh) and the refresh script.
 * Exported separately so they can be unit tested without side effects.
 */

import type { Pool } from '../schemas/poolSnapshots.js';
import type { PoolSnapshotData } from '../cache/poolSnapshotsCache.js';

// ── IL Risk Computation ───────────────────────────────────────────────

const STABLECOINS = new Set([
  'USDC', 'USDT', 'DAI', 'FRAX', 'BUSD', 'TUSD', 'USDP', 'LUSD', 'MIM', 'CUSD',
  'USDD', 'FDUSD', 'PYUSD', 'EURC', 'USDE', 'SUSD', 'GUSD', 'USDJ', 'EURS', 'USDS',
]);

const CORRELATED_PAIRS = [
  // ETH derivatives
  ['ETH', 'STETH'], ['ETH', 'WSTETH'], ['ETH', 'RETH'], ['ETH', 'CBETH'], ['ETH', 'FRXETH'],
  ['WETH', 'STETH'], ['WETH', 'WSTETH'], ['WETH', 'RETH'],
  // BTC derivatives
  ['WBTC', 'BTC'], ['WBTC', 'TBTC'], ['BTC', 'RENBTC'],
  // SOL derivatives
  ['SOL', 'MSOL'], ['SOL', 'JITOSOL'],
];

/**
 * Compute impermanent loss risk for a pool based on its token composition.
 * - Single token: 'none' (no IL)
 * - Stablecoin-only: 'none'
 * - Correlated pair (ETH/stETH, WBTC/BTC): 'low'
 * - Major pair (ETH + stablecoin): 'medium'
 * - Exotic pair: 'high'
 */
export function computeIlRisk(tokens: string[], isStablecoin: boolean): 'none' | 'low' | 'medium' | 'high' {
  if (isStablecoin) return 'none';

  // Single token pool (lending)
  if (tokens.length <= 1) return 'none';

  const upper = tokens.map((t) => t.toUpperCase().replace('$', ''));

  // All stablecoins
  if (upper.every((t) => STABLECOINS.has(t))) return 'none';

  // Check for correlated pairs
  for (const [a, b] of CORRELATED_PAIRS) {
    if (upper.includes(a) && upper.includes(b)) return 'low';
  }

  // Contains a stablecoin and a major crypto (ETH, WETH, BTC, WBTC, SOL)
  const MAJORS = new Set(['ETH', 'WETH', 'BTC', 'WBTC', 'SOL', 'WSOL', 'BNB', 'MATIC', 'AVAX', 'ARB', 'OP']);
  const hasStable = upper.some((t) => STABLECOINS.has(t));
  const hasMajor = upper.some((t) => MAJORS.has(t));
  if (hasStable && hasMajor) return 'medium';

  return 'high';
}

// ── DeFi Llama Pool Mapping ────────────────────────────────────────────

/** Map a raw DeFi Llama pool object to our Pool schema. */
export function mapLlamaPool(p: Record<string, unknown>): Pool {
  const symbol = (p.symbol as string | undefined) ?? '';
  const tokens = symbol
    .split('-')
    .map((t) => t.trim())
    .filter(Boolean);

  const isStablecoin = (p.stablecoin as boolean | undefined) ?? false;
  const tvlUsd = (p.tvlUsd as number | undefined) ?? 0;
  const apy = (p.apy as number | undefined) ?? 0;
  const apyBase = (p.apyBase as number | undefined);
  const apyReward = (p.apyReward as number | undefined);
  const volumeRaw = p.volumeUsd1d as number | undefined;
  const chain = ((p.chain as string | undefined) ?? '').toLowerCase();

  return {
    id: p.pool as string,
    address: (p.poolMeta as string | undefined) ?? undefined,
    chain,
    protocol: (p.project as string | undefined) ?? '',
    symbol,
    tokens,
    tvlUsd,
    apy,
    apyBase: apyBase !== undefined && !Number.isNaN(apyBase) ? apyBase : undefined,
    apyReward: apyReward !== undefined && !Number.isNaN(apyReward) ? apyReward : undefined,
    volume24hUsd: volumeRaw !== undefined ? volumeRaw : undefined,
    ilRisk: computeIlRisk(tokens, isStablecoin),
    stablecoin: isStablecoin,
    exposure: (p.exposure as 'single' | 'multi' | undefined) ?? undefined,
  };
}

// ── Top-N Filter ──────────────────────────────────────────────────────

/** Sort by TVL descending and take top N. */
export function filterTopByTvl(pools: Pool[], limit: number): Pool[] {
  return [...pools]
    .sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0))
    .slice(0, limit);
}

// ── Live Refresh ──────────────────────────────────────────────────────

const LLAMA_YIELDS_URL = 'https://yields.llama.fi/pools';
const TOP_POOLS_LIMIT = 500;

/** Fetch from DeFi Llama and build a PoolSnapshotData. Throws on failure. */
export async function fetchLivePools(timeoutMs = 15_000): Promise<PoolSnapshotData> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(LLAMA_YIELDS_URL, { signal: controller.signal });
    if (!resp.ok) throw new Error(`DeFi Llama API error: ${resp.status}`);

    const json = (await resp.json()) as { data: Record<string, unknown>[] };
    const rawPools = Array.isArray(json.data) ? json.data : [];

    const mapped = rawPools.map(mapLlamaPool);
    const top = filterTopByTvl(mapped, TOP_POOLS_LIMIT);

    return {
      version: '1.0.0',
      generatedAt: new Date().toISOString(),
      totalFetched: rawPools.length,
      pools: top,
    };
  } finally {
    clearTimeout(timer);
  }
}
