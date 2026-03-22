import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Tests for token risk metrics refresh script logic.
// These test the pure functions extracted for testability.

import {
  detectPermissions,
  scorePermissionRisk,
} from '../../src/services/tokenRiskMetrics/permissions.js';

import {
  parseHolderList,
  computeHolderPct,
} from '../../src/services/tokenRiskMetrics/concentration.js';

import {
  shouldResumeFrom,
  computeStage,
} from '../../src/services/tokenRiskMetrics/refresh.js';

describe('Token risk metrics refresh script', () => {
  describe('ABI permission parsing', () => {
    it('computes permission flags from ABI', () => {
      const abi = [
        { name: 'mint', type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [] },
        { name: 'transfer', type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [] },
        { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [], outputs: [] },
      ];
      const result = detectPermissions(abi);
      expect(result.canMint).toBe(true);
      expect(result.canBurn).toBe(false);
    });

    it('handles empty ABI gracefully', () => {
      const result = detectPermissions([]);
      expect(result.canMint).toBe(false);
      expect(result.canBurn).toBe(false);
      expect(result.canPause).toBe(false);
    });

    it('ignores view functions for mint detection', () => {
      const abi = [
        { name: 'mint', type: 'function', stateMutability: 'view', inputs: [], outputs: [] }, // view = not dangerous
      ];
      const result = detectPermissions(abi);
      expect(result.canMint).toBe(false);
    });
  });

  describe('Holder data parsing', () => {
    it('parses holder list from Etherscan format', () => {
      const etherscanResult = [
        { TokenHolderAddress: '0xabc', TokenHolderQuantity: '1000000' },
        { TokenHolderAddress: '0xdef', TokenHolderQuantity: '500000' },
      ];
      const holders = parseHolderList(etherscanResult);
      expect(holders).toHaveLength(2);
      expect(holders[0].address).toBe('0xabc');
      expect(holders[0].rawBalance).toBe(1_000_000n);
    });

    it('computes holder percentage correctly', () => {
      const totalSupply = 10_000_000n;
      const holderBalance = 1_500_000n;
      const pct = computeHolderPct(holderBalance, totalSupply);
      expect(pct).toBeCloseTo(15.0, 1);
    });

    it('handles zero total supply gracefully', () => {
      const pct = computeHolderPct(1_000n, 0n);
      expect(pct).toBe(0);
    });
  });

  describe('Refresh script stages', () => {
    it('respects --limit flag', () => {
      const addresses = Array.from({ length: 200 }, (_, i) => `0x${i.toString(16).padStart(40, '0')}`);
      const staged = computeStage(addresses, 50, undefined);
      expect(staged).toHaveLength(50);
    });

    it('respects --resume flag', () => {
      const addresses = ['0xaaa', '0xbbb', '0xccc', '0xddd'];
      const resumed = shouldResumeFrom(addresses, '0xccc');
      expect(resumed).toEqual(['0xccc', '0xddd']);
    });

    it('stages: stops at 50 for review when limit=50', () => {
      const addresses = Array.from({ length: 200 }, (_, i) => `0x${i.toString(16).padStart(40, '0')}`);
      const staged = computeStage(addresses, 50, undefined);
      expect(staged.length).toBeLessThanOrEqual(50);
    });

    it('resumes from correct position when address not found', () => {
      const addresses = ['0xaaa', '0xbbb', '0xccc'];
      const resumed = shouldResumeFrom(addresses, '0xzzz'); // not found
      expect(resumed).toEqual(addresses); // returns all if not found
    });
  });
});
