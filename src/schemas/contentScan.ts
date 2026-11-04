import { z } from 'zod';
import { relatedServicesField } from './shared.js';
import { CONTENT_SCAN_LIMITS, contentScanBytes } from '../pricing.js';

// ── Input ──────────────────────────────────────────────────────────

/**
 * Untrusted text an agent is about to feed its LLM: tool results, web pages,
 * emails, token metadata. Either one `text` or 1-16 `items`; at most 64 KB in
 * total (larger bodies are rejected with 400 and never charged).
 */
export const contentScanInput = z
  .object({
    text: z.string().optional(),
    items: z.array(z.string()).min(1).max(CONTENT_SCAN_LIMITS.items).optional(),
  })
  .refine((v) => (v.items ? v.text === undefined : typeof v.text === 'string'), {
    message: 'Provide either `text` (string) or `items` (array of strings), not both',
  })
  .refine((v) => contentScanBytes(v) <= CONTENT_SCAN_LIMITS.maxBytes, {
    message: `Total text must be at most ${CONTENT_SCAN_LIMITS.maxBytes} bytes (64 KB)`,
  });

export type ContentScanInput = z.infer<typeof contentScanInput>;

// ── Output ─────────────────────────────────────────────────────────

export const contentScanSeverity = z.enum(['low', 'medium', 'high']);
export const contentScanVerdict = z.enum(['clean', 'suspicious', 'malicious']);

export const contentScanFinding = z.object({
  /** Rule id, e.g. instruction_override, fund_movement_directive, encoded_payload, secret_like. */
  rule: z.string(),
  severity: contentScanSeverity,
  /** Up to 120 chars of the matched text; secrets are masked to their first 4 chars. */
  excerpt: z.string().max(120),
  /** Index into `items` (0 for `text`). */
  item: z.number().int().min(0),
});

export const contentScanAddress = z.object({
  value: z.string(),
  kind: z.enum(['evm', 'solana']),
});

/** The rule-engine result for one or more strings; shared with preflight's promptInjection block. */
export const contentScanResult = z.object({
  /** malicious = score ≥ 40, suspicious = score ≥ 15, else clean. */
  verdict: contentScanVerdict,
  /** high = 40, medium = 15, low = 5 per finding, capped at 100. */
  score: z.number().int().min(0).max(100),
  findings: z.array(contentScanFinding),
  addresses: z.array(contentScanAddress),
  urls: z.array(z.string()),
  /** True when a private-key, Solana secret-key, or seed-phrase shaped string was found. */
  secretsDetected: z.boolean(),
});

export const contentScanOutput = contentScanResult.extend({
  /** 4 KB chunks billed. */
  chunks: z.number().int().min(1),
  pricing: z.object({ chunksCharged: z.number().int(), perChunk: z.string(), total: z.string() }),
  relatedServices: relatedServicesField,
});

export type ContentScanFinding = z.infer<typeof contentScanFinding>;
export type ContentScanResult = z.infer<typeof contentScanResult>;
export type ContentScanOutput = z.infer<typeof contentScanOutput>;
