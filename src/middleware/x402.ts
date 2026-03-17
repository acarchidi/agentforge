import { paymentMiddlewareFromConfig } from '@x402/express';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { facilitator } from '@coinbase/x402';
import { declareDiscoveryExtension } from '@x402/extensions/bazaar';
import { config, networkId } from '../config.js';

export function createPaymentMiddleware() {
  const routeConfig = {
    'POST /v1/token-intel': {
      accepts: [{
        scheme: 'exact' as const,
        price: config.PRICE_TOKEN_INTEL,
        network: networkId,
        payTo: config.PAY_TO_ADDRESS,
      }],
      description: 'Token metadata enrichment with market data and AI-generated risk assessment for EVM and Solana tokens. Returns token info, price data, and risk scoring.',
      mimeType: 'application/json',
      extensions: {
        ...declareDiscoveryExtension({
          bodyType: 'json' as const,
          inputSchema: {
            type: 'object',
            required: ['address'],
            properties: {
              address: { type: 'string', minLength: 1, description: 'Token contract address' },
              chain: { type: 'string', enum: ['ethereum', 'base', 'solana', 'polygon', 'arbitrum'], default: 'ethereum' },
            },
          },
          output: {
            schema: {
              type: 'object',
              required: ['token', 'market', 'risk', 'metadata'],
              properties: {
                token: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' }, symbol: { type: 'string' },
                    address: { type: 'string' }, chain: { type: 'string' },
                    decimals: { type: 'number' },
                  },
                },
                market: {
                  type: 'object',
                  properties: {
                    priceUsd: { type: 'number' }, marketCap: { type: 'number' },
                    volume24h: { type: 'number' }, priceChange24h: { type: 'number' },
                  },
                },
                risk: {
                  type: 'object',
                  properties: {
                    score: { type: 'number', minimum: 0, maximum: 100 },
                    flags: { type: 'array', items: { type: 'string' } },
                    assessment: { type: 'string' },
                  },
                },
                metadata: {
                  type: 'object',
                  properties: {
                    sources: { type: 'array', items: { type: 'string' } },
                    processingTimeMs: { type: 'number' },
                  },
                },
              },
            },
          },
        }),
      },
    },
    'POST /v1/code-review': {
      accepts: [{
        scheme: 'exact' as const,
        price: config.PRICE_CODE_REVIEW,
        network: networkId,
        payTo: config.PAY_TO_ADDRESS,
      }],
      description: 'Smart contract security analysis with gas optimization and diff review mode. Supports Solidity, Rust, Move, TypeScript. Returns severity-ranked issues with line numbers, categories, and fix suggestions.',
      mimeType: 'application/json',
      extensions: {
        ...declareDiscoveryExtension({
          bodyType: 'json' as const,
          inputSchema: {
            type: 'object',
            required: ['code'],
            properties: {
              code: { type: 'string', minLength: 1, maxLength: 50000, description: 'Source code to review' },
              previousCode: { type: 'string', maxLength: 50000, description: 'Previous version of code for diff review mode' },
              language: { type: 'string', enum: ['solidity', 'rust', 'move', 'typescript'], default: 'solidity' },
              focus: { type: 'string', enum: ['security', 'gas_optimization', 'best_practices', 'all'], default: 'all' },
            },
          },
          output: {
            schema: {
              type: 'object',
              required: ['overallRisk', 'issues', 'summary', 'metadata'],
              properties: {
                overallRisk: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
                issues: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      severity: { type: 'string', enum: ['info', 'low', 'medium', 'high', 'critical'] },
                      category: { type: 'string' }, description: { type: 'string' },
                      line: { type: 'number' }, suggestion: { type: 'string' },
                    },
                  },
                },
                gasOptimization: { type: 'object', description: 'Gas optimization report (when focus includes gas)' },
                summary: { type: 'string' },
                metadata: {
                  type: 'object',
                  properties: {
                    model: { type: 'string' }, processingTimeMs: { type: 'number' },
                    linesAnalyzed: { type: 'number' },
                  },
                },
              },
            },
          },
        }),
      },
    },
    'POST /v1/token-research': {
      accepts: [{
        scheme: 'exact' as const,
        price: config.PRICE_TOKEN_RESEARCH,
        network: networkId,
        payTo: config.PAY_TO_ADDRESS,
      }],
      description: 'Multi-source token research: market data (CoinGecko), DeFi metrics (DeFiLlama), contract verification (Etherscan), prediction markets (Polymarket), price history, holder distribution, and AI risk assessment.',
      mimeType: 'application/json',
      extensions: {
        ...declareDiscoveryExtension({
          bodyType: 'json' as const,
          inputSchema: {
            type: 'object',
            required: ['query'],
            properties: {
              query: { type: 'string', minLength: 1, maxLength: 200, description: 'Token name, symbol, or contract address' },
              chain: { type: 'string', enum: ['ethereum', 'base', 'polygon', 'arbitrum', 'optimism', 'avalanche'], default: 'ethereum' },
              include: { type: 'array', items: { type: 'string', enum: ['market_data', 'defi_metrics', 'contract_info', 'prediction_markets', 'institutional', 'risk_assessment', 'price_history', 'holders'] } },
            },
          },
          output: {
            schema: {
              type: 'object',
              required: ['token', 'metadata'],
              properties: {
                token: { type: 'object' },
                marketData: { type: 'object' },
                defiMetrics: { type: 'object' },
                contractInfo: { type: 'object' },
                predictionMarkets: { type: 'object' },
                institutional: { type: 'object' },
                riskAssessment: { type: 'object' },
                priceHistory: { type: 'object' },
                holderDistribution: { type: 'object' },
                metadata: { type: 'object' },
              },
            },
          },
        }),
      },
    },
    'POST /v1/contract-docs': {
      accepts: [{
        scheme: 'exact' as const,
        price: config.PRICE_CONTRACT_DOCS,
        network: networkId,
        payTo: config.PAY_TO_ADDRESS,
      }],
      description: 'Generate human-readable documentation for any verified smart contract. Returns function descriptions, parameter explanations, risk flags, interaction patterns, security posture, and admin capability analysis.',
      mimeType: 'application/json',
      extensions: {
        ...declareDiscoveryExtension({
          bodyType: 'json' as const,
          inputSchema: {
            type: 'object',
            required: ['address'],
            properties: {
              address: { type: 'string', minLength: 1, description: 'Contract address' },
              chain: { type: 'string', enum: ['ethereum', 'base', 'polygon', 'arbitrum', 'optimism', 'avalanche'], default: 'ethereum' },
              focusFunctions: { type: 'array', items: { type: 'string' }, description: 'Optional list of function names to focus on' },
            },
          },
          output: {
            schema: {
              type: 'object',
              required: ['contract', 'functions', 'events', 'summary', 'metadata'],
              properties: {
                contract: { type: 'object' },
                functions: { type: 'array' },
                events: { type: 'array' },
                interactionPatterns: { type: 'array' },
                securityPosture: { type: 'object' },
                summary: { type: 'object' },
                metadata: { type: 'object' },
              },
            },
          },
        }),
      },
    },
    'POST /v1/contract-monitor': {
      accepts: [{
        scheme: 'exact' as const,
        price: config.PRICE_CONTRACT_MONITOR,
        network: networkId,
        payTo: config.PAY_TO_ADDRESS,
      }],
      description: 'Monitor recent contract admin activity. Detects ownership transfers, implementation upgrades, pause state changes, and other admin operations. Returns risk assessment.',
      mimeType: 'application/json',
      extensions: {
        ...declareDiscoveryExtension({
          bodyType: 'json' as const,
          inputSchema: {
            type: 'object',
            required: ['address'],
            properties: {
              address: { type: 'string', minLength: 1, description: 'Contract address to monitor' },
              chain: { type: 'string', enum: ['ethereum', 'base', 'polygon', 'arbitrum', 'optimism', 'avalanche'], default: 'ethereum' },
              lookbackHours: { type: 'number', minimum: 1, maximum: 168, default: 24, description: 'Hours of activity to analyze' },
            },
          },
          output: {
            schema: {
              type: 'object',
              required: ['contract', 'recentActivity', 'riskAlert', 'metadata'],
              properties: {
                contract: { type: 'object' },
                recentActivity: { type: 'object' },
                riskAlert: { type: 'object' },
                metadata: { type: 'object' },
              },
            },
          },
        }),
      },
    },
    'POST /v1/token-compare': {
      accepts: [{
        scheme: 'exact' as const,
        price: config.PRICE_TOKEN_COMPARE,
        network: networkId,
        payTo: config.PAY_TO_ADDRESS,
      }],
      description: 'Compare a primary token against up to 3 competitors. Returns full research on the primary token, abbreviated metrics for comparisons, and AI-generated comparative analysis.',
      mimeType: 'application/json',
      extensions: {
        ...declareDiscoveryExtension({
          bodyType: 'json' as const,
          inputSchema: {
            type: 'object',
            required: ['primary', 'compare'],
            properties: {
              primary: { type: 'string', minLength: 1, description: 'Primary token name, symbol, or address' },
              compare: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3, description: 'Tokens to compare against' },
              chain: { type: 'string', enum: ['ethereum', 'base', 'polygon', 'arbitrum', 'optimism', 'avalanche'], default: 'ethereum' },
            },
          },
          output: {
            schema: {
              type: 'object',
              required: ['primary', 'comparisons', 'analysis', 'metadata'],
              properties: {
                primary: { type: 'object' },
                comparisons: { type: 'array' },
                analysis: { type: 'string' },
                metadata: { type: 'object' },
              },
            },
          },
        }),
      },
    },
    'POST /v1/tx-decode': {
      accepts: [{
        scheme: 'exact' as const,
        price: config.PRICE_TX_DECODE,
        network: networkId,
        payTo: config.PAY_TO_ADDRESS,
      }],
      description: 'Decode any EVM transaction: function call, parameters, token transfers, and plain-English explanation.',
      mimeType: 'application/json',
      extensions: {
        ...declareDiscoveryExtension({
          bodyType: 'json' as const,
          inputSchema: {
            type: 'object',
            required: ['txHash'],
            properties: {
              txHash: { type: 'string', pattern: '^0x[a-fA-F0-9]{64}$', description: 'Transaction hash' },
              chain: { type: 'string', enum: ['ethereum', 'base', 'polygon', 'arbitrum', 'optimism', 'avalanche'], default: 'ethereum' },
            },
          },
          output: {
            schema: {
              type: 'object',
              required: ['transaction', 'explanation', 'tokenTransfers', 'metadata'],
              properties: {
                transaction: { type: 'object' },
                decodedCall: { type: 'object' },
                explanation: { type: 'string' },
                tokenTransfers: { type: 'array' },
                metadata: { type: 'object' },
              },
            },
          },
        }),
      },
    },
    'POST /v1/approval-scan': {
      accepts: [{
        scheme: 'exact' as const,
        price: config.PRICE_APPROVAL_SCAN,
        network: networkId,
        payTo: config.PAY_TO_ADDRESS,
      }],
      description: 'Scan a wallet for risky ERC-20 token approvals. Identifies unlimited approvals, unverified spender contracts, and generates risk assessment.',
      mimeType: 'application/json',
      extensions: {
        ...declareDiscoveryExtension({
          bodyType: 'json' as const,
          inputSchema: {
            type: 'object',
            required: ['address'],
            properties: {
              address: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$', description: 'Wallet address to scan' },
              chain: { type: 'string', enum: ['ethereum', 'base', 'polygon', 'arbitrum', 'optimism', 'avalanche'], default: 'ethereum' },
            },
          },
          output: {
            schema: {
              type: 'object',
              required: ['wallet', 'approvals', 'summary', 'metadata'],
              properties: {
                wallet: { type: 'object' },
                approvals: { type: 'array' },
                summary: { type: 'object' },
                metadata: { type: 'object' },
              },
            },
          },
        }),
      },
    },
    'POST /v1/sentiment': {
      accepts: [{
        scheme: 'exact' as const,
        price: config.PRICE_SENTIMENT,
        network: networkId,
        payTo: config.PAY_TO_ADDRESS,
      }],
      description: 'AI-powered sentiment analysis for crypto, finance, and social media text. Returns sentiment score (-1 to 1), confidence, label (very_bearish to very_bullish), reasoning, and per-entity sentiment.',
      mimeType: 'application/json',
      extensions: {
        ...declareDiscoveryExtension({
          bodyType: 'json' as const,
          inputSchema: {
            type: 'object',
            required: ['text'],
            properties: {
              text: { type: 'string', minLength: 1, maxLength: 10000, description: 'Text to analyze for sentiment' },
              context: { type: 'string', enum: ['crypto', 'finance', 'general', 'social_media'], default: 'crypto' },
            },
          },
          output: {
            schema: {
              type: 'object',
              required: ['sentiment', 'confidence', 'label', 'reasoning', 'entities', 'metadata'],
              properties: {
                sentiment: { type: 'number', minimum: -1, maximum: 1 },
                confidence: { type: 'number', minimum: 0, maximum: 1 },
                label: { type: 'string', enum: ['very_bearish', 'bearish', 'neutral', 'bullish', 'very_bullish'] },
                reasoning: { type: 'string' },
                entities: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, sentiment: { type: 'number' } } } },
                metadata: { type: 'object', properties: { model: { type: 'string' }, processingTimeMs: { type: 'number' } } },
              },
            },
          },
        }),
      },
    },
    'POST /v1/summarize': {
      accepts: [{
        scheme: 'exact' as const,
        price: config.PRICE_SUMMARIZE,
        network: networkId,
        payTo: config.PAY_TO_ADDRESS,
      }],
      description: 'AI-powered text summarization with configurable length (brief/standard/detailed), format (prose/bullet_points/structured), and optional topic focus. Returns summary, key points, and compression ratio.',
      mimeType: 'application/json',
      extensions: {
        ...declareDiscoveryExtension({
          bodyType: 'json' as const,
          inputSchema: {
            type: 'object',
            required: ['text'],
            properties: {
              text: { type: 'string', minLength: 1, maxLength: 50000, description: 'Text to summarize' },
              maxLength: { type: 'string', enum: ['brief', 'standard', 'detailed'], default: 'standard' },
              format: { type: 'string', enum: ['prose', 'bullet_points', 'structured'], default: 'structured' },
              focus: { type: 'string', maxLength: 200, description: 'Optional topic to focus the summary on' },
            },
          },
          output: {
            schema: {
              type: 'object',
              required: ['summary', 'keyPoints', 'wordCount', 'compressionRatio', 'metadata'],
              properties: {
                summary: { type: 'string' },
                keyPoints: { type: 'array', items: { type: 'string' } },
                wordCount: { type: 'number' },
                compressionRatio: { type: 'number' },
                metadata: { type: 'object', properties: { model: { type: 'string' }, processingTimeMs: { type: 'number' } } },
              },
            },
          },
        }),
      },
    },
    'POST /v1/translate': {
      accepts: [{
        scheme: 'exact' as const,
        price: config.PRICE_TRANSLATE,
        network: networkId,
        payTo: config.PAY_TO_ADDRESS,
      }],
      description: 'AI-powered text translation with tone control (formal/casual/technical). Automatically detects source language. Preserves formatting and cultural nuances.',
      mimeType: 'application/json',
      extensions: {
        ...declareDiscoveryExtension({
          bodyType: 'json' as const,
          inputSchema: {
            type: 'object',
            required: ['text', 'targetLanguage'],
            properties: {
              text: { type: 'string', minLength: 1, maxLength: 20000, description: 'Text to translate' },
              targetLanguage: { type: 'string', minLength: 2, maxLength: 50, description: 'Target language (e.g., Spanish, French, Japanese)' },
              sourceLanguage: { type: 'string', description: 'Source language (auto-detected if omitted)' },
              tone: { type: 'string', enum: ['formal', 'casual', 'technical'], default: 'formal' },
            },
          },
          output: {
            schema: {
              type: 'object',
              required: ['translatedText', 'detectedSourceLanguage', 'targetLanguage', 'metadata'],
              properties: {
                translatedText: { type: 'string' },
                detectedSourceLanguage: { type: 'string' },
                targetLanguage: { type: 'string' },
                metadata: { type: 'object', properties: { model: { type: 'string' }, processingTimeMs: { type: 'number' } } },
              },
            },
          },
        }),
      },
    },
    'POST /v1/wallet-safety': {
      accepts: [{
        scheme: 'exact' as const,
        price: config.PRICE_WALLET_SAFETY,
        network: networkId,
        payTo: config.PAY_TO_ADDRESS,
      }],
      description: 'Comprehensive wallet safety check combining approval scanning, recent transaction analysis, and contract interaction assessment. The endpoint an agent calls before executing any DeFi transaction.',
      mimeType: 'application/json',
      extensions: {
        ...declareDiscoveryExtension({
          bodyType: 'json' as const,
          inputSchema: {
            type: 'object',
            required: ['walletAddress'],
            properties: {
              walletAddress: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$', description: 'Wallet address to check' },
              chain: { type: 'string', enum: ['ethereum', 'base', 'arbitrum', 'optimism', 'polygon'], default: 'ethereum' },
              targetContract: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$', description: 'Target contract to assess before interaction' },
              depth: { type: 'string', enum: ['quick', 'standard', 'deep'], default: 'standard' },
            },
          },
          output: {
            schema: {
              type: 'object',
              required: ['walletAddress', 'chain', 'overallRisk', 'riskScore', 'approvals', 'summary', 'actionItems'],
              properties: {
                walletAddress: { type: 'string' },
                chain: { type: 'string' },
                overallRisk: { type: 'string', enum: ['safe', 'low', 'medium', 'high', 'critical', 'unknown'] },
                riskScore: { type: 'number', minimum: 0, maximum: 100 },
                approvals: { type: 'object' },
                recentActivity: { type: 'object' },
                targetContractAssessment: { type: 'object' },
                summary: { type: 'string' },
                actionItems: { type: 'array', items: { type: 'string' } },
                relatedServices: { type: 'array' },
              },
            },
          },
        }),
      },
    },
    'GET /v1/gas': {
      accepts: [{
        scheme: 'exact' as const,
        price: config.PRICE_GAS,
        network: networkId,
        payTo: config.PAY_TO_ADDRESS,
      }],
      description: 'Current gas prices (slow/standard/fast) for any supported EVM chain with trend analysis.',
      mimeType: 'application/json',
      extensions: {
        ...declareDiscoveryExtension({
          output: {
            schema: {
              type: 'object',
              required: ['chain', 'currentPrices', 'trend', 'timestamp', 'metadata'],
              properties: {
                chain: { type: 'string' },
                currentPrices: { type: 'object' },
                baseFee: { type: 'number' },
                trend: { type: 'string', enum: ['rising', 'falling', 'stable'] },
                timestamp: { type: 'string' },
                metadata: { type: 'object' },
              },
            },
          },
        }),
      },
    },
    'GET /v1/ping': {
      accepts: [{
        scheme: 'exact' as const,
        price: '$0.001',
        network: networkId,
        payTo: config.PAY_TO_ADDRESS,
      }],
      description: 'Minimal paid endpoint to verify x402 payment flow. Returns server status and timestamp.',
      mimeType: 'application/json',
      extensions: {
        ...declareDiscoveryExtension({
          output: {
            schema: {
              type: 'object',
              properties: {
                status: { type: 'string' },
                timestamp: { type: 'string', format: 'date-time' },
                message: { type: 'string' },
              },
            },
          },
        }),
      },
    },
  };

  const evmScheme = new ExactEvmScheme();

  // Use CDP facilitator for mainnet (Base), default x402.org for testnet
  const facilitatorClient = config.X402_NETWORK === 'base'
    ? new HTTPFacilitatorClient(facilitator)
    : undefined;

  return paymentMiddlewareFromConfig(
    routeConfig,
    facilitatorClient,
    [{ network: networkId, server: evmScheme }],
  );
}
