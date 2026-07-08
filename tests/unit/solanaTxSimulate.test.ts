import { describe, it, expect } from 'vitest';
import { solanaTxSimulateInput, solanaTxSimulateOutput } from '../../src/schemas/solanaTxSimulate.js';
import {
  labelProgramsInvoked,
  computeBalanceChanges,
  detectSimulateRiskFlags,
  deriveRecommendation,
} from '../../src/services/solana/txSimulate.js';

describe('solanaTxSimulateInput', () => {
  it('accepts a base64-looking transaction string', () => {
    const result = solanaTxSimulateInput.parse({ transaction: 'AQABAgMAAA==' });
    expect(result.transaction).toBe('AQABAgMAAA==');
  });

  it('rejects an empty transaction', () => {
    expect(() => solanaTxSimulateInput.parse({ transaction: '' })).toThrow();
  });
});

describe('labelProgramsInvoked', () => {
  it('dedupes repeated program IDs', () => {
    const labeled = labelProgramsInvoked([
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    ]);
    expect(labeled).toHaveLength(1);
  });

  it('labels known and unknown programs correctly', () => {
    const labeled = labelProgramsInvoked([
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      'TotallyUnknown11111111111111111111111111',
    ]);
    expect(labeled.find((p) => p.programId.startsWith('Token'))?.isVerified).toBe(true);
    expect(labeled.find((p) => p.programId.startsWith('Totally'))?.isVerified).toBe(false);
  });
});

describe('computeBalanceChanges', () => {
  const accountKeys = ['walletA', 'walletB'];

  it('reports SOL balance deltas only when changed', () => {
    const changes = computeBalanceChanges(accountKeys, [1_000_000_000, 500_000_000], [900_000_000, 500_000_000], [], []);
    expect(changes).toHaveLength(1);
    expect(changes[0].account).toBe('walletA');
    expect(changes[0].delta).toBeCloseTo(-0.1);
  });

  it('reports no changes when balances are identical', () => {
    const changes = computeBalanceChanges(accountKeys, [1_000_000_000], [1_000_000_000], [], []);
    expect(changes).toHaveLength(0);
  });

  it('reports token balance deltas for accounts present pre and post', () => {
    const pre = [{ accountIndex: 0, mint: 'MINT1', uiTokenAmount: { uiAmount: 100 } }];
    const post = [{ accountIndex: 0, mint: 'MINT1', uiTokenAmount: { uiAmount: 40 } }];
    const changes = computeBalanceChanges(accountKeys, [], [], pre, post);
    expect(changes).toHaveLength(1);
    expect(changes[0].type).toBe('token');
    expect(changes[0].delta).toBe(-60);
  });

  it('reports a new token account that appears only post-simulation', () => {
    const post = [{ accountIndex: 1, mint: 'MINT2', uiTokenAmount: { uiAmount: 25 } }];
    const changes = computeBalanceChanges(accountKeys, [], [], [], post);
    expect(changes).toHaveLength(1);
    expect(changes[0].before).toBe(0);
    expect(changes[0].delta).toBe(25);
  });
});

describe('detectSimulateRiskFlags', () => {
  const verifiedPrograms = [{ programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', isVerified: true }];

  it('flags a failed simulation', () => {
    const flags = detectSimulateRiskFlags([], verifiedPrograms, true);
    expect(flags.some((f) => f.includes('Simulation failed'))).toBe(true);
  });

  it('flags SetAuthority in logs', () => {
    const flags = detectSimulateRiskFlags(['Program log: Instruction: SetAuthority'], verifiedPrograms, false);
    expect(flags.some((f) => f.includes('authority'))).toBe(true);
  });

  it('flags Approve/delegate in logs', () => {
    const flags = detectSimulateRiskFlags(['Program log: Instruction: Approve'], verifiedPrograms, false);
    expect(flags.some((f) => f.includes('delegate'))).toBe(true);
  });

  it('flags CloseAccount in logs', () => {
    const flags = detectSimulateRiskFlags(['Program log: Instruction: CloseAccount'], verifiedPrograms, false);
    expect(flags.some((f) => f.includes('Closes a token account'))).toBe(true);
  });

  it('flags unverified programs', () => {
    const flags = detectSimulateRiskFlags([], [{ programId: 'Unknown1111111111111111111111111111111', isVerified: false }], false);
    expect(flags.some((f) => f.includes('unverified'))).toBe(true);
  });

  it('returns no flags for a clean successful simulation with only verified programs', () => {
    const flags = detectSimulateRiskFlags(['Program log: Instruction: Transfer'], verifiedPrograms, false);
    expect(flags).toHaveLength(0);
  });
});

describe('deriveRecommendation', () => {
  it('recommends avoid when simulation failed', () => {
    expect(deriveRecommendation(true, [])).toBe('avoid');
  });

  it('recommends proceed when successful with no flags', () => {
    expect(deriveRecommendation(false, [])).toBe('proceed');
  });

  it('recommends caution for an authority-change flag', () => {
    expect(deriveRecommendation(false, ['Changes a mint, freeze, or account authority'])).toBe('caution');
  });

  it('recommends caution for any non-empty risk flags even if not severe-keyword matched', () => {
    expect(deriveRecommendation(false, ['Some minor informational flag'])).toBe('caution');
  });
});

describe('solanaTxSimulateOutput', () => {
  it('validates a successful simulation output', () => {
    const output = solanaTxSimulateOutput.parse({
      success: true,
      computeUnitsConsumed: 12000,
      logs: ['Program log: ok'],
      balanceChanges: [{ account: 'a', type: 'sol', before: 1, after: 0.9, delta: -0.1 }],
      programsInvoked: [{ programId: 'x', isVerified: true }],
      riskFlags: [],
      recommendation: 'proceed',
      explanation: 'ok',
      relatedServices: [],
    });
    expect(output.recommendation).toBe('proceed');
  });

  it('validates a failed simulation output (200, not an error)', () => {
    const output = solanaTxSimulateOutput.parse({
      success: false,
      logs: ['Program failed'],
      errorMessage: '{"InstructionError":[0,"Custom"]}',
      balanceChanges: [],
      programsInvoked: [],
      riskFlags: ['Simulation failed'],
      recommendation: 'avoid',
      explanation: 'Failed.',
      relatedServices: [],
    });
    expect(output.success).toBe(false);
    expect(output.recommendation).toBe('avoid');
  });

  it('rejects an invalid recommendation value', () => {
    expect(() =>
      solanaTxSimulateOutput.parse({
        success: true,
        logs: [],
        balanceChanges: [],
        programsInvoked: [],
        riskFlags: [],
        recommendation: 'yolo',
        explanation: 'x',
        relatedServices: [],
      }),
    ).toThrow();
  });
});
