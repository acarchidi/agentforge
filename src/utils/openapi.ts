/**
 * OpenAPI 3.1 Specification Generator
 *
 * Generates a full OpenAPI spec from the existing Zod schemas
 * using Zod 4's native toJSONSchema(). Called once at startup and cached.
 */

import { z } from 'zod';
import { tokenIntelInput, tokenIntelOutput } from '../schemas/tokenIntel.js';
import { codeReviewInput, codeReviewOutput } from '../schemas/codeReview.js';
import { tokenResearchInput, tokenResearchOutput } from '../schemas/tokenResearch.js';
import { contractDocsInput, contractDocsOutput } from '../schemas/contractDocs.js';
import { contractMonitorInput, contractMonitorOutput } from '../schemas/contractMonitor.js';
import { tokenCompareInput, tokenCompareOutput } from '../schemas/tokenCompare.js';
import { txDecoderInput, txDecoderOutput } from '../schemas/txDecoder.js';
import { approvalScanInput, approvalScanOutput } from '../schemas/approvalScanner.js';
import { gasOracleInput, gasOracleOutput } from '../schemas/gasOracle.js';
import { sentimentInput, sentimentOutput } from '../schemas/sentiment.js';
import { summarizeInput, summarizeOutput } from '../schemas/summarize.js';
import { translateInput, translateOutput } from '../schemas/translate.js';
import { walletSafetyInput, walletSafetyOutput } from '../schemas/walletSafety.js';
import { poolSnapshotInput, poolSnapshotOutput } from '../schemas/poolSnapshots.js';
import { tokenRiskMetricsInput, tokenRiskMetricsOutput } from '../schemas/tokenRiskMetrics.js';
import { feedbackInput } from '../schemas/feedback.js';
import { config, networkId } from '../config.js';

const x402Network = config.X402_NETWORK;

const baseUrl =
  config.NODE_ENV === 'production'
    ? 'https://agentforge-taupe.vercel.app'
    : `http://localhost:${config.PORT}`;

/** Convert a Zod schema to JSON Schema, stripping the $schema wrapper */
function schemaOf(zodSchema: z.ZodType): Record<string, unknown> {
  const full = z.toJSONSchema(zodSchema) as Record<string, unknown>;
  const { $schema: _, ...rest } = full;
  return rest;
}

const errorSchema = {
  type: 'object' as const,
  properties: {
    error: { type: 'string' as const, example: 'VALIDATION_ERROR' },
    message: { type: 'string' as const },
    details: { type: 'array' as const, items: { type: 'object' as const } },
  },
};

export function generateOpenApiSpec(): object {
  return {
    openapi: '3.1.0',
    info: {
      title: 'AgentForge API',
      version: '1.4.0',
      description:
        'Production-grade AI services for autonomous agents. All paid endpoints use the x402 payment protocol — send a request without payment to receive pricing and payment instructions. Include signed USDC payment in the X-PAYMENT header to access the service. No API keys. No accounts. No subscriptions.',
      contact: { name: 'AgentForge', url: baseUrl },
    },
    servers: [
      {
        url: baseUrl,
        description: config.NODE_ENV === 'production' ? 'Production' : 'Development',
      },
    ],
    paths: {
      '/v1/token-intel': {
        post: {
          operationId: 'getTokenIntel',
          summary: 'Token metadata enrichment and risk assessment',
          description:
            `Get enriched metadata, market data, and AI-generated risk assessment for any EVM or Solana token. Price: ${config.PRICE_TOKEN_INTEL} USDC via x402.`,
          tags: ['Crypto Intelligence'],
          'x-x402-price': config.PRICE_TOKEN_INTEL,
          'x-x402-network': x402Network,
          'x-agentcash-auth': { mode: 'paid' },
          'x-payment-info': { pricingMode: 'fixed', price: config.PRICE_TOKEN_INTEL, protocols: ['x402'] },
          requestBody: {
            required: true,
            content: { 'application/json': { schema: schemaOf(tokenIntelInput) } },
          },
          responses: {
            '200': {
              description: 'Token intelligence result',
              content: { 'application/json': { schema: schemaOf(tokenIntelOutput) } },
            },
            '400': {
              description: 'Invalid input',
              content: { 'application/json': { schema: errorSchema } },
            },
            '402': { description: 'Payment required' },
          },
        },
      },
      '/v1/code-review': {
        post: {
          operationId: 'reviewCode',
          summary: 'Smart contract security analysis with gas optimization',
          description:
            `Analyze smart contract code for security vulnerabilities, gas optimization, and best practice violations. Supports diff review mode. Price: ${config.PRICE_CODE_REVIEW} USDC via x402.`,
          tags: ['Security'],
          'x-x402-price': config.PRICE_CODE_REVIEW,
          'x-x402-network': x402Network,
          'x-agentcash-auth': { mode: 'paid' },
          'x-payment-info': { pricingMode: 'fixed', price: config.PRICE_CODE_REVIEW, protocols: ['x402'] },
          requestBody: {
            required: true,
            content: { 'application/json': { schema: schemaOf(codeReviewInput) } },
          },
          responses: {
            '200': {
              description: 'Code review result',
              content: { 'application/json': { schema: schemaOf(codeReviewOutput) } },
            },
            '400': {
              description: 'Invalid input',
              content: { 'application/json': { schema: errorSchema } },
            },
            '402': { description: 'Payment required' },
          },
        },
      },
      '/v1/token-research': {
        post: {
          operationId: 'tokenResearch',
          summary: 'Multi-source token research with price history and holders',
          description:
            `Aggregates market data (CoinGecko), DeFi metrics (DeFiLlama), price history, holder distribution, contract verification (Etherscan), prediction markets (Polymarket), and AI risk assessment. Price: ${config.PRICE_TOKEN_RESEARCH} USDC via x402.`,
          tags: ['Crypto Intelligence'],
          'x-x402-price': config.PRICE_TOKEN_RESEARCH,
          'x-x402-network': x402Network,
          'x-agentcash-auth': { mode: 'paid' },
          'x-payment-info': { pricingMode: 'fixed', price: config.PRICE_TOKEN_RESEARCH, protocols: ['x402'] },
          requestBody: {
            required: true,
            content: { 'application/json': { schema: schemaOf(tokenResearchInput) } },
          },
          responses: {
            '200': {
              description: 'Token research result',
              content: { 'application/json': { schema: schemaOf(tokenResearchOutput) } },
            },
            '400': {
              description: 'Invalid input',
              content: { 'application/json': { schema: errorSchema } },
            },
            '402': { description: 'Payment required' },
          },
        },
      },
      '/v1/contract-docs': {
        post: {
          operationId: 'generateContractDocs',
          summary: 'Smart contract documentation with security posture',
          description:
            `Generate human-readable documentation for any verified smart contract. Includes interaction patterns and security posture analysis. Price: ${config.PRICE_CONTRACT_DOCS} USDC via x402.`,
          tags: ['Security'],
          'x-x402-price': config.PRICE_CONTRACT_DOCS,
          'x-x402-network': x402Network,
          'x-agentcash-auth': { mode: 'paid' },
          'x-payment-info': { pricingMode: 'fixed', price: config.PRICE_CONTRACT_DOCS, protocols: ['x402'] },
          requestBody: {
            required: true,
            content: { 'application/json': { schema: schemaOf(contractDocsInput) } },
          },
          responses: {
            '200': {
              description: 'Contract documentation result',
              content: { 'application/json': { schema: schemaOf(contractDocsOutput) } },
            },
            '400': {
              description: 'Invalid input',
              content: { 'application/json': { schema: errorSchema } },
            },
            '402': { description: 'Payment required' },
          },
        },
      },
      '/v1/contract-monitor': {
        post: {
          operationId: 'monitorContract',
          summary: 'Contract admin activity monitor',
          description:
            `Monitor recent contract admin activity for ownership transfers, upgrades, pause state changes, and other admin operations. Price: ${config.PRICE_CONTRACT_MONITOR} USDC via x402.`,
          tags: ['Security'],
          'x-x402-price': config.PRICE_CONTRACT_MONITOR,
          'x-x402-network': x402Network,
          'x-agentcash-auth': { mode: 'paid' },
          'x-payment-info': { pricingMode: 'fixed', price: config.PRICE_CONTRACT_MONITOR, protocols: ['x402'] },
          requestBody: {
            required: true,
            content: { 'application/json': { schema: schemaOf(contractMonitorInput) } },
          },
          responses: {
            '200': {
              description: 'Contract monitor result',
              content: { 'application/json': { schema: schemaOf(contractMonitorOutput) } },
            },
            '400': {
              description: 'Invalid input',
              content: { 'application/json': { schema: errorSchema } },
            },
            '402': { description: 'Payment required' },
          },
        },
      },
      '/v1/token-compare': {
        post: {
          operationId: 'compareTokens',
          summary: 'Multi-token comparative analysis',
          description:
            `Compare a primary token against up to 3 competitors with full research, metrics, and AI comparative analysis. Price: ${config.PRICE_TOKEN_COMPARE} USDC via x402.`,
          tags: ['Crypto Intelligence'],
          'x-x402-price': config.PRICE_TOKEN_COMPARE,
          'x-x402-network': x402Network,
          'x-agentcash-auth': { mode: 'paid' },
          'x-payment-info': { pricingMode: 'fixed', price: config.PRICE_TOKEN_COMPARE, protocols: ['x402'] },
          requestBody: {
            required: true,
            content: { 'application/json': { schema: schemaOf(tokenCompareInput) } },
          },
          responses: {
            '200': {
              description: 'Token comparison result',
              content: { 'application/json': { schema: schemaOf(tokenCompareOutput) } },
            },
            '400': {
              description: 'Invalid input',
              content: { 'application/json': { schema: errorSchema } },
            },
            '402': { description: 'Payment required' },
          },
        },
      },
      '/v1/tx-decode': {
        post: {
          operationId: 'decodeTx',
          summary: 'Decode an EVM transaction',
          description:
            `Decode any EVM transaction: function call, parameters, token transfers, and plain-English explanation. Price: ${config.PRICE_TX_DECODE} USDC via x402.`,
          tags: ['Crypto Intelligence'],
          'x-x402-price': config.PRICE_TX_DECODE,
          'x-x402-network': x402Network,
          'x-agentcash-auth': { mode: 'paid' },
          'x-payment-info': { pricingMode: 'fixed', price: config.PRICE_TX_DECODE, protocols: ['x402'] },
          requestBody: {
            required: true,
            content: { 'application/json': { schema: schemaOf(txDecoderInput) } },
          },
          responses: {
            '200': {
              description: 'Decoded transaction',
              content: { 'application/json': { schema: schemaOf(txDecoderOutput) } },
            },
            '400': {
              description: 'Invalid input',
              content: { 'application/json': { schema: errorSchema } },
            },
            '402': { description: 'Payment required' },
          },
        },
      },
      '/v1/approval-scan': {
        post: {
          operationId: 'scanApprovals',
          summary: 'Scan wallet for risky ERC-20 approvals',
          description:
            `Scan a wallet for ERC-20 token approvals, identify risky spenders, and generate risk assessment. Price: ${config.PRICE_APPROVAL_SCAN} USDC via x402.`,
          tags: ['Security'],
          'x-x402-price': config.PRICE_APPROVAL_SCAN,
          'x-x402-network': x402Network,
          'x-agentcash-auth': { mode: 'paid' },
          'x-payment-info': { pricingMode: 'fixed', price: config.PRICE_APPROVAL_SCAN, protocols: ['x402'] },
          requestBody: {
            required: true,
            content: { 'application/json': { schema: schemaOf(approvalScanInput) } },
          },
          responses: {
            '200': {
              description: 'Approval scan result',
              content: { 'application/json': { schema: schemaOf(approvalScanOutput) } },
            },
            '400': {
              description: 'Invalid input',
              content: { 'application/json': { schema: errorSchema } },
            },
            '402': { description: 'Payment required' },
          },
        },
      },
      '/v1/wallet-safety': {
        post: {
          operationId: 'checkWalletSafety',
          summary: 'Comprehensive wallet safety check',
          description:
            `Scan a wallet for risky approvals, suspicious transaction patterns, and assess target contract safety. Returns composite risk score (0-100), risk level, action items, and related service suggestions. Price: ${config.PRICE_WALLET_SAFETY} USDC via x402.`,
          tags: ['Security'],
          'x-x402-price': config.PRICE_WALLET_SAFETY,
          'x-x402-network': x402Network,
          'x-agentcash-auth': { mode: 'paid' },
          'x-payment-info': { pricingMode: 'fixed', price: config.PRICE_WALLET_SAFETY, protocols: ['x402'] },
          requestBody: {
            required: true,
            content: { 'application/json': { schema: schemaOf(walletSafetyInput) } },
          },
          responses: {
            '200': {
              description: 'Wallet safety check result',
              content: { 'application/json': { schema: schemaOf(walletSafetyOutput) } },
            },
            '400': {
              description: 'Invalid input',
              content: { 'application/json': { schema: errorSchema } },
            },
            '402': { description: 'Payment required' },
          },
        },
      },
      '/v1/gas': {
        get: {
          operationId: 'getGasPrice',
          summary: 'Gas price oracle with trend analysis',
          description:
            `Current gas prices (slow/standard/fast) for any supported EVM chain with trend analysis. Price: ${config.PRICE_GAS} USDC via x402.`,
          tags: ['Crypto Intelligence'],
          'x-x402-price': config.PRICE_GAS,
          'x-x402-network': x402Network,
          'x-agentcash-auth': { mode: 'paid' },
          'x-payment-info': { pricingMode: 'fixed', price: config.PRICE_GAS, protocols: ['x402'] },
          parameters: [{
            name: 'chain',
            in: 'query',
            schema: { type: 'string', enum: ['ethereum', 'base', 'polygon', 'arbitrum', 'optimism', 'avalanche'], default: 'ethereum' },
            description: 'EVM chain to query gas prices for',
          }],
          responses: {
            '200': {
              description: 'Gas price data',
              content: { 'application/json': { schema: schemaOf(gasOracleOutput) } },
            },
            '402': { description: 'Payment required' },
          },
        },
      },
      '/v1/sentiment': {
        post: {
          operationId: 'analyzeSentiment',
          summary: 'AI sentiment analysis for crypto and finance',
          description:
            `Analyze text sentiment with crypto/finance awareness. Returns sentiment score, confidence, reasoning, and entity-level sentiment. Price: ${config.PRICE_SENTIMENT} USDC via x402.`,
          tags: ['AI Utilities'],
          'x-x402-price': config.PRICE_SENTIMENT,
          'x-x402-network': x402Network,
          'x-agentcash-auth': { mode: 'paid' },
          'x-payment-info': { pricingMode: 'fixed', price: config.PRICE_SENTIMENT, protocols: ['x402'] },
          requestBody: {
            required: true,
            content: { 'application/json': { schema: schemaOf(sentimentInput) } },
          },
          responses: {
            '200': {
              description: 'Sentiment analysis result',
              content: { 'application/json': { schema: schemaOf(sentimentOutput) } },
            },
            '400': {
              description: 'Invalid input',
              content: { 'application/json': { schema: errorSchema } },
            },
            '402': { description: 'Payment required' },
          },
        },
      },
      '/v1/summarize': {
        post: {
          operationId: 'summarizeText',
          summary: 'AI text summarization with configurable format',
          description:
            `Summarize text with configurable length and format. Supports prose, bullet points, and structured output. Price: ${config.PRICE_SUMMARIZE} USDC via x402.`,
          tags: ['AI Utilities'],
          'x-x402-price': config.PRICE_SUMMARIZE,
          'x-x402-network': x402Network,
          'x-agentcash-auth': { mode: 'paid' },
          'x-payment-info': { pricingMode: 'fixed', price: config.PRICE_SUMMARIZE, protocols: ['x402'] },
          requestBody: {
            required: true,
            content: { 'application/json': { schema: schemaOf(summarizeInput) } },
          },
          responses: {
            '200': {
              description: 'Summarization result',
              content: { 'application/json': { schema: schemaOf(summarizeOutput) } },
            },
            '400': {
              description: 'Invalid input',
              content: { 'application/json': { schema: errorSchema } },
            },
            '402': { description: 'Payment required' },
          },
        },
      },
      '/v1/translate': {
        post: {
          operationId: 'translateText',
          summary: 'AI-powered text translation with tone control',
          description:
            `Translate text to any language with configurable tone (formal, casual, technical). Auto-detects source language. Price: ${config.PRICE_TRANSLATE} USDC via x402.`,
          tags: ['AI Utilities'],
          'x-x402-price': config.PRICE_TRANSLATE,
          'x-x402-network': x402Network,
          'x-agentcash-auth': { mode: 'paid' },
          'x-payment-info': { pricingMode: 'fixed', price: config.PRICE_TRANSLATE, protocols: ['x402'] },
          requestBody: {
            required: true,
            content: { 'application/json': { schema: schemaOf(translateInput) } },
          },
          responses: {
            '200': {
              description: 'Translation result',
              content: { 'application/json': { schema: schemaOf(translateOutput) } },
            },
            '400': {
              description: 'Invalid input',
              content: { 'application/json': { schema: errorSchema } },
            },
            '402': { description: 'Payment required' },
          },
        },
      },
      '/v1/pool-snapshot': {
        get: {
          operationId: 'getPoolSnapshot',
          summary: 'DeFi liquidity pool snapshot',
          description:
            `Cached snapshot of top 500 DeFi liquidity pools by TVL. Filter by protocol, chain, or token. Returns TVL, APY, volume, IL risk, and registry enrichment. Data refreshed every 15 minutes. Price: ${config.PRICE_POOL_SNAPSHOT} USDC via x402.`,
          tags: ['DeFi'],
          'x-x402-price': config.PRICE_POOL_SNAPSHOT,
          'x-x402-network': x402Network,
          'x-agentcash-auth': { mode: 'paid' },
          'x-payment-info': { pricingMode: 'fixed', price: config.PRICE_POOL_SNAPSHOT, protocols: ['x402'] },
          parameters: [
            { name: 'pool', in: 'query', schema: { type: 'string' }, description: 'Pool address or DeFi Llama pool ID' },
            { name: 'protocol', in: 'query', schema: { type: 'string' }, description: 'Protocol name, e.g. "uniswap-v3"' },
            { name: 'chain', in: 'query', schema: { type: 'string' }, description: 'Chain, e.g. "ethereum"' },
            { name: 'token', in: 'query', schema: { type: 'string' }, description: 'Token symbol, e.g. "ETH"' },
            { name: 'sortBy', in: 'query', schema: { type: 'string', enum: ['tvl', 'apy', 'volume'], default: 'tvl' } },
            { name: 'order', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } },
          ],
          responses: {
            '200': {
              description: 'Pool snapshot',
              content: { 'application/json': { schema: schemaOf(poolSnapshotOutput) } },
            },
            '402': { description: 'Payment required' },
          },
        },
      },
      '/v1/token-risk-metrics': {
        post: {
          operationId: 'getTokenRiskMetrics',
          summary: 'Quantitative token risk metrics',
          description:
            `Compute or retrieve pre-computed risk metrics for any ERC-20 token: holder concentration (top 10 %), contract permissions (mint/burn/pause/blacklist), liquidity depth vs market cap, deployer history, and composite risk score (0-100). Price: ${config.PRICE_TOKEN_RISK_METRICS} USDC via x402.`,
          tags: ['Security', 'Crypto Intelligence'],
          'x-x402-price': config.PRICE_TOKEN_RISK_METRICS,
          'x-x402-network': x402Network,
          'x-agentcash-auth': { mode: 'paid' },
          'x-payment-info': { pricingMode: 'fixed', price: config.PRICE_TOKEN_RISK_METRICS, protocols: ['x402'] },
          requestBody: {
            required: true,
            content: { 'application/json': { schema: schemaOf(tokenRiskMetricsInput) } },
          },
          responses: {
            '200': {
              description: 'Token risk metrics result',
              content: { 'application/json': { schema: schemaOf(tokenRiskMetricsOutput) } },
            },
            '400': {
              description: 'Invalid input',
              content: { 'application/json': { schema: errorSchema } },
            },
            '402': { description: 'Payment required' },
          },
        },
      },
      '/v1/ping': {
        get: {
          operationId: 'ping',
          summary: 'Liveness check with payment verification',
          description:
            'Minimal endpoint to verify service is operational and x402 payment flow works. Price: $0.001 USDC via x402.',
          tags: ['System'],
          'x-x402-price': '$0.001',
          'x-x402-network': x402Network,
          'x-agentcash-auth': { mode: 'paid' },
          'x-payment-info': { pricingMode: 'fixed', price: '$0.001', protocols: ['x402'] },
          responses: {
            '200': {
              description: 'Service is operational',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { type: 'string', example: 'ok' },
                      timestamp: { type: 'string', format: 'date-time' },
                      message: { type: 'string' },
                    },
                  },
                },
              },
            },
            '402': { description: 'Payment required' },
          },
        },
      },
      '/feedback': {
        post: {
          operationId: 'submitFeedback',
          summary: 'Submit feedback (free)',
          description: 'Submit feature requests, bug reports, or general feedback. No payment required. Rate limited.',
          tags: ['Free'],
          'x-agentcash-auth': { mode: 'free' },
          requestBody: {
            required: true,
            content: { 'application/json': { schema: schemaOf(feedbackInput) } },
          },
          responses: {
            '200': {
              description: 'Feedback submitted',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { type: 'string', example: 'ok' },
                      message: { type: 'string' },
                    },
                  },
                },
              },
            },
            '400': {
              description: 'Invalid input',
              content: { 'application/json': { schema: errorSchema } },
            },
          },
        },
      },
      '/.well-known/agent.json': {
        get: {
          operationId: 'getAgentCard',
          summary: 'A2A Agent Card (Google Agent-to-Agent Protocol)',
          description:
            'Returns an agent card following the A2A protocol with skills, capabilities, authentication methods, and protocol endpoints. Free — no payment required.',
          tags: ['Discovery'],
          'x-agentcash-auth': { mode: 'free' },
          responses: {
            '200': {
              description: 'A2A Agent Card',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      description: { type: 'string' },
                      url: { type: 'string' },
                      version: { type: 'string' },
                      provider: { type: 'object' },
                      capabilities: { type: 'object' },
                      authentication: { type: 'object' },
                      protocols: { type: 'object' },
                      skills: { type: 'array' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/health': {
        get: {
          operationId: 'healthCheck',
          summary: 'Free health check',
          tags: ['System'],
          'x-agentcash-auth': { mode: 'free' },
          responses: {
            '200': {
              description: 'Service is healthy',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { type: 'string', example: 'ok' },
                      timestamp: { type: 'string', format: 'date-time' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/catalog': {
        get: {
          operationId: 'getCatalog',
          summary: 'Machine-readable service catalog',
          description:
            'Returns all available services with pricing, descriptions, and full JSON schemas. Free — no payment required.',
          tags: ['Discovery'],
          'x-agentcash-auth': { mode: 'free' },
          responses: {
            '200': {
              description: 'Service catalog',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      version: { type: 'string' },
                      description: { type: 'string' },
                      services: { type: 'array' },
                      payment: { type: 'object' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}
