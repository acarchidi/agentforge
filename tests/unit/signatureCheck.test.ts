import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/utils/evmRpc.js', async (orig) => ({
  ...(await orig<typeof import('../../src/utils/evmRpc.js')>()),
  rpcBatch: vi.fn(async (_chain: string, calls: unknown[]) => calls.map(() => null)),
}));
vi.mock('../../src/services/addressCheck.js', () => ({
  screenAddresses: vi.fn(async (items: Array<{ address: string; chain: string }>) =>
    items.map((i) => ({
      address: i.address,
      chain: i.chain,
      verdict: i.address.toLowerCase() === OFAC ? 'block' : 'no_known_issues',
      reasons: [],
      sanctioned: i.address.toLowerCase() === OFAC,
      flaggedScam: false,
      isContract: !i.address.toLowerCase().startsWith('0xabab'),
      valid: true,
    }))),
}));

const { analyzeTypedData, signatureCheckWithCost } = await import('../../src/services/signatureCheck.js');

const OFAC = '0x0330070fd38ec3bb94f58fa55d40368271e9e54a';
const SIGNER = '0x1111111111111111111111111111111111111111';
const EOA = `0x${'ab'.repeat(20)}`;
const ROUTER = '0x6ff5693b99212da76ad316178a184ab56d299b43'; // Uniswap Universal Router (Base), in the registry
const USDC_BASE = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const NOW = 1_800_000_000_000;
const soon = Math.floor(NOW / 1000) + 7 * 86400;
const MAX256 = (2n ** 256n - 1n).toString();

const permit = (spender: string, value: string, deadline: string | number, verifyingContract = USDC_BASE) => ({
  domain: { name: 'USD Coin', version: '2', chainId: 8453, verifyingContract },
  primaryType: 'Permit',
  message: { owner: SIGNER, spender, value, nonce: 0, deadline },
});

describe('analyzeTypedData', () => {
  it('classifies an ERC-20 permit, flags unlimited and never-expiring', () => {
    const a = analyzeTypedData(permit(ROUTER, MAX256, MAX256), { now: NOW });
    expect(a.kind).toBe('erc20-permit');
    expect(a.grants[0]).toMatchObject({ to: ROUTER, unlimited: true, expires: 'never' });
    expect(a.reasons.join(' ')).toMatch(/never expires/);
  });

  it('catches a fake "USD Coin" domain', () => {
    const a = analyzeTypedData(permit(ROUTER, '1', soon, '0x1234567890123456789012345678901234567890'), { now: NOW });
    expect(a.avoid).toBe(true);
    expect(a.reasons[0]).toMatch(/impersonation/);
  });

  it('decodes Permit2 single and batch allowances and transfers', () => {
    const single = analyzeTypedData({ domain: { name: 'Permit2', chainId: 8453, verifyingContract: PERMIT2 }, primaryType: 'PermitSingle', message: { details: { token: USDC_BASE, amount: (2n ** 160n - 1n).toString(), expiration: soon, nonce: 0 }, spender: ROUTER, sigDeadline: soon } }, { now: NOW });
    expect(single.kind).toBe('permit2-allowance');
    expect(single.grants[0].unlimited).toBe(true);
    const batch = analyzeTypedData({ domain: { name: 'Permit2', chainId: 8453, verifyingContract: PERMIT2 }, primaryType: 'PermitBatch', message: { details: [{ token: USDC_BASE, amount: '5', expiration: soon }, { token: ROUTER, amount: '7', expiration: soon }], spender: ROUTER, sigDeadline: soon } }, { now: NOW });
    expect(batch.grants).toHaveLength(2);
    const transfer = analyzeTypedData({ domain: { name: 'Permit2', chainId: 8453, verifyingContract: PERMIT2 }, primaryType: 'PermitWitnessTransferFrom', message: { permitted: { token: USDC_BASE, amount: '100' }, spender: ROUTER, nonce: 1, deadline: soon } }, { now: NOW });
    expect(transfer.kind).toBe('permit2-transfer');
  });

  it('flags a Seaport order that pays the signer nothing', () => {
    const a = analyzeTypedData({ domain: { name: 'Seaport', chainId: 8453 }, primaryType: 'OrderComponents', message: { offerer: SIGNER, offer: [{ token: ROUTER, startAmount: '1' }], consideration: [{ startAmount: '1', recipient: EOA }], endTime: soon } }, { now: NOW });
    expect(a.kind).toBe('seaport-order');
    expect(a.avoid).toBe(true);
    const fair = analyzeTypedData({ domain: { name: 'Seaport', chainId: 8453 }, primaryType: 'OrderComponents', message: { offerer: SIGNER, offer: [{ token: ROUTER, startAmount: '1' }], consideration: [{ startAmount: '1000', recipient: SIGNER }, { startAmount: '25', recipient: EOA }], endTime: soon } }, { now: NOW });
    expect(fair.avoid).toBe(false);
  });

  it('notices a wrong-wallet signature, a chain mismatch, and unknown types', () => {
    const wrong = analyzeTypedData(permit(ROUTER, '1', soon), { signer: EOA, chain: 'ethereum', now: NOW });
    expect(wrong.reasons.join(' ')).toMatch(/not the signer/);
    expect(wrong.reasons.join(' ')).toMatch(/chain 8453/);
    const unknown = analyzeTypedData({ domain: {}, primaryType: 'Claim', message: { operator: EOA } }, { now: NOW });
    expect(unknown.kind).toBe('unknown-typed-data');
    expect(unknown.parties).toEqual([{ address: EOA, role: 'operator' }]);
  });
});

describe('signatureCheckWithCost', () => {
  beforeEach(() => vi.clearAllMocks());
  // The service reads the real clock, so deadlines here are relative to now.
  const soonReal = Math.floor(Date.now() / 1000) + 7 * 86400;

  it('avoids permissions granted to a plain wallet; proceeds for a labeled router', async () => {
    const bad = await signatureCheckWithCost({ signer: SIGNER, typedData: permit(EOA, '1000000', soonReal) });
    expect(bad.output.verdict).toBe('avoid');
    expect(bad.output.reasons.join(' ')).toMatch(/plain wallet/);
    const ok = await signatureCheckWithCost({ signer: SIGNER, typedData: JSON.stringify(permit(ROUTER, '1000000', soonReal)) });
    expect(ok.output.verdict).toBe('proceed');
    expect(ok.output.grants[0].toLabel).toMatch(/Universal Router/);
  });

  it('checks x402 payment options: USDC, payee screening, and the price cap', async () => {
    const accepts = [{ scheme: 'exact', network: 'eip155:8453', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', amount: '5000', payTo: SIGNER, extra: { name: 'USD Coin', version: '2' } }];
    const ok = await signatureCheckWithCost({ paymentRequired: { accepts }, expectedMaxUsd: 0.01 });
    expect(ok.output).toMatchObject({ kind: 'x402-payment', verdict: 'proceed' });
    expect(ok.output.summary).toMatch(/\$0\.005 USDC on Base/);
    expect((await signatureCheckWithCost({ paymentRequired: { accepts }, expectedMaxUsd: 0.001 })).output.verdict).toBe('avoid');
    expect((await signatureCheckWithCost({ paymentRequired: { accepts: [{ ...accepts[0], payTo: OFAC }] } })).output.verdict).toBe('avoid');
    const notUsdc = await signatureCheckWithCost({ paymentRequired: { accepts: [{ ...accepts[0], asset: ROUTER }] } });
    expect(notUsdc.output.verdict).toBe('caution');
    expect(notUsdc.output.paymentOptions?.[0].assetIsUsdc).toBe(false);
  });

  it('requires exactly one of typedData or paymentRequired', async () => {
    await expect(signatureCheckWithCost({})).rejects.toThrow();
    await expect(signatureCheckWithCost({ typedData: permit(ROUTER, '1', soon), paymentRequired: { accepts: [{ scheme: 'exact', network: 'x', asset: 'y', payTo: 'z' }] } })).rejects.toThrow();
  });
});
