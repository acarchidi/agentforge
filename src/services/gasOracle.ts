/**
 * Gas Price Oracle service.
 * Fetches current gas prices from Etherscan gastracker.
 * Caches for 15 seconds. Tracks trend by comparing to previous values.
 */

import { SimpleCache } from '../utils/cache.js';
import { config } from '../config.js';
import {
  gasOracleInput,
  gasOracleOutput,
  type GasOracleInput,
  type GasOracleOutput,
} from '../schemas/gasOracle.js';

const CHAIN_ID_MAP: Record<string, number> = {
  ethereum: 1,
  base: 8453,
  polygon: 137,
  arbitrum: 42161,
  optimism: 10,
  avalanche: 43114,
};

// Cache gas data for 15 seconds
const gasCache = new SimpleCache<GasOracleOutput>(15);

// Store previous standard gas price per chain for trend calculation
const previousPrices = new Map<string, { gwei: number; timestamp: number }>();

async function etherscanFetch(
  chainId: number,
  module: string,
  action: string,
  params: Record<string, string> = {},
): Promise<unknown> {
  const apiKey = config.ETHERSCAN_API_KEY;
  const searchParams = new URLSearchParams({
    chainid: String(chainId),
    module,
    action,
    ...params,
    ...(apiKey ? { apikey: apiKey } : {}),
  });

  const res = await fetch(
    `https://api.etherscan.io/v2/api?${searchParams.toString()}`,
    { signal: AbortSignal.timeout(10_000) },
  );
  if (!res.ok) throw new Error(`Etherscan API error: ${res.status}`);
  const data = (await res.json()) as {
    status: string;
    message: string;
    result: unknown;
  };

  if (data.status === '0' && data.message === 'NOTOK') {
    throw new Error(`Etherscan error: ${data.result}`);
  }

  return data.result;
}

function calculateTrend(
  chain: string,
  currentGwei: number,
): 'rising' | 'falling' | 'stable' {
  const prev = previousPrices.get(chain);
  const now = Date.now();

  // Update stored price
  previousPrices.set(chain, { gwei: currentGwei, timestamp: now });

  if (!prev) return 'stable';

  // Only compare if previous price is within last 10 minutes
  if (now - prev.timestamp > 600_000) return 'stable';

  const change = ((currentGwei - prev.gwei) / prev.gwei) * 100;
  if (change > 5) return 'rising';
  if (change < -5) return 'falling';
  return 'stable';
}

export interface GasOracleResult {
  output: GasOracleOutput;
  estimatedCostUsd: number;
}

export async function getGasPriceWithCost(
  input: GasOracleInput,
): Promise<GasOracleResult> {
  const validated = gasOracleInput.parse(input);
  const startTime = Date.now();
  const chainId = CHAIN_ID_MAP[validated.chain];

  // Check cache first
  const cacheKey = `gas:${validated.chain}`;
  const cached = gasCache.get(cacheKey);
  if (cached) {
    return { output: cached, estimatedCostUsd: 0 };
  }

  const result = (await etherscanFetch(chainId, 'gastracker', 'gasoracle')) as Record<
    string,
    string
  >;

  const safeGwei = parseFloat(result.SafeGasPrice ?? '0');
  const proposeGwei = parseFloat(result.ProposeGasPrice ?? '0');
  const fastGwei = parseFloat(result.FastGasPrice ?? '0');
  const baseFee = result.suggestBaseFee ? parseFloat(result.suggestBaseFee) : null;

  const trend = calculateTrend(validated.chain, proposeGwei);

  const output = gasOracleOutput.parse({
    chain: validated.chain,
    currentPrices: {
      slow: { gwei: safeGwei, estimatedSeconds: 120 },
      standard: { gwei: proposeGwei, estimatedSeconds: 30 },
      fast: { gwei: fastGwei, estimatedSeconds: 15 },
    },
    baseFee,
    trend,
    timestamp: new Date().toISOString(),
    metadata: {
      source: 'etherscan' as const,
      processingTimeMs: Date.now() - startTime,
    },
  });

  gasCache.set(cacheKey, output);
  return { output, estimatedCostUsd: 0 };
}
