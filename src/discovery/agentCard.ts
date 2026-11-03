/**
 * A2A (Agent-to-Agent) Agent Card Generator
 *
 * Generates an agent card following Google's Agent-to-Agent protocol.
 * Served at /.well-known/agent.json for agent discovery.
 *
 * @see https://google.github.io/A2A/
 */

import { config, networkId } from '../config.js';
import { PRICING_RULES } from '../pricing.js';

interface Skill {
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples: string[];
  price: string;
  endpoint: string;
  method: string;
}

const SKILLS: Skill[] = [
  {
    id: 'trade-check',
    name: 'Pre-Trade Token Check',
    description: 'Check a token before you buy it: quantitative rug check, AI risk assessment with market data, and current gas in one call with a proceed/caution/avoid verdict. Cheaper than the three calls separately.',
    tags: ['crypto', 'token', 'risk', 'rug-check', 'pre-trade', 'bundle', 'defi'],
    examples: [
      'Should I buy this token right now?',
      'Run a full pre-trade check on 0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9',
      'Is this token safe to trade, and what will gas cost me?',
    ],
    price: config.PRICE_TRADE_CHECK,
    endpoint: '/v1/trade-check',
    method: 'POST',
  },
  {
    id: 'launches',
    name: 'New Launch Feed',
    description: 'Newly launched tokens on Base, Ethereum, and Arbitrum, each already risk-scored: verification, owner mint/blacklist/tax powers, upgradeable proxy, supply held off-pool, thin liquidity, honeypot trading pattern. Poll it with nextSince to get only new launches.',
    tags: ['crypto', 'new-tokens', 'launches', 'sniper', 'rug-check', 'memecoin', 'feed'],
    examples: [
      'What tokens launched on Base in the last 10 minutes?',
      'Show new launches with at least $5k liquidity and a low risk score',
      'Give me only launches newer than my last poll',
    ],
    price: config.PRICE_LAUNCHES,
    endpoint: '/v1/launches',
    method: 'GET',
  },
  {
    id: 'address-check',
    name: 'Address Reputation Check',
    description: 'Screen counterparties before sending, approving, or interacting: OFAC sanctions, known scam/phishing wallets, labeled protocol contracts, and brand-new-address detection. 1-100 EVM or Solana addresses per call.',
    tags: ['security', 'sanctions', 'ofac', 'aml', 'counterparty', 'scam', 'address-poisoning'],
    examples: [
      'Is it safe to send USDC to this address?',
      'Screen these 20 recipient addresses against sanctions lists',
      'Is this address a known scammer or a fresh address-poisoning wallet?',
    ],
    price: PRICING_RULES['/v1/address-check'],
    endpoint: '/v1/address-check',
    method: 'POST',
  },
  {
    id: 'risk-batch',
    name: 'Batch Token Risk Scoring',
    description: 'Rug-check a whole watchlist in one call: holder concentration, mint/blacklist/pause/upgrade permissions, and liquidity depth risk scores for 2-25 EVM tokens. Priced per token, well below single calls.',
    tags: ['crypto', 'token', 'risk', 'rug-check', 'batch', 'watchlist', 'trading-bot'],
    examples: [
      'Score these 20 tokens for rug risk',
      'Which tokens in my watchlist can still be minted by their owner?',
      'Screen this list of candidate trades and rank them by risk',
    ],
    price: PRICING_RULES['/v1/risk-batch'],
    endpoint: '/v1/risk-batch',
    method: 'POST',
  },
  {
    id: 'tx-simulate',
    name: 'EVM Transaction Simulation',
    description: 'Simulate an EVM transaction (or approve-then-swap sequence) before signing: revert reason, every asset leaving or entering the wallet, approvals granted, counterparty sanctions/scam screening, and a proceed/caution/avoid verdict. Ethereum, Base, Arbitrum, Optimism, Polygon.',
    tags: ['security', 'simulation', 'pre-sign', 'transaction-firewall', 'approvals', 'evm'],
    examples: [
      'What will this transaction do to my wallet if I sign it?',
      'Simulate this approve and swap before I send them',
      'Is this transaction draining my tokens?',
    ],
    price: config.PRICE_TX_SIMULATE,
    endpoint: '/v1/tx-simulate',
    method: 'POST',
  },
  {
    id: 'lending-health',
    name: 'Lending Position Health',
    description: 'How close a wallet is to liquidation on Aave v3 across five chains in one call: collateral, debt, health factor, status, and how far collateral can fall before liquidation.',
    tags: ['defi', 'aave', 'lending', 'liquidation', 'health-factor', 'risk'],
    examples: [
      'How close is this wallet to liquidation on Aave?',
      'Check my health factor on every chain',
      'How much can ETH fall before my position is liquidated?',
    ],
    price: config.PRICE_LENDING_HEALTH,
    endpoint: '/v1/lending/health',
    method: 'GET',
  },
  {
    id: 'token-intel',
    name: 'Token Intelligence',
    description: 'Token metadata enrichment with market data and AI risk assessment for any EVM or Solana token.',
    tags: ['crypto', 'token', 'risk', 'market-data', 'defi'],
    examples: [
      'Get risk assessment for USDC on Ethereum',
      'What is the market cap of WETH?',
      'Check if this token contract is safe: 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    ],
    price: config.PRICE_TOKEN_INTEL,
    endpoint: '/v1/token-intel',
    method: 'POST',
  },
  {
    id: 'token-research',
    name: 'Multi-Source Token Research',
    description: 'Aggregates CoinGecko, DeFiLlama, Etherscan, Polymarket data with AI risk assessment.',
    tags: ['crypto', 'research', 'token', 'defi', 'risk', 'multi-source'],
    examples: [
      'Deep research on Ethereum including price history and holder distribution',
      'What are the DeFi metrics for AAVE?',
      'Research LINK token with prediction market data',
    ],
    price: config.PRICE_TOKEN_RESEARCH,
    endpoint: '/v1/token-research',
    method: 'POST',
  },
  {
    id: 'contract-docs',
    name: 'Contract Documentation',
    description: 'Human-readable smart contract documentation with function descriptions, risk flags, and security posture.',
    tags: ['smart-contract', 'documentation', 'security', 'audit', 'abi'],
    examples: [
      'Generate documentation for the USDC contract',
      'What functions does this contract expose?',
      'Document the admin capabilities of this proxy contract',
    ],
    price: config.PRICE_CONTRACT_DOCS,
    endpoint: '/v1/contract-docs',
    method: 'POST',
  },
  {
    id: 'contract-monitor',
    name: 'Contract Activity Monitor',
    description: 'Monitors recent admin activity: ownership transfers, upgrades, pause state changes.',
    tags: ['smart-contract', 'monitoring', 'security', 'admin-ops', 'risk'],
    examples: [
      'Has this contract had any admin activity in the last 24 hours?',
      'Check for suspicious ownership transfers on this contract',
      'Monitor this DeFi protocol contract for upgrades',
    ],
    price: config.PRICE_CONTRACT_MONITOR,
    endpoint: '/v1/contract-monitor',
    method: 'POST',
  },
  {
    id: 'token-compare',
    name: 'Token Comparison',
    description: 'Compare a primary token against up to 3 competitors with AI comparative analysis.',
    tags: ['crypto', 'comparison', 'research', 'competitive-intelligence'],
    examples: [
      'Compare ETH vs SOL vs AVAX',
      'How does AAVE compare to COMP and MKR?',
      'Compare stablecoins: USDC vs USDT vs DAI',
    ],
    price: config.PRICE_TOKEN_COMPARE,
    endpoint: '/v1/token-compare',
    method: 'POST',
  },
  {
    id: 'tx-decode',
    name: 'Transaction Decoder',
    description: 'Decode any EVM transaction: function call, parameters, token transfers, and plain-English explanation.',
    tags: ['crypto', 'transaction', 'decoding', 'evm'],
    examples: [
      'What did this transaction do?',
      'Decode the function call in this tx hash',
      'Explain this failed transaction',
    ],
    price: config.PRICE_TX_DECODE,
    endpoint: '/v1/tx-decode',
    method: 'POST',
  },
  {
    id: 'approval-scan',
    name: 'Approval Scanner',
    description: 'Scan a wallet for risky token approvals. On EVM chains: identifies unlimited ERC-20 approvals and unverified spenders. On Solana: scans SPL token delegate authorities. Returns risk assessment.',
    tags: ['crypto', 'security', 'wallet', 'approvals', 'risk', 'solana'],
    examples: [
      'Scan my wallet for risky approvals',
      'Are there any unlimited token approvals on this address?',
      'Check approval hygiene for this DeFi wallet',
      'Scan my Solana wallet for risky SPL token delegates',
    ],
    price: config.PRICE_APPROVAL_SCAN,
    endpoint: '/v1/approval-scan',
    method: 'POST',
  },
  {
    id: 'wallet-safety',
    name: 'Wallet Safety Check',
    description: 'Comprehensive wallet safety check: scans approvals, analyzes recent transaction activity for suspicious patterns, and assesses target contract risk. Returns composite risk score (0-100). Supports EVM chains and Solana.',
    tags: ['crypto', 'security', 'wallet', 'defi', 'risk', 'approvals', 'patterns', 'solana'],
    examples: [
      'Is this wallet safe to interact with this DeFi contract?',
      'Run a full safety check on my wallet',
      'Check for suspicious activity patterns on this address',
      'Safety check my Solana wallet before using this program',
    ],
    price: config.PRICE_WALLET_SAFETY,
    endpoint: '/v1/wallet-safety',
    method: 'POST',
  },
  {
    id: 'sentiment',
    name: 'Sentiment Analysis',
    description: 'AI sentiment analysis for crypto, finance, and social media text. Returns score, confidence, label, reasoning.',
    tags: ['nlp', 'sentiment', 'crypto', 'finance', 'social-media'],
    examples: [
      'What is the sentiment of this crypto tweet?',
      'Analyze market sentiment from this news article',
      'Is this Reddit post bullish or bearish on ETH?',
    ],
    price: config.PRICE_SENTIMENT,
    endpoint: '/v1/sentiment',
    method: 'POST',
  },
  {
    id: 'summarize',
    name: 'Text Summarization',
    description: 'AI text summarization with configurable length, format, and optional topic focus.',
    tags: ['nlp', 'summarization', 'text-processing'],
    examples: [
      'Summarize this whitepaper in bullet points',
      'Give me a brief summary of this research paper',
      'Summarize this article focusing on key findings',
    ],
    price: config.PRICE_SUMMARIZE,
    endpoint: '/v1/summarize',
    method: 'POST',
  },
  {
    id: 'translate',
    name: 'Translation',
    description: 'AI translation with tone control and auto source language detection. Preserves formatting.',
    tags: ['nlp', 'translation', 'localization'],
    examples: [
      'Translate this documentation to Spanish',
      'Convert this technical text to Japanese with formal tone',
      'Translate this message to French casually',
    ],
    price: config.PRICE_TRANSLATE,
    endpoint: '/v1/translate',
    method: 'POST',
  },
  {
    id: 'gas-oracle',
    name: 'Gas Price Oracle',
    description: 'Current gas prices (slow/standard/fast) for any EVM chain with trend analysis.',
    tags: ['crypto', 'gas', 'pricing', 'evm'],
    examples: [
      'What are current Ethereum gas prices?',
      'Is gas cheap right now on Base?',
      'Show gas price trend for Polygon',
    ],
    price: config.PRICE_GAS,
    endpoint: '/v1/gas',
    method: 'GET',
  },
  {
    id: 'pool-snapshot',
    name: 'DeFi Pool Snapshot',
    description: 'Cached snapshot of top 500 DeFi liquidity pools. Filter by protocol, chain, or token. Returns TVL, APY, volume, IL risk, and registry enrichment.',
    tags: ['defi', 'liquidity', 'pools', 'tvl', 'apy', 'yield'],
    examples: [
      'Show top Uniswap V3 pools on Ethereum by TVL',
      'Find pools containing ETH on Base',
      'Get top stablecoin pools by APY on Arbitrum',
      'What is the current TVL and APY for the USDC-ETH pool?',
    ],
    price: config.PRICE_POOL_SNAPSHOT,
    endpoint: '/v1/pool-snapshot',
    method: 'GET',
  },
  {
    id: 'token-risk-metrics',
    name: 'Token Risk Metrics',
    description: 'Quantitative risk metrics for any ERC-20 token: holder concentration, contract permissions (mint/burn/pause/blacklist), liquidity depth, deployer history, and composite risk score (0-100).',
    tags: ['crypto', 'token', 'risk', 'security', 'defi', 'holder-analysis', 'permissions'],
    examples: [
      'Get risk metrics for this token before buying',
      'Can the owner of this token mint new tokens?',
      'What percentage of supply do the top 10 holders control?',
      'Is this token liquidity thin relative to its market cap?',
    ],
    price: config.PRICE_TOKEN_RISK_METRICS,
    endpoint: '/v1/token-risk-metrics',
    method: 'POST',
  },
  {
    id: 'ping',
    name: 'Payment Verification',
    description: 'Liveness check with x402 payment verification. Test that wallet and payment flow work correctly; the response includes the full service catalog with prices and example inputs.',
    tags: ['system', 'health', 'testing'],
    examples: [
      'Verify my payment setup works',
      'Test the x402 payment flow',
      'Ping AgentForge to check connectivity',
    ],
    price: '$0.001',
    endpoint: '/v1/ping',
    method: 'GET',
  },
  {
    id: 'solana-tx-explain',
    name: 'Solana Transaction Explain',
    description: 'Decode a Solana transaction into plain English: labeled programs, token/SOL movements, and risk flags.',
    tags: ['solana', 'transaction', 'decode transaction', 'explain'],
    examples: [
      'What did this Solana transaction do?',
      'Explain this Solana transaction signature',
      'Decode this Solana transfer',
    ],
    price: config.PRICE_SOLANA_TX_EXPLAIN,
    endpoint: '/v1/solana/tx-explain',
    method: 'POST',
  },
  {
    id: 'solana-tx-simulate',
    name: 'Solana Transaction Simulate',
    description: 'Simulate a Solana transaction before signing it: balance changes, labeled programs, and a proceed/caution/avoid recommendation.',
    tags: ['solana', 'simulate transaction', 'defi-safety', 'pre-flight'],
    examples: [
      'Simulate this Solana transaction before I sign it',
      'Is this Solana transaction safe to sign?',
      'What would this transaction do if I approved it?',
    ],
    price: config.PRICE_SOLANA_TX_SIMULATE,
    endpoint: '/v1/solana/tx-simulate',
    method: 'POST',
  },
  {
    id: 'solana-token-risk-scan',
    name: 'Solana Token Risk Scan',
    description: 'Solana rug check: mint authority, freeze authority, holder concentration, liquidity depth, and a composite 0-100 risk score.',
    tags: ['solana', 'token risk', 'rug check', 'mint authority', 'freeze authority'],
    examples: [
      'Is this Solana token a rug pull risk?',
      'Can the deployer mint more of this token?',
      'Check holder concentration for this Solana mint',
    ],
    price: config.PRICE_SOLANA_TOKEN_RISK_SCAN,
    endpoint: '/v1/solana/token-risk-scan',
    method: 'POST',
  },
];

export function generateAgentCard(baseUrl: string): Record<string, unknown> {
  const isMainnet = config.X402_NETWORK === 'base';
  const networkName = isMainnet ? 'Base (mainnet)' : 'Base Sepolia (testnet)';

  return {
    name: 'AgentForge',
    description:
      'Check a token before you buy it, catch new launches the minute they list (already risk-scored), screen every counterparty against sanctions and scam lists before you send, simulate a transaction before you sign it, check how close a loan is to liquidation, rug-check a whole watchlist in one call, document a contract before calling it, decode a transaction. Pay-per-call tools for autonomous agents trading or operating on EVM chains and Solana, plus NLP utilities (sentiment, summarize, translate). x402 protocol, USDC on Base or Solana — no API keys, no accounts, no subscriptions; batch endpoints are priced per item, and every response suggests the logical next call with a ready-to-send input.',
    url: baseUrl,
    version: '1.8.0',

    provider: {
      organization: 'AgentForge',
      url: baseUrl,
    },

    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: false,
    },

    defaultInputModes: ['application/json'],
    defaultOutputModes: ['application/json'],

    authentication: {
      schemes: [
        {
          scheme: 'x402',
          description:
            'HTTP 402 Payment Required. Send request without payment to get pricing. Include signed USDC payment in X-PAYMENT header.',
          asset: 'USDC',
          network: networkName,
          networkId,
          facilitator: config.X402_FACILITATOR_URL,
          docs: 'https://docs.x402.org',
        },
      ],
    },

    protocols: {
      mcp: {
        url: `${baseUrl}/mcp`,
        transport: 'streamable-http',
        description: 'MCP server exposing all AgentForge tools. No payment required for MCP tool calls.',
      },
      openapi: {
        url: `${baseUrl}/openapi.json`,
        version: '3.1.0',
        description: 'Full OpenAPI 3.1 specification with schemas for all endpoints.',
      },
      x402: {
        url: `${baseUrl}/.well-known/x402`,
        description: 'x402 payment resource discovery endpoint.',
      },
      'ai-plugin': {
        url: `${baseUrl}/.well-known/ai-plugin.json`,
        description: 'AI plugin manifest for ChatGPT-style integrations.',
      },
    },

    skills: SKILLS.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      tags: skill.tags,
      examples: skill.examples,
      price: skill.price,
      inputModes: ['application/json'],
      outputModes: ['application/json'],
    })),
  };
}
