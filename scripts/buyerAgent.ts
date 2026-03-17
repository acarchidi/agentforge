/**
 * Autonomous Buyer Agent — End-to-end test of AgentForge on Base mainnet.
 *
 * Tests the full composability flow:
 *   1. GET  /v1/ping           → verify payment works ($0.001)
 *   2. POST /v1/token-research → research "AAVE" ($0.04)
 *   3. POST /v1/contract-docs  → docs for contract found in step 2 ($0.02)
 *   4. POST /v1/contract-monitor → monitor that same contract ($0.025)
 *
 * Total cost: ~$0.086 in real USDC on Base mainnet.
 *
 * Prerequisites:
 *   - TEST_WALLET_PRIVATE_KEY set in .env (funded buyer wallet)
 *   - Wallet has ≥ $0.10 USDC on Base mainnet
 *
 * Usage:
 *   npm run test:buyer-agent
 */

import dotenv from 'dotenv';
dotenv.config();

import { wrapFetchWithPayment, x402Client } from '@x402/fetch';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { createWalletClient, http, publicActions } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';

// ── Config ──────────────────────────────────────────────────────────

const BASE_URL = 'https://agentforge-taupe.vercel.app';
const PRIVATE_KEY = process.env.TEST_WALLET_PRIVATE_KEY;

if (!PRIVATE_KEY) {
  console.error('ERROR: TEST_WALLET_PRIVATE_KEY not set in .env');
  console.error('Generate a wallet:  npm run generate:wallet');
  console.error('Then fund it with USDC on Base mainnet.');
  process.exit(1);
}

// ── Wallet + x402 client setup ──────────────────────────────────────

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

// ── Types ───────────────────────────────────────────────────────────

interface RelatedService {
  endpoint: string;
  description: string;
  suggestedInput: Record<string, unknown>;
}

interface StepResult {
  name: string;
  endpoint: string;
  price: string;
  status: 'PASS' | 'FAIL';
  durationMs: number;
  summary: string;
}

// ── Helpers ─────────────────────────────────────────────────────────

const results: StepResult[] = [];

async function step<T>(
  name: string,
  endpoint: string,
  price: string,
  fn: () => Promise<T>,
): Promise<T | null> {
  const start = Date.now();
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  STEP: ${name}`);
  console.log(`  ${endpoint}  (${price})`);
  console.log('═'.repeat(60));

  try {
    const result = await fn();
    const durationMs = Date.now() - start;
    console.log(`  ✓ PASS (${(durationMs / 1000).toFixed(1)}s)`);
    results.push({ name, endpoint, price, status: 'PASS', durationMs, summary: 'OK' });
    return result;
  } catch (err) {
    const durationMs = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ✗ FAIL: ${msg}`);
    results.push({ name, endpoint, price, status: 'FAIL', durationMs, summary: msg });
    return null;
  }
}

async function paidGet<T>(url: string): Promise<T> {
  const res = await paidFetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

async function paidPost<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const res = await paidFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

// ── Main flow ───────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║        AgentForge Buyer Agent — Base Mainnet            ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`  Wallet:  ${account.address}`);
  console.log(`  Target:  ${BASE_URL}`);
  console.log(`  Network: Base (mainnet)`);

  // ── Step 1: Ping ──────────────────────────────────────────────────

  const ping = await step(
    'Verify payment flow',
    'GET /v1/ping',
    '$0.001',
    () => paidGet<{ status: string; message: string }>(`${BASE_URL}/v1/ping`),
  );

  if (!ping) {
    console.error('\nPing failed — aborting. Check wallet balance and network.');
    process.exit(1);
  }
  console.log(`  Message: ${ping.message}`);

  // ── Step 2: Token Research ────────────────────────────────────────

  const research = await step(
    'Research AAVE token',
    'POST /v1/token-research',
    '$0.04',
    () =>
      paidPost<{
        token: { name: string; symbol: string; address?: string; chain: string };
        marketData?: { priceUsd: number | null; marketCap: number | null };
        riskAssessment?: { overallScore: number; riskLevel: string; summary: string };
        relatedServices?: RelatedService[];
      }>(`${BASE_URL}/v1/token-research`, { query: 'AAVE' }),
  );

  if (!research) {
    console.error('\nToken research failed — aborting.');
    process.exit(1);
  }

  console.log(`  Token:  ${research.token.name} (${research.token.symbol})`);
  if (research.marketData?.priceUsd) {
    console.log(`  Price:  $${research.marketData.priceUsd.toLocaleString()}`);
  }
  if (research.riskAssessment) {
    console.log(`  Risk:   ${research.riskAssessment.riskLevel} (score: ${research.riskAssessment.overallScore}/100)`);
  }

  // ── Extract contract address from relatedServices ─────────────────

  let contractAddress: string | undefined;
  let contractChain = 'ethereum';

  // First try relatedServices suggestedInput
  if (research.relatedServices) {
    console.log(`\n  relatedServices (${research.relatedServices.length} suggestions):`);
    for (const svc of research.relatedServices) {
      console.log(`    → ${svc.endpoint}: ${svc.description}`);
      if (svc.suggestedInput?.address && !contractAddress) {
        contractAddress = svc.suggestedInput.address as string;
        contractChain = (svc.suggestedInput.chain as string) ?? contractChain;
      }
    }
  }

  // Fallback to token.address from the response
  if (!contractAddress && research.token.address) {
    contractAddress = research.token.address;
    contractChain = research.token.chain;
  }

  // Last resort: well-known AAVE token contract on Ethereum
  if (!contractAddress) {
    contractAddress = '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9';
    contractChain = 'ethereum';
    console.log('\n  No address in response — using known AAVE contract as fallback');
  }

  console.log(`\n  Extracted address: ${contractAddress} (${contractChain})`);

  // ── Step 3: Contract Docs ─────────────────────────────────────────

  const docs = await step(
    'Generate contract documentation',
    'POST /v1/contract-docs',
    '$0.02',
    () =>
      paidPost<{
        contract: { name: string | null; isVerified: boolean; isProxy: boolean };
        summary: { totalFunctions: number; riskLevel: string; overview: string };
        relatedServices?: RelatedService[];
      }>(`${BASE_URL}/v1/contract-docs`, { address: contractAddress, chain: contractChain }),
  );

  if (docs) {
    console.log(`  Contract: ${docs.contract.name ?? 'Unknown'}`);
    console.log(`  Verified: ${docs.contract.isVerified}  Proxy: ${docs.contract.isProxy}`);
    console.log(`  Functions: ${docs.summary.totalFunctions}  Risk: ${docs.summary.riskLevel}`);
    console.log(`  Overview: ${docs.summary.overview.slice(0, 120)}...`);
  }

  // ── Step 4: Contract Monitor ──────────────────────────────────────

  const monitor = await step(
    'Monitor contract admin activity',
    'POST /v1/contract-monitor',
    '$0.025',
    () =>
      paidPost<{
        contract: { name: string | null };
        recentActivity: { transactionCount: number; adminTransactions: { functionName: string; summary: string }[] };
        riskAlert: { level: string; alerts: string[]; recommendation: string };
      }>(`${BASE_URL}/v1/contract-monitor`, { address: contractAddress, chain: contractChain }),
  );

  if (monitor) {
    console.log(`  Transactions (24h): ${monitor.recentActivity.transactionCount}`);
    console.log(`  Admin txns: ${monitor.recentActivity.adminTransactions.length}`);
    console.log(`  Risk alert: ${monitor.riskAlert.level}`);
    if (monitor.riskAlert.alerts.length > 0) {
      for (const alert of monitor.riskAlert.alerts.slice(0, 3)) {
        console.log(`    ⚠ ${alert}`);
      }
    }
    console.log(`  Recommendation: ${monitor.riskAlert.recommendation.slice(0, 120)}`);
  }

  // ── Summary ───────────────────────────────────────────────────────

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║                     SUMMARY                             ║');
  console.log('╠══════════════════════════════════════════════════════════╣');

  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  let totalCost = 0;

  for (const r of results) {
    const icon = r.status === 'PASS' ? '✓' : '✗';
    const time = (r.durationMs / 1000).toFixed(1);
    console.log(`║  ${icon} ${r.name.padEnd(35)} ${r.price.padEnd(8)} ${time}s`);
    if (r.status === 'PASS') {
      totalCost += Number.parseFloat(r.price.replace('$', ''));
    }
  }

  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  Results: ${passed} passed, ${failed} failed`);
  console.log(`║  Total USDC spent: ~$${totalCost.toFixed(4)}`);
  console.log(`║  Wallet: ${account.address}`);
  console.log('╚══════════════════════════════════════════════════════════╝');

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
