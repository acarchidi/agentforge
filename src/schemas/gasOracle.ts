import { z } from 'zod';

// ── Input ──────────────────────────────────────────────────────────

export const gasOracleInput = z.object({
  chain: z
    .enum(['ethereum', 'base', 'polygon', 'arbitrum', 'optimism', 'avalanche'])
    .default('ethereum'),
});

export type GasOracleInput = z.infer<typeof gasOracleInput>;

// ── Output ─────────────────────────────────────────────────────────

const gasTier = z.object({
  gwei: z.number(),
  estimatedSeconds: z.number(),
});

export const gasOracleOutput = z.object({
  chain: z.string(),
  currentPrices: z.object({
    slow: gasTier,
    standard: gasTier,
    fast: gasTier,
  }),
  baseFee: z.number().nullable(),
  trend: z.enum(['rising', 'falling', 'stable']),
  timestamp: z.string(),
  metadata: z.object({
    source: z.literal('etherscan'),
    processingTimeMs: z.number(),
  }),
});

export type GasOracleOutput = z.infer<typeof gasOracleOutput>;
