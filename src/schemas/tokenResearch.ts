import { z } from 'zod';
import { relatedServicesField } from './shared.js';

export const tokenResearchInput = z.object({
  query: z.string().min(1).max(200),
  chain: z
    .enum(['ethereum', 'base', 'polygon', 'arbitrum', 'optimism', 'avalanche'])
    .optional()
    .default('ethereum'),
  include: z
    .array(
      z.enum([
        'market_data',
        'defi_metrics',
        'contract_info',
        'prediction_markets',
        'institutional',
        'risk_assessment',
        'price_history',
        'holders',
      ]),
    )
    .optional()
    .default(['market_data', 'defi_metrics', 'contract_info', 'risk_assessment']),
});

export type TokenResearchInput = z.infer<typeof tokenResearchInput>;

export const tokenResearchOutput = z.object({
  token: z.object({
    name: z.string(),
    symbol: z.string(),
    address: z.string().optional(),
    chain: z.string(),
  }),

  marketData: z
    .object({
      priceUsd: z.number().nullable(),
      marketCap: z.number().nullable(),
      fullyDilutedValuation: z.number().nullable(),
      volume24h: z.number().nullable(),
      priceChange24h: z.number().nullable(),
      priceChange7d: z.number().nullable(),
      priceChange30d: z.number().nullable(),
      allTimeHigh: z.number().nullable(),
      allTimeHighDate: z.string().nullable(),
      circulatingSupply: z.number().nullable(),
      totalSupply: z.number().nullable(),
      source: z.literal('coingecko'),
    })
    .optional(),

  defiMetrics: z
    .object({
      tvl: z.number().nullable(),
      tvlChange24h: z.number().nullable(),
      tvlChange7d: z.number().nullable(),
      category: z.string().nullable(),
      chains: z.array(z.string()),
      associatedProtocols: z.array(
        z.object({
          name: z.string(),
          tvl: z.number().nullable(),
        }),
      ),
      source: z.literal('defillama'),
    })
    .optional(),

  contractInfo: z
    .object({
      isVerified: z.boolean(),
      compilerVersion: z.string().nullable(),
      optimizationUsed: z.boolean().nullable(),
      contractName: z.string().nullable(),
      creationTxHash: z.string().nullable(),
      creatorAddress: z.string().nullable(),
      implementationAddress: z.string().nullable(),
      isProxy: z.boolean(),
      source: z.literal('etherscan'),
    })
    .optional(),

  predictionMarkets: z
    .object({
      relatedMarkets: z.array(
        z.object({
          title: z.string(),
          outcomePrices: z.object({
            yes: z.number(),
            no: z.number(),
          }),
          volume: z.number().nullable(),
          slug: z.string(),
          url: z.string(),
        }),
      ),
      source: z.literal('polymarket'),
    })
    .optional(),

  institutional: z
    .object({
      mentions: z.array(
        z.object({
          institution: z.string(),
          context: z.string(),
          sentiment: z.enum(['positive', 'negative', 'neutral']),
          approximate_date: z.string().nullable(),
        }),
      ),
      summary: z.string(),
      source: z.literal('llm_analysis'),
    })
    .optional(),

  priceHistory: z
    .object({
      prices30d: z.array(
        z.object({
          date: z.string(),
          priceUsd: z.number(),
        }),
      ),
      volatility30d: z.number(),
      trend: z.enum(['up', 'down', 'sideways']),
      maxDrawdown30d: z.number(),
      source: z.literal('defillama'),
    })
    .optional(),

  holderDistribution: z
    .object({
      topHolders: z.array(
        z.object({
          address: z.string(),
          balance: z.string(),
          percentage: z.number(),
          isContract: z.boolean(),
          label: z.string().nullable(),
        }),
      ),
      concentration: z.object({
        top5Percentage: z.number(),
        top10Percentage: z.number(),
        top20Percentage: z.number(),
      }),
      riskFlag: z.boolean(),
      source: z.literal('etherscan'),
    })
    .optional(),

  riskAssessment: z
    .object({
      overallScore: z.number().min(0).max(100),
      riskLevel: z.enum(['low', 'medium', 'high', 'critical']),
      factors: z.array(
        z.object({
          factor: z.string(),
          impact: z.enum(['positive', 'negative', 'neutral']),
          detail: z.string(),
        }),
      ),
      summary: z.string(),
    })
    .optional(),

  metadata: z.object({
    sourcesQueried: z.array(z.string()),
    sourcesSucceeded: z.array(z.string()),
    sourcesFailed: z.array(z.string()),
    processingTimeMs: z.number(),
    estimatedCostUsd: z.number(),
    cachedSources: z.array(z.string()),
  }),
  relatedServices: relatedServicesField,
});

export type TokenResearchOutput = z.infer<typeof tokenResearchOutput>;
