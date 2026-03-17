import { z } from 'zod';
import { relatedServicesField } from './shared.js';
import { isValidAddressForChain } from '../utils/addressValidation.js';

// ── Input ──────────────────────────────────────────────────────────

export const approvalScanInput = z.object({
  address: z.string().min(1, 'Address is required'),
  chain: z
    .enum(['ethereum', 'base', 'polygon', 'arbitrum', 'optimism', 'avalanche', 'solana'])
    .default('ethereum'),
}).superRefine((data, ctx) => {
  if (!isValidAddressForChain(data.address, data.chain)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: data.chain === 'solana'
        ? 'Invalid Solana address (expected base58, 32-44 chars)'
        : 'Invalid wallet address (expected 0x-prefixed, 40 hex chars)',
      path: ['address'],
    });
  }
});

export type ApprovalScanInput = z.infer<typeof approvalScanInput>;

// ── Output ─────────────────────────────────────────────────────────

export const approvalScanOutput = z.object({
  wallet: z.object({
    address: z.string(),
    chain: z.string(),
  }),
  approvals: z.array(
    z.object({
      token: z.object({
        address: z.string(),
        symbol: z.string().nullable(),
        name: z.string().nullable(),
      }),
      spender: z.object({
        address: z.string(),
        contractName: z.string().nullable(),
        isVerified: z.boolean(),
        label: z.string().nullable(),
        registryLabel: z.string().optional(),
        registryProtocol: z.string().optional(),
        registryRisk: z.string().optional(),
      }),
      allowance: z.string(),
      riskLevel: z.enum(['safe', 'low', 'medium', 'high', 'critical']),
      riskReason: z.string().nullable(),
    }),
  ),
  summary: z.object({
    totalApprovals: z.number(),
    unlimitedApprovals: z.number(),
    riskyApprovals: z.number(),
    overallRisk: z.enum(['clean', 'low', 'medium', 'high', 'critical']),
    recommendation: z.string(),
  }),
  relatedServices: relatedServicesField,
  metadata: z.object({
    chain: z.string(),
    processingTimeMs: z.number(),
    estimatedCostUsd: z.number(),
    approvalsScanned: z.number(),
  }),
});

export type ApprovalScanOutput = z.infer<typeof approvalScanOutput>;
