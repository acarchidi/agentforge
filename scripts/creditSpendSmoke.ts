/**
 * Live check of the prepaid-credits path: signs a request with the buyer test
 * wallet and calls a paid endpoint with X-AgentForge-Credit (no x402 payment).
 * Prints the balance before and after. Spends credit only; moves no funds.
 *
 * Buy credit first: npx tsx scripts/buyerAgentAll.ts --only credits/buy
 * Usage:           npx tsx scripts/creditSpendSmoke.ts
 */
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

import { createHash, randomBytes } from 'node:crypto';
import { privateKeyToAccount } from 'viem/accounts';

const BASE = process.env.BUYER_BASE_URL ?? 'https://agentforge-taupe.vercel.app';
const account = privateKeyToAccount(process.env.TEST_WALLET_PRIVATE_KEY as `0x${string}`);
const wallet = account.address.toLowerCase();

const balance = async () => (await (await fetch(`${BASE}/credits/balance?wallet=${wallet}`)).json()) as { balanceUsd: string; referral: unknown };

async function signedPost(path: string, bodyObj: unknown) {
  const body = JSON.stringify(bodyObj);
  const ts = Math.floor(Date.now() / 1000);
  const nonce = randomBytes(16).toString('hex');
  const message = ['AgentForge credit spend', 'method:POST', `path:${path}`, 'query:',
    `body-sha256:${createHash('sha256').update(body).digest('hex')}`, `ts:${ts}`, `nonce:${nonce}`].join('\n');
  const sig = await account.signMessage({ message });
  const header = Buffer.from(JSON.stringify({ wallet: account.address, ts, nonce, sig })).toString('base64');
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-agentforge-credit': header }, body });
  return { res, header };
}

console.log('before:', (await balance()).balanceUsd);
const { res, header } = await signedPost('/v1/preflight', { chain: 'base', recipients: ['0x0330070fd38ec3bb94f58fa55d40368271e9e54a'] });
const out = (await res.json()) as { verdict?: string; error?: string };
console.log(`preflight via credits: HTTP ${res.status} verdict=${out.verdict ?? out.error} balance-header=${res.headers.get('x-agentforge-credit-balance')} x402-payment=${res.headers.get('payment-response') ? 'yes (unexpected)' : 'none'}`);

// The same signed header again must be rejected as a replay.
const replay = await fetch(`${BASE}/v1/preflight`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-agentforge-credit': header }, body: JSON.stringify({ chain: 'base', recipients: ['0x0330070fd38ec3bb94f58fa55d40368271e9e54a'] }) });
console.log(`replay: HTTP ${replay.status} ${JSON.stringify(await replay.json())}`);
console.log('after:', (await balance()).balanceUsd);
