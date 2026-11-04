/**
 * Trade Check — the "should I buy this token right now?" bundle.
 *
 * One paid call that runs the three services an agent needs before a trade,
 * in parallel: token-risk-metrics (quantitative rug check), token-intel
 * (market data + AI risk assessment), and the gas oracle. Priced below the
 * three called separately; the only marginal cost is token-intel's LLM call,
 * so the bundle stays profitable per call even at the LLM worst case.
 *
 * Risk metrics are required — a rug check that silently vanished would make
 * the verdict misleading, so their failure fails the call (and the caller is
 * not charged). Intel and gas degrade gracefully and are reported in
 * `degraded` instead.
 */

import { getTokenRiskMetricsWithCost } from './tokenRiskMetrics/index.js';
import { getTokenIntelWithCost } from './tokenIntel.js';
import { getGasPriceWithCost } from './gasOracle.js';
import { gasOracleInput, type GasOracleInput } from '../schemas/gasOracle.js';
import {
  tradeCheckInput,
  tradeCheckOutput,
  type TradeCheckOutput,
} from '../schemas/tradeCheck.js';
import { ENDPOINT_PRICES, formatUsd } from '../pricing.js';

type RiskMetricsResult = Awaited<ReturnType<typeof getTokenRiskMetricsWithCost>>;
type IntelResult = Awaited<ReturnType<typeof getTokenIntelWithCost>>;
type GasResult = Awaited<ReturnType<typeof getGasPriceWithCost>>;

function verdictFrom(
  riskMetrics: RiskMetricsResult['output'],
  intel: IntelResult['output'] | null,
): { verdict: TradeCheckOutput['verdict']; reasons: string[] } {
  const reasons: string[] = [];
  const score = riskMetrics.overallRisk.score;
  const level = riskMetrics.overallRisk.level;
  reasons.push(`Composite risk score ${score}/100 (${level})`);

  // Both scores run 0 (safe) to 100 (extremely risky).
  const intelScore = intel?.risk?.score;
  if (intelScore !== undefined) reasons.push(`AI risk score ${intelScore}/100`);

  const worst = Math.max(score, intelScore ?? 0);
  if (level === 'critical' || worst >= 75) {
    return { verdict: 'avoid', reasons };
  }
  if (level === 'high' || worst >= 50) {
    return { verdict: 'caution', reasons };
  }
  return { verdict: 'proceed', reasons };
}

function bundleSavings(): string {
  const separately =
    ENDPOINT_PRICES['/v1/token-risk-metrics'] +
    ENDPOINT_PRICES['/v1/token-intel'] +
    ENDPOINT_PRICES['/v1/gas'];
  const bundle = ENDPOINT_PRICES['/v1/trade-check'];
  return `${formatUsd(bundle)} vs ${formatUsd(separately)} for the three calls separately`;
}

export async function tradeCheckWithCost(
  input: unknown,
): Promise<{ output: TradeCheckOutput; estimatedCostUsd: number }> {
  const startTime = Date.now();
  const validated = tradeCheckInput.parse(input);

  const [metricsSettled, intelSettled, gasSettled] = await Promise.allSettled([
    getTokenRiskMetricsWithCost({ address: validated.address, chain: validated.chain }),
    getTokenIntelWithCost({ address: validated.address, chain: validated.chain }),
    // The gas oracle covers fewer chains than the rug check; elsewhere gas is just omitted.
    (gasOracleInput.shape.chain.unwrap().options as readonly string[]).includes(validated.chain)
      ? getGasPriceWithCost({ chain: validated.chain as GasOracleInput['chain'] })
      : Promise.reject(new Error('gas oracle does not cover this chain')),
  ]);

  // Without the rug check there is no verdict to sell; propagate the error so
  // the route 4xx/5xxs and the caller is not charged.
  if (metricsSettled.status === 'rejected') throw metricsSettled.reason;
  const riskMetrics = metricsSettled.value;

  const intel = intelSettled.status === 'fulfilled' ? intelSettled.value : null;
  const gas = gasSettled.status === 'fulfilled' ? gasSettled.value : null;
  const degraded: ('intel' | 'gas')[] = [];
  if (!intel) degraded.push('intel');
  if (!gas) degraded.push('gas');

  const { verdict, reasons } = verdictFrom(riskMetrics.output, intel?.output ?? null);

  const output = tradeCheckOutput.parse({
    verdict,
    verdictReasons: reasons,
    riskMetrics: riskMetrics.output,
    intel: intel?.output ?? null,
    gas: gas?.output ?? null,
    degraded,
    metadata: {
      chain: validated.chain,
      address: validated.address,
      processingTimeMs: Date.now() - startTime,
      bundleSavings: bundleSavings(),
    },
    relatedServices: [
      {
        endpoint: '/v1/wallet-safety',
        description: 'Safety-check the wallet that will execute this trade',
        suggestedInput: { walletAddress: '0x…wallet', chain: validated.chain },
      },
      {
        endpoint: '/v1/token-research',
        description: 'Deep multi-source due diligence on this token',
        suggestedInput: { query: validated.address, chain: validated.chain },
      },
      {
        endpoint: '/v1/contract-monitor',
        description: 'Watch this contract for admin activity after you enter the position',
        suggestedInput: { address: validated.address, chain: validated.chain },
      },
    ],
  });

  return {
    output,
    estimatedCostUsd:
      riskMetrics.estimatedCostUsd + (intel?.estimatedCostUsd ?? 0) + (gas?.estimatedCostUsd ?? 0),
  };
}
