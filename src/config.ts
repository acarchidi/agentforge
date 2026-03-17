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
  PRICE_CODE_REVIEW: z.string().startsWith('$'),
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
  ETHERSCAN_API_KEY: z.string().optional(),
  CDP_API_KEY_ID: z.string().optional(),
  CDP_API_KEY_SECRET: z.string().optional(),
});

export type Config = z.infer<typeof envSchema>;

export const config = envSchema.parse(process.env);

// Map x402 network string to CAIP-2 format
export const networkId: `eip155:${string}` =
  config.X402_NETWORK === 'base' ? 'eip155:8453' : 'eip155:84532';
