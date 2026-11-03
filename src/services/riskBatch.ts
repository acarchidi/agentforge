/**
 * Batch Risk Scoring — token-risk-metrics for 2-25 tokens in one paid call.
 *
 * The point is economics as much as convenience: one x402 settlement (one
 * facilitator fee) covers the whole list, so the per-token price can sit far
 * below the single-token endpoint. There is no LLM in this path; the marginal
 * cost is free-tier Etherscan and DexScreener calls.
 *
 * DexScreener market data is prefetched once per chain (30 tokens per request)
 * and handed to each live computation, so a 25-token batch costs one market
 * request instead of 25. Each token runs under a shared deadline; a token that
 * can't finish returns status "timeout" instead of stalling the whole batch.
 */

import { getTokenRiskMetricsWithCost } from './tokenRiskMetrics/index.js';
import { fetchDexScreenerEvmTokens } from './dataSources/dexscreener.js';
import {
  riskBatchInput,
  riskBatchOutput,
  type RiskBatchItem,
  type RiskBatchOutput,
} from '../schemas/riskBatch.js';
import { RISK_BATCH_PER_TOKEN, formatUsd, priceFor } from '../pricing.js';

const CONCURRENCY = 4;
/** Leave headroom under Vercel's 60s function limit for settlement. */
const DEADLINE_MS = 40_000;

class Timeout extends Error {}

function withDeadline<T>(p: Promise<T>, deadline: number): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return Promise.reject(new Timeout());
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Timeout()), remaining);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/** Run `fn` over items with at most `limit` in flight, preserving order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function riskBatchWithCost(
  input: unknown,
): Promise<{ output: RiskBatchOutput; estimatedCostUsd: number }> {
  const startTime = Date.now();
  const deadline = startTime + DEADLINE_MS;
  const validated = riskBatchInput.parse(input);

  // Normalize + dedupe (same token twice is scored once, reported once).
  const seen = new Set<string>();
  const tokens: { address: string; chain: string }[] = [];
  for (const t of validated.tokens) {
    const chain = t.chain ?? validated.chain;
    const key = `${chain}:${t.address.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tokens.push({ address: t.address, chain });
  }

  // One DexScreener request per chain (≤30 tokens each) for liquidity + market cap.
  const byChain = new Map<string, string[]>();
  for (const t of tokens) byChain.set(t.chain, [...(byChain.get(t.chain) ?? []), t.address]);
  const markets = new Map<string, Awaited<ReturnType<typeof fetchDexScreenerEvmTokens>>>();
  await Promise.all(
    [...byChain].map(async ([chain, addrs]) => {
      markets.set(chain, await fetchDexScreenerEvmTokens(chain, addrs));
    }),
  );

  const results = await mapLimit(tokens, CONCURRENCY, async (t): Promise<RiskBatchItem> => {
    try {
      const market = markets.get(t.chain)?.get(t.address.toLowerCase()) ?? null;
      const { output: m } = await withDeadline(
        getTokenRiskMetricsWithCost({ address: t.address, chain: t.chain }, { market }),
        deadline,
      );
      return {
        address: t.address,
        chain: t.chain,
        status: 'ok',
        riskScore: m.overallRisk.score,
        riskLevel: m.overallRisk.level,
        flags: m.overallRisk.flags,
        permissions: {
          canMint: m.permissions.canMint,
          canBlacklist: m.permissions.canBlacklist,
          canPause: m.permissions.canPause,
          canUpgrade: m.permissions.canUpgrade,
        },
        liquidityUsd: m.liquidity.totalLiquidityUsd,
        holderDataAvailable: m.holders.dataAvailable ?? m.holders.top10Addresses.length > 0,
        source: m.source,
      };
    } catch (e) {
      if (e instanceof Timeout) {
        return { address: t.address, chain: t.chain, status: 'timeout', error: 'Batch deadline reached before this token finished; retry it alone or in a smaller batch' };
      }
      return { address: t.address, chain: t.chain, status: 'error', error: e instanceof Error ? e.message : 'Unknown error' };
    }
  });

  const ok = results.filter((r) => r.status === 'ok');
  const byLevel = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const r of ok) if (r.riskLevel) byLevel[r.riskLevel]++;
  const riskiest = ok
    .filter((r) => r.riskScore !== undefined)
    .sort((a, b) => (b.riskScore ?? 0) - (a.riskScore ?? 0))
    .slice(0, 5)
    .map((r) => ({ address: r.address, chain: r.chain, riskScore: r.riskScore as number }));

  const top = riskiest[0];
  const output = riskBatchOutput.parse({
    results,
    summary: { requested: validated.tokens.length, scored: ok.length, failed: results.length - ok.length, byLevel, riskiest },
    pricing: {
      perToken: formatUsd(RISK_BATCH_PER_TOKEN),
      tokensCharged: validated.tokens.length,
      total: formatUsd(priceFor('/v1/risk-batch', validated)),
    },
    metadata: { processingTimeMs: Date.now() - startTime },
    relatedServices: [
      ...(top
        ? [{
            endpoint: '/v1/trade-check',
            description: 'Full pre-trade check (rug check + AI risk + gas) on the riskiest token before acting on it',
            suggestedInput: { address: top.address, chain: top.chain },
          }]
        : []),
      {
        endpoint: '/v1/launches',
        description: 'Feed of newly launched tokens, already risk-scored — poll it instead of discovering tokens yourself',
        suggestedInput: { chain: tokens[0]?.chain ?? 'base' },
      },
      {
        endpoint: '/v1/address-check',
        description: 'Screen the deployers or counterparties of these tokens against sanctions and scam lists',
        suggestedInput: { addresses: [{ address: '0x…', chain: tokens[0]?.chain ?? 'ethereum' }] },
      },
    ],
  });

  return { output, estimatedCostUsd: 0 };
}
