import { z } from 'zod';
import { relatedServicesField } from './shared.js';

export const LENDING_CHAINS = ['ethereum', 'base', 'arbitrum', 'optimism', 'polygon'] as const;

// ── Input (query string) ───────────────────────────────────────────

export const lendingHealthInput = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Must be a valid 0x-prefixed EVM address'),
  /** One chain, or "all" to check every supported chain at once. */
  chain: z.enum([...LENDING_CHAINS, 'all']).default('all'),
});

export type LendingHealthInput = z.infer<typeof lendingHealthInput>;

// ── Output ─────────────────────────────────────────────────────────

export const lendingStatus = z.enum(['no_debt', 'safe', 'watch', 'danger', 'critical', 'liquidatable']);

export const lendingPosition = z.object({
  protocol: z.literal('aave-v3'),
  chain: z.string(),
  collateralUsd: z.number(),
  debtUsd: z.number(),
  availableBorrowsUsd: z.number(),
  liquidationThresholdPct: z.number(),
  ltvPct: z.number(),
  /** null when there is no debt (Aave reports uint256 max). */
  healthFactor: z.number().nullable(),
  status: lendingStatus,
  /** Approximate: assumes debt value constant and collateral moving together. */
  collateralDropToLiquidationPct: z.number().nullable(),
});

export const lendingHealthOutput = z.object({
  address: z.string(),
  positions: z.array(lendingPosition),
  worst: lendingPosition.nullable(),
  chainsChecked: z.array(z.string()),
  chainsFailed: z.array(z.string()),
  note: z.string(),
  relatedServices: relatedServicesField,
});

export type LendingPosition = z.infer<typeof lendingPosition>;
export type LendingHealthOutput = z.infer<typeof lendingHealthOutput>;
