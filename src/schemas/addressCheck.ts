import { z } from 'zod';
import { relatedServicesField } from './shared.js';
import { ADDRESS_CHECK_LIMITS } from '../pricing.js';

const checkChain = z.enum(['ethereum', 'base', 'arbitrum', 'optimism', 'polygon', 'solana']);
const addressEntry = z.object({ address: z.string().min(32).max(64), chain: checkChain.optional() });

// ── Input ──────────────────────────────────────────────────────────

/** Accepts `addresses: [...]` (1-100) or a single `address` for convenience. */
export const addressCheckInput = z
  .object({
    addresses: z.array(addressEntry).min(ADDRESS_CHECK_LIMITS.min).max(ADDRESS_CHECK_LIMITS.max).optional(),
    address: z.string().min(32).max(64).optional(),
    chain: checkChain.default('ethereum'),
  })
  .refine((v) => (v.addresses ? !v.address : !!v.address), {
    message: 'Provide either `addresses` (array) or `address` (single), not both',
  });

export type AddressCheckInput = z.infer<typeof addressCheckInput>;

// ── Output ─────────────────────────────────────────────────────────

export const addressCheckItem = z.object({
  address: z.string(),
  chain: z.string(),
  /**
   * block = on a sanctions or scam list; caution = risk signals; no_known_issues
   * = nothing adverse found (not a guarantee of safety).
   */
  verdict: z.enum(['block', 'caution', 'no_known_issues']),
  reasons: z.array(z.string()),
  sanctioned: z.boolean(),
  flaggedScam: z.boolean(),
  knownEntity: z
    .object({ name: z.string(), category: z.string().optional(), riskLevel: z.string().optional() })
    .optional(),
  /** EVM only; null when the RPC lookup failed. */
  isContract: z.boolean().nullable().optional(),
  /** EVM only: outgoing transaction count (nonce). 0 = brand-new address. */
  txCount: z.number().int().nullable().optional(),
  valid: z.boolean(),
});

export const addressCheckOutput = z.object({
  results: z.array(addressCheckItem),
  summary: z.object({
    checked: z.number().int(),
    block: z.number().int(),
    caution: z.number().int(),
    noKnownIssues: z.number().int(),
  }),
  sources: z.object({ listsGeneratedAt: z.string(), lists: z.array(z.string()) }),
  pricing: z.object({ addressesCharged: z.number().int(), total: z.string() }),
  relatedServices: relatedServicesField,
});

export type AddressCheckItem = z.infer<typeof addressCheckItem>;
export type AddressCheckOutput = z.infer<typeof addressCheckOutput>;
