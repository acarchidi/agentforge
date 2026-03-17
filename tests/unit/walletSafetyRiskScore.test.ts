import { describe, it, expect } from 'vitest';
import {
  calculateRiskScore,
  calculateApprovalRisk,
  calculateActivityRisk,
  calculateTargetRisk,
  riskScoreToLevel,
} from '../../src/services/walletSafety/riskScore.js';

describe('Risk score calculation', () => {

  // ── Composite score ────────────────────────────────────────────────

  describe('calculateRiskScore', () => {
    it('returns 0 for zero-risk inputs', () => {
      const score = calculateRiskScore(0, 0, null);
      expect(score).toBe(0);
    });

    it('returns 100 for maximum-risk inputs', () => {
      const score = calculateRiskScore(100, 100, 100);
      expect(score).toBe(100);
    });

    it('caps at 100 even with inputs that would sum higher', () => {
      // This shouldn't happen since inputs are 0-100, but verify capping
      const score = calculateRiskScore(100, 100, null);
      expect(score).toBeLessThanOrEqual(100);
    });

    it('correctly applies 55/45 weighting without target', () => {
      // approvalRisk=100, activityRisk=0 → 100*0.55 + 0*0.45 = 55
      const score = calculateRiskScore(100, 0, null);
      expect(score).toBe(55);

      // approvalRisk=0, activityRisk=100 → 0*0.55 + 100*0.45 = 45
      const score2 = calculateRiskScore(0, 100, null);
      expect(score2).toBe(45);
    });

    it('correctly applies 35/30/35 weighting with target', () => {
      // approvalRisk=100, activityRisk=0, targetRisk=0 → 100*0.35 + 0*0.30 + 0*0.35 = 35
      const score = calculateRiskScore(100, 0, 0);
      expect(score).toBe(35);

      // approvalRisk=0, activityRisk=100, targetRisk=0 → 0*0.35 + 100*0.30 + 0*0.35 = 30
      const score2 = calculateRiskScore(0, 100, 0);
      expect(score2).toBe(30);

      // approvalRisk=0, activityRisk=0, targetRisk=100 → 0*0.35 + 0*0.30 + 100*0.35 = 35
      const score3 = calculateRiskScore(0, 0, 100);
      expect(score3).toBe(35);
    });

    it('returns integer scores', () => {
      const score = calculateRiskScore(33, 67, null);
      expect(Number.isInteger(score)).toBe(true);
    });
  });

  // ── Approval risk ──────────────────────────────────────────────────

  describe('calculateApprovalRisk', () => {
    it('unlimited approval to unknown adds 15', () => {
      const score = calculateApprovalRisk([{
        allowance: 'unlimited',
        isKnownSafe: false,
        isVerified: true,
        registryRisk: 'unknown',
      }]);
      expect(score).toBe(15);
    });

    it('unlimited approval to known-safe adds 3', () => {
      const score = calculateApprovalRisk([{
        allowance: 'unlimited',
        isKnownSafe: true,
        isVerified: true,
        registryRisk: 'safe',
      }]);
      expect(score).toBe(3);
    });

    it('approval to unverified adds 20', () => {
      const score = calculateApprovalRisk([{
        allowance: '1000',
        isKnownSafe: false,
        isVerified: false,
        registryRisk: 'unknown',
      }]);
      expect(score).toBe(20);
    });

    it('approval to high/critical adds 30', () => {
      const scoreHigh = calculateApprovalRisk([{
        allowance: '1000',
        isKnownSafe: false,
        isVerified: true,
        registryRisk: 'high',
      }]);
      expect(scoreHigh).toBe(30);

      const scoreCritical = calculateApprovalRisk([{
        allowance: '1000',
        isKnownSafe: false,
        isVerified: true,
        registryRisk: 'critical',
      }]);
      expect(scoreCritical).toBe(30);
    });

    it('caps at 100 with many risky approvals', () => {
      const approvals = Array.from({ length: 10 }, () => ({
        allowance: 'unlimited',
        isKnownSafe: false,
        isVerified: false,
        registryRisk: 'critical' as const,
      }));
      const score = calculateApprovalRisk(approvals);
      expect(score).toBe(100);
    });

    it('returns 0 for empty approvals', () => {
      const score = calculateApprovalRisk([]);
      expect(score).toBe(0);
    });
  });

  // ── Activity risk ──────────────────────────────────────────────────

  describe('calculateActivityRisk', () => {
    it('danger pattern adds 25', () => {
      const score = calculateActivityRisk([
        { pattern: 'interaction-with-flagged', severity: 'danger', description: 'test' },
      ]);
      expect(score).toBe(25);
    });

    it('warning pattern adds 10', () => {
      const score = calculateActivityRisk([
        { pattern: 'rapid-approvals', severity: 'warning', description: 'test' },
      ]);
      expect(score).toBe(10);
    });

    it('info pattern adds 3', () => {
      const score = calculateActivityRisk([
        { pattern: 'some-info', severity: 'info', description: 'test' },
      ]);
      expect(score).toBe(3);
    });

    it('caps at 100', () => {
      const patterns = Array.from({ length: 10 }, () => ({
        pattern: 'danger', severity: 'danger' as const, description: 'test',
      }));
      const score = calculateActivityRisk(patterns);
      expect(score).toBe(100);
    });

    it('returns 0 for no patterns', () => {
      const score = calculateActivityRisk([]);
      expect(score).toBe(0);
    });

    it('accumulates multiple patterns', () => {
      const score = calculateActivityRisk([
        { pattern: 'p1', severity: 'danger', description: 'test' },  // +25
        { pattern: 'p2', severity: 'warning', description: 'test' }, // +10
        { pattern: 'p3', severity: 'info', description: 'test' },    // +3
      ]);
      expect(score).toBe(38);
    });
  });

  // ── Target risk ────────────────────────────────────────────────────

  describe('calculateTargetRisk', () => {
    it('critical registry entry scores 90', () => {
      const score = calculateTargetRisk({ registryRisk: 'critical', isVerified: true, inRegistry: true });
      expect(score).toBe(90);
    });

    it('high registry entry scores 70', () => {
      const score = calculateTargetRisk({ registryRisk: 'high', isVerified: true, inRegistry: true });
      expect(score).toBe(70);
    });

    it('medium registry entry scores 40', () => {
      const score = calculateTargetRisk({ registryRisk: 'medium', isVerified: true, inRegistry: true });
      expect(score).toBe(40);
    });

    it('low registry entry scores 15', () => {
      const score = calculateTargetRisk({ registryRisk: 'low', isVerified: true, inRegistry: true });
      expect(score).toBe(15);
    });

    it('safe registry entry scores 5', () => {
      const score = calculateTargetRisk({ registryRisk: 'safe', isVerified: true, inRegistry: true });
      expect(score).toBe(5);
    });

    it('not-in-registry + unverified scores 60', () => {
      const score = calculateTargetRisk({ registryRisk: null, isVerified: false, inRegistry: false });
      expect(score).toBe(60);
    });

    it('not-in-registry + verified scores 30', () => {
      const score = calculateTargetRisk({ registryRisk: null, isVerified: true, inRegistry: false });
      expect(score).toBe(30);
    });

    it('unknown registry risk scores 50', () => {
      const score = calculateTargetRisk({ registryRisk: 'unknown', isVerified: true, inRegistry: true });
      expect(score).toBe(50);
    });
  });

  // ── Risk level mapping ─────────────────────────────────────────────

  describe('riskScoreToLevel', () => {
    it('maps score 0-10 to safe', () => {
      expect(riskScoreToLevel(0)).toBe('safe');
      expect(riskScoreToLevel(10)).toBe('safe');
    });

    it('maps score 11-30 to low', () => {
      expect(riskScoreToLevel(11)).toBe('low');
      expect(riskScoreToLevel(30)).toBe('low');
    });

    it('maps score 31-60 to medium', () => {
      expect(riskScoreToLevel(31)).toBe('medium');
      expect(riskScoreToLevel(60)).toBe('medium');
    });

    it('maps score 61-80 to high', () => {
      expect(riskScoreToLevel(61)).toBe('high');
      expect(riskScoreToLevel(80)).toBe('high');
    });

    it('maps score 81-100 to critical', () => {
      expect(riskScoreToLevel(81)).toBe('critical');
      expect(riskScoreToLevel(100)).toBe('critical');
    });
  });
});
