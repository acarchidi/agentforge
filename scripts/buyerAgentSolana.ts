/**
 * Solana buyer agent — pays ONE AgentForge Solana endpoint with Solana-mainnet USDC,
 * proving the Solana payment path settles end to end (it never has as of 2026-10-01).
 *
 * Needs SOLANA_BUYER_WALLET_PRIVATE_KEY in .env (base58 or JSON byte array) and a
 * little USDC (~$0.10) in that wallet on Solana mainnet. The facilitator pays SOL fees.
 *
 * Cost: $0.05 USDC (solana/tx-explain). Pass --all to also hit tx-simulate ($0.15)
 * and token-risk-scan ($0.35) — total $0.55.
 *
 * Usage:  npx tsx scripts/buyerAgentSolana.ts [--all]
 */
import dotenv from 'dotenv';
dotenv.config();

import { wrapFetchWithPayment, x402Client } from '@x402/fetch';
import { registerExactSvmScheme } from '@x402/svm/exact/client';
import { createKeyPairSignerFromBytes, getBase58Encoder } from '@solana/kit';

const BASE_URL = process.env.BUYER_BASE_URL ?? 'https://agentforge-taupe.vercel.app';
const RAW_KEY = process.env.SOLANA_BUYER_WALLET_PRIVATE_KEY;
if (!RAW_KEY) {
  console.error('ERROR: SOLANA_BUYER_WALLET_PRIVATE_KEY not set in .env');
  process.exit(1);
}

function secretBytes(raw: string): Uint8Array {
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) return Uint8Array.from(JSON.parse(trimmed) as number[]);
  return Uint8Array.from(getBase58Encoder().encode(trimmed));
}

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SAMPLE_SOL_SIG =
  process.env.SAMPLE_SOL_SIG ??
  '5VfydnLu4XwH6dEufsQEnCidCXfE6xVzX3JAiG8g3q4pump1SVpMwrz4gYbBw2eeqUJgvV6ySMWtCXjPz3jq2CR1';

async function sampleSolanaTx(): Promise<string> {
  const { Connection, Keypair, SystemProgram, Transaction, PublicKey } = await import('@solana/web3.js');
  const conn = new Connection(process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com');
  const payer = new PublicKey('EtDHxiEoha4nj1LRmnpxxmD5zbbzegH8ohYrknZ2JMZv');
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: payer, toPubkey: Keypair.generate().publicKey, lamports: 1000 }),
  );
  tx.feePayer = payer;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
}

async function main() {
  const signer = await createKeyPairSignerFromBytes(secretBytes(RAW_KEY as string));
  const client = new x402Client();
  // Only the SVM scheme is registered, so the client always picks the Solana `accepts` entry.
  registerExactSvmScheme(client, { signer });
  const paidFetch = wrapFetchWithPayment(fetch, client);

  console.log(`Solana buyer: ${signer.address} -> ${BASE_URL}`);

  const calls: Array<{ name: string; path: string; body: unknown }> = [
    { name: 'solana/tx-explain', path: '/v1/solana/tx-explain', body: { signature: SAMPLE_SOL_SIG } },
  ];
  if (process.argv.includes('--all')) {
    calls.push(
      { name: 'solana/tx-simulate', path: '/v1/solana/tx-simulate', body: { transaction: await sampleSolanaTx() } },
      { name: 'solana/token-risk-scan', path: '/v1/solana/token-risk-scan', body: { mint: USDC_MINT } },
    );
  }

  let failures = 0;
  for (const c of calls) {
    const started = Date.now();
    try {
      const res = await paidFetch(`${BASE_URL}${c.path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(c.body),
      });
      const settle = res.headers.get('payment-response') ?? res.headers.get('x-payment-response');
      let tx = '';
      if (settle) {
        try {
          tx = JSON.parse(Buffer.from(settle, 'base64').toString()).transaction ?? '';
        } catch {}
      }
      const ok = res.status === 200;
      if (!ok) failures++;
      console.log(`${ok ? 'OK  ' : 'FAIL'} ${c.name} HTTP ${res.status} ${Date.now() - started}ms ${tx ? `tx=${tx}` : ''}`);
      if (!ok) console.log((await res.text()).slice(0, 400));
    } catch (error) {
      failures++;
      console.log(`FAIL ${c.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(failures === 0 ? '\nSolana payment path works.' : `\n${failures} call(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
