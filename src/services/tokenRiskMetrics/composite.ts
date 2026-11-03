/**
 * Composite risk score computation.
 * Weights: concentration 30%, liquidity 25%, permissions 30%, deployer 15%.
 */

import type { ConcentrationRisk } from './concentration.js';
import type { LiquidityRisk } from './liquidity.js';
import type { PermissionRisk } from './permissions.js';

export type DeployerRisk = 'unknown' | 'low' | 'medium' | 'high';
export type OverallRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface CompositeInput {
  /**
   * Omit when holder data is unavailable (Etherscan's holder list is an API
   * Pro endpoint). Scoring "no data" as low concentration made rugs look
   * safe; instead the remaining weights are renormalized and a flag says so.
   */
  concentrationRisk?: ConcentrationRisk;
  liquidityRisk: LiquidityRisk;
  permissionRisk: PermissionRisk;
  deployerRisk: DeployerRisk;
  // Optional context for flag generation
  top10HolderPct?: number;
  canMint?: boolean;
  canBlacklist?: boolean;
  canPause?: boolean;
  liquidityToMcapRatio?: number;
}

export interface CompositeResult {
  score: number;
  level: OverallRiskLevel;
  flags: string[];
}

function riskLevelToScore(risk: string): number {
  switch (risk) {
    case 'none':
    case 'low': return 0;
    case 'medium': return 50;
    case 'high': return 75;
    case 'critical': return 100;
    case 'unknown': return 50; // treat unknown deployer as moderate risk
    default: return 0;
  }
}

function scoreToLevel(score: number): OverallRiskLevel {
  if (score < 25) return 'low';
  if (score < 50) return 'medium';
  if (score < 75) return 'high';
  return 'critical';
}

/** Generate human-readable risk flags for the most significant issues. */
function generateFlags(input: CompositeInput): string[] {
  const flags: string[] = [];

  if (input.concentrationRisk === undefined) {
    flags.push('Holder concentration unavailable — score excludes it; check top holders before sizing a position');
  }

  if (input.concentrationRisk === 'critical' || input.concentrationRisk === 'high') {
    const pct = input.top10HolderPct;
    flags.push(
      pct !== undefined
        ? `Top 10 holders control ${pct.toFixed(1)}% of supply`
        : 'Highly concentrated token supply',
    );
  }

  if (input.canMint) {
    flags.push('Owner can mint unlimited tokens');
  }

  if (input.canBlacklist) {
    flags.push('Owner can blacklist addresses');
  }

  if (input.canPause) {
    flags.push('Owner can pause all transfers');
  }

  if (input.liquidityRisk === 'critical') {
    const ratio = input.liquidityToMcapRatio;
    flags.push(
      ratio !== undefined
        ? `Liquidity is only ${(ratio * 100).toFixed(2)}% of market cap`
        : 'Critically thin liquidity relative to market cap',
    );
  } else if (input.liquidityRisk === 'high') {
    flags.push('Thin liquidity — large trades may cause significant slippage');
  }

  if (input.deployerRisk === 'high') {
    flags.push('Deployer address associated with known exploits or rug pulls');
  }

  return flags;
}

/**
 * Compute a weighted composite risk score (0–100).
 * Weights: concentration 30%, liquidity 25%, permissions 30%, deployer 15%.
 */
export function computeCompositeScore(input: CompositeInput): CompositeResult {
  const liquidityScore = riskLevelToScore(input.liquidityRisk);
  const permissionsScore = riskLevelToScore(input.permissionRisk);
  const deployerScore = riskLevelToScore(input.deployerRisk);

  const weighted = liquidityScore * 0.25 + permissionsScore * 0.30 + deployerScore * 0.15;
  const score = Math.round(
    input.concentrationRisk === undefined
      ? weighted / 0.70
      : weighted + riskLevelToScore(input.concentrationRisk) * 0.30,
  );

  return {
    score: Math.min(100, Math.max(0, score)),
    level: scoreToLevel(score),
    flags: generateFlags(input),
  };
}
