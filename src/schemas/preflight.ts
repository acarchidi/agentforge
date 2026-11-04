import { z } from 'zod';
import { relatedServicesField } from './shared.js';
import { txSimulateTx, txSimulateOutput } from './txSimulate.js';
import { typedDataSchema, paymentRequiredSchema, signatureCheckOutput } from './signatureCheck.js';
import { addressCheckItem } from './addressCheck.js';
import { contentScanFinding, contentScanVerdict } from './contentScan.js';
import { EVM_CHAINS } from '../utils/chains.js';
import { PREFLIGHT_LIMITS } from '../pricing.js';

const evmAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Must be a valid 0x-prefixed EVM address');

// ── Input ──────────────────────────────────────────────────────────

export const preflightInput = z
  .object({
    /** Chain the action happens on. Defaults to the typed data's chainId for signatures, else base. */
    chain: z.enum(EVM_CHAINS).optional(),
    /** Wallet taking the action (signer / sender). Required with transactions. */
    from: evmAddress.optional(),
    /** Transactions about to be signed, simulated in order. */
    transactions: z.array(txSimulateTx).min(1).max(5).optional(),
    /** EIP-712 typed data about to be signed (object, or its JSON string). */
    typedData: z.union([typedDataSchema, z.string()]).optional(),
    /** x402 PaymentRequired about to be paid. */
    paymentRequired: paymentRequiredSchema.optional(),
    /** x402 only: the most you expect to pay, in USD. */
    expectedMaxUsd: z.number().positive().optional(),
    /** Addresses about to receive funds or permissions (EVM or Solana). */
    recipients: z.array(z.string().min(1)).max(PREFLIGHT_LIMITS.recipients).optional(),
    /** Tokens about to be bought or accepted; each is rug-checked (priced per token). */
    tokens: z.array(evmAddress).max(PREFLIGHT_LIMITS.tokens).optional(),
  })
  .refine(
    (v) => !!(v.transactions || v.typedData || v.paymentRequired || v.recipients?.length || v.tokens?.length),
    { message: 'Provide at least one of transactions, typedData, paymentRequired, recipients, or tokens' },
  )
  .refine((v) => !(v.typedData && v.paymentRequired), {
    message: 'Provide typedData or paymentRequired, not both',
  })
  .refine((v) => !v.transactions || !!v.from, {
    message: 'from (the sending wallet) is required with transactions',
    path: ['from'],
  });

export type PreflightInput = z.infer<typeof preflightInput>;

// ── Output ─────────────────────────────────────────────────────────

const verdict = z.enum(['proceed', 'caution', 'avoid']);

export const preflightTokenItem = z.object({
  address: z.string(),
  /** 'requested' = passed in tokens; 'received' = the simulation shows the wallet receiving it. */
  source: z.enum(['requested', 'received']),
  status: z.enum(['ok', 'error']),
  verdict: verdict.optional(),
  riskScore: z.number().optional(),
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  flags: z.array(z.string()).optional(),
  error: z.string().optional(),
});

export const preflightOutput = z.object({
  verdict,
  /** One sentence an agent can act on or log. */
  summary: z.string(),
  /** Every reason behind the verdict, worst first, each prefixed with the check it came from. */
  reasons: z.array(z.string()),
  chain: z.string(),
  checksRun: z.array(z.enum(['simulation', 'signature', 'addresses', 'tokens'])),
  simulation: txSimulateOutput.omit({ relatedServices: true }).optional(),
  signature: signatureCheckOutput.omit({ relatedServices: true }).optional(),
  addresses: z.array(addressCheckItem).optional(),
  tokens: z.array(preflightTokenItem).optional(),
  /**
   * Prompt-injection scan over the token names, symbols and labels the other
   * checks surfaced (same rules as /v1/content-scan). Present when there was
   * anything to scan; malicious downgrades the verdict to at least caution.
   */
  promptInjection: z.object({ verdict: contentScanVerdict, findings: z.array(contentScanFinding) }).optional(),
  /** Checks that could not run (e.g. simulation on a chain without eth_simulateV1). */
  skipped: z.array(z.object({ check: z.string(), reason: z.string() })),
  pricing: z.object({ base: z.string(), perToken: z.string(), tokensCharged: z.number().int(), total: z.string() }),
  metadata: z.object({ processingTimeMs: z.number() }),
  relatedServices: relatedServicesField,
});

export type PreflightOutput = z.infer<typeof preflightOutput>;
