/**
 * DeFiLlama data source — completely free, no API key needed.
 * Provides TVL, chain breakdown, protocol category, and associated protocols.
 */

import { SimpleCache } from '../../utils/cache.js';

const protocolListCache = new SimpleCache<DeFiLlamaProtocol[]>(1800); // 30 min TTL
const protocolDetailCache = new SimpleCache<DeFiLlamaDetail>(300); // 5 min TTL

interface DeFiLlamaProtocol {
  slug: string;
  name: string;
  symbol: string;
  gecko_id: string | null;
  category: string | null;
  chains: string[];
  tvl: number | null;
}

export interface DeFiLlamaDetail {
  tvl: number | null;
  tvlChange24h: number | null;
  tvlChange7d: number | null;
  category: string | null;
  chains: string[];
  associatedProtocols: Array<{ name: string; tvl: number | null }>;
}

async function getProtocolList(): Promise<DeFiLlamaProtocol[]> {
  const cached = protocolListCache.get('all');
  if (cached) return cached;

  try {
    const res = await fetch('https://api.llama.fi/protocols', {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as Array<Record<string, unknown>>;

    const protocols: DeFiLlamaProtocol[] = data.map((p) => ({
      slug: (p.slug as string) ?? '',
      name: (p.name as string) ?? '',
      symbol: (p.symbol as string) ?? '',
      gecko_id: (p.gecko_id as string) ?? null,
      category: (p.category as string) ?? null,
      chains: Array.isArray(p.chains) ? (p.chains as string[]) : [],
      tvl: typeof p.tvl === 'number' ? p.tvl : null,
    }));

    protocolListCache.set('all', protocols);
    return protocols;
  } catch {
    return [];
  }
}

/** Find a protocol by name, symbol, or CoinGecko ID */
export async function findProtocol(
  query: string,
  coingeckoId?: string,
): Promise<DeFiLlamaProtocol | null> {
  const protocols = await getProtocolList();
  if (protocols.length === 0) return null;

  const q = query.toLowerCase();

  // Try CoinGecko ID match first (most reliable)
  if (coingeckoId) {
    const byGecko = protocols.find(
      (p) => p.gecko_id?.toLowerCase() === coingeckoId.toLowerCase(),
    );
    if (byGecko) return byGecko;
  }

  // Try exact name match
  const byName = protocols.find((p) => p.name.toLowerCase() === q);
  if (byName) return byName;

  // Try exact symbol match
  const bySymbol = protocols.find((p) => p.symbol.toLowerCase() === q);
  if (bySymbol) return bySymbol;

  // Try slug match
  const bySlug = protocols.find((p) => p.slug.toLowerCase() === q);
  if (bySlug) return bySlug;

  return null;
}

// ── Price History ──────────────────────────────────────────────────

const CHAIN_MAP: Record<string, string> = {
  ethereum: 'ethereum',
  base: 'base',
  polygon: 'polygon',
  arbitrum: 'arbitrum',
  optimism: 'optimism',
  avalanche: 'avax',
};

export interface PriceHistoryPoint {
  date: string;
  priceUsd: number;
}

export interface PriceHistoryResult {
  prices30d: PriceHistoryPoint[];
  volatility30d: number;
  trend: 'up' | 'down' | 'sideways';
  maxDrawdown30d: number;
}

export async function fetchPriceHistory(
  address: string,
  chain: string,
): Promise<PriceHistoryResult | null> {
  const llamaChain = CHAIN_MAP[chain];
  if (!llamaChain) return null;

  try {
    const res = await fetch(
      `https://coins.llama.fi/chart/${llamaChain}:${address}?period=1d&span=30`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) return null;

    const data = (await res.json()) as {
      coins: Record<string, { prices: Array<{ timestamp: number; price: number }> }>;
    };

    const key = Object.keys(data.coins)[0];
    if (!key) return null;

    const rawPrices = data.coins[key].prices;
    if (!rawPrices || rawPrices.length < 2) return null;

    const prices30d: PriceHistoryPoint[] = rawPrices.map((p) => ({
      date: new Date(p.timestamp * 1000).toISOString().slice(0, 10),
      priceUsd: p.price,
    }));

    // Calculate daily returns
    const returns: number[] = [];
    for (let i = 1; i < rawPrices.length; i++) {
      if (rawPrices[i - 1].price > 0) {
        returns.push(
          (rawPrices[i].price - rawPrices[i - 1].price) / rawPrices[i - 1].price,
        );
      }
    }

    // Volatility (std dev of daily returns)
    const meanReturn = returns.reduce((a, b) => a + b, 0) / (returns.length || 1);
    const variance =
      returns.reduce((sum, r) => sum + (r - meanReturn) ** 2, 0) / (returns.length || 1);
    const volatility30d = Math.sqrt(variance);

    // Trend
    const firstPrice = rawPrices[0].price;
    const lastPrice = rawPrices[rawPrices.length - 1].price;
    const priceChange = firstPrice > 0 ? (lastPrice - firstPrice) / firstPrice : 0;
    let trend: 'up' | 'down' | 'sideways' = 'sideways';
    if (priceChange > 0.05) trend = 'up';
    else if (priceChange < -0.05) trend = 'down';

    // Max drawdown
    let peak = rawPrices[0].price;
    let maxDrawdown = 0;
    for (const p of rawPrices) {
      if (p.price > peak) peak = p.price;
      const drawdown = peak > 0 ? (peak - p.price) / peak : 0;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }

    return { prices30d, volatility30d, trend, maxDrawdown30d: maxDrawdown };
  } catch {
    return null;
  }
}

/** Get detailed protocol data including TVL changes */
export async function fetchProtocolDetail(slug: string): Promise<DeFiLlamaDetail | null> {
  const cached = protocolDetailCache.get(slug);
  if (cached) return cached;

  try {
    const res = await fetch(`https://api.llama.fi/protocol/${encodeURIComponent(slug)}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;

    const currentTvl = typeof data.currentChainTvls === 'object' && data.currentChainTvls
      ? Object.values(data.currentChainTvls as Record<string, number>).reduce((a, b) => a + b, 0)
      : typeof data.tvl === 'number' ? data.tvl : null;

    // Extract child protocols if any
    const otherProtocols = Array.isArray(data.otherProtocols)
      ? (data.otherProtocols as Array<Record<string, unknown>>).map((p) => ({
          name: (p.name as string) ?? 'unknown',
          tvl: typeof p.tvl === 'number' ? p.tvl : null,
        }))
      : [];

    const result: DeFiLlamaDetail = {
      tvl: currentTvl,
      tvlChange24h: typeof data.change_1d === 'number' ? data.change_1d : null,
      tvlChange7d: typeof data.change_7d === 'number' ? data.change_7d : null,
      category: (data.category as string) ?? null,
      chains: Array.isArray(data.chains) ? (data.chains as string[]) : [],
      associatedProtocols: otherProtocols,
    };

    protocolDetailCache.set(slug, result);
    return result;
  } catch {
    return null;
  }
}
