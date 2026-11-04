/**
 * Watch subscriptions: POST /v1/watch (paid, priced per day) creates a watch
 * that the scheduler (/internal/cron/watches) checks on a fixed cadence,
 * POSTing a signed webhook when the target changes.
 *
 * Creation takes the baseline state right away, so the first scheduled check
 * compares against it instead of alerting on everything, and it sends a
 * `test` event so the caller learns at once whether its webhook works.
 */

import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { config } from '../config.js';
import { PUBLIC_BASE_URL, formatUsd, priceFor } from '../pricing.js';
import { watchCreateInput, watchCreateOutput, type WatchCreateOutput, type WatchType } from '../schemas/watch.js';
import { CHECK_EVERY_MIN, runChecks } from '../watches/checkers.js';
import { getWatchStore } from '../watches/store.js';
import { WebhookUrlError, deliverWebhook, validateWebhookUrl, watchSecret } from '../watches/webhook.js';

/** Suggested next call in each alert: the natural follow-up for the target. */
export function nextFor(type: WatchType, chain: string, target: string) {
  if (type === 'contract-admin') return [{ endpoint: '/v1/contract-docs', suggestedInput: { address: target, chain } }];
  if (type === 'token-risk') return [{ endpoint: '/v1/trade-check', suggestedInput: { address: target, chain } }];
  return [{ endpoint: '/v1/lending/health', suggestedInput: { address: target, chain } }];
}

export function cadenceLabel(type: WatchType): string {
  return CHECK_EVERY_MIN[type] >= 1440 ? 'every 24 hours' : `every ${CHECK_EVERY_MIN[type]} minutes`;
}

export async function createWatchWithCost(
  input: unknown,
  ctx: { payerHash?: string } = {},
): Promise<{ output: WatchCreateOutput; estimatedCostUsd: number }> {
  const v = watchCreateInput.parse(input);
  if (!config.WATCH_MASTER_KEY) throw new Error('watches are not enabled on this server');
  try {
    await validateWebhookUrl(v.webhookUrl);
  } catch (e) {
    if (e instanceof WebhookUrlError) {
      throw new z.ZodError([{ code: 'custom', path: ['webhookUrl'], message: e.message, input: v.webhookUrl }]);
    }
    throw e;
  }

  const id = `w_${randomBytes(12).toString('hex')}`;
  const target = v.target.toLowerCase();
  const [baseline] = await runChecks([{ id, type: v.type, chain: v.chain, target, params: v.params, lastState: null }]);
  const expiresAt = new Date(Date.now() + v.days * 86_400_000).toISOString();
  const store = getWatchStore();
  await store.create({
    id, type: v.type, chain: v.chain, target, webhookUrl: v.webhookUrl, params: v.params,
    expiresAt, lastState: baseline.ok ? baseline.state : null, payerHash: ctx.payerHash ?? null,
  });

  const testPayload = {
    watchId: id, event: 'test', type: v.type, chain: v.chain, target, detectedAt: new Date().toISOString(),
    summary: `Watch created: ${v.type} on ${v.chain} for ${target}, checked ${cadenceLabel(v.type)} until ${expiresAt}`,
    current: baseline.state, next: nextFor(v.type, v.chain, target),
  };
  const test = await deliverWebhook(v.webhookUrl, id, testPayload);
  await store.addAlerts([{ watchId: id, event: 'test', payload: testPayload, delivered: { ok: test.ok, error: test.error } }]);

  const output = watchCreateOutput.parse({
    watchId: id,
    secret: watchSecret(id),
    type: v.type,
    chain: v.chain,
    target,
    expiresAt,
    checkEvery: cadenceLabel(v.type),
    baseline: baseline.ok ? baseline.state : null,
    webhookTest: test,
    manage: {
      status: `GET ${PUBLIC_BASE_URL}/watch/${id} with header X-Watch-Secret`,
      cancel: `DELETE ${PUBLIC_BASE_URL}/watch/${id} with header X-Watch-Secret (no refunds)`,
      verify: 'Each webhook carries X-AgentForge-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + rawBody)>',
    },
    relatedServices: [
      ...nextFor(v.type, v.chain, target).map((n) => ({ ...n, description: 'Look closer at the watched target now' })),
      {
        endpoint: '/v1/credits/buy',
        description: `Running many watches? Prepay with credits (up to 20% bonus); this watch cost ${formatUsd(priceFor('/v1/watch', v))}`,
        suggestedInput: { pack: '5' },
      },
    ],
  });
  return { output, estimatedCostUsd: 0 };
}
