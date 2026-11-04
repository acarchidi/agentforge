/**
 * One scheduler cycle, run by /internal/cron/watches every 30 minutes:
 * expire → claim due watches → batched checks → persist + queue alerts →
 * deliver pending alerts (with exponential backoff, at most 6 attempts).
 */

import type { WatchType } from '../schemas/watch.js';
import { nextFor } from '../services/watch.js';
import { runChecks } from './checkers.js';
import { getWatchStore, type NewAlert, type WatchRecord } from './store.js';
import { deliverWebhook } from './webhook.js';

const CLAIM_LIMIT = 200;
const DELIVER_LIMIT = 100;
const DELIVER_CONCURRENCY = 10;
/** Alert once when a target has been unreadable this many checks in a row. */
export const FAILURE_ALERT_AT = 12;

function payload(w: Pick<WatchRecord, 'id' | 'type' | 'chain' | 'target'>, event: string, summary: string, previous?: unknown, current?: unknown) {
  return {
    watchId: w.id, event, type: w.type, chain: w.chain, target: w.target,
    detectedAt: new Date().toISOString(), summary,
    ...(previous !== undefined ? { previous } : {}),
    ...(current !== undefined ? { current } : {}),
    next: nextFor(w.type as WatchType, w.chain, w.target),
  };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

export interface CycleStats {
  expired: number;
  checked: number;
  checkFailures: number;
  alertsQueued: number;
  delivered: number;
  failed: number;
  ms: number;
}

export async function runWatchCycle(deadlineMs = 45_000): Promise<CycleStats> {
  const start = Date.now();
  const store = getWatchStore();
  const alerts: NewAlert[] = [];

  const expired = await store.expire();
  for (const w of expired) alerts.push({ watchId: w.id, event: 'expired', payload: payload(w, 'expired', `Watch expired at ${w.expiresAt}`) });

  const due = await store.claimDue(CLAIM_LIMIT);
  const results = await runChecks(due.map((w) => ({ id: w.id, type: w.type, chain: w.chain, target: w.target, params: w.params, lastState: w.lastState })));
  const failures = await store.saveChecks(results.map((r) => ({ id: r.id, ok: r.ok, state: r.ok ? r.state : null })));
  const byId = new Map(due.map((w) => [w.id, w]));
  for (const r of results) {
    const w = byId.get(r.id)!;
    for (const e of r.events) alerts.push({ watchId: w.id, event: e.event, payload: payload(w, e.event, e.summary, e.previous, e.current) });
    if (failures.get(r.id) === FAILURE_ALERT_AT) {
      alerts.push({ watchId: w.id, event: 'change', payload: payload(w, 'change', `Watch target could not be checked ${FAILURE_ALERT_AT} times in a row`) });
    }
  }
  await store.addAlerts(alerts);

  let delivered = 0;
  let failed = 0;
  if (Date.now() - start < deadlineMs - 10_000) {
    const pending = await store.pendingAlerts(DELIVER_LIMIT);
    const outcomes = await mapLimit(pending, DELIVER_CONCURRENCY, async (a) => {
      const r = await deliverWebhook(a.webhookUrl, a.watchId, a.payload);
      return { id: a.id, ok: r.ok, error: r.error };
    });
    await store.markDeliveries(outcomes);
    delivered = outcomes.filter((o) => o.ok).length;
    failed = outcomes.length - delivered;
  }

  return {
    expired: expired.length,
    checked: results.length,
    checkFailures: results.filter((r) => !r.ok).length,
    alertsQueued: alerts.length,
    delivered,
    failed,
    ms: Date.now() - start,
  };
}
