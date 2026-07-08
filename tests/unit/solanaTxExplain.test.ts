import { describe, it, expect } from 'vitest';
import { solanaTxExplainInput, solanaTxExplainOutput } from '../../src/schemas/solanaTxExplain.js';
import { labelInstructions, detectTxExplainRiskFlags } from '../../src/services/solana/txExplain.js';
import { isValidSolanaSignature } from '../../src/utils/addressValidation.js';

const REAL_SIG = 'b7219192723c6a9ee77cd56ffdd28805d6177f76ffe0d34260bb5dc76abf19cf5eykt4UsFv8P8NJ';

describe('solanaTxExplainInput', () => {
  it('accepts a plausible signature', () => {
    const result = solanaTxExplainInput.parse({ signature: REAL_SIG });
    expect(result.signature).toBe(REAL_SIG);
  });

  it('rejects an empty signature', () => {
    expect(() => solanaTxExplainInput.parse({ signature: '' })).toThrow();
  });
});

describe('isValidSolanaSignature', () => {
  it('accepts an 87-88 char base58 string', () => {
    expect(isValidSolanaSignature('5'.repeat(87))).toBe(true);
  });

  it('rejects a 44-char address-length string (too short for a signature)', () => {
    expect(isValidSolanaSignature('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')).toBe(false);
  });

  it('rejects strings with invalid base58 characters', () => {
    expect(isValidSolanaSignature('0'.repeat(87))).toBe(false); // '0' is not in base58 alphabet
  });

  it('rejects empty string', () => {
    expect(isValidSolanaSignature('')).toBe(false);
  });
});

describe('labelInstructions', () => {
  it('labels a known program (SPL Token) as verified', () => {
    const [labeled] = labelInstructions(['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA']);
    expect(labeled.isVerified).toBe(true);
    expect(labeled.label).toBe('SPL Token Program');
    expect(labeled.category).toBe('token');
  });

  it('labels an unknown program as unverified with no label', () => {
    const [labeled] = labelInstructions(['Unknown1111111111111111111111111111111111']);
    expect(labeled.isVerified).toBe(false);
    expect(labeled.label).toBeUndefined();
  });

  it('labels multiple programs preserving order', () => {
    const labeled = labelInstructions([
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      '11111111111111111111111111111111',
    ]);
    expect(labeled).toHaveLength(2);
    expect(labeled[0].programId).toBe('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
    expect(labeled[1].label).toBe('System Program');
  });
});

describe('detectTxExplainRiskFlags', () => {
  it('flags unverified programs', () => {
    const labeled = labelInstructions(['Unknown1111111111111111111111111111111111']);
    const flags = detectTxExplainRiskFlags(labeled, []);
    expect(flags.some((f) => f.includes('unverified'))).toBe(true);
  });

  it('does not flag fully-known, verified-only instructions', () => {
    const labeled = labelInstructions(['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA']);
    const flags = detectTxExplainRiskFlags(labeled, []);
    expect(flags.some((f) => f.includes('unverified'))).toBe(false);
  });

  it('flags launchpad category interactions', () => {
    const labeled = labelInstructions(['6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P']); // Pump.fun
    const flags = detectTxExplainRiskFlags(labeled, []);
    expect(flags.some((f) => f.toLowerCase().includes('launchpad'))).toBe(true);
  });

  it('flags SetAuthority-hinting instruction data', () => {
    const labeled = labelInstructions(['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA']);
    const flags = detectTxExplainRiskFlags(labeled, ['SetAuthority instruction data blob']);
    expect(flags.some((f) => f.toLowerCase().includes('authority'))).toBe(true);
  });

  it('returns no flags for a clean, fully-verified, non-launchpad transaction', () => {
    const labeled = labelInstructions(['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', '11111111111111111111111111111111']);
    const flags = detectTxExplainRiskFlags(labeled, ['regular transfer data']);
    expect(flags).toHaveLength(0);
  });
});

describe('solanaTxExplainOutput', () => {
  it('validates a full-parse output', () => {
    const output = solanaTxExplainOutput.parse({
      signature: REAL_SIG,
      success: true,
      fee: 5000,
      feePayer: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      timestamp: 1720000000,
      instructions: [{ programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', isVerified: true }],
      tokenMovements: [{ mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', amount: 10, from: 'a', to: 'b' }],
      explanation: 'A token transfer occurred.',
      riskFlags: [],
      parseQuality: 'full',
      relatedServices: [],
    });
    expect(output.parseQuality).toBe('full');
  });

  it('validates a partial-parse (fallback) output', () => {
    const output = solanaTxExplainOutput.parse({
      signature: REAL_SIG,
      success: false,
      instructions: [],
      tokenMovements: [],
      explanation: 'Best-effort summary.',
      riskFlags: [],
      parseQuality: 'partial',
      relatedServices: [],
    });
    expect(output.parseQuality).toBe('partial');
    expect(output.success).toBe(false);
  });

  it('rejects an invalid parseQuality value', () => {
    expect(() =>
      solanaTxExplainOutput.parse({
        signature: REAL_SIG,
        success: true,
        instructions: [],
        tokenMovements: [],
        explanation: 'x',
        riskFlags: [],
        parseQuality: 'complete',
        relatedServices: [],
      }),
    ).toThrow();
  });
});
