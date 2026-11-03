import { z } from 'zod';
import { relatedServicesField } from './shared.js';

// ── Input (query string) ───────────────────────────────────────────

export const launchesInput = z.object({
  chain: z.enum(['base', 'ethereum', 'arbitrum']).default('base'),
  /** ISO timestamp; only pools created after it. Pass the previous response's nextSince. */
  since: z.string().datetime({ offset: true }).optional(),
  minLiquidityUsd: z.coerce.number().min(0).default(1000),
  maxRiskScore: z.coerce.number().int().min(0).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type LaunchesInput = z.infer<typeof launchesInput>;

// ── Output ─────────────────────────────────────────────────────────

const activity = z.object({ buys: z.number(), sells: z.number(), buyers: z.number(), sellers: z.number() });

export const launchItem = z.object({
  token: z.object({ address: z.string(), name: z.string().optional(), symbol: z.string().optional() }),
  pool: z.object({ address: z.string(), dex: z.string(), name: z.string(), createdAt: z.string() }),
  ageMinutes: z.number(),
  risk: z.object({
    score: z.number().min(0).max(100),
    level: z.enum(['low', 'medium', 'high', 'critical']),
    flags: z.array(z.string()),
  }),
  market: z.object({
    liquidityUsd: z.number().nullable(),
    fdvUsd: z.number().nullable(),
    volumeH24Usd: z.number().nullable(),
    txH1: activity,
    txH24: activity,
  }),
  contract: z.object({
    verified: z.boolean().nullable(),
    ownerRenounced: z.boolean(),
    isProxy: z.boolean(),
    canMint: z.boolean(),
    canBlacklist: z.boolean(),
    canChangeTaxes: z.boolean(),
    canPause: z.boolean(),
    deployer: z.string().optional(),
    deployerHoldingPct: z.number().optional(),
    supplyInPoolPct: z.number().optional(),
  }),
  /** When market data and the score were last refreshed. */
  updatedAt: z.string(),
});

export const launchesOutput = z.object({
  chain: z.string(),
  launches: z.array(launchItem),
  /** Pass as `since` on the next poll to get only newer launches. */
  nextSince: z.string(),
  freshness: z.object({
    ingestedAt: z.string().nullable(),
    stale: z.boolean(),
    note: z.string(),
  }),
  relatedServices: relatedServicesField,
});

export type LaunchItem = z.infer<typeof launchItem>;
export type LaunchesOutput = z.infer<typeof launchesOutput>;
