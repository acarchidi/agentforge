/**
 * Paid-endpoint health check.
 *
 * Every paid route should return 402 to an unpaid request. Anything else
 * (500, timeout, network error) means the payment layer itself is broken —
 * this is exactly the failure mode hit in production when the CDP
 * facilitator's credentials expired and every paid route 500'd instead of
 * 402'ing. A structural check of route config wouldn't have caught that;
 * only a real request through the actual middleware does.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { SimpleCache } from '../utils/cache.js';

export interface PaidEndpointSpec {
  method: 'GET' | 'POST';
  path: string;
}

export interface PaidEndpointCheckResult {
  method: 'GET' | 'POST';
  path: string;
  healthy: boolean;
  status: number | null;
  latencyMs: number;
  error?: string;
}

/**
 * The x402 SVM client transfers straight into the seller's USDC associated token
 * account and never creates it. If that account is missing, every Solana-paid call
 * fails at settlement while the 402 checks above still look green.
 */
export interface SolanaReceiverCheck {
  owner: string;
  usdcAccount: string;
  exists: boolean | null;
  error?: string;
}

export interface PaidHealthResult {
  status: 'ok' | 'degraded';
  solanaReceiver?: SolanaReceiverCheck;
  checkedAt: string;
  totalEndpoints: number;
  healthyCount: number;
  unhealthyCount: number;
  endpoints: PaidEndpointCheckResult[];
}

export const PAID_ENDPOINTS_FOR_HEALTH: PaidEndpointSpec[] = [
  { method: 'POST', path: '/v1/token-intel' },
  { method: 'POST', path: '/v1/code-review' },
  { method: 'POST', path: '/v1/token-research' },
  { method: 'POST', path: '/v1/contract-docs' },
  { method: 'POST', path: '/v1/contract-monitor' },
  { method: 'POST', path: '/v1/token-compare' },
  { method: 'POST', path: '/v1/tx-decode' },
  { method: 'POST', path: '/v1/approval-scan' },
  { method: 'POST', path: '/v1/sentiment' },
  { method: 'POST', path: '/v1/summarize' },
  { method: 'POST', path: '/v1/translate' },
  { method: 'POST', path: '/v1/wallet-safety' },
  { method: 'POST', path: '/v1/token-risk-metrics' },
  { method: 'GET', path: '/v1/pool-snapshot' },
  { method: 'GET', path: '/v1/gas' },
  { method: 'GET', path: '/v1/ping' },
  { method: 'POST', path: '/v1/solana/tx-explain' },
  { method: 'POST', path: '/v1/solana/tx-simulate' },
  { method: 'POST', path: '/v1/solana/token-risk-scan' },
];

const SOLANA_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SPL_TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ASSOCIATED_TOKEN_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';

/** Derive the USDC associated token account for a Solana owner. Pure — no I/O. */
export function deriveUsdcAta(owner: string): string {
  const [ata] = PublicKey.findProgramAddressSync(
    [new PublicKey(owner).toBuffer(), new PublicKey(SPL_TOKEN_PROGRAM).toBuffer(), new PublicKey(SOLANA_USDC_MINT).toBuffer()],
    new PublicKey(ASSOCIATED_TOKEN_PROGRAM),
  );
  return ata.toBase58();
}

async function checkSolanaReceiver(): Promise<SolanaReceiverCheck | undefined> {
  const owner = process.env.SOLANA_PAY_TO_ADDRESS;
  if (!owner) return undefined;
  let usdcAccount = '';
  try {
    usdcAccount = deriveUsdcAta(owner);
    const conn = new Connection(process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com');
    const info = await Promise.race([
      conn.getAccountInfo(new PublicKey(usdcAccount)),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS)),
    ]);
    return { owner, usdcAccount, exists: info !== null };
  } catch (error) {
    return { owner, usdcAccount, exists: null, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

const CACHE_TTL_SECONDS = 30;
const CHECK_TIMEOUT_MS = 8000;
const CACHE_KEY = 'paid-health';

const cache = new SimpleCache<PaidHealthResult>(CACHE_TTL_SECONDS);

/** Aggregates individual endpoint checks into the final health payload. Pure — no I/O. */
export function aggregatePaidHealth(checks: PaidEndpointCheckResult[]): PaidHealthResult {
  const unhealthy = checks.filter((c) => !c.healthy);
  return {
    status: unhealthy.length === 0 ? 'ok' : 'degraded',
    checkedAt: new Date().toISOString(),
    totalEndpoints: checks.length,
    healthyCount: checks.length - unhealthy.length,
    unhealthyCount: unhealthy.length,
    endpoints: checks,
  };
}

async function checkOneEndpoint(baseUrl: string, spec: PaidEndpointSpec): Promise<PaidEndpointCheckResult> {
  const start = Date.now();
  try {
    const response = await fetch(`${baseUrl}${spec.path}`, {
      method: spec.method,
      headers: spec.method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
      body: spec.method === 'POST' ? '{}' : undefined,
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    return {
      method: spec.method,
      path: spec.path,
      healthy: response.status === 402,
      status: response.status,
      latencyMs: Date.now() - start,
    };
  } catch (error) {
    return {
      method: spec.method,
      path: spec.path,
      healthy: false,
      status: null,
      latencyMs: Date.now() - start,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/** Runs all checks in parallel, cached for CACHE_TTL_SECONDS to bound cost on a warm instance. */
export async function getPaidHealth(baseUrl: string): Promise<PaidHealthResult> {
  const cached = cache.get(CACHE_KEY);
  if (cached) return cached;

  const [checks, solanaReceiver] = await Promise.all([
    Promise.all(PAID_ENDPOINTS_FOR_HEALTH.map((spec) => checkOneEndpoint(baseUrl, spec))),
    checkSolanaReceiver(),
  ]);
  const result = aggregatePaidHealth(checks);
  if (solanaReceiver) {
    result.solanaReceiver = solanaReceiver;
    if (solanaReceiver.exists === false) result.status = 'degraded';
  }
  cache.set(CACHE_KEY, result);
  return result;
}
