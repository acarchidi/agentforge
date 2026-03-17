/**
 * Risk Score Calculation for Wallet Safety Check
 *
 * Risk score: 0 = safe, 100 = maximum risk.
 * All functions are pure and independently testable.
 */

import type { RiskLevel } from '../../schemas/walletSafety.js';

// ── Types ────────────────────────────────────────────────────────────

export interface ApprovalRiskInput {
  allowance: string;
  isKnownSafe: boolean;
  isVerified: boolean;
  registryRisk: string;
}

export interface PatternInput {
  pattern: string;
  severity: 'info' | 'warning' | 'danger';
  description: string;
}

export interface TargetRiskInput {
  registryRisk: string | null;
  isVerified: boolean;
  inRegistry: boolean;
}

// ── Composite Risk Score ─────────────────────────────────────────────

/**
 * Calculate the composite risk score with weighted components.
 *
 * Without target: approvalRisk * 0.55 + activityRisk * 0.45
 * With target:    approvalRisk * 0.35 + activityRisk * 0.30 + targetRisk * 0.35
 */
export function calculateRiskScore(
  approvalRisk: number,
  activityRisk: number,
  targetRisk: number | null,
): number {
  let raw: number;

  if (targetRisk !== null) {
    raw = approvalRisk * 0.35 + activityRisk * 0.30 + targetRisk * 0.35;
  } else {
    raw = approvalRisk * 0.55 + activityRisk * 0.45;
  }

  return Math.min(100, Math.max(0, Math.round(raw)));
}

// ── Approval Risk ────────────────────────────────────────────────────

/**
 * Score approval risk:
 * - Unlimited approval to unknown contract: +15
 * - Unlimited approval to known-safe contract: +3
 * - Approval to unverified contract: +20
 * - Approval to high/critical risk contract: +30
 * Capped at 100.
 */
export function calculateApprovalRisk(approvals: ApprovalRiskInput[]): number {
  let score = 0;

  for (const approval of approvals) {
    // High/critical risk takes precedence
    if (approval.registryRisk === 'high' || approval.registryRisk === 'critical') {
      score += 30;
    } else if (!approval.isVerified) {
      // Unverified contract
      score += 20;
    } else if (approval.allowance === 'unlimited') {
      if (approval.isKnownSafe) {
        score += 3;
      } else {
        score += 15;
      }
    }
  }

  return Math.min(100, score);
}

// ── Activity Risk ────────────────────────────────────────────────────

/**
 * Score activity risk from detected patterns:
 * - Each 'danger' pattern: +25
 * - Each 'warning' pattern: +10
 * - Each 'info' pattern: +3
 * Capped at 100.
 */
export function calculateActivityRisk(patterns: PatternInput[]): number {
  let score = 0;

  for (const pattern of patterns) {
    switch (pattern.severity) {
      case 'danger':
        score += 25;
        break;
      case 'warning':
        score += 10;
        break;
      case 'info':
        score += 3;
        break;
    }
  }

  return Math.min(100, score);
}

// ── Target Contract Risk ─────────────────────────────────────────────

/**
 * Score target contract risk:
 * - critical: 90
 * - high: 70
 * - medium: 40
 * - low: 15
 * - safe: 5
 * - unknown: 50
 * - Not in registry + unverified: 60
 * - Not in registry + verified: 30
 */
export function calculateTargetRisk(input: TargetRiskInput): number {
  if (!input.inRegistry) {
    return input.isVerified ? 30 : 60;
  }

  switch (input.registryRisk) {
    case 'critical':
      return 90;
    case 'high':
      return 70;
    case 'medium':
      return 40;
    case 'low':
      return 15;
    case 'safe':
      return 5;
    case 'unknown':
    default:
      return 50;
  }
}

// ── Score to Risk Level Mapping ──────────────────────────────────────

/**
 * Convert numeric risk score to human-readable risk level.
 */
export function riskScoreToLevel(score: number): RiskLevel {
  if (score <= 10) return 'safe';
  if (score <= 30) return 'low';
  if (score <= 60) return 'medium';
  if (score <= 80) return 'high';
  return 'critical';
}
