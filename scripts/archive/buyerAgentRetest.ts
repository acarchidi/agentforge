/**
 * Targeted re-test: gas, tx-decode, and the six LLM endpoints
 * broken by (1) the decommissioned model ID and (2) the temperature
 * param, now fixed. Also exercises the ETHERSCAN_API_KEY fix (gas,
 * tx-decode).
 *
 * Usage:  npx tsx scripts/buyerAgentRetest.ts
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
const walletClient = createWalletClient({ account, chain: base, transport: http() }).extend(publicActions);
const signer = Object.assign(walletClient, { address: account.address });
const client = new x402Client();
registerExactEvmScheme(client, { signer });
const paidFetch = wrapFetchWithPayment(fetch, client);

const results: { name: string; status: 'PASS' | 'FAIL'; detail: string }[] = [];

async function step(name: string, fn: () => Promise<Response>) {
  console.log(`\n--- ${name} ---`);
  try {
    const res = await fn();
    if (!res.ok) {
      const text = await res.text();
      console.error(`FAIL HTTP ${res.status}: ${text.slice(0, 200)}`);
      results.push({ name, status: 'FAIL', detail: `HTTP ${res.status}: ${text.slice(0, 150)}` });
      return;
    }
    const json = await res.json();
    console.log('PASS:', JSON.stringify(json).slice(0, 150));
    results.push({ name, status: 'PASS', detail: 'OK' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('FAIL:', msg.slice(0, 200));
    results.push({ name, status: 'FAIL', detail: msg.slice(0, 150) });
  }
}

async function main() {
  console.log('Wallet:', account.address);

  await step('Gas Oracle', () => paidFetch(`${BASE_URL}/v1/gas`));

  await step('Tx Decode', () =>
    paidFetch(`${BASE_URL}/v1/tx-decode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        txHash: '0xb7219192723c6a9ee77cd56ffdd28805d6177f76ffe0d34260bb5dc76abf19cf',
        chain: 'ethereum',
      }),
    }),
  );

  await step('Token Intel', () =>
    paidFetch(`${BASE_URL}/v1/token-intel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', chain: 'ethereum' }),
    }),
  );

  await step('Code Review', () =>
    paidFetch(`${BASE_URL}/v1/code-review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: 'pragma solidity ^0.8.0;\ncontract Example {\n  function withdraw() public {\n    payable(msg.sender).transfer(address(this).balance);\n  }\n}',
        language: 'solidity',
        focus: 'security',
      }),
    }),
  );

  await step('Token Compare', () =>
    paidFetch(`${BASE_URL}/v1/token-compare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ primary: 'AAVE', compare: ['COMP'], chain: 'ethereum' }),
    }),
  );

  await step('Sentiment', () =>
    paidFetch(`${BASE_URL}/v1/sentiment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Bitcoin is showing strong momentum after breaking resistance at 95k' }),
    }),
  );

  await step('Summarize', () =>
    paidFetch(`${BASE_URL}/v1/summarize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'DeFi lending protocols allow users to lend and borrow crypto assets without intermediaries. Borrowers must over-collateralize their loans, and positions that fall below a required collateral ratio are liquidated to protect lenders.',
        maxLength: 'brief',
      }),
    }),
  );

  await step('Translate', () =>
    paidFetch(`${BASE_URL}/v1/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Hello, how are you?', targetLanguage: 'Spanish' }),
    }),
  );

  console.log('\n=== SUMMARY ===');
  for (const r of results) console.log(`${r.status === 'PASS' ? '✓' : '✗'} ${r.name}: ${r.detail}`);
  const passed = results.filter((r) => r.status === 'PASS').length;
  console.log(`\n${passed}/${results.length} passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
