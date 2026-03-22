/**
 * A2A (Agent-to-Agent) Agent Card Generator
 *
 * Generates an agent card following Google's Agent-to-Agent protocol.
 * Served at /.well-known/agent.json for agent discovery.
 *
 * @see https://google.github.io/A2A/
 */

import { config, networkId } from '../config.js';

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
    id: 'code-review',
    name: 'Smart Contract Code Review',
    description: 'Security analysis with gas optimization and diff review mode. Supports Solidity, Rust, Move, TypeScript.',
    tags: ['security', 'audit', 'smart-contract', 'solidity', 'gas-optimization'],
    examples: [
      'Audit this Solidity contract for reentrancy vulnerabilities',
      'Review gas optimization opportunities in this contract',
      'Compare this contract upgrade with the previous version',
    ],
    price: config.PRICE_CODE_REVIEW,
    endpoint: '/v1/code-review',
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
    description: 'Liveness check with x402 payment verification. Test that wallet and payment flow work correctly.',
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
];

export function generateAgentCard(baseUrl: string): Record<string, unknown> {
  const isMainnet = config.X402_NETWORK === 'base';
  const networkName = isMainnet ? 'Base (mainnet)' : 'Base Sepolia (testnet)';

  return {
    name: 'AgentForge',
    description:
      'Production-grade AI services for autonomous agents. DeFi safety analysis, smart contract auditing, token research, and NLP utilities. Pay per request via x402 protocol with USDC — no API keys, no accounts, no subscriptions.',
    url: baseUrl,
    version: '1.4.0',

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
