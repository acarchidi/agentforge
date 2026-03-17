import { getDb } from './db.js';

export function getOverviewStats() {
  const db = getDb();
  return db
    .prepare(
      `SELECT
        endpoint,
        COUNT(*) as total_calls,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful_calls,
        ROUND(AVG(latency_ms)) as avg_latency_ms,
        ROUND(AVG(CASE WHEN success = 1 THEN latency_ms END)) as avg_success_latency_ms,
        MIN(created_at) as first_call,
        MAX(created_at) as last_call
      FROM calls
      GROUP BY endpoint
      ORDER BY total_calls DESC`,
    )
    .all();
}

export function getRevenueStats() {
  const db = getDb();
  return db
    .prepare(
      `SELECT
        endpoint,
        COUNT(*) as total_payments,
        ROUND(SUM(amount_usd), 4) as total_revenue_usd,
        ROUND(SUM(estimated_cost_usd), 4) as total_cost_usd,
        ROUND(SUM(amount_usd) - COALESCE(SUM(estimated_cost_usd), 0), 4) as gross_profit_usd
      FROM revenue
      GROUP BY endpoint`,
    )
    .all();
}

export function getLast24hStats() {
  const db = getDb();
  return db
    .prepare(
      `SELECT
        endpoint,
        COUNT(*) as calls_24h,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success_24h
      FROM calls
      WHERE created_at > datetime('now', '-24 hours')
      GROUP BY endpoint`,
    )
    .all();
}

export function getDailyRevenue() {
  const db = getDb();
  return db
    .prepare(
      `SELECT
        DATE(created_at) as date,
        endpoint,
        COUNT(*) as payments,
        ROUND(SUM(amount_usd), 4) as revenue_usd
      FROM revenue
      WHERE created_at > datetime('now', '-30 days')
      GROUP BY DATE(created_at), endpoint
      ORDER BY date DESC`,
    )
    .all();
}
