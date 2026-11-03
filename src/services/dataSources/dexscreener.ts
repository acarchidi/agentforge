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

export interface DexScreenerEvmMarket {
  totalLiquidityUsd: number;
  /** Market cap when DexScreener has it, else FDV. */
  marketCapUsd: number | null;
  pairCount: number;
  oldestPairCreatedAt: number | null;
}

/**
 * Aggregate DexScreener pairs for up to 30 EVM tokens in ONE request
 * (`/tokens/v1/{chain}/{a,b,...}`). Tokens DexScreener doesn't index are
 * simply absent from the map — callers treat that as "liquidity unavailable".
 */
export async function fetchDexScreenerEvmTokens(
  chain: string,
  addresses: string[],
): Promise<Map<string, DexScreenerEvmMarket>> {
  const out = new Map<string, DexScreenerEvmMarket>();
  const unique = [...new Set(addresses.map((a) => a.toLowerCase()))];
  for (let i = 0; i < unique.length; i += 30) {
    const chunk = unique.slice(i, i + 30);
    try {
      const res = await fetch(`https://api.dexscreener.com/tokens/v1/${chain}/${chunk.join(',')}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) continue;
      const pairs = (await res.json()) as Array<DexScreenerPair & {
        baseToken?: { address?: string };
        fdv?: number;
        marketCap?: number;
      }>;
      if (!Array.isArray(pairs)) continue;
      for (const p of pairs) {
        const addr = p.baseToken?.address?.toLowerCase();
        if (!addr || !chunk.includes(addr)) continue;
        const prev = out.get(addr) ?? { totalLiquidityUsd: 0, marketCapUsd: null, pairCount: 0, oldestPairCreatedAt: null };
        const cap = p.marketCap || p.fdv || null;
        out.set(addr, {
          totalLiquidityUsd: prev.totalLiquidityUsd + (p.liquidity?.usd ?? 0),
          marketCapUsd: prev.marketCapUsd ?? cap,
          pairCount: prev.pairCount + 1,
          oldestPairCreatedAt: p.pairCreatedAt
            ? Math.min(prev.oldestPairCreatedAt ?? p.pairCreatedAt, p.pairCreatedAt)
            : prev.oldestPairCreatedAt,
        });
      }
    } catch {
      // Non-fatal: missing market data degrades liquidity scoring only.
    }
  }
  return out;
}
