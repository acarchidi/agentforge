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
          input: {
            address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
            chain: 'ethereum',
          },
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
            example: {
              token: { name: 'Wrapped Ether', symbol: 'WETH', address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', chain: 'ethereum', decimals: 18 },
              market: { priceUsd: 3500.12, marketCap: 12000000000, volume24h: 500000000, priceChange24h: 2.3 },
              risk: { score: 5, flags: [], assessment: 'Low risk — canonical wrapped ETH contract.' },
              metadata: { sources: ['coingecko'], processingTimeMs: 120 },
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
          input: {
            code: 'pragma solidity ^0.8.0;\ncontract Example {\n  function withdraw() public {\n    payable(msg.sender).transfer(address(this).balance);\n  }\n}',
            language: 'solidity',
            focus: 'security',
          },
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
            example: {
              overallRisk: 'high',
              issues: [{ severity: 'high', category: 'access-control', description: 'withdraw() has no access control modifier', line: 3, suggestion: 'Add an onlyOwner modifier or equivalent check' }],
              summary: '1 high severity issue found: missing access control on withdraw().',
              metadata: { model: 'claude-sonnet-5', processingTimeMs: 850, linesAnalyzed: 5 },
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
          input: {
            query: 'AAVE',
            chain: 'ethereum',
            include: ['market_data', 'risk_assessment'],
          },
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
            example: {
              token: { name: 'Aave', symbol: 'AAVE', chain: 'ethereum' },
              marketData: { priceUsd: 95.4, marketCap: 1400000000 },
              riskAssessment: { score: 20, level: 'low' },
              metadata: { sources: ['coingecko', 'defillama'], processingTimeMs: 900 },
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
          input: {
            address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9',
            chain: 'ethereum',
          },
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
            example: {
              contract: { address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', name: 'AaveToken', isVerified: true },
              functions: [{ name: 'transfer', description: 'Transfers tokens to a recipient', riskLevel: 'low' }],
              events: [{ name: 'Transfer' }],
              summary: { totalFunctions: 12, riskLevel: 'low', overview: 'Standard ERC-20 governance token contract.' },
              metadata: { model: 'claude-sonnet-5', processingTimeMs: 650, abiSize: 40 },
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
          input: {
            address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9',
            chain: 'ethereum',
            lookbackHours: 24,
          },
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
            example: {
              contract: { address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', chain: 'ethereum' },
              recentActivity: { adminActionsCount: 0, lookbackHours: 24 },
              riskAlert: { level: 'none', reasons: [] },
              metadata: { processingTimeMs: 420 },
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
          input: {
            primary: 'AAVE',
            compare: ['COMP', 'UNI'],
            chain: 'ethereum',
          },
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
            example: {
              primary: { symbol: 'AAVE', priceUsd: 95.4 },
              comparisons: [{ symbol: 'COMP', priceUsd: 45.1 }, { symbol: 'UNI', priceUsd: 6.2 }],
              analysis: 'AAVE has the largest market cap and TVL among the three compared protocols.',
              metadata: { processingTimeMs: 1500 },
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
          input: {
            txHash: '0xb7219192723c6a9ee77cd56ffdd28805d6177f76ffe0d34260bb5dc76abf19cf',
            chain: 'ethereum',
          },
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
            example: {
              transaction: { hash: '0xb7219192723c6a9ee77cd56ffdd28805d6177f76ffe0d34260bb5dc76abf19cf', from: '0x0000000000000000000000000000000000dEaD', to: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', value: '0' },
              decodedCall: { name: 'transfer', signature: 'transfer(address,uint256)' },
              explanation: 'Standard ERC-20 transfer call.',
              tokenTransfers: [{ token: 'WETH', from: '0x0000000000000000000000000000000000dEaD', to: '0x...', amount: '1.5' }],
              metadata: { processingTimeMs: 300 },
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
          input: {
            address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9',
            chain: 'ethereum',
          },
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
            example: {
              wallet: { address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', chain: 'ethereum' },
              approvals: [{ token: 'USDC', spender: '0x...', amount: 'unlimited', riskLevel: 'medium' }],
              summary: { totalApprovals: 1, riskyApprovals: 0 },
              metadata: { processingTimeMs: 500 },
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
          input: {
            text: 'Bitcoin just broke its all-time high, huge bullish momentum building.',
            context: 'crypto',
          },
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
            example: {
              sentiment: 0.8,
              confidence: 0.9,
              label: 'very_bullish',
              reasoning: 'Text expresses strong positive price momentum with no hedging language.',
              entities: [{ name: 'Bitcoin', sentiment: 0.8 }],
              metadata: { model: 'claude-sonnet-5', processingTimeMs: 250 },
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
          input: {
            text: 'DeFi lending protocols allow users to lend and borrow crypto assets without intermediaries. Borrowers must over-collateralize their loans, and positions that fall below a required collateral ratio are liquidated to protect lenders.',
            maxLength: 'brief',
            format: 'bullet_points',
          },
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
            example: {
              summary: 'DeFi lending protocols use over-collateralization and liquidations to manage risk without intermediaries.',
              keyPoints: ['No intermediaries', 'Over-collateralized loans', 'Liquidation below required ratio'],
              wordCount: 14,
              compressionRatio: 2.9,
              metadata: { model: 'claude-sonnet-5', processingTimeMs: 400 },
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
          input: {
            text: 'Hello, how are you?',
            targetLanguage: 'Spanish',
            tone: 'casual',
          },
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
            example: {
              translatedText: 'Hola, ¿cómo estás?',
              detectedSourceLanguage: 'English',
              targetLanguage: 'Spanish',
              metadata: { model: 'claude-sonnet-5', processingTimeMs: 180 },
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
          input: {
            walletAddress: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9',
            chain: 'ethereum',
            depth: 'standard',
          },
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
            example: {
              walletAddress: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9',
              chain: 'ethereum',
              overallRisk: 'low',
              riskScore: 15,
              approvals: { riskyCount: 0, totalCount: 3 },
              summary: 'No high-risk approvals or suspicious recent activity detected.',
              actionItems: [],
              relatedServices: [],
            },
          },
        }),
      },
    },
    'POST /v1/token-risk-metrics': {
      accepts: [{
        scheme: 'exact' as const,
        price: config.PRICE_TOKEN_RISK_METRICS,
        network: networkId,
        payTo: config.PAY_TO_ADDRESS,
      }],
      description: 'Quantitative token risk metrics: holder concentration, liquidity depth, contract permissions (mint/burn/pause/blacklist), deployer history, and composite risk score (0-100). Pre-computed for top tokens, live computation for others.',
      mimeType: 'application/json',
      extensions: {
        ...declareDiscoveryExtension({
          bodyType: 'json' as const,
          input: {
            address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9',
            chain: 'ethereum',
          },
          inputSchema: {
            type: 'object',
            required: ['address'],
            properties: {
              address: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$', description: 'Token contract address' },
              chain: { type: 'string', enum: ['ethereum', 'base', 'arbitrum', 'optimism', 'polygon'], default: 'ethereum' },
            },
          },
          output: {
            schema: {
              type: 'object',
              required: ['address', 'chain', 'source', 'computedAt', 'holders', 'liquidity', 'permissions', 'deployer', 'overallRisk'],
              properties: {
                address: { type: 'string' },
                chain: { type: 'string' },
                source: { type: 'string', enum: ['cached', 'live'] },
                computedAt: { type: 'string' },
                holders: { type: 'object' },
                liquidity: { type: 'object' },
                permissions: { type: 'object' },
                deployer: { type: 'object' },
                overallRisk: { type: 'object', properties: { score: { type: 'number', minimum: 0, maximum: 100 }, level: { type: 'string' }, flags: { type: 'array', items: { type: 'string' } } } },
                relatedServices: { type: 'array' },
              },
            },
            example: {
              address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9',
              chain: 'ethereum',
              source: 'cached',
              computedAt: '2026-07-07T00:00:00.000Z',
              holders: { top10HolderPct: 12.5 },
              liquidity: { totalUsd: 5000000 },
              permissions: { mintable: false, freezable: false },
              deployer: { verified: true },
              overallRisk: { score: 10, level: 'low', flags: [] },
              relatedServices: [],
            },
          },
        }),
      },
    },
    'GET /v1/pool-snapshot': {
      accepts: [{
        scheme: 'exact' as const,
        price: config.PRICE_POOL_SNAPSHOT,
        network: networkId,
        payTo: config.PAY_TO_ADDRESS,
      }],
      description: 'Cached snapshot of top 500 DeFi liquidity pools by TVL. Filter by protocol, chain, or token. Returns TVL, APY, volume, IL risk, and registry enrichment. Data refreshed every 15 minutes.',
      mimeType: 'application/json',
      extensions: {
        ...declareDiscoveryExtension({
          output: {
            schema: {
              type: 'object',
              required: ['timestamp', 'stalenessSec', 'totalPoolsIndexed', 'returned', 'pools'],
              properties: {
                timestamp: { type: 'string', format: 'date-time' },
                stalenessSec: { type: 'number' },
                totalPoolsIndexed: { type: 'number' },
                returned: { type: 'number' },
                warning: { type: 'string' },
                pools: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      chain: { type: 'string' },
                      protocol: { type: 'string' },
                      symbol: { type: 'string' },
                      tvlUsd: { type: 'number' },
                      apy: { type: 'number' },
                      ilRisk: { type: 'string', enum: ['none', 'low', 'medium', 'high'] },
                      stablecoin: { type: 'boolean' },
                    },
                  },
                },
                relatedServices: { type: 'array' },
              },
            },
            example: {
              timestamp: '2026-07-07T00:00:00.000Z',
              stalenessSec: 120,
              totalPoolsIndexed: 500,
              returned: 1,
              pools: [{ id: 'abc123', chain: 'ethereum', protocol: 'lido', symbol: 'stETH/ETH', tvlUsd: 500000000, apy: 3.2, ilRisk: 'low', stablecoin: false }],
              relatedServices: [],
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
            example: {
              chain: 'ethereum',
              currentPrices: { slow: 20, standard: 25, fast: 35 },
              baseFee: 18.2,
              trend: 'stable',
              timestamp: '2026-07-07T00:00:00.000Z',
              metadata: {},
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
            example: {
              status: 'ok',
              timestamp: '2026-07-07T00:00:00.000Z',
              message: 'pong',
            },
          },
        }),
      },
    },
  };

  // Every configured path also gets a wildcard-verb fallback pointing at the
  // same config, so a mismatched HTTP method (e.g. GET on a POST-only paid
  // route) still returns 402 instead of falling through to Express's 404.
  // The specific 'METHOD /path' entry above is matched first (object key
  // insertion order), so this only ever applies to the "wrong" method; no
  // real handler exists for it, so next() 404s and settlement is skipped —
  // no payment is ever taken for a request that has nothing to serve.
  for (const [key, routeCfg] of Object.entries(routeConfig)) {
    const path = key.split(/\s+/).pop();
    const wildcardKey = `* ${path}`;
    if (!(wildcardKey in routeConfig)) {
      (routeConfig as Record<string, typeof routeCfg>)[wildcardKey] = routeCfg;
    }
  }

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
