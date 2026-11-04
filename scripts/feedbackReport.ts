/**
 * New feedback from POST /feedback, the send_feedback MCP tool and the
 * /contact form, from the production analytics store (Neon).
 *
 * Usage: npx tsx scripts/feedbackReport.ts [hours=24]
 * Output: NO_FEEDBACK, or FEEDBACK <n> followed by one JSON line per entry.
 */
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });
config({ quiet: true });

import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) {
  console.error('DATABASE_URL not set. Run: vercel env pull .env.local');
  process.exit(1);
}
const hours = Number(process.argv[2] ?? 24);
const sql = neon(url);
const rows = await sql`
  SELECT ts, type, endpoint, message, contact FROM feedback
  WHERE ts > now() - (${hours} || ' hours')::interval ORDER BY ts`;
if (rows.length === 0) {
  console.log(`NO_FEEDBACK (last ${hours}h)`);
} else {
  console.log(`FEEDBACK ${rows.length} (last ${hours}h)`);
  for (const r of rows) console.log(JSON.stringify({ ts: r.ts, type: r.type, endpoint: r.endpoint, contact: r.contact, message: r.message }));
}
