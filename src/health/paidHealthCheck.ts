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

export interface PaidHealthResult {
  status: 'ok' | 'degraded';
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

  const checks = await Promise.all(
    PAID_ENDPOINTS_FOR_HEALTH.map((spec) => checkOneEndpoint(baseUrl, spec)),
  );
  const result = aggregatePaidHealth(checks);
  cache.set(CACHE_KEY, result);
  return result;
}
