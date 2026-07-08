/**
 * DexScreener Data Source (free, no API key)
 *
 * Liquidity, volume, and price data for a token across all pools DexScreener
 * indexes. Used to flag thin liquidity and compute pool age.
 */

export interface DexScreenerPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  priceUsd?: string;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  pairCreatedAt?: number;
}

export interface DexScreenerResult {
  totalLiquidityUsd: number;
  totalVolume24hUsd: number;
  priceUsd: number | null;
  oldestPairCreatedAt: number | null;
  pairCount: number;
}

/**
 * Fetch and aggregate DexScreener pair data for a Solana mint. Returns
 * null when DexScreener has no data (new/illiquid tokens) — callers must
 * treat this as "liquidity unavailable", not an error.
 */
export async function fetchDexScreenerData(mint: string): Promise<DexScreenerResult | null> {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, {
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) return null;

    const data = (await res.json()) as { pairs?: DexScreenerPair[] };
    const pairs = (data.pairs ?? []).filter((p) => p.chainId === 'solana');
    if (pairs.length === 0) return null;

    const totalLiquidityUsd = pairs.reduce((sum, p) => sum + (p.liquidity?.usd ?? 0), 0);
    const totalVolume24hUsd = pairs.reduce((sum, p) => sum + (p.volume?.h24 ?? 0), 0);
    const priceUsd = pairs.find((p) => p.priceUsd)?.priceUsd;
    const createdTimestamps = pairs.map((p) => p.pairCreatedAt).filter((t): t is number => !!t);

    return {
      totalLiquidityUsd,
      totalVolume24hUsd,
      priceUsd: priceUsd ? Number(priceUsd) : null,
      oldestPairCreatedAt: createdTimestamps.length > 0 ? Math.min(...createdTimestamps) : null,
      pairCount: pairs.length,
    };
  } catch {
    return null;
  }
}
