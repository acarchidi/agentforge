import { config } from './config.js';

function parsePrice(priceString: string): number {
  return Number(priceString.replace(/^\$/, ''));
}

/**
 * Price per paid endpoint in USD — derived from config.PRICE_* (the same
 * source the x402 middleware charges from) so analytics and MCP hints can
 * never drift from what a caller is actually billed.
 */
export const ENDPOINT_PRICES: Record<string, number> = {
  '/v1/token-intel': parsePrice(config.PRICE_TOKEN_INTEL),
  '/v1/code-review': parsePrice(config.PRICE_CODE_REVIEW),
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
  '/v1/solana/tx-explain': parsePrice(config.PRICE_SOLANA_TX_EXPLAIN),
  '/v1/solana/tx-simulate': parsePrice(config.PRICE_SOLANA_TX_SIMULATE),
  '/v1/solana/token-risk-scan': parsePrice(config.PRICE_SOLANA_TOKEN_RISK_SCAN),
  '/v1/ping': 0.001,
};

/** MCP tool name → paid x402 endpoint path (free tools have no entry). */
export const TOOL_TO_ENDPOINT: Record<string, string> = {
  token_intel: '/v1/token-intel',
  token_research: '/v1/token-research',
  code_review: '/v1/code-review',
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
  solana_tx_explain: '/v1/solana/tx-explain',
  solana_tx_simulate: '/v1/solana/tx-simulate',
  solana_token_risk_scan: '/v1/solana/token-risk-scan',
};

export const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? 'https://agentforge-taupe.vercel.app';

export function formatUsd(amount: number): string {
  return `$${amount.toFixed(amount < 0.01 ? 3 : 2).replace(/\.?0+$/, '')}`;
}
