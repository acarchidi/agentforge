/**
 * Which paid endpoints are about to drop out of the CDP x402 discovery index.
 *
 * The index lists a resource only while it has a settled payment in the last
 * 30 days — from anyone, including our own buyer wallets. The index's own
 * `quality.lastCalledAt` is authoritative (one search request returns every
 * AgentForge listing); Neon's settled rows cover payments the index hasn't
 * caught up with yet. The later of the two wins.
 */
import { neon } from '@neondatabase/serverless';

export const LISTING_WINDOW_DAYS = 30;
/** Pay again once fewer than this many days of listing remain. */
export const RENEW_WHEN_DAYS_LEFT = 7;

// Search returns at most 20 results, and AgentForge has more listings than
// that, so endpoints missing from the first search get a targeted follow-up.
const INDEX_SEARCH = 'https://api.cdp.coinbase.com/platform/v2/x402/discovery/search?query=';
const OUR_HOST = new URL(process.env.PUBLIC_BASE_URL ?? 'https://agentforge-taupe.vercel.app').host;

export interface ListingStatus {
  path: string;
  /** Present in the CDP discovery index right now. */
  listed: boolean;
  lastSettledAt: string | null;
  /** Days until the listing lapses; null when it never settled. */
  daysLeft: number | null;
  due: boolean;
}

/** Every paid endpoint path. Falls back to settled history if config can't load. */
async function paidPaths(seen: string[]): Promise<string[]> {
  try {
    const { ENDPOINT_PRICES } = await import('../../src/pricing.js');
    return Object.keys(ENDPOINT_PRICES);
  } catch {
    return seen;
  }
}

export async function listingStatus(databaseUrl: string): Promise<ListingStatus[]> {
  const sql = neon(databaseUrl);
  const rows = (await sql`
    SELECT name, MAX(ts) AS last FROM events WHERE kind = 'settled' GROUP BY name`) as Array<{ name: string; last: string }>;
  const last = new Map(rows.map((r) => [r.name, new Date(r.last)]));

  const listed = new Set<string>();
  const indexLast = new Map<string, Date>();
  const search = async (query: string) => {
    const res = await fetch(INDEX_SEARCH + encodeURIComponent(query), { signal: AbortSignal.timeout(15_000) });
    const json = (await res.json()) as { resources?: Array<{ resource?: string; quality?: { lastCalledAt?: string } }> };
    for (const r of json.resources ?? []) {
      if (!r.resource) continue;
      const u = new URL(r.resource);
      if (u.host !== OUR_HOST) continue;
      listed.add(u.pathname);
      if (r.quality?.lastCalledAt) indexLast.set(u.pathname, new Date(r.quality.lastCalledAt));
    }
  };

  const paths = await paidPaths(rows.map((r) => r.name));
  let indexReachable = true;
  try {
    await search('agentforge');
    for (const path of paths.filter((p) => !listed.has(p))) {
      await search(`agentforge ${path.replace(/^\/v1\//, '').replace(/[/-]/g, ' ')}`);
    }
  } catch {
    indexReachable = false; // fall back to Neon alone (errs toward paying early)
  }
  for (const [path, at] of indexLast) {
    if (!last.has(path) || at > (last.get(path) as Date)) last.set(path, at);
  }
  if (!indexReachable) console.warn('(CDP discovery index unreachable; using payment records only)');

  return paths
    .map((path) => {
      const at = last.get(path);
      const daysLeft = at ? LISTING_WINDOW_DAYS - (Date.now() - at.getTime()) / 86_400_000 : null;
      return {
        path,
        listed: listed.has(path),
        lastSettledAt: at ? at.toISOString() : null,
        daysLeft: daysLeft === null ? null : Math.round(daysLeft * 10) / 10,
        due: daysLeft === null || daysLeft < RENEW_WHEN_DAYS_LEFT,
      };
    })
    .sort((a, b) => (a.daysLeft ?? -1) - (b.daysLeft ?? -1));
}
