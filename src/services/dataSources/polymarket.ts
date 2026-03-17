/**
 * Polymarket data source — completely free, no auth needed for reads.
 * Provides prediction market data for crypto tokens.
 */

import { SimpleCache } from '../../utils/cache.js';

const marketCache = new SimpleCache<PolymarketResult>(300); // 5 min TTL

export interface PolymarketMarket {
  title: string;
  outcomePrices: { yes: number; no: number };
  volume: number | null;
  slug: string;
  url: string;
}

export interface PolymarketResult {
  relatedMarkets: PolymarketMarket[];
}

/** Search Polymarket for markets related to a token */
export async function searchMarkets(
  symbol: string,
  name: string,
): Promise<PolymarketResult> {
  const cacheKey = `pm:${symbol.toLowerCase()}:${name.toLowerCase()}`;
  const cached = marketCache.get(cacheKey);
  if (cached) return cached;

  const markets: PolymarketMarket[] = [];

  try {
    // Search by token name/symbol in active events
    const queries = [symbol, name].filter((q) => q.length >= 2);

    for (const query of queries) {
      const res = await fetch(
        `https://gamma-api.polymarket.com/events?` +
          new URLSearchParams({
            active: 'true',
            closed: 'false',
            limit: '10',
            title: query,
          }).toString(),
        { signal: AbortSignal.timeout(8_000) },
      );

      if (!res.ok) continue;
      const events = (await res.json()) as Array<Record<string, unknown>>;

      for (const event of events) {
        const title = event.title as string;
        if (!title) continue;

        // Check if the event is actually related to our token
        const titleLower = title.toLowerCase();
        const isRelevant =
          titleLower.includes(symbol.toLowerCase()) ||
          titleLower.includes(name.toLowerCase());

        if (!isRelevant) continue;

        // Extract market data from the event's markets array
        const eventMarkets = event.markets as Array<Record<string, unknown>> | undefined;
        if (!Array.isArray(eventMarkets)) continue;

        for (const m of eventMarkets) {
          // Parse outcome prices
          let yes = 0.5;
          let no = 0.5;
          try {
            const prices = JSON.parse((m.outcomePrices as string) ?? '[]') as string[];
            if (prices.length >= 2) {
              yes = parseFloat(prices[0]) || 0.5;
              no = parseFloat(prices[1]) || 0.5;
            }
          } catch {
            // Use defaults
          }

          const slug = (event.slug as string) ?? '';
          markets.push({
            title: (m.question as string) ?? title,
            outcomePrices: { yes, no },
            volume: typeof m.volume === 'number' ? m.volume : null,
            slug,
            url: slug ? `https://polymarket.com/event/${slug}` : '',
          });
        }
      }

      // Stop after first successful query to avoid duplicates
      if (markets.length > 0) break;
    }
  } catch {
    // Return empty markets on failure
  }

  // Deduplicate by title
  const seen = new Set<string>();
  const deduped = markets.filter((m) => {
    if (seen.has(m.title)) return false;
    seen.add(m.title);
    return true;
  });

  const result: PolymarketResult = { relatedMarkets: deduped.slice(0, 10) };
  marketCache.set(cacheKey, result);
  return result;
}
