/**
 * Durable analytics store.
 *
 * Backend selection:
 *   - Postgres (Neon via HTTP driver) when DATABASE_URL / POSTGRES_URL is set.
 *     This is the production path on Vercel — nothing on the lambda filesystem survives.
 *   - SQLite (better-sqlite3) otherwise, for local development and tests.
 *
 * One `events` table holds every MCP tool call and every paid HTTP request.
 * Identifiers are already hashed by the caller (see clientId.ts); the store never
 * sees a raw wallet address or session id.
 */
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { getDb } from './db.js';

export type EventKind = 'paid' | 'mcp' | 'cap_hit' | 'settle_failed';

export interface AnalyticsEvent {
  kind: EventKind;
  /** Endpoint path (paid) or tool name (mcp). */
  name: string;
  chain?: string;
  latencyMs?: number;
  success: boolean;
  errorClass?: string;
  paymentNetwork?: string;
  paymentScheme?: string;
  clientHash?: string;
  amountUsd?: number;
  estimatedCostUsd?: number;
  txHash?: string;
  inputSize?: number;
  outputSize?: number;
}

export interface FeedbackEntry {
  type: string;
  endpoint?: string | null;
  message: string;
  contact?: string | null;
}

export type Row = Record<string, unknown>;

export interface AnalyticsStore {
  readonly backend: 'postgres' | 'sqlite';
  init(): Promise<void>;
  insertEvent(event: AnalyticsEvent): Promise<void>;
  insertFeedback(entry: FeedbackEntry): Promise<void>;
  /** Number of events of `kind` for `name` by `clientHash` since UTC midnight. */
  countToday(kind: EventKind, name: string, clientHash: string): Promise<number>;
  overview(): Promise<Row[]>;
  revenue(): Promise<Row[]>;
  last24h(): Promise<Row[]>;
  dailyRevenue(days: number): Promise<Row[]>;
  recentCalls(limit: number): Promise<Row[]>;
  feedback(limit: number): Promise<Row[]>;
  dailySummary(days: number): Promise<DailySummary>;
  pruneOlderThan(days: number): Promise<number>;
}

export interface DailySummary {
  days: number;
  generatedAt: string;
  /** date → endpoint/tool → { calls, uniqueClients, kind } */
  perDay: Array<{
    date: string;
    name: string;
    kind: string;
    calls: number;
    uniqueClients: number;
    successRate: number;
  }>;
  split: Array<{ date: string; mcp: number; paid: number; capHits: number }>;
  topTools: Array<{ name: string; kind: string; calls: number; uniqueClients: number }>;
  repeatClients: Array<{ name: string; clients: number; repeatClients: number; callsPerClient: number }>;
}

export const RETENTION_DAYS = 90;

// ────────────────────────────────────────────────────────────────────
// Postgres
// ────────────────────────────────────────────────────────────────────

const PG_SCHEMA = `
  CREATE TABLE IF NOT EXISTS events (
    id BIGSERIAL PRIMARY KEY,
    ts TIMESTAMPTZ NOT NULL DEFAULT now(),
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    chain TEXT,
    latency_ms INTEGER,
    success BOOLEAN NOT NULL,
    error_class TEXT,
    payment_network TEXT,
    payment_scheme TEXT,
    client_hash TEXT,
    amount_usd NUMERIC(12,6),
    estimated_cost_usd NUMERIC(12,6),
    tx_hash TEXT,
    input_size INTEGER,
    output_size INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
  CREATE INDEX IF NOT EXISTS idx_events_name_ts ON events(name, ts);
  CREATE INDEX IF NOT EXISTS idx_events_client_day ON events(client_hash, kind, name, ts);
  CREATE TABLE IF NOT EXISTS feedback (
    id BIGSERIAL PRIMARY KEY,
    ts TIMESTAMPTZ NOT NULL DEFAULT now(),
    type TEXT NOT NULL,
    endpoint TEXT,
    message TEXT NOT NULL,
    contact TEXT
  );
`;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

class PostgresStore implements AnalyticsStore {
  readonly backend = 'postgres' as const;
  private sql: NeonQueryFunction<false, false>;
  private initPromise: Promise<void> | null = null;

  constructor(url: string) {
    this.sql = neon(url);
  }

  private q<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
    return withTimeout(this.sql.query(text, params) as unknown as Promise<T[]>, 5000, 'analytics query');
  }

  async init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        for (const stmt of PG_SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) {
          await this.q(stmt);
        }
      })().catch((e) => {
        this.initPromise = null;
        throw e;
      });
    }
    return this.initPromise;
  }

  async insertEvent(e: AnalyticsEvent): Promise<void> {
    await this.init();
    await this.q(
      `INSERT INTO events (kind, name, chain, latency_ms, success, error_class, payment_network, payment_scheme,
         client_hash, amount_usd, estimated_cost_usd, tx_hash, input_size, output_size)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [e.kind, e.name, e.chain ?? null, e.latencyMs ?? null, e.success, e.errorClass ?? null,
        e.paymentNetwork ?? null, e.paymentScheme ?? null, e.clientHash ?? null, e.amountUsd ?? null,
        e.estimatedCostUsd ?? null, e.txHash ?? null, e.inputSize ?? null, e.outputSize ?? null],
    );
  }

  async insertFeedback(f: FeedbackEntry): Promise<void> {
    await this.init();
    await this.q(`INSERT INTO feedback (type, endpoint, message, contact) VALUES ($1,$2,$3,$4)`,
      [f.type, f.endpoint ?? null, f.message, f.contact ?? null]);
  }

  async countToday(kind: EventKind, name: string, clientHash: string): Promise<number> {
    await this.init();
    const rows = await this.q<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM events
       WHERE kind = $1 AND name = $2 AND client_hash = $3 AND ts >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
      [kind, name, clientHash],
    );
    return Number(rows[0]?.n ?? 0);
  }

  overview(): Promise<Row[]> {
    return this.init().then(() => this.q(
      `SELECT name AS endpoint, kind,
         COUNT(*)::int AS total_calls,
         SUM(CASE WHEN success THEN 1 ELSE 0 END)::int AS successful_calls,
         ROUND(AVG(latency_ms))::int AS avg_latency_ms,
         ROUND(AVG(CASE WHEN success THEN latency_ms END))::int AS avg_success_latency_ms,
         COUNT(DISTINCT client_hash)::int AS unique_clients,
         MIN(ts) AS first_call, MAX(ts) AS last_call
       FROM events WHERE kind IN ('paid','mcp')
       GROUP BY name, kind ORDER BY total_calls DESC`));
  }

  revenue(): Promise<Row[]> {
    return this.init().then(() => this.q(
      `SELECT name AS endpoint,
         COUNT(*)::int AS total_payments,
         ROUND(SUM(amount_usd), 4)::float AS total_revenue_usd,
         ROUND(SUM(estimated_cost_usd), 4)::float AS total_cost_usd,
         ROUND(SUM(amount_usd) - COALESCE(SUM(estimated_cost_usd), 0), 4)::float AS gross_profit_usd
       FROM events WHERE kind = 'paid' AND success GROUP BY name`));
  }

  last24h(): Promise<Row[]> {
    return this.init().then(() => this.q(
      `SELECT name AS endpoint, COUNT(*)::int AS calls_24h, SUM(CASE WHEN success THEN 1 ELSE 0 END)::int AS success_24h
       FROM events WHERE kind IN ('paid','mcp') AND ts > now() - interval '24 hours' GROUP BY name`));
  }

  dailyRevenue(days: number): Promise<Row[]> {
    return this.init().then(() => this.q(
      `SELECT to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date, name AS endpoint,
         COUNT(*)::int AS payments, ROUND(SUM(amount_usd), 4)::float AS revenue_usd
       FROM events WHERE kind = 'paid' AND success AND ts > now() - ($1 || ' days')::interval
       GROUP BY 1, 2 ORDER BY date DESC`, [String(days)]));
  }

  recentCalls(limit: number): Promise<Row[]> {
    return this.init().then(() => this.q(
      `SELECT name AS endpoint, kind, success, latency_ms AS "latencyMs", error_class AS "errorType",
         chain, payment_network AS "paymentNetwork", payment_scheme AS "paymentScheme", client_hash AS "clientHash",
         ts AS timestamp
       FROM events ORDER BY id DESC LIMIT $1`, [limit]));
  }

  feedback(limit: number): Promise<Row[]> {
    return this.init().then(() => this.q(
      `SELECT id, type, endpoint, message, contact, ts AS timestamp FROM feedback ORDER BY id DESC LIMIT $1`, [limit]));
  }

  async dailySummary(days: number): Promise<DailySummary> {
    await this.init();
    const since = [String(days)];
    const perDay = await this.q<DailySummary['perDay'][number]>(
      `SELECT to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date, name, kind,
         COUNT(*)::int AS calls, COUNT(DISTINCT client_hash)::int AS "uniqueClients",
         ROUND(AVG(CASE WHEN success THEN 1.0 ELSE 0.0 END), 3)::float AS "successRate"
       FROM events WHERE kind IN ('paid','mcp') AND ts > now() - ($1 || ' days')::interval
       GROUP BY 1, 2, 3 ORDER BY date DESC, calls DESC`, since);
    const split = await this.q<DailySummary['split'][number]>(
      `SELECT to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
         SUM(CASE WHEN kind = 'mcp' THEN 1 ELSE 0 END)::int AS mcp,
         SUM(CASE WHEN kind = 'paid' THEN 1 ELSE 0 END)::int AS paid,
         SUM(CASE WHEN kind = 'cap_hit' THEN 1 ELSE 0 END)::int AS "capHits"
       FROM events WHERE ts > now() - ($1 || ' days')::interval GROUP BY 1 ORDER BY date DESC`, since);
    const topTools = await this.q<DailySummary['topTools'][number]>(
      `SELECT name, kind, COUNT(*)::int AS calls, COUNT(DISTINCT client_hash)::int AS "uniqueClients"
       FROM events WHERE kind IN ('paid','mcp') AND ts > now() - ($1 || ' days')::interval
       GROUP BY name, kind ORDER BY calls DESC LIMIT 10`, since);
    const repeatClients = await this.q<DailySummary['repeatClients'][number]>(
      `SELECT name, COUNT(*)::int AS clients,
         SUM(CASE WHEN n > 1 THEN 1 ELSE 0 END)::int AS "repeatClients",
         ROUND(AVG(n), 1)::float AS "callsPerClient"
       FROM (SELECT name, client_hash, COUNT(*) AS n FROM events
             WHERE kind = 'paid' AND client_hash IS NOT NULL AND ts > now() - ($1 || ' days')::interval
             GROUP BY name, client_hash) t
       GROUP BY name ORDER BY clients DESC`, since);
    return { days, generatedAt: new Date().toISOString(), perDay, split, topTools, repeatClients };
  }

  async pruneOlderThan(days: number): Promise<number> {
    await this.init();
    const rows = await this.q<{ n: string }>(
      `WITH d AS (DELETE FROM events WHERE ts < now() - ($1 || ' days')::interval RETURNING 1) SELECT COUNT(*)::text AS n FROM d`,
      [String(days)]);
    await this.q(`DELETE FROM feedback WHERE ts < now() - ($1 || ' days')::interval`, [String(days)]);
    return Number(rows[0]?.n ?? 0);
  }
}

// ────────────────────────────────────────────────────────────────────
// SQLite (local dev / tests)
// ────────────────────────────────────────────────────────────────────

class SqliteStore implements AnalyticsStore {
  readonly backend = 'sqlite' as const;

  async init(): Promise<void> {
    getDb().exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        chain TEXT,
        latency_ms INTEGER,
        success INTEGER NOT NULL,
        error_class TEXT,
        payment_network TEXT,
        payment_scheme TEXT,
        client_hash TEXT,
        amount_usd REAL,
        estimated_cost_usd REAL,
        tx_hash TEXT,
        input_size INTEGER,
        output_size INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
      CREATE INDEX IF NOT EXISTS idx_events_name_ts ON events(name, ts);
      CREATE TABLE IF NOT EXISTS feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        endpoint TEXT,
        message TEXT NOT NULL,
        contact TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  async insertEvent(e: AnalyticsEvent): Promise<void> {
    getDb().prepare(
      `INSERT INTO events (kind, name, chain, latency_ms, success, error_class, payment_network, payment_scheme,
         client_hash, amount_usd, estimated_cost_usd, tx_hash, input_size, output_size)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(e.kind, e.name, e.chain ?? null, e.latencyMs ?? null, e.success ? 1 : 0, e.errorClass ?? null,
      e.paymentNetwork ?? null, e.paymentScheme ?? null, e.clientHash ?? null, e.amountUsd ?? null,
      e.estimatedCostUsd ?? null, e.txHash ?? null, e.inputSize ?? null, e.outputSize ?? null);
  }

  async insertFeedback(f: FeedbackEntry): Promise<void> {
    getDb().prepare(`INSERT INTO feedback (type, endpoint, message, contact) VALUES (?,?,?,?)`)
      .run(f.type, f.endpoint ?? null, f.message, f.contact ?? null);
  }

  async countToday(kind: EventKind, name: string, clientHash: string): Promise<number> {
    const row = getDb().prepare(
      `SELECT COUNT(*) AS n FROM events WHERE kind = ? AND name = ? AND client_hash = ? AND ts >= strftime('%Y-%m-%dT00:00:00Z','now')`,
    ).get(kind, name, clientHash) as { n: number };
    return row.n;
  }

  async overview(): Promise<Row[]> {
    return getDb().prepare(
      `SELECT name AS endpoint, kind, COUNT(*) AS total_calls,
         SUM(success) AS successful_calls,
         ROUND(AVG(latency_ms)) AS avg_latency_ms,
         ROUND(AVG(CASE WHEN success = 1 THEN latency_ms END)) AS avg_success_latency_ms,
         COUNT(DISTINCT client_hash) AS unique_clients,
         MIN(ts) AS first_call, MAX(ts) AS last_call
       FROM events WHERE kind IN ('paid','mcp') GROUP BY name, kind ORDER BY total_calls DESC`).all() as Row[];
  }

  async revenue(): Promise<Row[]> {
    return getDb().prepare(
      `SELECT name AS endpoint, COUNT(*) AS total_payments,
         ROUND(SUM(amount_usd), 4) AS total_revenue_usd,
         ROUND(SUM(estimated_cost_usd), 4) AS total_cost_usd,
         ROUND(SUM(amount_usd) - COALESCE(SUM(estimated_cost_usd), 0), 4) AS gross_profit_usd
       FROM events WHERE kind = 'paid' AND success = 1 GROUP BY name`).all() as Row[];
  }

  async last24h(): Promise<Row[]> {
    return getDb().prepare(
      `SELECT name AS endpoint, COUNT(*) AS calls_24h, SUM(success) AS success_24h
       FROM events WHERE kind IN ('paid','mcp') AND ts > strftime('%Y-%m-%dT%H:%M:%fZ','now','-24 hours') GROUP BY name`).all() as Row[];
  }

  async dailyRevenue(days: number): Promise<Row[]> {
    return getDb().prepare(
      `SELECT substr(ts,1,10) AS date, name AS endpoint, COUNT(*) AS payments, ROUND(SUM(amount_usd), 4) AS revenue_usd
       FROM events WHERE kind = 'paid' AND success = 1 AND ts > strftime('%Y-%m-%dT%H:%M:%fZ','now',?)
       GROUP BY 1, 2 ORDER BY date DESC`).all(`-${days} days`) as Row[];
  }

  async recentCalls(limit: number): Promise<Row[]> {
    return getDb().prepare(
      `SELECT name AS endpoint, kind, success, latency_ms AS latencyMs, error_class AS errorType, chain,
         payment_network AS paymentNetwork, payment_scheme AS paymentScheme, client_hash AS clientHash, ts AS timestamp
       FROM events ORDER BY id DESC LIMIT ?`).all(limit) as Row[];
  }

  async feedback(limit: number): Promise<Row[]> {
    return getDb().prepare(
      `SELECT id, type, endpoint, message, contact, created_at AS timestamp FROM feedback ORDER BY id DESC LIMIT ?`).all(limit) as Row[];
  }

  async dailySummary(days: number): Promise<DailySummary> {
    const db = getDb();
    const since = `-${days} days`;
    const perDay = db.prepare(
      `SELECT substr(ts,1,10) AS date, name, kind, COUNT(*) AS calls, COUNT(DISTINCT client_hash) AS uniqueClients,
         ROUND(AVG(success), 3) AS successRate
       FROM events WHERE kind IN ('paid','mcp') AND ts > strftime('%Y-%m-%dT%H:%M:%fZ','now',?)
       GROUP BY 1,2,3 ORDER BY date DESC, calls DESC`).all(since) as DailySummary['perDay'];
    const split = db.prepare(
      `SELECT substr(ts,1,10) AS date,
         SUM(CASE WHEN kind='mcp' THEN 1 ELSE 0 END) AS mcp,
         SUM(CASE WHEN kind='paid' THEN 1 ELSE 0 END) AS paid,
         SUM(CASE WHEN kind='cap_hit' THEN 1 ELSE 0 END) AS capHits
       FROM events WHERE ts > strftime('%Y-%m-%dT%H:%M:%fZ','now',?) GROUP BY 1 ORDER BY date DESC`).all(since) as DailySummary['split'];
    const topTools = db.prepare(
      `SELECT name, kind, COUNT(*) AS calls, COUNT(DISTINCT client_hash) AS uniqueClients
       FROM events WHERE kind IN ('paid','mcp') AND ts > strftime('%Y-%m-%dT%H:%M:%fZ','now',?)
       GROUP BY name, kind ORDER BY calls DESC LIMIT 10`).all(since) as DailySummary['topTools'];
    const repeatClients = db.prepare(
      `SELECT name, COUNT(*) AS clients, SUM(CASE WHEN n > 1 THEN 1 ELSE 0 END) AS repeatClients, ROUND(AVG(n),1) AS callsPerClient
       FROM (SELECT name, client_hash, COUNT(*) AS n FROM events
             WHERE kind='paid' AND client_hash IS NOT NULL AND ts > strftime('%Y-%m-%dT%H:%M:%fZ','now',?)
             GROUP BY name, client_hash) GROUP BY name ORDER BY clients DESC`).all(since) as DailySummary['repeatClients'];
    return { days, generatedAt: new Date().toISOString(), perDay, split, topTools, repeatClients };
  }

  async pruneOlderThan(days: number): Promise<number> {
    const db = getDb();
    const r = db.prepare(`DELETE FROM events WHERE ts < strftime('%Y-%m-%dT%H:%M:%fZ','now',?)`).run(`-${days} days`);
    db.prepare(`DELETE FROM feedback WHERE created_at < datetime('now',?)`).run(`-${days} days`);
    return r.changes;
  }
}

// ────────────────────────────────────────────────────────────────────
// Singleton + lazy retention
// ────────────────────────────────────────────────────────────────────

let store: AnalyticsStore | null = null;

export function getStore(): AnalyticsStore {
  if (!store) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    store = url ? new PostgresStore(url) : new SqliteStore();
  }
  return store;
}

/** Test hook: reset the singleton (e.g. after changing DATABASE_URL). */
export function resetStore(): void {
  store = null;
  lastPrune = 0;
}

let lastPrune = 0;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

/** Enforce the 90-day retention window at most once per hour per process. */
export async function maybePrune(): Promise<void> {
  const now = Date.now();
  if (now - lastPrune < PRUNE_INTERVAL_MS) return;
  lastPrune = now;
  try {
    const removed = await getStore().pruneOlderThan(RETENTION_DAYS);
    if (removed > 0) console.log(`analytics: pruned ${removed} events older than ${RETENTION_DAYS} days`);
  } catch (error) {
    console.error('analytics: prune failed:', error);
  }
}
