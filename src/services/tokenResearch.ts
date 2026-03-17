/**
 * Token Research service — multi-source token intelligence.
 * Aggregates CoinGecko, DeFiLlama, Etherscan, Polymarket, and LLM analysis.
 */

import { callClaude } from '../llm/anthropic.js';
import { cleanLlmJson } from '../utils/cleanJson.js';
import {
  tokenResearchInput,
  tokenResearchOutput,
  type TokenResearchInput,
  type TokenResearchOutput,
} from '../schemas/tokenResearch.js';
import * as coingecko from './dataSources/coingecko.js';
import * as defillama from './dataSources/defillama.js';
import * as etherscan from './dataSources/etherscan.js';
import * as polymarket from './dataSources/polymarket.js';

// ── Token identity resolution ──────────────────────────────────────

interface TokenIdentity {
  name: string;
  symbol: string;
  address: string | undefined;
  coingeckoId: string | undefined;
}

async function resolveTokenIdentity(
  query: string,
  chain: string,
): Promise<TokenIdentity> {
  // If the query looks like an address, use Etherscan + CoinGecko address lookup
  if (query.startsWith('0x') && query.length >= 40) {
    const geckoData = await coingecko.fetchByAddress(query, chain);
    return {
      name: geckoData?.name ?? query,
      symbol: geckoData?.symbol ?? 'UNKNOWN',
      address: query,
      coingeckoId: geckoData?.id,
    };
  }

  // Try well-known token names that map directly to CoinGecko IDs
  const knownIds: Record<string, string> = {
    bitcoin: 'bitcoin',
    btc: 'bitcoin',
    ethereum: 'ethereum',
    eth: 'ethereum',
    solana: 'solana',
    sol: 'solana',
    usdc: 'usd-coin',
    usdt: 'tether',
    matic: 'matic-network',
    polygon: 'matic-network',
    aave: 'aave',
    uniswap: 'uniswap',
    uni: 'uniswap',
    chainlink: 'chainlink',
    link: 'chainlink',
    avalanche: 'avalanche-2',
    avax: 'avalanche-2',
    arbitrum: 'arbitrum',
    arb: 'arbitrum',
    optimism: 'optimism',
    op: 'optimism',
  };

  const lowerQuery = query.toLowerCase();
  const knownId = knownIds[lowerQuery];

  if (knownId) {
    const geckoData = await coingecko.fetchById(knownId);
    return {
      name: geckoData?.name ?? query,
      symbol: geckoData?.symbol?.toUpperCase() ?? query.toUpperCase(),
      address: undefined,
      coingeckoId: knownId,
    };
  }

  // Fall back to CoinGecko search
  const searchResults = await coingecko.searchToken(query);
  if (searchResults.length > 0) {
    const best = searchResults[0];
    return {
      name: best.name,
      symbol: best.symbol.toUpperCase(),
      address: undefined,
      coingeckoId: best.id,
    };
  }

  // Last resort — use the query as-is
  return {
    name: query,
    symbol: query.toUpperCase(),
    address: undefined,
    coingeckoId: undefined,
  };
}

// ── LLM-based analysis ─────────────────────────────────────────────

const INSTITUTIONAL_PROMPT = `You are a financial research assistant. Given a cryptocurrency token, recall any known positions, reports, or public statements by major financial institutions (Goldman Sachs, JPMorgan, BlackRock, Fidelity, Grayscale, ARK Invest, Standard Chartered, Deutsche Bank, etc.) regarding this token. Only include information you're confident about. If you don't have reliable information, return an empty mentions array.

Return ONLY a JSON object matching this schema:
{
  "mentions": [
    {
      "institution": <string>,
      "context": <string, brief summary of what they said>,
      "sentiment": <"positive"|"negative"|"neutral">,
      "approximate_date": <string or null>
    }
  ],
  "summary": <string, one-paragraph synthesis of institutional sentiment>
}

IMPORTANT: Based on training data. May not reflect current positions. Do not fabricate.`;

const RISK_PROMPT = `You are a token risk assessment specialist. Given aggregated data about a cryptocurrency token from multiple sources, synthesize a comprehensive risk assessment.

Return ONLY a JSON object matching this schema:
{
  "overallScore": <number 0-100, 0=very safe, 100=extremely risky>,
  "riskLevel": <"low"|"medium"|"high"|"critical">,
  "factors": [
    {
      "factor": <string, name of the risk factor>,
      "impact": <"positive"|"negative"|"neutral">,
      "detail": <string, explanation>
    }
  ],
  "summary": <string, one-paragraph risk summary>
}

Scoring guide:
- 0-20: Well-established, high liquidity, verified contracts
- 21-40: Legitimate but with some concerns
- 41-60: Moderate risk
- 61-80: High risk
- 81-100: Extreme risk

You must return ONLY a JSON object. No markdown. No code fences.`;

async function analyzeInstitutionalMentions(
  name: string,
  symbol: string,
): Promise<{ data: unknown; cost: number }> {
  const response = await callClaude({
    system: INSTITUTIONAL_PROMPT,
    userMessage: `Token: ${name} (${symbol})`,
    maxTokens: 1000,
    temperature: 0.2,
  });

  const parsed = JSON.parse(cleanLlmJson(response.text));
  return {
    data: { ...parsed, source: 'llm_analysis' },
    cost: response.usage.estimatedCostUsd,
  };
}

async function synthesizeRiskAssessment(
  identity: TokenIdentity,
  rawData: Record<string, unknown>,
): Promise<{ data: unknown; cost: number }> {
  const dataContext = JSON.stringify(rawData, null, 2).slice(0, 8000);

  const response = await callClaude({
    system: RISK_PROMPT,
    userMessage: `Token: ${identity.name} (${identity.symbol})\nChain: ${identity.address ? 'Contract at ' + identity.address : 'N/A'}\n\nAggregated data from multiple sources:\n${dataContext}`,
    maxTokens: 1000,
    temperature: 0.2,
  });

  const parsed = JSON.parse(cleanLlmJson(response.text));
  return { data: parsed, cost: response.usage.estimatedCostUsd };
}

// ── Main service function ──────────────────────────────────────────

export interface TokenResearchResult {
  output: TokenResearchOutput;
  estimatedCostUsd: number;
}

export async function tokenResearchWithCost(
  input: TokenResearchInput,
): Promise<TokenResearchResult> {
  const validated = tokenResearchInput.parse(input);
  const startTime = Date.now();
  const sourcesQueried: string[] = [];
  const sourcesSucceeded: string[] = [];
  const sourcesFailed: string[] = [];
  const cachedSources: string[] = [];
  let totalCost = 0;

  // Step 1: Resolve token identity
  const identity = await resolveTokenIdentity(validated.query, validated.chain);

  // Step 2: Fetch all requested data sources in parallel
  const rawData: Record<string, unknown> = {};

  const tasks: Array<Promise<void>> = [];

  // Market data (CoinGecko)
  if (validated.include.includes('market_data') && identity.coingeckoId) {
    sourcesQueried.push('coingecko');
    tasks.push(
      (async () => {
        try {
          const data = await coingecko.fetchById(identity.coingeckoId!);
          if (data) {
            sourcesSucceeded.push('coingecko');
            rawData.marketData = {
              priceUsd: data.priceUsd,
              marketCap: data.marketCap,
              fullyDilutedValuation: data.fullyDilutedValuation,
              volume24h: data.volume24h,
              priceChange24h: data.priceChange24h,
              priceChange7d: data.priceChange7d,
              priceChange30d: data.priceChange30d,
              allTimeHigh: data.allTimeHigh,
              allTimeHighDate: data.allTimeHighDate,
              circulatingSupply: data.circulatingSupply,
              totalSupply: data.totalSupply,
              source: 'coingecko' as const,
            };
          } else {
            sourcesFailed.push('coingecko');
          }
        } catch {
          sourcesFailed.push('coingecko');
        }
      })(),
    );
  }

  // DeFi metrics (DeFiLlama)
  if (validated.include.includes('defi_metrics')) {
    sourcesQueried.push('defillama');
    tasks.push(
      (async () => {
        try {
          const protocol = await defillama.findProtocol(
            identity.name,
            identity.coingeckoId,
          );
          if (protocol) {
            const detail = await defillama.fetchProtocolDetail(protocol.slug);
            if (detail) {
              sourcesSucceeded.push('defillama');
              rawData.defiMetrics = {
                tvl: detail.tvl,
                tvlChange24h: detail.tvlChange24h,
                tvlChange7d: detail.tvlChange7d,
                category: detail.category,
                chains: detail.chains,
                associatedProtocols: detail.associatedProtocols,
                source: 'defillama' as const,
              };
            } else {
              sourcesFailed.push('defillama');
            }
          } else {
            // Not found is not a failure — token may not be a DeFi protocol
            sourcesSucceeded.push('defillama');
            rawData.defiMetrics = undefined;
          }
        } catch {
          sourcesFailed.push('defillama');
        }
      })(),
    );
  }

  // Contract info (Etherscan)
  if (validated.include.includes('contract_info') && identity.address) {
    sourcesQueried.push('etherscan');
    tasks.push(
      (async () => {
        try {
          const [source, creation] = await Promise.all([
            etherscan.fetchContractSource(identity.address!, validated.chain),
            etherscan.fetchContractCreation(identity.address!, validated.chain),
          ]);
          if (source) {
            sourcesSucceeded.push('etherscan');
            rawData.contractInfo = {
              isVerified: source.isVerified,
              compilerVersion: source.compilerVersion,
              optimizationUsed: source.optimizationUsed,
              contractName: source.contractName,
              creationTxHash: creation?.creationTxHash ?? null,
              creatorAddress: creation?.creatorAddress ?? null,
              implementationAddress: source.implementationAddress,
              isProxy: source.isProxy,
              source: 'etherscan' as const,
            };
          } else {
            sourcesFailed.push('etherscan');
          }
        } catch {
          sourcesFailed.push('etherscan');
        }
      })(),
    );
  }

  // Price history (DeFiLlama coins API)
  if (validated.include.includes('price_history') && identity.address) {
    sourcesQueried.push('defillama_prices');
    tasks.push(
      (async () => {
        try {
          const data = await defillama.fetchPriceHistory(identity.address!, validated.chain);
          if (data) {
            sourcesSucceeded.push('defillama_prices');
            rawData.priceHistory = {
              ...data,
              source: 'defillama' as const,
            };
          } else {
            sourcesFailed.push('defillama_prices');
          }
        } catch {
          sourcesFailed.push('defillama_prices');
        }
      })(),
    );
  }

  // Holder distribution (Etherscan)
  if (validated.include.includes('holders') && identity.address) {
    sourcesQueried.push('etherscan_holders');
    tasks.push(
      (async () => {
        try {
          const holders = await etherscan.fetchTokenHolderList(identity.address!, validated.chain);
          if (holders.length > 0) {
            sourcesSucceeded.push('etherscan_holders');
            const top5 = holders.slice(0, 5).reduce((s, h) => s + h.percentage, 0);
            const top10 = holders.slice(0, 10).reduce((s, h) => s + h.percentage, 0);
            const top20 = holders.reduce((s, h) => s + h.percentage, 0);
            rawData.holderDistribution = {
              topHolders: holders.map((h) => ({
                address: h.address,
                balance: h.balance,
                percentage: h.percentage,
                isContract: h.isContract,
                label: null,
              })),
              concentration: {
                top5Percentage: top5,
                top10Percentage: top10,
                top20Percentage: top20,
              },
              riskFlag: top5 > 50,
              source: 'etherscan' as const,
            };
          } else {
            sourcesFailed.push('etherscan_holders');
          }
        } catch {
          sourcesFailed.push('etherscan_holders');
        }
      })(),
    );
  }

  // Prediction markets (Polymarket)
  if (validated.include.includes('prediction_markets')) {
    sourcesQueried.push('polymarket');
    tasks.push(
      (async () => {
        try {
          const data = await polymarket.searchMarkets(identity.symbol, identity.name);
          sourcesSucceeded.push('polymarket');
          rawData.predictionMarkets = {
            relatedMarkets: data.relatedMarkets,
            source: 'polymarket' as const,
          };
        } catch {
          sourcesFailed.push('polymarket');
        }
      })(),
    );
  }

  // Wait for all parallel fetches
  await Promise.all(tasks);

  // Institutional mentions (LLM — sequential, after parallel fetches)
  if (validated.include.includes('institutional')) {
    sourcesQueried.push('llm_analysis');
    try {
      const result = await analyzeInstitutionalMentions(identity.name, identity.symbol);
      rawData.institutional = result.data;
      totalCost += result.cost;
      sourcesSucceeded.push('llm_analysis');
    } catch {
      sourcesFailed.push('llm_analysis');
    }
  }

  // Risk assessment synthesis (LLM — after all data gathered)
  if (validated.include.includes('risk_assessment') && Object.keys(rawData).length > 0) {
    try {
      const result = await synthesizeRiskAssessment(identity, rawData);
      rawData.riskAssessment = result.data;
      totalCost += result.cost;
    } catch {
      // Risk assessment failed — continue without it
    }
  }

  // Build context-aware related services
  const related: Array<{ endpoint: string; description: string; suggestedInput: Record<string, unknown> }> = [];
  if (identity.address) {
    related.push({
      endpoint: '/v1/contract-docs',
      description: 'Generate documentation for this contract',
      suggestedInput: { address: identity.address, chain: validated.chain },
    });
    related.push({
      endpoint: '/v1/contract-monitor',
      description: 'Monitor recent admin activity on this contract',
      suggestedInput: { address: identity.address, chain: validated.chain },
    });
  }
  related.push({
    endpoint: '/v1/token-compare',
    description: 'Compare this token against others',
    suggestedInput: { primary: validated.query, compare: [], chain: validated.chain },
  });

  const output = tokenResearchOutput.parse({
    token: {
      name: identity.name,
      symbol: identity.symbol,
      address: identity.address,
      chain: validated.chain,
    },
    marketData: rawData.marketData ?? undefined,
    defiMetrics: rawData.defiMetrics ?? undefined,
    contractInfo: rawData.contractInfo ?? undefined,
    priceHistory: rawData.priceHistory ?? undefined,
    holderDistribution: rawData.holderDistribution ?? undefined,
    predictionMarkets: rawData.predictionMarkets ?? undefined,
    institutional: rawData.institutional ?? undefined,
    riskAssessment: rawData.riskAssessment ?? undefined,
    metadata: {
      sourcesQueried,
      sourcesSucceeded,
      sourcesFailed,
      cachedSources,
      processingTimeMs: Date.now() - startTime,
      estimatedCostUsd: totalCost,
    },
    relatedServices: related,
  });

  return { output, estimatedCostUsd: totalCost };
}
