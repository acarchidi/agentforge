import { z } from 'zod';
import { EVM_CHAINS } from '../utils/chains.js';
import { relatedServicesField } from './shared.js';
import { RISK_BATCH_LIMITS } from '../pricing.js';

const evmAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Must be a valid 0x-prefixed EVM address');
const riskChain = z.enum(EVM_CHAINS);

// ── Input ──────────────────────────────────────────────────────────

export const riskBatchInput = z.object({
  tokens: z
    .array(z.object({ address: evmAddress, chain: riskChain.optional() }))
    .min(RISK_BATCH_LIMITS.min)
    .max(RISK_BATCH_LIMITS.max),
  /** Default chain for tokens that don't name one. */
  chain: riskChain.default('ethereum'),
});

export type RiskBatchInput = z.infer<typeof riskBatchInput>;

// ── Output ─────────────────────────────────────────────────────────

const riskLevel = z.enum(['low', 'medium', 'high', 'critical']);

export const riskBatchItem = z.object({
  address: z.string(),
  chain: z.string(),
  status: z.enum(['ok', 'error', 'timeout']),
  riskScore: z.number().min(0).max(100).optional(),
  riskLevel: riskLevel.optional(),
  flags: z.array(z.string()).optional(),
  permissions: z
    .object({
      canMint: z.boolean(),
      canBlacklist: z.boolean(),
      canPause: z.boolean(),
      canUpgrade: z.boolean(),
    })
    .optional(),
  liquidityUsd: z.number().optional(),
  holderDataAvailable: z.boolean().optional(),
  source: z.enum(['cached', 'live']).optional(),
  error: z.string().optional(),
});

export const riskBatchOutput = z.object({
  results: z.array(riskBatchItem),
  summary: z.object({
    requested: z.number().int(),
    scored: z.number().int(),
    failed: z.number().int(),
    byLevel: z.object({ low: z.number().int(), medium: z.number().int(), high: z.number().int(), critical: z.number().int() }),
    /** Up to 5 riskiest tokens, highest score first. */
    riskiest: z.array(z.object({ address: z.string(), chain: z.string(), riskScore: z.number() })),
  }),
  pricing: z.object({ perToken: z.string(), tokensCharged: z.number().int(), total: z.string() }),
  metadata: z.object({ processingTimeMs: z.number() }),
  relatedServices: relatedServicesField,
});

export type RiskBatchItem = z.infer<typeof riskBatchItem>;
export type RiskBatchOutput = z.infer<typeof riskBatchOutput>;
