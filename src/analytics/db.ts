/**
 * SQLite handle — used only when no DATABASE_URL / POSTGRES_URL is configured
 * (local development, tests). Production analytics live in Postgres; see store.ts.
 */
import Database from 'better-sqlite3';
import path from 'path';
import { getStore } from './store.js';

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

/** Initialize whichever analytics backend is configured. Safe to call repeatedly. */
export function initDb(): void {
  const store = getStore();
  store.init().then(
    () => console.log(`analytics: ${store.backend} store ready`),
    (error) => console.error(`analytics: ${store.backend} init failed:`, error),
  );
}
