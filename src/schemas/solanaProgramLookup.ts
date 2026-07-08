import { z } from 'zod';
import { SolanaProgramCategoryEnum, SolanaRiskLevelEnum } from '../registry/solanaPrograms.js';

export const solanaProgramLookupInput = z.object({
  programId: z.string().min(1),
});

export type SolanaProgramLookupInput = z.infer<typeof solanaProgramLookupInput>;

export const solanaProgramLookupOutput = z.object({
  found: z.boolean(),
  programId: z.string(),
  entry: z
    .object({
      name: z.string(),
      protocol: z.string(),
      category: SolanaProgramCategoryEnum,
      riskLevel: SolanaRiskLevelEnum,
      description: z.string(),
      website: z.string().optional(),
      verified: z.boolean(),
    })
    .nullable(),
  relatedServices: z.array(
    z.object({
      endpoint: z.string(),
      description: z.string(),
      suggestedInput: z.record(z.string(), z.unknown()),
    }),
  ),
});

export type SolanaProgramLookupOutput = z.infer<typeof solanaProgramLookupOutput>;
