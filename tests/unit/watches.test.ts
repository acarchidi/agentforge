import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';

vi.mock('node:dns', async (orig) => {
  const real = await orig<typeof import('node:dns')>();
  const table: Record<string, string[]> = {
    'hooks.example.com': ['93.184.216.34'],
    'internal.example.com': ['10.0.0.5'],
    'metadata.example.com': ['169.254.169.254'],
    'mapped.example.com': ['::ffff:127.0.0.1'],
    'mixed.example.com': ['93.184.216.34', '192.168.1.1'],
  };
  return {
    ...real,
    promises: {
      ...real.promises,
      lookup: vi.fn(async (host: string) => {
        const ips = table[host];
        if (!ips) throw new Error('ENOTFOUND');
        return ips.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
      }),
    },
  };
});

process.env.WATCH_MASTER_KEY = 'k'.repeat(48);
process.env.CRON_SECRET = 'c'.repeat(32);

const { validateWebhookUrl, signPayload, watchSecret, checkWatchSecret, isBlockedAddress } = await import('../../src/watches/webhook.js');
const { contractAdminState, contractAdminEvents, lendingEvents, tokenRiskEvents } = await import('../../src/watches/checkers.js');
const { priceFor } = await import('../../src/pricing.js');
const { MemoryWatchStore, setWatchStore } = await import('../../src/watches/store.js');

describe('webhook URL validation (SSRF)', () => {
  it('accepts https to a public host', async () => {
    await expect(validateWebhookUrl('https://hooks.example.com/x')).resolves.toBeInstanceOf(URL);
  });
  it.each([
    ['http://hooks.example.com/x', /https/],
    ['https://93.184.216.34/x', /hostname/],
    ['https://localhost/x', /public/],
    ['https://hooks.example.com:8443/x', /port/],
    ['https://user:pw@hooks.example.com/x', /credentials/],
    ['https://internal.example.com/x', /public addresses/],
    ['https://metadata.example.com/x', /public addresses/],
    ['https://mapped.example.com/x', /public addresses/],
    ['https://mixed.example.com/x', /public addresses/],
    ['https://nope.example.com/x', /resolve/],
  ])('rejects %s', async (url, why) => {
    await expect(validateWebhookUrl(url)).rejects.toThrow(why);
  });
  it('classifies private and special ranges', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.0.1', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
    expect(isBlockedAddress('8.8.8.8')).toBe(false);
    expect(isBlockedAddress('2606:4700::1111')).toBe(false);
  });
});

describe('secrets and signatures', () => {
  it('derives a stable per-watch secret and checks it in constant time', () => {
    const s = watchSecret('w_1');
    expect(s).toBe(watchSecret('w_1'));
    expect(s).not.toBe(watchSecret('w_2'));
    expect(checkWatchSecret('w_1', s)).toBe(true);
    expect(checkWatchSecret('w_1', s + 'x')).toBe(false);
    expect(checkWatchSecret('w_1', undefined)).toBe(false);
  });
  it('signs t.body with HMAC-SHA256; a tampered body does not verify', () => {
    const body = JSON.stringify({ a: 1 });
    const header = signPayload('sec', body, 1700000000);
    const [, v1] = header.match(/v1=([0-9a-f]+)/)!;
    expect(v1).toBe(createHmac('sha256', 'sec').update(`1700000000.${body}`).digest('hex'));
    expect(v1).not.toBe(createHmac('sha256', 'sec').update(`1700000000.${JSON.stringify({ a: 2 })}`).digest('hex'));
  });
});

describe('checkers', () => {
  const word = (addr: string) => '0x' + addr.slice(2).padStart(64, '0');
  const IMPL1 = '0x' + '1'.repeat(40);
  const IMPL2 = '0x' + '2'.repeat(40);

  it('contract-admin: an implementation change emits one event; identical state none', () => {
    const s1 = contractAdminState([word(IMPL1), word(IMPL1), '0x' + '0'.repeat(64), '0x' + '0'.repeat(64)])!;
    const s2 = contractAdminState([word(IMPL1), word(IMPL2), '0x' + '0'.repeat(64), '0x' + '0'.repeat(64)])!;
    expect(contractAdminEvents(s1, s1)).toEqual([]);
    const ev = contractAdminEvents(s1, s2);
    expect(ev).toHaveLength(1);
    expect(ev[0].summary).toMatch(/Implementation changed/);
    expect(contractAdminEvents(null, s2)).toEqual([]); // baseline never alerts
    expect(contractAdminState([null, null, null, null])).toBeNull(); // RPC failure
  });

  it('contract-admin: pausing is reported', () => {
    const a = contractAdminState([null, word(IMPL1), word(IMPL1), '0x' + '0'.repeat(64)])!;
    const b = contractAdminState([null, word(IMPL1), word(IMPL1), '0x' + '0'.repeat(63) + '1'])!;
    expect(contractAdminEvents(a, b)[0].summary).toBe('Contract was paused');
  });

  it('lending-health: band changes and threshold crossings', () => {
    const safe = { healthFactor: 2.1, status: 'safe' };
    const danger = { healthFactor: 1.1, status: 'danger' };
    expect(lendingEvents(safe, safe)).toEqual([]);
    const ev = lendingEvents(safe, danger, 1.5);
    expect(ev.map((e) => e.event)).toEqual(['change', 'threshold']);
    expect(ev[0].summary).toMatch(/worsened: safe → danger/);
  });

  it('token-risk: threshold crossing and new flags', () => {
    const a = { score: 30, flags: ['Unverified'] };
    const b = { score: 70, flags: ['Unverified', 'Owner can mint'] };
    expect(tokenRiskEvents(a, b).map((e) => e.summary)).toEqual(['Risk score rose above 50: 30 → 70', 'New risk flag: Owner can mint']);
    expect(tokenRiskEvents(a, a)).toEqual([]);
  });
});

describe('pricing', () => {
  it('prices per day with a minimum', () => {
    expect(priceFor('/v1/watch', { type: 'contract-admin', days: 30 })).toBe(0.3);
    expect(priceFor('/v1/watch', { type: 'contract-admin', days: 1 })).toBe(0.05);
    expect(priceFor('/v1/watch', { type: 'token-risk', days: 30 })).toBe(0.6);
    expect(priceFor('/v1/watch', { type: 'lending-health', days: 90 })).toBe(0.9);
    expect(priceFor('/v1/watch', { type: 'contract-admin', days: 1000 })).toBe(0.9); // clamped to 90 days
  });
});

describe('scheduler', () => {
  let store: InstanceType<typeof MemoryWatchStore>;
  beforeEach(() => {
    store = new MemoryWatchStore();
    setWatchStore(store);
    vi.restoreAllMocks();
  });

  it('cron route: 401 without auth, skipped while disabled', async () => {
    const express = (await import('express')).default;
    const request = (await import('supertest')).default;
    const { cronRouter } = await import('../../src/routes/cron.js');
    const app = express().use(cronRouter);
    expect((await request(app).get('/internal/cron/watches')).status).toBe(401);
    const res = await request(app).get('/internal/cron/watches').set('authorization', `Bearer ${'c'.repeat(32)}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ skipped: 'disabled' });
  });

  it('expires, checks due watches, queues change alerts and retries failed deliveries with backoff', async () => {
    const checkers = await import('../../src/watches/checkers.js');
    const webhook = await import('../../src/watches/webhook.js');
    vi.spyOn(checkers, 'runChecks').mockImplementation(async (ws) => ws.map((w) => ({
      id: w.id, ok: true, state: { implementation: '0x2' },
      // Changes once (0x1 → 0x2); later checks see the same state.
      events: (w.lastState as { implementation?: string } | null)?.implementation === '0x1'
        ? [{ event: 'change' as const, summary: 'Implementation changed', previous: {}, current: {} }]
        : [],
    })));
    const deliver = vi.spyOn(webhook, 'deliverWebhook').mockResolvedValue({ ok: false, error: 'HTTP 500' });
    const { runWatchCycle } = await import('../../src/watches/runner.js');

    let t = Date.parse('2026-11-05T00:00:00Z');
    store.now = () => t;
    const base = { type: 'contract-admin' as const, chain: 'base', target: '0x' + '1'.repeat(40), webhookUrl: 'https://hooks.example.com/x', params: {}, lastState: { implementation: '0x1' }, payerHash: null };
    await store.create({ ...base, id: 'w_live', expiresAt: '2026-12-01T00:00:00Z' });
    await store.create({ ...base, id: 'w_gone', expiresAt: '2026-11-05T00:10:00Z' });

    t += 31 * 60_000; // past the 28-min claim point
    const s1 = await runWatchCycle();
    expect(s1).toMatchObject({ expired: 1, checked: 1, alertsQueued: 2, delivered: 0, failed: 2 });
    expect(store.watches.get('w_live')!.lastState).toEqual({ implementation: '0x2' });
    expect(store.watches.get('w_gone')!.status).toBe('expired');

    // Retries only after backoff, and never more than 6 attempts.
    const s2 = await runWatchCycle();
    expect(s2.failed).toBe(0);
    for (let i = 0; i < 10; i++) {
      t += 64 * 60_000;
      await runWatchCycle();
    }
    const change = store.alerts.find((a) => a.event === 'change')!;
    expect(change.attempts).toBe(6);
    expect(deliver.mock.calls.filter((c) => c[1] === 'w_live' && (c[2] as { event: string }).event === 'change')).toHaveLength(6);
  });
});
