import Database from 'better-sqlite3';
import path from 'path';

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    const isServerless = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;
    const defaultPath = isServerless
      ? '/tmp/agentforge.db'
      : path.join(process.cwd(), 'agentforge.db');
    const dbPath = process.env.DATABASE_PATH || defaultPath;
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
  }
  return db;
}

export function initDb(): void {
  const database = getDb();

  database.exec(`
    CREATE TABLE IF NOT EXISTS calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint TEXT NOT NULL,
      success INTEGER NOT NULL,
      latency_ms INTEGER NOT NULL,
      input_size INTEGER,
      output_size INTEGER,
      error_type TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_calls_endpoint ON calls(endpoint);
    CREATE INDEX IF NOT EXISTS idx_calls_created_at ON calls(created_at);

    CREATE TABLE IF NOT EXISTS revenue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint TEXT NOT NULL,
      amount_usd REAL NOT NULL,
      estimated_cost_usd REAL,
      tx_hash TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_revenue_endpoint ON revenue(endpoint);
    CREATE INDEX IF NOT EXISTS idx_revenue_created_at ON revenue(created_at);

    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      endpoint TEXT,
      message TEXT NOT NULL,
      contact TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_feedback_type ON feedback(type);
    CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback(created_at);
  `);
}
