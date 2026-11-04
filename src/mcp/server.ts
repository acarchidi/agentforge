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

import { McpServer, type ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ZodRawShape } from 'zod';
import { z } from 'zod';
import { tokenResearchWithCost } from '../services/tokenResearch.js';
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
import { tradeCheckWithCost } from '../services/tradeCheck.js';
import { riskBatchWithCost } from '../services/riskBatch.js';
import { addressCheckWithCost } from '../services/addressCheck.js';
import { getLaunchesWithCost } from '../services/launches.js';
import { simulateEvmTxWithCost } from '../services/txSimulate.js';
import { getLendingHealthWithCost } from '../services/lendingHealth.js';
import { signatureCheckWithCost } from '../services/signatureCheck.js';
import { preflightWithCost } from '../services/preflight.js';
import { explainSolanaTxWithCost } from '../services/solana/txExplain.js';
import { simulateSolanaTxWithCost } from '../services/solana/txSimulate.js';
import { scanSolanaTokenRiskWithCost } from '../services/solana/tokenRiskScan.js';
import { getRegistry } from '../registry/lookup.js';
import { getSolanaProgramRegistry } from '../registry/solanaPrograms.js';
import { logEvent } from '../analytics/logger.js';
import { config } from '../config.js';
import { EVM_CHAINS, SIMULATE_CHAINS } from '../utils/chains.js';
import { LENDING_CHAINS } from '../schemas/lendingHealth.js';
import { getStore } from '../analytics/store.js';
import { ENDPOINT_PRICES, PRICING_RULES, TOOL_TO_ENDPOINT, PUBLIC_BASE_URL, formatUsd } from '../pricing.js';

export const MCP_SERVER_VERSION = '1.11.0';

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
  // Per-item endpoints quote a rule ("$0.004 per token, …"), not one number.
  return PRICING_RULES[path] ?? (p === undefined ? 'free' : formatUsd(p));
}

/** Paid GET endpoints; everything else is POST. */
const GET_ENDPOINTS = new Set(['/v1/gas', '/v1/pool-snapshot', '/v1/launches', '/v1/lending/health', '/v1/ping']);

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
      instruction: `${GET_ENDPOINTS.has(path) ? 'GET' : 'POST'} ${url} with an x402 payment of ${price} USDC (Base or Solana) — no signup, no key; any x402 client (e.g. @x402/fetch) handles the 402 automatically.`,
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

  // Every tool reads public data and changes nothing, so declare it (MCP tool
  // annotations), and tell agents about the free daily cap and the paid
  // fallback up front: directories such as Glama score tools on disclosing
  // side effects and limits.
  const register = <S extends ZodRawShape>(name: string, description: string, shape: S, cb: ToolCallback<S>) =>
    server.tool(
      name,
      CAPPED_TOOLS.has(name)
        ? `${description} Free over MCP for ${MCP_DAILY_CAP} calls per day; beyond that the tool returns the pay-per-call x402 endpoint and its price.`
        : description,
      shape,
      {
        title: name.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' '),
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      cb,
    );

  // ── Shared chain enums ────────────────────────────────────────────

  const evmChain = z
    .enum(['ethereum', 'base', 'polygon', 'arbitrum', 'optimism', 'avalanche'])
    .optional()
    .default('ethereum')
    .describe('Blockchain network');

  const intelChain = z
    .enum([...EVM_CHAINS, 'solana'])
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

  register(
    'token_intel',
    'Lightweight token lookup: price, market cap, volume, and basic risk assessment for any EVM or Solana token.',
    {
      address: z.string().describe('Token contract address or name'),
      chain: intelChain,
    },
    async (input) => call('token_intel', getTokenIntelWithCost, input),
  );

  register(
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

  register(
    'contract_docs',
    'Generate documentation for any verified EVM smart contract. Returns function descriptions, risk flags, interaction patterns, and security posture.',
    {
      address: z.string().describe('Contract address'),
      chain: evmChain,
      focusFunctions: z.array(z.string()).optional().describe('Specific functions to document'),
    },
    async (input) => call('contract_docs', contractDocsWithCost, input),
  );

  register(
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

  register(
    'token_compare',
    'Compare a primary token against up to 3 others. Returns full research on primary, abbreviated metrics on comparisons, plus AI comparative analysis.',
    {
      primary: z.string().describe('Primary token to research'),
      compare: z.array(z.string()).min(1).max(3).describe('Tokens to compare against (1-3)'),
      chain: evmChain,
    },
    async (input) => call('token_compare', tokenCompareWithCost, input),
  );

  register(
    'tx_decode',
    'Decode any EVM transaction: function call, parameters, token transfers, and plain-English explanation.',
    {
      txHash: z.string().describe('Transaction hash (0x-prefixed, 64 hex chars)'),
      chain: evmChain,
    },
    async (input) => call('tx_decode', decodeTransactionWithCost, input),
  );

  register(
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

  register(
    'gas_oracle',
    'Current gas prices (slow/standard/fast) for any supported EVM chain with trend analysis.',
    {
      chain: evmChain,
    },
    async (input) => call('gas_oracle', getGasPriceWithCost, input),
  );

  register(
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

  register(
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

  register(
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

  register(
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

  register(
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

  register(
    'token_risk_metrics',
    'Quantitative risk metrics for any ERC-20 token: holder concentration (top 10 holder %), contract permissions (can mint/burn/pause/blacklist), liquidity depth vs market cap, deployer history, and weighted composite risk score (0-100). Pre-computed for top tokens, live-computed for others.',
    {
      address: z.string().regex(/^0x[a-fA-F0-9]{40}$/).describe('Token contract address (0x-prefixed)'),
      chain: z
        .enum(EVM_CHAINS)
        .optional()
        .default('ethereum')
        .describe('Blockchain network'),
    },
    async (input) => call('token_risk_metrics', getTokenRiskMetricsWithCost, input),
  );

  register(
    'trade_check',
    'Check a token before you buy it: one call bundling quantitative rug-check metrics (holder concentration, permissions, liquidity), AI risk assessment with market data, and current gas — rolled into a proceed/caution/avoid verdict with reasons. Cheaper than calling the three services separately.',
    {
      address: z.string().regex(/^0x[a-fA-F0-9]{40}$/).describe('Token contract address (0x-prefixed)'),
      chain: z
        .enum(EVM_CHAINS)
        .optional()
        .default('ethereum')
        .describe('Blockchain network'),
    },
    async (input) => call('trade_check', tradeCheckWithCost, input),
  );

  register(
    'risk_batch',
    'Batch rug-check: risk scores (holder concentration, mint/blacklist/pause/upgrade permissions, liquidity depth) for 2-25 EVM tokens in one call. Use it to screen a watchlist or a list of candidate trades at once.',
    {
      tokens: z
        .array(z.object({
          address: z.string().regex(/^0x[a-fA-F0-9]{40}$/).describe('Token contract address'),
          chain: z.enum(EVM_CHAINS).optional().describe('Chain for this token (defaults to `chain`)'),
        }))
        .min(2)
        .max(25)
        .describe('Tokens to score'),
      chain: z.enum(EVM_CHAINS).optional().default('ethereum').describe('Default chain'),
    },
    async (input) => call('risk_batch', riskBatchWithCost, input),
  );

  register(
    'address_check',
    'Screen counterparty addresses before sending, approving, or interacting: OFAC sanctions, known scam/phishing wallets, labeled protocol contracts, and brand-new-address detection. 1-100 EVM or Solana addresses per call; returns block / caution / no_known_issues per address.',
    {
      addresses: z
        .array(z.object({
          address: z.string().describe('EVM (0x…) or Solana address'),
          chain: z.enum([...EVM_CHAINS, 'solana']).optional(),
        }))
        .min(1)
        .max(100)
        .describe('Addresses to screen'),
      chain: z.enum([...EVM_CHAINS, 'solana']).optional().default('ethereum').describe('Default chain'),
    },
    async (input) => call('address_check', addressCheckWithCost, input),
  );

  register(
    'launch_feed',
    'Newly launched tokens on Base, Ethereum, or Arbitrum, each already risk-scored (verification, owner powers, proxy, supply held off-pool, thin liquidity, honeypot trading pattern). Poll it: pass the previous nextSince as since to get only new launches.',
    {
      chain: z.enum(['base', 'ethereum', 'arbitrum', 'bsc', 'hyperevm']).optional().default('base'),
      since: z.string().optional().describe('ISO timestamp; only pools created after it'),
      minLiquidityUsd: z.number().min(0).optional().default(1000),
      maxRiskScore: z.number().int().min(0).max(100).optional().describe('Only launches scoring at or below this'),
      limit: z.number().int().min(1).max(100).optional().default(50),
    },
    async (input) => call('launch_feed', getLaunchesWithCost, input),
  );

  register(
    'preflight',
    'Is this action safe? Call once before any on-chain action: send the transactions, signature request, x402 payment request, recipients, and/or tokens the agent is about to act on, and get back one proceed/caution/avoid verdict. Transactions are simulated (reverts, assets out, approvals, counterparty screening), signatures decoded and checked for permit phishing, recipients screened against sanctions and scam lists, and tokens rug-checked, including tokens the simulation shows the wallet receiving. Returns one proceed / caution / avoid verdict with reasons. Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain, Avalanche, Linea, Unichain, Sonic and HyperEVM.',
    {
      chain: z.enum(EVM_CHAINS).optional().describe('Chain of the action (defaults to the typed data chainId, else base)'),
      from: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional().describe('Wallet taking the action; required with transactions'),
      transactions: z.array(z.object({ to: z.string(), data: z.string().optional(), value: z.string().optional() })).max(5).optional().describe('Transactions about to be signed, in order'),
      typedData: z.union([z.record(z.string(), z.unknown()), z.string()]).optional().describe('EIP-712 typed data about to be signed'),
      paymentRequired: z.record(z.string(), z.unknown()).optional().describe('x402 PaymentRequired about to be paid'),
      expectedMaxUsd: z.number().positive().optional(),
      recipients: z.array(z.string()).max(20).optional().describe('Addresses about to receive funds or permissions'),
      tokens: z.array(z.string()).max(5).optional().describe('Tokens about to be bought; each is rug-checked'),
    },
    async (input) => call('preflight', preflightWithCost, input),
  );

  register(
    'tx_simulate',
    'Simulate an EVM transaction (or a sequence of up to 5, e.g. approve then swap) before signing: revert check with reason, every asset leaving or entering the wallet, approvals granted, sanctions/scam screening of counterparties, and a proceed/caution/avoid verdict. Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain, Linea, Unichain, Sonic.',
    {
      chain: z.enum(SIMULATE_CHAINS).optional().default('base'),
      from: z.string().regex(/^0x[a-fA-F0-9]{40}$/).describe('Wallet that will sign'),
      transactions: z
        .array(z.object({
          to: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
          data: z.string().optional().default('0x').describe('Calldata (0x-hex)'),
          value: z.string().optional().default('0x0').describe('Wei, hex or decimal'),
        }))
        .min(1)
        .max(5),
    },
    async (input) => call('tx_simulate', simulateEvmTxWithCost, input),
  );

  register(
    'signature_check',
    'Check a signature request BEFORE signing it: decodes EIP-712 typed data (ERC-20 permit, Permit2, Seaport order, transfer authorization) or an x402 payment request, explains in one sentence what signing would allow, screens spenders and payees for sanctions and scams, and catches signature-drainer patterns. Returns proceed / caution / avoid.',
    {
      typedData: z.union([z.record(z.string(), z.unknown()), z.string()]).optional().describe('EIP-712 typed data { domain, types, primaryType, message }, or its JSON string'),
      paymentRequired: z.record(z.string(), z.unknown()).optional().describe('x402 PaymentRequired object with accepts[] the agent is about to pay'),
      signer: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional().describe('Wallet that would sign'),
      chain: z.enum(EVM_CHAINS).optional(),
      expectedMaxUsd: z.number().positive().optional().describe('x402 only: refuse payment options above this many USD'),
    },
    async (input) => call('signature_check', signatureCheckWithCost, input),
  );

  register(
    'lending_health',
    'How close a wallet is to liquidation on Aave v3 (Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain, Avalanche, Linea, and Sonic in one call): collateral, debt, health factor, status, and how far collateral can fall before liquidation.',
    {
      address: z.string().regex(/^0x[a-fA-F0-9]{40}$/).describe('Wallet address'),
      chain: z.enum(['all', ...LENDING_CHAINS]).optional().default('all'),
    },
    async (input) => call('lending_health', getLendingHealthWithCost, input),
  );

  register(
    'send_feedback',
    'Send AgentForge feedback: a bug or wrong result, a complaint, a feature or new-check request, or an idea. Free. Include a contact (email, wallet, or URL) if you want a reply.',
    {
      type: z.enum(['feature_request', 'bug_report', 'service_request', 'complaint', 'idea', 'general']),
      message: z.string().min(1).max(2000).describe('What happened or what you need'),
      endpoint: z.string().max(200).optional().describe('Tool or endpoint it concerns, if any'),
      contact: z.string().max(200).optional().describe('How to reach you, if you want a reply'),
    },
    async (input) => call('send_feedback', async (i: typeof input) => {
      await getStore().insertFeedback({ type: i.type, endpoint: i.endpoint ?? null, message: i.message, contact: i.contact ?? null });
      return { output: { status: 'received', email: config.CONTACT_EMAIL }, estimatedCostUsd: 0 };
    }, input),
  );

  register(
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

  register(
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

  register(
    'solana_tx_explain',
    'Explain a Solana transaction in plain English: labeled programs, token/SOL movements, success status, and risk flags.',
    {
      signature: z.string().describe('Base58 Solana transaction signature'),
    },
    async (input) => call('solana_tx_explain', explainSolanaTxWithCost, input),
  );

  register(
    'solana_tx_simulate',
    'Simulate a Solana transaction before signing it: balance changes, labeled programs, deterministic risk rules, and a proceed/caution/avoid recommendation.',
    {
      transaction: z.string().describe('Base64-encoded unsigned (or signed) Solana transaction'),
    },
    async (input) => call('solana_tx_simulate', simulateSolanaTxWithCost, input),
  );

  register(
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
