import { describe, it, expect } from 'vitest';
import {
  approvalScanInput,
  approvalScanOutput,
} from '../../src/schemas/approvalScanner.js';

describe('Approval Scanner Schema Validation', () => {
  // ── Input schema ──────────────────────────────────────────────────

  it('accepts valid wallet address with defaults', () => {
    const result = approvalScanInput.parse({
      address: '0x' + 'a'.repeat(40),
    });
    expect(result.chain).toBe('ethereum');
  });

  it('accepts valid address with chain', () => {
    const result = approvalScanInput.parse({
      address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      chain: 'base',
    });
    expect(result.chain).toBe('base');
  });

  it('rejects address missing 0x prefix', () => {
    expect(() =>
      approvalScanInput.parse({ address: 'a'.repeat(40) }),
    ).toThrow();
  });

  it('rejects address with wrong length', () => {
    expect(() =>
      approvalScanInput.parse({ address: '0x' + 'a'.repeat(39) }),
    ).toThrow();
  });

  it('rejects invalid chain', () => {
    expect(() =>
      approvalScanInput.parse({ address: '0x' + 'a'.repeat(40), chain: 'solana' }),
    ).toThrow();
  });

  // ── Output schema ─────────────────────────────────────────────────

  it('validates output with approvals', () => {
    const output = approvalScanOutput.parse({
      wallet: { address: '0x' + 'a'.repeat(40), chain: 'ethereum' },
      approvals: [
        {
          token: { address: '0x' + 'b'.repeat(40), symbol: 'USDC', name: 'USD Coin' },
          spender: { address: '0x' + 'c'.repeat(40), contractName: 'Uniswap V3', isVerified: true, label: 'Uniswap V3 Router' },
          allowance: 'unlimited',
          riskLevel: 'safe',
          riskReason: null,
        },
        {
          token: { address: '0x' + 'd'.repeat(40), symbol: 'DAI', name: 'Dai' },
          spender: { address: '0x' + 'e'.repeat(40), contractName: null, isVerified: false, label: null },
          allowance: 'unlimited',
          riskLevel: 'critical',
          riskReason: 'Unlimited approval to unverified contract',
        },
      ],
      summary: {
        totalApprovals: 2,
        unlimitedApprovals: 2,
        riskyApprovals: 1,
        overallRisk: 'high',
        recommendation: 'Revoke the unlimited approval to the unverified contract.',
      },
      metadata: {
        chain: 'ethereum',
        processingTimeMs: 2500,
        estimatedCostUsd: 0.002,
        approvalsScanned: 2,
      },
    });
    expect(output.approvals).toHaveLength(2);
    expect(output.summary.totalApprovals).toBe(2);
    expect(output.summary.overallRisk).toBe('high');
  });

  it('validates output with empty approvals (clean wallet)', () => {
    const output = approvalScanOutput.parse({
      wallet: { address: '0x' + 'a'.repeat(40), chain: 'ethereum' },
      approvals: [],
      summary: {
        totalApprovals: 0,
        unlimitedApprovals: 0,
        riskyApprovals: 0,
        overallRisk: 'clean',
        recommendation: 'No active approvals found. Wallet is clean.',
      },
      metadata: { chain: 'ethereum', processingTimeMs: 500, estimatedCostUsd: 0, approvalsScanned: 0 },
    });
    expect(output.approvals).toHaveLength(0);
    expect(output.summary.overallRisk).toBe('clean');
  });

  it('accepts all valid risk levels', () => {
    for (const level of ['safe', 'low', 'medium', 'high', 'critical'] as const) {
      const output = approvalScanOutput.parse({
        wallet: { address: '0x' + 'a'.repeat(40), chain: 'ethereum' },
        approvals: [{
          token: { address: '0x' + 'b'.repeat(40), symbol: null, name: null },
          spender: { address: '0x' + 'c'.repeat(40), contractName: null, isVerified: false, label: null },
          allowance: '1000',
          riskLevel: level,
          riskReason: null,
        }],
        summary: { totalApprovals: 1, unlimitedApprovals: 0, riskyApprovals: 0, overallRisk: 'low', recommendation: 'ok' },
        metadata: { chain: 'ethereum', processingTimeMs: 0, estimatedCostUsd: 0, approvalsScanned: 1 },
      });
      expect(output.approvals[0].riskLevel).toBe(level);
    }
  });

  it('accepts all valid overall risk levels', () => {
    for (const level of ['clean', 'low', 'medium', 'high', 'critical'] as const) {
      const output = approvalScanOutput.parse({
        wallet: { address: '0x' + 'a'.repeat(40), chain: 'ethereum' },
        approvals: [],
        summary: { totalApprovals: 0, unlimitedApprovals: 0, riskyApprovals: 0, overallRisk: level, recommendation: 'ok' },
        metadata: { chain: 'ethereum', processingTimeMs: 0, estimatedCostUsd: 0, approvalsScanned: 0 },
      });
      expect(output.summary.overallRisk).toBe(level);
    }
  });

  it('rejects invalid overall risk level', () => {
    expect(() =>
      approvalScanOutput.parse({
        wallet: { address: '0x' + 'a'.repeat(40), chain: 'ethereum' },
        approvals: [],
        summary: { totalApprovals: 0, unlimitedApprovals: 0, riskyApprovals: 0, overallRisk: 'extreme', recommendation: 'ok' },
        metadata: { chain: 'ethereum', processingTimeMs: 0, estimatedCostUsd: 0, approvalsScanned: 0 },
      }),
    ).toThrow();
  });

  it('accepts output with relatedServices', () => {
    const output = approvalScanOutput.parse({
      wallet: { address: '0x' + 'a'.repeat(40), chain: 'ethereum' },
      approvals: [],
      summary: { totalApprovals: 0, unlimitedApprovals: 0, riskyApprovals: 0, overallRisk: 'clean', recommendation: 'ok' },
      relatedServices: [
        { endpoint: '/v1/contract-docs', description: 'Investigate spender', suggestedInput: { address: '0x123' } },
      ],
      metadata: { chain: 'ethereum', processingTimeMs: 0, estimatedCostUsd: 0, approvalsScanned: 0 },
    });
    expect(output.relatedServices).toHaveLength(1);
  });
});
