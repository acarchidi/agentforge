/**
 * Waits for the next settled payment from an outside agent, prints it, and exits.
 *
 * Polls `settled` rows in the Neon analytics store every 60s and resolves each
 * payer on chain (the store only keeps a salted hash), skipping our own buyer
 * test wallets. Exits 0 with one summary line when an outside payment lands.
 *
 * Needs DATABASE_URL (`vercel env pull .env.local`).
 * Usage:  npx tsx scripts/watchPayments.ts
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
const SOLANA_RPC = process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const USDC_SOLANA = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const POLL_MS = 60_000;

const sql = neon((process.env.DATABASE_URL || process.env.POSTGRES_URL) as string);

async function rpc(url: string, method: string, params: unknown[]): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return (await res.json()).result;
}

/** On-chain payer of a settlement tx, or undefined if it can't be resolved yet. */
async function payerOf(network: string, tx: string): Promise<string | undefined> {
  if (network.startsWith('eip155:')) {
    const receipt = await rpc(BASE_RPC, 'eth_getTransactionReceipt', [tx]);
    const log = receipt?.logs?.find((l: any) => l.topics[0] === TRANSFER_TOPIC);
    return log ? `0x${log.topics[1].slice(-40)}` : undefined;
  }
  const t = await rpc(SOLANA_RPC, 'getTransaction', [tx, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]);
  const pre = t?.meta?.preTokenBalances ?? [];
  const post = t?.meta?.postTokenBalances ?? [];
  for (const b of pre) {
    if (b.mint !== USDC_SOLANA) continue;
    const after = post.find((p: any) => p.accountIndex === b.accountIndex);
    if (after && Number(after.uiTokenAmount.amount) < Number(b.uiTokenAmount.amount)) return b.owner;
  }
  return undefined;
}

const [{ max }] = await sql`SELECT COALESCE(MAX(id), 0)::bigint AS max FROM events WHERE kind = 'settled'`;
let lastId = BigInt(process.env.WATCH_AFTER_ID ?? max);
const pending = new Map<string, { attempts: number }>();
console.error(`watching settled payments after id ${lastId}`);

for (;;) {
  try {
    const rows = await sql`
      SELECT id, ts, name, payment_network, amount_usd::float AS usd, tx_hash
      FROM events WHERE kind = 'settled' AND id > ${lastId.toString()} ORDER BY id`;
    for (const r of rows) {
      const payer = await payerOf(r.payment_network, r.tx_hash).catch(() => undefined);
      if (!payer) {
        // RPC may lag the settlement; retry this row a few times before giving up on it.
        const p = pending.get(r.tx_hash) ?? { attempts: 0 };
        if (++p.attempts < 5) { pending.set(r.tx_hash, p); break; }
        console.log(`PAYMENT (payer unresolved) ${r.name} $${r.usd} on ${r.payment_network} tx=${r.tx_hash} at ${new Date(r.ts).toISOString()}`);
        process.exit(0);
      }
      lastId = BigInt(r.id);
      pending.delete(r.tx_hash);
      if (TEST_PAYERS.has(payer) || TEST_PAYERS.has(payer.toLowerCase())) {
        console.error(`skip test-wallet payment ${r.name} ${r.tx_hash}`);
        continue;
      }
      console.log(`PAYMENT ${r.name} $${r.usd} on ${r.payment_network} from ${payer} tx=${r.tx_hash} at ${new Date(r.ts).toISOString()}`);
      process.exit(0);
    }
  } catch (error) {
    console.error('poll failed:', error instanceof Error ? error.message : error);
  }
  await new Promise((r) => setTimeout(r, POLL_MS));
}
