/**
 * Launch ingestion for one chain: discover new pools on GeckoTerminal, gather
 * on-chain facts and score each new token once, then refresh trading activity
 * (and the score) of recent launches so honeypot signals surface as they form.
 *
 * Bounded so it can run inside a paid request: a lease (at most once per
 * LEASE_SEC per chain across all instances), a cap on new tokens per run, and
 * a deadline after which remaining work waits for the next run.
 */

import { fetchNewPools, fetchPoolsMulti, type GtPool, type LaunchChain } from '../services/dataSources/geckoterminal.js';
import { getTokenFacts } from './onchain.js';
import { scoreLaunch } from './score.js';
import { getLaunchStore, type LaunchMarketRow, type LaunchRecord } from './store.js';

export const LEASE_SEC = 60;
const PAGES: Record<LaunchChain, number> = { base: 2, ethereum: 1, arbitrum: 1, bsc: 2 };
const MAX_NEW_PER_RUN = 15;
const NEW_CONCURRENCY = 3;
const REFRESH_STALE_MIN = 5;
const REFRESH_MAX_AGE_HOURS = 24;

export interface IngestResult {
  ran: boolean;
  discovered: number;
  added: number;
  refreshed: number;
  deferred: number;
}

function marketOf(p: GtPool): LaunchMarketRow {
  return {
    liquidityUsd: p.liquidityUsd,
    fdvUsd: p.fdvUsd,
    marketCapUsd: p.marketCapUsd,
    volumeH24Usd: p.volumeH24Usd,
    priceChangeH1Pct: p.priceChangeH1Pct,
    txH1: p.txH1,
    txH24: p.txH24,
  };
}

export async function ingestLaunches(chain: LaunchChain, deadlineMs = 20_000): Promise<IngestResult> {
  const store = getLaunchStore();
  const result: IngestResult = { ran: false, discovered: 0, added: 0, refreshed: 0, deferred: 0 };
  if (!(await store.tryLease(chain, LEASE_SEC))) return result;
  result.ran = true;
  const deadline = Date.now() + deadlineMs;

  // 1. Discover.
  const pools: GtPool[] = [];
  for (let page = 1; page <= PAGES[chain]; page++) {
    const batch = await fetchNewPools(chain, page).catch(() => [] as GtPool[]);
    pools.push(...batch);
    if (batch.length === 0) break;
  }
  const byPool = new Map(pools.map((p) => [p.poolAddress, p]));
  result.discovered = byPool.size;
  const known = await store.knownPools(chain, [...byPool.keys()]);
  const fresh = [...byPool.values()]
    .filter((p) => !known.has(p.poolAddress))
    .sort((a, b) => Date.parse(b.poolCreatedAt) - Date.parse(a.poolCreatedAt));
  const todo = fresh.slice(0, MAX_NEW_PER_RUN);
  result.deferred = fresh.length - todo.length;

  // 2. Score new launches (facts are fetched once per token, then stored).
  const factsByToken = new Map<string, Awaited<ReturnType<typeof getTokenFacts>>>();
  let next = 0;
  await Promise.all(
    Array.from({ length: NEW_CONCURRENCY }, async () => {
      while (next < todo.length) {
        const pool = todo[next++];
        if (Date.now() > deadline) {
          result.deferred++;
          continue;
        }
        try {
          if (!factsByToken.has(pool.tokenAddress)) {
            factsByToken.set(pool.tokenAddress, await getTokenFacts(chain, pool.tokenAddress, pool.poolAddress));
          }
          const raw = factsByToken.get(pool.tokenAddress);
          if (!raw) continue; // not a contract / RPC failure — skip, retried next run
          const market = marketOf(pool);
          // v4 hooks (Doppler, Zora, …) can custody liquidity outside the
          // PoolManager. ~0% in-pool alongside real liquidity means we looked
          // in the wrong place, not that supply is off-pool.
          const facts = raw.supplyInPoolPct !== undefined && raw.supplyInPoolPct < 1 && (market.liquidityUsd ?? 0) >= 1000
            ? { ...raw, supplyInPoolPct: undefined }
            : raw;
          const now = new Date().toISOString();
          await store.upsert({
            chain,
            tokenAddress: pool.tokenAddress,
            poolAddress: pool.poolAddress,
            dex: pool.dex,
            name: pool.name,
            symbol: facts.symbol,
            poolCreatedAt: pool.poolCreatedAt,
            firstSeenAt: now,
            updatedAt: now,
            risk: scoreLaunch(facts, market),
            facts,
            market,
          });
          result.added++;
        } catch {
          // One bad token must not sink the run.
        }
      }
    }),
  );

  // 3. Refresh trading activity for recent launches (one GeckoTerminal call per 30 pools).
  if (Date.now() < deadline) {
    try {
      const stale: LaunchRecord[] = await store.staleForRefresh(chain, REFRESH_STALE_MIN, REFRESH_MAX_AGE_HOURS, 30);
      if (stale.length > 0) {
        const current = new Map((await fetchPoolsMulti(chain, stale.map((s) => s.poolAddress))).map((p) => [p.poolAddress, p]));
        for (const rec of stale) {
          const p = current.get(rec.poolAddress);
          if (!p) continue;
          const market = marketOf(p);
          await store.upsert({ ...rec, market, risk: scoreLaunch(rec.facts, market) });
          result.refreshed++;
        }
      }
    } catch {
      // Refresh is best-effort; stale activity is reported via updatedAt.
    }
  }

  return result;
}
