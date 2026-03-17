import { z } from 'zod';
import { relatedServicesField } from './shared.js';

export const tokenIntelInput = z.object({
  address: z.string().min(1),
  chain: z
    .enum(['ethereum', 'base', 'solana', 'polygon', 'arbitrum'])
    .default('ethereum'),
});

export const tokenIntelOutput = z.object({
  token: z.object({
    name: z.string(),
    symbol: z.string(),
    address: z.string(),
    chain: z.string(),
    decimals: z.number().optional(),
  }),
  market: z.object({
    priceUsd: z.number().nullable(),
    marketCap: z.number().nullable(),
    volume24h: z.number().nullable(),
    priceChange24h: z.number().nullable(),
  }),
  risk: z.object({
    score: z.number().min(0).max(100),
    flags: z.array(z.string()),
    assessment: z.string(),
  }),
  metadata: z.object({
    sources: z.array(z.string()),
    processingTimeMs: z.number(),
  }),
  relatedServices: relatedServicesField,
});

export type TokenIntelInput = z.infer<typeof tokenIntelInput>;
export type TokenIntelOutput = z.infer<typeof tokenIntelOutput>;
