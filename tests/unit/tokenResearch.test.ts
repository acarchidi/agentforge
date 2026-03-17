import { describe, it, expect } from 'vitest';
import {
  tokenResearchInput,
  tokenResearchOutput,
} from '../../src/schemas/tokenResearch.js';

describe('Token Research Schema Validation', () => {
  // ── Input schema ──────────────────────────────────────────────────

  it('accepts valid input with defaults', () => {
    const result = tokenResearchInput.parse({ query: 'ethereum' });
    expect(result.chain).toBe('ethereum');
    expect(result.include).toEqual([
      'market_data',
      'defi_metrics',
      'contract_info',
      'risk_assessment',
    ]);
  });

  it('accepts valid input with all options including new modules', () => {
    const result = tokenResearchInput.parse({
      query: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      chain: 'base',
      include: ['market_data', 'prediction_markets', 'institutional', 'price_history', 'holders'],
    });
    expect(result.chain).toBe('base');
    expect(result.include).toHaveLength(5);
    expect(result.include).toContain('price_history');
    expect(result.include).toContain('holders');
  });

  it('accepts all valid chains', () => {
    for (const chain of [
      'ethereum', 'base', 'polygon', 'arbitrum', 'optimism', 'avalanche',
    ] as const) {
      const result = tokenResearchInput.parse({ query: 'ETH', chain });
      expect(result.chain).toBe(chain);
    }
  });

  it('rejects empty query', () => {
    expect(() => tokenResearchInput.parse({ query: '' })).toThrow();
  });

  it('rejects query over 200 chars', () => {
    expect(() =>
      tokenResearchInput.parse({ query: 'a'.repeat(201) }),
    ).toThrow();
  });

  it('rejects invalid chain', () => {
    expect(() =>
      tokenResearchInput.parse({ query: 'ETH', chain: 'solana' }),
    ).toThrow();
  });

  it('rejects invalid include module', () => {
    expect(() =>
      tokenResearchInput.parse({ query: 'ETH', include: ['invalid_module'] }),
    ).toThrow();
  });

  // ── Output schema ─────────────────────────────────────────────────

  it('validates minimal output (no optional sections)', () => {
    const output = tokenResearchOutput.parse({
      token: { name: 'Ethereum', symbol: 'ETH', chain: 'ethereum' },
      metadata: {
        sourcesQueried: ['coingecko'],
        sourcesSucceeded: ['coingecko'],
        sourcesFailed: [],
        processingTimeMs: 500,
        estimatedCostUsd: 0.003,
        cachedSources: [],
      },
    });
    expect(output.token.symbol).toBe('ETH');
    expect(output.marketData).toBeUndefined();
    expect(output.defiMetrics).toBeUndefined();
  });

  it('validates full output with all sections', () => {
    const output = tokenResearchOutput.parse({
      token: {
        name: 'Ethereum',
        symbol: 'ETH',
        address: '0x0000000000000000000000000000000000000000',
        chain: 'ethereum',
      },
      marketData: {
        priceUsd: 3500,
        marketCap: 420000000000,
        fullyDilutedValuation: 420000000000,
        volume24h: 15000000000,
        priceChange24h: 2.5,
        priceChange7d: -1.2,
        priceChange30d: 8.0,
        allTimeHigh: 4800,
        allTimeHighDate: '2021-11-10',
        circulatingSupply: 120000000,
        totalSupply: null,
        source: 'coingecko',
      },
      defiMetrics: {
        tvl: 50000000000,
        tvlChange24h: 1.2,
        tvlChange7d: -0.5,
        category: 'Chain',
        chains: ['Ethereum'],
        associatedProtocols: [{ name: 'Uniswap', tvl: 5000000000 }],
        source: 'defillama',
      },
      contractInfo: {
        isVerified: true,
        compilerVersion: '0.8.20',
        optimizationUsed: true,
        contractName: 'WETH',
        creationTxHash: '0xabc',
        creatorAddress: '0xdef',
        implementationAddress: null,
        isProxy: false,
        source: 'etherscan',
      },
      predictionMarkets: {
        relatedMarkets: [
          {
            title: 'ETH above $5k by Dec 2026?',
            outcomePrices: { yes: 0.45, no: 0.55 },
            volume: 100000,
            slug: 'eth-above-5k',
            url: 'https://polymarket.com/event/eth-above-5k',
          },
        ],
        source: 'polymarket',
      },
      institutional: {
        mentions: [
          {
            institution: 'BlackRock',
            context: 'Filed for spot ETH ETF',
            sentiment: 'positive',
            approximate_date: '2024-01',
          },
        ],
        summary: 'Major institutional interest in Ethereum',
        source: 'llm_analysis',
      },
      riskAssessment: {
        overallScore: 15,
        riskLevel: 'low',
        factors: [
          {
            factor: 'Market cap',
            impact: 'positive',
            detail: 'Very high market cap reduces manipulation risk',
          },
        ],
        summary: 'Low-risk major cryptocurrency',
      },
      metadata: {
        sourcesQueried: ['coingecko', 'defillama', 'etherscan', 'polymarket', 'llm_analysis'],
        sourcesSucceeded: ['coingecko', 'defillama', 'etherscan', 'polymarket', 'llm_analysis'],
        sourcesFailed: [],
        processingTimeMs: 3200,
        estimatedCostUsd: 0.006,
        cachedSources: [],
      },
    });
    expect(output.marketData?.priceUsd).toBe(3500);
    expect(output.riskAssessment?.overallScore).toBe(15);
  });

  it('rejects risk score above 100', () => {
    expect(() =>
      tokenResearchOutput.parse({
        token: { name: 'T', symbol: 'T', chain: 'eth' },
        riskAssessment: {
          overallScore: 101,
          riskLevel: 'critical',
          factors: [],
          summary: 'test',
        },
        metadata: {
          sourcesQueried: [],
          sourcesSucceeded: [],
          sourcesFailed: [],
          processingTimeMs: 0,
          estimatedCostUsd: 0,
          cachedSources: [],
        },
      }),
    ).toThrow();
  });

  it('rejects invalid risk level', () => {
    expect(() =>
      tokenResearchOutput.parse({
        token: { name: 'T', symbol: 'T', chain: 'eth' },
        riskAssessment: {
          overallScore: 50,
          riskLevel: 'extreme', // not a valid level
          factors: [],
          summary: 'test',
        },
        metadata: {
          sourcesQueried: [],
          sourcesSucceeded: [],
          sourcesFailed: [],
          processingTimeMs: 0,
          estimatedCostUsd: 0,
          cachedSources: [],
        },
      }),
    ).toThrow();
  });

  it('validates priceHistory section', () => {
    const output = tokenResearchOutput.parse({
      token: { name: 'T', symbol: 'T', chain: 'ethereum' },
      priceHistory: {
        prices30d: [
          { date: '2025-01-01', priceUsd: 3500 },
          { date: '2025-01-02', priceUsd: 3550 },
        ],
        volatility30d: 0.12,
        trend: 'up',
        maxDrawdown30d: 0.05,
        source: 'defillama',
      },
      metadata: {
        sourcesQueried: ['defillama'],
        sourcesSucceeded: ['defillama'],
        sourcesFailed: [],
        processingTimeMs: 200,
        estimatedCostUsd: 0.001,
        cachedSources: [],
      },
    });
    expect(output.priceHistory?.prices30d).toHaveLength(2);
    expect(output.priceHistory?.trend).toBe('up');
    expect(output.priceHistory?.source).toBe('defillama');
  });

  it('validates holderDistribution section', () => {
    const output = tokenResearchOutput.parse({
      token: { name: 'T', symbol: 'T', chain: 'ethereum' },
      holderDistribution: {
        topHolders: [
          {
            address: '0xabc',
            balance: '1000000',
            percentage: 10.5,
            isContract: true,
            label: 'Uniswap V3 Pool',
          },
        ],
        concentration: {
          top5Percentage: 45.2,
          top10Percentage: 62.1,
          top20Percentage: 78.5,
        },
        riskFlag: true,
        source: 'etherscan',
      },
      metadata: {
        sourcesQueried: ['etherscan'],
        sourcesSucceeded: ['etherscan'],
        sourcesFailed: [],
        processingTimeMs: 300,
        estimatedCostUsd: 0.001,
        cachedSources: [],
      },
    });
    expect(output.holderDistribution?.topHolders).toHaveLength(1);
    expect(output.holderDistribution?.concentration.top5Percentage).toBe(45.2);
    expect(output.holderDistribution?.riskFlag).toBe(true);
    expect(output.holderDistribution?.source).toBe('etherscan');
  });

  it('rejects invalid priceHistory trend', () => {
    expect(() =>
      tokenResearchOutput.parse({
        token: { name: 'T', symbol: 'T', chain: 'ethereum' },
        priceHistory: {
          prices30d: [],
          volatility30d: 0,
          trend: 'bullish',
          maxDrawdown30d: 0,
          source: 'defillama',
        },
        metadata: {
          sourcesQueried: [],
          sourcesSucceeded: [],
          sourcesFailed: [],
          processingTimeMs: 0,
          estimatedCostUsd: 0,
          cachedSources: [],
        },
      }),
    ).toThrow();
  });

  it('accepts output with relatedServices', () => {
    const output = tokenResearchOutput.parse({
      token: { name: 'T', symbol: 'T', chain: 'eth' },
      metadata: {
        sourcesQueried: [],
        sourcesSucceeded: [],
        sourcesFailed: [],
        processingTimeMs: 0,
        estimatedCostUsd: 0,
        cachedSources: [],
      },
      relatedServices: [
        { endpoint: '/v1/contract-docs', description: 'Generate docs', suggestedInput: { address: '0x', chain: 'ethereum' } },
        { endpoint: '/v1/token-compare', description: 'Compare', suggestedInput: { primary: 'ETH', compare: [] } },
      ],
    });
    expect(output.relatedServices).toHaveLength(2);
  });

  it('market data source must be coingecko literal', () => {
    expect(() =>
      tokenResearchOutput.parse({
        token: { name: 'T', symbol: 'T', chain: 'eth' },
        marketData: {
          priceUsd: 1,
          marketCap: null,
          fullyDilutedValuation: null,
          volume24h: null,
          priceChange24h: null,
          priceChange7d: null,
          priceChange30d: null,
          allTimeHigh: null,
          allTimeHighDate: null,
          circulatingSupply: null,
          totalSupply: null,
          source: 'unknown', // not 'coingecko'
        },
        metadata: {
          sourcesQueried: [],
          sourcesSucceeded: [],
          sourcesFailed: [],
          processingTimeMs: 0,
          estimatedCostUsd: 0,
          cachedSources: [],
        },
      }),
    ).toThrow();
  });
});
