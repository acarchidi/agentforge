/**
 * Growth metrics for the executor log (docs/growth-plan.md §10).
 *
 * One Neon round trip per metric, our own buyer wallets excluded by hashing
 * them with the same salt the store uses, plus npm download counts. Prints a
 * table and a single `METRICS …` line to paste into docs/growth-log.md.
 *
 * Needs DATABASE_URL and ADMIN_TOKEN / ANALYTICS_HASH_SALT (`vercel env pull .env.local`).
 * Usage:  npx tsx scripts/growthMetrics.ts [days=30]
 */
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });
config({ quiet: true });

import { createHash } from 'node:crypto';
import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) {
  console.error('DATABASE_URL not set. Run: vercel env pull .env.local');
  process.exit(1);
}
const days = Number(process.argv[2] ?? 30);
const sql = neon(url);

// Same derivation as src/analytics/clientId.ts (salted sha256 prefix of the lowercase payer).
const SALT = process.env.ANALYTICS_HASH_SALT || process.env.ADMIN_TOKEN || '';
const OWN_WALLETS = [
  '0x794241c8b08c4b91ff840a64ecd74ff9bdf7c135', // Base buyer test wallet
  '2Yz9zLptbTPLzxH1FgZzeQePLBnntvrNUU4qHYweJu6T', // Solana buyer test wallet
];
const ownHashes = OWN_WALLETS.map((w) => createHash('sha256').update(`${SALT}:${w.toLowerCase()}`).digest('hex').slice(0, 16));
if (!SALT) console.warn('warning: no ADMIN_TOKEN/ANALYTICS_HASH_SALT; own wallets cannot be excluded');

const since = `${days} days`;

const [settled] = await sql`
  SELECT COUNT(*)::int AS payments, ROUND(COALESCE(SUM(amount_usd), 0), 4)::float AS usd,
         COUNT(DISTINCT client_hash)::int AS payers
  FROM events WHERE kind = 'settled' AND ts > now() - ${since}::interval
    AND (client_hash IS NULL OR client_hash <> ALL(${ownHashes}))`;

const [repeat] = await sql`
  SELECT COUNT(*)::int AS repeat_payers FROM (
    SELECT client_hash FROM events
    WHERE kind = 'settled' AND client_hash IS NOT NULL AND client_hash <> ALL(${ownHashes})
      AND ts > now() - ${since}::interval
    GROUP BY client_hash HAVING COUNT(DISTINCT date_trunc('day', ts)) >= 2) t`;

const [credits] = await sql`
  SELECT COUNT(*)::int AS packs, ROUND(COALESCE(SUM(amount_usd), 0), 2)::float AS usd, COUNT(DISTINCT client_hash)::int AS buyers
  FROM events WHERE kind = 'settled' AND name = '/v1/credits/buy' AND ts > now() - ${since}::interval
    AND (client_hash IS NULL OR client_hash <> ALL(${ownHashes}))`;

const [creditSpend] = await sql`
  SELECT COUNT(*)::int AS calls, COUNT(DISTINCT client_hash)::int AS wallets
  FROM events WHERE kind = 'paid' AND success AND payment_scheme = 'credits' AND ts > now() - ${since}::interval
    AND (client_hash IS NULL OR client_hash <> ALL(${ownHashes}))`;

// client_tag is written by the server when the SDK sends x-agentforge-client; absent on old rows.
let guardCalls: { calls: number; wallets: number; note: string } = { calls: 0, wallets: 0, note: '' };
try {
  const [g] = await sql`
    SELECT COUNT(*)::int AS calls, COUNT(DISTINCT client_hash)::int AS wallets
    FROM events WHERE kind = 'paid' AND success AND client_tag LIKE '%guard%' AND ts > now() - ${since}::interval
      AND (client_hash IS NULL OR client_hash <> ALL(${ownHashes}))`;
  guardCalls = { calls: g.calls, wallets: g.wallets, note: '' };
} catch {
  guardCalls.note = 'client_tag column not deployed yet';
}

const byEndpoint = await sql`
  SELECT name, COUNT(*)::int AS calls, COUNT(DISTINCT client_hash)::int AS payers
  FROM events WHERE kind = 'settled' AND ts > now() - ${since}::interval
    AND (client_hash IS NULL OR client_hash <> ALL(${ownHashes}))
  GROUP BY name ORDER BY calls DESC LIMIT 8`;

const [mcp] = await sql`
  SELECT COUNT(*)::int AS calls, COUNT(DISTINCT client_hash)::int AS clients
  FROM events WHERE kind = 'mcp' AND ts > now() - ${since}::interval`;

async function npmWeekly(pkg: string): Promise<number | 'n/a'> {
  try {
    const r = await fetch(`https://api.npmjs.org/downloads/point/last-week/${pkg}`, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return 'n/a';
    return Number(((await r.json()) as { downloads?: number }).downloads ?? 0);
  } catch {
    return 'n/a';
  }
}
const [dlTools, dlGuard] = await Promise.all([npmWeekly('agentforge-tools'), npmWeekly('x402-sanctions-guard')]);

console.log(`\nGrowth metrics, last ${days} days (own buyer wallets excluded)\n`);
console.table({
  'outside payments': { value: settled.payments, detail: `$${settled.usd} from ${settled.payers} payers` },
  'repeat payers (paid on 2+ days)': { value: repeat.repeat_payers, detail: '' },
  'credit packs bought': { value: credits.packs, detail: `$${credits.usd} from ${credits.buyers} wallets` },
  'credit-paid calls': { value: creditSpend.calls, detail: `${creditSpend.wallets} wallets` },
  'guard-origin calls': { value: guardCalls.calls, detail: guardCalls.note || `${guardCalls.wallets} wallets` },
  'MCP tool calls': { value: mcp.calls, detail: `${mcp.clients} clients` },
  'npm downloads/week agentforge-tools': { value: dlTools, detail: '' },
  'npm downloads/week x402-sanctions-guard': { value: dlGuard, detail: '' },
});
console.log('Top endpoints by outside settlements:');
console.table(byEndpoint);
console.log(
  `METRICS ${days}d payers=${settled.payers} repeat=${repeat.repeat_payers} payments=${settled.payments} usd=${settled.usd} ` +
    `credit_packs=${credits.packs} credit_calls=${creditSpend.calls} guard_calls=${guardCalls.calls} mcp_calls=${mcp.calls} ` +
    `npm_tools=${dlTools} npm_guard=${dlGuard}`,
);
