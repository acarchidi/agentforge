/**
 * x402-enabled test client.
 * Tests the full payment flow against a running AgentForge server.
 *
 * Usage:
 *   TEST_WALLET_PRIVATE_KEY=0x... AGENTFORGE_URL=http://localhost:3402 npx tsx scripts/testClient.ts
 *
 * Prerequisites:
 *   - Server running (npm run dev)
 *   - A wallet with testnet USDC on Base Sepolia
 *   - Get testnet USDC from https://faucet.circle.com
 */

import dotenv from 'dotenv';
dotenv.config();

import { wrapFetchWithPayment, x402Client } from '@x402/fetch';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { createWalletClient, http, publicActions } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';

const SERVER_URL = process.env.AGENTFORGE_URL || 'http://localhost:3402';
const PRIVATE_KEY = process.env.TEST_WALLET_PRIVATE_KEY;

async function testFreeEndpoints() {
  console.log('--- Testing Free Endpoints ---\n');

  const healthRes = await fetch(`${SERVER_URL}/health`);
  const health = (await healthRes.json()) as { status: string };
  console.log(
    'GET /health:',
    health.status === 'ok' ? 'PASS' : 'FAIL',
    health,
  );

  const catalogRes = await fetch(`${SERVER_URL}/catalog`);
  const catalog = (await catalogRes.json()) as { services: unknown[] };
  console.log(
    'GET /catalog:',
    catalog.services?.length >= 5 ? 'PASS' : 'FAIL',
    `(${catalog.services?.length} services)`,
  );
}

async function testPaidEndpointWithout402() {
  console.log('\n--- Testing Paid Endpoints (expect 402) ---\n');

  const endpoints = [
    { path: '/v1/sentiment', body: { text: 'Bitcoin to the moon!' } },
    { path: '/v1/summarize', body: { text: 'This is a test document.' } },
    { path: '/v1/token-intel', body: { address: '0xabc' } },
    { path: '/v1/code-review', body: { code: 'pragma solidity ^0.8.0;' } },
    {
      path: '/v1/translate',
      body: { text: 'Hello', targetLanguage: 'Spanish' },
    },
  ];

  for (const ep of endpoints) {
    const res = await fetch(`${SERVER_URL}${ep.path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ep.body),
    });
    console.log(
      `POST ${ep.path}:`,
      res.status === 402 ? 'PASS (402)' : `UNEXPECTED (${res.status})`,
    );
  }
}

async function testPaidEndpointWithPayment() {
  if (!PRIVATE_KEY) {
    console.log('\n--- Skipping x402 Payment Test (no private key) ---');
    console.log('Set TEST_WALLET_PRIVATE_KEY in .env to test payment flow.');
    console.log('Generate one with: npm run generate:wallet');
    console.log(
      'Fund it with testnet USDC from: https://faucet.circle.com\n',
    );
    return;
  }

  console.log('\n--- Testing x402 Payment Flow ---\n');

  try {
    const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
    console.log(`Using wallet: ${account.address}`);

    const walletClient = createWalletClient({
      account,
      chain: baseSepolia,
      transport: http(),
    }).extend(publicActions);

    // x402 expects signer.address at top level, but viem puts it at .account.address
    const signer = Object.assign(walletClient, { address: account.address });

    const client = new x402Client();
    registerExactEvmScheme(client, { signer });

    const paidFetch = wrapFetchWithPayment(fetch, client);

    // Debug: check the 402 response first
    const debugRes = await fetch(`${SERVER_URL}/v1/sentiment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'test' }),
    });
    const paymentHeader = debugRes.headers.get('payment-required');
    if (paymentHeader) {
      const decoded = JSON.parse(Buffer.from(paymentHeader, 'base64').toString());
      console.log('402 payment details:', JSON.stringify(decoded.accepts[0], null, 2));
    }

    console.log('Sending paid request to /v1/sentiment...');
    const response = await paidFetch(`${SERVER_URL}/v1/sentiment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'Bitcoin is looking strong today! Great momentum.',
      }),
    });

    if (response.ok) {
      const result = await response.json();
      console.log('PASS: Got response with payment!');
      console.log('Result:', JSON.stringify(result, null, 2));
    } else {
      console.log(`FAIL: Status ${response.status}`);
      const body = await response.text();
      console.log('Response:', body.slice(0, 500));
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error('FAIL:', error.message);
      console.error('Stack:', error.stack);
      if ('cause' in error) {
        console.error('Cause:', (error as any).cause);
      }
    } else {
      console.error('FAIL:', error);
    }
  }
}

async function main() {
  console.log(`Testing AgentForge at ${SERVER_URL}\n`);

  await testFreeEndpoints();
  await testPaidEndpointWithout402();
  await testPaidEndpointWithPayment();

  console.log('\n--- Done ---');
}

main().catch(console.error);
