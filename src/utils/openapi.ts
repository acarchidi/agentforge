/**
 * OpenAPI 3.1 Specification Generator
 *
 * Generates a full OpenAPI spec from the existing Zod schemas
 * using Zod 4's native toJSONSchema(). Called once at startup and cached.
 */

import { z } from 'zod';
import { tokenIntelInput, tokenIntelOutput } from '../schemas/tokenIntel.js';
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
import { tradeCheckInput, tradeCheckOutput } from '../schemas/tradeCheck.js';
import { riskBatchInput, riskBatchOutput } from '../schemas/riskBatch.js';
import { addressCheckInput, addressCheckOutput } from '../schemas/addressCheck.js';
import { launchesOutput } from '../schemas/launches.js';
import { txSimulateInput, txSimulateOutput } from '../schemas/txSimulate.js';
import { lendingHealthOutput } from '../schemas/lendingHealth.js';
import { signatureCheckInput, signatureCheckOutput } from '../schemas/signatureCheck.js';
import { preflightInput, preflightOutput } from '../schemas/preflight.js';
import { PRICING_RULES, priceFor, ENDPOINT_PRICES } from '../pricing.js';
import { solanaProgramLookupOutput } from '../schemas/solanaProgramLookup.js';
import { solanaTxExplainInput, solanaTxExplainOutput } from '../schemas/solanaTxExplain.js';
import { solanaTxSimulateInput, solanaTxSimulateOutput } from '../schemas/solanaTxSimulate.js';
import { solanaTokenRiskScanInput, solanaTokenRiskScanOutput } from '../schemas/solanaTokenRiskScan.js';
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
  return normalizePaymentInfo(markFreeOperations({
    openapi: '3.1.0',
    info: {
      title: 'AgentForge API',
      version: '1.10.0',
      description:
        'Check a token before you buy it, catch new launches already risk-scored, screen counterparties against sanctions and scam lists, check a signature request for phishing, simulate a transaction before signing, or check all of it in one preflight call, check liquidation risk, rug-check a watchlist in one call, document a contract before calling it, decode a transaction — pay-per-call tools for autonomous agents, plus NLP utilities. All paid endpoints use the x402 payment protocol — send a request without payment to receive pricing and payment instructions. Include signed USDC payment in the X-PAYMENT header to access the service. No API keys. No accounts. No subscriptions.',
      contact: { name: 'AgentForge', url: baseUrl, email: config.CONTACT_EMAIL },
      'x-guidance':
        'Safety checks for agents that act on-chain. Call POST /v1/preflight once before any send, swap, approval, signature or x402 payment: pass the transactions (with from), an EIP-712 typedData, an x402 paymentRequired, recipients and/or tokens you are about to act on, and act on the verdict (proceed: continue; caution: surface the reasons and confirm; avoid: do not sign). Individual checks: /v1/signature-check, /v1/tx-simulate, /v1/address-check, /v1/trade-check, /v1/risk-batch (watchlists), /v1/launches (new tokens), /v1/lending/health (Aave). Every paid route answers an unpaid request with 402 and the exact price; failed calls are never charged. Chains: Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain, Avalanche, Linea, Unichain, Sonic, HyperEVM, Solana. Free lookups: /registry/lookup, /catalog.',
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
          'x-agentic-market-category': 'data',
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
      '/v1/token-research': {
        post: {
          operationId: 'tokenResearch',
          summary: 'Multi-source token research with price history and holders',
          description:
            `Aggregates market data (CoinGecko), DeFi metrics (DeFiLlama), price history, holder distribution, contract verification (Etherscan), prediction markets (Polymarket), and AI risk assessment. Price: ${config.PRICE_TOKEN_RESEARCH} USDC via x402.`,
          tags: ['Crypto Intelligence'],
          'x-x402-price': config.PRICE_TOKEN_RESEARCH,
          'x-agentic-market-category': 'data',
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
          'x-agentic-market-category': 'inference',
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
          'x-agentic-market-category': 'data',
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
          'x-agentic-market-category': 'inference',
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
          'x-agentic-market-category': 'data',
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
          'x-agentic-market-category': 'data',
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
          'x-agentic-market-category': 'data',
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
          'x-agentic-market-category': 'infra',
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
          'x-agentic-market-category': 'inference',
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
          'x-agentic-market-category': 'inference',
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
          'x-agentic-market-category': 'inference',
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
          'x-agentic-market-category': 'data',
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
          'x-agentic-market-category': 'data',
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
      '/v1/trade-check': {
        post: {
          operationId: 'tradeCheck',
          summary: 'Pre-trade token check (bundle)',
          description:
            `Check a token before you buy it: one call bundling quantitative rug-check metrics, AI risk assessment with market data, and current gas, rolled into a proceed/caution/avoid verdict. Cheaper than the three calls separately. Price: ${config.PRICE_TRADE_CHECK} USDC via x402.`,
          tags: ['Security', 'Crypto Intelligence'],
          'x-x402-price': config.PRICE_TRADE_CHECK,
          'x-agentic-market-category': 'data',
          'x-x402-network': x402Network,
          'x-agentcash-auth': { mode: 'paid' },
          'x-payment-info': { pricingMode: 'fixed', price: config.PRICE_TRADE_CHECK, protocols: ['x402'] },
          requestBody: {
            required: true,
            content: { 'application/json': { schema: schemaOf(tradeCheckInput) } },
          },
          responses: {
            '200': {
              description: 'Pre-trade check result',
              content: { 'application/json': { schema: schemaOf(tradeCheckOutput) } },
            },
            '400': {
              description: 'Invalid input',
              content: { 'application/json': { schema: errorSchema } },
            },
            '402': { description: 'Payment required' },
          },
        },
      },
      '/v1/risk-batch': {
        post: {
          operationId: 'riskBatch',
          summary: 'Batch token risk scoring (2-25 tokens)',
          description:
            `Rug-check a whole watchlist in one call: holder concentration, permissions, and liquidity risk scores for 2-25 EVM tokens. Price: ${PRICING_RULES['/v1/risk-batch']} (the 402 quote reflects the submitted list).`,
          tags: ['Security', 'Crypto Intelligence'],
          'x-x402-price': PRICING_RULES['/v1/risk-batch'],
          'x-agentic-market-category': 'data',
          'x-x402-network': x402Network,
          'x-agentcash-auth': { mode: 'paid' },
          'x-payment-info': { pricingMode: 'dynamic', price: PRICING_RULES['/v1/risk-batch'], protocols: ['x402'] },
          requestBody: { required: true, content: { 'application/json': { schema: schemaOf(riskBatchInput) } } },
          responses: {
            '200': { description: 'Per-token risk results', content: { 'application/json': { schema: schemaOf(riskBatchOutput) } } },
            '400': { description: 'Invalid input', content: { 'application/json': { schema: errorSchema } } },
            '402': { description: 'Payment required' },
          },
        },
      },
      '/v1/address-check': {
        post: {
          operationId: 'addressCheck',
          summary: 'Counterparty address screening (1-100 addresses)',
          description:
            `Screen addresses before sending, approving, or interacting: OFAC sanctions, scam/phishing wallets, labeled protocols, and brand-new-address detection. EVM and Solana. Price: ${PRICING_RULES['/v1/address-check']}.`,
          tags: ['Security'],
          'x-x402-price': PRICING_RULES['/v1/address-check'],
          'x-agentic-market-category': 'data',
          'x-x402-network': x402Network,
          'x-agentcash-auth': { mode: 'paid' },
          'x-payment-info': { pricingMode: 'dynamic', price: PRICING_RULES['/v1/address-check'], protocols: ['x402'] },
          requestBody: { required: true, content: { 'application/json': { schema: schemaOf(addressCheckInput) } } },
          responses: {
            '200': { description: 'Per-address verdicts', content: { 'application/json': { schema: schemaOf(addressCheckOutput) } } },
            '400': { description: 'Invalid input', content: { 'application/json': { schema: errorSchema } } },
            '402': { description: 'Payment required' },
          },
        },
      },
      '/v1/preflight': {
        post: {
          operationId: 'preflight',
          summary: 'Is this action safe? One preflight call before any on-chain action',
          description:
            `One call before any on-chain action: send the transactions, signature request, x402 payment request, recipients, and/or tokens the agent is about to act on, and get back one proceed/caution/avoid verdict. Transactions are simulated (reverts, assets out, approvals, counterparty screening), signatures decoded and checked for permit phishing, recipients screened against sanctions and scam lists, and tokens rug-checked, including tokens the simulation shows the wallet receiving. Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain, Avalanche, Linea, Unichain, Sonic and HyperEVM. Price: ${PRICING_RULES['/v1/preflight']} USDC via x402.`,
          tags: ['Security'],
          'x-x402-price': PRICING_RULES['/v1/preflight'],
          'x-agentic-market-category': 'security',
          'x-x402-network': x402Network,
          'x-agentcash-auth': { mode: 'paid' },
          'x-payment-info': { pricingMode: 'dynamic', price: PRICING_RULES['/v1/preflight'], protocols: ['x402'] },
          requestBody: { required: true, content: { 'application/json': { schema: schemaOf(preflightInput) } } },
          responses: {
            '200': { description: 'One verdict with every check behind it', content: { 'application/json': { schema: schemaOf(preflightOutput) } } },
            '400': { description: 'Invalid input', content: { 'application/json': { schema: errorSchema } } },
            '402': { description: 'Payment required' },
          },
        },
      },
      '/v1/tx-simulate': {
        post: {
          operationId: 'simulateEvmTx',
          summary: 'EVM pre-sign transaction simulation',
          description:
            `Simulate 1-5 EVM transactions before signing: revert reason, asset changes, approvals, counterparty sanctions/scam screening, and a proceed/caution/avoid verdict. Price: ${config.PRICE_TX_SIMULATE} USDC via x402.`,
          tags: ['Security'],
          'x-x402-price': config.PRICE_TX_SIMULATE,
          'x-agentic-market-category': 'security',
          'x-x402-network': x402Network,
          'x-agentcash-auth': { mode: 'paid' },
          'x-payment-info': { pricingMode: 'fixed', price: config.PRICE_TX_SIMULATE, protocols: ['x402'] },
          requestBody: { required: true, content: { 'application/json': { schema: schemaOf(txSimulateInput) } } },
          responses: {
            '200': { description: 'Simulation result', content: { 'application/json': { schema: schemaOf(txSimulateOutput) } } },
            '400': { description: 'Invalid input', content: { 'application/json': { schema: errorSchema } } },
            '402': { description: 'Payment required' },
          },
        },
      },
      '/v1/signature-check': {
        post: {
          operationId: 'signatureCheck',
          summary: 'Signature phishing check (EIP-712, Permit2, Seaport, x402)',
          description:
            `Decode a signature request before signing and screen its spenders and payees. Price: ${config.PRICE_SIGNATURE_CHECK} USDC via x402.`,
          tags: ['Security'],
          'x-x402-price': config.PRICE_SIGNATURE_CHECK,
          'x-agentic-market-category': 'security',
          'x-x402-network': x402Network,
          'x-agentcash-auth': { mode: 'paid' },
          'x-payment-info': { pricingMode: 'fixed', price: config.PRICE_SIGNATURE_CHECK, protocols: ['x402'] },
          requestBody: { required: true, content: { 'application/json': { schema: schemaOf(signatureCheckInput) } } },
          responses: {
            '200': { description: 'Decoded signature with verdict', content: { 'application/json': { schema: schemaOf(signatureCheckOutput) } } },
            '400': { description: 'Invalid input', content: { 'application/json': { schema: errorSchema } } },
            '402': { description: 'Payment required' },
          },
        },
      },
      '/v1/lending/health': {
        get: {
          operationId: 'getLendingHealth',
          summary: 'Aave v3 liquidation risk',
          description:
            `Aave v3 position health for a wallet on Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain, Avalanche, Linea, and Sonic. Price: ${config.PRICE_LENDING_HEALTH} USDC via x402.`,
          tags: ['DeFi'],
          'x-x402-price': config.PRICE_LENDING_HEALTH,
          'x-agentic-market-category': 'data',
          'x-x402-network': x402Network,
          'x-agentcash-auth': { mode: 'paid' },
          'x-payment-info': { pricingMode: 'fixed', price: config.PRICE_LENDING_HEALTH, protocols: ['x402'] },
          parameters: [
            { name: 'address', in: 'query', required: true, schema: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' } },
            { name: 'chain', in: 'query', schema: { type: 'string', enum: ['all', 'ethereum', 'base', 'arbitrum', 'optimism', 'polygon'], default: 'all' } },
          ],
          responses: {
            '200': { description: 'Positions by chain', content: { 'application/json': { schema: schemaOf(lendingHealthOutput) } } },
            '400': { description: 'Invalid input', content: { 'application/json': { schema: errorSchema } } },
            '402': { description: 'Payment required' },
          },
        },
      },
      '/v1/launches': {
        get: {
          operationId: 'getLaunches',
          summary: 'New token launch feed (risk-scored)',
          description:
            `Newly launched tokens on Base, Ethereum, Arbitrum, BNB Chain, and HyperEVM, each already risk-scored. Poll with since=<previous nextSince> to get only new launches. Price: ${config.PRICE_LAUNCHES} USDC via x402.`,
          tags: ['Crypto Intelligence', 'Security'],
          'x-x402-price': config.PRICE_LAUNCHES,
          'x-agentic-market-category': 'data',
          'x-x402-network': x402Network,
          'x-agentcash-auth': { mode: 'paid' },
          'x-payment-info': { pricingMode: 'fixed', price: config.PRICE_LAUNCHES, protocols: ['x402'] },
          parameters: [
            { name: 'chain', in: 'query', schema: { type: 'string', enum: ['base', 'ethereum', 'arbitrum'], default: 'base' } },
            { name: 'since', in: 'query', schema: { type: 'string', format: 'date-time' }, description: 'Only pools created after this; pass the previous nextSince' },
            { name: 'minLiquidityUsd', in: 'query', schema: { type: 'number', default: 1000 } },
            { name: 'maxRiskScore', in: 'query', schema: { type: 'integer', minimum: 0, maximum: 100 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } },
          ],
          responses: {
            '200': { description: 'Risk-scored launches', content: { 'application/json': { schema: schemaOf(launchesOutput) } } },
            '400': { description: 'Invalid input', content: { 'application/json': { schema: errorSchema } } },
            '402': { description: 'Payment required' },
          },
        },
      },
      '/v1/ping': {
        get: {
          operationId: 'ping',
          summary: 'Liveness check with payment verification',
          description:
            'Verify the service is operational and your x402 payment flow works. The response includes the full service catalog with prices and example inputs. Price: $0.001 USDC via x402.',
          tags: ['System'],
          'x-x402-price': '$0.001',
          'x-agentic-market-category': 'infra',
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
      '/v1/solana/program-lookup': {
        get: {
          operationId: 'solanaProgramLookup',
          summary: 'Solana program label lookup (free)',
          description: 'Look up a Solana program ID in the program label registry. Free, no payment required.',
          tags: ['Free', 'Solana'],
          'x-agentcash-auth': { mode: 'free' },
          parameters: [
            { name: 'programId', in: 'query', required: true, schema: { type: 'string' }, description: 'Base58 Solana program ID' },
          ],
          responses: {
            '200': {
              description: 'Program lookup result',
              content: { 'application/json': { schema: schemaOf(solanaProgramLookupOutput) } },
            },
          },
        },
      },
      '/v1/solana/tx-explain': {
        post: {
          operationId: 'explainSolanaTx',
          summary: 'Explain a Solana transaction',
          description:
            `Decode a Solana transaction into plain English: labeled programs, token/SOL movements, and risk flags. Accepts USDC on Base or Solana. Price: ${config.PRICE_SOLANA_TX_EXPLAIN} USDC via x402.`,
          tags: ['Solana', 'Crypto Intelligence'],
          'x-x402-price': config.PRICE_SOLANA_TX_EXPLAIN,
          'x-agentic-market-category': 'data',
          'x-x402-network': x402Network,
          'x-agentcash-auth': { mode: 'paid' },
          'x-payment-info': { pricingMode: 'fixed', price: config.PRICE_SOLANA_TX_EXPLAIN, protocols: ['x402'] },
          requestBody: {
            required: true,
            content: { 'application/json': { schema: schemaOf(solanaTxExplainInput) } },
          },
          responses: {
            '200': {
              description: 'Transaction explanation',
              content: { 'application/json': { schema: schemaOf(solanaTxExplainOutput) } },
            },
            '400': { description: 'Invalid input', content: { 'application/json': { schema: errorSchema } } },
            '402': { description: 'Payment required' },
          },
        },
      },
      '/v1/solana/tx-simulate': {
        post: {
          operationId: 'simulateSolanaTx',
          summary: 'Simulate a Solana transaction',
          description:
            `Simulate a Solana transaction before signing it: balance changes, labeled programs, deterministic risk rules, and a proceed/caution/avoid recommendation. Accepts USDC on Base or Solana. Price: ${config.PRICE_SOLANA_TX_SIMULATE} USDC via x402.`,
          tags: ['Solana', 'Security'],
          'x-x402-price': config.PRICE_SOLANA_TX_SIMULATE,
          'x-agentic-market-category': 'data',
          'x-x402-network': x402Network,
          'x-agentcash-auth': { mode: 'paid' },
          'x-payment-info': { pricingMode: 'fixed', price: config.PRICE_SOLANA_TX_SIMULATE, protocols: ['x402'] },
          requestBody: {
            required: true,
            content: { 'application/json': { schema: schemaOf(solanaTxSimulateInput) } },
          },
          responses: {
            '200': {
              description: 'Simulation result',
              content: { 'application/json': { schema: schemaOf(solanaTxSimulateOutput) } },
            },
            '400': { description: 'Invalid input', content: { 'application/json': { schema: errorSchema } } },
            '402': { description: 'Payment required' },
          },
        },
      },
      '/v1/solana/token-risk-scan': {
        post: {
          operationId: 'scanSolanaTokenRisk',
          summary: 'Solana token risk / rug check scan',
          description:
            `Solana rug check: mint authority, freeze authority, holder concentration, liquidity depth, and a composite 0-100 risk score. Accepts USDC on Base or Solana. Price: ${config.PRICE_SOLANA_TOKEN_RISK_SCAN} USDC via x402.`,
          tags: ['Solana', 'Security', 'Crypto Intelligence'],
          'x-x402-price': config.PRICE_SOLANA_TOKEN_RISK_SCAN,
          'x-agentic-market-category': 'data',
          'x-x402-network': x402Network,
          'x-agentcash-auth': { mode: 'paid' },
          'x-payment-info': { pricingMode: 'fixed', price: config.PRICE_SOLANA_TOKEN_RISK_SCAN, protocols: ['x402'] },
          requestBody: {
            required: true,
            content: { 'application/json': { schema: schemaOf(solanaTokenRiskScanInput) } },
          },
          responses: {
            '200': {
              description: 'Token risk scan result',
              content: { 'application/json': { schema: schemaOf(solanaTokenRiskScanOutput) } },
            },
            '400': { description: 'Invalid input', content: { 'application/json': { schema: errorSchema } } },
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
  }));
}

/**
 * Operations without an x402 price are free. Mark them `security: []` so x402
 * crawlers (x402scan, Bazaar) skip them instead of reporting "no 402 challenge".
 */
/** Request bodies at each end of a per-item endpoint's range, for dynamic min/max quotes. */
const DYNAMIC_RANGE: Record<string, [unknown, unknown]> = {
  '/v1/risk-batch': [{ tokens: [1, 2] }, { tokens: Array(25).fill(1) }],
  '/v1/address-check': [{ addresses: [1] }, { addresses: Array(100).fill(1) }],
  '/v1/preflight': [{}, { tokens: Array(5).fill(1) }],
};

const usd = (n: number) => n.toFixed(6);

/**
 * x-payment-info in the shape AgentCash discovery and x402scan validate:
 * protocol objects plus a structured USD price (decimal, not atomic units),
 * fixed or a dynamic min/max range. Also guarantees a 402 response entry.
 */
function normalizePaymentInfo<T extends { paths: Record<string, Record<string, Record<string, unknown>>> }>(spec: T): T {
  for (const [path, ops] of Object.entries(spec.paths)) {
    for (const op of Object.values(ops)) {
      if (!op || typeof op !== 'object' || !('x-payment-info' in op)) continue;
      const range = DYNAMIC_RANGE[path];
      const price = range
        ? { mode: 'dynamic', currency: 'USD', min: usd(priceFor(path, range[0])), max: usd(priceFor(path, range[1])) }
        : { mode: 'fixed', currency: 'USD', amount: usd(ENDPOINT_PRICES[path] ?? 0) };
      op['x-payment-info'] = { price, protocols: [{ x402: {} }] };
      const responses = (op.responses ?? {}) as Record<string, unknown>;
      if (!responses['402']) responses['402'] = { description: 'Payment Required' };
      op.responses = responses;
    }
  }
  return spec;
}

function markFreeOperations<T extends { paths: Record<string, Record<string, Record<string, unknown>>> }>(spec: T): T {
  for (const ops of Object.values(spec.paths)) {
    for (const op of Object.values(ops)) {
      if (op && typeof op === 'object' && !('x-x402-price' in op)) op.security = [];
    }
  }
  return spec;
}
