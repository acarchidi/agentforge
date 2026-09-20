/**
 * Hashed client identifiers for analytics.
 *
 * Raw identifiers (payer wallet addresses, IPs, session ids) are NEVER
 * stored. Everything is reduced to a salted SHA-256 prefix so the store can
 * count unique clients and repeat usage without holding anything that maps
 * back to a wallet or a person.
 */
import crypto from 'crypto';
import type { Request } from 'express';
import { config } from '../config.js';

const SALT = process.env.ANALYTICS_HASH_SALT || config.ADMIN_TOKEN;

export function hashClientId(raw: string): string {
  return crypto.createHash('sha256').update(`${SALT}:${raw.toLowerCase()}`).digest('hex').slice(0, 16);
}

export interface PaymentContext {
  clientHash?: string;
  paymentNetwork?: string;
  paymentScheme?: string;
}

function decodeBase64Json(value: string): Record<string, unknown> | null {
  try {
    return JSON.parse(Buffer.from(value, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Extract the payer identity from an x402 payment payload without touching the
 * facilitator: v2 sends `PAYMENT-SIGNATURE`, v1 sends `X-PAYMENT`.
 * EVM exact (EIP-3009 / Permit2) carries the signer address in the payload;
 * SVM exact carries a serialized transaction whose second required signer is
 * the payer (index 0 is the facilitator fee payer).
 */
export function paymentContextFromRequest(req: Request): PaymentContext {
  const header =
    (req.headers['payment-signature'] as string | undefined) ??
    (req.headers['x-payment'] as string | undefined);
  if (!header) return {};

  const payload = decodeBase64Json(header);
  if (!payload) return {};

  const accepted = (payload.accepted ?? {}) as Record<string, unknown>;
  const network = (accepted.network ?? payload.network) as string | undefined;
  const scheme = (accepted.scheme ?? payload.scheme) as string | undefined;
  const inner = (payload.payload ?? {}) as Record<string, unknown>;
  const extra = (accepted.extra ?? {}) as Record<string, unknown>;

  let payer: string | undefined;
  const auth = inner.authorization as Record<string, unknown> | undefined;
  if (auth && typeof auth.from === 'string') payer = auth.from;
  const permit2 = inner.permit2Authorization as Record<string, unknown> | undefined;
  if (!payer && permit2 && typeof permit2.from === 'string') payer = permit2.from;
  if (!payer && permit2 && typeof permit2.owner === 'string') payer = permit2.owner;

  if (!payer && typeof inner.transaction === 'string') {
    payer = solanaPayerFromTransaction(inner.transaction, extra.feePayer as string | undefined);
  }

  const paymentScheme = scheme
    ? extra.assetTransferMethod === 'permit2' ? `${scheme}/permit2` : scheme
    : undefined;

  return {
    clientHash: payer ? hashClientId(payer) : undefined,
    paymentNetwork: network,
    paymentScheme,
  };
}

/**
 * Parse a legacy or v0 Solana transaction just far enough to find the
 * required signer keys. Avoids pulling @solana/web3.js into the hot path.
 */
function solanaPayerFromTransaction(txBase64: string, feePayer?: string): string | undefined {
  try {
    const bytes = Buffer.from(txBase64, 'base64');
    let offset = 0;
    const readShortVec = () => {
      let len = 0;
      let size = 0;
      for (;;) {
        const b = bytes[offset++];
        len |= (b & 0x7f) << (size * 7);
        size += 1;
        if ((b & 0x80) === 0) break;
      }
      return len;
    };
    const sigCount = readShortVec();
    offset += sigCount * 64;
    // versioned tx: first message byte has high bit set
    if ((bytes[offset] & 0x80) !== 0) offset += 1;
    const numRequiredSignatures = bytes[offset];
    offset += 3; // header: required, readonly-signed, readonly-unsigned
    const keyCount = readShortVec();
    const keys: string[] = [];
    for (let i = 0; i < keyCount && i < numRequiredSignatures; i++) {
      keys.push(base58(bytes.subarray(offset + i * 32, offset + (i + 1) * 32)));
    }
    const candidates = keys.filter((k) => k !== feePayer);
    return candidates[0] ?? keys[0];
  } catch {
    return undefined;
  }
}

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(buf: Uint8Array): string {
  let num = BigInt(`0x${Buffer.from(buf).toString('hex')}`);
  let out = '';
  while (num > 0n) {
    const rem = Number(num % 58n);
    num /= 58n;
    out = ALPHABET[rem] + out;
  }
  for (const b of buf) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}

/** Hashed identity for an MCP request: session id when the client sends one, else IP + user-agent. */
export function mcpClientHash(req: Request): string {
  const session = req.headers['mcp-session-id'];
  if (typeof session === 'string' && session.length > 0) return hashClientId(`mcp-session:${session}`);
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown';
  const ua = (req.headers['user-agent'] as string) || '';
  return hashClientId(`mcp-client:${ip}|${ua}`);
}
