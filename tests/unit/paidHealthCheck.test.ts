import { describe, it, expect } from 'vitest';
import { aggregatePaidHealth, PAID_ENDPOINTS_FOR_HEALTH } from '../../src/health/paidHealthCheck.js';
import type { PaidEndpointCheckResult } from '../../src/health/paidHealthCheck.js';

function check(overrides: Partial<PaidEndpointCheckResult> = {}): PaidEndpointCheckResult {
  return {
    method: 'POST',
    path: '/v1/example',
    healthy: true,
    status: 402,
    latencyMs: 100,
    ...overrides,
  };
}

describe('PAID_ENDPOINTS_FOR_HEALTH', () => {
  it('covers all 19 paid endpoints', () => {
    expect(PAID_ENDPOINTS_FOR_HEALTH).toHaveLength(19);
  });

  it('has no duplicate paths', () => {
    const paths = PAID_ENDPOINTS_FOR_HEALTH.map((e) => e.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('includes all 3 Solana paid endpoints', () => {
    const paths = PAID_ENDPOINTS_FOR_HEALTH.map((e) => e.path);
    expect(paths).toContain('/v1/solana/tx-explain');
    expect(paths).toContain('/v1/solana/tx-simulate');
    expect(paths).toContain('/v1/solana/token-risk-scan');
  });

  it('does not include the free program-lookup endpoint', () => {
    const paths = PAID_ENDPOINTS_FOR_HEALTH.map((e) => e.path);
    expect(paths).not.toContain('/v1/solana/program-lookup');
  });
});

describe('aggregatePaidHealth', () => {
  it('reports ok when every endpoint returns 402', () => {
    const result = aggregatePaidHealth([check(), check({ path: '/v1/other' })]);
    expect(result.status).toBe('ok');
    expect(result.healthyCount).toBe(2);
    expect(result.unhealthyCount).toBe(0);
  });

  it('reports degraded when any endpoint is unhealthy', () => {
    const result = aggregatePaidHealth([
      check(),
      check({ path: '/v1/broken', healthy: false, status: 500 }),
    ]);
    expect(result.status).toBe('degraded');
    expect(result.healthyCount).toBe(1);
    expect(result.unhealthyCount).toBe(1);
  });

  it('treats a network error (status null) as unhealthy', () => {
    const result = aggregatePaidHealth([
      check({ healthy: false, status: null, error: 'timeout' }),
    ]);
    expect(result.status).toBe('degraded');
    expect(result.endpoints[0].error).toBe('timeout');
  });

  it('reports total endpoint count matching input', () => {
    const checks = Array.from({ length: 19 }, (_, i) => check({ path: `/v1/e${i}` }));
    const result = aggregatePaidHealth(checks);
    expect(result.totalEndpoints).toBe(19);
  });

  it('includes an ISO checkedAt timestamp', () => {
    const result = aggregatePaidHealth([check()]);
    expect(() => new Date(result.checkedAt).toISOString()).not.toThrow();
  });

  it('reports degraded on the exact production failure mode: every endpoint 500s instead of 402', () => {
    const checks = PAID_ENDPOINTS_FOR_HEALTH.map((spec) =>
      check({ ...spec, healthy: false, status: 500 }),
    );
    const result = aggregatePaidHealth(checks);
    expect(result.status).toBe('degraded');
    expect(result.unhealthyCount).toBe(19);
  });
});
