import { z } from 'zod';

export const feedbackInput = z.object({
  type: z.enum(['feature_request', 'bug_report', 'service_request', 'general']),
  endpoint: z.string().optional(),
  message: z.string().min(1).max(2000),
  contact: z.string().max(200).optional(),
});

export type FeedbackInput = z.infer<typeof feedbackInput>;
