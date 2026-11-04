import { config } from './config.js';
import { PACKS, packFor } from './credits/auth.js';

function parsePrice(priceString: string): number {
  return Number(priceString.replace(/^\$/, ''));
}

/** Item limits for the per-item priced batch endpoints. */
export const RISK_BATCH_LIMITS = { min: 2, max: 25 } as const;
export const ADDRESS_CHECK_LIMITS = { min: 1, max: 100 } as const;
export const PREFLIGHT_LIMITS = { recipients: 20, tokens: 5 } as const;
/** Content scan: 1-16 items, priced per 4 KB chunk of total text, at most 64 KB (16 chunks). */
export const CONTENT_SCAN_LIMITS = { items: 16, chunkBytes: 4096, maxBytes: 65_536, maxChunks: 16 } as const;

export const RISK_BATCH_PER_TOKEN = parsePrice(config.PRICE_RISK_BATCH_PER_TOKEN);
export const ADDRESS_CHECK_BASE = parsePrice(config.PRICE_ADDRESS_CHECK);
export const ADDRESS_CHECK_PER_EXTRA = parsePrice(config.PRICE_ADDRESS_CHECK_PER_EXTRA);
/** Preflight: flat base (simulation + signature + recipients + up to 2 received tokens), plus the batch per-token rate for each requested token. */
export const PREFLIGHT_BASE = parsePrice(config.PRICE_PREFLIGHT);
export const CONTENT_SCAN_PER_CHUNK = parsePrice(config.PRICE_CONTENT_SCAN_PER_CHUNK);
export const WATCH_LIMITS = { minDays: 1, maxDays: 90 } as const;
export const WATCH_PRICE_PER_DAY: Record<string, number> = {
  'contract-admin': parsePrice(config.PRICE_WATCH_CONTRACT_ADMIN_DAY),
  'token-risk': parsePrice(config.PRICE_WATCH_TOKEN_RISK_DAY),
  'lending-health': parsePrice(config.PRICE_WATCH_LENDING_HEALTH_DAY),
};
export const WATCH_MIN = parsePrice(config.PRICE_WATCH_MIN);

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
  '/v1/tx-simulate': parsePrice(config.PRICE_TX_SIMULATE),
  '/v1/lending/health': parsePrice(config.PRICE_LENDING_HEALTH),
  '/v1/signature-check': parsePrice(config.PRICE_SIGNATURE_CHECK),
  '/v1/preflight': PREFLIGHT_BASE,
  '/v1/content-scan': CONTENT_SCAN_PER_CHUNK,
  '/v1/watch': WATCH_MIN,
  // Smallest pack; priceFor() prices the pack actually requested.
  '/v1/credits/buy': Number(PACKS['1'].priceMicro) / 1e6,
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
  tx_simulate: '/v1/tx-simulate',
  lending_health: '/v1/lending/health',
  signature_check: '/v1/signature-check',
  preflight: '/v1/preflight',
  content_scan: '/v1/content-scan',
  solana_tx_explain: '/v1/solana/tx-explain',
  solana_tx_simulate: '/v1/solana/tx-simulate',
  solana_token_risk_scan: '/v1/solana/token-risk-scan',
};

function itemCount(list: unknown, fallback: number, limits: { min: number; max: number }): number {
  const n = Array.isArray(list) ? list.length : fallback;
  return Math.min(limits.max, Math.max(limits.min, n));
}

/** UTF-8 bytes of the text a content-scan body carries (`text` or `items`). */
export function contentScanBytes(body: unknown): number {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (typeof b.text === 'string') return Buffer.byteLength(b.text, 'utf8');
  if (Array.isArray(b.items)) {
    return b.items.reduce<number>((n, it) => n + (typeof it === 'string' ? Buffer.byteLength(it, 'utf8') : 0), 0);
  }
  return 0;
}

/** 4 KB chunks a content-scan body is billed for: ceil(bytes / 4096), at least 1, clamped to the max. */
export function contentScanChunks(body: unknown): number {
  const chunks = Math.ceil(contentScanBytes(body) / CONTENT_SCAN_LIMITS.chunkBytes);
  return Math.min(CONTENT_SCAN_LIMITS.maxChunks, Math.max(1, chunks));
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
    case '/v1/watch': {
      const perDay = WATCH_PRICE_PER_DAY[String(b.type)] ?? WATCH_PRICE_PER_DAY['contract-admin'];
      const days = Math.min(WATCH_LIMITS.maxDays, Math.max(WATCH_LIMITS.minDays, Math.floor(Number(b.days) || WATCH_LIMITS.minDays)));
      return roundUsd(Math.max(WATCH_MIN, perDay * days));
    }
    case '/v1/credits/buy':
      return Number((packFor(String(b.pack ?? '1')) ?? PACKS['1']).priceMicro) / 1e6;
    case '/v1/preflight': {
      const tokens = Array.isArray(b.tokens) ? Math.min(b.tokens.length, PREFLIGHT_LIMITS.tokens) : 0;
      return roundUsd(PREFLIGHT_BASE + RISK_BATCH_PER_TOKEN * tokens);
    }
    case '/v1/content-scan':
      return roundUsd(CONTENT_SCAN_PER_CHUNK * contentScanChunks(b));
    default:
      return ENDPOINT_PRICES[endpoint] ?? 0;
  }
}

/** Human-readable pricing rule for discovery docs. */
export const PRICING_RULES: Record<string, string> = {
  '/v1/risk-batch': `${formatUsd(RISK_BATCH_PER_TOKEN)} per token, ${RISK_BATCH_LIMITS.min}-${RISK_BATCH_LIMITS.max} tokens per call`,
  '/v1/watch': `per day: contract-admin ${formatUsd(parsePrice(config.PRICE_WATCH_CONTRACT_ADMIN_DAY))}, token-risk ${formatUsd(parsePrice(config.PRICE_WATCH_TOKEN_RISK_DAY))}, lending-health ${formatUsd(parsePrice(config.PRICE_WATCH_LENDING_HEALTH_DAY))}; minimum ${formatUsd(parsePrice(config.PRICE_WATCH_MIN))}, 1-90 days`,
  '/v1/credits/buy': 'pack=1: $1 for $1.10 of credit; pack=5: $5 for $5.75; pack=20: $20 for $24',
  '/v1/preflight': `${formatUsd(PREFLIGHT_BASE)} per check + ${formatUsd(RISK_BATCH_PER_TOKEN)} per token you ask it to rug-check (up to ${PREFLIGHT_LIMITS.tokens})`,
  '/v1/address-check': `${formatUsd(ADDRESS_CHECK_BASE)} for the first address + ${formatUsd(ADDRESS_CHECK_PER_EXTRA)} per additional, up to ${ADDRESS_CHECK_LIMITS.max} per call`,
  '/v1/content-scan': `${formatUsd(CONTENT_SCAN_PER_CHUNK)} per 4 KB of text (minimum ${formatUsd(CONTENT_SCAN_PER_CHUNK)}), up to 64 KB and ${CONTENT_SCAN_LIMITS.items} items per call`,
};

export const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? 'https://agentforge-taupe.vercel.app';

export function formatUsd(amount: number): string {
  // Sub-cent prices are the norm here; two-decimal rounding misadvertised
  // $0.025 as "$0.03" and $0.015 as "$0.01". Number() trims trailing zeros.
  return `$${Number(amount.toFixed(4))}`;
}
