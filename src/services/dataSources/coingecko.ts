/**
 * CoinGecko data source — enhanced version for token-research.
 * Free Demo API (30 calls/min). Provides market data, pricing, supply info.
 */

import { SimpleCache } from '../../utils/cache.js';

const cache = new SimpleCache<CoinGeckoResult>(120); // 2 min TTL
const searchCache = new SimpleCache<CoinGeckoSearchResult[]>(600); // 10 min TTL

const PLATFORM_MAP: Record<string, string> = {
  ethereum: 'ethereum',
  base: 'base',
  polygon: 'polygon-pos',
  arbitrum: 'arbitrum-one',
  optimism: 'optimistic-ethereum',
  avalanche: 'avalanche',
  solana: 'solana',
};

export interface CoinGeckoResult {
  id: string;
  name: string;
  symbol: string;
  priceUsd: number | null;
  marketCap: number | null;
  fullyDilutedValuation: number | null;
  volume24h: number | null;
  priceChange24h: number | null;
  priceChange7d: number | null;
  priceChange30d: number | null;
  allTimeHigh: number | null;
  allTimeHighDate: string | null;
  circulatingSupply: number | null;
  totalSupply: number | null;
}

interface CoinGeckoSearchResult {
  id: string;
  name: string;
  symbol: string;
}

function extractMarketData(data: Record<string, unknown>): CoinGeckoResult {
  const md = data.market_data as Record<string, unknown> | undefined;
  const price = md ? (md.current_price as Record<string, unknown>)?.usd : null;
  const mcap = md ? (md.market_cap as Record<string, unknown>)?.usd : null;
  const fdv = md ? (md.fully_diluted_valuation as Record<string, unknown>)?.usd : null;
  const vol = md ? (md.total_volume as Record<string, unknown>)?.usd : null;
  const ath = md ? (md.ath as Record<string, unknown>)?.usd : null;
  const athDate = md ? (md.ath_date as Record<string, unknown>)?.usd : null;

  return {
    id: data.id as string,
    name: (data.name as string) ?? 'unknown',
    symbol: (data.symbol as string) ?? 'unknown',
    priceUsd: typeof price === 'number' ? price : null,
    marketCap: typeof mcap === 'number' ? mcap : null,
    fullyDilutedValuation: typeof fdv === 'number' ? fdv : null,
    volume24h: typeof vol === 'number' ? vol : null,
    priceChange24h:
      typeof md?.price_change_percentage_24h === 'number'
        ? (md.price_change_percentage_24h as number)
        : null,
    priceChange7d:
      typeof md?.price_change_percentage_7d === 'number'
        ? (md.price_change_percentage_7d as number)
        : null,
    priceChange30d:
      typeof md?.price_change_percentage_30d === 'number'
        ? (md.price_change_percentage_30d as number)
        : null,
    allTimeHigh: typeof ath === 'number' ? ath : null,
    allTimeHighDate: typeof athDate === 'string' ? athDate : null,
    circulatingSupply:
      typeof md?.circulating_supply === 'number' ? (md.circulating_supply as number) : null,
    totalSupply: typeof md?.total_supply === 'number' ? (md.total_supply as number) : null,
  };
}

/** Fetch token data by contract address */
export async function fetchByAddress(
  address: string,
  chain: string,
): Promise<CoinGeckoResult | null> {
  const platform = PLATFORM_MAP[chain];
  if (!platform) return null;

  const cacheKey = `addr:${platform}:${address}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/${platform}/contract/${address}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    const result = extractMarketData(data);
    cache.set(cacheKey, result);
    return result;
  } catch {
    return null;
  }
}

/** Fetch token data by CoinGecko ID (e.g., "ethereum", "bitcoin") */
export async function fetchById(id: string): Promise<CoinGeckoResult | null> {
  const cacheKey = `id:${id}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/coins/${id}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    const result = extractMarketData(data);
    cache.set(cacheKey, result);
    return result;
  } catch {
    return null;
  }
}

/** Search CoinGecko for a token by name or symbol */
export async function searchToken(query: string): Promise<CoinGeckoSearchResult[]> {
  const cacheKey = `search:${query.toLowerCase()}`;
  const cached = searchCache.get(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { coins?: Array<{ id: string; name: string; symbol: string }> };
    const results = (data.coins ?? []).slice(0, 5).map((c) => ({
      id: c.id,
      name: c.name,
      symbol: c.symbol,
    }));
    searchCache.set(cacheKey, results);
    return results;
  } catch {
    return [];
  }
}
