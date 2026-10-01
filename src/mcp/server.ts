/**
 * MCP (Model Context Protocol) Server
 *
 * Exposes all AgentForge services as MCP tools so agents in Claude Desktop,
 * Cursor, Windsurf, and other MCP environments can discover and use them.
 *
 * MCP tools call service functions directly — no x402 payment required — but
 * every call is logged to the durable analytics store. Free lookups
 * (registry_lookup, solana_program_lookup) and cheap data tools (gas_oracle,
 * pool_snapshot) are unlimited; every analysis tool (all of which call an LLM or
 * a metered upstream) carries a per-client daily cap that points callers at the
 * paid x402 endpoint once exhausted.
 *
 * A NEW server instance is created per HTTP request (see createMcpServer):
 * the MCP SDK's Protocol can only be connected to one transport at a time, so a
 * module-level singleton fails with "Already connected to a transport" on every
 * request after the first on a warm serverless instance.
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
import { explainSolanaTxWithCost } from '../services/solana/txExplain.js';
import { simulateSolanaTxWithCost } from '../services/solana/txSimulate.js';
import { scanSolanaTokenRiskWithCost } from '../services/solana/tokenRiskScan.js';
import { getRegistry } from '../registry/lookup.js';
import { getSolanaProgramRegistry } from '../registry/solanaPrograms.js';
import { logEvent } from '../analytics/logger.js';
import { getStore } from '../analytics/store.js';
import { ENDPOINT_PRICES, TOOL_TO_ENDPOINT, PUBLIC_BASE_URL, formatUsd } from '../pricing.js';

export const MCP_SERVER_VERSION = '1.5.0';

/** Tools that stay unlimited over MCP: free lookups and cheap, LLM-free data reads. */
export const UNCAPPED_TOOLS = new Set(['registry_lookup', 'solana_program_lookup', 'gas_oracle', 'pool_snapshot']);

/**
 * Tools that are capped per client per day when invoked via MCP: every tool that
 * maps to a paid endpoint, minus the cheap uncapped ones. These spend Anthropic /
 * upstream API budget, so the free MCP channel needs a ceiling.
 */
export const CAPPED_TOOLS = new Set(Object.keys(TOOL_TO_ENDPOINT).filter((t) => !UNCAPPED_TOOLS.has(t)));

export const MCP_DAILY_CAP = Math.max(1, Number(process.env.MCP_DAILY_CAP) || 10);

export interface McpRequestContext {
  /** Salted hash of the MCP session id, or of IP + user-agent when the client is stateless. */
  clientHash: string;
}

export interface RelatedService {
  endpoint: string;
  price: string;
  network: string;
  description?: string;
}

function endpointUrl(path: string): string {
  return `${PUBLIC_BASE_URL}${path}`;
}

function priceOf(path: string): string {
  const p = ENDPOINT_PRICES[path];
  return p === undefined ? 'free' : formatUsd(p);
}

/**
 * Paid x402 endpoints related to a tool: its own paid endpoint first, then any
 * `relatedServices` the service itself suggested, resolved to full URLs + prices.
 */
export function relatedServicesFor(toolName: string, output: unknown): RelatedService[] {
  const seen = new Set<string>();
  const out: RelatedService[] = [];
  const push = (path: string, description?: string) => {
    if (!path.startsWith('/v1/') || seen.has(path)) return;
    seen.add(path);
    const network = path.startsWith('/v1/solana/') ? 'USDC on Base (eip155:8453) or Solana' : 'USDC on Base (eip155:8453)';
    out.push({ endpoint: endpointUrl(path), price: priceOf(path), network, description });
  };
  const own = TOOL_TO_ENDPOINT[toolName];
  if (own) push(own, 'Pay-per-use x402 endpoint for this tool');
  const suggested = (output as { relatedServices?: unknown } | null)?.relatedServices;
  if (Array.isArray(suggested)) {
    for (const s of suggested) {
      if (s && typeof s === 'object' && typeof (s as { endpoint?: unknown }).endpoint === 'string') {
        push((s as { endpoint: string }).endpoint, (s as { description?: string }).description);
      }
    }
  }
  if (toolName.startsWith('solana_')) {
    for (const path of ['/v1/solana/token-risk-scan', '/v1/solana/tx-simulate', '/v1/solana/tx-explain']) push(path);
  }
  return out;
}

function chainOf(toolName: string, input: unknown): string | undefined {
  if (toolName.startsWith('solana_')) return 'solana';
  const chain = (input as { chain?: unknown } | null)?.chain;
  return typeof chain === 'string' ? chain : undefined;
}

function classifyError(error: unknown): string {
  const msg = error instanceof Error ? error.message.toLowerCase() : '';
  if (/invalid|expected|required|must be/.test(msg)) return 'validation';
  if (/timeout|timed out/.test(msg)) return 'upstream_timeout';
  if (/429|rate limit/.test(msg)) return 'upstream_rate_limit';
  if (/not found|404/.test(msg)) return 'not_found';
  return 'internal';
}

function capHitResponse(toolName: string, used: number) {
  const path = TOOL_TO_ENDPOINT[toolName];
  const url = endpointUrl(path);
  const price = priceOf(path);
  const resetsAt = new Date();
  resetsAt.setUTCHours(24, 0, 0, 0);
  const body = {
    error: 'DAILY_CAP_REACHED',
    tool: toolName,
    used,
    cap: MCP_DAILY_CAP,
    resetsAt: resetsAt.toISOString(),
    payPerUse: {
      endpoint: url,
      price,
      network: 'USDC on Base (eip155:8453) or Solana mainnet',
      instruction: `POST ${url} with an x402 payment of ${price} USDC (Base or Solana) — no signup, no key; any x402 client (e.g. @x402/fetch) handles the 402 automatically.`,
      docs: `${PUBLIC_BASE_URL}/SKILL.md`,
    },
    relatedServices: relatedServicesFor(toolName, null),
  };
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(body, null, 2) }],
    isError: true,
  };
}

/**
 * Build a fresh McpServer with every AgentForge tool registered.
 * Pass the request context so tool calls are logged against a hashed client id.
 */
export function createMcpServer(ctx: McpRequestContext = { clientHash: 'anonymous' }): McpServer {
  const server = new McpServer({
    name: 'agentforge',
    version: MCP_SERVER_VERSION,
  });

  // ── Shared chain enums ────────────────────────────────────────────

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

  // ── Helper: wrap service call with cap check, logging, relatedServices ──

  async function call<T>(
    toolName: string,
    fn: (input: T) => Promise<{ output: unknown; estimatedCostUsd: number }>,
    input: T,
  ) {
    const startTime = Date.now();
    const chain = chainOf(toolName, input);

    if (CAPPED_TOOLS.has(toolName)) {
      let used = 0;
      try {
        used = await getStore().countToday('mcp', toolName, ctx.clientHash);
      } catch (error) {
        console.error('mcp cap lookup failed (allowing call):', error);
      }
      if (used >= MCP_DAILY_CAP) {
        await logEvent({ kind: 'cap_hit', name: toolName, chain, success: false, clientHash: ctx.clientHash, latencyMs: 0 });
        return capHitResponse(toolName, used);
      }
    }

    try {
      const result = await fn(input);
      const output = result.output;
      const enriched =
        output && typeof output === 'object' && !Array.isArray(output)
          ? { ...(output as Record<string, unknown>), relatedServices: relatedServicesFor(toolName, output) }
          : { result: output, relatedServices: relatedServicesFor(toolName, output) };
      await logEvent({
        kind: 'mcp',
        name: toolName,
        chain,
        success: true,
        latencyMs: Date.now() - startTime,
        clientHash: ctx.clientHash,
        estimatedCostUsd: result.estimatedCostUsd,
        outputSize: JSON.stringify(output).length,
      });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(enriched, null, 2) }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await logEvent({
        kind: 'mcp',
        name: toolName,
        chain,
        success: false,
        latencyMs: Date.now() - startTime,
        clientHash: ctx.clientHash,
        errorClass: classifyError(error),
      });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: message, relatedServices: relatedServicesFor(toolName, null) }, null, 2) }],
        isError: true,
      };
    }
  }

  // ── Tool registrations ──────────────────────────────────────────────

  server.tool(
    'token_intel',
    'Lightweight token lookup: price, market cap, volume, and basic risk assessment for any EVM or Solana token.',
    {
      address: z.string().describe('Token contract address or name'),
      chain: intelChain,
    },
    async (input) => call('token_intel', getTokenIntelWithCost, input),
  );

  server.tool(
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
    async (input) => call('token_research', tokenResearchWithCost, input as any),
  );

  server.tool(
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
    async (input) => call('code_review', reviewCodeWithCost, input),
  );

  server.tool(
    'contract_docs',
    'Generate documentation for any verified EVM smart contract. Returns function descriptions, risk flags, interaction patterns, and security posture.',
    {
      address: z.string().describe('Contract address'),
      chain: evmChain,
      focusFunctions: z.array(z.string()).optional().describe('Specific functions to document'),
    },
    async (input) => call('contract_docs', contractDocsWithCost, input),
  );

  server.tool(
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
    async (input) => call('contract_monitor', contractMonitorWithCost, input),
  );

  server.tool(
    'token_compare',
    'Compare a primary token against up to 3 others. Returns full research on primary, abbreviated metrics on comparisons, plus AI comparative analysis.',
    {
      primary: z.string().describe('Primary token to research'),
      compare: z.array(z.string()).min(1).max(3).describe('Tokens to compare against (1-3)'),
      chain: evmChain,
    },
    async (input) => call('token_compare', tokenCompareWithCost, input),
  );

  server.tool(
    'tx_decode',
    'Decode any EVM transaction: function call, parameters, token transfers, and plain-English explanation.',
    {
      txHash: z.string().describe('Transaction hash (0x-prefixed, 64 hex chars)'),
      chain: evmChain,
    },
    async (input) => call('tx_decode', decodeTransactionWithCost, input),
  );

  server.tool(
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
    async (input) => call('approval_scan', scanApprovalsWithCost, input),
  );

  server.tool(
    'gas_oracle',
    'Current gas prices (slow/standard/fast) for any supported EVM chain with trend analysis.',
    {
      chain: evmChain,
    },
    async (input) => call('gas_oracle', getGasPriceWithCost, input),
  );

  server.tool(
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
    async (input) => call('sentiment', analyzeSentimentWithCost, input),
  );

  server.tool(
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
    async (input) => call('summarize', summarizeWithCost, input),
  );

  server.tool(
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
    async (input) => call('translate', translateWithCost, input),
  );

  server.tool(
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
    async (input) => call('wallet_safety', walletSafetyWithCost, input),
  );

  server.tool(
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
    async (input) => call('pool_snapshot', getPoolSnapshotWithCost, input),
  );

  server.tool(
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
    async (input) => call('token_risk_metrics', getTokenRiskMetricsWithCost, input),
  );

  server.tool(
    'registry_lookup',
    'Look up a contract address in the Known Contract Label Registry. Returns protocol name, category, risk level, and tags. Free — no payment required.',
    {
      address: z.string().describe('Contract address (0x-prefixed)'),
      chain: z.string().optional().describe('Blockchain network (e.g., ethereum, base)'),
    },
    async (input) => call('registry_lookup', async (i: typeof input) => ({
      output: { address: i.address.toLowerCase(), chain: i.chain ?? null, entry: getRegistry().lookup(i.address, i.chain) },
      estimatedCostUsd: 0,
    }), input),
  );

  server.tool(
    'solana_program_lookup',
    'Look up a Solana program ID in the program label registry. Returns protocol name, category, risk level. Free — no payment required.',
    {
      programId: z.string().describe('Base58 Solana program ID'),
    },
    async (input) => call('solana_program_lookup', async (i: typeof input) => {
      const entry = getSolanaProgramRegistry().lookup(i.programId);
      return { output: { found: entry !== null, programId: i.programId, entry }, estimatedCostUsd: 0 };
    }, input),
  );

  server.tool(
    'solana_tx_explain',
    'Explain a Solana transaction in plain English: labeled programs, token/SOL movements, success status, and risk flags.',
    {
      signature: z.string().describe('Base58 Solana transaction signature'),
    },
    async (input) => call('solana_tx_explain', explainSolanaTxWithCost, input),
  );

  server.tool(
    'solana_tx_simulate',
    'Simulate a Solana transaction before signing it: balance changes, labeled programs, deterministic risk rules, and a proceed/caution/avoid recommendation.',
    {
      transaction: z.string().describe('Base64-encoded unsigned (or signed) Solana transaction'),
    },
    async (input) => call('solana_tx_simulate', simulateSolanaTxWithCost, input),
  );

  server.tool(
    'solana_token_risk_scan',
    'Solana token rug check: mint/freeze authority, holder concentration, liquidity depth, and a composite 0-100 risk score.',
    {
      mint: z.string().describe('Base58 Solana token mint address'),
    },
    async (input) => call('solana_token_risk_scan', scanSolanaTokenRiskWithCost, input),
  );

  return server;
}

/** Default instance for introspection and tests. Do NOT connect this to a transport per request. */
export const mcpServer = createMcpServer();
