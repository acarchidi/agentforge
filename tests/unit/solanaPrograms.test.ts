import { describe, it, expect } from 'vitest';
import {
  SolanaProgramSchema,
  SolanaProgramCategoryEnum,
  SolanaProgramRegistrySchema,
} from '../../src/registry/solanaPrograms.js';
import { SolanaProgramRegistryLookup, getSolanaProgramRegistry } from '../../src/registry/solanaPrograms.js';
import { isValidSolanaAddress } from '../../src/utils/addressValidation.js';
import solanaProgramsData from '../../src/registry/data/solana-programs.json' with { type: 'json' };

// ── Schema Validation ─────────────────────────────────────────────

describe('SolanaProgramSchema', () => {
  it('accepts a valid minimal entry', () => {
    const entry = SolanaProgramSchema.parse({
      programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      name: 'SPL Token Program',
      protocol: 'SPL',
      category: 'token',
      riskLevel: 'safe',
      description: 'The standard token program.',
      verified: true,
    });
    expect(entry.name).toBe('SPL Token Program');
  });

  it('rejects a non-base58 programId', () => {
    expect(() =>
      SolanaProgramSchema.parse({
        programId: '0xNotBase580000000000000000000000000000',
        name: 'Bad Entry',
        protocol: 'Test',
        category: 'other',
        riskLevel: 'unknown',
        description: 'Invalid.',
        verified: true,
      }),
    ).toThrow();
  });

  it('rejects an invalid category', () => {
    expect(() =>
      SolanaProgramSchema.parse({
        programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        name: 'Bad Category',
        protocol: 'Test',
        category: 'not-a-real-category',
        riskLevel: 'unknown',
        description: 'Invalid.',
        verified: true,
      }),
    ).toThrow();
  });

  it('rejects an invalid riskLevel', () => {
    expect(() =>
      SolanaProgramSchema.parse({
        programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        name: 'Bad Risk',
        protocol: 'Test',
        category: 'token',
        riskLevel: 'super-risky',
        description: 'Invalid.',
        verified: true,
      }),
    ).toThrow();
  });

  it('allows website to be omitted', () => {
    const entry = SolanaProgramSchema.parse({
      programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      name: 'No Website',
      protocol: 'Test',
      category: 'other',
      riskLevel: 'unknown',
      description: 'No site.',
      verified: false,
    });
    expect(entry.website).toBeUndefined();
  });

  it('accepts all defined categories', () => {
    for (const category of SolanaProgramCategoryEnum.options) {
      const entry = SolanaProgramSchema.parse({
        programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        name: 'Category Test',
        protocol: 'Test',
        category,
        riskLevel: 'unknown',
        description: 'Test.',
        verified: true,
      });
      expect(entry.category).toBe(category);
    }
  });
});

describe('SolanaProgramRegistrySchema (seed data)', () => {
  it('the shipped solana-programs.json validates against the schema', () => {
    expect(() => SolanaProgramRegistrySchema.parse(solanaProgramsData)).not.toThrow();
  });

  it('has at least the required core programs', () => {
    const parsed = SolanaProgramRegistrySchema.parse(solanaProgramsData);
    const names = parsed.entries.map((e) => e.name);
    for (const required of [
      'System Program',
      'SPL Token Program',
      'Jupiter Aggregator v6',
      'Wormhole Core Bridge',
    ]) {
      expect(names.some((n) => n.includes(required.split(' ')[0]))).toBe(true);
    }
  });

  it('every seeded programId is a plausible base58 Solana address', () => {
    const parsed = SolanaProgramRegistrySchema.parse(solanaProgramsData);
    for (const entry of parsed.entries) {
      expect(isValidSolanaAddress(entry.programId), `${entry.name}: ${entry.programId}`).toBe(true);
    }
  });

  it('has no duplicate programIds', () => {
    const parsed = SolanaProgramRegistrySchema.parse(solanaProgramsData);
    const ids = parsed.entries.map((e) => e.programId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ── Lookup ──────────────────────────────────────────────────────────

describe('SolanaProgramRegistryLookup', () => {
  const registry = new SolanaProgramRegistryLookup(solanaProgramsData as never);

  it('finds a known program by exact programId', () => {
    const entry = registry.lookup('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
    expect(entry?.name).toBe('SPL Token Program');
  });

  it('returns null for an unknown programId', () => {
    const entry = registry.lookup('11111111111111111111111111111112');
    expect(entry).toBeNull();
  });

  it('returns null for a malformed programId rather than throwing', () => {
    expect(() => registry.lookup('not-a-valid-id')).not.toThrow();
    expect(registry.lookup('not-a-valid-id')).toBeNull();
  });

  it('flags known DEX/AMM programs as pools for concentration exclusion', () => {
    expect(registry.isKnownPool('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4')).toBe(true);
    expect(registry.isKnownPool('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8')).toBe(true);
  });

  it('does not flag a non-pool program (e.g. Memo) as a pool', () => {
    expect(registry.isKnownPool('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr')).toBe(false);
  });

  it('returns false for isKnownPool on an unknown programId', () => {
    expect(registry.isKnownPool('11111111111111111111111111111112')).toBe(false);
  });

  it('getByCategory returns all entries in a category', () => {
    const dexEntries = registry.getByCategory('dex');
    expect(dexEntries.length).toBeGreaterThan(0);
    expect(dexEntries.every((e) => e.category === 'dex')).toBe(true);
  });

  it('getStats returns accurate totals', () => {
    const stats = registry.getStats();
    expect(stats.totalEntries).toBe(63);
    expect(stats.categoryCounts.dex).toBeGreaterThan(0);
    expect(Object.values(stats.categoryCounts).reduce((a, b) => a + b, 0)).toBe(63);
  });

  it('getSolanaProgramRegistry singleton returns the same instance', () => {
    const a = getSolanaProgramRegistry();
    const b = getSolanaProgramRegistry();
    expect(a).toBe(b);
  });

  it('singleton can look up a real seeded program', () => {
    const registry = getSolanaProgramRegistry();
    const entry = registry.lookup('worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth');
    expect(entry?.protocol).toBe('Wormhole');
  });
});
