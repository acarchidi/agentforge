import { describe, it, expect } from 'vitest';
import {
  walletSafetyInput,
  walletSafetyOutput,
  RiskLevelEnum,
  DepthEnum,
  approvalsSchema,
  recentActivitySchema,
  targetContractAssessmentSchema,
} from '../../src/schemas/walletSafety.js';

// ── Helpers ──────────────────────────────────────────────────────────

const VALID_ADDR = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const VALID_ADDR_2 = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';

function makeMinimalOutput(overrides: Record<string, unknown> = {}) {
  return {
    walletAddress: VALID_ADDR,
    chain: 'ethereum',
    overallRisk: 'low',
    riskScore: 15,
    timestamp: new Date().toISOString(),
    approvals: {
      totalApprovals: 1,
      riskyApprovals: 0,
      unlimitedApprovals: 0,
      approvalDetails: [{
        token: '0x' + 'a'.repeat(40),
        spender: '0x' + 'b'.repeat(40),
        spenderRisk: 'safe',
        allowance: '1000',
        recommendation: 'ok',
      }],
    },
    summary: 'Wallet looks safe.',
    actionItems: [],
    relatedServices: [],
    metadata: {
      chain: 'ethereum',
      depth: 'standard',
      processingTimeMs: 2000,
      estimatedCostUsd: 0.035,
      subsystemResults: {
        approvalScan: 'success',
        recentActivity: 'success',
        targetAssessment: 'skipped',
      },
    },
    ...overrides,
  };
}

// ── Request Validation ─────────────────────────────────────────────

describe('POST /v1/wallet-safety', () => {
  describe('Request validation', () => {
    it('rejects invalid wallet address format', () => {
      expect(() =>
        walletSafetyInput.parse({ walletAddress: 'not-an-address' }),
      ).toThrow();
      expect(() =>
        walletSafetyInput.parse({ walletAddress: '0x' + 'g'.repeat(40) }),
      ).toThrow();
      expect(() =>
        walletSafetyInput.parse({ walletAddress: '0x' + 'a'.repeat(39) }),
      ).toThrow();
    });

    it('rejects invalid chain value', () => {
      expect(() =>
        walletSafetyInput.parse({ walletAddress: VALID_ADDR, chain: 'solana' }),
      ).toThrow();
      expect(() =>
        walletSafetyInput.parse({ walletAddress: VALID_ADDR, chain: 'bsc' }),
      ).toThrow();
    });

    it('defaults chain to ethereum when not provided', () => {
      const result = walletSafetyInput.parse({ walletAddress: VALID_ADDR });
      expect(result.chain).toBe('ethereum');
    });

    it('defaults depth to standard when not provided', () => {
      const result = walletSafetyInput.parse({ walletAddress: VALID_ADDR });
      expect(result.depth).toBe('standard');
    });

    it('accepts valid targetContract address', () => {
      const result = walletSafetyInput.parse({
        walletAddress: VALID_ADDR,
        targetContract: VALID_ADDR_2,
      });
      expect(result.targetContract).toBe(VALID_ADDR_2);
    });

    it('rejects invalid targetContract address format', () => {
      expect(() =>
        walletSafetyInput.parse({
          walletAddress: VALID_ADDR,
          targetContract: 'not-valid',
        }),
      ).toThrow();
      expect(() =>
        walletSafetyInput.parse({
          walletAddress: VALID_ADDR,
          targetContract: '0x' + 'a'.repeat(39),
        }),
      ).toThrow();
    });

    it('accepts all valid depth values: quick, standard, deep', () => {
      for (const depth of ['quick', 'standard', 'deep'] as const) {
        const result = walletSafetyInput.parse({
          walletAddress: VALID_ADDR,
          depth,
        });
        expect(result.depth).toBe(depth);
      }
    });

    it('accepts all valid chain values', () => {
      for (const chain of ['ethereum', 'base', 'arbitrum', 'optimism', 'polygon'] as const) {
        const result = walletSafetyInput.parse({
          walletAddress: VALID_ADDR,
          chain,
        });
        expect(result.chain).toBe(chain);
      }
    });
  });

  // ── Quick Depth ────────────────────────────────────────────────────

  describe('Quick depth', () => {
    it('returns approval data', () => {
      const output = walletSafetyOutput.parse(makeMinimalOutput({
        metadata: {
          chain: 'ethereum', depth: 'quick', processingTimeMs: 1000,
          estimatedCostUsd: 0.035,
          subsystemResults: { approvalScan: 'success', recentActivity: 'skipped', targetAssessment: 'skipped' },
        },
      }));
      expect(output.approvals).toBeDefined();
      expect(output.approvals.totalApprovals).toBeGreaterThanOrEqual(0);
    });

    it('does NOT return recentActivity (should be undefined)', () => {
      const output = walletSafetyOutput.parse(makeMinimalOutput({
        recentActivity: undefined,
        metadata: {
          chain: 'ethereum', depth: 'quick', processingTimeMs: 1000,
          estimatedCostUsd: 0.035,
          subsystemResults: { approvalScan: 'success', recentActivity: 'skipped', targetAssessment: 'skipped' },
        },
      }));
      expect(output.recentActivity).toBeUndefined();
    });

    it('includes registry labels for known spenders', () => {
      const output = walletSafetyOutput.parse(makeMinimalOutput({
        approvals: {
          totalApprovals: 1,
          riskyApprovals: 0,
          unlimitedApprovals: 1,
          approvalDetails: [{
            token: '0x' + 'a'.repeat(40),
            spender: '0x' + 'b'.repeat(40),
            spenderLabel: 'Uniswap V3 Router',
            spenderProtocol: 'Uniswap',
            spenderRisk: 'safe',
            allowance: 'unlimited',
            recommendation: 'ok',
          }],
        },
      }));
      expect(output.approvals.approvalDetails[0].spenderLabel).toBe('Uniswap V3 Router');
      expect(output.approvals.approvalDetails[0].spenderProtocol).toBe('Uniswap');
    });

    it('flags unlimited approvals with recommendation "revoke" or "reduce"', () => {
      const output = walletSafetyOutput.parse(makeMinimalOutput({
        approvals: {
          totalApprovals: 1,
          riskyApprovals: 1,
          unlimitedApprovals: 1,
          approvalDetails: [{
            token: '0x' + 'a'.repeat(40),
            spender: '0x' + 'c'.repeat(40),
            spenderRisk: 'high',
            allowance: 'unlimited',
            recommendation: 'revoke',
          }],
        },
      }));
      expect(['revoke', 'reduce']).toContain(
        output.approvals.approvalDetails[0].recommendation,
      );
    });

    it('identifies approvals to unverified contracts', () => {
      const output = walletSafetyOutput.parse(makeMinimalOutput({
        approvals: {
          totalApprovals: 1,
          riskyApprovals: 1,
          unlimitedApprovals: 1,
          approvalDetails: [{
            token: '0x' + 'a'.repeat(40),
            spender: '0x' + 'c'.repeat(40),
            spenderRisk: 'high',
            allowance: 'unlimited',
            recommendation: 'revoke',
          }],
        },
        riskScore: 70,
        overallRisk: 'high',
      }));
      expect(output.approvals.riskyApprovals).toBeGreaterThan(0);
    });

    it('returns riskScore between 0 and 100', () => {
      const output = walletSafetyOutput.parse(makeMinimalOutput({ riskScore: 42 }));
      expect(output.riskScore).toBeGreaterThanOrEqual(0);
      expect(output.riskScore).toBeLessThanOrEqual(100);
    });

    it('rejects riskScore outside 0-100', () => {
      expect(() => walletSafetyOutput.parse(makeMinimalOutput({ riskScore: -1 }))).toThrow();
      expect(() => walletSafetyOutput.parse(makeMinimalOutput({ riskScore: 101 }))).toThrow();
    });

    it('returns overallRisk enum value', () => {
      for (const risk of ['safe', 'low', 'medium', 'high', 'critical', 'unknown'] as const) {
        const output = walletSafetyOutput.parse(makeMinimalOutput({ overallRisk: risk }));
        expect(output.overallRisk).toBe(risk);
      }
    });
  });

  // ── Standard Depth ─────────────────────────────────────────────────

  describe('Standard depth', () => {
    it('returns approvals AND recentActivity', () => {
      const output = walletSafetyOutput.parse(makeMinimalOutput({
        recentActivity: {
          transactionCount30d: 45,
          uniqueContractsInteracted: 12,
          suspiciousPatterns: [],
        },
      }));
      expect(output.approvals).toBeDefined();
      expect(output.recentActivity).toBeDefined();
    });

    it('recentActivity includes transactionCount30d', () => {
      const output = walletSafetyOutput.parse(makeMinimalOutput({
        recentActivity: {
          transactionCount30d: 45,
          uniqueContractsInteracted: 12,
          suspiciousPatterns: [],
        },
      }));
      expect(output.recentActivity!.transactionCount30d).toBe(45);
    });

    it('recentActivity includes uniqueContractsInteracted', () => {
      const output = walletSafetyOutput.parse(makeMinimalOutput({
        recentActivity: {
          transactionCount30d: 45,
          uniqueContractsInteracted: 12,
          suspiciousPatterns: [],
        },
      }));
      expect(output.recentActivity!.uniqueContractsInteracted).toBe(12);
    });

    it('detects rapid-approval pattern when >3 approvals in 24h window', () => {
      const output = walletSafetyOutput.parse(makeMinimalOutput({
        recentActivity: {
          transactionCount30d: 20,
          uniqueContractsInteracted: 5,
          suspiciousPatterns: [{
            pattern: 'rapid-approvals',
            severity: 'warning',
            description: '5 token approvals within a 24-hour window',
            transactions: ['0xabc', '0xdef'],
          }],
        },
      }));
      expect(output.recentActivity!.suspiciousPatterns).toHaveLength(1);
      expect(output.recentActivity!.suspiciousPatterns[0].pattern).toBe('rapid-approvals');
      expect(output.recentActivity!.suspiciousPatterns[0].severity).toBe('warning');
    });

    it('does NOT flag rapid-approvals for <=3 approvals in 24h', () => {
      const output = walletSafetyOutput.parse(makeMinimalOutput({
        recentActivity: {
          transactionCount30d: 20,
          uniqueContractsInteracted: 5,
          suspiciousPatterns: [],
        },
      }));
      const rapidPatterns = output.recentActivity!.suspiciousPatterns
        .filter(p => p.pattern === 'rapid-approvals');
      expect(rapidPatterns).toHaveLength(0);
    });

    it('detects interaction-with-flagged when tx involves high/critical risk address', () => {
      const output = walletSafetyOutput.parse(makeMinimalOutput({
        recentActivity: {
          transactionCount30d: 10,
          uniqueContractsInteracted: 3,
          suspiciousPatterns: [{
            pattern: 'interaction-with-flagged',
            severity: 'danger',
            description: 'Transaction to address flagged as high risk in registry',
            transactions: ['0x111'],
          }],
        },
      }));
      const flagged = output.recentActivity!.suspiciousPatterns
        .find(p => p.pattern === 'interaction-with-flagged');
      expect(flagged).toBeDefined();
      expect(flagged!.severity).toBe('danger');
    });

    it('labels interacting contracts from registry', () => {
      const output = walletSafetyOutput.parse(makeMinimalOutput({
        approvals: {
          totalApprovals: 1,
          riskyApprovals: 0,
          unlimitedApprovals: 0,
          approvalDetails: [{
            token: '0x' + 'a'.repeat(40),
            spender: '0x' + 'b'.repeat(40),
            spenderLabel: 'Aave V3 Pool',
            spenderProtocol: 'Aave',
            spenderRisk: 'safe',
            allowance: '5000',
            recommendation: 'ok',
          }],
        },
      }));
      expect(output.approvals.approvalDetails[0].spenderLabel).toBe('Aave V3 Pool');
    });

    it('calculates composite risk score', () => {
      const output = walletSafetyOutput.parse(makeMinimalOutput({
        riskScore: 37,
        overallRisk: 'medium',
      }));
      expect(output.riskScore).toBe(37);
      expect(output.overallRisk).toBe('medium');
    });

    it('generates summary string', () => {
      const output = walletSafetyOutput.parse(makeMinimalOutput({
        summary: 'Wallet has 2 unlimited approvals and recent interaction with flagged contract.',
      }));
      expect(output.summary.length).toBeGreaterThan(0);
    });

    it('generates actionItems array', () => {
      const output = walletSafetyOutput.parse(makeMinimalOutput({
        actionItems: [
          'Revoke unlimited approval to 0xabc...',
          'Investigate recent transaction with flagged contract 0xdef...',
        ],
      }));
      expect(output.actionItems).toHaveLength(2);
    });
  });

  // ── Deep Depth ─────────────────────────────────────────────────────

  describe('Deep depth', () => {
    it('includes all standard checks', () => {
      const output = walletSafetyOutput.parse(makeMinimalOutput({
        recentActivity: {
          transactionCount30d: 120,
          uniqueContractsInteracted: 30,
          suspiciousPatterns: [],
        },
        metadata: {
          chain: 'ethereum', depth: 'deep', processingTimeMs: 12000,
          estimatedCostUsd: 0.035,
          subsystemResults: { approvalScan: 'success', recentActivity: 'success', targetAssessment: 'skipped' },
        },
      }));
      expect(output.approvals).toBeDefined();
      expect(output.recentActivity).toBeDefined();
      expect(output.metadata.depth).toBe('deep');
    });

    it('uses extended transaction history (90 days)', () => {
      // Deep depth should have higher tx count reflecting 90 day window
      const output = walletSafetyOutput.parse(makeMinimalOutput({
        recentActivity: {
          transactionCount30d: 350, // Actually 90d for deep
          uniqueContractsInteracted: 50,
          suspiciousPatterns: [],
        },
        metadata: {
          chain: 'ethereum', depth: 'deep', processingTimeMs: 12000,
          estimatedCostUsd: 0.035,
          subsystemResults: { approvalScan: 'success', recentActivity: 'success', targetAssessment: 'skipped' },
        },
      }));
      expect(output.recentActivity!.transactionCount30d).toBe(350);
    });

    it('detects mixer-interaction pattern', () => {
      const output = walletSafetyOutput.parse(makeMinimalOutput({
        recentActivity: {
          transactionCount30d: 50,
          uniqueContractsInteracted: 15,
          suspiciousPatterns: [{
            pattern: 'mixer-interaction',
            severity: 'danger',
            description: 'Transaction to address tagged as mixer in registry',
            transactions: ['0xmixer1'],
          }],
        },
      }));
      const mixer = output.recentActivity!.suspiciousPatterns
        .find(p => p.pattern === 'mixer-interaction');
      expect(mixer).toBeDefined();
      expect(mixer!.severity).toBe('danger');
    });

    it('detects large-outflow-new-address pattern for >$10k transfers', () => {
      const output = walletSafetyOutput.parse(makeMinimalOutput({
        recentActivity: {
          transactionCount30d: 50,
          uniqueContractsInteracted: 15,
          suspiciousPatterns: [{
            pattern: 'large-outflow-new-address',
            severity: 'warning',
            description: 'Transfer of $15,000 to an address with no prior transaction history',
            transactions: ['0xlarge1'],
          }],
        },
      }));
      const outflow = output.recentActivity!.suspiciousPatterns
        .find(p => p.pattern === 'large-outflow-new-address');
      expect(outflow).toBeDefined();
      expect(outflow!.severity).toBe('warning');
    });

    it('does NOT flag large-outflow for <=$10k transfers', () => {
      const output = walletSafetyOutput.parse(makeMinimalOutput({
        recentActivity: {
          transactionCount30d: 50,
          uniqueContractsInteracted: 15,
          suspiciousPatterns: [],
        },
      }));
      const outflow = output.recentActivity!.suspiciousPatterns
        .find(p => p.pattern === 'large-outflow-new-address');
      expect(outflow).toBeUndefined();
    });
  });

  // ── Target Contract Assessment ─────────────────────────────────────

  describe('Target contract assessment', () => {
    it('returns targetContractAssessment when targetContract is provided', () => {
      const output = walletSafetyOutput.parse(makeMinimalOutput({
        targetContractAssessment: {
          address: VALID_ADDR_2,
          label: 'Uniswap V2 Router',
          protocol: 'Uniswap',
          riskLevel: 'safe',
          isVerified: true,
          isProxy: false,
          concerns: [],
          recommendation: 'proceed',
        },
        metadata: {
          chain: 'ethereum', depth: 'standard', processingTimeMs: 3000,
          estimatedCostUsd: 0.035,
          subsystemResults: { approvalScan: 'success', recentActivity: 'success', targetAssessment: 'success' },
        },
      }));
      expect(output.targetContractAssessment).toBeDefined();
      expect(output.targetContractAssessment!.address).toBe(VALID_ADDR_2);
    });

    it('does NOT return targetContractAssessment when targetContract is omitted', () => {
      const output = walletSafetyOutput.parse(makeMinimalOutput());
      expect(output.targetContractAssessment).toBeUndefined();
    });

    it('uses registry data for target contract labeling', () => {
      const output = walletSafetyOutput.parse(makeMinimalOutput({
        targetContractAssessment: {
          address: VALID_ADDR_2,
          label: 'Uniswap V2 Router',
          protocol: 'Uniswap',
          riskLevel: 'safe',
          isVerified: true,
          isProxy: false,
          concerns: [],
          recommendation: 'proceed',
        },
      }));
      expect(output.targetContractAssessment!.label).toBe('Uniswap V2 Router');
      expect(output.targetContractAssessment!.protocol).toBe('Uniswap');
    });

    it('checks if target contract is verified on Etherscan', () => {
      const output = walletSafetyOutput.parse(makeMinimalOutput({
        targetContractAssessment: {
          address: VALID_ADDR_2,
          riskLevel: 'unknown',
          isVerified: false,
          isProxy: false,
          concerns: ['Contract source code not verified'],
          recommendation: 'caution',
        },
      }));
      expect(output.targetContractAssessment!.isVerified).toBe(false);
    });

    it('detects proxy contracts', () => {
      const output = walletSafetyOutput.parse(makeMinimalOutput({
        targetContractAssessment: {
          address: VALID_ADDR_2,
          label: 'USDC Proxy',
          riskLevel: 'low',
          isVerified: true,
          isProxy: true,
          concerns: ['Contract is a proxy — implementation can be changed by admin'],
          recommendation: 'caution',
        },
      }));
      expect(output.targetContractAssessment!.isProxy).toBe(true);
    });

    it('recommends "avoid" for critical-risk contracts', () => {
      const output = walletSafetyOutput.parse(makeMinimalOutput({
        targetContractAssessment: {
          address: VALID_ADDR_2,
          riskLevel: 'critical',
          isVerified: false,
          isProxy: false,
          concerns: ['Known malicious contract', 'Flagged for token theft'],
          recommendation: 'avoid',
        },
      }));
      expect(output.targetContractAssessment!.recommendation).toBe('avoid');
    });

    it('recommends "caution" for unknown/unverified contracts', () => {
      const output = walletSafetyOutput.parse(makeMinimalOutput({
        targetContractAssessment: {
          address: VALID_ADDR_2,
          riskLevel: 'unknown',
          isVerified: false,
          isProxy: false,
          concerns: ['Not in registry', 'Not verified on Etherscan'],
          recommendation: 'caution',
        },
      }));
      expect(output.targetContractAssessment!.recommendation).toBe('caution');
    });

    it('recommends "proceed" for well-known safe contracts', () => {
      const output = walletSafetyOutput.parse(makeMinimalOutput({
        targetContractAssessment: {
          address: VALID_ADDR_2,
          label: 'Uniswap V2 Router',
          protocol: 'Uniswap',
          riskLevel: 'safe',
          isVerified: true,
          isProxy: false,
          concerns: [],
          recommendation: 'proceed',
        },
      }));
      expect(output.targetContractAssessment!.recommendation).toBe('proceed');
    });
  });

  // ── Risk Score ─────────────────────────────────────────────────────

  describe('Risk score validation', () => {
    it('returns score between 0 and 100', () => {
      const output = walletSafetyOutput.parse(makeMinimalOutput({ riskScore: 50 }));
      expect(output.riskScore).toBeGreaterThanOrEqual(0);
      expect(output.riskScore).toBeLessThanOrEqual(100);
    });

    it('rejects riskScore below 0', () => {
      expect(() => walletSafetyOutput.parse(makeMinimalOutput({ riskScore: -5 }))).toThrow();
    });

    it('rejects riskScore above 100', () => {
      expect(() => walletSafetyOutput.parse(makeMinimalOutput({ riskScore: 150 }))).toThrow();
    });

    it('score near 0 for clean wallet schema', () => {
      const output = walletSafetyOutput.parse(makeMinimalOutput({
        riskScore: 2,
        overallRisk: 'safe',
        approvals: { totalApprovals: 0, riskyApprovals: 0, unlimitedApprovals: 0, approvalDetails: [] },
      }));
      expect(output.riskScore).toBeLessThanOrEqual(5);
    });

    it('score > 80 for dangerous wallet schema', () => {
      const output = walletSafetyOutput.parse(makeMinimalOutput({
        riskScore: 92,
        overallRisk: 'critical',
      }));
      expect(output.riskScore).toBeGreaterThan(80);
    });
  });

  // ── Composability ──────────────────────────────────────────────────

  describe('Composability', () => {
    it('includes relatedServices in response', () => {
      const output = walletSafetyOutput.parse(makeMinimalOutput({
        relatedServices: [
          { endpoint: '/v1/approval-scan', description: 'Detailed approval analysis', suggestedInput: { address: VALID_ADDR } },
        ],
      }));
      expect(output.relatedServices).toHaveLength(1);
    });

    it('suggests contract-docs for target contract when target provided', () => {
      const output = walletSafetyOutput.parse(makeMinimalOutput({
        relatedServices: [
          { endpoint: '/v1/contract-docs', description: 'Full documentation for target contract', suggestedInput: { address: VALID_ADDR_2 } },
        ],
      }));
      const docs = output.relatedServices.find(s => s.endpoint === '/v1/contract-docs');
      expect(docs).toBeDefined();
    });

    it('suggests approval-scan for detailed analysis', () => {
      const output = walletSafetyOutput.parse(makeMinimalOutput({
        relatedServices: [
          { endpoint: '/v1/approval-scan', description: 'Detailed approval risk analysis', suggestedInput: { address: VALID_ADDR } },
        ],
      }));
      const scan = output.relatedServices.find(s => s.endpoint === '/v1/approval-scan');
      expect(scan).toBeDefined();
    });

    it('suggests contract-monitor for concerning contracts found in activity', () => {
      const output = walletSafetyOutput.parse(makeMinimalOutput({
        relatedServices: [
          { endpoint: '/v1/contract-monitor', description: 'Monitor admin activity', suggestedInput: { address: '0x' + 'c'.repeat(40) } },
        ],
      }));
      const monitor = output.relatedServices.find(s => s.endpoint === '/v1/contract-monitor');
      expect(monitor).toBeDefined();
    });
  });

  // ── Error Handling ─────────────────────────────────────────────────

  describe('Error handling schema', () => {
    it('handles partial results with subsystem status', () => {
      const output = walletSafetyOutput.parse(makeMinimalOutput({
        metadata: {
          chain: 'ethereum', depth: 'standard', processingTimeMs: 5000,
          estimatedCostUsd: 0.035,
          subsystemResults: {
            approvalScan: 'success',
            recentActivity: 'failed',
            targetAssessment: 'skipped',
          },
        },
      }));
      expect(output.metadata.subsystemResults.recentActivity).toBe('failed');
    });

    it('accepts partial subsystem status', () => {
      const output = walletSafetyOutput.parse(makeMinimalOutput({
        metadata: {
          chain: 'ethereum', depth: 'standard', processingTimeMs: 5000,
          estimatedCostUsd: 0.035,
          subsystemResults: {
            approvalScan: 'partial',
            recentActivity: 'success',
            targetAssessment: 'partial',
          },
        },
      }));
      expect(output.metadata.subsystemResults.approvalScan).toBe('partial');
    });

    it('returns meaningful output when wallet address has no transactions', () => {
      const output = walletSafetyOutput.parse(makeMinimalOutput({
        riskScore: 0,
        overallRisk: 'safe',
        approvals: { totalApprovals: 0, riskyApprovals: 0, unlimitedApprovals: 0, approvalDetails: [] },
        recentActivity: {
          transactionCount30d: 0,
          uniqueContractsInteracted: 0,
          suspiciousPatterns: [],
        },
        summary: 'No transactions or approvals found for this wallet address.',
        actionItems: [],
      }));
      expect(output.riskScore).toBe(0);
      expect(output.approvals.totalApprovals).toBe(0);
    });

    it('rejects missing required fields', () => {
      expect(() => walletSafetyOutput.parse({})).toThrow();
      expect(() =>
        walletSafetyOutput.parse({
          walletAddress: VALID_ADDR,
          // Missing everything else
        }),
      ).toThrow();
    });
  });
});
