import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toFunctionSelector } from 'viem';
import { scoreLaunch, type LaunchMarket } from '../../src/launches/score.js';
import { scanCapabilities, type TokenFacts } from '../../src/launches/onchain.js';
import { MemoryLaunchStore, setLaunchStore } from '../../src/launches/store.js';
import { parsePool } from '../../src/services/dataSources/geckoterminal.js';

vi.mock('../../src/launches/onchain.js', async (orig) => ({
  ...(await orig<typeof import('../../src/launches/onchain.js')>()),
  getTokenFacts: vi.fn(),
}));
vi.mock('../../src/services/dataSources/geckoterminal.js', async (orig) => ({
  ...(await orig<typeof import('../../src/services/dataSources/geckoterminal.js')>()),
  fetchNewPools: vi.fn(),
  fetchPoolsMulti: vi.fn(async () => []),
}));

const onchain = await import('../../src/launches/onchain.js');
const gt = await import('../../src/services/dataSources/geckoterminal.js');
const { getLaunchesWithCost } = await import('../../src/services/launches.js');

const cleanFacts: TokenFacts = {
  name: 'Clean', symbol: 'CLN', decimals: 18, totalSupply: '1000',
  owner: '0x0000000000000000000000000000000000000000', ownerRenounced: true,
  isProxy: false, verified: true,
  capabilities: { mint: false, blacklist: false, pause: false, feeSetter: false, maxTxSetter: false },
  supplyInPoolPct: 95,
};
const activeMarket: LaunchMarket = {
  liquidityUsd: 50_000, fdvUsd: 500_000,
  txH24: { buys: 40, sells: 25, buyers: 30, sellers: 20 },
};

describe('scoreLaunch', () => {
  it('scores a renounced, verified, well-traded launch as low with no flags', () => {
    const r = scoreLaunch(cleanFacts, activeMarket);
    expect(r).toEqual({ score: 0, level: 'low', flags: [] });
  });

  it('flags the classic honeypot: buys but no sells', () => {
    const r = scoreLaunch(cleanFacts, { ...activeMarket, txH24: { buys: 25, sells: 0, buyers: 20, sellers: 0 } });
    expect(r.score).toBe(40);
    expect(r.flags.some((f) => f.includes('possible honeypot'))).toBe(true);
  });

  it('only counts owner powers while the owner is active', () => {
    const powers = { ...cleanFacts.capabilities, mint: true, blacklist: true };
    const renounced = scoreLaunch({ ...cleanFacts, capabilities: powers }, activeMarket);
    const active = scoreLaunch({ ...cleanFacts, capabilities: powers, owner: '0x1111111111111111111111111111111111111111', ownerRenounced: false }, activeMarket);
    expect(renounced.score).toBe(0);
    expect(active.score).toBe(45);
    expect(active.flags).toContain('The owner can mint new supply');
  });

  it('treats a contract without owner() as admin-controlled', () => {
    const r = scoreLaunch({ ...cleanFacts, owner: null, ownerRenounced: false, capabilities: { ...cleanFacts.capabilities, mint: true } }, activeMarket);
    expect(r.flags).toContain('An admin role can mint new supply');
  });

  it('penalizes supply held off-pool, thin liquidity, and untraded launches; clamps at 100', () => {
    const r = scoreLaunch(
      { ...cleanFacts, verified: false, isProxy: true, supplyInPoolPct: 5, ownerRenounced: false, owner: '0x1111111111111111111111111111111111111111', capabilities: { mint: true, blacklist: true, pause: true, feeSetter: true, maxTxSetter: true } },
      { liquidityUsd: 300, fdvUsd: 1_000_000, txH24: { buys: 1, sells: 0, buyers: 1, sellers: 0 } },
    );
    expect(r.score).toBe(100);
    expect(r.level).toBe('critical');
    expect(r.flags.some((f) => f.includes('held off-pool'))).toBe(true);
    expect(r.flags).toContain('Too little trading yet to rule out a honeypot');
  });
});

describe('scanCapabilities', () => {
  it('detects selectors only as PUSH4 operands', () => {
    const mint = toFunctionSelector('function mint(address,uint256)').slice(2);
    const pause = toFunctionSelector('function pause()').slice(2);
    const caps = scanCapabilities(`0x6080604052${'63'}${mint}14610${pause}00`);
    expect(caps.mint).toBe(true);
    expect(caps.pause).toBe(false); // present but not preceded by PUSH4 (0x63)
    expect(caps.blacklist).toBe(false);
  });
});

describe('parsePool', () => {
  const raw = (base: string, quote: string) => ({
    attributes: { address: '0xPOOL', name: 'X / WETH', pool_created_at: '2026-11-03T14:00:00Z', reserve_in_usd: '1234.5', transactions: { h1: { buys: 1 }, h24: { buys: 2, sells: 1 } } },
    relationships: { base_token: { data: { id: `base_${base}` } }, quote_token: { data: { id: `base_${quote}` } }, dex: { data: { id: 'uniswap-v2-base' } } },
  });

  it('takes the non-quote side as the launch token', () => {
    const weth = '0x4200000000000000000000000000000000000006';
    const token = '0x98f7e7a51c11ca319585fa549199eb484678714b';
    expect(parsePool('base', raw(token, weth))?.tokenAddress).toBe(token);
    expect(parsePool('base', raw(weth, token))?.tokenAddress).toBe(token);
    expect(parsePool('base', raw(token, weth))?.liquidityUsd).toBe(1234.5);
  });
});

describe('launch feed', () => {
  const pool = (n: number, minutesAgo: number) => ({
    chain: 'base' as const,
    poolAddress: `0xpool${n}`,
    tokenAddress: `0x${String(n).padStart(40, '0')}`,
    dex: 'uniswap-v2-base',
    name: `T${n} / WETH`,
    poolCreatedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    liquidityUsd: n === 3 ? 100 : 20_000,
    fdvUsd: 200_000,
    marketCapUsd: null,
    volumeH24Usd: 1000,
    priceChangeH1Pct: 0,
    txH1: { buys: 5, sells: 5, buyers: 5, sellers: 5 },
    txH24: { buys: 20, sells: 10, buyers: 15, sellers: 8 },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    setLaunchStore(new MemoryLaunchStore());
    vi.mocked(onchain.getTokenFacts).mockResolvedValue(cleanFacts);
    vi.mocked(gt.fetchNewPools).mockImplementation(async (_c, page) => (page === 1 ? [pool(1, 5), pool(2, 15), pool(3, 25)] : []));
  });

  it('ingests on first poll, filters by liquidity, and returns newest first with nextSince', async () => {
    const { output } = await getLaunchesWithCost({ chain: 'base' });
    expect(output.launches.map((l) => l.token.address)).toEqual([pool(1, 5).tokenAddress, pool(2, 15).tokenAddress]);
    expect(output.launches[0].risk.level).toBe('low');
    expect(Date.parse(output.nextSince)).toBeGreaterThan(Date.now() - 6 * 60_000);
    expect(output.freshness.stale).toBe(false);
  });

  it('honours the lease: a second poll inside a minute does not re-ingest', async () => {
    await getLaunchesWithCost({ chain: 'base' });
    await getLaunchesWithCost({ chain: 'base' });
    expect(vi.mocked(gt.fetchNewPools).mock.calls.filter(([, page]) => page === 1)).toHaveLength(1);
    expect(vi.mocked(onchain.getTokenFacts)).toHaveBeenCalledTimes(3);
  });

  it('returns only launches newer than since, and respects maxRiskScore', async () => {
    const first = await getLaunchesWithCost({ chain: 'base', minLiquidityUsd: 0 });
    const newer = await getLaunchesWithCost({ chain: 'base', since: first.output.nextSince, minLiquidityUsd: 0 });
    expect(newer.output.launches).toHaveLength(0);
    const capped = await getLaunchesWithCost({ chain: 'base', minLiquidityUsd: 0, maxRiskScore: 5 });
    expect(capped.output.launches.every((l) => l.risk.score <= 5)).toBe(true);
    expect(capped.output.launches.some((l) => l.token.address === pool(3, 25).tokenAddress)).toBe(false); // thin liquidity → scored higher
  });
});
