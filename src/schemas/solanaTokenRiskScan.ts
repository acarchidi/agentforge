import { z } from 'zod';

export const solanaTokenRiskScanInput = z.object({
  mint: z.string().min(1),
});

export type SolanaTokenRiskScanInput = z.infer<typeof solanaTokenRiskScanInput>;

const overallRiskLevel = z.enum(['safe', 'low', 'medium', 'high', 'critical']);

export const solanaTokenRiskScanOutput = z.object({
  mint: z.string(),
  /** 'cached' if served from the trending-token cache, 'live' if freshly computed */
  source: z.enum(['cached', 'live']).default('live'),
  computedAt: z.string().optional(),
  stalenessSec: z.number().optional(),
  authorities: z.object({
    mintAuthority: z.string().nullable(),
    canMint: z.boolean(),
    freezeAuthority: z.string().nullable(),
    canFreeze: z.boolean(),
    supply: z.string().optional(),
    decimals: z.number().optional(),
  }),
  holders: z.object({
    top10Pct: z.number().min(0).max(100),
    entries: z
      .array(
        z.object({
          address: z.string(),
          pct: z.number(),
          isPool: z.boolean(),
          label: z.string().optional(),
        }),
      )
      .max(20),
  }),
  liquidity: z.object({
    totalUsd: z.number().nullable(),
    volume24hUsd: z.number().nullable(),
    topPoolCount: z.number().optional(),
    ageDays: z.number().nullable(),
    available: z.boolean(),
  }),
  metadata: z.object({
    name: z.string().optional(),
    symbol: z.string().optional(),
    mutable: z.boolean().optional(),
  }),
  score: z.number().min(0).max(100),
  level: overallRiskLevel,
  flags: z.array(z.string()),
  summary: z.string().optional(),
  dataCompleteness: z.object({
    holdersAvailable: z.boolean(),
    liquidityAvailable: z.boolean(),
    metadataAvailable: z.boolean(),
  }),
  relatedServices: z.array(
    z.object({
      endpoint: z.string(),
      description: z.string(),
      suggestedInput: z.record(z.string(), z.unknown()),
    }),
  ),
});

export type SolanaTokenRiskScanOutput = z.infer<typeof solanaTokenRiskScanOutput>;
