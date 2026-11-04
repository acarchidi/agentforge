/**
 * Watch storage: Neon in production, in-memory locally and in tests.
 *
 * Each scheduler run makes a fixed handful of queries whatever the number of
 * watches: expire, claim, one batched state write (jsonb_to_recordset), one
 * batched alert insert, one pending-alert read, one batched delivery update.
 */

import { neon } from '@neondatabase/serverless';
import type { WatchType } from '../schemas/watch.js';
import { CHECK_EVERY_MIN } from './checkers.js';

export interface WatchRecord {
  id: string;
  type: WatchType;
  chain: string;
  target: string;
  webhookUrl: string;
  params: { threshold?: number };
  status: 'active' | 'expired' | 'cancelled';
  createdAt: string;
  expiresAt: string;
  nextCheckAt: string;
  lastCheckAt: string | null;
  lastState: Record<string, unknown> | null;
  failures: number;
  payerHash: string | null;
}

export interface AlertRecord {
  id: number;
  watchId: string;
  ts: string;
  event: string;
  payload: Record<string, unknown>;
  delivered: boolean;
  attempts: number;
  lastError: string | null;
}

export interface NewAlert {
  watchId: string;
  event: string;
  payload: Record<string, unknown>;
  /** Already delivered (the creation test event); otherwise queued for the scheduler. */
  delivered?: { ok: boolean; error?: string };
}

export const MAX_ATTEMPTS = 6;
/** The cron fires every 30 min; claiming a little early keeps a 30-min watch on every run. */
const CLAIM_SLACK_MIN = 2;

export interface WatchStore {
  create(w: Omit<WatchRecord, 'status' | 'createdAt' | 'nextCheckAt' | 'lastCheckAt' | 'failures'>): Promise<void>;
  get(id: string): Promise<WatchRecord | null>;
  cancel(id: string): Promise<boolean>;
  recentAlerts(id: string, limit: number): Promise<AlertRecord[]>;
  expire(): Promise<WatchRecord[]>;
  claimDue(limit: number): Promise<WatchRecord[]>;
  /** Persist results; returns each watch's consecutive failure count after the update. */
  saveChecks(results: Array<{ id: string; ok: boolean; state: Record<string, unknown> | null }>): Promise<Map<string, number>>;
  addAlerts(alerts: NewAlert[]): Promise<void>;
  pendingAlerts(limit: number): Promise<Array<AlertRecord & { webhookUrl: string }>>;
  markDeliveries(results: Array<{ id: number; ok: boolean; error?: string }>): Promise<void>;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS watches (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL, chain TEXT NOT NULL, target TEXT NOT NULL,
    webhook_url TEXT NOT NULL,
    params JSONB NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    next_check_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_check_at TIMESTAMPTZ,
    last_state JSONB,
    consecutive_check_failures INT NOT NULL DEFAULT 0,
    payer_hash TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_watches_due ON watches(status, next_check_at);
  CREATE TABLE IF NOT EXISTS watch_alerts (
    id BIGSERIAL PRIMARY KEY,
    watch_id TEXT NOT NULL REFERENCES watches(id),
    ts TIMESTAMPTZ NOT NULL DEFAULT now(),
    event TEXT NOT NULL,
    payload JSONB NOT NULL,
    delivered BOOLEAN NOT NULL DEFAULT false,
    attempts INT NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_error TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_watch_alerts_pending ON watch_alerts(delivered, next_attempt_at);
  CREATE INDEX IF NOT EXISTS idx_watch_alerts_watch ON watch_alerts(watch_id, id DESC)
`;

type Row = Record<string, any>;
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

function watchFrom(r: Row): WatchRecord {
  return {
    id: r.id, type: r.type, chain: r.chain, target: r.target, webhookUrl: r.webhook_url,
    params: r.params ?? {}, status: r.status, createdAt: iso(r.created_at)!, expiresAt: iso(r.expires_at)!,
    nextCheckAt: iso(r.next_check_at)!, lastCheckAt: iso(r.last_check_at), lastState: r.last_state ?? null,
    failures: r.consecutive_check_failures ?? 0, payerHash: r.payer_hash ?? null,
  };
}

function alertFrom(r: Row): AlertRecord {
  return {
    id: Number(r.id), watchId: r.watch_id, ts: iso(r.ts)!, event: r.event, payload: r.payload,
    delivered: r.delivered, attempts: r.attempts, lastError: r.last_error ?? null,
  };
}

class PostgresWatchStore implements WatchStore {
  private sql: { query: (text: string, params?: unknown[]) => Promise<unknown> };
  private initPromise: Promise<void> | null = null;

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

  async create(w: Parameters<WatchStore['create']>[0]): Promise<void> {
    await this.q(
      `INSERT INTO watches (id, type, chain, target, webhook_url, params, expires_at, next_check_at, last_check_at, last_state, payer_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now() + make_interval(mins => $8), now(), $9, $10)`,
      [w.id, w.type, w.chain, w.target, w.webhookUrl, JSON.stringify(w.params), w.expiresAt,
        CHECK_EVERY_MIN[w.type] - CLAIM_SLACK_MIN, w.lastState ? JSON.stringify(w.lastState) : null, w.payerHash],
    );
  }

  async get(id: string): Promise<WatchRecord | null> {
    const rows = await this.q('SELECT * FROM watches WHERE id = $1', [id]);
    return rows[0] ? watchFrom(rows[0]) : null;
  }

  async cancel(id: string): Promise<boolean> {
    const rows = await this.q(`UPDATE watches SET status = 'cancelled' WHERE id = $1 AND status = 'active' RETURNING id`, [id]);
    return rows.length > 0;
  }

  async recentAlerts(id: string, limit: number): Promise<AlertRecord[]> {
    return (await this.q('SELECT * FROM watch_alerts WHERE watch_id = $1 ORDER BY id DESC LIMIT $2', [id, limit])).map(alertFrom);
  }

  async expire(): Promise<WatchRecord[]> {
    return (await this.q(`UPDATE watches SET status = 'expired' WHERE status = 'active' AND expires_at < now() RETURNING *`)).map(watchFrom);
  }

  async claimDue(limit: number): Promise<WatchRecord[]> {
    const rows = await this.q(
      `UPDATE watches SET next_check_at = now() + make_interval(mins => CASE type WHEN 'token-risk' THEN $2::int ELSE $3::int END)
       WHERE id IN (SELECT id FROM watches WHERE status = 'active' AND next_check_at <= now()
                    ORDER BY next_check_at LIMIT $1 FOR UPDATE SKIP LOCKED)
       RETURNING *`,
      [limit, CHECK_EVERY_MIN['token-risk'] - CLAIM_SLACK_MIN, CHECK_EVERY_MIN['contract-admin'] - CLAIM_SLACK_MIN],
    );
    return rows.map(watchFrom);
  }

  async saveChecks(results: Array<{ id: string; ok: boolean; state: Record<string, unknown> | null }>): Promise<Map<string, number>> {
    if (results.length === 0) return new Map();
    const rows = await this.q(
      `UPDATE watches w SET
         last_state = COALESCE(v.state, w.last_state),
         last_check_at = now(),
         consecutive_check_failures = CASE WHEN v.ok THEN 0 ELSE w.consecutive_check_failures + 1 END
       FROM jsonb_to_recordset($1::jsonb) AS v(id text, ok boolean, state jsonb)
       WHERE w.id = v.id
       RETURNING w.id, w.consecutive_check_failures`,
      [JSON.stringify(results)],
    );
    return new Map(rows.map((r) => [r.id as string, Number(r.consecutive_check_failures)]));
  }

  async addAlerts(alerts: NewAlert[]): Promise<void> {
    if (alerts.length === 0) return;
    await this.q(
      `INSERT INTO watch_alerts (watch_id, event, payload, delivered, attempts, last_error)
       SELECT watch_id, event, payload, COALESCE(delivered, false), COALESCE(attempts, 0), last_error
       FROM jsonb_to_recordset($1::jsonb) AS v(watch_id text, event text, payload jsonb, delivered boolean, attempts int, last_error text)`,
      [JSON.stringify(alerts.map((a) => ({
        watch_id: a.watchId, event: a.event, payload: a.payload,
        delivered: a.delivered?.ok ?? false, attempts: a.delivered ? 1 : 0, last_error: a.delivered?.error ?? null,
      })))],
    );
  }

  async pendingAlerts(limit: number): Promise<Array<AlertRecord & { webhookUrl: string }>> {
    const rows = await this.q(
      `SELECT a.*, w.webhook_url FROM watch_alerts a JOIN watches w ON w.id = a.watch_id
       WHERE NOT a.delivered AND a.next_attempt_at <= now() AND a.attempts < $2
       ORDER BY a.id LIMIT $1`,
      [limit, MAX_ATTEMPTS],
    );
    return rows.map((r) => ({ ...alertFrom(r), webhookUrl: r.webhook_url }));
  }

  async markDeliveries(results: Array<{ id: number; ok: boolean; error?: string }>): Promise<void> {
    if (results.length === 0) return;
    await this.q(
      `UPDATE watch_alerts a SET
         delivered = v.ok,
         attempts = a.attempts + 1,
         next_attempt_at = now() + make_interval(mins => power(2, a.attempts)::int),
         last_error = v.error
       FROM jsonb_to_recordset($1::jsonb) AS v(id bigint, ok boolean, error text)
       WHERE a.id = v.id`,
      [JSON.stringify(results.map((r) => ({ id: r.id, ok: r.ok, error: r.error ?? null })))],
    );
  }
}

export class MemoryWatchStore implements WatchStore {
  readonly watches = new Map<string, WatchRecord>();
  readonly alerts: Array<AlertRecord & { nextAttemptAt: number }> = [];
  private seq = 0;
  /** Test clock. */
  now = () => Date.now();

  async create(w: Parameters<WatchStore['create']>[0]): Promise<void> {
    const t = this.now();
    this.watches.set(w.id, {
      ...w, status: 'active', createdAt: new Date(t).toISOString(),
      nextCheckAt: new Date(t + (CHECK_EVERY_MIN[w.type] - CLAIM_SLACK_MIN) * 60_000).toISOString(),
      lastCheckAt: new Date(t).toISOString(), failures: 0,
    });
  }

  async get(id: string): Promise<WatchRecord | null> {
    return this.watches.get(id) ?? null;
  }

  async cancel(id: string): Promise<boolean> {
    const w = this.watches.get(id);
    if (!w || w.status !== 'active') return false;
    w.status = 'cancelled';
    return true;
  }

  async recentAlerts(id: string, limit: number): Promise<AlertRecord[]> {
    return this.alerts.filter((a) => a.watchId === id).reverse().slice(0, limit);
  }

  async expire(): Promise<WatchRecord[]> {
    const out: WatchRecord[] = [];
    for (const w of this.watches.values()) {
      if (w.status === 'active' && Date.parse(w.expiresAt) < this.now()) {
        w.status = 'expired';
        out.push(w);
      }
    }
    return out;
  }

  async claimDue(limit: number): Promise<WatchRecord[]> {
    const due = [...this.watches.values()]
      .filter((w) => w.status === 'active' && Date.parse(w.nextCheckAt) <= this.now())
      .sort((a, b) => Date.parse(a.nextCheckAt) - Date.parse(b.nextCheckAt))
      .slice(0, limit);
    for (const w of due) w.nextCheckAt = new Date(this.now() + (CHECK_EVERY_MIN[w.type] - CLAIM_SLACK_MIN) * 60_000).toISOString();
    return due.map((w) => ({ ...w }));
  }

  async saveChecks(results: Array<{ id: string; ok: boolean; state: Record<string, unknown> | null }>): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    for (const r of results) {
      const w = this.watches.get(r.id);
      if (!w) continue;
      if (r.state) w.lastState = r.state;
      w.lastCheckAt = new Date(this.now()).toISOString();
      w.failures = r.ok ? 0 : w.failures + 1;
      out.set(r.id, w.failures);
    }
    return out;
  }

  async addAlerts(alerts: NewAlert[]): Promise<void> {
    for (const a of alerts) {
      this.alerts.push({
        id: ++this.seq, watchId: a.watchId, ts: new Date(this.now()).toISOString(), event: a.event, payload: a.payload,
        delivered: a.delivered?.ok ?? false, attempts: a.delivered ? 1 : 0, lastError: a.delivered?.error ?? null,
        nextAttemptAt: this.now(),
      });
    }
  }

  async pendingAlerts(limit: number): Promise<Array<AlertRecord & { webhookUrl: string }>> {
    return this.alerts
      .filter((a) => !a.delivered && a.nextAttemptAt <= this.now() && a.attempts < MAX_ATTEMPTS)
      .slice(0, limit)
      .map((a) => ({ ...a, webhookUrl: this.watches.get(a.watchId)?.webhookUrl ?? '' }));
  }

  async markDeliveries(results: Array<{ id: number; ok: boolean; error?: string }>): Promise<void> {
    for (const r of results) {
      const a = this.alerts.find((x) => x.id === r.id);
      if (!a) continue;
      a.nextAttemptAt = this.now() + 2 ** a.attempts * 60_000;
      a.attempts += 1;
      a.delivered = r.ok;
      a.lastError = r.error ?? null;
    }
  }
}

/** For SQL tests against a real Postgres. */
export function createPostgresWatchStore(conn: { query: (text: string, params?: unknown[]) => Promise<unknown> }) {
  return new PostgresWatchStore(conn);
}

let store: WatchStore | null = null;

export function getWatchStore(): WatchStore {
  if (!store) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    store = url ? new PostgresWatchStore(url) : new MemoryWatchStore();
  }
  return store;
}

/** Test hook. */
export function setWatchStore(s: WatchStore | null): void {
  store = s;
}
