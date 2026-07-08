import { z } from 'zod';

export const solanaTxExplainInput = z.object({
  signature: z.string().min(1),
});

export type SolanaTxExplainInput = z.infer<typeof solanaTxExplainInput>;

const labeledInstruction = z.object({
  programId: z.string(),
  label: z.string().optional(),
  category: z.string().optional(),
  isVerified: z.boolean(),
});

const tokenMovement = z.object({
  mint: z.string(),
  amount: z.number(),
  from: z.string(),
  to: z.string(),
});

export const solanaTxExplainOutput = z.object({
  signature: z.string(),
  success: z.boolean(),
  fee: z.number().optional(),
  feePayer: z.string().optional(),
  timestamp: z.number().nullable().optional(),
  instructions: z.array(labeledInstruction),
  tokenMovements: z.array(tokenMovement),
  nativeSolMovements: z
    .array(z.object({ amount: z.number(), from: z.string(), to: z.string() }))
    .optional(),
  explanation: z.string(),
  riskFlags: z.array(z.string()),
  /** 'full' when Helius Enhanced Transactions parsed it; 'partial' when we fell back to raw RPC decoding */
  parseQuality: z.enum(['full', 'partial']),
  relatedServices: z.array(
    z.object({
      endpoint: z.string(),
      description: z.string(),
      suggestedInput: z.record(z.string(), z.unknown()),
    }),
  ),
});

export type SolanaTxExplainOutput = z.infer<typeof solanaTxExplainOutput>;
