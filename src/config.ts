import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config({ override: true });

const envSchema = z.object({
  PAY_TO_ADDRESS: z.string().startsWith('0x'),
  X402_NETWORK: z.enum(['base-sepolia', 'base']).default('base-sepolia'),
  X402_FACILITATOR_URL: z.string().url(),
  ANTHROPIC_API_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().optional(),
  PORT: z.coerce.number().default(3402),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  ADMIN_TOKEN: z.string().min(16),
  PRICE_TOKEN_INTEL: z.string().startsWith('$'),
  PRICE_TOKEN_RESEARCH: z.string().startsWith('$'),
  PRICE_CONTRACT_DOCS: z.string().startsWith('$'),
  PRICE_CONTRACT_MONITOR: z.string().startsWith('$'),
  PRICE_TOKEN_COMPARE: z.string().startsWith('$'),
  PRICE_TX_DECODE: z.string().startsWith('$'),
  PRICE_APPROVAL_SCAN: z.string().startsWith('$'),
  PRICE_GAS: z.string().startsWith('$'),
  PRICE_SENTIMENT: z.string().startsWith('$'),
  PRICE_SUMMARIZE: z.string().startsWith('$'),
  PRICE_TRANSLATE: z.string().startsWith('$'),
  PRICE_WALLET_SAFETY: z.string().startsWith('$'),
  PRICE_POOL_SNAPSHOT: z.string().startsWith('$'),
  PRICE_TOKEN_RISK_METRICS: z.string().startsWith('$'),
  // Bundle of token-risk-metrics + token-intel + gas. Keep below the sum of the
  // three (production: $0.05 + $0.015 + $0.003) but above token-intel's worst-case LLM cost
  // (~$0.014 at Sonnet 5 list prices) plus the $0.001 CDP facilitator fee.
  PRICE_TRADE_CHECK: z.string().startsWith('$').default('$0.025'),
  // Per-item batch prices (x402 dynamic pricing: the 402 quotes count × rate).
  // No LLM in either path; the floor keeps a 1-call batch above the $0.001
  // facilitator fee.
  PRICE_RISK_BATCH_PER_TOKEN: z.string().startsWith('$').default('$0.004'),
  PRICE_ADDRESS_CHECK: z.string().startsWith('$').default('$0.003'),
  PRICE_ADDRESS_CHECK_PER_EXTRA: z.string().startsWith('$').default('$0.001'),
  // New-launch feed: one DB read per call; ingestion runs on demand.
  PRICE_LAUNCHES: z.string().startsWith('$').default('$0.005'),
  // EVM pre-sign simulation: 3 public RPC requests, no LLM. Cost ≈ facilitator fee.
  PRICE_TX_SIMULATE: z.string().startsWith('$').default('$0.005'),
  // Aave v3 health: one eth_call per chain, no LLM.
  PRICE_LENDING_HEALTH: z.string().startsWith('$').default('$0.003'),
  ETHERSCAN_API_KEY: z.string().optional(),
  CDP_API_KEY_ID: z.string().optional(),
  CDP_API_KEY_SECRET: z.string().optional(),
  HELIUS_API_KEY: z.string().min(1),
  SOLANA_RPC_URL: z.string().url(),
  SOLANA_PAY_TO_ADDRESS: z.string().min(32).max(44),
  PRICE_SOLANA_TX_EXPLAIN: z.string().startsWith('$').default('$0.05'),
  PRICE_SOLANA_TX_SIMULATE: z.string().startsWith('$').default('$0.15'),
  PRICE_SOLANA_TOKEN_RISK_SCAN: z.string().startsWith('$').default('$0.35'),
  // Durable analytics (Neon/Vercel Postgres). Falls back to SQLite when unset.
  DATABASE_URL: z.string().url().optional(),
  POSTGRES_URL: z.string().url().optional(),
  ANALYTICS_HASH_SALT: z.string().optional(),
  MCP_DAILY_CAP: z.coerce.number().int().positive().optional(),
  // Discoverability
  PUBLIC_BASE_URL: z.string().url().default('https://agentforge-taupe.vercel.app'),
  BASE_BUILDER_CODE: z.string().regex(/^[a-z0-9_]{1,32}$/).optional(),
  X402_ENABLE_PERMIT2: z.enum(['true', 'false']).default('true'),
  // Last-known facilitator /supported response (JSON), used only when the live
  // fetch fails on a cold start. Copy it from GET /admin/facilitator-supported.
  X402_SUPPORTED_SNAPSHOT: z.string().optional(),
  // World AgentKit free trial (human-backed agents) — tx-explain only
  AGENTKIT_ENABLED: z.enum(['true', 'false']).default('true'),
  AGENTKIT_FREE_TRIAL_USES: z.coerce.number().int().positive().default(25),
  WORLDCHAIN_RPC_URL: z.string().url().optional(),
});

export type Config = z.infer<typeof envSchema>;

export const config = envSchema.parse(process.env);

// Map x402 network string to CAIP-2 format
export const networkId: `eip155:${string}` =
  config.X402_NETWORK === 'base' ? 'eip155:8453' : 'eip155:84532';
