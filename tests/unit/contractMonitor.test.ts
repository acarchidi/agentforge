import { describe, it, expect } from 'vitest';
import {
  contractMonitorInput,
  contractMonitorOutput,
} from '../../src/schemas/contractMonitor.js';

describe('Contract Monitor Schema Validation', () => {
  // ── Input schema ──────────────────────────────────────────────────

  it('accepts valid input with defaults', () => {
    const result = contractMonitorInput.parse({
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    });
    expect(result.chain).toBe('ethereum');
    expect(result.lookbackHours).toBe(24);
  });

  it('accepts all valid chains', () => {
    for (const chain of [
      'ethereum', 'base', 'polygon', 'arbitrum', 'optimism', 'avalanche',
    ] as const) {
      const result = contractMonitorInput.parse({ address: '0xabc', chain });
      expect(result.chain).toBe(chain);
    }
  });

  it('accepts custom lookbackHours', () => {
    const result = contractMonitorInput.parse({
      address: '0xabc',
      lookbackHours: 72,
    });
    expect(result.lookbackHours).toBe(72);
  });

  it('rejects empty address', () => {
    expect(() => contractMonitorInput.parse({ address: '' })).toThrow();
  });

  it('rejects invalid chain', () => {
    expect(() =>
      contractMonitorInput.parse({ address: '0xabc', chain: 'solana' }),
    ).toThrow();
  });

  it('rejects lookbackHours below 1', () => {
    expect(() =>
      contractMonitorInput.parse({ address: '0xabc', lookbackHours: 0 }),
    ).toThrow();
  });

  it('rejects lookbackHours above 168', () => {
    expect(() =>
      contractMonitorInput.parse({ address: '0xabc', lookbackHours: 169 }),
    ).toThrow();
  });

  // ── Output schema ─────────────────────────────────────────────────

  it('validates minimal output (no admin activity)', () => {
    const output = contractMonitorOutput.parse({
      contract: {
        address: '0xabc',
        chain: 'ethereum',
        name: null,
        isProxy: false,
      },
      recentActivity: {
        transactionCount: 0,
        adminTransactions: [],
        implementationChanged: false,
        ownershipChanged: false,
        pauseStateChanged: false,
      },
      riskAlert: {
        level: 'none',
        alerts: [],
        recommendation: 'No admin activity detected in the lookback period.',
      },
      metadata: {
        lookbackHours: 24,
        processingTimeMs: 500,
        estimatedCostUsd: 0.003,
      },
    });
    expect(output.recentActivity.transactionCount).toBe(0);
    expect(output.riskAlert.level).toBe('none');
  });

  it('validates full output with admin activity', () => {
    const output = contractMonitorOutput.parse({
      contract: {
        address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        chain: 'ethereum',
        name: 'FiatTokenProxy',
        isProxy: true,
      },
      recentActivity: {
        transactionCount: 15,
        adminTransactions: [
          {
            txHash: '0x123abc',
            functionName: 'transferOwnership',
            timestamp: '2025-01-15T12:00:00Z',
            from: '0xowner',
            summary: 'Ownership transferred to new address',
          },
          {
            txHash: '0x456def',
            functionName: 'upgradeTo',
            timestamp: '2025-01-15T11:00:00Z',
            from: '0xadmin',
            summary: 'Implementation upgraded to new version',
          },
        ],
        implementationChanged: true,
        ownershipChanged: true,
        pauseStateChanged: false,
      },
      riskAlert: {
        level: 'critical',
        alerts: [
          'Ownership was transferred within the lookback period',
          'Implementation contract was upgraded',
        ],
        recommendation: 'Verify the new owner and implementation are legitimate before interacting.',
      },
      metadata: {
        lookbackHours: 24,
        processingTimeMs: 2500,
        estimatedCostUsd: 0.005,
      },
    });
    expect(output.recentActivity.adminTransactions).toHaveLength(2);
    expect(output.riskAlert.level).toBe('critical');
    expect(output.recentActivity.implementationChanged).toBe(true);
    expect(output.recentActivity.ownershipChanged).toBe(true);
  });

  it('accepts all valid risk alert levels', () => {
    for (const level of ['none', 'low', 'medium', 'high', 'critical'] as const) {
      const output = contractMonitorOutput.parse({
        contract: { address: '0xabc', chain: 'ethereum', name: null, isProxy: false },
        recentActivity: {
          transactionCount: 0,
          adminTransactions: [],
          implementationChanged: false,
          ownershipChanged: false,
          pauseStateChanged: false,
        },
        riskAlert: { level, alerts: [], recommendation: 'test' },
        metadata: { lookbackHours: 24, processingTimeMs: 0, estimatedCostUsd: 0 },
      });
      expect(output.riskAlert.level).toBe(level);
    }
  });

  it('accepts output with relatedServices', () => {
    const output = contractMonitorOutput.parse({
      contract: { address: '0xabc', chain: 'ethereum', name: null, isProxy: false },
      recentActivity: { transactionCount: 0, adminTransactions: [], implementationChanged: false, ownershipChanged: false, pauseStateChanged: false },
      riskAlert: { level: 'none', alerts: [], recommendation: 'ok' },
      metadata: { lookbackHours: 24, processingTimeMs: 0, estimatedCostUsd: 0 },
      relatedServices: [
        { endpoint: '/v1/contract-docs', description: 'Understand this contract', suggestedInput: { address: '0xabc', chain: 'ethereum' } },
      ],
    });
    expect(output.relatedServices).toHaveLength(1);
  });

  it('rejects invalid risk alert level', () => {
    expect(() =>
      contractMonitorOutput.parse({
        contract: { address: '0xabc', chain: 'ethereum', name: null, isProxy: false },
        recentActivity: {
          transactionCount: 0,
          adminTransactions: [],
          implementationChanged: false,
          ownershipChanged: false,
          pauseStateChanged: false,
        },
        riskAlert: { level: 'extreme', alerts: [], recommendation: 'test' },
        metadata: { lookbackHours: 24, processingTimeMs: 0, estimatedCostUsd: 0 },
      }),
    ).toThrow();
  });
});
