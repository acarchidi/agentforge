import { config } from './config.js';

function parsePrice(priceString: string): number {
  return Number(priceString.replace(/^\$/, ''));
}

/** Item limits for the per-item priced batch endpoints. */
export const RISK_BATCH_LIMITS = { min: 2, max: 25 } as const;
export const ADDRESS_CHECK_LIMITS = { min: 1, max: 100 } as const;

export const RISK_BATCH_PER_TOKEN = parsePrice(config.PRICE_RISK_BATCH_PER_TOKEN);
export const ADDRESS_CHECK_BASE = parsePrice(config.PRICE_ADDRESS_CHECK);
export const ADDRESS_CHECK_PER_EXTRA = parsePrice(config.PRICE_ADDRESS_CHECK_PER_EXTRA);

/**
 * Price per paid endpoint in USD — derived from config.PRICE_* (the same
 * source the x402 middleware charges from) so analytics and MCP hints can
 * never drift from what a caller is actually billed.
 */
export const ENDPOINT_PRICES: Record<string, number> = {
  '/v1/token-intel': parsePrice(config.PRICE_TOKEN_INTEL),
  '/v1/token-research': parsePrice(config.PRICE_TOKEN_RESEARCH),
  '/v1/contract-docs': parsePrice(config.PRICE_CONTRACT_DOCS),
  '/v1/contract-monitor': parsePrice(config.PRICE_CONTRACT_MONITOR),
  '/v1/token-compare': parsePrice(config.PRICE_TOKEN_COMPARE),
  '/v1/tx-decode': parsePrice(config.PRICE_TX_DECODE),
  '/v1/approval-scan': parsePrice(config.PRICE_APPROVAL_SCAN),
  '/v1/gas': parsePrice(config.PRICE_GAS),
  '/v1/sentiment': parsePrice(config.PRICE_SENTIMENT),
  '/v1/summarize': parsePrice(config.PRICE_SUMMARIZE),
  '/v1/translate': parsePrice(config.PRICE_TRANSLATE),
  '/v1/wallet-safety': parsePrice(config.PRICE_WALLET_SAFETY),
  '/v1/pool-snapshot': parsePrice(config.PRICE_POOL_SNAPSHOT),
  '/v1/token-risk-metrics': parsePrice(config.PRICE_TOKEN_RISK_METRICS),
  '/v1/trade-check': parsePrice(config.PRICE_TRADE_CHECK),
  // Per-item endpoints list their minimum charge here; priceFor() has the formula.
  '/v1/risk-batch': RISK_BATCH_PER_TOKEN * RISK_BATCH_LIMITS.min,
  '/v1/address-check': ADDRESS_CHECK_BASE,
  '/v1/launches': parsePrice(config.PRICE_LAUNCHES),
  '/v1/solana/tx-explain': parsePrice(config.PRICE_SOLANA_TX_EXPLAIN),
  '/v1/solana/tx-simulate': parsePrice(config.PRICE_SOLANA_TX_SIMULATE),
  '/v1/solana/token-risk-scan': parsePrice(config.PRICE_SOLANA_TOKEN_RISK_SCAN),
  '/v1/ping': 0.001,
};

/** MCP tool name → paid x402 endpoint path (free tools have no entry). */
export const TOOL_TO_ENDPOINT: Record<string, string> = {
  token_intel: '/v1/token-intel',
  token_research: '/v1/token-research',
  contract_docs: '/v1/contract-docs',
  contract_monitor: '/v1/contract-monitor',
  token_compare: '/v1/token-compare',
  tx_decode: '/v1/tx-decode',
  approval_scan: '/v1/approval-scan',
  gas_oracle: '/v1/gas',
  sentiment: '/v1/sentiment',
  summarize: '/v1/summarize',
  translate: '/v1/translate',
  wallet_safety: '/v1/wallet-safety',
  pool_snapshot: '/v1/pool-snapshot',
  token_risk_metrics: '/v1/token-risk-metrics',
  trade_check: '/v1/trade-check',
  risk_batch: '/v1/risk-batch',
  address_check: '/v1/address-check',
  launch_feed: '/v1/launches',
  solana_tx_explain: '/v1/solana/tx-explain',
  solana_tx_simulate: '/v1/solana/tx-simulate',
  solana_token_risk_scan: '/v1/solana/token-risk-scan',
};

function itemCount(list: unknown, fallback: number, limits: { min: number; max: number }): number {
  const n = Array.isArray(list) ? list.length : fallback;
  return Math.min(limits.max, Math.max(limits.min, n));
}

/** USDC has 6 decimals; keep float noise out of quoted prices. */
function roundUsd(n: number): number {
  return Number(n.toFixed(6));
}

/**
 * Exact price of one request. Fixed-price endpoints return ENDPOINT_PRICES;
 * per-item endpoints price the request body, so the 402 quote, the x402
 * verification, and the analytics row all agree. Out-of-range bodies are
 * clamped here and then rejected by the route's validation (400 → no charge).
 */
export function priceFor(endpoint: string, body?: unknown): number {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  switch (endpoint) {
    case '/v1/risk-batch':
      return roundUsd(RISK_BATCH_PER_TOKEN * itemCount(b.tokens, RISK_BATCH_LIMITS.min, RISK_BATCH_LIMITS));
    case '/v1/address-check': {
      const n = itemCount(b.addresses, typeof b.address === 'string' ? 1 : ADDRESS_CHECK_LIMITS.min, ADDRESS_CHECK_LIMITS);
      return roundUsd(ADDRESS_CHECK_BASE + ADDRESS_CHECK_PER_EXTRA * (n - 1));
    }
    default:
      return ENDPOINT_PRICES[endpoint] ?? 0;
  }
}

/** Human-readable pricing rule for discovery docs. */
export const PRICING_RULES: Record<string, string> = {
  '/v1/risk-batch': `${formatUsd(RISK_BATCH_PER_TOKEN)} per token, ${RISK_BATCH_LIMITS.min}-${RISK_BATCH_LIMITS.max} tokens per call`,
  '/v1/address-check': `${formatUsd(ADDRESS_CHECK_BASE)} for the first address + ${formatUsd(ADDRESS_CHECK_PER_EXTRA)} per additional, up to ${ADDRESS_CHECK_LIMITS.max} per call`,
};

export const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? 'https://agentforge-taupe.vercel.app';

export function formatUsd(amount: number): string {
  // Sub-cent prices are the norm here; two-decimal rounding misadvertised
  // $0.025 as "$0.03" and $0.015 as "$0.01". Number() trims trailing zeros.
  return `$${Number(amount.toFixed(4))}`;
}
