/**
 * Token Compare service — compares a primary token against up to 3 others.
 * Returns full research on the primary, abbreviated metrics on comparisons,
 * plus LLM comparative analysis.
 */

import { callClaude } from '../llm/anthropic.js';
import { cleanLlmJson } from '../utils/cleanJson.js';
import {
  tokenCompareInput,
  tokenCompareOutput,
  type TokenCompareInput,
  type TokenCompareOutput,
} from '../schemas/tokenCompare.js';
import { tokenResearchWithCost } from './tokenResearch.js';
import * as coingecko from './dataSources/coingecko.js';
import * as defillama from './dataSources/defillama.js';

const COMPARE_PROMPT = `You are a cryptocurrency analyst. Given a primary token with full research data and abbreviated metrics for comparison tokens, write a concise comparative analysis (2-3 paragraphs).

Cover:
- How the primary token compares in terms of market cap, price performance, and risk
- Key differentiators between the tokens
- Which tokens appear stronger/weaker and why

Return ONLY a plain text analysis (no JSON, no markdown headers). Be specific with numbers.`;

async function fetchAbbreviatedMetrics(
  query: string,
  chain: string,
): Promise<{
  query: string;
  symbol: string;
  priceUsd: number | null;
  marketCap: number | null;
  tvl: number | null;
  riskScore: number;
}> {
  // Try CoinGecko search
  const knownIds: Record<string, string> = {
    bitcoin: 'bitcoin', btc: 'bitcoin',
    ethereum: 'ethereum', eth: 'ethereum',
    solana: 'solana', sol: 'solana',
    usdc: 'usd-coin', usdt: 'tether',
    aave: 'aave', uniswap: 'uniswap', uni: 'uniswap',
    chainlink: 'chainlink', link: 'chainlink',
  };

  const lowerQuery = query.toLowerCase();
  let geckoId = knownIds[lowerQuery];
  let symbol = query.toUpperCase();
  let priceUsd: number | null = null;
  let marketCap: number | null = null;

  if (!geckoId) {
    if (query.startsWith('0x') && query.length >= 40) {
      const data = await coingecko.fetchByAddress(query, chain);
      if (data) {
        geckoId = data.id;
        symbol = data.symbol?.toUpperCase() ?? 'UNKNOWN';
        priceUsd = data.priceUsd;
        marketCap = data.marketCap;
      }
    } else {
      const results = await coingecko.searchToken(query);
      if (results.length > 0) {
        geckoId = results[0].id;
        symbol = results[0].symbol.toUpperCase();
      }
    }
  }

  if (geckoId && priceUsd === null) {
    const data = await coingecko.fetchById(geckoId);
    if (data) {
      priceUsd = data.priceUsd;
      marketCap = data.marketCap;
      symbol = data.symbol?.toUpperCase() ?? symbol;
    }
  }

  // Try DeFiLlama for TVL
  let tvl: number | null = null;
  try {
    const protocol = await defillama.findProtocol(query, geckoId);
    if (protocol) {
      const detail = await defillama.fetchProtocolDetail(protocol.slug);
      tvl = detail?.tvl ?? null;
    }
  } catch {
    // TVL not available
  }

  // Simple risk score heuristic
  let riskScore = 50;
  if (marketCap && marketCap > 10_000_000_000) riskScore = 15;
  else if (marketCap && marketCap > 1_000_000_000) riskScore = 25;
  else if (marketCap && marketCap > 100_000_000) riskScore = 40;
  else if (marketCap && marketCap > 10_000_000) riskScore = 55;
  else riskScore = 70;

  return { query, symbol, priceUsd, marketCap, tvl, riskScore };
}

export interface TokenCompareResult {
  output: TokenCompareOutput;
  estimatedCostUsd: number;
}

export async function tokenCompareWithCost(
  input: TokenCompareInput,
): Promise<TokenCompareResult> {
  const validated = tokenCompareInput.parse(input);
  const startTime = Date.now();
  let totalCost = 0;

  // Fetch full research on primary token
  const primaryResult = await tokenResearchWithCost({
    query: validated.primary,
    chain: validated.chain,
    include: ['market_data', 'defi_metrics', 'contract_info', 'risk_assessment'],
  });
  totalCost += primaryResult.estimatedCostUsd;

  // Fetch abbreviated metrics for comparison tokens in parallel
  const comparisons = await Promise.all(
    validated.compare.map((q) => fetchAbbreviatedMetrics(q, validated.chain)),
  );

  // LLM comparative analysis
  const compSummary = comparisons
    .map((c) => `${c.symbol}: price=$${c.priceUsd ?? 'N/A'}, mcap=$${c.marketCap ?? 'N/A'}, tvl=$${c.tvl ?? 'N/A'}, risk=${c.riskScore}`)
    .join('\n');

  const primarySummary = JSON.stringify({
    token: primaryResult.output.token,
    marketData: primaryResult.output.marketData,
    riskAssessment: primaryResult.output.riskAssessment,
  }, null, 2).slice(0, 4000);

  const response = await callClaude({
    system: COMPARE_PROMPT,
    userMessage: `Primary token:\n${primarySummary}\n\nComparison tokens:\n${compSummary}`,
    maxTokens: 800,
    temperature: 0.3,
  });
  totalCost += response.usage.estimatedCostUsd;

  // Suggest deep research on each compared token
  const related = comparisons.map((c) => ({
    endpoint: '/v1/token-research',
    description: `Deep research on ${c.symbol}`,
    suggestedInput: { query: c.query, chain: validated.chain },
  }));

  const output = tokenCompareOutput.parse({
    primary: primaryResult.output,
    comparisons,
    analysis: response.text,
    metadata: {
      processingTimeMs: Date.now() - startTime,
      estimatedCostUsd: totalCost,
    },
    relatedServices: related,
  });

  return { output, estimatedCostUsd: totalCost };
}
