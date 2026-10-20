/**
 * Daily check: which outside agents paid in the last N hours (default 24).
 *
 * One query against the Neon revenue record (`settled` rows), so the database
 * wakes once a day, then each payer is resolved on chain via public RPCs (the
 * store only keeps a salted payer hash) and our buyer test wallets are dropped.
 *
 * Prints `OUTSIDE_PAYMENTS n $total` followed by one line per payment, or
 * `NO_OUTSIDE_PAYMENTS` when there were none.
 *
 * Needs DATABASE_URL (`vercel env pull .env.local`).
 * Usage:  npx tsx scripts/dailyPayments.ts [hours=24]
 */
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });
config({ quiet: true });

import { neon } from '@neondatabase/serverless';

const TEST_PAYERS = new Set([
  '0x794241c8b08c4b91ff840a64ecd74ff9bdf7c135', // Base buyer test wallet
  '2Yz9zLptbTPLzxH1FgZzeQePLBnntvrNUU4qHYweJu6T', // Solana buyer test wallet
]);
const BASE_RPC = 'https://mainnet.base.org';
const SOLANA_RPC = 'https://api.mainnet-beta.solana.com';
const SOLANA_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const hours = Number(process.argv[2] ?? 24);
const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) {
  console.error('DATABASE_URL not set. Run: vercel env pull .env.local');
  process.exit(1);
}

async function rpc(endpoint: string, method: string, params: unknown[]): Promise<any> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(20_000),
  });
  return (await res.json()).result;
}

/** On-chain payer of a settlement tx, or undefined if it can't be resolved. */
async function payerOf(network: string, tx: string): Promise<string | undefined> {
  if (network.startsWith('eip155:')) {
    const receipt = await rpc(BASE_RPC, 'eth_getTransactionReceipt', [tx]);
    const log = receipt?.logs?.find((l: any) => l.topics[0] === TRANSFER_TOPIC);
    return log ? `0x${log.topics[1].slice(-40)}` : undefined;
  }
  const t = await rpc(SOLANA_RPC, 'getTransaction', [tx, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]);
  const post = t?.meta?.postTokenBalances ?? [];
  for (const b of t?.meta?.preTokenBalances ?? []) {
    if (b.mint !== SOLANA_USDC) continue;
    const after = post.find((p: any) => p.accountIndex === b.accountIndex);
    if (after && Number(after.uiTokenAmount.amount) < Number(b.uiTokenAmount.amount)) return b.owner;
  }
  return undefined;
}

const sql = neon(url);
const rows = await sql`
  SELECT ts, name, payment_network, amount_usd::float AS usd, tx_hash
  FROM events
  WHERE kind = 'settled' AND ts > now() - (${hours} || ' hours')::interval
  ORDER BY ts`;

const outside: string[] = [];
let total = 0;
for (const r of rows) {
  const payer = await payerOf(r.payment_network, r.tx_hash).catch(() => undefined);
  if (payer && (TEST_PAYERS.has(payer) || TEST_PAYERS.has(payer.toLowerCase()))) continue;
  total += r.usd;
  const chain = r.payment_network.startsWith('eip155:') ? 'Base' : 'Solana';
  outside.push(`${new Date(r.ts).toISOString()} ${r.name} $${r.usd} on ${chain} from ${payer ?? 'unresolved payer'} tx=${r.tx_hash}`);
}

if (outside.length === 0) {
  console.log(`NO_OUTSIDE_PAYMENTS (last ${hours}h, ${rows.length} test-wallet settlements skipped)`);
} else {
  console.log(`OUTSIDE_PAYMENTS ${outside.length} $${total.toFixed(4)} (last ${hours}h)`);
  for (const line of outside) console.log(line);
}
