/**
 * Full Buyer Agent — Triggers mainnet payments on ALL 14 endpoints
 * so each appears in the x402 Bazaar / x402scan.
 *
 * Endpoints already covered by buyerAgent.ts (4):
 *   ping, token-research, contract-docs, contract-monitor
 *
 * NEW endpoints this script covers (10):
 *   gas, tx-decode, token-intel, approval-scan, wallet-safety,
 *   code-review, token-compare, sentiment, summarize, translate
 *
 * Total cost for new endpoints: ~$0.241 USDC on Base mainnet.
 *
 * Usage:  npx tsx scripts/buyerAgentFull.ts
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

// ── Helpers ─────────────────────────────────────────────────────────

interface StepResult {
  name: string;
  endpoint: string;
  price: string;
  status: 'PASS' | 'FAIL';
  durationMs: number;
  summary: string;
}

const results: StepResult[] = [];

async function step<T>(
  name: string,
  endpoint: string,
  price: string,
  fn: () => Promise<T>,
): Promise<T | null> {
  const start = Date.now();
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${name}`);
  console.log(`  ${endpoint}  (${price})`);
  console.log('─'.repeat(60));

  try {
    const result = await fn();
    const durationMs = Date.now() - start;
    console.log(`  ✓ PASS (${(durationMs / 1000).toFixed(1)}s)`);
    results.push({ name, endpoint, price, status: 'PASS', durationMs, summary: 'OK' });
    return result;
  } catch (err) {
    const durationMs = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ✗ FAIL: ${msg.slice(0, 200)}`);
    results.push({ name, endpoint, price, status: 'FAIL', durationMs, summary: msg.slice(0, 200) });
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
  console.log('║   AgentForge Full Buyer Agent — All Endpoints           ║');
  console.log('║   Base Mainnet — Bazaar Cataloging                      ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`  Wallet:  ${account.address}`);
  console.log(`  Target:  ${BASE_URL}`);

  // ── 1. Ping (already done, but cheap to re-verify) ────────────────

  await step('Ping', 'GET /v1/ping', '$0.001', () =>
    paidGet<{ status: string }>(`${BASE_URL}/v1/ping`),
  );

  // ── 2. Gas ────────────────────────────────────────────────────────

  await step('Gas Oracle', 'GET /v1/gas', '$0.003', () =>
    paidGet<{ chain: string; currentPrices: unknown }>(`${BASE_URL}/v1/gas`),
  );

  // ── 3. Tx Decode ──────────────────────────────────────────────────

  await step('Tx Decode', 'POST /v1/tx-decode', '$0.01', () =>
    paidPost<{ transaction: unknown; explanation: string }>(`${BASE_URL}/v1/tx-decode`, {
      txHash: '0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060',
      chain: 'ethereum',
    }),
  );

  // ── 4. Token Intel ────────────────────────────────────────────────

  await step('Token Intel', 'POST /v1/token-intel', '$0.015', () =>
    paidPost<{ token: unknown }>(`${BASE_URL}/v1/token-intel`, {
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      chain: 'ethereum',
    }),
  );

  // ── 5. Approval Scan ──────────────────────────────────────────────

  await step('Approval Scan', 'POST /v1/approval-scan', '$0.015', () =>
    paidPost<{ wallet: unknown; summary: unknown }>(`${BASE_URL}/v1/approval-scan`, {
      address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      chain: 'ethereum',
    }),
  );

  // ── 6. Wallet Safety ──────────────────────────────────────────────

  await step('Wallet Safety', 'POST /v1/wallet-safety', '$0.035', () =>
    paidPost<{ walletAddress: string; overallRisk: string }>(`${BASE_URL}/v1/wallet-safety`, {
      walletAddress: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      chain: 'ethereum',
      depth: 'quick',
    }),
  );

  // ── 7. Code Review ────────────────────────────────────────────────

  await step('Code Review', 'POST /v1/code-review', '$0.05', () =>
    paidPost<{ overallRisk: string; issues: unknown[] }>(`${BASE_URL}/v1/code-review`, {
      code: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract SimpleVault {
    mapping(address => uint256) public balances;

    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }

    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "Insufficient");
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "Transfer failed");
        balances[msg.sender] -= amount;
    }
}`,
      language: 'solidity',
      focus: 'security',
    }),
  );

  // ── 8. Token Compare ──────────────────────────────────────────────

  await step('Token Compare', 'POST /v1/token-compare', '$0.08', () =>
    paidPost<{ primary: unknown; analysis: string }>(`${BASE_URL}/v1/token-compare`, {
      primary: 'AAVE',
      compare: ['COMP'],
      chain: 'ethereum',
    }),
  );

  // ── 9. Sentiment ──────────────────────────────────────────────────

  await step('Sentiment', 'POST /v1/sentiment', '$0.008', () =>
    paidPost<{ sentiment: number; label: string }>(`${BASE_URL}/v1/sentiment`, {
      text: 'Bitcoin is showing strong momentum after breaking resistance at 95k',
    }),
  );

  // ── 10. Summarize ─────────────────────────────────────────────────

  await step('Summarize', 'POST /v1/summarize', '$0.01', () =>
    paidPost<{ summary: string }>(`${BASE_URL}/v1/summarize`, {
      text: 'The Federal Reserve held interest rates steady at its March meeting, citing persistent inflation concerns. Chair Powell indicated that rate cuts remain possible later in 2026 but emphasized the committee needs more confidence that inflation is moving sustainably toward 2 percent. Markets reacted positively to the dovish tone, with major indices closing higher.',
      maxLength: 'brief',
    }),
  );

  // ── 11. Translate ─────────────────────────────────────────────────

  await step('Translate', 'POST /v1/translate', '$0.015', () =>
    paidPost<{ translatedText: string }>(`${BASE_URL}/v1/translate`, {
      text: 'The smart contract has been audited and deployed to mainnet',
      targetLanguage: 'es',
    }),
  );

  // ── 12–14. Already covered endpoints (token-research, contract-docs, contract-monitor)
  // Run them again to confirm they're still working

  await step('Token Research', 'POST /v1/token-research', '$0.04', () =>
    paidPost<{ token: unknown }>(`${BASE_URL}/v1/token-research`, {
      query: 'USDC',
    }),
  );

  await step('Contract Docs', 'POST /v1/contract-docs', '$0.02', () =>
    paidPost<{ contract: unknown }>(`${BASE_URL}/v1/contract-docs`, {
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      chain: 'ethereum',
    }),
  );

  await step('Contract Monitor', 'POST /v1/contract-monitor', '$0.025', () =>
    paidPost<{ contract: unknown }>(`${BASE_URL}/v1/contract-monitor`, {
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      chain: 'ethereum',
    }),
  );

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
    console.log(`║  ${icon} ${r.name.padEnd(22)} ${r.endpoint.padEnd(26)} ${r.price.padEnd(8)} ${time}s`);
    if (r.status === 'PASS') {
      totalCost += Number.parseFloat(r.price.replace('$', ''));
    }
  }

  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  Results: ${passed} passed, ${failed} failed`);
  console.log(`║  Total USDC spent: ~$${totalCost.toFixed(4)}`);
  console.log(`║  Endpoints cataloged: ${passed}/14`);
  console.log('╚══════════════════════════════════════════════════════════╝');

  if (failed > 0) {
    console.log('\nFailed endpoints:');
    for (const r of results.filter((r) => r.status === 'FAIL')) {
      console.log(`  ✗ ${r.name}: ${r.summary}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
