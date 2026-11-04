/**
 * Runs the production SQL of the credit and watch stores against a real
 * Postgres. Skipped unless PG_TEST_URL is set, e.g.
 *   PG_TEST_URL=postgres://postgres@127.0.0.1:54329/agentforge_test npx vitest run tests/integration/creditsPostgres.test.ts
 *
 * The invariants checked here are the bookkeeping promises: every balance
 * equals the sum of its ledger rows, a settlement credits exactly once (even
 * when delivered concurrently), concurrent spends never overdraw, and
 * referral rewards are paid once per purchase to the first referrer only.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import pg from 'pg';
import { createPostgresCreditStore, REFERRAL, type CreditStore } from '../../src/credits/store.js';
import { createPostgresWatchStore, type WatchStore } from '../../src/watches/store.js';
import { PACKS } from '../../src/credits/auth.js';

const URL = process.env.PG_TEST_URL;
const d = URL ? describe : describe.skip;

let pool: pg.Pool;
let credits: CreditStore;
let watches: WatchStore;
const q = async (text: string, params?: unknown[]) => (await pool.query(text, params as unknown[])).rows;

const A = '0x' + 'a'.repeat(40);
const B = '0x' + 'b'.repeat(40);
const C = '0x' + 'c'.repeat(40);

async function ledgerSum(wallet: string): Promise<bigint> {
  const [r] = await q('SELECT COALESCE(SUM(delta_micro), 0) AS s FROM credit_ledger WHERE wallet = $1', [wallet]);
  return BigInt(r.s);
}

async function expectReconciled(...wallets: string[]) {
  for (const w of wallets) expect((await credits.balance(w)).micro, w).toBe(await ledgerSum(w));
}

beforeAll(async () => {
  if (!URL) return;
  pool = new pg.Pool({ connectionString: URL, max: 20 });
  credits = createPostgresCreditStore({ query: q });
  watches = createPostgresWatchStore({ query: q });
  await credits.balance(A); // runs schema init
  await watches.get('none');
});
afterAll(async () => {
  await pool?.end();
});

d('credit store on Postgres', () => {
  beforeEach(async () => {
    await q('TRUNCATE credit_accounts, credit_ledger, credit_nonces, watch_alerts, watches');
  });

  it('credits a purchase once per tx and records one ledger row', async () => {
    const p = PACKS['5'];
    const r1 = await credits.creditPurchase(A, p.priceMicro, p.creditMicro, '0xtx1', null);
    const r2 = await credits.creditPurchase(A, p.priceMicro, p.creditMicro, '0xtx1', null);
    expect(r1.status).toBe('credited');
    expect(r2.status).toBe('duplicate');
    expect((await credits.balance(A)).micro).toBe(p.creditMicro);
    expect(await q(`SELECT kind, delta_micro::text, tx_hash FROM credit_ledger`)).toEqual([{ kind: 'purchase', delta_micro: p.creditMicro.toString(), tx_hash: '0xtx1' }]);
    await expectReconciled(A);
  });

  it('credits exactly once when the same settlement arrives concurrently', async () => {
    const p = PACKS['20'];
    const results = await Promise.all(Array.from({ length: 10 }, () => credits.creditPurchase(A, p.priceMicro, p.creditMicro, '0xdup', null)));
    expect(results.filter((r) => r.status === 'credited')).toHaveLength(1);
    expect((await credits.balance(A)).micro).toBe(p.creditMicro);
    await expectReconciled(A);
  });

  it('spends, rejects replays and insufficient balances without side effects, refunds exactly', async () => {
    await credits.creditPurchase(A, 1_000_000n, 1_100_000n, '0xtx', null);
    const ok = await credits.spend(A, 'n1', 360, 8_000n, '/v1/preflight', 'r1');
    expect(ok).toEqual({ status: 'ok', balanceMicro: 1_092_000n });

    expect(await credits.spend(A, 'n1', 360, 8_000n, '/v1/preflight', 'r2')).toEqual({ status: 'replay' });
    expect(await credits.spend(A, 'n2', 360, 5_000_000n, '/v1/preflight', 'r3')).toEqual({ status: 'insufficient', balanceMicro: 1_092_000n });
    expect(await credits.spend(B, 'n1', 360, 1n, '/v1/preflight', 'r4')).toEqual({ status: 'insufficient', balanceMicro: 0n });
    expect((await credits.balance(A)).micro).toBe(1_092_000n);

    await credits.refund(A, 8_000n, '/v1/preflight', 'r1');
    expect((await credits.balance(A)).micro).toBe(1_100_000n);
    const kinds = (await q(`SELECT kind FROM credit_ledger WHERE wallet = $1 ORDER BY id`, [A])).map((r) => r.kind);
    expect(kinds).toEqual(['purchase', 'spend', 'refund']);
    await expectReconciled(A, B);
  });

  it('never overdraws under concurrent spends', async () => {
    await credits.credit(A, 20n, '0xseed');
    const results = await Promise.all(Array.from({ length: 50 }, (_, i) => credits.spend(A, `c${i}`, 360, 1n, '/v1/address-check', `r${i}`)));
    expect(results.filter((r) => r.status === 'ok')).toHaveLength(20);
    expect((await credits.balance(A)).micro).toBe(0n);
    const [n] = await q(`SELECT COUNT(*)::int AS n FROM credit_ledger WHERE kind = 'spend'`);
    expect(n.n).toBe(20);
    await expectReconciled(A);
  });

  it('pays the first referrer on every purchase, once per tx, never the buyer themself', async () => {
    const p = PACKS['5'];
    const r1 = await credits.creditPurchase(B, p.priceMicro, p.creditMicro, '0xb1', A);
    expect(r1.referrer).toBe(A);
    const bonus = (p.priceMicro * REFERRAL.buyerBonusPct) / 100n;
    const reward = (p.priceMicro * REFERRAL.referrerPct) / 100n;
    expect((await credits.balance(B)).micro).toBe(p.creditMicro + bonus);
    expect((await credits.balance(A)).micro).toBe(reward);

    // A later purchase naming C keeps A (sticky) and pays A again.
    const r2 = await credits.creditPurchase(B, p.priceMicro, p.creditMicro, '0xb2', C);
    expect(r2.referrer).toBe(A);
    expect((await credits.balance(A)).micro).toBe(2n * reward);
    expect((await credits.balance(C)).micro).toBe(0n);

    // Replayed settlement: no second reward.
    await credits.creditPurchase(B, p.priceMicro, p.creditMicro, '0xb2', A);
    expect((await credits.balance(A)).micro).toBe(2n * reward);

    // Self-referral is ignored.
    const self = await credits.creditPurchase(C, p.priceMicro, p.creditMicro, '0xc1', C);
    expect(self.referrer).toBeNull();
    expect((await credits.balance(C)).micro).toBe(p.creditMicro);

    expect(await credits.referralStats(A)).toEqual({ earnedMicro: 2n * reward, referred: 1 });
    expect(await credits.liability()).toBe((await credits.balance(A)).micro + (await credits.balance(B)).micro + (await credits.balance(C)).micro);
    await expectReconciled(A, B, C);
  });
});

d('watch store on Postgres', () => {
  beforeEach(async () => {
    await q('TRUNCATE watch_alerts, watches');
  });

  const base = { type: 'contract-admin' as const, chain: 'base', target: '0x' + '1'.repeat(40), webhookUrl: 'https://example.com/h', params: {}, lastState: { owner: '0x1' }, payerHash: null };

  it('claims only due active watches, saves state in one batch, expires and cancels', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    await watches.create({ ...base, id: 'w_due', expiresAt: future });
    await watches.create({ ...base, id: 'w_later', expiresAt: future });
    await watches.create({ ...base, id: 'w_old', expiresAt: new Date(Date.now() - 1000).toISOString() });
    await q(`UPDATE watches SET next_check_at = now() - interval '1 minute' WHERE id IN ('w_due', 'w_old')`);

    expect((await watches.expire()).map((w) => w.id)).toEqual(['w_old']);
    const claimed = await watches.claimDue(10);
    expect(claimed.map((w) => w.id)).toEqual(['w_due']);
    expect(await watches.claimDue(10)).toEqual([]); // next_check_at moved forward

    const fails = await watches.saveChecks([{ id: 'w_due', ok: true, state: { owner: '0x2' } }, { id: 'w_later', ok: false, state: null }]);
    expect(fails.get('w_due')).toBe(0);
    expect(fails.get('w_later')).toBe(1);
    expect((await watches.get('w_due'))!.lastState).toEqual({ owner: '0x2' });
    expect((await watches.get('w_later'))!.lastState).toEqual({ owner: '0x1' }); // kept on failure

    expect(await watches.cancel('w_due')).toBe(true);
    expect(await watches.cancel('w_due')).toBe(false);
  });

  it('queues alerts, delivers with backoff and stops after 6 attempts', async () => {
    await watches.create({ ...base, id: 'w_a', expiresAt: new Date(Date.now() + 86_400_000).toISOString() });
    await watches.addAlerts([
      { watchId: 'w_a', event: 'change', payload: { summary: 'x' } },
      { watchId: 'w_a', event: 'test', payload: { summary: 't' }, delivered: { ok: true } },
    ]);
    let pending = await watches.pendingAlerts(10);
    expect(pending.map((a) => a.event)).toEqual(['change']);
    expect(pending[0].webhookUrl).toBe(base.webhookUrl);

    for (let i = 0; i < 6; i++) {
      await q(`UPDATE watch_alerts SET next_attempt_at = now() - interval '1 second'`);
      pending = await watches.pendingAlerts(10);
      if (pending.length === 0) break;
      await watches.markDeliveries(pending.map((a) => ({ id: a.id, ok: false, error: 'HTTP 500' })));
    }
    await q(`UPDATE watch_alerts SET next_attempt_at = now() - interval '1 second'`);
    expect(await watches.pendingAlerts(10)).toEqual([]);
    const [a] = await q(`SELECT attempts, delivered, last_error FROM watch_alerts WHERE event = 'change'`);
    expect(a).toEqual({ attempts: 6, delivered: false, last_error: 'HTTP 500' });
    expect((await watches.recentAlerts('w_a', 20)).length).toBe(2);
  });
});
