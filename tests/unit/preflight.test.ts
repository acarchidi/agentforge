import { describe, it, expect, vi, beforeEach } from 'vitest';

const OFAC = '0x0330070fd38ec3bb94f58fa55d40368271e9e54a';
const SIGNER = '0x1111111111111111111111111111111111111111';
const EOA = `0x${'ab'.repeat(20)}`;
const SCAM_TOKEN = `0x${'cd'.repeat(20)}`;
const USDC_BASE = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';

const sim = vi.fn();
const tokenRisk = vi.fn();

vi.mock('../../src/services/txSimulate.js', () => ({ simulateEvmTxWithCost: (i: unknown) => sim(i) }));
vi.mock('../../src/services/tokenRiskMetrics/index.js', () => ({ getTokenRiskMetricsWithCost: (i: unknown) => tokenRisk(i) }));
vi.mock('../../src/utils/evmRpc.js', async (orig) => ({
  ...(await orig<typeof import('../../src/utils/evmRpc.js')>()),
  rpcBatch: vi.fn(async (_chain: string, calls: unknown[]) => calls.map(() => null)),
}));
vi.mock('../../src/services/addressCheck.js', () => ({
  screenAddresses: vi.fn(async (items: Array<{ address: string; chain: string }>) =>
    items.map((i) => {
      const blocked = i.address.toLowerCase() === OFAC;
      return {
        address: i.address, chain: i.chain,
        verdict: blocked ? 'block' : 'no_known_issues',
        reasons: blocked ? ['OFAC sanctioned'] : [],
        sanctioned: blocked, flaggedScam: false, isContract: true, valid: true,
      };
    })),
}));

const { preflightWithCost } = await import('../../src/services/preflight.js');
const { priceFor } = await import('../../src/pricing.js');

const simOutput = (over: Record<string, unknown> = {}) => ({
  output: {
    chain: 'base', from: SIGNER, verdict: 'proceed', reasons: [], calls: [{ index: 0, to: USDC_BASE, success: true }],
    assetChanges: [], approvals: [], counterparties: [], note: 'n', relatedServices: [],
    ...over,
  },
  estimatedCostUsd: 0,
});
const risk = (score: number, level: string) => ({
  output: { overallRisk: { score, level, flags: level === 'critical' ? ['honeypot_pattern'] : [] } },
  estimatedCostUsd: 0,
});

beforeEach(() => {
  sim.mockReset();
  tokenRisk.mockReset();
});

describe('preflight', () => {
  it('proceeds when every check is clean and names the checks run', async () => {
    sim.mockResolvedValue(simOutput());
    const { output } = await preflightWithCost({
      chain: 'base', from: SIGNER, transactions: [{ to: USDC_BASE, data: '0x' }], recipients: [EOA],
    });
    expect(output.verdict).toBe('proceed');
    expect(output.checksRun).toEqual(['simulation', 'addresses']);
    expect(output.summary).toMatch(/No known issues/);
    expect(output.pricing.tokensCharged).toBe(0);
  });

  it('avoids when a recipient is sanctioned, even if the simulation is clean', async () => {
    sim.mockResolvedValue(simOutput());
    const { output } = await preflightWithCost({
      chain: 'base', from: SIGNER, transactions: [{ to: USDC_BASE }], recipients: [OFAC],
    });
    expect(output.verdict).toBe('avoid');
    expect(output.summary).toMatch(/^Avoid: OFAC sanctioned/);
    expect(output.reasons[0]).toMatch(/^\[recipient 0x0330/);
  });

  it('rug-checks a token the simulation shows the wallet receiving', async () => {
    sim.mockResolvedValue(simOutput({
      assetChanges: [
        { token: USDC_BASE, standard: 'erc20', delta: '-1000000' },
        { token: SCAM_TOKEN, standard: 'erc20', delta: '5000' },
      ],
    }));
    tokenRisk.mockResolvedValue(risk(90, 'critical'));
    const { output } = await preflightWithCost({ chain: 'base', from: SIGNER, transactions: [{ to: USDC_BASE }] });
    expect(tokenRisk).toHaveBeenCalledTimes(1);
    expect(tokenRisk).toHaveBeenCalledWith({ address: SCAM_TOKEN, chain: 'base' });
    expect(output.tokens?.[0]).toMatchObject({ source: 'received', verdict: 'avoid' });
    expect(output.verdict).toBe('avoid');
    expect(output.pricing.tokensCharged).toBe(0); // received tokens ride on the base price
  });

  it('checks a signature, taking the chain from the typed data', async () => {
    const { output } = await preflightWithCost({
      from: SIGNER,
      typedData: {
        domain: { name: 'USD Coin', version: '2', chainId: 56, verifyingContract: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d' },
        primaryType: 'Permit',
        message: { owner: SIGNER, spender: OFAC, value: '1', nonce: 0, deadline: 1900000000 },
      },
    });
    expect(output.chain).toBe('bsc');
    expect(output.checksRun).toEqual(['signature']);
    expect(output.verdict).toBe('avoid');
  });

  it('skips simulation on a chain without eth_simulateV1 but still screens', async () => {
    const { output } = await preflightWithCost({
      chain: 'avalanche', from: SIGNER, transactions: [{ to: EOA }], recipients: [EOA],
    });
    expect(sim).not.toHaveBeenCalled();
    expect(output.skipped[0].check).toBe('simulation');
    expect(output.verdict).toBe('caution');
  });

  it('fails (so the caller is not charged) when no check can run', async () => {
    sim.mockRejectedValue(new Error('RPC down'));
    await expect(preflightWithCost({ chain: 'base', from: SIGNER, transactions: [{ to: EOA }] })).rejects.toThrow(/No check could run/);
  });

  it('rejects empty requests and transactions without a sender', async () => {
    await expect(preflightWithCost({ chain: 'base' })).rejects.toThrow();
    await expect(preflightWithCost({ transactions: [{ to: EOA }] })).rejects.toThrow(/from/);
  });

  it('prices the base check plus each requested token', () => {
    expect(priceFor('/v1/preflight', { recipients: [EOA] })).toBe(0.008);
    expect(priceFor('/v1/preflight', { tokens: [EOA, SCAM_TOKEN] })).toBe(0.016);
    expect(priceFor('/v1/preflight', { tokens: Array(9).fill(EOA) })).toBe(0.028);
  });
});
