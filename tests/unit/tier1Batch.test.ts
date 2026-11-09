import { describe, it, expect, vi, beforeEach } from 'vitest';
import { priceFor, ENDPOINT_PRICES } from '../../src/pricing.js';
import { computeCompositeScore } from '../../src/services/tokenRiskMetrics/composite.js';
import { capLiquidityRiskByDepth } from '../../src/services/tokenRiskMetrics/liquidity.js';

vi.mock('../../src/utils/evmRpc.js', () => ({
  rpcBatch: vi.fn(),
}));
vi.mock('../../src/services/tokenRiskMetrics/index.js', () => ({
  getTokenRiskMetricsWithCost: vi.fn(),
}));
vi.mock('../../src/services/dataSources/dexscreener.js', () => ({
  fetchDexScreenerEvmTokens: vi.fn(async () => new Map()),
}));

const { rpcBatch } = await import('../../src/utils/evmRpc.js');
const risk = await import('../../src/services/tokenRiskMetrics/index.js');
const { addressCheckWithCost, decideVerdict } = await import('../../src/services/addressCheck.js');
const { riskBatchWithCost } = await import('../../src/services/riskBatch.js');

// A currently sanctioned address from the committed OFAC snapshot.
const OFAC = '0x0330070fd38ec3bb94f58fa55d40368271e9e54a';
const MEW_SCAM = '0x09750ad360fdb7a2ee23669c4503c974d86d8694';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const FRESH = `0x${'ab'.repeat(20)}`;

describe('priceFor (per-item endpoints)', () => {
  it('prices risk-batch per token and clamps to the allowed range', () => {
    expect(priceFor('/v1/risk-batch', { tokens: new Array(10).fill({}) })).toBe(0.04);
    expect(priceFor('/v1/risk-batch', {})).toBe(0.008); // healthcheck / no body → minimum
    expect(priceFor('/v1/risk-batch', { tokens: new Array(999).fill({}) })).toBe(0.1); // validation rejects it anyway
  });

  it('prices address-check as base + per extra address, including the single-address shorthand', () => {
    expect(priceFor('/v1/address-check', { address: USDC })).toBe(0.003);
    expect(priceFor('/v1/address-check', { addresses: new Array(10).fill({}) })).toBe(0.012);
    expect(priceFor('/v1/address-check', undefined)).toBe(0.003);
  });

  it('falls back to the fixed price elsewhere', () => {
    expect(priceFor('/v1/launches')).toBe(ENDPOINT_PRICES['/v1/launches']);
  });
});

describe('address-check', () => {
  beforeEach(() => {
    // code + nonce per EVM address, in request order
    vi.mocked(rpcBatch).mockImplementation(async (_chain, calls) =>
      calls.map((c) => {
        const addr = String((c.params as unknown[])[0]).toLowerCase();
        if (c.method === 'eth_getCode') return addr === USDC.toLowerCase() ? '0x6080' : '0x';
        return addr === FRESH ? '0x0' : '0x2a';
      }),
    );
  });

  it('blocks sanctioned and scam addresses, cautions on fresh and invalid ones', async () => {
    const { output } = await addressCheckWithCost({
      chain: 'ethereum',
      addresses: [{ address: OFAC }, { address: MEW_SCAM }, { address: USDC }, { address: FRESH, chain: 'base' }, { address: 'definitely-not-an-address-xxxxxxxxxx' }],
    });
    const v = output.results.map((r) => r.verdict);
    expect(v).toEqual(['block', 'block', 'no_known_issues', 'caution', 'caution']);
    expect(output.results[0].sanctioned).toBe(true);
    expect(output.results[1].flaggedScam).toBe(true);
    expect(output.results[2].knownEntity?.name).toBe('USDC');
    expect(output.results[3].txCount).toBe(0);
    expect(output.summary).toEqual({ checked: 5, block: 2, caution: 2, noKnownIssues: 1 });
    expect(output.pricing.total).toBe('$0.007');
  });

  it('accepts the single-address shorthand and rejects ambiguous input', async () => {
    const { output } = await addressCheckWithCost({ address: USDC });
    expect(output.results).toHaveLength(1);
    await expect(addressCheckWithCost({ address: USDC, addresses: [{ address: USDC }] })).rejects.toThrow();
  });

  it('labels a burn address as a burn address, not a fresh scam wallet', async () => {
    vi.mocked(rpcBatch).mockImplementation(async (_chain, calls) => calls.map((c) => (c.method === 'eth_getCode' ? '0x' : '0x0')));
    const { output } = await addressCheckWithCost({ address: '0x000000000000000000000000000000000000dEaD', chain: 'base' });
    const r = output.results[0];
    expect(r.verdict).toBe('caution');
    expect(r.reasons.some((x) => /burn address/i.test(x))).toBe(true);
    expect(r.reasons.some((x) => /scam/i.test(x))).toBe(false);
  });

  it('degrades to list-only results when the RPC fails', async () => {
    vi.mocked(rpcBatch).mockRejectedValue(new Error('down'));
    const { output } = await addressCheckWithCost({ address: OFAC });
    expect(output.results[0].verdict).toBe('block');
    expect(output.results[0].isContract).toBeNull();
  });

  it('decideVerdict: high-risk registry entries are caution, not block', () => {
    expect(decideVerdict({ address: '0x', chain: 'ethereum', reasons: [], sanctioned: false, flaggedScam: false, valid: true, knownEntity: { name: 'X', riskLevel: 'high' } })).toBe('caution');
  });
});

describe('risk-batch', () => {
  const metrics = (score: number, level: string) => ({
    output: {
      overallRisk: { score, level, flags: [] },
      permissions: { canMint: false, canBlacklist: false, canPause: false, canUpgrade: false },
      liquidity: { totalLiquidityUsd: 1000 },
      holders: { top10Addresses: [], dataAvailable: false },
      source: 'live',
    },
    estimatedCostUsd: 0,
  });

  it('dedupes, scores, isolates per-token failures, and ranks the riskiest', async () => {
    vi.mocked(risk.getTokenRiskMetricsWithCost).mockImplementation(async (input: any) => {
      if (input.address.endsWith('3')) throw new Error('upstream exploded');
      return (input.address.endsWith('2') ? metrics(80, 'critical') : metrics(10, 'low')) as any;
    });
    const a = (n: number) => `0x${String(n).padStart(40, '0')}`;
    const { output } = await riskBatchWithCost({ tokens: [{ address: a(1) }, { address: a(2) }, { address: a(3) }, { address: a(1) }] });
    expect(output.results).toHaveLength(3); // duplicate scored once
    expect(output.results.map((r) => r.status)).toEqual(['ok', 'ok', 'error']);
    expect(output.summary.riskiest[0]).toMatchObject({ address: a(2), riskScore: 80 });
    expect(output.summary.byLevel).toEqual({ low: 1, medium: 0, high: 0, critical: 1 });
    expect(output.pricing).toEqual({ perToken: '$0.004', tokensCharged: 4, total: '$0.016' });
  });

  it('rejects lists outside 2-25 tokens', async () => {
    await expect(riskBatchWithCost({ tokens: [{ address: `0x${'1'.repeat(40)}` }] })).rejects.toThrow();
  });
});

describe('token-risk-metrics data-gap fixes', () => {
  it('excludes missing holder data from the composite instead of scoring it as low', () => {
    const base = { liquidityRisk: 'medium' as const, permissionRisk: 'none' as const, deployerRisk: 'low' as const };
    const missing = computeCompositeScore({ ...base });
    const lowConc = computeCompositeScore({ ...base, concentrationRisk: 'low' });
    expect(missing.score).toBe(Math.round((50 * 0.25) / 0.7)); // 18, renormalized
    expect(lowConc.score).toBe(13);
    expect(missing.flags[0]).toMatch(/Holder concentration unavailable/);
  });

  it('caps liquidity risk by absolute depth for large caps', () => {
    expect(capLiquidityRiskByDepth('critical', 5_000_000)).toBe('low');
    expect(capLiquidityRiskByDepth('critical', 300_000)).toBe('medium');
    expect(capLiquidityRiskByDepth('critical', 50_000)).toBe('critical');
    expect(capLiquidityRiskByDepth('low', 5_000_000)).toBe('low');
    expect(capLiquidityRiskByDepth('high', undefined)).toBe('high');
  });
});
