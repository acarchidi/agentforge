import { z } from 'zod';
import { relatedServicesField } from './shared.js';
import { EVM_CHAINS } from '../utils/chains.js';
import { LENDING_CHAINS } from './lendingHealth.js';
import { WATCH_LIMITS } from '../pricing.js';

export const WATCH_TYPES = ['contract-admin', 'token-risk', 'lending-health'] as const;
export type WatchType = (typeof WATCH_TYPES)[number];

export const watchCreateInput = z
  .object({
    type: z.enum(WATCH_TYPES),
    chain: z.enum(EVM_CHAINS).default('base'),
    /** Contract (contract-admin), token (token-risk) or wallet (lending-health). */
    target: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Must be a valid 0x-prefixed EVM address'),
    /** HTTPS endpoint that receives signed alert POSTs. */
    webhookUrl: z.string().url().max(2048),
    days: z.number().int().min(WATCH_LIMITS.minDays).max(WATCH_LIMITS.maxDays).default(30),
    params: z
      .object({
        /** token-risk: alert when the score crosses this (default 50). lending-health: alert when the health factor drops below this. */
        threshold: z.number().positive().max(100).optional(),
      })
      .default({}),
  })
  .refine((v) => v.type !== 'lending-health' || (LENDING_CHAINS as readonly string[]).includes(v.chain), {
    message: `lending-health watches run on Aave v3 chains: ${LENDING_CHAINS.join(', ')}`,
    path: ['chain'],
  });

export type WatchCreateInput = z.infer<typeof watchCreateInput>;

export const watchCreateOutput = z.object({
  watchId: z.string(),
  /** Keep this: it authenticates GET/DELETE /watch/:id and signs every webhook. Shown once. */
  secret: z.string(),
  type: z.string(),
  chain: z.string(),
  target: z.string(),
  expiresAt: z.string(),
  checkEvery: z.string(),
  baseline: z.record(z.string(), z.unknown()).nullable(),
  webhookTest: z.object({ ok: z.boolean(), status: z.number().optional(), error: z.string().optional() }),
  manage: z.object({ status: z.string(), cancel: z.string(), verify: z.string() }),
  relatedServices: relatedServicesField,
});

export type WatchCreateOutput = z.infer<typeof watchCreateOutput>;
