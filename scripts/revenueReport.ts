/**
 * Revenue report from the production analytics store (Neon).
 *
 * `settled` rows are written after each on-chain settlement and carry the tx hash,
 * so they are the revenue record. `paid` rows carry the LLM cost estimate per call.
 *
 * Needs DATABASE_URL: `vercel env pull .env.local` writes it.
 *
 * Usage:  npx tsx scripts/revenueReport.ts [days=30]
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
config();

import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) {
  console.error('DATABASE_URL not set. Run: vercel env pull .env.local');
  process.exit(1);
}
const days = Number(process.argv[2] ?? 30);
const sql = neon(url);

const byEndpoint = await sql`
  SELECT s.name AS endpoint,
         COUNT(*)::int AS settlements,
         COUNT(DISTINCT s.client_hash)::int AS payers,
         ROUND(SUM(s.amount_usd), 4)::float AS revenue_usd,
         (SELECT ROUND(COALESCE(SUM(p.estimated_cost_usd), 0), 4)::float FROM events p
           WHERE p.kind = 'paid' AND p.success AND p.name = s.name
             AND p.ts > now() - (${days} || ' days')::interval) AS llm_cost_usd
  FROM events s
  WHERE s.kind = 'settled' AND s.ts > now() - (${days} || ' days')::interval
  GROUP BY s.name ORDER BY revenue_usd DESC`;

const failed = await sql`
  SELECT name AS endpoint, error_class, COUNT(*)::int AS count FROM events
  WHERE kind = 'settle_failed' AND ts > now() - (${days} || ' days')::interval
  GROUP BY name, error_class ORDER BY count DESC`;

const recent = await sql`
  SELECT ts, name AS endpoint, payment_network AS network, amount_usd::float AS usd, tx_hash
  FROM events WHERE kind = 'settled' ORDER BY ts DESC LIMIT 10`;

const total = byEndpoint.reduce((s, r) => s + Number(r.revenue_usd), 0);
const cost = byEndpoint.reduce((s, r) => s + Number(r.llm_cost_usd), 0);
console.log(`\nSettled revenue, last ${days} days: $${total.toFixed(4)}  (LLM cost $${cost.toFixed(4)}, gross $${(total - cost).toFixed(4)})\n`);
console.table(byEndpoint);
if (failed.length) {
  console.log('\nSettlement failures:');
  console.table(failed);
}
console.log('\nMost recent settlements:');
console.table(recent);
