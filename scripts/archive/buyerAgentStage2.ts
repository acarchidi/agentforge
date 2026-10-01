/**
 * Stage 2 Buyer Agent — Triggers mainnet payments on the 2 endpoints
 * added in v1.4.0 that buyerAgentFull.ts predates:
 *   POST /v1/token-risk-metrics ($0.008)
 *   GET  /v1/pool-snapshot      ($0.01)
 *
 * Usage:  npx tsx scripts/buyerAgentStage2.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import { wrapFetchWithPayment, x402Client } from '@x402/fetch';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { createWalletClient, http, publicActions } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';

const BASE_URL = 'https://agentforge-taupe.vercel.app';
const PRIVATE_KEY = process.env.TEST_WALLET_PRIVATE_KEY;

if (!PRIVATE_KEY) {
  console.error('ERROR: TEST_WALLET_PRIVATE_KEY not set in .env');
  process.exit(1);
}

const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);

const walletClient = createWalletClient({
  account,
  chain: base,
  transport: http(),
}).extend(publicActions);

const signer = Object.assign(walletClient, { address: account.address });

const client = new x402Client();
registerExactEvmScheme(client, { signer });

const paidFetch = wrapFetchWithPayment(fetch, client);

async function step(name: string, endpoint: string, price: string, fn: () => Promise<Response>) {
  const start = Date.now();
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${name}`);
  console.log(`  ${endpoint}  (${price})`);
  console.log('─'.repeat(60));
  try {
    const res = await fn();
    const durationMs = Date.now() - start;
    if (!res.ok) {
      const text = await res.text();
      console.error(`  ✗ FAIL HTTP ${res.status}: ${text.slice(0, 200)}`);
      return;
    }
    const json = await res.json();
    console.log(`  ✓ PASS (${(durationMs / 1000).toFixed(1)}s)`);
    console.log(`  ${JSON.stringify(json).slice(0, 200)}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ✗ FAIL: ${msg.slice(0, 200)}`);
  }
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║   AgentForge Stage 2 Buyer Agent                         ║');
  console.log('║   Base Mainnet — token-risk-metrics + pool-snapshot      ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`  Wallet:  ${account.address}`);
  console.log(`  Target:  ${BASE_URL}`);

  await step('Token Risk Metrics', 'POST /v1/token-risk-metrics', '$0.008', () =>
    paidFetch(`${BASE_URL}/v1/token-risk-metrics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', chain: 'ethereum' }),
    }),
  );

  await step('Pool Snapshot', 'GET /v1/pool-snapshot', '$0.01', () =>
    paidFetch(`${BASE_URL}/v1/pool-snapshot`),
  );

  console.log(`\n${'═'.repeat(60)}`);
  console.log('  Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
