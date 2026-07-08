import { z } from 'zod';

export const solanaTxSimulateInput = z.object({
  transaction: z.string().min(1),
});

export type SolanaTxSimulateInput = z.infer<typeof solanaTxSimulateInput>;

const balanceChange = z.object({
  account: z.string(),
  type: z.enum(['sol', 'token']),
  mint: z.string().optional(),
  before: z.number(),
  after: z.number(),
  delta: z.number(),
});

const programInvoked = z.object({
  programId: z.string(),
  label: z.string().optional(),
  category: z.string().optional(),
  isVerified: z.boolean(),
});

export const solanaTxSimulateOutput = z.object({
  success: z.boolean(),
  computeUnitsConsumed: z.number().optional(),
  logs: z.array(z.string()),
  errorMessage: z.string().optional(),
  balanceChanges: z.array(balanceChange),
  programsInvoked: z.array(programInvoked),
  riskFlags: z.array(z.string()),
  recommendation: z.enum(['proceed', 'caution', 'avoid']),
  explanation: z.string(),
  relatedServices: z.array(
    z.object({
      endpoint: z.string(),
      description: z.string(),
      suggestedInput: z.record(z.string(), z.unknown()),
    }),
  ),
});

export type SolanaTxSimulateOutput = z.infer<typeof solanaTxSimulateOutput>;
