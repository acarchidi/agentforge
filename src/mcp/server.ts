/**
 * MCP (Model Context Protocol) Server
 *
 * Exposes all AgentForge paid services as MCP tools so agents in
 * Claude Desktop, Cursor, Windsurf, and other MCP environments
 * can discover and use them natively.
 *
 * MCP tools call service functions directly — no x402 payment required.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { tokenResearchWithCost } from '../services/tokenResearch.js';
import { reviewCodeWithCost } from '../services/codeReview.js';
import { contractDocsWithCost } from '../services/contractDocs.js';
import { getTokenIntelWithCost } from '../services/tokenIntel.js';
import { contractMonitorWithCost } from '../services/contractMonitor.js';
import { tokenCompareWithCost } from '../services/tokenCompare.js';
import { decodeTransactionWithCost } from '../services/txDecoder.js';
import { scanApprovalsWithCost } from '../services/approvalScanner.js';
import { getGasPriceWithCost } from '../services/gasOracle.js';
import { analyzeSentimentWithCost } from '../services/sentiment.js';
import { summarizeWithCost } from '../services/summarize.js';
import { translateWithCost } from '../services/translate.js';
import { walletSafetyWithCost } from '../services/walletSafety/index.js';
import { getPoolSnapshotWithCost } from '../services/poolSnapshots.js';
import { getTokenRiskMetricsWithCost } from '../services/tokenRiskMetrics/index.js';
import { getRegistry } from '../registry/lookup.js';

export const mcpServer = new McpServer({
  name: 'agentforge',
  version: '1.0.0',
});

// ── Shared chain enums ──────────────────────────────────────────────

const evmChain = z
  .enum(['ethereum', 'base', 'polygon', 'arbitrum', 'optimism', 'avalanche'])
  .optional()
  .default('ethereum')
  .describe('Blockchain network');

const intelChain = z
  .enum(['ethereum', 'base', 'solana', 'polygon', 'arbitrum'])
  .optional()
  .default('ethereum')
  .describe('Blockchain network');

// ── Helper: wrap service call with error handling ───────────────────

async function callService<T>(
  fn: (input: T) => Promise<{ output: unknown; estimatedCostUsd: number }>,
  input: T,
) {
  try {
    const result = await fn(input);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result.output, null, 2) }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text' as const, text: `Error: ${message}` }],
      isError: true,
    };
  }
}

// ── Tool registrations ──────────────────────────────────────────────

mcpServer.tool(
  'token_intel',
  'Lightweight token lookup: price, market cap, volume, and basic risk assessment for any EVM or Solana token.',
  {
    address: z.string().describe('Token contract address or name'),
    chain: intelChain,
  },
  async (input) => callService(getTokenIntelWithCost, input),
);

mcpServer.tool(
  'token_research',
  'Multi-source token intelligence: market data, DeFi metrics, contract verification, prediction markets, holder analysis, price history, and AI risk assessment. Aggregates CoinGecko, DeFiLlama, Etherscan, and Polymarket.',
  {
    query: z.string().describe('Token name, symbol, or contract address'),
    chain: evmChain,
    include: z
      .array(
        z.enum([
          'market_data', 'defi_metrics', 'contract_info', 'prediction_markets',
          'institutional', 'risk_assessment', 'price_history', 'holders',
        ]),
      )
      .optional()
      .describe('Data modules to include (default: market_data, defi_metrics, contract_info, risk_assessment)'),
  },
  async (input) => callService(tokenResearchWithCost, input as any),
);

mcpServer.tool(
  'code_review',
  'Smart contract security analysis. Finds vulnerabilities, suggests gas optimizations, flags best practice violations. Supports Solidity, Rust, Move, TypeScript.',
  {
    code: z.string().describe('Smart contract source code'),
    language: z
      .enum(['solidity', 'rust', 'move', 'typescript'])
      .optional()
      .default('solidity')
      .describe('Programming language'),
    focus: z
      .enum(['security', 'gas_optimization', 'best_practices', 'all'])
      .optional()
      .default('all')
      .describe('Analysis focus area'),
    previousCode: z.string().optional().describe('Previous version for diff review'),
  },
  async (input) => callService(reviewCodeWithCost, input),
);

mcpServer.tool(
  'contract_docs',
  'Generate documentation for any verified EVM smart contract. Returns function descriptions, risk flags, interaction patterns, and security posture.',
  {
    address: z.string().describe('Contract address'),
    chain: evmChain,
    focusFunctions: z.array(z.string()).optional().describe('Specific functions to document'),
  },
  async (input) => callService(contractDocsWithCost, input),
);

mcpServer.tool(
  'contract_monitor',
  'Monitor recent contract activity for suspicious admin operations, proxy upgrades, ownership changes, and pause events.',
  {
    address: z.string().describe('Contract address'),
    chain: evmChain,
    lookbackHours: z
      .number()
      .min(1)
      .max(168)
      .optional()
      .default(24)
      .describe('Hours to look back (max 168)'),
  },
  async (input) => callService(contractMonitorWithCost, input),
);

mcpServer.tool(
  'token_compare',
  'Compare a primary token against up to 3 others. Returns full research on primary, abbreviated metrics on comparisons, plus AI comparative analysis.',
  {
    primary: z.string().describe('Primary token to research'),
    compare: z.array(z.string()).min(1).max(3).describe('Tokens to compare against (1-3)'),
    chain: evmChain,
  },
  async (input) => callService(tokenCompareWithCost, input),
);

mcpServer.tool(
  'tx_decode',
  'Decode any EVM transaction: function call, parameters, token transfers, and plain-English explanation.',
  {
    txHash: z.string().describe('Transaction hash (0x-prefixed, 64 hex chars)'),
    chain: evmChain,
  },
  async (input) => callService(decodeTransactionWithCost, input),
);

mcpServer.tool(
  'approval_scan',
  'Scan a wallet for risky token approvals. On EVM chains: identifies unlimited ERC-20 approvals and unverified spenders. On Solana: scans SPL token delegate authorities. Returns risk assessment.',
  {
    address: z.string().describe('Wallet address to scan (0x-prefixed for EVM, base58 for Solana)'),
    chain: z
      .enum(['ethereum', 'base', 'polygon', 'arbitrum', 'optimism', 'avalanche', 'solana'])
      .optional()
      .default('ethereum')
      .describe('Blockchain network (includes Solana support)'),
  },
  async (input) => callService(scanApprovalsWithCost, input),
);

mcpServer.tool(
  'gas_oracle',
  'Current gas prices (slow/standard/fast) for any supported EVM chain with trend analysis.',
  {
    chain: evmChain,
  },
  async (input) => callService(getGasPriceWithCost, input),
);

mcpServer.tool(
  'sentiment',
  'Analyze sentiment of text in crypto, finance, social media, or general context. Returns score (-1 to 1), confidence, label (very_bearish to very_bullish), reasoning, and per-entity sentiment.',
  {
    text: z.string().min(1).max(10000).describe('Text to analyze for sentiment'),
    context: z
      .enum(['crypto', 'finance', 'general', 'social_media'])
      .optional()
      .default('crypto')
      .describe('Context for sentiment analysis'),
  },
  async (input) => callService(analyzeSentimentWithCost, input),
);

mcpServer.tool(
  'summarize',
  'Summarize text with configurable length (brief/standard/detailed), format (prose/bullet_points/structured), and optional topic focus. Returns summary, key points, and compression ratio.',
  {
    text: z.string().min(1).max(50000).describe('Text to summarize'),
    maxLength: z
      .enum(['brief', 'standard', 'detailed'])
      .optional()
      .default('standard')
      .describe('Summary length'),
    format: z
      .enum(['prose', 'bullet_points', 'structured'])
      .optional()
      .default('structured')
      .describe('Output format'),
    focus: z.string().max(200).optional().describe('Optional topic to focus the summary on'),
  },
  async (input) => callService(summarizeWithCost, input),
);

mcpServer.tool(
  'translate',
  'Translate text to any language with tone control (formal/casual/technical). Auto-detects source language. Preserves formatting and cultural nuances.',
  {
    text: z.string().min(1).max(20000).describe('Text to translate'),
    targetLanguage: z.string().min(2).max(50).describe('Target language (e.g., Spanish, French, Japanese)'),
    sourceLanguage: z.string().optional().describe('Source language (auto-detected if omitted)'),
    tone: z
      .enum(['formal', 'casual', 'technical'])
      .optional()
      .default('formal')
      .describe('Translation tone'),
  },
  async (input) => callService(translateWithCost, input),
);

mcpServer.tool(
  'wallet_safety',
  'Comprehensive wallet safety check: scans approvals, analyzes recent transaction activity for suspicious patterns, and assesses target contract risk. Returns composite risk score (0-100), risk level, action items, and related service suggestions. Supports EVM chains and Solana.',
  {
    walletAddress: z.string().describe('Wallet address to check (0x-prefixed for EVM, base58 for Solana)'),
    chain: z
      .enum(['ethereum', 'base', 'arbitrum', 'optimism', 'polygon', 'solana'])
      .optional()
      .default('ethereum')
      .describe('Blockchain network (includes Solana support)'),
    targetContract: z.string().optional().describe('Optional target contract address to assess before interaction'),
    depth: z
      .enum(['quick', 'standard', 'deep'])
      .optional()
      .default('standard')
      .describe('Analysis depth: quick (approvals only), standard (approvals + activity), deep (extended history + all patterns)'),
  },
  async (input) => callService(walletSafetyWithCost, input),
);

mcpServer.tool(
  'pool_snapshot',
  'Get a cached snapshot of top DeFi liquidity pools. Filter by protocol (e.g. "uniswap-v3"), chain (e.g. "ethereum"), or token symbol (e.g. "ETH"). Returns TVL, APY, 24h volume, IL risk, and registry enrichment. Data refreshed every 15 minutes.',
  {
    protocol: z.string().optional().describe('Filter by protocol name, e.g. "uniswap-v3", "curve", "aave"'),
    chain: z.string().optional().describe('Filter by chain, e.g. "ethereum", "base", "arbitrum"'),
    token: z.string().optional().describe('Filter pools containing this token symbol, e.g. "ETH", "USDC"'),
    pool: z.string().optional().describe('Filter by specific pool address or DeFi Llama pool ID'),
    sortBy: z.enum(['tvl', 'apy', 'volume']).optional().default('tvl').describe('Sort field'),
    order: z.enum(['asc', 'desc']).optional().default('desc').describe('Sort order'),
    limit: z.number().int().min(1).max(100).optional().default(20).describe('Max results (1-100)'),
    offset: z.number().int().min(0).optional().default(0).describe('Pagination offset'),
  },
  async (input) => callService(getPoolSnapshotWithCost, input),
);

mcpServer.tool(
  'token_risk_metrics',
  'Quantitative risk metrics for any ERC-20 token: holder concentration (top 10 holder %), contract permissions (can mint/burn/pause/blacklist), liquidity depth vs market cap, deployer history, and weighted composite risk score (0-100). Pre-computed for top tokens, live-computed for others.',
  {
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/).describe('Token contract address (0x-prefixed)'),
    chain: z
      .enum(['ethereum', 'base', 'arbitrum', 'optimism', 'polygon'])
      .optional()
      .default('ethereum')
      .describe('Blockchain network'),
  },
  async (input) => callService(getTokenRiskMetricsWithCost, input),
);

mcpServer.tool(
  'registry_lookup',
  'Look up a contract address in the Known Contract Label Registry. Returns protocol name, category, risk level, and tags. Free — no payment required.',
  {
    address: z.string().describe('Contract address (0x-prefixed)'),
    chain: z.string().optional().describe('Blockchain network (e.g., ethereum, base)'),
  },
  async (input) => {
    const entry = getRegistry().lookup(input.address, input.chain);
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ address: input.address.toLowerCase(), chain: input.chain ?? null, entry }, null, 2),
      }],
    };
  },
);
