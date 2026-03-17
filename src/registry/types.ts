import { z } from 'zod';

// ── Enums ─────────────────────────────────────────────────────────

export const ContractCategoryEnum = z.enum([
  'dex',
  'lending',
  'bridge',
  'stablecoin',
  'yield',
  'nft-marketplace',
  'oracle',
  'governance',
  'liquid-staking',
  'derivatives',
  'token',
  'wallet',
  'multisig',
  'infrastructure',
  'unknown',
]);

export type ContractCategory = z.infer<typeof ContractCategoryEnum>;

export const RiskLevelEnum = z.enum([
  'safe',
  'low',
  'medium',
  'high',
  'critical',
  'unknown',
]);

export type RiskLevel = z.infer<typeof RiskLevelEnum>;

// ── Contract Label ────────────────────────────────────────────────

export const ContractLabelSchema = z.object({
  address: z
    .string()
    .startsWith('0x')
    .transform((a) => a.toLowerCase()),
  name: z.string().min(1),
  chain: z.string().min(1),
  protocol: z.string().optional(),
  category: ContractCategoryEnum.optional(),
  riskLevel: RiskLevelEnum.optional(),
  tags: z.array(z.string()).optional(),
  isProxy: z.boolean().optional(),
  deployedAt: z.string().optional(),
  description: z.string().optional(),
  source: z.string().optional(),
  lastVerified: z.string().optional(),
});

export type ContractLabel = z.infer<typeof ContractLabelSchema>;

// ── Registry ──────────────────────────────────────────────────────

export const ContractRegistrySchema = z.object({
  version: z.string(),
  generatedAt: z.string(),
  entries: z.array(ContractLabelSchema),
});

export type ContractRegistry = z.infer<typeof ContractRegistrySchema>;

// ── Stats ─────────────────────────────────────────────────────────

export interface RegistryStats {
  version: string;
  totalEntries: number;
  uniqueAddresses: number;
  chains: string[];
  categoryCounts: Record<string, number>;
  protocolCount: number;
}
