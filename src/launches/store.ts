/**
 * Launch feed storage: Neon in production (same DATABASE_URL as analytics),
 * in-memory locally and in tests.
 *
 * Ingestion is demand-driven — it runs inside a paid feed request when the
 * chain's data is older than the lease interval — so with no pollers nothing
 * runs and the database stays asleep. The lease row makes concurrent
 * instances skip rather than duplicate an ingestion.
 */

import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import type { TokenFacts } from './onchain.js';
import type { LaunchMarket, LaunchRisk } from './score.js';
import type { PoolActivity } from '../services/dataSources/geckoterminal.js';

export interface LaunchMarketRow extends LaunchMarket {
  marketCapUsd: number | null;
  volumeH24Usd: number | null;
  priceChangeH1Pct: number | null;
  txH1: PoolActivity;
}

export interface LaunchRecord {
  chain: string;
  tokenAddress: string;
  poolAddress: string;
  dex: string;
  name: string;
  symbol?: string;
  poolCreatedAt: string;
  firstSeenAt: string;
  updatedAt: string;
  risk: LaunchRisk;
  facts: TokenFacts;
  market: LaunchMarketRow;
}

export interface LaunchQuery {
  chain: string;
  since: string;
  minLiquidityUsd: number;
  maxRiskScore?: number;
  limit: number;
}

export interface LaunchStore {
  /** Claim the right to ingest `chain` if the last run is older than `intervalSec`. */
  tryLease(chain: string, intervalSec: number): Promise<boolean>;
  lastIngestAt(chain: string): Promise<string | null>;
  knownPools(chain: string, pools: string[]): Promise<Set<string>>;
  upsert(rec: LaunchRecord): Promise<void>;
  /** Pools created in the last `maxAgeHours` whose market data is older than `staleMin`. */
  staleForRefresh(chain: string, staleMin: number, maxAgeHours: number, limit: number): Promise<LaunchRecord[]>;
  query(q: LaunchQuery): Promise<LaunchRecord[]>;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS launches (
    chain TEXT NOT NULL,
    pool_address TEXT NOT NULL,
    token_address TEXT NOT NULL,
    dex TEXT NOT NULL,
    name TEXT NOT NULL,
    symbol TEXT,
    pool_created_at TIMESTAMPTZ NOT NULL,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    risk_score INT NOT NULL,
    risk JSONB NOT NULL,
    facts JSONB NOT NULL,
    market JSONB NOT NULL,
    liquidity_usd DOUBLE PRECISION,
    PRIMARY KEY (chain, pool_address)
  );
  CREATE INDEX IF NOT EXISTS idx_launches_chain_created ON launches(chain, pool_created_at DESC);
  CREATE TABLE IF NOT EXISTS launch_ingest (
    chain TEXT PRIMARY KEY,
    last_run_at TIMESTAMPTZ NOT NULL
  )
`;

type Row = Record<string, any>;

function fromRow(r: Row): LaunchRecord {
  return {
    chain: r.chain,
    tokenAddress: r.token_address,
    poolAddress: r.pool_address,
    dex: r.dex,
    name: r.name,
    symbol: r.symbol ?? undefined,
    poolCreatedAt: new Date(r.pool_created_at).toISOString(),
    firstSeenAt: new Date(r.first_seen_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
    risk: r.risk,
    facts: r.facts,
    market: r.market,
  };
}

class PostgresLaunchStore implements LaunchStore {
  private sql: NeonQueryFunction<false, false>;
  private initPromise: Promise<void> | null = null;

  constructor(url: string) {
    this.sql = neon(url);
  }

  private async q(text: string, params: unknown[] = []): Promise<Row[]> {
    await this.init();
    return this.sql.query(text, params) as unknown as Promise<Row[]>;
  }

  private init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        for (const stmt of SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) {
          await this.sql.query(stmt);
        }
      })().catch((e) => {
        this.initPromise = null;
        throw e;
      });
    }
    return this.initPromise;
  }

  async tryLease(chain: string, intervalSec: number): Promise<boolean> {
    const rows = await this.q(
      `INSERT INTO launch_ingest (chain, last_run_at) VALUES ($1, now())
       ON CONFLICT (chain) DO UPDATE SET last_run_at = now()
       WHERE launch_ingest.last_run_at < now() - make_interval(secs => $2)
       RETURNING chain`,
      [chain, intervalSec],
    );
    return rows.length > 0;
  }

  async lastIngestAt(chain: string): Promise<string | null> {
    const rows = await this.q('SELECT last_run_at FROM launch_ingest WHERE chain = $1', [chain]);
    return rows[0] ? new Date(rows[0].last_run_at).toISOString() : null;
  }

  async knownPools(chain: string, pools: string[]): Promise<Set<string>> {
    if (pools.length === 0) return new Set();
    const rows = await this.q('SELECT pool_address FROM launches WHERE chain = $1 AND pool_address = ANY($2)', [chain, pools]);
    return new Set(rows.map((r) => r.pool_address as string));
  }

  async upsert(rec: LaunchRecord): Promise<void> {
    await this.q(
      `INSERT INTO launches (chain, pool_address, token_address, dex, name, symbol, pool_created_at, updated_at,
         risk_score, risk, facts, market, liquidity_usd)
       VALUES ($1,$2,$3,$4,$5,$6,$7,now(),$8,$9,$10,$11,$12)
       ON CONFLICT (chain, pool_address) DO UPDATE SET
         updated_at = now(), risk_score = EXCLUDED.risk_score, risk = EXCLUDED.risk,
         facts = EXCLUDED.facts, market = EXCLUDED.market, liquidity_usd = EXCLUDED.liquidity_usd`,
      [rec.chain, rec.poolAddress, rec.tokenAddress, rec.dex, rec.name, rec.symbol ?? null, rec.poolCreatedAt,
        rec.risk.score, JSON.stringify(rec.risk), JSON.stringify(rec.facts), JSON.stringify(rec.market),
        rec.market.liquidityUsd],
    );
  }

  async staleForRefresh(chain: string, staleMin: number, maxAgeHours: number, limit: number): Promise<LaunchRecord[]> {
    const rows = await this.q(
      `SELECT * FROM launches WHERE chain = $1
         AND pool_created_at > now() - make_interval(hours => $2)
         AND updated_at < now() - make_interval(mins => $3)
       ORDER BY updated_at ASC LIMIT $4`,
      [chain, maxAgeHours, staleMin, limit],
    );
    return rows.map(fromRow);
  }

  async query(q: LaunchQuery): Promise<LaunchRecord[]> {
    const rows = await this.q(
      `SELECT * FROM launches WHERE chain = $1 AND pool_created_at > $2
         AND COALESCE(liquidity_usd, 0) >= $3
         AND ($4::int IS NULL OR risk_score <= $4)
       ORDER BY pool_created_at DESC LIMIT $5`,
      [q.chain, q.since, q.minLiquidityUsd, q.maxRiskScore ?? null, q.limit],
    );
    return rows.map(fromRow);
  }
}

export class MemoryLaunchStore implements LaunchStore {
  private rows = new Map<string, LaunchRecord>();
  private leases = new Map<string, number>();

  async tryLease(chain: string, intervalSec: number): Promise<boolean> {
    const last = this.leases.get(chain);
    if (last !== undefined && Date.now() - last < intervalSec * 1000) return false;
    this.leases.set(chain, Date.now());
    return true;
  }

  async lastIngestAt(chain: string): Promise<string | null> {
    const last = this.leases.get(chain);
    return last === undefined ? null : new Date(last).toISOString();
  }

  async knownPools(chain: string, pools: string[]): Promise<Set<string>> {
    return new Set(pools.filter((p) => this.rows.has(`${chain}:${p}`)));
  }

  async upsert(rec: LaunchRecord): Promise<void> {
    const key = `${rec.chain}:${rec.poolAddress}`;
    const prev = this.rows.get(key);
    this.rows.set(key, { ...rec, firstSeenAt: prev?.firstSeenAt ?? rec.firstSeenAt, updatedAt: new Date().toISOString() });
  }

  async staleForRefresh(chain: string, staleMin: number, maxAgeHours: number, limit: number): Promise<LaunchRecord[]> {
    const now = Date.now();
    return [...this.rows.values()]
      .filter((r) => r.chain === chain
        && now - Date.parse(r.poolCreatedAt) < maxAgeHours * 3600_000
        && now - Date.parse(r.updatedAt) > staleMin * 60_000)
      .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt))
      .slice(0, limit);
  }

  async query(q: LaunchQuery): Promise<LaunchRecord[]> {
    return [...this.rows.values()]
      .filter((r) => r.chain === q.chain
        && Date.parse(r.poolCreatedAt) > Date.parse(q.since)
        && (r.market.liquidityUsd ?? 0) >= q.minLiquidityUsd
        && (q.maxRiskScore === undefined || r.risk.score <= q.maxRiskScore))
      .sort((a, b) => Date.parse(b.poolCreatedAt) - Date.parse(a.poolCreatedAt))
      .slice(0, q.limit);
  }
}

let store: LaunchStore | null = null;

export function getLaunchStore(): LaunchStore {
  if (!store) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    store = url ? new PostgresLaunchStore(url) : new MemoryLaunchStore();
  }
  return store;
}

/** Test hook. */
export function setLaunchStore(s: LaunchStore | null): void {
  store = s;
}
