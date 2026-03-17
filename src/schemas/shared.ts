import { z } from 'zod';

export const relatedServiceSchema = z.object({
  endpoint: z.string(),
  description: z.string(),
  suggestedInput: z.looseObject({}),
});

export const relatedServicesField = z.array(relatedServiceSchema).optional();

export type RelatedService = z.infer<typeof relatedServiceSchema>;
