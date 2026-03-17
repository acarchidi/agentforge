import { z } from 'zod';
import { relatedServicesField } from './shared.js';

// ── Input ──────────────────────────────────────────────────────────

export const txDecoderInput = z.object({
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid transaction hash'),
  chain: z
    .enum(['ethereum', 'base', 'polygon', 'arbitrum', 'optimism', 'avalanche'])
    .default('ethereum'),
});

export type TxDecoderInput = z.infer<typeof txDecoderInput>;

// ── Output ─────────────────────────────────────────────────────────

export const txDecoderOutput = z.object({
  transaction: z.object({
    hash: z.string(),
    from: z.string(),
    to: z.string(),
    value: z.string(),
    valueUsd: z.number().nullable(),
    gasUsed: z.string(),
    gasPrice: z.string(),
    gasCostUsd: z.number().nullable(),
    timestamp: z.string(),
    blockNumber: z.number(),
    status: z.enum(['success', 'failed']),
  }),
  decodedCall: z
    .object({
      functionName: z.string().nullable(),
      functionSignature: z.string().nullable(),
      parameters: z.array(
        z.object({
          name: z.string(),
          type: z.string(),
          value: z.string(),
          decoded: z.string().nullable(),
        }),
      ),
      contractName: z.string().nullable(),
      contractVerified: z.boolean(),
      registryLabel: z.string().optional(),
      registryProtocol: z.string().optional(),
    })
    .nullable(),
  explanation: z.string(),
  tokenTransfers: z.array(
    z.object({
      token: z.string(),
      from: z.string(),
      to: z.string(),
      amount: z.string(),
      symbol: z.string().nullable(),
    }),
  ),
  relatedServices: relatedServicesField,
  metadata: z.object({
    chain: z.string(),
    processingTimeMs: z.number(),
    estimatedCostUsd: z.number(),
  }),
});

export type TxDecoderOutput = z.infer<typeof txDecoderOutput>;
