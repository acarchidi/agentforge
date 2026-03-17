import { z } from 'zod';

export const sentimentInput = z.object({
  text: z
    .string()
    .min(1, 'Text is required')
    .max(10000, 'Text must be under 10,000 characters'),
  context: z
    .enum(['crypto', 'finance', 'general', 'social_media'])
    .default('crypto'),
});

export const sentimentOutput = z.object({
  sentiment: z.number().min(-1).max(1),
  confidence: z.number().min(0).max(1),
  label: z.enum([
    'very_bearish',
    'bearish',
    'neutral',
    'bullish',
    'very_bullish',
  ]),
  reasoning: z.string(),
  entities: z.array(
    z.object({
      name: z.string(),
      sentiment: z.number().min(-1).max(1),
    }),
  ),
  metadata: z.object({
    model: z.string(),
    processingTimeMs: z.number(),
  }),
});

export type SentimentInput = z.infer<typeof sentimentInput>;
export type SentimentOutput = z.infer<typeof sentimentOutput>;
