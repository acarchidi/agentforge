/**
 * Lending position health — GET /v1/lending/health.
 *
 * How close a wallet's Aave v3 position is to liquidation, on one chain or all
 * five at once. One `getUserAccountData` eth_call per chain over public RPC;
 * no LLM, no indexer. Built for agents and bots managing leveraged positions
 * that need to check often.
 */

import { decodeFunctionResult, encodeFunctionData, parseAbi } from 'viem';
import { rpcBatch, type EvmChain } from '../utils/evmRpc.js';
import {
  LENDING_CHAINS,
  lendingHealthInput,
  lendingHealthOutput,
  type LendingHealthOutput,
  type LendingPosition,
} from '../schemas/lendingHealth.js';

/** Aave v3 Pool proxies — verified 2026-11-03 (getUserAccountData returns 6 words on each). */
export const AAVE_V3_POOL: Record<(typeof LENDING_CHAINS)[number], string> = {
  ethereum: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
  base: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
  arbitrum: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
  optimism: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
  polygon: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
  bsc: '0x6807dc923806fE8Fd134338EABCA509979a7e0cB',
  avalanche: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
  linea: '0xc47b8C00b0f69a36fa203Ffeac0334874574a8Ac',
  sonic: '0x5362dBb1e601abF3a4c14c22ffEdA64042E5eAA3',
};

const poolAbi = parseAbi([
  'function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)',
]);

const MAX_UINT = 2n ** 256n - 1n;
/** Aave v3 base currency is USD with 8 decimals. */
const usd = (v: bigint) => Number(v) / 1e8;

/** Exported for tests. */
export function statusFor(hf: number | null): LendingPosition['status'] {
  if (hf === null) return 'no_debt';
  if (hf < 1) return 'liquidatable';
  if (hf < 1.05) return 'critical';
  if (hf < 1.2) return 'danger';
  if (hf < 1.5) return 'watch';
  return 'safe';
}

/** Exported for tests: decode one getUserAccountData result; null if empty. */
export function positionFrom(chain: string, data: string): LendingPosition | null {
  const [collateral, debt, available, liqThreshold, ltv, healthFactor] = decodeFunctionResult({
    abi: poolAbi,
    functionName: 'getUserAccountData',
    data: data as `0x${string}`,
  }) as readonly [bigint, bigint, bigint, bigint, bigint, bigint];
  if (collateral === 0n && debt === 0n) return null;
  const hf = debt === 0n || healthFactor === MAX_UINT ? null : Number(healthFactor) / 1e18;
  return {
    protocol: 'aave-v3',
    chain,
    collateralUsd: Math.round(usd(collateral) * 100) / 100,
    debtUsd: Math.round(usd(debt) * 100) / 100,
    availableBorrowsUsd: Math.round(usd(available) * 100) / 100,
    liquidationThresholdPct: Number(liqThreshold) / 100,
    ltvPct: Number(ltv) / 100,
    healthFactor: hf === null ? null : Math.round(hf * 1000) / 1000,
    status: statusFor(hf),
    collateralDropToLiquidationPct: hf === null ? null : Math.max(0, Math.round((1 - 1 / hf) * 1000) / 10),
  };
}

export async function getLendingHealthWithCost(
  input: unknown,
): Promise<{ output: LendingHealthOutput; estimatedCostUsd: number }> {
  const v = lendingHealthInput.parse(input);
  const chains = v.chain === 'all' ? [...LENDING_CHAINS] : [v.chain];
  const data = encodeFunctionData({ abi: poolAbi, functionName: 'getUserAccountData', args: [v.address as `0x${string}`] });

  const positions: LendingPosition[] = [];
  const failed: string[] = [];
  await Promise.all(
    chains.map(async (chain) => {
      try {
        const [res] = await rpcBatch(chain as EvmChain, [
          { method: 'eth_call', params: [{ to: AAVE_V3_POOL[chain], data }, 'latest'] },
        ]);
        if (typeof res !== 'string' || res === '0x') throw new Error('empty result');
        const p = positionFrom(chain, res);
        if (p) positions.push(p);
      } catch {
        failed.push(chain);
      }
    }),
  );
  positions.sort((a, b) => (a.healthFactor ?? Infinity) - (b.healthFactor ?? Infinity));
  const worst = positions.find((p) => p.healthFactor !== null) ?? positions[0] ?? null;

  const output = lendingHealthOutput.parse({
    address: v.address,
    positions,
    worst,
    chainsChecked: chains.filter((c) => !failed.includes(c)),
    chainsFailed: failed,
    note: positions.length === 0
      ? 'No Aave v3 position on the checked chains.'
      : 'Health factor < 1 means liquidatable. collateralDropToLiquidationPct is approximate (assumes debt value constant and collateral moving together).',
    relatedServices: [
      ...(worst && worst.healthFactor !== null
        ? [{
            endpoint: '/v1/tx-simulate',
            description: 'Simulate a repay or collateral top-up before signing it',
            suggestedInput: { chain: worst.chain, from: v.address, transactions: [{ to: AAVE_V3_POOL[worst.chain as keyof typeof AAVE_V3_POOL], data: '0x…' }] },
          }]
        : []),
      {
        endpoint: '/v1/approval-scan',
        description: 'Check which spenders hold approvals on this wallet',
        suggestedInput: { address: v.address, chain: worst?.chain ?? 'ethereum' },
      },
    ],
  });
  return { output, estimatedCostUsd: 0 };
}
