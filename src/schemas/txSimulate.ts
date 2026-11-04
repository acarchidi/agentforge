import { z } from 'zod';
import { relatedServicesField } from './shared.js';

const hex = z.string().regex(/^0x[0-9a-fA-F]*$/, 'Must be 0x-prefixed hex');
const addr = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Must be a valid 0x-prefixed EVM address');

import { SIMULATE_CHAINS } from '../utils/chains.js';

export { SIMULATE_CHAINS };

// ── Input ──────────────────────────────────────────────────────────

export const txSimulateTx = z.object({
  to: addr,
  data: hex.default('0x'),
  /** Wei, as hex or a decimal string. */
  value: z.union([hex, z.string().regex(/^\d+$/)]).default('0x0'),
  gas: hex.optional(),
});

export const txSimulateInput = z.object({
  chain: z.enum(SIMULATE_CHAINS).default('base'),
  from: addr,
  /** Executed in order with state carried over (e.g. approve, then swap). */
  transactions: z.array(txSimulateTx).min(1).max(5),
});

export type TxSimulateInput = z.infer<typeof txSimulateInput>;

// ── Output ─────────────────────────────────────────────────────────

export const txSimulateOutput = z.object({
  chain: z.string(),
  from: z.string(),
  verdict: z.enum(['proceed', 'caution', 'avoid']),
  reasons: z.array(z.string()),
  calls: z.array(z.object({
    index: z.number().int(),
    to: z.string(),
    toLabel: z.string().optional(),
    success: z.boolean(),
    gasUsed: z.number().int().optional(),
    revertReason: z.string().optional(),
  })),
  /** Net change for `from`, per asset. Negative = leaves the wallet. */
  assetChanges: z.array(z.object({
    token: z.string(),
    symbol: z.string().optional(),
    decimals: z.number().int().optional(),
    standard: z.enum(['native', 'erc20', 'erc721', 'erc1155']),
    delta: z.string(),
    deltaFormatted: z.string().optional(),
    tokenId: z.string().optional(),
  })),
  approvals: z.array(z.object({
    token: z.string(),
    symbol: z.string().optional(),
    spender: z.string(),
    spenderLabel: z.string().optional(),
    amount: z.string().optional(),
    unlimited: z.boolean(),
    kind: z.enum(['erc20', 'operator']),
  })),
  counterparties: z.array(z.object({
    address: z.string(),
    role: z.enum(['to', 'recipient', 'spender']),
    verdict: z.enum(['block', 'caution', 'no_known_issues']),
    label: z.string().optional(),
    isContract: z.boolean().nullable().optional(),
  })),
  note: z.string(),
  relatedServices: relatedServicesField,
});

export type TxSimulateOutput = z.infer<typeof txSimulateOutput>;
