#!/usr/bin/env tsx
/**
 * Comprehensive Live Production Test — AgentForge
 *
 * Tests all 14 paid endpoints against https://agentforge-taupe.vercel.app:
 *   1.  Verifies 402 is returned without payment
 *   2.  Completes x402 payment and confirms 200
 *   3.  Validates response against Zod output schema
 *   4.  Reports response time, cache status, and total USDC spent
 */

import dotenv from 'dotenv';
dotenv.config();

import { wrapFetchWithPayment, x402Client } from '@x402/fetch';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { createWalletClient, http, publicActions } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { z } from 'zod';

// ── Import output schemas for validation ────────────────────────────
import { gasOracleOutput }      from '../src/schemas/gasOracle.js';
import { txDecoderOutput }      from '../src/schemas/txDecoder.js';
import { tokenIntelOutput }     from '../src/schemas/tokenIntel.js';
import { approvalScanOutput }   from '../src/schemas/approvalScanner.js';
import { contractDocsOutput }   from '../src/schemas/contractDocs.js';
import { contractMonitorOutput} from '../src/schemas/contractMonitor.js';
import { walletSafetyOutput }   from '../src/schemas/walletSafety.js';
import { tokenResearchOutput }  from '../src/schemas/tokenResearch.js';
import { codeReviewOutput }     from '../src/schemas/codeReview.js';
import { tokenCompareOutput }   from '../src/schemas/tokenCompare.js';
import { sentimentOutput }      from '../src/schemas/sentiment.js';
import { summarizeOutput }      from '../src/schemas/summarize.js';
import { translateOutput }      from '../src/schemas/translate.js';

// ── Config ───────────────────────────────────────────────────────────

const BASE_URL    = 'https://agentforge-taupe.vercel.app';
const PRIVATE_KEY = process.env.TEST_WALLET_PRIVATE_KEY;

if (!PRIVATE_KEY) {
  console.error('ERROR: TEST_WALLET_PRIVATE_KEY not set');
  process.exit(1);
}

// ── Wallet + x402 ───────────────────────────────────────────────────

const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
const walletClient = createWalletClient({ account, chain: base, transport: http() }).extend(publicActions);
const signer = Object.assign(walletClient, { address: account.address });
const client = new x402Client();
registerExactEvmScheme(client, { signer });
const paidFetch = wrapFetchWithPayment(fetch, client);

// ── Result tracking ─────────────────────────────────────────────────

interface TestResult {
  endpoint: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  httpCode: number | null;
  durationMs: number;
  price: number;
  schemaValid: boolean | null;
  note: string;
}

const results: TestResult[] = [];

// ── Helpers ──────────────────────────────────────────────────────────

async function check402(path: string, method: 'GET' | 'POST', body?: unknown): Promise<boolean> {
  const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, opts);
  if (res.status !== 402) {
    console.log(`  ⚠ Expected 402 without payment, got ${res.status}`);
    return false;
  }
  return true;
}

async function runTest<T>(
  endpoint: string,
  price: number,
  method: 'GET' | 'POST',
  body: Record<string, unknown> | null,
  schema: z.ZodType<T> | null,
  validateFn?: (data: T) => string,
): Promise<T | null> {
  const label = `${method} ${endpoint}`;
  process.stdout.write(`\n  Testing ${label} ($${price.toFixed(3)})...\n`);

  // 1. Verify 402 without payment
  const got402 = await check402(endpoint, method, body);
  if (!got402) {
    results.push({ endpoint: label, status: 'FAIL', httpCode: null, durationMs: 0, price, schemaValid: null, note: 'Did not return 402' });
    console.log(`    ✗ FAIL — expected 402 unauthenticated`);
    return null;
  }
  process.stdout.write(`    ✓ 402 confirmed\n`);

  // 2. Pay and get response
  const start = Date.now();
  let httpCode: number | null = null;
  let data: T | null = null;
  let schemaValid: boolean | null = null;
  let note = 'OK';

  try {
    const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const res = await paidFetch(`${BASE_URL}${endpoint}`, opts);
    httpCode = res.status;
    const durationMs = Date.now() - start;

    if (!res.ok) {
      const text = await res.text();
      note = `HTTP ${res.status}: ${text.slice(0, 200)}`;
      results.push({ endpoint: label, status: 'FAIL', httpCode, durationMs, price, schemaValid: null, note });
      console.log(`    ✗ FAIL — ${note}`);
      return null;
    }

    const json = await res.json();
    data = json as T;

    // 3. Schema validation
    if (schema) {
      const parsed = schema.safeParse(json);
      schemaValid = parsed.success;
      if (!parsed.success) {
        const errs = parsed.error.issues.slice(0, 3).map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
        note = `Schema invalid: ${errs}`;
      }
    }

    // 4. Custom validation note
    if (schemaValid !== false && validateFn && data) {
      note = validateFn(data);
    }

    const durationSec = (durationMs / 1000).toFixed(1);
    const schemaIcon = schemaValid === true ? '✓' : schemaValid === false ? '✗' : '–';
    console.log(`    ✓ 200 in ${durationSec}s | schema ${schemaIcon} | ${note}`);
    results.push({ endpoint: label, status: 'PASS', httpCode, durationMs, price, schemaValid, note });
    return data;

  } catch (err) {
    const durationMs = Date.now() - start;
    note = err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200);
    results.push({ endpoint: label, status: 'FAIL', httpCode, durationMs, price, schemaValid: null, note });
    console.log(`    ✗ FAIL — ${note}`);
    return null;
  }
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║     AgentForge — Comprehensive Live Production Test     ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`  Wallet:  ${account.address}`);
  console.log(`  Target:  ${BASE_URL}`);
  console.log(`  Endpoints: 14`);

  // ── 1. GET /v1/ping ──────────────────────────────────────────────
  const pingSchema = z.object({ status: z.string(), message: z.string() });
  await runTest('/v1/ping', 0.001, 'GET', null, pingSchema,
    (d) => `status=${d.status}`);

  // ── 2. GET /v1/gas ───────────────────────────────────────────────
  await runTest('/v1/gas', 0.003, 'GET', null, gasOracleOutput,
    (d) => `chain=${d.chain} slow=${d.currentPrices?.slow?.maxFeePerGas ?? '?'} trend=${d.trend}`);

  // ── 3. POST /v1/tx-decode ────────────────────────────────────────
  await runTest('/v1/tx-decode', 0.01, 'POST',
    { txHash: '0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060', chain: 'ethereum' },
    txDecoderOutput,
    (d) => `method=${d.transaction?.methodName ?? d.decoded?.functionName ?? 'unknown'}`);

  // ── 4. POST /v1/token-intel ──────────────────────────────────────
  await runTest('/v1/token-intel', 0.015, 'POST',
    { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', chain: 'ethereum' },
    tokenIntelOutput,
    (d) => `${d.token?.name ?? '?'} risk=${d.risk?.score ?? '?'}`);

  // ── 5. POST /v1/approval-scan ────────────────────────────────────
  await runTest('/v1/approval-scan', 0.015, 'POST',
    { address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', chain: 'ethereum' },
    approvalScanOutput,
    (d) => `${d.approvals?.length ?? 0} approvals, risk=${d.riskLevel ?? '?'}`);

  // ── 6. POST /v1/contract-docs (USDC — should be pre-cached) ──────
  // Cache hit detection: estimatedCostUsd===0 in metadata (set by cache serve path)
  // AND wall-clock < 5s (live LLM calls take 30-80s)
  console.log('\n  Note: USDC (0xa0b8...) is pre-cached — expect estimatedCostUsd=0 and <5s response');
  const docsStart = Date.now();
  const contractDocsResult = await runTest('/v1/contract-docs', 0.02, 'POST',
    { address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', chain: 'ethereum' },
    contractDocsOutput,
    (d) => {
      const proxy = d.contract?.isProxy ? '[proxy]' : '';
      const zeroCost = (d.metadata?.estimatedCostUsd ?? -1) === 0;
      return `${d.contract?.name ?? '?'} ${proxy} funcs=${d.functions?.length ?? 0} cost=$${d.metadata?.estimatedCostUsd ?? '?'} ${zeroCost ? 'CACHE-HIT✓' : 'live(LLM)'}`;
    });
  const docsWallMs = Date.now() - docsStart;
  if (contractDocsResult) {
    const zeroCost = (contractDocsResult.metadata?.estimatedCostUsd ?? -1) === 0;
    const fastEnough = docsWallMs < 5000;
    if (zeroCost && fastEnough) {
      console.log(`    → Cache HIT ✓ (estimatedCostUsd=0, ${(docsWallMs/1000).toFixed(1)}s)`);
    } else if (zeroCost && !fastEnough) {
      console.log(`    → Cache HIT ✓ cost-wise but slow (${(docsWallMs/1000).toFixed(1)}s) — possible cold start`);
    } else {
      console.log(`    ⚠ Cache MISS — served live, cost=$${contractDocsResult.metadata?.estimatedCostUsd}, ${(docsWallMs/1000).toFixed(1)}s`);
    }
  }

  // ── 7. POST /v1/contract-monitor ────────────────────────────────
  await runTest('/v1/contract-monitor', 0.025, 'POST',
    { address: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', chain: 'ethereum' },
    contractMonitorOutput,
    (d) => `txns=${d.recentActivity?.transactionCount ?? '?'} alert=${d.riskAlert?.level ?? '?'}`);

  // ── 8. POST /v1/wallet-safety ────────────────────────────────────
  await runTest('/v1/wallet-safety', 0.035, 'POST',
    { walletAddress: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', chain: 'ethereum', depth: 'quick' },
    walletSafetyOutput,
    (d) => `risk=${d.overallRisk ?? '?'} score=${d.riskScore ?? '?'}`);

  // ── 9. POST /v1/token-research ───────────────────────────────────
  await runTest('/v1/token-research', 0.04, 'POST',
    { query: 'Wrapped Ether WETH', chain: 'ethereum' },
    tokenResearchOutput,
    (d) => `${d.token?.name ?? '?'} (${d.token?.symbol ?? '?'})`);

  // ── 10. POST /v1/code-review ─────────────────────────────────────
  await runTest('/v1/code-review', 0.05, 'POST',
    {
      code: 'pragma solidity ^0.8.0;\ncontract Simple {\n    uint256 public value;\n    function setValue(uint256 _value) public {\n        value = _value;\n    }\n}',
      language: 'solidity',
    },
    codeReviewOutput,
    (d) => `findings=${d.findings?.length ?? 0} risk=${d.summary?.riskLevel ?? '?'}`);

  // ── 11. POST /v1/token-compare ───────────────────────────────────
  await runTest('/v1/token-compare', 0.08, 'POST',
    {
      primary: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      compare: ['0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'],
      chain: 'ethereum',
    },
    tokenCompareOutput,
    (d) => `compared ${(d.comparisons?.length ?? 0) + 1} tokens`);

  // ── 12. POST /v1/sentiment ───────────────────────────────────────
  await runTest('/v1/sentiment', 0.008, 'POST',
    { text: 'Bitcoin breaks all time high as institutional adoption accelerates' },
    sentimentOutput,
    (d) => `label=${d.label ?? '?'} score=${d.sentiment?.toFixed(2) ?? '?'} conf=${d.confidence?.toFixed(2) ?? '?'}`);

  // ── 13. POST /v1/summarize ───────────────────────────────────────
  await runTest('/v1/summarize', 0.01, 'POST',
    {
      text: 'The Federal Reserve held interest rates steady at its March meeting citing persistent inflation. Chair Powell indicated rate cuts remain possible later in 2026 but emphasized the committee needs more confidence that inflation is moving toward 2 percent.',
      maxLength: 'brief',
    },
    summarizeOutput,
    (d) => `"${(d.summary ?? '').slice(0, 60)}..."`);

  // ── 14. POST /v1/translate ───────────────────────────────────────
  await runTest('/v1/translate', 0.015, 'POST',
    { text: 'The smart contract has been audited and deployed to mainnet', targetLanguage: 'es' },
    translateOutput,
    (d) => `"${(d.translatedText ?? '').slice(0, 60)}"`);

  // ── Summary ──────────────────────────────────────────────────────

  console.log('\n');
  console.log('╔═══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                         FINAL RESULTS                                   ║');
  console.log('╠═══════════╦═══════╦══════════╦════════╦══════════════════════════════════╣');
  console.log('║ Endpoint  ║ HTTP  ║  Time    ║ Schema ║ Note                             ║');
  console.log('╠═══════════╩═══════╩══════════╩════════╩══════════════════════════════════╣');

  let totalCost = 0;
  let passed = 0;
  let failed = 0;

  for (const r of results) {
    const icon   = r.status === 'PASS' ? '✓' : '✗';
    const ep     = r.endpoint.padEnd(36).slice(0, 36);
    const code   = (r.httpCode ?? '---').toString().padEnd(5);
    const time   = r.status === 'PASS' ? `${(r.durationMs / 1000).toFixed(1)}s`.padEnd(8) : '  --  ';
    const schema = r.schemaValid === true ? '✓' : r.schemaValid === false ? '✗' : '–';
    const note   = r.note.slice(0, 32).padEnd(32);
    console.log(`║ ${icon} ${ep} ${code} ${time} ${schema}  ${note} ║`);
    if (r.status === 'PASS') { totalCost += r.price; passed++; }
    else failed++;
  }

  console.log('╠═══════════════════════════════════════════════════════════════════════════╣');
  console.log(`║  ${passed} passed  |  ${failed} failed  |  Total USDC spent: $${totalCost.toFixed(4).padEnd(10)}              ║`);
  console.log('╚═══════════════════════════════════════════════════════════════════════════╝');

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
