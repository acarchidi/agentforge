import { z } from 'zod';

// ── Input ──────────────────────────────────────────────────────────────

export const tokenRiskMetricsInput = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Must be a valid 0x-prefixed EVM address'),
  chain: z
    .enum(['ethereum', 'base', 'arbitrum', 'optimism', 'polygon'])
    .default('ethereum'),
});

export type TokenRiskMetricsInput = z.infer<typeof tokenRiskMetricsInput>;

// ── Shared risk level enums ────────────────────────────────────────────

const concentrationRiskLevel = z.enum(['low', 'medium', 'high', 'critical']);
const liquidityRiskLevel = z.enum(['low', 'medium', 'high', 'critical']);
const permissionRiskLevel = z.enum(['none', 'low', 'medium', 'high', 'critical']);
const deployerRiskLevel = z.enum(['unknown', 'low', 'medium', 'high']);
const overallRiskLevel = z.enum(['low', 'medium', 'high', 'critical']);

// ── Output ─────────────────────────────────────────────────────────────

export const tokenRiskMetricsOutput = z.object({
  address: z.string(),
  chain: z.string(),
  symbol: z.string().optional(),
  name: z.string().optional(),

  /** 'cached' if returned from pre-computed cache, 'live' if freshly computed */
  source: z.enum(['cached', 'live']),
  computedAt: z.string(),
  stalenessSec: z.number(),

  // === HOLDER CONCENTRATION ===
  holders: z.object({
    totalHolders: z.number().int().optional(),
    /** Percentage of total supply held by top 10 addresses */
    top10HolderPct: z.number().min(0).max(100),
    top10Addresses: z
      .array(
        z.object({
          address: z.string(),
          /** Registry label: "Binance Hot Wallet", "Uniswap V3 Pool", etc. */
          label: z.string().optional(),
          /** Percentage of total supply */
          pct: z.number(),
          isContract: z.boolean(),
        }),
      )
      .max(10),
    concentrationRisk: concentrationRiskLevel,
  }),

  // === LIQUIDITY DEPTH ===
  liquidity: z.object({
    totalLiquidityUsd: z.number().optional(),
    marketCapUsd: z.number().optional(),
    /** < 0.01 = very thin (dangerous), 0.01-0.05 = thin, 0.05-0.15 = moderate, > 0.15 = deep */
    liquidityToMcapRatio: z.number().optional(),
    liquidityRisk: liquidityRiskLevel,
    topPools: z
      .array(
        z.object({
          dex: z.string(),
          pair: z.string(),
          tvlUsd: z.number(),
        }),
      )
      .max(5)
      .optional(),
  }),

  // === CONTRACT PERMISSIONS ===
  permissions: z.object({
    /** Owner can create new tokens */
    canMint: z.boolean(),
    /** Owner can destroy tokens */
    canBurn: z.boolean(),
    /** Owner can pause transfers */
    canPause: z.boolean(),
    /** Owner can blacklist addresses */
    canBlacklist: z.boolean(),
    /** Contract is upgradeable proxy */
    canUpgrade: z.boolean(),
    /** Contract has an owner/admin */
    hasOwner: z.boolean(),
    /** Ownership renounced (owner = 0x0) */
    isRenounced: z.boolean().optional(),
    permissionRisk: permissionRiskLevel,
  }),

  // === DEPLOYER HISTORY ===
  deployer: z.object({
    address: z.string().optional(),
    label: z.string().optional(),
    totalContractsDeployed: z.number().int().optional(),
    knownRugPulls: z.number().int().optional(),
    deployerRisk: deployerRiskLevel,
  }),

  // === COMPOSITE SCORE ===
  overallRisk: z.object({
    /** Weighted: concentration 30%, liquidity 25%, permissions 30%, deployer 15% */
    score: z.number().min(0).max(100),
    level: overallRiskLevel,
    flags: z.array(z.string()),
  }),

  relatedServices: z.array(
    z.object({
      endpoint: z.string(),
      description: z.string(),
      suggestedInput: z.record(z.string(), z.unknown()),
    }),
  ),
});

export type TokenRiskMetricsOutput = z.infer<typeof tokenRiskMetricsOutput>;
