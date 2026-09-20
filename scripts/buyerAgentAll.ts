/**
 * Buyer agent — pays every paid endpoint ONCE on Base mainnet so the CDP
 * discovery index re-catalogs each resource with current metadata.
 *
 * Cost: sum of all endpoint prices (~$0.89 USDC at current pricing).
 *
 * Usage:  npx tsx scripts/buyerAgentAll.ts [--only ping,gas,...]
 */
import dotenv from 'dotenv';
dotenv.config();

import { wrapFetchWithPayment, x402Client } from '@x402/fetch';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { createWalletClient, http, publicActions } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';

const BASE_URL = process.env.BUYER_BASE_URL ?? 'https://agentforge-taupe.vercel.app';
const PRIVATE_KEY = process.env.TEST_WALLET_PRIVATE_KEY;
if (!PRIVATE_KEY) {
  console.error('ERROR: TEST_WALLET_PRIVATE_KEY not set in .env');
  process.exit(1);
}

const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
const walletClient = createWalletClient({ account, chain: base, transport: http() }).extend(publicActions);
const client = new x402Client();
registerExactEvmScheme(client, { signer: Object.assign(walletClient, { address: account.address }) });
const paidFetch = wrapFetchWithPayment(fetch, client);

const SAMPLE_CONTRACT = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'; // Uniswap V2 Router
const SAMPLE_WALLET = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'; // vitalik.eth
const SAMPLE_SOL_SIG = '5VfydnLu4XwH6dEufsQEnCidCXfE6xVzX3JAiG8g3q4pump1SVpMwrz4gYbBw2eeqUJgvV6ySMWtCXjPz3jq2CR1';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

interface Call { name: string; method: 'GET' | 'POST'; path: string; body?: unknown }

const CALLS: Call[] = [
  { name: 'ping', method: 'GET', path: '/v1/ping' },
  { name: 'gas', method: 'GET', path: '/v1/gas?chain=base' },
  { name: 'pool-snapshot', method: 'GET', path: '/v1/pool-snapshot?chain=ethereum&limit=3' },
  { name: 'token-intel', method: 'POST', path: '/v1/token-intel', body: { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', chain: 'ethereum' } },
  { name: 'token-research', method: 'POST', path: '/v1/token-research', body: { query: 'AAVE', chain: 'ethereum' } },
  { name: 'token-compare', method: 'POST', path: '/v1/token-compare', body: { primary: 'AAVE', compare: ['COMP'], chain: 'ethereum' } },
  { name: 'contract-docs', method: 'POST', path: '/v1/contract-docs', body: { address: SAMPLE_CONTRACT, chain: 'ethereum' } },
  { name: 'contract-monitor', method: 'POST', path: '/v1/contract-monitor', body: { address: SAMPLE_CONTRACT, chain: 'ethereum', lookbackHours: 24 } },
  { name: 'tx-decode', method: 'POST', path: '/v1/tx-decode', body: { txHash: '0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060', chain: 'ethereum' } },
  { name: 'approval-scan', method: 'POST', path: '/v1/approval-scan', body: { address: SAMPLE_WALLET, chain: 'ethereum' } },
  { name: 'wallet-safety', method: 'POST', path: '/v1/wallet-safety', body: { walletAddress: SAMPLE_WALLET, chain: 'ethereum', depth: 'quick' } },
  { name: 'token-risk-metrics', method: 'POST', path: '/v1/token-risk-metrics', body: { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', chain: 'ethereum' } },
  { name: 'code-review', method: 'POST', path: '/v1/code-review', body: { code: 'pragma solidity ^0.8.0; contract A { function f() external payable {} }', language: 'solidity', focus: 'security' } },
  { name: 'sentiment', method: 'POST', path: '/v1/sentiment', body: { text: 'ETH ETF inflows hit a record this week.', context: 'crypto' } },
  { name: 'summarize', method: 'POST', path: '/v1/summarize', body: { text: 'AgentForge is a DeFi safety layer for AI agents. It exposes paid x402 endpoints for wallet safety, token risk, and Solana transaction simulation.', maxLength: 'brief' } },
  { name: 'translate', method: 'POST', path: '/v1/translate', body: { text: 'Check the token before you trade.', targetLanguage: 'Spanish' } },
  { name: 'solana/tx-explain', method: 'POST', path: '/v1/solana/tx-explain', body: { signature: SAMPLE_SOL_SIG } },
  { name: 'solana/token-risk-scan', method: 'POST', path: '/v1/solana/token-risk-scan', body: { mint: USDC_MINT } },
  { name: 'solana/tx-simulate', method: 'POST', path: '/v1/solana/tx-simulate', body: { transaction: process.env.SAMPLE_SOL_TX_BASE64 ?? '' } },
];

const only = process.argv.includes('--only')
  ? process.argv[process.argv.indexOf('--only') + 1].split(',')
  : null;

async function main() {
  console.log(`Buyer: ${account.address} → ${BASE_URL}`);
  const results: Array<{ name: string; status: number; ms: number; tx?: string; note?: string }> = [];
  for (const c of CALLS) {
    if (only && !only.includes(c.name)) continue;
    const t = Date.now();
    try {
      const res = await paidFetch(`${BASE_URL}${c.path}`, {
        method: c.method,
        headers: c.body ? { 'content-type': 'application/json' } : undefined,
        body: c.body ? JSON.stringify(c.body) : undefined,
      });
      const pr = res.headers.get('payment-response');
      let tx: string | undefined;
      if (pr) {
        try { tx = JSON.parse(Buffer.from(pr, 'base64').toString()).transaction; } catch { /* ignore */ }
      }
      const text = await res.text();
      results.push({ name: c.name, status: res.status, ms: Date.now() - t, tx, note: res.ok ? undefined : text.slice(0, 120) });
      console.log(`${res.ok ? 'PASS' : 'FAIL'} ${c.name} ${res.status} ${Date.now() - t}ms ${tx ? `tx=${tx.slice(0, 12)}…` : ''} ${res.ok ? '' : text.slice(0, 120)}`);
    } catch (error) {
      results.push({ name: c.name, status: 0, ms: Date.now() - t, note: error instanceof Error ? error.message.slice(0, 160) : String(error) });
      console.log(`FAIL ${c.name} ERR ${error instanceof Error ? error.message.slice(0, 160) : error}`);
    }
  }
  const settled = results.filter((r) => r.tx).length;
  console.log(`\nSettled ${settled}/${results.length}`);
  console.log(JSON.stringify(results, null, 1));
}

main().catch((e) => { console.error(e); process.exit(1); });
