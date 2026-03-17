import { z } from 'zod';
import { relatedServicesField } from './shared.js';
import { isValidAddressForChain } from '../utils/addressValidation.js';

// ── Shared Enums ──────────────────────────────────────────────────

export const RiskLevelEnum = z.enum(['safe', 'low', 'medium', 'high', 'critical', 'unknown']);
export type RiskLevel = z.infer<typeof RiskLevelEnum>;

export const DepthEnum = z.enum(['quick', 'standard', 'deep']);
export type Depth = z.infer<typeof DepthEnum>;

export const ChainEnum = z.enum(['ethereum', 'base', 'arbitrum', 'optimism', 'polygon', 'solana']);

// ── Input ──────────────────────────────────────────────────────────

export const walletSafetyInput = z.object({
  walletAddress: z.string().min(1, 'Wallet address is required'),
  chain: ChainEnum.default('ethereum'),
  targetContract: z.string().optional(),
  depth: DepthEnum.default('standard'),
}).superRefine((data, ctx) => {
  if (!isValidAddressForChain(data.walletAddress, data.chain)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: data.chain === 'solana'
        ? 'Invalid Solana address (expected base58, 32-44 chars)'
        : 'Invalid wallet address (expected 0x-prefixed, 40 hex chars)',
      path: ['walletAddress'],
    });
  }
  if (data.targetContract && !isValidAddressForChain(data.targetContract, data.chain)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: data.chain === 'solana'
        ? 'Invalid Solana contract address (expected base58, 32-44 chars)'
        : 'Invalid contract address (expected 0x-prefixed, 40 hex chars)',
      path: ['targetContract'],
    });
  }
});

export type WalletSafetyInput = z.infer<typeof walletSafetyInput>;

// ── Output Sub-Schemas ─────────────────────────────────────────────

export const approvalDetailSchema = z.object({
  token: z.string(),
  spender: z.string(),
  spenderLabel: z.string().optional(),
  spenderProtocol: z.string().optional(),
  spenderRisk: RiskLevelEnum,
  allowance: z.string(),
  recommendation: z.enum(['revoke', 'reduce', 'ok']),
});

export const approvalsSchema = z.object({
  totalApprovals: z.number().int(),
  riskyApprovals: z.number().int(),
  unlimitedApprovals: z.number().int(),
  approvalDetails: z.array(approvalDetailSchema),
});

export const suspiciousPatternSchema = z.object({
  pattern: z.string(),
  severity: z.enum(['info', 'warning', 'danger']),
  description: z.string(),
  transactions: z.array(z.string()).optional(),
});

export const recentActivitySchema = z.object({
  transactionCount30d: z.number().int(),
  uniqueContractsInteracted: z.number().int(),
  suspiciousPatterns: z.array(suspiciousPatternSchema),
});

export const targetContractAssessmentSchema = z.object({
  address: z.string(),
  label: z.string().optional(),
  protocol: z.string().optional(),
  riskLevel: RiskLevelEnum,
  isVerified: z.boolean(),
  isProxy: z.boolean(),
  concerns: z.array(z.string()),
  recommendation: z.enum(['proceed', 'caution', 'avoid']),
});

// ── Output ─────────────────────────────────────────────────────────

export const walletSafetyOutput = z.object({
  walletAddress: z.string(),
  chain: z.string(),
  overallRisk: RiskLevelEnum,
  riskScore: z.number().min(0).max(100),
  timestamp: z.string(),

  approvals: approvalsSchema,

  recentActivity: recentActivitySchema.optional(),

  targetContractAssessment: targetContractAssessmentSchema.optional(),

  summary: z.string(),
  actionItems: z.array(z.string()),

  relatedServices: z.array(z.object({
    endpoint: z.string(),
    description: z.string(),
    suggestedInput: z.record(z.string(), z.unknown()),
  })),

  metadata: z.object({
    chain: z.string(),
    depth: DepthEnum,
    processingTimeMs: z.number(),
    estimatedCostUsd: z.number(),
    subsystemResults: z.object({
      approvalScan: z.enum(['success', 'partial', 'failed']),
      recentActivity: z.enum(['success', 'partial', 'failed', 'skipped']),
      targetAssessment: z.enum(['success', 'partial', 'failed', 'skipped']),
    }),
  }),
});

export type WalletSafetyOutput = z.infer<typeof walletSafetyOutput>;

// ── Pattern Types ──────────────────────────────────────────────────

export interface PatternMatch {
  pattern: string;
  severity: 'info' | 'warning' | 'danger';
  description: string;
  transactions?: string[];
}
