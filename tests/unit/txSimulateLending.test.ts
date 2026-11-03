import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { encodeAbiParameters, encodeFunctionData, erc20Abi, maxUint256, pad } from 'viem';

vi.mock('../../src/utils/evmRpc.js', async (orig) => ({
  ...(await orig<typeof import('../../src/utils/evmRpc.js')>()),
  rpcBatch: vi.fn(),
}));

const { rpcBatch } = await import('../../src/utils/evmRpc.js');
const { simulateEvmTxWithCost, decodeRevert } = await import('../../src/services/txSimulate.js');
const { positionFrom, statusFor, getLendingHealthWithCost } = await import('../../src/services/lendingHealth.js');

const FROM = '0x1111111111111111111111111111111111111111';
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const POOL = '0xa238dd80c259a72e81d7e4664a9801593f98d1c5'; // Aave V3 Pool (Base), in the registry
const FRESH = `0x${'ab'.repeat(20)}`;
const OFAC = '0x0330070fd38ec3bb94f58fa55d40368271e9e54a';
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const APPROVAL = '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925';
const t = (a: string) => pad(a as `0x${string}`, { size: 32 });
const word = (n: bigint) => encodeAbiParameters([{ type: 'uint256' }], [n]);

/** rpcBatch stub: balances, code, nonces, token metadata. */
function stubRpc(opts: { ethBalance?: bigint; contracts?: string[] } = {}) {
  const contracts = new Set([USDC, POOL, ...(opts.contracts ?? [])]);
  vi.mocked(rpcBatch).mockImplementation(async (_chain, calls) =>
    calls.map((c) => {
      const p = c.params as any[];
      if (c.method === 'eth_getBalance') return `0x${(opts.ethBalance ?? 10n ** 18n).toString(16)}`;
      if (c.method === 'eth_getCode') return contracts.has(String(p[0]).toLowerCase()) ? '0x6080' : '0x';
      if (c.method === 'eth_getTransactionCount') return String(p[0]).toLowerCase() === FRESH ? '0x0' : '0x5';
      if (c.method === 'eth_call') {
        const data = String(p[0].data);
        if (data === encodeFunctionData({ abi: erc20Abi, functionName: 'symbol' })) return encodeAbiParameters([{ type: 'string' }], ['USDC']);
        if (data === encodeFunctionData({ abi: erc20Abi, functionName: 'decimals' })) return word(6n);
      }
      return null;
    }),
  );
}

/** fetch stub for the eth_simulateV1 request. */
function stubSim(payload: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })));
}

const xfer = (to: string, amt: bigint) => encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [to as `0x${string}`, amt] });
const approve = (sp: string) => encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [sp as `0x${string}`, maxUint256] });

describe('tx-simulate', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it('reports a USDC transfer to a fresh wallet as an outgoing delta with caution', async () => {
    stubRpc();
    stubSim({ result: [{ calls: [{ status: '0x1', gasUsed: '0xaf5b', returnData: '0x', logs: [{ address: USDC, topics: [TRANSFER, t(FROM), t(FRESH)], data: word(1_000_000n) }] }] }] });
    const { output } = await simulateEvmTxWithCost({ chain: 'base', from: FROM, transactions: [{ to: USDC, data: xfer(FRESH, 1_000_000n) }] });
    expect(output.verdict).toBe('caution');
    expect(output.assetChanges).toEqual([expect.objectContaining({ token: USDC, symbol: 'USDC', delta: '-1000000', deltaFormatted: '-1', standard: 'erc20' })]);
    expect(output.counterparties.find((c) => c.address === FRESH)?.verdict).toBe('caution');
  });

  it('decodes revert reasons from error.data and still screens the intended recipient', async () => {
    stubRpc();
    const reason = encodeAbiParameters([{ type: 'string' }], ['Blacklistable: account is blacklisted']);
    stubSim({ result: [{ calls: [{ status: '0x0', returnData: '0x', logs: [], error: { message: 'execution reverted', data: `0x08c379a0${reason.slice(2)}` } }] }] });
    const { output } = await simulateEvmTxWithCost({ chain: 'base', from: FROM, transactions: [{ to: USDC, data: xfer(OFAC, 1n) }] });
    expect(output.verdict).toBe('avoid');
    expect(output.calls[0].revertReason).toBe('Blacklistable: account is blacklisted');
    expect(output.counterparties.find((c) => c.address === OFAC)).toMatchObject({ role: 'recipient', verdict: 'block' });
  });

  it('avoids an unlimited approval to a plain wallet, proceeds with one to a labeled protocol', async () => {
    stubRpc();
    const approvalLog = (spender: string) => ({ address: USDC, topics: [APPROVAL, t(FROM), t(spender)], data: word(maxUint256) });
    stubSim({ result: [{ calls: [{ status: '0x1', returnData: '0x', logs: [approvalLog(FRESH)] }] }] });
    const eoa = await simulateEvmTxWithCost({ chain: 'base', from: FROM, transactions: [{ to: USDC, data: approve(FRESH) }] });
    expect(eoa.output.verdict).toBe('avoid');
    expect(eoa.output.approvals[0]).toMatchObject({ spender: FRESH, unlimited: true, kind: 'erc20' });

    stubSim({ result: [{ calls: [{ status: '0x1', returnData: '0x', logs: [approvalLog(POOL)] }] }] });
    const aave = await simulateEvmTxWithCost({ chain: 'base', from: FROM, transactions: [{ to: USDC, data: approve(POOL) }] });
    expect(aave.output.verdict).toBe('proceed');
    expect(aave.output.approvals[0].spenderLabel).toMatch(/Aave/);
  });

  it('flags sending more ETH than the wallet holds', async () => {
    stubRpc({ ethBalance: 10n ** 15n });
    stubSim({ result: [{ calls: [{ status: '0x1', returnData: '0x', logs: [] }] }] });
    const { output } = await simulateEvmTxWithCost({ chain: 'base', from: FROM, transactions: [{ to: POOL, value: (10n ** 18n).toString() }] });
    expect(output.verdict).toBe('avoid');
    expect(output.reasons.some((r) => r.includes('will fail on-chain'))).toBe(true);
  });

  it('turns a whole-request node rejection into avoid', async () => {
    stubRpc();
    stubSim({ error: { code: -38014, message: 'insufficient funds for gas * price + value' } });
    const { output } = await simulateEvmTxWithCost({ chain: 'optimism', from: FROM, transactions: [{ to: FRESH, value: '1' }] });
    expect(output.verdict).toBe('avoid');
    expect(output.calls[0].success).toBe(false);
  });

  it('decodeRevert handles Error(string), Panic, custom and empty', () => {
    expect(decodeRevert(`0x08c379a0${encodeAbiParameters([{ type: 'string' }], ['nope']).slice(2)}`)).toBe('nope');
    expect(decodeRevert(`0x4e487b71${word(0x11n).slice(2)}`)).toBe('panic 0x11');
    expect(decodeRevert('0xdeadbeef')).toBe('custom error 0xdeadbeef');
    expect(decodeRevert('0x')).toBe('reverted without a reason');
  });

  it('rejects more than 5 transactions', async () => {
    await expect(simulateEvmTxWithCost({ from: FROM, transactions: new Array(6).fill({ to: USDC }) })).rejects.toThrow();
  });
});

describe('lending health', () => {
  const account = (coll: bigint, debt: bigint, hf: bigint) =>
    encodeAbiParameters(
      ['uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256'].map((type) => ({ type })),
      [coll, debt, 0n, 8422n, 8000n, hf],
    );

  it('decodes a position: 8-decimal USD, bps thresholds, 18-decimal health factor', () => {
    const p = positionFrom('ethereum', account(180_393_000_000n, 50_293_000_000n, 3_021_000_000_000_000_000n));
    expect(p).toMatchObject({ collateralUsd: 1803.93, debtUsd: 502.93, liquidationThresholdPct: 84.22, ltvPct: 80, healthFactor: 3.021, status: 'safe' });
    expect(p?.collateralDropToLiquidationPct).toBeCloseTo(66.9, 1);
  });

  it('treats the uint256-max sentinel as no debt and skips empty accounts', () => {
    expect(positionFrom('base', account(1_000_000_000n, 0n, 2n ** 256n - 1n))).toMatchObject({ healthFactor: null, status: 'no_debt' });
    expect(positionFrom('base', account(0n, 0n, 2n ** 256n - 1n))).toBeNull();
  });

  it('bands health factors', () => {
    expect([0.99, 1.02, 1.1, 1.3, 2].map(statusFor)).toEqual(['liquidatable', 'critical', 'danger', 'watch', 'safe']);
    expect(statusFor(null)).toBe('no_debt');
  });

  it('checks all chains, reports failures, and surfaces the worst position', async () => {
    vi.mocked(rpcBatch).mockImplementation(async (chain) => {
      if (chain === 'polygon') throw new Error('down');
      if (chain === 'base') return [account(100_000_000_000n, 80_000_000_000n, 1_100_000_000_000_000_000n)];
      if (chain === 'ethereum') return [account(100_000_000_000n, 10_000_000_000n, 8_000_000_000_000_000_000n)];
      return [account(0n, 0n, 2n ** 256n - 1n)];
    });
    const { output } = await getLendingHealthWithCost({ address: FROM });
    expect(output.chainsFailed).toEqual(['polygon']);
    expect(output.positions.map((p) => p.chain)).toEqual(['base', 'ethereum']);
    expect(output.worst).toMatchObject({ chain: 'base', status: 'danger' });
  });
});
