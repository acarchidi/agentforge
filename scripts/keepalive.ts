/**
 * One-command listing keep-alive: pays ONLY the endpoints whose CDP discovery
 * listing lapses within 7 days (or that were never listed), so endpoints real
 * customers keep alive cost nothing.
 *
 * Base endpoints are paid from the Base buyer wallet (TEST_WALLET_PRIVATE_KEY)
 * via buyerAgentAll.ts; the three Solana endpoints from the Solana buyer wallet
 * via buyerAgentSolana.ts. Payments go to our own pay-to address, so the real
 * cost is only fees and the LLM cost of the sample calls.
 *
 * Usage:  npm run keepalive            (pays what's due)
 *         npm run keepalive -- --dry-run  (shows the plan, pays nothing)
 */
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });
config({ quiet: true });

import { spawnSync } from 'node:child_process';
import { createPublicClient, erc20Abi, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { listingStatus } from './lib/listingStatus.js';
import { PUBLIC_BASE_URL, priceFor } from '../src/pricing.js';

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const dryRun = process.argv.includes('--dry-run');

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) {
  console.error('DATABASE_URL not set. Run: vercel env pull .env.local');
  process.exit(1);
}

const status = await listingStatus(url);
const due = status.filter((s) => s.due);
console.log('Listing status (days of CDP listing left; "never" = not listed yet):');
for (const s of status) console.log(`  ${s.due ? 'DUE ' : 'ok  '} ${s.path.padEnd(28)} ${s.daysLeft === null ? 'never listed' : `${s.daysLeft}d left`}`);

if (due.length === 0) {
  console.log('\nNothing is due. No payments made.');
  process.exit(0);
}

// Price from the LIVE catalog: production PRICE_* env vars differ from the
// local .env (e.g. wallet-safety $0.10 live vs $0.035 locally), and budgeting
// with local prices once left code-review unpaid.
const livePrices = new Map<string, number>();
try {
  const cat = (await (await fetch(`${PUBLIC_BASE_URL}/catalog`, { signal: AbortSignal.timeout(15_000) })).json()) as {
    services: Array<{ endpoint: string; price: string }>;
  };
  for (const s of cat.services) {
    const m = /^\$([\d.]+)$/.exec(s.price);
    if (m) livePrices.set(s.endpoint.split(' ')[1], Number(m[1]));
  }
} catch {
  console.log('(Could not read live prices; using local estimates.)');
}
const livePrice = (path: string) => livePrices.get(path) ?? priceFor(path);

const solanaDue = due.filter((s) => s.path.startsWith('/v1/solana/'));
// Cheapest first, so a short balance still renews as many listings as possible.
const baseDue = due
  .filter((s) => !s.path.startsWith('/v1/solana/'))
  .map((s) => ({ ...s, price: livePrice(s.path) }))
  .sort((a, b) => a.price - b.price);

let baseBalance = 0;
const pk = process.env.TEST_WALLET_PRIVATE_KEY;
let buyer = '(TEST_WALLET_PRIVATE_KEY missing)';
if (pk) {
  const account = privateKeyToAccount(pk as `0x${string}`);
  buyer = account.address;
  const client = createPublicClient({ chain: base, transport: http() });
  const raw = await client.readContract({ address: USDC_BASE, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] });
  baseBalance = Number(raw) / 1e6;
}

const affordable: typeof baseDue = [];
let spend = 0;
for (const d of baseDue) {
  if (spend + d.price <= baseBalance) {
    affordable.push(d);
    spend += d.price;
  }
}
const skipped = baseDue.filter((d) => !affordable.includes(d));
const needed = baseDue.reduce((s, d) => s + d.price, 0);

console.log(`\nBase buyer ${buyer}: $${baseBalance.toFixed(3)} USDC`);
console.log(`Will pay ${affordable.length} Base endpoints for ~$${spend.toFixed(3)}${solanaDue.length ? `, plus the Solana endpoints from the Solana wallet` : ''}.`);
if (skipped.length) {
  console.log(`\nNOT ENOUGH USDC for ${skipped.length} more: ${skipped.map((s) => s.path).join(', ')}`);
  console.log(`To cover everything, send $${(needed - baseBalance + 0.05).toFixed(2)} USDC on the Base network to ${buyer}, then run this again.`);
}

if (dryRun) {
  console.log('\nDry run: no payments made.');
  process.exit(0);
}

let failed = false;
if (affordable.length) {
  const names = affordable.map((d) => d.path.replace(/^\/v1\//, '')).join(',');
  const r = spawnSync('npx', ['tsx', 'scripts/buyerAgentAll.ts', '--only', names], { stdio: 'inherit' });
  failed ||= r.status !== 0;
}
if (solanaDue.length) {
  if (!process.env.SOLANA_BUYER_WALLET_PRIVATE_KEY) {
    console.log('\nSolana endpoints are due but SOLANA_BUYER_WALLET_PRIVATE_KEY is not set; skipped.');
  } else {
    const r = spawnSync('npx', ['tsx', 'scripts/buyerAgentSolana.ts', '--all'], { stdio: 'inherit' });
    failed ||= r.status !== 0;
  }
}

if (failed) {
  console.log('\nSome payments failed (see FAIL lines above); those listings were NOT renewed.');
} else if (skipped.length) {
  console.log(`\nRenewed what the balance covered. ${skipped.length} still due — top up as shown above, then run again.`);
} else {
  console.log('\nDone. Listings renewed for another 30 days.');
}
process.exit(failed ? 1 : 0);
