/**
 * Liquidity depth analysis.
 * Pure functions — testable without external calls.
 */

export type LiquidityRisk = 'low' | 'medium' | 'high' | 'critical';

/**
 * Map liquidity-to-mcap ratio to a risk level.
 *
 * < 0.01  = critical (very thin — dangerous for large trades)
 * 0.01–0.05 = high (thin)
 * 0.05–0.15 = medium (moderate)
 * > 0.15  = low (deep)
 */
/**
 * Liquidity-to-market-cap is the right lens for small caps but punishes large
 * ones (WETH's on-chain liquidity is a tiny fraction of its market cap yet
 * absorbs any agent-sized trade). Absolute depth caps the risk level.
 */
export function capLiquidityRiskByDepth(risk: LiquidityRisk, totalLiquidityUsd: number | undefined): LiquidityRisk {
  if (!totalLiquidityUsd) return risk;
  const order: LiquidityRisk[] = ['low', 'medium', 'high', 'critical'];
  const ceiling: LiquidityRisk | null = totalLiquidityUsd >= 1_000_000 ? 'low' : totalLiquidityUsd >= 250_000 ? 'medium' : null;
  if (!ceiling) return risk;
  return order.indexOf(risk) > order.indexOf(ceiling) ? ceiling : risk;
}

export function scoreLiquidityRisk(ratio: number | undefined): LiquidityRisk {
  if (ratio === undefined || ratio === null) return 'high'; // unknown → treat as high
  if (ratio > 0.15) return 'low';
  if (ratio >= 0.05) return 'medium';
  if (ratio >= 0.01) return 'high';
  return 'critical';
}

/** Compute the liquidity-to-market-cap ratio from raw values. */
export function computeLiquidityRatio(
  totalLiquidityUsd: number | undefined,
  marketCapUsd: number | undefined,
): number | undefined {
  if (!totalLiquidityUsd || !marketCapUsd || marketCapUsd === 0) return undefined;
  return totalLiquidityUsd / marketCapUsd;
}
