/**
 * Prepaid credit packs and spend authentication.
 *
 * An agent buys a pack once over x402, then authorizes each call by signing
 * the request (EIP-191 personal_sign) instead of paying per call. That
 * removes the per-settlement facilitator fee ($0.001) from high-frequency
 * loops, which is what makes the pack bonus affordable.
 *
 * Header: X-AgentForge-Credit: base64(JSON { wallet, ts, nonce, sig })
 * Signed message (exactly, "\n"-separated):
 *   AgentForge credit spend
 *   method:<METHOD>
 *   path:<path>
 *   query:<raw query without '?'>
 *   body-sha256:<hex sha256 of the raw body, '' for GET>
 *   ts:<unix seconds>
 *   nonce:<32 hex chars>
 */

import { createHash } from 'node:crypto';
import { createPublicClient, http, recoverMessageAddress } from 'viem';
import { base } from 'viem/chains';
import { rpcUrl } from '../utils/evmRpc.js';

/**
 * Pack bonus is paid for by fees saved: each credit-paid call skips a $0.001
 * settlement, and every endpoint keeps its margin at the 20% bonus (worst
 * case: trade-check $0.025 × 0.8 = $0.020 vs ≤ $0.014 cost).
 */
export const PACKS = {
  '1': { priceMicro: 1_000_000n, creditMicro: 1_100_000n, bonusPct: 10 },
  '5': { priceMicro: 5_000_000n, creditMicro: 5_750_000n, bonusPct: 15 },
  '20': { priceMicro: 20_000_000n, creditMicro: 24_000_000n, bonusPct: 20 },
} as const;
export type PackId = keyof typeof PACKS;

export const PACK_BY_PRICE_MICRO = new Map<bigint, (typeof PACKS)[PackId]>(
  Object.values(PACKS).map((p) => [p.priceMicro, p]),
);

export function packFor(id: unknown): (typeof PACKS)[PackId] | undefined {
  return typeof id === 'string' && id in PACKS ? PACKS[id as PackId] : undefined;
}

export const MAX_SKEW_SEC = 120;
/** Nonces are kept a little longer than the skew window, so a replay can't slip past an expired row. */
export const NONCE_TTL_SEC = MAX_SKEW_SEC * 2 + 60;

export interface CreditAuth {
  wallet: string;
  ts: number;
  nonce: string;
  sig: `0x${string}`;
}

export class CreditAuthError extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

export function parseCreditHeader(header: string): CreditAuth {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
  } catch {
    throw new CreditAuthError('malformed header (expected base64 JSON)');
  }
  const { wallet, ts, nonce, sig } = obj ?? {};
  if (typeof wallet !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) throw new CreditAuthError('invalid wallet');
  if (typeof ts !== 'number' || !Number.isInteger(ts)) throw new CreditAuthError('invalid ts');
  if (typeof nonce !== 'string' || !/^[0-9a-f]{32}$/i.test(nonce)) throw new CreditAuthError('nonce must be 32 hex chars');
  if (typeof sig !== 'string' || !/^0x[0-9a-fA-F]+$/.test(sig)) throw new CreditAuthError('invalid sig');
  return { wallet: wallet.toLowerCase(), ts, nonce: nonce.toLowerCase(), sig: sig as `0x${string}` };
}

export const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex');

export function creditMessage(p: { method: string; path: string; query: string; bodySha256: string; ts: number; nonce: string }): string {
  return [
    'AgentForge credit spend',
    `method:${p.method.toUpperCase()}`,
    `path:${p.path}`,
    `query:${p.query}`,
    `body-sha256:${p.bodySha256}`,
    `ts:${p.ts}`,
    `nonce:${p.nonce}`,
  ].join('\n');
}

let client: {
  verifyMessage: (a: { address: `0x${string}`; message: string; signature: `0x${string}` }) => Promise<boolean>;
  getCode: (a: { address: `0x${string}` }) => Promise<`0x${string}` | undefined>;
} | null = null;
const getClient = () => (client ??= createPublicClient({ chain: base, transport: http(rpcUrl('base')) }) as unknown as NonNullable<typeof client>);

/** Wallets known to have no code: a mismatched plain signature from them is just wrong. */
const plainWallets = new Map<string, number>();
const PLAIN_TTL_MS = 3_600_000;

async function isContractWallet(wallet: string): Promise<boolean> {
  const seen = plainWallets.get(wallet);
  if (seen && Date.now() - seen < PLAIN_TTL_MS) return false;
  const code = await getClient().getCode({ address: wallet as `0x${string}` }).catch(() => undefined);
  if (code && code !== '0x') return true;
  if (plainWallets.size > 10_000) plainWallets.clear();
  plainWallets.set(wallet, Date.now());
  return false;
}

/**
 * EOAs verify locally (no network). The chain is consulted only for
 * smart-contract wallets (ERC-1271/6492, e.g. CDP smart accounts): a long
 * signature goes straight to verifyMessage; a 65-byte one only when the wallet
 * has code. A bad EOA signature therefore costs at most one cached getCode.
 */
export async function verifyCreditSignature(wallet: string, message: string, sig: `0x${string}`): Promise<boolean> {
  const plainEcdsa = sig.length === 132;
  if (plainEcdsa) {
    try {
      if ((await recoverMessageAddress({ message, signature: sig })).toLowerCase() === wallet) return true;
    } catch {
      // malformed: fall through
    }
    if (!(await isContractWallet(wallet))) return false;
  }
  try {
    return await getClient().verifyMessage({ address: wallet as `0x${string}`, message, signature: sig });
  } catch {
    return false;
  }
}
