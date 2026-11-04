/**
 * Credits gate: serves a paid endpoint from a prepaid balance when the request
 * carries a valid X-AgentForge-Credit signature, without touching x402.
 *
 * Mounted just before the x402 payment middleware. Requests without the header
 * (or for routes credits don't cover) fall through to normal x402. Like x402's
 * "no settlement on >= 400" rule, a failed call is refunded.
 */

import { randomUUID } from 'node:crypto';
import type { Request, RequestHandler, Router } from 'express';
import { ENDPOINT_PRICES, PUBLIC_BASE_URL, formatUsd, priceFor } from '../pricing.js';
import { getCreditStore } from '../credits/store.js';
import {
  CreditAuthError,
  MAX_SKEW_SEC,
  NONCE_TTL_SEC,
  creditMessage,
  parseCreditHeader,
  sha256Hex,
  verifyCreditSignature,
} from '../credits/auth.js';

/** Routes paid only over x402: buying credits with credits, and the $0.001 connectivity check. */
const X402_ONLY = new Set(['/v1/credits/buy', '/v1/ping']);

export interface CreditPayment {
  scheme: 'credits';
  wallet: string;
  micro: bigint;
  requestId: string;
  refunded?: boolean;
}

/**
 * Refund a credit-paid request that is about to fail. Awaited by the handler
 * BEFORE it responds: the function may be frozen once the response is sent.
 */
export async function refundCreditPayment(res: { locals: Record<string, unknown> }, endpoint: string): Promise<void> {
  const p = res.locals.payment as CreditPayment | undefined;
  if (p?.scheme !== 'credits' || p.refunded) return;
  p.refunded = true;
  await getCreditStore().refund(p.wallet, p.micro, endpoint, p.requestId).catch((e) => console.error('credits: refund failed', p.requestId, e));
}

/** express.json `verify` hook: keep the exact body bytes the client signed. */
export function keepRawBody(req: Request, _res: unknown, buf: Buffer): void {
  (req as Request & { rawBody?: string }).rawBody = buf.toString('utf8');
}

export function creditsGate(paidRouter: Router): RequestHandler {
  return async (req, res, next) => {
    const header = req.headers['x-agentforge-credit'];
    if (typeof header !== 'string' || !(req.path in ENDPOINT_PRICES) || X402_ONLY.has(req.path)) return next();

    let wallet: string;
    let nonce: string;
    try {
      const auth = parseCreditHeader(header);
      if (Math.abs(Date.now() / 1000 - auth.ts) > MAX_SKEW_SEC) throw new CreditAuthError('ts outside the 120 s window');
      const raw = (req as Request & { rawBody?: string }).rawBody ?? '';
      const message = creditMessage({
        method: req.method,
        path: req.path,
        query: req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?') + 1) : '',
        bodySha256: sha256Hex(req.method === 'GET' ? '' : raw),
        ts: auth.ts,
        nonce: auth.nonce,
      });
      if (!(await verifyCreditSignature(auth.wallet, message, auth.sig))) throw new CreditAuthError('signature does not match wallet');
      wallet = auth.wallet;
      nonce = auth.nonce;
    } catch (e) {
      res.status(401).json({
        error: 'CREDIT_AUTH_INVALID',
        reason: e instanceof CreditAuthError ? e.reason : 'invalid',
        docs: `${PUBLIC_BASE_URL}/SKILL.md#prepaid-credits`,
      });
      return;
    }

    const price = priceFor(req.path, req.method === 'GET' ? req.query : req.body);
    const micro = BigInt(Math.round(price * 1e6));
    const requestId = randomUUID();
    const store = getCreditStore();
    let spent;
    try {
      spent = await store.spend(wallet, nonce, NONCE_TTL_SEC, micro, req.path, requestId);
    } catch (e) {
      console.error('credits: spend failed', e);
      res.status(503).json({ error: 'CREDITS_UNAVAILABLE', message: 'Credit store unavailable; retry, or pay this call with x402 (omit the X-AgentForge-Credit header).' });
      return;
    }
    if (spent.status === 'replay') {
      res.status(401).json({ error: 'CREDIT_AUTH_INVALID', reason: 'replay' });
      return;
    }
    if (spent.status === 'insufficient') {
      res.status(402).json({
        error: 'INSUFFICIENT_CREDITS',
        balanceUsd: formatUsd(Number(spent.balanceMicro) / 1e6),
        priceUsd: formatUsd(price),
        buy: `${PUBLIC_BASE_URL}/v1/credits/buy?pack=5`,
        hint: 'Top up, or omit the X-AgentForge-Credit header to pay this call with x402.',
      });
      return;
    }

    const payment: CreditPayment = { scheme: 'credits', wallet, micro, requestId };
    res.locals.payment = payment;
    res.setHeader('X-AgentForge-Credit-Balance', formatUsd(Number(spent.balanceMicro) / 1e6));
    // Backstop for failures that bypass handlePaid (e.g. a 404 from an unknown sub-path).
    res.on('finish', () => {
      if (res.statusCode >= 400) void refundCreditPayment(res, req.path);
    });
    return paidRouter(req, res, next);
  };
}
