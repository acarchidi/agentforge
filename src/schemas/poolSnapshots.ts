import { z } from 'zod';

// ── Input (query params for GET endpoint — uses z.coerce for strings) ──

export const poolSnapshotInput = z.object({
  /** Filter by specific pool address or DeFi Llama pool ID */
  pool: z.string().optional(),
  /** Filter by protocol name, e.g. "uniswap-v3", "curve" */
  protocol: z.string().optional(),
  /** Filter by chain, e.g. "ethereum", "base", "arbitrum" */
  chain: z.string().optional(),
  /** Filter pools containing this token symbol, e.g. "ETH", "USDC" */
  token: z.string().optional(),
  sortBy: z.enum(['tvl', 'apy', 'volume']).optional().default('tvl'),
  order: z.enum(['asc', 'desc']).optional().default('desc'),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export type PoolSnapshotInput = z.infer<typeof poolSnapshotInput>;

// ── Pool object ────────────────────────────────────────────────────────

export const poolSchema = z.object({
  /** DeFi Llama pool ID */
  id: z.string(),
  /** Pool contract address (if available) */
  address: z.string().optional(),
  chain: z.string(),
  /** e.g. "uniswap-v3" */
  protocol: z.string(),
  /** e.g. "USDC-ETH" */
  symbol: z.string(),
  /** Individual token symbols */
  tokens: z.array(z.string()),

  // Core metrics
  tvlUsd: z.number(),
  apy: z.number(),
  apyBase: z.number().optional(),
  apyReward: z.number().optional(),
  volume24hUsd: z.number().optional(),

  // Risk indicators
  ilRisk: z.enum(['none', 'low', 'medium', 'high']).optional(),
  stablecoin: z.boolean(),
  exposure: z.enum(['single', 'multi']).optional(),

  // Registry enrichment
  registryLabel: z.string().optional(),
  registryRisk: z.string().optional(),
});

export type Pool = z.infer<typeof poolSchema>;

// ── Output ─────────────────────────────────────────────────────────────

export const poolSnapshotOutput = z.object({
  /** When this snapshot was taken (ISO datetime) */
  timestamp: z.string(),
  /** Seconds since last refresh */
  stalenessSec: z.number(),
  /** Total pools in the snapshot (e.g., 500) */
  totalPoolsIndexed: z.number(),
  /** Number of pools in this response */
  returned: z.number(),
  /** Warning message if data is stale */
  warning: z.string().optional(),

  pools: z.array(poolSchema),

  relatedServices: z.array(z.object({
    endpoint: z.string(),
    description: z.string(),
    suggestedInput: z.record(z.string(), z.unknown()),
  })),
});

export type PoolSnapshotOutput = z.infer<typeof poolSnapshotOutput>;
