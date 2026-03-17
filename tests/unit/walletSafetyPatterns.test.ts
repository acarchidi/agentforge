import { describe, it, expect } from 'vitest';
import {
  detectRapidApprovals,
  detectInteractionWithFlagged,
  detectUnverifiedContractApproval,
  detectMixerInteraction,
  detectLargeOutflowNewAddress,
  detectApprovalToEOA,
  detectPhishingSignature,
} from '../../src/services/walletSafety/patterns.js';
import type { PatternMatch } from '../../src/schemas/walletSafety.js';

// ── Test Helpers ─────────────────────────────────────────────────────

/** Helper to create a minimal transaction record */
function makeTx(overrides: Record<string, unknown> = {}) {
  return {
    hash: '0x' + 'a'.repeat(64),
    from: '0x' + '1'.repeat(40),
    to: '0x' + '2'.repeat(40),
    value: '0',
    timestamp: Math.floor(Date.now() / 1000),
    functionName: '',
    isError: '0',
    ...overrides,
  };
}

/** Helper to create an approval record */
function makeApproval(overrides: Record<string, unknown> = {}) {
  return {
    hash: '0x' + 'b'.repeat(64),
    token: '0x' + 'a'.repeat(40),
    spender: '0x' + '2'.repeat(40),
    allowance: 'unlimited',
    timestamp: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

/** Registry entry helper */
function makeRegistryEntry(overrides: Record<string, unknown> = {}) {
  return {
    address: '0x' + '2'.repeat(40),
    name: 'Unknown',
    chain: 'ethereum',
    riskLevel: 'unknown',
    category: 'unknown',
    ...overrides,
  };
}

const NOW = Math.floor(Date.now() / 1000);
const ONE_HOUR = 3600;
const ONE_DAY = 86400;

// ── Pattern Tests ────────────────────────────────────────────────────

describe('Suspicious pattern detection', () => {

  // ── rapid-approvals ────────────────────────────────────────────────

  describe('rapid-approvals', () => {
    it('triggers for >3 approvals in 24h', () => {
      const approvals = [
        makeApproval({ timestamp: NOW - ONE_HOUR * 1, hash: '0x01' }),
        makeApproval({ timestamp: NOW - ONE_HOUR * 2, hash: '0x02' }),
        makeApproval({ timestamp: NOW - ONE_HOUR * 3, hash: '0x03' }),
        makeApproval({ timestamp: NOW - ONE_HOUR * 4, hash: '0x04' }),
      ];
      const result = detectRapidApprovals(approvals);
      expect(result).not.toBeNull();
      expect(result!.pattern).toBe('rapid-approvals');
      expect(result!.severity).toBe('warning');
    });

    it('does NOT trigger for <=3 approvals in 24h', () => {
      const approvals = [
        makeApproval({ timestamp: NOW - ONE_HOUR * 1, hash: '0x01' }),
        makeApproval({ timestamp: NOW - ONE_HOUR * 5, hash: '0x02' }),
        makeApproval({ timestamp: NOW - ONE_HOUR * 10, hash: '0x03' }),
      ];
      const result = detectRapidApprovals(approvals);
      expect(result).toBeNull();
    });

    it('correctly windows across 30 days of data', () => {
      // 2 approvals early in month, 4 approvals late — should trigger on the cluster of 4
      const approvals = [
        makeApproval({ timestamp: NOW - ONE_DAY * 25, hash: '0x01' }),
        makeApproval({ timestamp: NOW - ONE_DAY * 24, hash: '0x02' }),
        // Gap
        makeApproval({ timestamp: NOW - ONE_HOUR * 2, hash: '0x03' }),
        makeApproval({ timestamp: NOW - ONE_HOUR * 3, hash: '0x04' }),
        makeApproval({ timestamp: NOW - ONE_HOUR * 4, hash: '0x05' }),
        makeApproval({ timestamp: NOW - ONE_HOUR * 5, hash: '0x06' }),
      ];
      const result = detectRapidApprovals(approvals);
      expect(result).not.toBeNull();
      expect(result!.pattern).toBe('rapid-approvals');
    });
  });

  // ── interaction-with-flagged ───────────────────────────────────────

  describe('interaction-with-flagged', () => {
    it('triggers for high risk registry match', () => {
      const txs = [makeTx({ to: '0x' + 'f'.repeat(40), hash: '0xbad1' })];
      const registry = [makeRegistryEntry({ address: '0x' + 'f'.repeat(40), riskLevel: 'high' })];
      const result = detectInteractionWithFlagged(txs, registry);
      expect(result).not.toBeNull();
      expect(result!.pattern).toBe('interaction-with-flagged');
      expect(result!.severity).toBe('danger');
    });

    it('triggers for critical risk registry match', () => {
      const txs = [makeTx({ to: '0x' + 'f'.repeat(40), hash: '0xbad2' })];
      const registry = [makeRegistryEntry({ address: '0x' + 'f'.repeat(40), riskLevel: 'critical' })];
      const result = detectInteractionWithFlagged(txs, registry);
      expect(result).not.toBeNull();
      expect(result!.severity).toBe('danger');
    });

    it('does NOT trigger for medium/low/safe', () => {
      for (const risk of ['medium', 'low', 'safe'] as const) {
        const txs = [makeTx({ to: '0x' + 'f'.repeat(40) })];
        const registry = [makeRegistryEntry({ address: '0x' + 'f'.repeat(40), riskLevel: risk })];
        const result = detectInteractionWithFlagged(txs, registry);
        expect(result).toBeNull();
      }
    });
  });

  // ── unverified-contract-approval ───────────────────────────────────

  describe('unverified-contract-approval', () => {
    it('triggers for approval to unverified contract', () => {
      const approvals = [makeApproval({ spender: '0x' + 'c'.repeat(40) })];
      const verifiedSet = new Set<string>(); // empty = none verified
      const result = detectUnverifiedContractApproval(approvals, verifiedSet);
      expect(result).not.toBeNull();
      expect(result!.pattern).toBe('unverified-contract-approval');
      expect(result!.severity).toBe('warning');
    });

    it('does NOT trigger for verified contracts', () => {
      const spender = '0x' + 'c'.repeat(40);
      const approvals = [makeApproval({ spender })];
      const verifiedSet = new Set([spender.toLowerCase()]);
      const result = detectUnverifiedContractApproval(approvals, verifiedSet);
      expect(result).toBeNull();
    });
  });

  // ── mixer-interaction ──────────────────────────────────────────────

  describe('mixer-interaction', () => {
    it('triggers for address tagged "mixer" in registry', () => {
      const txs = [makeTx({ to: '0x' + 'd'.repeat(40), hash: '0xmix1' })];
      const registry = [makeRegistryEntry({
        address: '0x' + 'd'.repeat(40),
        tags: ['mixer'],
        category: 'unknown',
      })];
      const result = detectMixerInteraction(txs, registry);
      expect(result).not.toBeNull();
      expect(result!.pattern).toBe('mixer-interaction');
      expect(result!.severity).toBe('danger');
    });

    it('does NOT trigger for non-mixer addresses', () => {
      const txs = [makeTx({ to: '0x' + 'd'.repeat(40) })];
      const registry = [makeRegistryEntry({
        address: '0x' + 'd'.repeat(40),
        tags: ['dex', 'amm'],
      })];
      const result = detectMixerInteraction(txs, registry);
      expect(result).toBeNull();
    });
  });

  // ── large-outflow-new-address ──────────────────────────────────────

  describe('large-outflow-new-address', () => {
    it('triggers above $10k threshold', () => {
      const walletAddress = '0x' + '1'.repeat(40);
      const txs = [
        makeTx({
          from: walletAddress,
          to: '0x' + 'e'.repeat(40),
          value: '15000000000000000000', // ~15 ETH
          hash: '0xlarge1',
        }),
      ];
      // No prior interaction with 0xeee...
      const priorInteractions = new Set<string>();
      const ethPriceUsd = 2000;
      const result = detectLargeOutflowNewAddress(txs, walletAddress, priorInteractions, ethPriceUsd);
      expect(result).not.toBeNull();
      expect(result!.pattern).toBe('large-outflow-new-address');
      expect(result!.severity).toBe('warning');
    });

    it('does NOT trigger at or below $10k', () => {
      const walletAddress = '0x' + '1'.repeat(40);
      const txs = [
        makeTx({
          from: walletAddress,
          to: '0x' + 'e'.repeat(40),
          value: '5000000000000000000', // ~5 ETH
          hash: '0xsmall1',
        }),
      ];
      const priorInteractions = new Set<string>();
      const ethPriceUsd = 2000;
      const result = detectLargeOutflowNewAddress(txs, walletAddress, priorInteractions, ethPriceUsd);
      expect(result).toBeNull();
    });

    it('does NOT trigger if address has prior interactions', () => {
      const walletAddress = '0x' + '1'.repeat(40);
      const target = '0x' + 'e'.repeat(40);
      const txs = [
        makeTx({
          from: walletAddress,
          to: target,
          value: '15000000000000000000',
          hash: '0xlarge2',
        }),
      ];
      const priorInteractions = new Set([target.toLowerCase()]);
      const ethPriceUsd = 2000;
      const result = detectLargeOutflowNewAddress(txs, walletAddress, priorInteractions, ethPriceUsd);
      expect(result).toBeNull();
    });
  });

  // ── approval-to-eoa ────────────────────────────────────────────────

  describe('approval-to-eoa', () => {
    it('triggers when approval spender is EOA', () => {
      const approvals = [makeApproval({ spender: '0x' + '5'.repeat(40) })];
      const contractAddresses = new Set<string>(); // empty = all are EOAs
      const result = detectApprovalToEOA(approvals, contractAddresses);
      expect(result).not.toBeNull();
      expect(result!.pattern).toBe('approval-to-eoa');
      expect(result!.severity).toBe('danger');
    });

    it('does NOT trigger when spender is a contract', () => {
      const spender = '0x' + '5'.repeat(40);
      const approvals = [makeApproval({ spender })];
      const contractAddresses = new Set([spender.toLowerCase()]);
      const result = detectApprovalToEOA(approvals, contractAddresses);
      expect(result).toBeNull();
    });
  });

  // ── phishing-signature ─────────────────────────────────────────────

  describe('phishing-signature', () => {
    it('triggers for permit to address not in registry with <30 days age', () => {
      const permits = [{
        hash: '0xpermit1',
        spender: '0x' + '7'.repeat(40),
        timestamp: NOW,
      }];
      const registryAddresses = new Set<string>(); // not in registry
      const deploymentAges: Map<string, number> = new Map([
        [('0x' + '7'.repeat(40)).toLowerCase(), 10], // 10 days old
      ]);
      const result = detectPhishingSignature(permits, registryAddresses, deploymentAges);
      expect(result).not.toBeNull();
      expect(result!.pattern).toBe('phishing-signature');
      expect(result!.severity).toBe('danger');
    });

    it('does NOT trigger for permit to well-known registry address', () => {
      const spender = '0x' + '7'.repeat(40);
      const permits = [{ hash: '0xpermit2', spender, timestamp: NOW }];
      const registryAddresses = new Set([spender.toLowerCase()]);
      const deploymentAges: Map<string, number> = new Map();
      const result = detectPhishingSignature(permits, registryAddresses, deploymentAges);
      expect(result).toBeNull();
    });
  });

  // ── Cross-cutting ──────────────────────────────────────────────────

  describe('Cross-cutting', () => {
    it('all patterns return correct severity levels', () => {
      // rapid-approvals = warning
      const rapid = detectRapidApprovals([
        makeApproval({ timestamp: NOW, hash: '0x01' }),
        makeApproval({ timestamp: NOW - 100, hash: '0x02' }),
        makeApproval({ timestamp: NOW - 200, hash: '0x03' }),
        makeApproval({ timestamp: NOW - 300, hash: '0x04' }),
      ]);
      expect(rapid?.severity).toBe('warning');

      // interaction-with-flagged = danger
      const flagged = detectInteractionWithFlagged(
        [makeTx({ to: '0x' + 'f'.repeat(40), hash: '0xf1' })],
        [makeRegistryEntry({ address: '0x' + 'f'.repeat(40), riskLevel: 'critical' })],
      );
      expect(flagged?.severity).toBe('danger');

      // unverified-contract-approval = warning
      const unverified = detectUnverifiedContractApproval(
        [makeApproval({ spender: '0x' + 'c'.repeat(40) })],
        new Set(),
      );
      expect(unverified?.severity).toBe('warning');

      // approval-to-eoa = danger
      const eoa = detectApprovalToEOA(
        [makeApproval({ spender: '0x' + '5'.repeat(40) })],
        new Set(),
      );
      expect(eoa?.severity).toBe('danger');
    });

    it('all patterns include relevant transaction hashes when available', () => {
      const rapid = detectRapidApprovals([
        makeApproval({ timestamp: NOW, hash: '0xh1' }),
        makeApproval({ timestamp: NOW - 100, hash: '0xh2' }),
        makeApproval({ timestamp: NOW - 200, hash: '0xh3' }),
        makeApproval({ timestamp: NOW - 300, hash: '0xh4' }),
      ]);
      expect(rapid?.transactions).toBeDefined();
      expect(rapid!.transactions!.length).toBeGreaterThan(0);

      const flagged = detectInteractionWithFlagged(
        [makeTx({ to: '0x' + 'f'.repeat(40), hash: '0xflagged1' })],
        [makeRegistryEntry({ address: '0x' + 'f'.repeat(40), riskLevel: 'high' })],
      );
      expect(flagged?.transactions).toBeDefined();
      expect(flagged!.transactions).toContain('0xflagged1');
    });
  });
});
