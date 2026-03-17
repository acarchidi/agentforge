import { z } from 'zod';

export const summarizeInput = z.object({
  text: z.string().min(1).max(50000),
  maxLength: z.enum(['brief', 'standard', 'detailed']).default('standard'),
  format: z.enum(['prose', 'bullet_points', 'structured']).default('structured'),
  focus: z.string().max(200).optional(),
});

export const summarizeOutput = z.object({
  summary: z.string(),
  keyPoints: z.array(z.string()),
  wordCount: z.number(),
  compressionRatio: z.number(),
  metadata: z.object({
    model: z.string(),
    processingTimeMs: z.number(),
  }),
});

export type SummarizeInput = z.infer<typeof summarizeInput>;
export type SummarizeOutput = z.infer<typeof summarizeOutput>;
