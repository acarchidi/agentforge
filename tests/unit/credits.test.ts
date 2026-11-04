import { describe, it, expect, beforeEach } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';
import { randomBytes } from 'node:crypto';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { creditsGate, keepRawBody } from '../../src/middleware/credits.js';
import { MemoryCreditStore, setCreditStore } from '../../src/credits/store.js';
import { creditMessage, sha256Hex, PACKS } from '../../src/credits/auth.js';
import { priceFor } from '../../src/pricing.js';

const account = privateKeyToAccount(generatePrivateKey());
const WALLET = account.address.toLowerCase();
const PATH = '/v1/address-check';
const BODY = { addresses: [{ address: '0x0330070fd38ec3bb94f58fa55d40368271e9e54a' }] };
const PRICE_MICRO = BigInt(Math.round(priceFor(PATH, BODY) * 1e6));

let store: MemoryCreditStore;
let handlerStatus = 200;
let handlerCalls = 0;
let x402Reached = 0;

function app() {
  const paid = Router();
  paid.post(PATH, (_req, res) => {
    handlerCalls++;
    res.status(handlerStatus).json({ ok: handlerStatus < 400 });
  });
  const a = express();
  a.use(express.json({ verify: keepRawBody }));
  a.use(creditsGate(paid));
  a.use((_req, res) => {
    x402Reached++;
    res.status(402).json({ x402: true });
  });
  return a;
}

async function header(opts: { body?: unknown; ts?: number; nonce?: string; path?: string; method?: string } = {}) {
  const ts = opts.ts ?? Math.floor(Date.now() / 1000);
  const nonce = opts.nonce ?? randomBytes(16).toString('hex');
  const message = creditMessage({
    method: opts.method ?? 'POST',
    path: opts.path ?? PATH,
    query: '',
    bodySha256: sha256Hex(JSON.stringify(opts.body ?? BODY)),
    ts,
    nonce,
  });
  const sig = await account.signMessage({ message });
  return Buffer.from(JSON.stringify({ wallet: account.address, ts, nonce, sig })).toString('base64');
}

const send = (h: string, body: unknown = BODY, path = PATH) =>
  request(app()).post(path).set('content-type', 'application/json').set('x-agentforge-credit', h).send(JSON.stringify(body));

beforeEach(async () => {
  store = new MemoryCreditStore();
  setCreditStore(store);
  handlerStatus = 200;
  handlerCalls = 0;
  x402Reached = 0;
  await store.credit(WALLET, 1_000_000n, '0xtx-seed');
});

describe('credits gate', () => {
  it('debits priceFor and serves the handler without reaching x402', async () => {
    const res = await send(await header());
    expect(res.status).toBe(200);
    expect(handlerCalls).toBe(1);
    expect(x402Reached).toBe(0);
    expect((await store.balance(WALLET)).micro).toBe(1_000_000n - PRICE_MICRO);
    expect(res.headers['x-agentforge-credit-balance']).toBeDefined();
  });

  it('rejects a replayed nonce, a stale timestamp and a tampered body', async () => {
    const h = await header({ nonce: 'a'.repeat(32) });
    expect((await send(h)).status).toBe(200);
    const replay = await send(h);
    expect(replay.status).toBe(401);
    expect(replay.body.reason).toBe('replay');

    const stale = await send(await header({ ts: Math.floor(Date.now() / 1000) - 121 }));
    expect(stale.status).toBe(401);

    const tampered = await send(await header(), { addresses: [{ address: '0x0000000000000000000000000000000000000001' }] });
    expect(tampered.status).toBe(401);
    expect(tampered.body.reason).toMatch(/signature/);
    expect(handlerCalls).toBe(1);
  });

  it('returns INSUFFICIENT_CREDITS without touching the balance', async () => {
    setCreditStore((store = new MemoryCreditStore()));
    const res = await send(await header());
    expect(res.status).toBe(402);
    expect(res.body.error).toBe('INSUFFICIENT_CREDITS');
    expect(x402Reached).toBe(0);
    expect((await store.balance(WALLET)).micro).toBe(0n);
  });

  it('refunds a failed call exactly', async () => {
    handlerStatus = 400;
    const res = await send(await header());
    expect(res.status).toBe(400);
    await new Promise((r) => setTimeout(r, 10));
    expect((await store.balance(WALLET)).micro).toBe(1_000_000n);
  });

  it('falls through to x402 without the header, and on /v1/ping', async () => {
    expect((await request(app()).post(PATH).send(BODY)).status).toBe(402);
    const ping = await request(app()).get('/v1/ping').set('x-agentforge-credit', await header({ path: '/v1/ping', method: 'GET' }));
    expect(ping.status).toBe(402);
    expect(x402Reached).toBe(2);
  });
});

describe('credit store', () => {
  it('credits a settlement tx once', async () => {
    expect(await store.credit(WALLET, PACKS['5'].creditMicro, '0xabc')).toBe('credited');
    expect(await store.credit(WALLET, PACKS['5'].creditMicro, '0xabc')).toBe('duplicate');
    expect((await store.balance(WALLET)).micro).toBe(1_000_000n + PACKS['5'].creditMicro);
  });

  it('never overspends under concurrency', async () => {
    const s = new MemoryCreditStore();
    await s.credit('0xw', 10n, '0x1');
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => s.spend('0xw', `n${i}`, 60, 1n, PATH, `r${i}`)));
    expect(results.filter((r) => r.status === 'ok')).toHaveLength(10);
    expect((await s.balance('0xw')).micro).toBe(0n);
  });

  it('prices packs from the requested pack', () => {
    expect(priceFor('/v1/credits/buy', { pack: '20' })).toBe(20);
    expect(priceFor('/v1/credits/buy', { pack: 'nope' })).toBe(1);
  });
});
