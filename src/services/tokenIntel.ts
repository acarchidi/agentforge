import { callClaude, type ClaudeResponse } from '../llm/anthropic.js';
import { cleanLlmJson } from '../utils/cleanJson.js';
import { SimpleCache } from '../utils/cache.js';
import {
  tokenIntelInput,
  tokenIntelOutput,
  type TokenIntelInput,
  type TokenIntelOutput,
} from '../schemas/tokenIntel.js';

const SYSTEM_PROMPT = `You are a crypto token intelligence analyst. Given token contract data and market information, produce a risk assessment. You must return ONLY a JSON object. No markdown. No code fences. No preamble. No explanation.

Output JSON schema:
{
  "token": {
    "name": <string>,
    "symbol": <string>,
    "address": <string>,
    "chain": <string>,
    "decimals": <number or null>
  },
  "market": {
    "priceUsd": <number or null>,
    "marketCap": <number or null>,
    "volume24h": <number or null>,
    "priceChange24h": <number or null>
  },
  "risk": {
    "score": <number 0-100, 0=safe, 100=extremely risky>,
    "flags": [<string>, ...],
    "assessment": <string, one paragraph risk summary>
  }
}

Risk scoring guide:
- 0-20: Well-established, high liquidity, verified contracts
- 21-40: Legitimate but with some concerns (low volume, newer project)
- 41-60: Moderate risk (unverified, low liquidity, concentrated holders)
- 61-80: High risk (suspicious patterns, honeypot indicators)
- 81-100: Extreme risk (known scam indicators, malicious code patterns)

Common risk flags: "low_liquidity", "concentrated_holders", "unverified_contract", "no_audit", "honeypot_risk", "proxy_contract", "mint_function", "blacklist_function", "high_tax", "new_deployment"

You must return ONLY a JSON object. No markdown. No code fences. No preamble. No explanation.`;

// 60-second TTL cache for CoinGecko responses
const coinGeckoCache = new SimpleCache<Record<string, unknown>>(60);

async function fetchCoinGeckoData(
  address: string,
  chain: string,
): Promise<Record<string, unknown> | null> {
  const platformMap: Record<string, string> = {
    ethereum: 'ethereum',
    base: 'base',
    polygon: 'polygon-pos',
    arbitrum: 'arbitrum-one',
    solana: 'solana',
  };

  const platform = platformMap[chain];
  if (!platform) return null;

  const cacheKey = `${platform}:${address}`;
  const cached = coinGeckoCache.get(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/${platform}/contract/${address}`,
      { signal: AbortSignal.timeout(10000) },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    coinGeckoCache.set(cacheKey, data);
    return data;
  } catch {
    console.warn('CoinGecko unavailable, falling back to LLM-only analysis');
    return null;
  }
}

export interface TokenIntelResult {
  output: TokenIntelOutput;
  estimatedCostUsd: number;
}

export async function getTokenIntel(
  input: TokenIntelInput,
): Promise<TokenIntelOutput> {
  const result = await getTokenIntelWithCost(input);
  return result.output;
}

export async function getTokenIntelWithCost(
  input: TokenIntelInput,
): Promise<TokenIntelResult> {
  const validated = tokenIntelInput.parse(input);
  const startTime = Date.now();

  const sources: string[] = [];
  let marketContext = 'No market data available from CoinGecko.';

  const geckoData = await fetchCoinGeckoData(
    validated.address,
    validated.chain,
  );

  if (geckoData) {
    sources.push('coingecko');
    const md = geckoData.market_data as Record<string, unknown> | undefined;
    marketContext = `CoinGecko data found:
Name: ${geckoData.name ?? 'unknown'}
Symbol: ${geckoData.symbol ?? 'unknown'}
Market Cap Rank: ${geckoData.market_cap_rank ?? 'unranked'}
Price USD: ${md ? (md.current_price as Record<string, unknown>)?.usd : 'unknown'}
Market Cap: ${md ? (md.market_cap as Record<string, unknown>)?.usd : 'unknown'}
24h Volume: ${md ? (md.total_volume as Record<string, unknown>)?.usd : 'unknown'}
24h Change: ${md ? (md.price_change_percentage_24h as unknown) : 'unknown'}%`;
  }

  sources.push('llm-analysis');

  const prompt = `Token contract address: ${validated.address}
Chain: ${validated.chain}

Market data:
${marketContext}

Analyze this token and provide a comprehensive risk assessment.`;

  const response: ClaudeResponse = await callClaude({
    system: SYSTEM_PROMPT,
    userMessage: prompt,
    maxTokens: 1000,
    temperature: 0.2,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleanLlmJson(response.text));
  } catch {
    throw new Error(
      `LLM returned invalid JSON: ${response.text.slice(0, 200)}`,
    );
  }

  const output = tokenIntelOutput.parse({
    ...(parsed as Record<string, unknown>),
    metadata: {
      sources,
      processingTimeMs: Date.now() - startTime,
    },
    relatedServices: [
      {
        endpoint: '/v1/token-research',
        description: 'Deep multi-source research on this token',
        suggestedInput: { query: validated.address, chain: validated.chain },
      },
      {
        endpoint: '/v1/contract-docs',
        description: 'Generate documentation for this contract',
        suggestedInput: { address: validated.address, chain: validated.chain },
      },
      {
        endpoint: '/v1/contract-monitor',
        description: 'Monitor recent admin activity on this contract',
        suggestedInput: { address: validated.address, chain: validated.chain },
      },
    ],
  });

  return { output, estimatedCostUsd: response.usage.estimatedCostUsd };
}
