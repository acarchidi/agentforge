/**
 * Where AgentForge ranks in the CDP x402 Bazaar semantic search for the
 * queries agents actually type. Prints rank (1-20, or "-" if absent) and the
 * top competitors per query.
 *
 * Usage: npx tsx scripts/bazaarRank.ts
 */
const SEARCH = 'https://api.cdp.coinbase.com/platform/v2/x402/discovery/search?query=';
const OURS = 'agentforge-taupe.vercel.app';

export const QUERIES: Array<[string, string]> = [
  ['simulate transaction before signing', '/v1/tx-simulate'],
  ['transaction simulation', '/v1/tx-simulate'],
  ['pre-sign transaction check', '/v1/tx-simulate'],
  ['is this transaction safe', '/v1/tx-simulate'],
  ['drainer detection', '/v1/tx-simulate'],
  ['sanctions screening', '/v1/address-check'],
  ['OFAC address check', '/v1/address-check'],
  ['scam address check', '/v1/address-check'],
  ['wallet address risk', '/v1/address-check'],
  ['AML crypto address', '/v1/address-check'],
  ['token rug check', '/v1/token-risk-metrics'],
  ['honeypot detection', '/v1/launches'],
  ['token security scan', '/v1/trade-check'],
  ['is this token safe to buy', '/v1/trade-check'],
  ['new token launches', '/v1/launches'],
  ['memecoin sniper feed', '/v1/launches'],
  ['batch token risk', '/v1/risk-batch'],
  ['aave health factor', '/v1/lending/health'],
  ['liquidation risk', '/v1/lending/health'],
  ['token approval scanner', '/v1/approval-scan'],
  ['revoke approvals wallet', '/v1/approval-scan'],
  ['wallet safety check', '/v1/wallet-safety'],
  ['decode transaction', '/v1/tx-decode'],
  ['smart contract documentation', '/v1/contract-docs'],
  ['solana rug check', '/v1/solana/token-risk-scan'],
  ['gas price', '/v1/gas'],
];

interface Hit { resource: string; serviceName?: string; quality?: { l30DaysUniquePayers?: number } }

export async function rank(query: string): Promise<{ ours: number | null; ourPath?: string; top: string[] }> {
  const res = await fetch(SEARCH + encodeURIComponent(query), { signal: AbortSignal.timeout(20_000) });
  const json = (await res.json()) as { resources?: Hit[] };
  const list = json.resources ?? [];
  const i = list.findIndex((r) => r.resource.includes(OURS));
  const top = list.slice(0, 3).map((r) => `${new URL(r.resource).host}${new URL(r.resource).pathname}`.slice(0, 60));
  return { ours: i === -1 ? null : i + 1, ourPath: i === -1 ? undefined : new URL(list[i].resource).pathname, top };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let found = 0;
  let top3 = 0;
  for (const [q] of QUERIES) {
    const r = await rank(q);
    if (r.ours) found++;
    if (r.ours && r.ours <= 3) top3++;
    console.log(`${String(r.ours ?? '-').padStart(2)}  ${q.padEnd(38)} ${r.ourPath ?? ''}`.padEnd(80), '| top:', r.top.join('  '));
  }
  console.log(`\nAgentForge in results for ${found}/${QUERIES.length} queries, top 3 for ${top3}.`);
}
