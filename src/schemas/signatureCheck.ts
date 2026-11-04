import { z } from 'zod';
import { relatedServicesField } from './shared.js';

import { EVM_CHAINS } from '../utils/chains.js';

export const SIGNATURE_CHAINS = EVM_CHAINS;

export const typedDataSchema = z.object({
  domain: z.record(z.string(), z.unknown()).default({}),
  types: z.record(z.string(), z.array(z.object({ name: z.string(), type: z.string() }))).default({}),
  primaryType: z.string(),
  message: z.record(z.string(), z.unknown()),
});

const paymentOption = z
  .object({
    scheme: z.string(),
    network: z.string(),
    asset: z.string(),
    payTo: z.string(),
    /** v2 field; v1 used maxAmountRequired. Atomic units. */
    amount: z.union([z.string(), z.number()]).optional(),
    maxAmountRequired: z.union([z.string(), z.number()]).optional(),
    extra: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export const paymentRequiredSchema = z.object({ accepts: z.array(paymentOption).min(1) }).passthrough();

// ── Input ──────────────────────────────────────────────────────────

export const signatureCheckInput = z
  .object({
    /** EIP-712 typed data the agent is about to sign (object, or its JSON string). */
    typedData: z.union([typedDataSchema, z.string()]).optional(),
    /** An x402 PaymentRequired (402 body or decoded PAYMENT-REQUIRED header) the agent is about to pay. */
    paymentRequired: paymentRequiredSchema.optional(),
    /** Wallet that would sign. Enables owner/payer mismatch checks. */
    signer: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
    /** Chain the signer is on, for screening and token lookups. Defaults to the typed data's chainId, else base. */
    chain: z.enum(SIGNATURE_CHAINS).optional(),
    /** x402 only: refuse if any payment option asks for more than this many USD. */
    expectedMaxUsd: z.number().positive().optional(),
  })
  .refine((v) => !!v.typedData !== !!v.paymentRequired, {
    message: 'Provide exactly one of typedData or paymentRequired',
  });

export type SignatureCheckInput = z.infer<typeof signatureCheckInput>;

// ── Output ─────────────────────────────────────────────────────────

export const signatureCheckOutput = z.object({
  kind: z.enum([
    'erc20-permit',
    'dai-permit',
    'permit2-allowance',
    'permit2-transfer',
    'seaport-order',
    'transfer-authorization',
    'x402-payment',
    'unknown-typed-data',
  ]),
  verdict: z.enum(['proceed', 'caution', 'avoid']),
  /** One plain-English sentence: what signing this would let someone do. */
  summary: z.string(),
  reasons: z.array(z.string()),
  /** Token permissions or transfers this signature grants, normalized. */
  grants: z.array(z.object({
    token: z.string(),
    symbol: z.string().optional(),
    to: z.string(),
    toLabel: z.string().optional(),
    amount: z.string().optional(),
    amountFormatted: z.string().optional(),
    unlimited: z.boolean(),
    expires: z.string().nullable().optional(),
  })),
  counterparties: z.array(z.object({
    address: z.string(),
    role: z.string(),
    verdict: z.enum(['block', 'caution', 'no_known_issues']),
    label: z.string().optional(),
    isContract: z.boolean().nullable().optional(),
  })),
  /** x402 only: per payment option. */
  paymentOptions: z.array(z.object({
    network: z.string(),
    asset: z.string(),
    assetIsUsdc: z.boolean(),
    amountUsd: z.number().nullable(),
    payTo: z.string(),
    verdict: z.enum(['proceed', 'caution', 'avoid']),
    reasons: z.array(z.string()),
  })).optional(),
  relatedServices: relatedServicesField,
});

export type SignatureCheckOutput = z.infer<typeof signatureCheckOutput>;
