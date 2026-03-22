import { Router, type Request, type Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
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
import { generateOpenApiSpec } from '../utils/openapi.js';
import { config, networkId } from '../config.js';
import { getDb } from '../analytics/db.js';
import { getRegistry } from '../registry/lookup.js';
import { getCacheStore } from '../cache/store.js';
import { getPrecomputedDocs } from '../cache/precomputedDocs.js';
import { getPoolSnapshotsCache } from '../cache/poolSnapshotsCache.js';
import { getTokenRiskMetricsCache } from '../cache/tokenRiskMetricsCache.js';
import { generateAgentCard } from '../discovery/agentCard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isMainnet = config.X402_NETWORK === 'base';
const networkName = isMainnet ? 'Base' : 'Base Sepolia';
const facilitatorUrl = config.X402_FACILITATOR_URL;

export const freeRouter = Router();

/** Build base URL respecting x-forwarded-proto from reverse proxies (Vercel, etc.) */
function getBaseUrl(req: Request): string {
  const proto = (req.get('x-forwarded-proto') || req.protocol).split(',')[0].trim();
  return `${proto}://${req.get('host')}`;
}

// ────────────────────────────────────────────────────────────────────
// Dashboard (static HTML)
// ────────────────────────────────────────────────────────────────────

freeRouter.get('/', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../../dashboard/index.html'));
});

freeRouter.get('/dashboard', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../../dashboard/index.html'));
});

// ────────────────────────────────────────────────────────────────────
// Health & Catalog
// ────────────────────────────────────────────────────────────────────

freeRouter.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/** Convert a Zod schema to JSON Schema, stripping the $schema wrapper */
function schemaOf(zodSchema: z.ZodType): Record<string, unknown> {
  const full = z.toJSONSchema(zodSchema) as Record<string, unknown>;
  const { $schema: _, ...rest } = full;
  return rest;
}

freeRouter.get('/catalog', (_req: Request, res: Response) => {
  res.json({
    name: 'AgentForge',
    version: '1.4.0',
    description:
      'Production-grade AI services for autonomous agents. Pay per request via x402 protocol with USDC on Base. All service responses include relatedServices suggestions for chaining calls. Includes a free Known Contract Label Registry for contract identification.',
    documentationUrl: '/openapi.json',
    payment: {
      protocol: 'x402',
      protocolVersion: '2',
      network: networkId,
      networkName,
      asset: 'USDC',
      facilitator: facilitatorUrl,
    },
    services: [
      {
        endpoint: 'POST /v1/token-intel',
        operationId: 'getTokenIntel',
        description: 'Token metadata enrichment with market data and AI risk assessment',
        price: config.PRICE_TOKEN_INTEL,
        tags: ['crypto', 'token', 'risk', 'market-data', 'defi'],
        inputSchema: schemaOf(tokenIntelInput),
        outputSchema: schemaOf(tokenIntelOutput),
      },
      {
        endpoint: 'POST /v1/code-review',
        operationId: 'reviewCode',
        description: 'Smart contract security analysis with gas optimization and diff review mode',
        price: config.PRICE_CODE_REVIEW,
        tags: ['security', 'audit', 'smart-contract', 'solidity', 'rust', 'gas-optimization'],
        inputSchema: schemaOf(codeReviewInput),
        outputSchema: schemaOf(codeReviewOutput),
      },
      {
        endpoint: 'POST /v1/token-research',
        operationId: 'tokenResearch',
        description: 'Multi-source token intelligence: market data, DeFi metrics, contract verification, prediction markets, price history, holder distribution, and AI risk assessment',
        price: config.PRICE_TOKEN_RESEARCH,
        tags: ['crypto', 'research', 'token', 'defi', 'risk', 'multi-source', 'price-history', 'holders'],
        inputSchema: schemaOf(tokenResearchInput),
        outputSchema: schemaOf(tokenResearchOutput),
      },
      {
        endpoint: 'POST /v1/contract-docs',
        operationId: 'generateContractDocs',
        description: 'Human-readable smart contract documentation with function descriptions, risk flags, interaction patterns, security posture, and admin capability analysis',
        price: config.PRICE_CONTRACT_DOCS,
        tags: ['smart-contract', 'documentation', 'security', 'audit', 'abi'],
        inputSchema: schemaOf(contractDocsInput),
        outputSchema: schemaOf(contractDocsOutput),
      },
      {
        endpoint: 'POST /v1/contract-monitor',
        operationId: 'monitorContract',
        description: 'Monitor recent contract admin activity. Detects ownership transfers, upgrades, pause state changes, and suspicious admin operations.',
        price: config.PRICE_CONTRACT_MONITOR,
        tags: ['smart-contract', 'monitoring', 'security', 'admin-ops', 'risk'],
        inputSchema: schemaOf(contractMonitorInput),
        outputSchema: schemaOf(contractMonitorOutput),
      },
      {
        endpoint: 'POST /v1/token-compare',
        operationId: 'compareTokens',
        description: 'Compare a primary token against up to 3 competitors with full research, abbreviated metrics, and AI comparative analysis',
        price: config.PRICE_TOKEN_COMPARE,
        tags: ['crypto', 'comparison', 'research', 'competitive-intelligence'],
        inputSchema: schemaOf(tokenCompareInput),
        outputSchema: schemaOf(tokenCompareOutput),
      },
      {
        endpoint: 'POST /v1/tx-decode',
        operationId: 'decodeTx',
        description: 'Decode any EVM transaction: function call, parameters, token transfers, and plain-English explanation',
        price: config.PRICE_TX_DECODE,
        tags: ['crypto', 'transaction', 'decoding', 'evm'],
        inputSchema: schemaOf(txDecoderInput),
        outputSchema: schemaOf(txDecoderOutput),
      },
      {
        endpoint: 'POST /v1/approval-scan',
        operationId: 'scanApprovals',
        description: 'Scan a wallet for risky ERC-20 token approvals. Identifies unlimited approvals, unverified spender contracts, and generates risk assessment.',
        price: config.PRICE_APPROVAL_SCAN,
        tags: ['crypto', 'security', 'wallet', 'approvals', 'risk'],
        inputSchema: schemaOf(approvalScanInput),
        outputSchema: schemaOf(approvalScanOutput),
      },
      {
        endpoint: 'POST /v1/wallet-safety',
        operationId: 'checkWalletSafety',
        description: 'Comprehensive wallet safety check: approval scanning, suspicious pattern detection, target contract assessment, and composite risk scoring (0-100)',
        price: config.PRICE_WALLET_SAFETY,
        tags: ['crypto', 'security', 'wallet', 'defi', 'risk', 'approvals', 'patterns'],
        inputSchema: schemaOf(walletSafetyInput),
        outputSchema: schemaOf(walletSafetyOutput),
      },
      {
        endpoint: 'POST /v1/sentiment',
        operationId: 'analyzeSentiment',
        description: 'AI-powered sentiment analysis for crypto, finance, and social media text. Returns score, confidence, label, reasoning, and per-entity sentiment.',
        price: config.PRICE_SENTIMENT,
        tags: ['nlp', 'sentiment', 'crypto', 'finance', 'social-media'],
        inputSchema: schemaOf(sentimentInput),
        outputSchema: schemaOf(sentimentOutput),
      },
      {
        endpoint: 'POST /v1/summarize',
        operationId: 'summarizeText',
        description: 'AI-powered text summarization with configurable length, format, and optional topic focus. Returns summary, key points, and compression ratio.',
        price: config.PRICE_SUMMARIZE,
        tags: ['nlp', 'summarization', 'text-processing'],
        inputSchema: schemaOf(summarizeInput),
        outputSchema: schemaOf(summarizeOutput),
      },
      {
        endpoint: 'POST /v1/translate',
        operationId: 'translateText',
        description: 'AI-powered translation with tone control and automatic source language detection. Preserves formatting and cultural nuances.',
        price: config.PRICE_TRANSLATE,
        tags: ['nlp', 'translation', 'localization'],
        inputSchema: schemaOf(translateInput),
        outputSchema: schemaOf(translateOutput),
      },
      {
        endpoint: 'GET /v1/gas',
        operationId: 'getGasPrice',
        description: 'Current gas prices (slow/standard/fast) for any supported EVM chain with trend analysis',
        price: config.PRICE_GAS,
        tags: ['crypto', 'gas', 'pricing', 'evm'],
        inputSchema: schemaOf(gasOracleInput),
        outputSchema: schemaOf(gasOracleOutput),
      },
      {
        endpoint: 'GET /v1/pool-snapshot',
        operationId: 'getPoolSnapshot',
        description: 'Cached snapshot of top 500 DeFi liquidity pools. Filter by protocol, chain, or token. Returns TVL, APY, volume, IL risk, and registry enrichment.',
        price: config.PRICE_POOL_SNAPSHOT,
        tags: ['defi', 'liquidity', 'pools', 'tvl', 'apy', 'snapshot'],
        inputSchema: schemaOf(poolSnapshotInput),
        outputSchema: schemaOf(poolSnapshotOutput),
      },
      {
        endpoint: 'POST /v1/token-risk-metrics',
        operationId: 'getTokenRiskMetrics',
        description: 'Quantitative token risk metrics: holder concentration, liquidity depth, contract permissions, deployer history, and composite risk score (0-100).',
        price: config.PRICE_TOKEN_RISK_METRICS,
        tags: ['crypto', 'token', 'risk', 'defi', 'security', 'holder-analysis'],
        inputSchema: schemaOf(tokenRiskMetricsInput),
        outputSchema: schemaOf(tokenRiskMetricsOutput),
      },
      {
        endpoint: 'GET /v1/ping',
        operationId: 'ping',
        description: 'Liveness check with x402 payment verification',
        price: '$0.001',
        tags: ['system', 'health', 'testing'],
        inputSchema: null,
        outputSchema: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            timestamp: { type: 'string', format: 'date-time' },
            message: { type: 'string' },
          },
        },
      },
    ],
  });
});

// ────────────────────────────────────────────────────────────────────
// Feedback (free, rate-limited)
// ────────────────────────────────────────────────────────────────────

freeRouter.post('/feedback', (req: Request, res: Response) => {
  try {
    const validated = feedbackInput.parse(req.body);

    const db = getDb();
    db.prepare(
      `INSERT INTO feedback (type, endpoint, message, contact, created_at) VALUES (?, ?, ?, ?, datetime('now'))`,
    ).run(validated.type, validated.endpoint ?? null, validated.message, validated.contact ?? null);

    res.json({ status: 'ok', message: 'Thank you for your feedback.' });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'VALIDATION_ERROR', details: err.issues });
      return;
    }
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to save feedback' });
  }
});

// ────────────────────────────────────────────────────────────────────
// Registry (free, public)
// ────────────────────────────────────────────────────────────────────

freeRouter.get('/registry/stats', (_req: Request, res: Response) => {
  const stats = getRegistry().getStats();
  res.json(stats);
});

freeRouter.get('/registry/lookup', (req: Request, res: Response) => {
  const address = req.query.address as string | undefined;
  const chain = req.query.chain as string | undefined;

  if (!address || !address.startsWith('0x')) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: 'address query parameter required (0x-prefixed)' });
    return;
  }

  const entry = getRegistry().lookup(address, chain);
  res.json({ address: address.toLowerCase(), chain: chain ?? null, entry });
});

// ────────────────────────────────────────────────────────────────────
// Cache (free, public)
// ────────────────────────────────────────────────────────────────────

freeRouter.get('/cache/stats', async (_req: Request, res: Response) => {
  const stats = await getCacheStore().stats();
  const docsKeys = await getCacheStore().keys('docs:');
  const precomputed = getPrecomputedDocs();
  const precomputedStats = precomputed.getStats();
  const poolStats = getPoolSnapshotsCache().getStats();
  const riskStats = getTokenRiskMetricsCache().getStats();
  res.json({
    ...stats,
    runtimeCachedDocs: docsKeys.length,
    docsCacheKeys: docsKeys,
    precomputedDocs: precomputedStats.totalCached,
    precomputedStats: {
      total: precomputedStats.totalCached,
      proxyResolved: precomputedStats.proxyResolved,
      direct: precomputedStats.direct,
      generatedAt: precomputedStats.generatedAt,
      version: precomputedStats.version,
    },
    poolSnapshots: {
      total: poolStats.totalPools,
      generatedAt: poolStats.generatedAt,
      stalenessSec: getPoolSnapshotsCache().getStalenessSeconds(),
    },
    tokenRiskMetrics: {
      total: riskStats.totalCached,
      generatedAt: riskStats.generatedAt,
    },
  });
});

// ────────────────────────────────────────────────────────────────────
// OpenAPI Specification
// ────────────────────────────────────────────────────────────────────

let cachedSpec: object | null = null;

freeRouter.get('/openapi.json', (_req: Request, res: Response) => {
  if (!cachedSpec) cachedSpec = generateOpenApiSpec();
  res.json(cachedSpec);
});

freeRouter.get('/.well-known/openapi.json', (_req: Request, res: Response) => {
  if (!cachedSpec) cachedSpec = generateOpenApiSpec();
  res.json(cachedSpec);
});

// ────────────────────────────────────────────────────────────────────
// x402 Discovery (/.well-known/x402)
// ────────────────────────────────────────────────────────────────────

freeRouter.get('/.well-known/x402', (_req: Request, res: Response) => {
  res.json({
    resources: [
      'POST /v1/token-intel',
      'POST /v1/code-review',
      'POST /v1/token-research',
      'POST /v1/contract-docs',
      'POST /v1/contract-monitor',
      'POST /v1/token-compare',
      'POST /v1/tx-decode',
      'POST /v1/approval-scan',
      'POST /v1/wallet-safety',
      'POST /v1/sentiment',
      'POST /v1/summarize',
      'POST /v1/translate',
      'GET /v1/gas',
      'GET /v1/pool-snapshot',
      'POST /v1/token-risk-metrics',
      'GET /v1/ping',
    ],
  });
});

// ────────────────────────────────────────────────────────────────────
// A2A Agent Card (Google Agent-to-Agent Protocol)
// ────────────────────────────────────────────────────────────────────

let cachedAgentCard: Record<string, unknown> | null = null;

freeRouter.get('/.well-known/agent.json', (req: Request, res: Response) => {
  const baseUrl = getBaseUrl(req);
  if (!cachedAgentCard || cachedAgentCard.url !== baseUrl) {
    cachedAgentCard = generateAgentCard(baseUrl);
  }
  res.json(cachedAgentCard);
});

// ────────────────────────────────────────────────────────────────────
// AI Plugin Manifest
// ────────────────────────────────────────────────────────────────────

freeRouter.get('/.well-known/ai-plugin.json', (req: Request, res: Response) => {
  const baseUrl = getBaseUrl(req);
  res.json({
    schema_version: 'v1',
    name_for_human: 'AgentForge',
    name_for_model: 'agentforge',
    description_for_human:
      'AI-powered DeFi safety and analysis services: wallet safety checks, token intelligence, smart contract auditing, multi-source token research, contract documentation, contract monitoring, token comparison, sentiment analysis, text summarization, and translation. Pay per request with USDC.',
    description_for_model:
      'AgentForge provides production-grade AI analysis services accessible via x402 micropayments in USDC on Base. Available tools: (1) token metadata enrichment with risk scoring, (2) smart contract security auditing with gas optimization, (3) multi-source token research, (4) smart contract documentation generation, (5) contract admin activity monitoring, (6) multi-token comparative analysis, (7) transaction decoding with plain-English explanations, (8) wallet approval risk scanning, (9) comprehensive wallet safety check with pattern detection and risk scoring, (10) gas price oracle with trend analysis, (11) sentiment analysis for crypto/finance/social media text, (12) text summarization with configurable length and format, (13) translation with tone control and auto-detection, (14) DeFi liquidity pool snapshots with TVL/APY/IL-risk for top 500 pools, (15) quantitative token risk metrics with holder concentration, permissions, and composite score. All endpoints accept JSON requests and return structured JSON. Payment is handled automatically via x402 protocol — no API keys or accounts needed.',
    auth: { type: 'none' },
    api: { type: 'openapi', url: `${baseUrl}/openapi.json` },
    mcp: {
      url: `${baseUrl}/mcp`,
      transport: 'streamable-http',
    },
    logo_url: `${baseUrl}/logo.png`,
    contact_email: '',
    legal_info_url: '',
  });
});

// ────────────────────────────────────────────────────────────────────
// robots.txt
// ────────────────────────────────────────────────────────────────────

freeRouter.get('/robots.txt', (_req: Request, res: Response) => {
  res.type('text/plain').send(`# AgentForge — AI Agent Services
# We welcome AI agent crawlers and indexers.

User-agent: *
Allow: /
Allow: /catalog
Allow: /openapi.json
Allow: /.well-known/
Disallow: /admin

# Service catalog (machine-readable)
# GET /catalog — JSON service list with pricing and schemas
# GET /openapi.json — Full OpenAPI 3.1 specification
# GET /.well-known/agent.json — A2A Agent Card (Google Agent-to-Agent Protocol)
# GET /.well-known/ai-plugin.json — AI plugin manifest
# GET /.well-known/x402 — x402 payment resource discovery

# All /v1/* endpoints require x402 payment in USDC.
# Send a request without payment to receive a 402 with pricing details.
`);
});

// ────────────────────────────────────────────────────────────────────
// /about — Agent-readable service documentation
// ────────────────────────────────────────────────────────────────────

freeRouter.get('/about', (req: Request, res: Response) => {
  const baseUrl = getBaseUrl(req);
  res.json({
    name: 'AgentForge',
    tagline: 'Production-grade AI services for autonomous agents',
    version: '1.4.0',

    what_is_this:
      'AgentForge is a collection of AI-powered API endpoints that agents can pay for and consume on a per-request basis using the x402 payment protocol with USDC stablecoin on the Base network. No API keys, no accounts, no subscriptions. Just HTTP requests with micropayments.',

    how_to_use: {
      step_1: 'GET /catalog to see all available services with pricing and schemas.',
      step_2: 'POST to any /v1/* endpoint with your request body.',
      step_3: 'You will receive HTTP 402 with payment requirements including price, network, and wallet address.',
      step_4: 'Sign a USDC transfer authorization using your wallet private key.',
      step_5: 'Retry the same request with the signed payment in the X-PAYMENT header.',
      step_6: 'Receive your result as structured JSON.',
      documentation: `${baseUrl}/openapi.json`,
    },

    payment: {
      protocol: 'x402 (HTTP 402 Payment Required)',
      protocol_docs: 'https://docs.x402.org',
      asset: 'USDC',
      network: isMainnet ? 'Base (mainnet)' : 'Base Sepolia (testnet)',
      network_caip2: networkId,
      facilitator: facilitatorUrl,
      minimum_payment: '$0.001',
      maximum_payment: '$0.08',
      settlement: 'Instant on-chain settlement via x402 facilitator. Gasless for the payer.',
    },

    services: {
      token_intelligence: {
        endpoint: 'POST /v1/token-intel',
        price: config.PRICE_TOKEN_INTEL,
        description:
          'Returns enriched metadata, live market data (price, market cap, volume, 24h change), and an AI-generated risk assessment (0-100 score with specific flags) for any token on Ethereum, Base, Solana, Polygon, or Arbitrum.',
        best_for: 'Due diligence, portfolio analysis, token screening, risk assessment before trades',
        input_example: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', chain: 'ethereum' },
      },
      code_review: {
        endpoint: 'POST /v1/code-review',
        price: config.PRICE_CODE_REVIEW,
        description:
          'Analyzes smart contract code for security vulnerabilities (reentrancy, overflow, access control), gas optimization opportunities, and best practice violations. Supports Solidity, Rust, Move, and TypeScript. Returns severity-ranked issues with line numbers and fix suggestions. Supports diff review mode by providing previousCode.',
        best_for: 'Pre-deployment security checks, audit preparation, code quality assessment, gas optimization',
        input_example: { code: 'pragma solidity ^0.8.0; ...', language: 'solidity', focus: 'all' },
      },
      token_research: {
        endpoint: 'POST /v1/token-research',
        price: config.PRICE_TOKEN_RESEARCH,
        description:
          'Multi-source token intelligence aggregating CoinGecko market data, DeFiLlama DeFi metrics and price history, Etherscan contract verification and holder distribution, Polymarket prediction markets, institutional mention analysis, and AI-synthesized risk assessment. Returns partial results if some sources fail.',
        best_for: 'Deep token due diligence, comprehensive research reports, multi-factor risk analysis, competitive intelligence',
        input_example: { query: 'ethereum', chain: 'ethereum', include: ['market_data', 'defi_metrics', 'price_history', 'holders', 'risk_assessment'] },
      },
      contract_docs: {
        endpoint: 'POST /v1/contract-docs',
        price: config.PRICE_CONTRACT_DOCS,
        description:
          'Generates human-readable documentation for any verified smart contract. Fetches ABI from Etherscan, uses AI to describe each function and event, flags admin capabilities, maps interaction patterns, and assesses security posture. Supports proxy contracts.',
        best_for: 'Understanding unfamiliar contracts, pre-interaction due diligence, audit preparation, developer onboarding',
        input_example: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', chain: 'ethereum' },
      },
      contract_monitor: {
        endpoint: 'POST /v1/contract-monitor',
        price: config.PRICE_CONTRACT_MONITOR,
        description:
          'Monitors recent contract admin activity by scanning transactions for ownership transfers, implementation upgrades, pause state changes, role grants, and other admin operations. Returns risk-rated alert with specific concerns and recommendations.',
        best_for: 'Ongoing contract monitoring, detecting suspicious admin activity, pre-trade safety checks, portfolio risk management',
        input_example: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', chain: 'ethereum', lookbackHours: 24 },
      },
      token_compare: {
        endpoint: 'POST /v1/token-compare',
        price: config.PRICE_TOKEN_COMPARE,
        description:
          'Compares a primary token against up to 3 competitors. Returns full multi-source research on the primary token, abbreviated metrics for each comparison, and an AI-generated comparative analysis highlighting strengths, weaknesses, and risks.',
        best_for: 'Investment comparison, competitive analysis, portfolio allocation decisions',
        input_example: { primary: 'ethereum', compare: ['solana', 'avalanche'], chain: 'ethereum' },
      },
      tx_decode: {
        endpoint: 'POST /v1/tx-decode',
        price: config.PRICE_TX_DECODE,
        description:
          'Decodes any EVM transaction: fetches from Etherscan, decodes function call using ABI, extracts ERC-20 transfers, and generates a plain-English explanation.',
        best_for: 'Transaction analysis, understanding contract interactions, debugging failed transactions',
        input_example: { txHash: '0x...', chain: 'ethereum' },
      },
      approval_scan: {
        endpoint: 'POST /v1/approval-scan',
        price: config.PRICE_APPROVAL_SCAN,
        description:
          'Scans a wallet for ERC-20 token approvals, identifies risky spenders (unlimited approvals, unverified contracts), and generates a risk assessment with recommendations.',
        best_for: 'Wallet security audit, approval hygiene, risk assessment before interacting with DeFi',
        input_example: { address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', chain: 'ethereum' },
      },
      wallet_safety: {
        endpoint: 'POST /v1/wallet-safety',
        price: config.PRICE_WALLET_SAFETY,
        description:
          'Comprehensive wallet safety check combining approval scanning, suspicious transaction pattern detection (rapid approvals, flagged contract interactions, mixer usage, large outflows, phishing signatures), and target contract risk assessment. Returns composite risk score (0-100), risk level, action items, and related service suggestions. Supports quick/standard/deep analysis depths.',
        best_for: 'Pre-interaction safety checks, wallet security audits, DeFi risk assessment, approval hygiene, suspicious pattern detection',
        input_example: { walletAddress: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', chain: 'ethereum', targetContract: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', depth: 'standard' },
      },
      sentiment: {
        endpoint: 'POST /v1/sentiment',
        price: config.PRICE_SENTIMENT,
        description:
          'Analyzes sentiment of text in crypto, finance, social media, or general context. Returns a score from -1 (very bearish) to 1 (very bullish), confidence level, human-readable label, reasoning, and per-entity sentiment breakdown.',
        best_for: 'Market sentiment tracking, social media monitoring, news analysis, signal generation',
        input_example: { text: 'ETH breaking out above $4k with massive volume, this is just the beginning', context: 'crypto' },
      },
      summarize: {
        endpoint: 'POST /v1/summarize',
        price: config.PRICE_SUMMARIZE,
        description:
          'Summarizes text with configurable length (brief/standard/detailed), format (prose/bullet_points/structured), and optional topic focus. Returns the summary, key points, word count, and compression ratio.',
        best_for: 'Research report condensation, whitepaper summarization, news digests, meeting notes',
        input_example: { text: 'Long article text here...', maxLength: 'standard', format: 'structured', focus: 'key findings' },
      },
      translate: {
        endpoint: 'POST /v1/translate',
        price: config.PRICE_TRANSLATE,
        description:
          'Translates text to any language with tone control (formal/casual/technical). Automatically detects source language. Preserves formatting, paragraph structure, and cultural nuances.',
        best_for: 'Multi-language support, documentation translation, cross-border communication, localization',
        input_example: { text: 'Hello, how are you?', targetLanguage: 'Spanish', tone: 'formal' },
      },
      pool_snapshot: {
        endpoint: 'GET /v1/pool-snapshot',
        price: config.PRICE_POOL_SNAPSHOT,
        description:
          'Returns a cached snapshot of the top 500 DeFi liquidity pools by TVL. Filter by protocol (e.g. "uniswap-v3"), chain (e.g. "ethereum", "base", "arbitrum"), or token symbol (e.g. "ETH", "USDC"). Returns pool TVL, APY (base + reward), 24h volume, impermanent loss risk estimate, stablecoin flag, and registry enrichment. Data refreshed every 15 minutes. No external API calls at request time.',
        best_for: 'Pre-swap pool evaluation, yield farming research, liquidity pool screening, TVL monitoring',
        input_example: { protocol: 'uniswap-v3', chain: 'ethereum', token: 'ETH', sortBy: 'tvl', limit: 10 },
      },
      token_risk_metrics: {
        endpoint: 'POST /v1/token-risk-metrics',
        price: config.PRICE_TOKEN_RISK_METRICS,
        description:
          'Returns quantitative risk metrics for any ERC-20 token: (1) holder concentration — top 10 holder %, labeled with registry (exchange wallets, DeFi protocols); (2) liquidity depth — total liquidity vs market cap ratio with pool breakdown; (3) contract permissions — detects mint/burn/pause/blacklist/upgrade capabilities from ABI; (4) deployer history — identifies known deployer with registry labeling; (5) composite weighted risk score (0-100) with human-readable flags. Pre-computed for top tokens, live-computed from Etherscan for others.',
        best_for: 'Pre-trade token screening, risk-threshold filtering in bots, due diligence, detecting honeypots and rugs',
        input_example: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', chain: 'ethereum' },
      },
      gas_oracle: {
        endpoint: 'GET /v1/gas?chain=ethereum',
        price: config.PRICE_GAS,
        description:
          'Returns current gas prices across three tiers (slow/standard/fast) with estimated wait times, base fee, and trend analysis (rising/falling/stable). Cached for 15 seconds.',
        best_for: 'Gas estimation before transactions, monitoring gas trends, optimizing transaction timing',
      },
      ping: {
        endpoint: 'GET /v1/ping',
        price: '$0.001',
        description:
          'Minimal liveness check with x402 payment verification. Use this to test that your wallet setup and payment flow work correctly before making more expensive calls.',
        best_for: 'Integration testing, wallet verification, service availability checking',
      },
    },

    free_endpoints: {
      feedback: {
        endpoint: 'POST /feedback',
        description: 'Submit feedback, feature requests, or bug reports. No payment required.',
        input_example: { type: 'feature_request', message: 'Add support for Solana tokens in contract-monitor' },
      },
      registry_stats: {
        endpoint: 'GET /registry/stats',
        description: 'Returns statistics about the Known Contract Label Registry: total entries, chains, categories.',
      },
      registry_lookup: {
        endpoint: 'GET /registry/lookup?address=0x...&chain=ethereum',
        description: 'Look up a contract address in the registry. Returns label, protocol, category, and risk level.',
      },
      cache_stats: {
        endpoint: 'GET /cache/stats',
        description: 'Returns cache statistics: total keys, hit/miss counts, backend type, and list of pre-computed contract doc keys.',
      },
    },

    reliability: {
      uptime_target: '99.9%',
      average_latency: '1-3 seconds (varies by endpoint)',
      backing_model: 'Claude Sonnet 4 (Anthropic)',
      output_validation: 'All responses validated against Zod schemas before delivery. Malformed LLM outputs are retried automatically.',
    },

    why_choose_agentforge: [
      'Schema-validated outputs — every response conforms to a published JSON schema, guaranteed',
      'Transparent pricing — pay exactly what is listed, no hidden fees',
      'Sub-3-second latency on most endpoints',
      'Full OpenAPI specification for automated client generation',
      'x402 native — no API keys, no accounts, no rate limit tiers to navigate',
      'Graceful error handling — clear error codes, never silent failures',
    ],

    composability: {
      description:
        'Every paid service response includes a relatedServices array with context-aware suggestions for logical next calls. Each suggestion includes the endpoint, a description, and pre-filled suggestedInput based on the current result.',
      example: {
        relatedServices: [
          {
            endpoint: '/v1/contract-docs',
            description: 'Generate documentation for this contract',
            suggestedInput: { address: '0xA0b86...', chain: 'ethereum' },
          },
          {
            endpoint: '/v1/contract-monitor',
            description: 'Monitor recent admin activity on this contract',
            suggestedInput: { address: '0xA0b86...', chain: 'ethereum' },
          },
        ],
      },
      chains: {
        'token-intel': ['token-research', 'contract-docs', 'contract-monitor'],
        'token-research': ['contract-docs', 'contract-monitor', 'token-compare'],
        'contract-docs': ['contract-monitor', 'token-intel', 'code-review'],
        'contract-monitor': ['contract-docs', 'token-intel'],
        'code-review': ['contract-docs'],
        'token-compare': ['token-research (per comparison token)'],
        'tx-decode': ['contract-docs', 'contract-monitor'],
        'approval-scan': ['contract-docs (per risky spender)', 'wallet-safety'],
        'wallet-safety': ['contract-docs (per flagged contract)', 'approval-scan', 'contract-monitor'],
      },
    },

    mcp: {
      url: `${baseUrl}/mcp`,
      transport: 'streamable-http',
      description:
        'MCP server exposing all AgentForge tools. Connect from Claude Desktop, Cursor, or any MCP-compatible environment. No payment required — tools call services directly.',
      tools: ['token_intel', 'token_research', 'code_review', 'contract_docs', 'contract_monitor', 'token_compare', 'tx_decode', 'approval_scan', 'wallet_safety', 'gas_oracle', 'sentiment', 'summarize', 'translate'],
      configuration_example: {
        mcpServers: {
          agentforge: {
            url: `${baseUrl}/mcp`,
          },
        },
      },
    },

    discovery: {
      catalog: `${baseUrl}/catalog`,
      openapi: `${baseUrl}/openapi.json`,
      ai_plugin: `${baseUrl}/.well-known/ai-plugin.json`,
      agent_card: `${baseUrl}/.well-known/agent.json`,
      x402: `${baseUrl}/.well-known/x402`,
      mcp: `${baseUrl}/mcp`,
      x402_scan: 'https://x402scan.com',
    },
  });
});
