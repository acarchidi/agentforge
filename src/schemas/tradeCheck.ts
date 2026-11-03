import { z } from 'zod';
import { relatedServicesField } from './shared.js';
import { tokenRiskMetricsOutput } from './tokenRiskMetrics.js';
import { tokenIntelOutput } from './tokenIntel.js';
import { gasOracleOutput } from './gasOracle.js';

// ── Input ──────────────────────────────────────────────────────────

/** Chains supported by all three bundled services. */
export const tradeCheckInput = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Must be a valid 0x-prefixed EVM token address'),
  chain: z
    .enum(['ethereum', 'base', 'polygon', 'arbitrum'])
    .default('ethereum'),
});

export type TradeCheckInput = z.infer<typeof tradeCheckInput>;

// ── Output ─────────────────────────────────────────────────────────

export const tradeCheckOutput = z.object({
  /** Deterministic roll-up of the component risk signals — no extra LLM call. */
  verdict: z.enum(['proceed', 'caution', 'avoid']),
  verdictReasons: z.array(z.string()),

  /** Quantitative rug-check (always present; the check fails without it). */
  riskMetrics: tokenRiskMetricsOutput,
  /** AI risk assessment with market data; null if that component failed. */
  intel: tokenIntelOutput.nullable(),
  /** Current gas on the requested chain; null if that component failed. */
  gas: gasOracleOutput.nullable(),

  /** Components that failed and were omitted rather than failing the call. */
  degraded: z.array(z.enum(['intel', 'gas'])),

  metadata: z.object({
    chain: z.string(),
    address: z.string(),
    processingTimeMs: z.number(),
    bundleSavings: z.string(),
  }),

  relatedServices: relatedServicesField,
});

export type TradeCheckOutput = z.infer<typeof tradeCheckOutput>;
