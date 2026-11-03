/**
 * New-launch feed — GET /v1/launches.
 *
 * Returns pools created since `since`, each with a launch risk score computed
 * once at discovery and refreshed as trading activity accrues. Built for
 * polling: pass the previous response's `nextSince` to get only what's new.
 *
 * Each launch is scored once and sold to every poller, so the marginal cost of
 * a call is one indexed read. Ingestion piggybacks on paid requests (at most
 * once per minute per chain, via a lease), so nothing runs while nobody polls.
 */

import { launchesInput, launchesOutput, type LaunchItem, type LaunchesOutput } from '../schemas/launches.js';
import { ingestLaunches, LEASE_SEC } from '../launches/ingest.js';
import { getLaunchStore, type LaunchRecord } from '../launches/store.js';

const DEFAULT_LOOKBACK_MS = 60 * 60 * 1000;

function toItem(r: LaunchRecord, now: number): LaunchItem {
  return {
    token: { address: r.tokenAddress, name: r.facts.name, symbol: r.facts.symbol },
    pool: { address: r.poolAddress, dex: r.dex, name: r.name, createdAt: r.poolCreatedAt },
    ageMinutes: Math.max(0, Math.round((now - Date.parse(r.poolCreatedAt)) / 60_000)),
    risk: r.risk,
    market: {
      liquidityUsd: r.market.liquidityUsd,
      fdvUsd: r.market.fdvUsd,
      volumeH24Usd: r.market.volumeH24Usd,
      txH1: r.market.txH1,
      txH24: r.market.txH24,
    },
    contract: {
      verified: r.facts.verified,
      ownerRenounced: r.facts.ownerRenounced,
      isProxy: r.facts.isProxy,
      canMint: r.facts.capabilities.mint,
      canBlacklist: r.facts.capabilities.blacklist,
      canChangeTaxes: r.facts.capabilities.feeSetter,
      canPause: r.facts.capabilities.pause,
      deployer: r.facts.creator,
      deployerHoldingPct: r.facts.creatorHoldingPct,
      supplyInPoolPct: r.facts.supplyInPoolPct,
    },
    updatedAt: r.updatedAt,
  };
}

export async function getLaunchesWithCost(
  input: unknown,
): Promise<{ output: LaunchesOutput; estimatedCostUsd: number }> {
  const q = launchesInput.parse(input);
  const store = getLaunchStore();

  let stale = false;
  const last = await store.lastIngestAt(q.chain);
  if (!last || Date.now() - Date.parse(last) > LEASE_SEC * 1000) {
    try {
      await ingestLaunches(q.chain);
    } catch {
      stale = true; // serve what we have; freshness says so
    }
  }

  const now = Date.now();
  const since = q.since ?? new Date(now - DEFAULT_LOOKBACK_MS).toISOString();
  const rows = await store.query({
    chain: q.chain,
    since,
    minLiquidityUsd: q.minLiquidityUsd,
    maxRiskScore: q.maxRiskScore,
    limit: q.limit,
  });
  const launches = rows.map((r) => toItem(r, now));
  const newest = launches.reduce((m, l) => (l.pool.createdAt > m ? l.pool.createdAt : m), since);
  const ingestedAt = await store.lastIngestAt(q.chain);
  const riskiest = [...launches].sort((a, b) => b.risk.score - a.risk.score)[0];
  const safest = [...launches].sort((a, b) => a.risk.score - b.risk.score)[0];

  const output = launchesOutput.parse({
    chain: q.chain,
    launches,
    nextSince: newest,
    freshness: {
      ingestedAt,
      stale,
      note: 'Scores combine on-chain contract checks (verification, owner powers, proxy, deployer holdings) with live trading activity, refreshed every few minutes for 24h. A launch scored "low" can still fail — re-check with /v1/trade-check before buying.',
    },
    relatedServices: [
      ...(safest
        ? [{
            endpoint: '/v1/trade-check',
            description: 'Full pre-trade check (rug metrics + AI risk + gas) on a launch before you buy',
            suggestedInput: { address: safest.token.address, chain: q.chain },
          }]
        : []),
      ...(launches.length >= 2
        ? [{
            endpoint: '/v1/risk-batch',
            description: 'Re-score a whole watchlist of tokens in one call',
            suggestedInput: { chain: q.chain, tokens: launches.slice(0, 5).map((l) => ({ address: l.token.address })) },
          }]
        : []),
      ...(riskiest?.contract.deployer
        ? [{
            endpoint: '/v1/address-check',
            description: 'Screen a deployer against sanctions and scam lists',
            suggestedInput: { addresses: [{ address: riskiest.contract.deployer, chain: q.chain }] },
          }]
        : []),
    ],
  });

  return { output, estimatedCostUsd: 0 };
}
