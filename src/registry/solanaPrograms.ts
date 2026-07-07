import { z } from 'zod';
import { isValidSolanaAddress } from '../utils/addressValidation.js';
import solanaProgramsData from './data/solana-programs.json' with { type: 'json' };

// ── Enums ─────────────────────────────────────────────────────────

export const SolanaProgramCategoryEnum = z.enum([
  'dex',
  'amm',
  'lending',
  'nft',
  'token',
  'system',
  'staking',
  'bridge',
  'launchpad',
  'memecoin-infra',
  'oracle',
  'other',
]);

export type SolanaProgramCategory = z.infer<typeof SolanaProgramCategoryEnum>;

export const SolanaRiskLevelEnum = z.enum([
  'safe',
  'low',
  'medium',
  'high',
  'critical',
  'unknown',
]);

export type SolanaRiskLevel = z.infer<typeof SolanaRiskLevelEnum>;

// Categories whose programs custody pooled liquidity — used to exclude
// pool/vault-owned token accounts from holder-concentration calculations.
const POOL_CATEGORIES: ReadonlySet<SolanaProgramCategory> = new Set(['dex', 'amm']);

// ── Program Entry ─────────────────────────────────────────────────

export const SolanaProgramSchema = z.object({
  programId: z
    .string()
    .refine((id) => isValidSolanaAddress(id), { message: 'programId must be a valid base58 Solana address' }),
  name: z.string().min(1),
  protocol: z.string().min(1),
  category: SolanaProgramCategoryEnum,
  riskLevel: SolanaRiskLevelEnum,
  description: z.string().min(1),
  website: z.string().url().optional(),
  verified: z.boolean(),
  source: z.string().optional(),
});

export type SolanaProgram = z.infer<typeof SolanaProgramSchema>;

// ── Registry ──────────────────────────────────────────────────────

export const SolanaProgramRegistrySchema = z.object({
  version: z.string(),
  generatedAt: z.string(),
  entries: z.array(SolanaProgramSchema),
});

export type SolanaProgramRegistry = z.infer<typeof SolanaProgramRegistrySchema>;

// ── Stats ─────────────────────────────────────────────────────────

export interface SolanaProgramRegistryStats {
  version: string;
  totalEntries: number;
  categoryCounts: Record<string, number>;
  protocolCount: number;
}

// ── Lookup Class ──────────────────────────────────────────────────

export class SolanaProgramRegistryLookup {
  private readonly entries: SolanaProgram[];
  private readonly version: string;

  private readonly byProgramId = new Map<string, SolanaProgram>();
  private readonly byProtocol = new Map<string, SolanaProgram[]>();
  private readonly byCategory = new Map<string, SolanaProgram[]>();

  constructor(raw: SolanaProgramRegistry) {
    const parsed = SolanaProgramRegistrySchema.parse(raw);
    this.version = parsed.version;
    this.entries = parsed.entries;
    this.buildIndexes();
  }

  private buildIndexes(): void {
    for (const entry of this.entries) {
      this.byProgramId.set(entry.programId, entry);

      const protocolEntries = this.byProtocol.get(entry.protocol) ?? [];
      protocolEntries.push(entry);
      this.byProtocol.set(entry.protocol, protocolEntries);

      const categoryEntries = this.byCategory.get(entry.category) ?? [];
      categoryEntries.push(entry);
      this.byCategory.set(entry.category, categoryEntries);
    }
  }

  /**
   * Look up a program by its exact base58 program ID. Never throws —
   * a malformed ID simply won't be found.
   */
  lookup(programId: string): SolanaProgram | null {
    return this.byProgramId.get(programId) ?? null;
  }

  /**
   * True if programId belongs to a known DEX/AMM — used to exclude
   * pool/vault-owned token accounts from holder-concentration math.
   */
  isKnownPool(programId: string): boolean {
    const entry = this.byProgramId.get(programId);
    if (!entry) return false;
    return POOL_CATEGORIES.has(entry.category);
  }

  /**
   * True if a program is flagged high or critical risk.
   */
  isHighRisk(programId: string): boolean {
    const entry = this.byProgramId.get(programId);
    if (!entry?.riskLevel) return false;
    return entry.riskLevel === 'high' || entry.riskLevel === 'critical';
  }

  getByProtocol(protocol: string): SolanaProgram[] {
    return this.byProtocol.get(protocol) ?? [];
  }

  getByCategory(category: SolanaProgramCategory): SolanaProgram[] {
    return this.byCategory.get(category) ?? [];
  }

  getAllEntries(): SolanaProgram[] {
    return [...this.entries];
  }

  getStats(): SolanaProgramRegistryStats {
    const categoryCounts: Record<string, number> = {};
    for (const [category, entries] of this.byCategory) {
      categoryCounts[category] = entries.length;
    }

    return {
      version: this.version,
      totalEntries: this.entries.length,
      categoryCounts,
      protocolCount: this.byProtocol.size,
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────

let instance: SolanaProgramRegistryLookup | null = null;

export function getSolanaProgramRegistry(): SolanaProgramRegistryLookup {
  if (!instance) {
    instance = new SolanaProgramRegistryLookup(solanaProgramsData as SolanaProgramRegistry);
  }
  return instance;
}
