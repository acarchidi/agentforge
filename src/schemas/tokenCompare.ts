import { z } from 'zod';
import { relatedServicesField } from './shared.js';
import { tokenResearchOutput } from './tokenResearch.js';

export const tokenCompareInput = z.object({
  primary: z.string().min(1),
  compare: z.array(z.string()).min(1).max(3),
  chain: z
    .enum(['ethereum', 'base', 'polygon', 'arbitrum', 'optimism', 'avalanche'])
    .default('ethereum'),
});

export type TokenCompareInput = z.infer<typeof tokenCompareInput>;

export const tokenCompareOutput = z.object({
  primary: tokenResearchOutput,
  comparisons: z.array(
    z.object({
      query: z.string(),
      symbol: z.string(),
      priceUsd: z.number().nullable(),
      marketCap: z.number().nullable(),
      tvl: z.number().nullable(),
      riskScore: z.number(),
    }),
  ),
  analysis: z.string(),
  metadata: z.object({
    processingTimeMs: z.number(),
    estimatedCostUsd: z.number(),
  }),
  relatedServices: relatedServicesField,
});

export type TokenCompareOutput = z.infer<typeof tokenCompareOutput>;
