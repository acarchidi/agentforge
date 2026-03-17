import { z } from 'zod';
import { relatedServicesField } from './shared.js';

export const contractMonitorInput = z.object({
  address: z.string().min(1),
  chain: z
    .enum(['ethereum', 'base', 'polygon', 'arbitrum', 'optimism', 'avalanche'])
    .default('ethereum'),
  lookbackHours: z.number().min(1).max(168).default(24),
});

export type ContractMonitorInput = z.infer<typeof contractMonitorInput>;

export const contractMonitorOutput = z.object({
  contract: z.object({
    address: z.string(),
    chain: z.string(),
    name: z.string().nullable(),
    isProxy: z.boolean(),
    registryLabel: z.string().optional(),
    registryProtocol: z.string().optional(),
    registryCategory: z.string().optional(),
  }),
  recentActivity: z.object({
    transactionCount: z.number(),
    adminTransactions: z.array(
      z.object({
        txHash: z.string(),
        functionName: z.string(),
        timestamp: z.string(),
        from: z.string(),
        summary: z.string(),
      }),
    ),
    implementationChanged: z.boolean(),
    ownershipChanged: z.boolean(),
    pauseStateChanged: z.boolean(),
  }),
  riskAlert: z.object({
    level: z.enum(['none', 'low', 'medium', 'high', 'critical']),
    alerts: z.array(z.string()),
    recommendation: z.string(),
  }),
  metadata: z.object({
    lookbackHours: z.number(),
    processingTimeMs: z.number(),
    estimatedCostUsd: z.number(),
  }),
  relatedServices: relatedServicesField,
});

export type ContractMonitorOutput = z.infer<typeof contractMonitorOutput>;
