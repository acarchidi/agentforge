import { getDb } from './db.js';

interface CallLog {
  endpoint: string;
  success: boolean;
  latencyMs: number;
  inputSize?: number;
  outputSize?: number;
  errorType?: string;
}

export function logCall(log: CallLog): void {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO calls (endpoint, success, latency_ms, input_size, output_size, error_type)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      log.endpoint,
      log.success ? 1 : 0,
      log.latencyMs,
      log.inputSize ?? null,
      log.outputSize ?? null,
      log.errorType ?? null,
    );
  } catch (error) {
    console.error('Failed to log call:', error);
  }
}

export function logRevenue(
  endpoint: string,
  amountUsd: number,
  estimatedCostUsd?: number,
  txHash?: string,
): void {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO revenue (endpoint, amount_usd, estimated_cost_usd, tx_hash)
      VALUES (?, ?, ?, ?)
    `).run(endpoint, amountUsd, estimatedCostUsd ?? null, txHash ?? null);
  } catch (error) {
    console.error('Failed to log revenue:', error);
  }
}
