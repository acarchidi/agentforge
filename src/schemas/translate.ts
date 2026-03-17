import { z } from 'zod';

export const translateInput = z.object({
  text: z.string().min(1).max(20000),
  targetLanguage: z.string().min(2).max(50),
  sourceLanguage: z.string().optional(),
  tone: z.enum(['formal', 'casual', 'technical']).default('formal'),
});

export const translateOutput = z.object({
  translatedText: z.string(),
  detectedSourceLanguage: z.string(),
  targetLanguage: z.string(),
  metadata: z.object({
    model: z.string(),
    processingTimeMs: z.number(),
  }),
});

export type TranslateInput = z.infer<typeof translateInput>;
export type TranslateOutput = z.infer<typeof translateOutput>;
