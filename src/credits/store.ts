/**
 * Prepaid credit balances: Neon in production (same DATABASE_URL as analytics),
 * in-memory locally and in tests.
 *
 * Money is micro-USD in BIGINT, never floats. Every movement is ONE SQL
 * statement (the Neon HTTP driver runs each query as its own transaction), and
 * a spend folds the replay check, the balance debit and the ledger row into a
 * single round trip, so a credit-paid call costs one database request.
 */

import { neon } from '@neondatabase/serverless';

export type SpendResult =
  | { status: 'ok'; balanceMicro: bigint }
  | { status: 'replay' }
  | { status: 'insufficient'; balanceMicro: bigint };

export interface PurchaseResult {
  status: 'credited' | 'duplicate';
  /** The buyer's referrer (first one ever recorded; sticky), if any. */
  referrer: string | null;
  buyerMicro: bigint;
  referrerMicro: bigint;
}

export interface CreditStore {
  /** Credit a purchase once per settlement tx hash (admin re-credit path; no referral handling). */
  credit(wallet: string, micro: bigint, txHash: string): Promise<'credited' | 'duplicate'>;
  /**
   * Credit a settled pack purchase with referral handling: the first referrer a
   * wallet ever names sticks; while it has one, the buyer gets REFERRAL.buyerBonusPct
   * extra and the referrer earns REFERRAL.referrerPct of the price as credit, once per tx.
   */
  creditPurchase(wallet: string, priceMicro: bigint, creditMicro: bigint, txHash: string, refCandidate: string | null): Promise<PurchaseResult>;
  /** Referral credit earned by `wallet` and the number of wallets it referred. */
  referralStats(wallet: string): Promise<{ earnedMicro: bigint; referred: number }>;
  /** Consume `nonce` and debit `micro` atomically. A used nonce is a replay. */
  spend(wallet: string, nonce: string, ttlSec: number, micro: bigint, endpoint: string, requestId: string): Promise<SpendResult>;
  refund(wallet: string, micro: bigint, endpoint: string, requestId: string): Promise<void>;
  balance(wallet: string): Promise<{ micro: bigint; updatedAt: string | null }>;
  /** Total outstanding balances (prepaid liability), for the revenue report. */
  liability(): Promise<bigint>;
}

/** Paid in credits, from margin: keeps every endpoint profitable at the 20% pack bonus too (see auth.ts). */
export const REFERRAL = { referrerPct: 10n, buyerBonusPct: 5n } as const;

export function referralSplit(priceMicro: bigint, hasReferrer: boolean): { buyerBonus: bigint; reward: bigint } {
  return hasReferrer
    ? { buyerBonus: (priceMicro * REFERRAL.buyerBonusPct) / 100n, reward: (priceMicro * REFERRAL.referrerPct) / 100n }
    : { buyerBonus: 0n, reward: 0n };
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS credit_accounts (
    wallet TEXT PRIMARY KEY,
    balance_micro BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS credit_ledger (
    id BIGSERIAL PRIMARY KEY,
    wallet TEXT NOT NULL,
    delta_micro BIGINT NOT NULL,
    kind TEXT NOT NULL,
    endpoint TEXT,
    tx_hash TEXT UNIQUE,
    request_id TEXT,
    ts TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  ALTER TABLE credit_accounts ADD COLUMN IF NOT EXISTS referrer TEXT;
  CREATE INDEX IF NOT EXISTS idx_credit_accounts_referrer ON credit_accounts(referrer);
  CREATE INDEX IF NOT EXISTS idx_credit_ledger_wallet_ts ON credit_ledger(wallet, ts DESC);
  CREATE TABLE IF NOT EXISTS credit_nonces (
    wallet TEXT NOT NULL,
    nonce TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (wallet, nonce)
  )
`;

type Row = Record<string, any>;
const PRUNE_EVERY_MS = 3_600_000;

class PostgresCreditStore implements CreditStore {
  private sql: { query: (text: string, params?: unknown[]) => Promise<unknown> };
  private initPromise: Promise<void> | null = null;
  private lastPrune = 0;

  /** A Neon URL in production; tests pass any `{ query(text, params) => rows }` (e.g. a pg Pool adapter). */
  constructor(conn: string | { query: (text: string, params?: unknown[]) => Promise<unknown> }) {
    this.sql = typeof conn === 'string' ? (neon(conn) as unknown as typeof this.sql) : conn;
  }

  private async q(text: string, params: unknown[] = []): Promise<Row[]> {
    await this.init();
    return this.sql.query(text, params) as unknown as Promise<Row[]>;
  }

  private init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        for (const stmt of SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) await this.sql.query(stmt);
      })().catch((e) => {
        this.initPromise = null;
        throw e;
      });
    }
    return this.initPromise;
  }

  async credit(wallet: string, micro: bigint, txHash: string): Promise<'credited' | 'duplicate'> {
    const rows = await this.q(
      `WITH ins AS (
         INSERT INTO credit_ledger (wallet, delta_micro, kind, tx_hash) VALUES ($1, $2, 'purchase', $3)
         ON CONFLICT (tx_hash) DO NOTHING RETURNING wallet, delta_micro)
       INSERT INTO credit_accounts (wallet, balance_micro) SELECT wallet, delta_micro FROM ins
       ON CONFLICT (wallet) DO UPDATE SET balance_micro = credit_accounts.balance_micro + EXCLUDED.balance_micro, updated_at = now()
       RETURNING balance_micro`,
      [wallet, micro.toString(), txHash],
    );
    return rows.length > 0 ? 'credited' : 'duplicate';
  }

  async creditPurchase(wallet: string, priceMicro: bigint, creditMicro: bigint, txHash: string, refCandidate: string | null): Promise<PurchaseResult> {
    // 1. Record (or read) the sticky referrer. Self-referral is ignored.
    const ref = refCandidate && refCandidate !== wallet ? refCandidate : null;
    const [acct] = await this.q(
      `INSERT INTO credit_accounts (wallet, referrer) VALUES ($1, $2)
       ON CONFLICT (wallet) DO UPDATE SET referrer = COALESCE(credit_accounts.referrer, EXCLUDED.referrer)
       RETURNING referrer`,
      [wallet, ref],
    );
    const referrer: string | null = acct?.referrer ?? null;
    const { buyerBonus, reward } = referralSplit(priceMicro, referrer !== null);
    // 2. Credit the buyer once per tx.
    const buyerMicro = creditMicro + buyerBonus;
    if ((await this.credit(wallet, buyerMicro, txHash)) === 'duplicate') {
      return { status: 'duplicate', referrer, buyerMicro: 0n, referrerMicro: 0n };
    }
    // 3. Reward the referrer once per tx (idempotency key: "<tx>:ref").
    if (referrer && reward > 0n) {
      await this.q(
        `WITH ins AS (
           INSERT INTO credit_ledger (wallet, delta_micro, kind, tx_hash, endpoint) VALUES ($1, $2, 'referral', $3, $4)
           ON CONFLICT (tx_hash) DO NOTHING RETURNING wallet, delta_micro)
         INSERT INTO credit_accounts (wallet, balance_micro) SELECT wallet, delta_micro FROM ins
         ON CONFLICT (wallet) DO UPDATE SET balance_micro = credit_accounts.balance_micro + EXCLUDED.balance_micro, updated_at = now()`,
        [referrer, reward.toString(), `${txHash}:ref`, wallet],
      );
    }
    return { status: 'credited', referrer, buyerMicro, referrerMicro: referrer ? reward : 0n };
  }

  async referralStats(wallet: string): Promise<{ earnedMicro: bigint; referred: number }> {
    const [r] = await this.q(
      `SELECT (SELECT COALESCE(SUM(delta_micro), 0) FROM credit_ledger WHERE wallet = $1 AND kind = 'referral') AS earned,
              (SELECT COUNT(*) FROM credit_accounts WHERE referrer = $1)::int AS referred`,
      [wallet],
    );
    return { earnedMicro: BigInt(r?.earned ?? 0), referred: Number(r?.referred ?? 0) };
  }

  async spend(wallet: string, nonce: string, ttlSec: number, micro: bigint, endpoint: string, requestId: string): Promise<SpendResult> {
    const [r] = await this.q(
      `WITH n AS (
         INSERT INTO credit_nonces (wallet, nonce, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3))
         ON CONFLICT DO NOTHING RETURNING 1),
       d AS (
         UPDATE credit_accounts SET balance_micro = balance_micro - $4, updated_at = now()
         WHERE wallet = $1 AND balance_micro >= $4 AND EXISTS (SELECT 1 FROM n) RETURNING balance_micro),
       l AS (
         INSERT INTO credit_ledger (wallet, delta_micro, kind, endpoint, request_id)
         SELECT $1, -$4, 'spend', $5, $6 FROM d RETURNING 1)
       SELECT (SELECT count(*) FROM n)::int AS nonce_ok,
              (SELECT balance_micro FROM d) AS after,
              (SELECT balance_micro FROM credit_accounts WHERE wallet = $1) AS before`,
      [wallet, nonce, ttlSec, micro.toString(), endpoint, requestId],
    );
    this.maybePrune();
    if (!r || r.nonce_ok === 0) return { status: 'replay' };
    if (r.after === null || r.after === undefined) return { status: 'insufficient', balanceMicro: BigInt(r.before ?? 0) };
    return { status: 'ok', balanceMicro: BigInt(r.after) };
  }

  async refund(wallet: string, micro: bigint, endpoint: string, requestId: string): Promise<void> {
    await this.q(
      `WITH u AS (
         UPDATE credit_accounts SET balance_micro = balance_micro + $2, updated_at = now() WHERE wallet = $1 RETURNING 1)
       INSERT INTO credit_ledger (wallet, delta_micro, kind, endpoint, request_id)
       SELECT $1, $2, 'refund', $3, $4 FROM u`,
      [wallet, micro.toString(), endpoint, requestId],
    );
  }

  async balance(wallet: string): Promise<{ micro: bigint; updatedAt: string | null }> {
    const rows = await this.q('SELECT balance_micro, updated_at FROM credit_accounts WHERE wallet = $1', [wallet]);
    return rows[0]
      ? { micro: BigInt(rows[0].balance_micro), updatedAt: new Date(rows[0].updated_at).toISOString() }
      : { micro: 0n, updatedAt: null };
  }

  async liability(): Promise<bigint> {
    const [r] = await this.q('SELECT COALESCE(SUM(balance_micro), 0) AS total FROM credit_accounts');
    return BigInt(r?.total ?? 0);
  }

  private maybePrune(): void {
    if (Date.now() - this.lastPrune < PRUNE_EVERY_MS) return;
    this.lastPrune = Date.now();
    this.q('DELETE FROM credit_nonces WHERE expires_at < now()').catch(() => { /* next hour */ });
  }
}

/** Single-threaded JS makes each method atomic as long as it never awaits mid-update. */
export class MemoryCreditStore implements CreditStore {
  private accounts = new Map<string, { micro: bigint; updatedAt: string }>();
  private referrers = new Map<string, string>();
  private txs = new Set<string>();
  private nonces = new Map<string, number>();
  readonly ledger: Array<{ wallet: string; delta: bigint; kind: string; endpoint?: string; requestId?: string }> = [];

  async credit(wallet: string, micro: bigint, txHash: string): Promise<'credited' | 'duplicate'> {
    if (this.txs.has(txHash)) return 'duplicate';
    this.txs.add(txHash);
    const cur = this.accounts.get(wallet)?.micro ?? 0n;
    this.accounts.set(wallet, { micro: cur + micro, updatedAt: new Date().toISOString() });
    this.ledger.push({ wallet, delta: micro, kind: 'purchase' });
    return 'credited';
  }

  async creditPurchase(wallet: string, priceMicro: bigint, creditMicro: bigint, txHash: string, refCandidate: string | null): Promise<PurchaseResult> {
    const ref = refCandidate && refCandidate !== wallet ? refCandidate : null;
    if (ref && !this.referrers.has(wallet)) this.referrers.set(wallet, ref);
    if (!this.accounts.has(wallet)) this.accounts.set(wallet, { micro: 0n, updatedAt: new Date().toISOString() });
    const referrer = this.referrers.get(wallet) ?? null;
    const { buyerBonus, reward } = referralSplit(priceMicro, referrer !== null);
    const buyerMicro = creditMicro + buyerBonus;
    if ((await this.credit(wallet, buyerMicro, txHash)) === 'duplicate') return { status: 'duplicate', referrer, buyerMicro: 0n, referrerMicro: 0n };
    if (referrer && reward > 0n && !this.txs.has(`${txHash}:ref`)) {
      this.txs.add(`${txHash}:ref`);
      const cur = this.accounts.get(referrer)?.micro ?? 0n;
      this.accounts.set(referrer, { micro: cur + reward, updatedAt: new Date().toISOString() });
      this.ledger.push({ wallet: referrer, delta: reward, kind: 'referral', endpoint: wallet });
    }
    return { status: 'credited', referrer, buyerMicro, referrerMicro: referrer ? reward : 0n };
  }

  async referralStats(wallet: string): Promise<{ earnedMicro: bigint; referred: number }> {
    const earned = this.ledger.filter((l) => l.wallet === wallet && l.kind === 'referral').reduce((s, l) => s + l.delta, 0n);
    return { earnedMicro: earned, referred: [...this.referrers.values()].filter((r) => r === wallet).length };
  }

  async spend(wallet: string, nonce: string, ttlSec: number, micro: bigint, endpoint: string, requestId: string): Promise<SpendResult> {
    const key = `${wallet}:${nonce}`;
    const now = Date.now();
    const exp = this.nonces.get(key);
    if (exp !== undefined && exp > now) return { status: 'replay' };
    this.nonces.set(key, now + ttlSec * 1000);
    const cur = this.accounts.get(wallet)?.micro ?? 0n;
    if (cur < micro) return { status: 'insufficient', balanceMicro: cur };
    this.accounts.set(wallet, { micro: cur - micro, updatedAt: new Date().toISOString() });
    this.ledger.push({ wallet, delta: -micro, kind: 'spend', endpoint, requestId });
    return { status: 'ok', balanceMicro: cur - micro };
  }

  async refund(wallet: string, micro: bigint, endpoint: string, requestId: string): Promise<void> {
    const acct = this.accounts.get(wallet);
    if (!acct) return;
    this.accounts.set(wallet, { micro: acct.micro + micro, updatedAt: new Date().toISOString() });
    this.ledger.push({ wallet, delta: micro, kind: 'refund', endpoint, requestId });
  }

  async balance(wallet: string): Promise<{ micro: bigint; updatedAt: string | null }> {
    const a = this.accounts.get(wallet);
    return { micro: a?.micro ?? 0n, updatedAt: a?.updatedAt ?? null };
  }

  async liability(): Promise<bigint> {
    let t = 0n;
    for (const a of this.accounts.values()) t += a.micro;
    return t;
  }
}

/** For SQL tests against a real Postgres. */
export function createPostgresCreditStore(conn: { query: (text: string, params?: unknown[]) => Promise<unknown> }) {
  return new PostgresCreditStore(conn);
}

let store: CreditStore | null = null;

export function getCreditStore(): CreditStore {
  if (!store) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    store = url ? new PostgresCreditStore(url) : new MemoryCreditStore();
  }
  return store;
}

/** Test hook. */
export function setCreditStore(s: CreditStore | null): void {
  store = s;
}
