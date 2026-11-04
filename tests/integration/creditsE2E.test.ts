/**
 * End to end through the real middleware stack, in production order:
 * json(raw body) → free → credits gate → x402 → paid routes.
 * Proves a signed credit request is served (and charged once) without x402,
 * an unsigned one still gets the x402 quote, and credit purchases quote the
 * requested pack and carry the referrer in the payment resource URL.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { randomBytes } from 'node:crypto';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

process.env.PAY_TO_ADDRESS = '0x0000000000000000000000000000000000000001';
process.env.X402_NETWORK = 'base-sepolia';
process.env.X402_FACILITATOR_URL = 'https://x402.org/facilitator';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
process.env.ADMIN_TOKEN = 'test-admin-token-1234567890';
process.env.DATABASE_PATH = ':memory:';

vi.mock('../../src/utils/evmRpc.js', async (orig) => ({
  ...(await orig<typeof import('../../src/utils/evmRpc.js')>()),
  rpcBatch: vi.fn(async (_c: string, calls: unknown[]) => calls.map(() => null)),
}));

const account = privateKeyToAccount(generatePrivateKey());
const WALLET = account.address.toLowerCase();
let app: express.Application;
let store: import('../../src/credits/store.js').MemoryCreditStore;

beforeAll(async () => {
  const { paidRouter } = await import('../../src/routes/paid.js');
  const { freeRouter } = await import('../../src/routes/free.js');
  const { createPaymentMiddleware } = await import('../../src/middleware/x402.js');
  const { creditsGate, keepRawBody } = await import('../../src/middleware/credits.js');
  const { MemoryCreditStore, setCreditStore } = await import('../../src/credits/store.js');
  const { initDb } = await import('../../src/analytics/db.js');
  initDb();
  store = new MemoryCreditStore();
  setCreditStore(store);
  app = express();
  app.use(express.json({ limit: '1mb', verify: keepRawBody }));
  app.use(freeRouter);
  app.use(creditsGate(paidRouter));
  app.use(createPaymentMiddleware());
  app.use(paidRouter);
}, 60_000);

async function signed(path: string, body: unknown) {
  const { creditMessage, sha256Hex } = await import('../../src/credits/auth.js');
  const ts = Math.floor(Date.now() / 1000);
  const nonce = randomBytes(16).toString('hex');
  const raw = JSON.stringify(body);
  const sig = await account.signMessage({ message: creditMessage({ method: 'POST', path, query: '', bodySha256: sha256Hex(raw), ts, nonce }) });
  return { raw, header: Buffer.from(JSON.stringify({ wallet: account.address, ts, nonce, sig })).toString('base64') };
}

const decode = (h: string | undefined) => JSON.parse(Buffer.from(String(h), 'base64').toString());

describe('credits end to end', () => {
  const BODY = { addresses: [{ address: '0x0330070fd38ec3bb94f58fa55d40368271e9e54a', chain: 'ethereum' }] };

  it('unsigned paid request still gets the x402 quote', async () => {
    const res = await request(app).post('/v1/address-check').send(BODY);
    expect(res.status).toBe(402);
    expect(decode(res.headers['payment-required']).accepts[0].amount).toBe('3000');
  });

  it('signed request is served from credits, once, with no x402 payment', async () => {
    await store.credit(WALLET, 1_000_000n, '0xseed-e2e');
    const { raw, header } = await signed('/v1/address-check', BODY);
    const res = await request(app).post('/v1/address-check').set('content-type', 'application/json').set('x-agentforge-credit', header).send(raw);
    expect(res.status).toBe(200);
    expect(res.body.results[0].verdict).toBe('block');
    expect(res.headers['payment-response']).toBeUndefined();
    expect(res.headers['x-agentforge-credit-balance']).toBe('$0.997');
    expect((await store.balance(WALLET)).micro).toBe(997_000n);
    expect(store.ledger.filter((l) => l.kind === 'spend')).toHaveLength(1);

    const empty = await request(app).get(`/credits/balance?wallet=${WALLET}`);
    expect(empty.body.balanceUsd).toBe('$0.997');
    expect(empty.body.referral.link).toContain(`ref=${WALLET}`);
  });

  it('a failed credit request is refunded', async () => {
    const before = (await store.balance(WALLET)).micro;
    const bad = { addresses: [] };
    const { raw, header } = await signed('/v1/address-check', bad);
    const res = await request(app).post('/v1/address-check').set('content-type', 'application/json').set('x-agentforge-credit', header).send(raw);
    expect(res.status).toBe(400);
    expect((await store.balance(WALLET)).micro).toBe(before);
  });

  it('credit purchases quote the requested pack and keep the referrer in the resource URL', async () => {
    const ref = '0x' + 'f'.repeat(40);
    const res = await request(app).post(`/v1/credits/buy?pack=20&ref=${ref}`).send({});
    expect(res.status).toBe(402);
    const pr = decode(res.headers['payment-required']);
    expect(pr.accepts[0].amount).toBe('20000000');
    expect(pr.accepts.every((a: { network: string }) => a.network.startsWith('eip155:'))).toBe(true);
    const { referrerFrom } = await import('../../src/middleware/x402.js');
    expect(referrerFrom(pr.resource.url)).toBe(ref);

    const one = decode((await request(app).post('/v1/credits/buy').send({})).headers['payment-required']);
    expect(one.accepts[0].amount).toBe('1000000');
  });

  it('watches quote per day', async () => {
    const res = await request(app).post('/v1/watch').send({ type: 'token-risk', target: '0x' + '1'.repeat(40), webhookUrl: 'https://example.com/h', days: 30 });
    expect(res.status).toBe(402);
    expect(decode(res.headers['payment-required']).accepts[0].amount).toBe('600000');
  });
});
