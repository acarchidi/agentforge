/**
 * Cross-sell catalog shared by the entry-point endpoints.
 *
 * Nearly every outside payer's first call is /v1/ping or /v1/gas (they are the
 * cheapest probes), and until now both were dead ends: the response proved the
 * payment worked and said nothing about what else is for sale. This module is
 * the one place that knows what to pitch next, with prices derived from
 * ENDPOINT_PRICES so the pitch can never drift from what is actually charged.
 */

import { ENDPOINT_PRICES, PRICING_RULES, PUBLIC_BASE_URL, formatUsd } from '../pricing.js';
import type { RelatedService } from '../schemas/shared.js';

interface FeaturedService {
  endpoint: string;
  method: 'GET' | 'POST';
  /** Used for the recurring, high-volume services — the ones worth wiring into a loop. */
  cadence?: string;
  /** The job it does, phrased the way a calling agent would state the task. */
  job: string;
  suggestedInput?: Record<string, unknown>;
}

/** The services most likely to be the real task behind a first-time probe. */
const FEATURED: FeaturedService[] = [
  {
    endpoint: '/v1/trade-check',
    method: 'POST',
    job: 'Check a token before you buy it: rug-check metrics, AI risk assessment, and current gas in one call (cheaper than calling the three separately)',
    suggestedInput: { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', chain: 'ethereum' },
  },
  {
    endpoint: '/v1/launches',
    method: 'GET',
    job: 'Feed of newly launched tokens (Base, Ethereum, Arbitrum), each already risk-scored: owner powers, proxy, supply held off-pool, honeypot trading pattern',
    cadence: 'Poll every 1-5 minutes; pass nextSince back as since to get only new launches',
    suggestedInput: { chain: 'base', minLiquidityUsd: 1000, maxRiskScore: 50 },
  },
  {
    endpoint: '/v1/address-check',
    method: 'POST',
    job: 'Screen counterparties before every transfer or approval: OFAC sanctions, scam/phishing wallets, labeled protocols, brand-new addresses (1-100 per call)',
    cadence: 'Call before each outgoing transaction',
    suggestedInput: { chain: 'ethereum', addresses: [{ address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' }] },
  },
  {
    endpoint: '/v1/risk-batch',
    method: 'POST',
    job: 'Rug-check a whole watchlist in one call: 2-25 tokens scored for holder, permission, and liquidity risk',
    cadence: 'Re-screen your watchlist on every rebalance',
    suggestedInput: { chain: 'ethereum', tokens: [{ address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9' }, { address: '0x514910771AF9Ca656af840dff83E8264EcF986CA' }] },
  },
  {
    endpoint: '/v1/wallet-safety',
    method: 'POST',
    job: 'Safety-check a wallet before a DeFi action: approvals, suspicious activity patterns, target contract risk',
    suggestedInput: { walletAddress: '0x0000000000000000000000000000000000000001', chain: 'ethereum' },
  },
  {
    endpoint: '/v1/tx-decode',
    method: 'POST',
    job: 'Explain what an EVM transaction actually did, in plain English',
    suggestedInput: { txHash: '0x' + '0'.repeat(64), chain: 'ethereum' },
  },
  {
    endpoint: '/v1/code-review',
    method: 'POST',
    job: 'Audit a smart contract for vulnerabilities and gas optimizations (Solidity, Rust, Move, TypeScript)',
    suggestedInput: { code: 'contract Example { ... }', language: 'solidity' },
  },
];

/**
 * Catalog block for the /v1/ping response: every first-time payer lands there,
 * so the pong carries the menu. Static strings only — no LLM, no I/O.
 */
export function pingCatalog(): Record<string, unknown> {
  return {
    hint: 'Payment verified — your x402 setup works against every endpoint below. Prices are per call, USDC on Base or Solana, no signup.',
    featured: FEATURED.map((s) => ({
      endpoint: `${s.method} ${PUBLIC_BASE_URL}${s.endpoint}`,
      price: priceOf(s.endpoint),
      job: s.job,
      ...(s.cadence ? { cadence: s.cadence } : {}),
      ...(s.suggestedInput ? { suggestedInput: s.suggestedInput } : {}),
    })),
    fullCatalog: `${PUBLIC_BASE_URL}/catalog`,
    openapi: `${PUBLIC_BASE_URL}/openapi.json`,
    agentCard: `${PUBLIC_BASE_URL}/.well-known/agent.json`,
    mcp: `${PUBLIC_BASE_URL}/mcp`,
  };
}

/** relatedServices for the gas oracle response, pointed at the same chain. */
export function gasRelatedServices(chain: string): RelatedService[] {
  const evm = ['ethereum', 'base', 'polygon', 'arbitrum'].includes(chain);
  return [
    ...(evm
      ? [{
          endpoint: '/v1/trade-check',
          description: `Pre-trade token check on ${chain} (${priceOf('/v1/trade-check')}): rug-check metrics + AI risk + this gas data in one call`,
          suggestedInput: { address: '0x…token', chain },
        }]
      : []),
    {
      endpoint: '/v1/tx-decode',
      description: `Decode any ${chain} transaction into plain English (${priceOf('/v1/tx-decode')})`,
      suggestedInput: { txHash: '0x…', chain },
    },
    {
      endpoint: '/v1/approval-scan',
      description: `Scan a wallet for risky token approvals before it signs anything (${priceOf('/v1/approval-scan')})`,
      suggestedInput: { address: '0x…wallet', chain },
    },
    {
      endpoint: '/v1/address-check',
      description: `Screen the recipient against sanctions and scam lists before you send (${priceOf('/v1/address-check')})`,
      suggestedInput: { addresses: [{ address: '0x…recipient', chain }] },
    },
  ];
}

function priceOf(endpoint: string): string {
  const p = ENDPOINT_PRICES[endpoint];
  return PRICING_RULES[endpoint] ?? (p === undefined ? 'free' : formatUsd(p));
}
