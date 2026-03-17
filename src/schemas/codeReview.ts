import { z } from 'zod';
import { relatedServicesField } from './shared.js';

export const codeReviewInput = z.object({
  code: z.string().min(1).max(50000),
  previousCode: z.string().max(50000).optional(),
  language: z
    .enum(['solidity', 'rust', 'move', 'typescript'])
    .default('solidity'),
  focus: z
    .enum(['security', 'gas_optimization', 'best_practices', 'all'])
    .default('all'),
});

export const codeReviewOutput = z.object({
  overallRisk: z.enum(['low', 'medium', 'high', 'critical']),
  issues: z.array(
    z.object({
      severity: z.enum(['info', 'low', 'medium', 'high', 'critical']),
      category: z.string(),
      description: z.string(),
      line: z.number().nullable().optional(),
      suggestion: z.string(),
    }),
  ),
  gasOptimization: z
    .object({
      estimatedSavings: z.enum(['none', 'minor', 'moderate', 'significant']),
      suggestions: z.array(
        z.object({
          location: z.string(),
          currentPattern: z.string(),
          suggestedPattern: z.string(),
          estimatedGasSaved: z.string(),
          difficulty: z.enum(['trivial', 'moderate', 'complex']),
        }),
      ),
      summary: z.string(),
    })
    .optional(),
  summary: z.string(),
  metadata: z.object({
    model: z.string(),
    processingTimeMs: z.number(),
    linesAnalyzed: z.number(),
  }),
  relatedServices: relatedServicesField,
});

export type CodeReviewInput = z.infer<typeof codeReviewInput>;
export type CodeReviewOutput = z.infer<typeof codeReviewOutput>;
