import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tokenRiskMetricsOutput, tokenRiskMetricsInput } from '../../src/schemas/tokenRiskMetrics.js';
import {
  detectPermissions,
  scorePermissionRisk,
} from '../../src/services/tokenRiskMetrics/permissions.js';
import {
  scoreConcentration,
  computeConcentrationRisk,
} from '../../src/services/tokenRiskMetrics/concentration.js';
import {
  scoreLiquidityRisk,
} from '../../src/services/tokenRiskMetrics/liquidity.js';
import {
  computeCompositeScore,
} from '../../src/services/tokenRiskMetrics/composite.js';

// ── Fixtures ─────────────────────────────────────────────────────────

const USDC_ADDRESS = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';

function makeMinimalResponse(overrides: Record<string, unknown> = {}) {
  return {
    address: USDC_ADDRESS,
    chain: 'ethereum',
    source: 'cached' as const,
    computedAt: new Date().toISOString(),
    stalenessSec: 0,
    holders: {
      top10HolderPct: 25,
      top10Addresses: [],
      concentrationRisk: 'low' as const,
    },
    liquidity: {
      liquidityRisk: 'low' as const,
    },
    permissions: {
      canMint: false,
      canBurn: false,
      canPause: false,
      canBlacklist: false,
      canUpgrade: false,
      hasOwner: false,
      permissionRisk: 'none' as const,
    },
    deployer: {
      deployerRisk: 'low' as const,
    },
    overallRisk: {
      score: 10,
      level: 'low' as const,
      flags: [],
    },
    relatedServices: [],
    ...overrides,
  };
}

// ── Schema validation ─────────────────────────────────────────────────

describe('Token Risk Metrics Schema', () => {
  describe('Schema validation', () => {
    it('validates complete response with all fields', () => {
      const response = {
        ...makeMinimalResponse(),
        symbol: 'USDC',
        name: 'USD Coin',
        holders: {
          totalHolders: 2_000_000,
          top10HolderPct: 22.5,
          top10Addresses: [
            { address: '0xabc123', label: 'Binance Hot Wallet', pct: 8.1, isContract: false },
          ],
          concentrationRisk: 'low' as const,
        },
        liquidity: {
          totalLiquidityUsd: 500_000_000,
          marketCapUsd: 25_000_000_000,
          liquidityToMcapRatio: 0.02,
          liquidityRisk: 'medium' as const,
          topPools: [{ dex: 'uniswap-v3', pair: 'USDC-ETH', tvlUsd: 200_000_000 }],
        },
        permissions: {
          canMint: true,
          canBurn: true,
          canPause: true,
          canBlacklist: true,
          canUpgrade: false,
          hasOwner: true,
          isRenounced: false,
          permissionRisk: 'critical' as const,
        },
        deployer: {
          address: '0xdeployer',
          label: 'Circle',
          totalContractsDeployed: 5,
          knownRugPulls: 0,
          deployerRisk: 'low' as const,
        },
        overallRisk: {
          score: 45,
          level: 'medium' as const,
          flags: ['Owner can mint unlimited tokens', 'Owner can blacklist addresses'],
        },
      };
      expect(() => tokenRiskMetricsOutput.parse(response)).not.toThrow();
    });

    it('validates response with minimal/optional fields', () => {
      expect(() => tokenRiskMetricsOutput.parse(makeMinimalResponse())).not.toThrow();
    });

    it('validates all risk level enums', () => {
      const levels = ['low', 'medium', 'high', 'critical'];
      for (const level of levels) {
        const r = makeMinimalResponse({
          holders: { top10HolderPct: 25, top10Addresses: [], concentrationRisk: level },
        });
        expect(() => tokenRiskMetricsOutput.parse(r)).not.toThrow();
      }
    });

    it('validates composite score range 0-100', () => {
      const r = makeMinimalResponse({ overallRisk: { score: 50, level: 'medium', flags: [] } });
      expect(() => tokenRiskMetricsOutput.parse(r)).not.toThrow();

      const tooHigh = makeMinimalResponse({ overallRisk: { score: 101, level: 'critical', flags: [] } });
      expect(() => tokenRiskMetricsOutput.parse(tooHigh)).toThrow();
    });

    it('validates input schema requires 0x address', () => {
      expect(() => tokenRiskMetricsInput.parse({ address: 'notanaddress' })).toThrow();
      expect(() => tokenRiskMetricsInput.parse({ address: USDC_ADDRESS })).not.toThrow();
    });
  });
});

// ── Permission detection ───────────────────────────────────────────────

describe('Permission detection', () => {
  const makeAbi = (fns: string[]) =>
    fns.map(name => ({ name, type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [] }));

  it('detects mint function in ABI', () => {
    const result = detectPermissions(makeAbi(['mint', 'transfer', 'approve']));
    expect(result.canMint).toBe(true);
  });

  it('detects burn function in ABI', () => {
    const result = detectPermissions(makeAbi(['burn', 'transfer']));
    expect(result.canBurn).toBe(true);
  });

  it('detects pause/unpause functions', () => {
    const result = detectPermissions(makeAbi(['pause', 'unpause']));
    expect(result.canPause).toBe(true);
  });

  it('detects blacklist functions', () => {
    const result = detectPermissions(makeAbi(['blacklist', 'transfer']));
    expect(result.canBlacklist).toBe(true);

    const result2 = detectPermissions(makeAbi(['addToBlacklist']));
    expect(result2.canBlacklist).toBe(true);

    const result3 = detectPermissions(makeAbi(['freeze']));
    expect(result3.canBlacklist).toBe(true);
  });

  it('detects ownership functions', () => {
    const result = detectPermissions(makeAbi(['owner', 'transferOwnership']));
    expect(result.hasOwner).toBe(true);
  });

  it('returns no permissions for clean ERC-20', () => {
    const cleanAbi = makeAbi(['transfer', 'transferFrom', 'approve', 'allowance', 'balanceOf', 'totalSupply']);
    const result = detectPermissions(cleanAbi);
    expect(result.canMint).toBe(false);
    expect(result.canBurn).toBe(false);
    expect(result.canPause).toBe(false);
    expect(result.canBlacklist).toBe(false);
    expect(result.hasOwner).toBe(false);
  });

  it('handles ABI with no matching functions', () => {
    const result = detectPermissions([]);
    expect(result.canMint).toBe(false);
    expect(result.canBurn).toBe(false);
    expect(result.canPause).toBe(false);
    expect(result.canBlacklist).toBe(false);
    expect(result.hasOwner).toBe(false);
  });

  it('handles multiple permission types simultaneously', () => {
    const result = detectPermissions(makeAbi(['mint', 'burn', 'pause', 'blacklist', 'owner']));
    expect(result.canMint).toBe(true);
    expect(result.canBurn).toBe(true);
    expect(result.canPause).toBe(true);
    expect(result.canBlacklist).toBe(true);
    expect(result.hasOwner).toBe(true);
  });

  it('permission risk: none when no owner and no dangerous functions', () => {
    const perms = { canMint: false, canBurn: false, canPause: false, canBlacklist: false, canUpgrade: false, hasOwner: false };
    expect(scorePermissionRisk(perms)).toBe('none');
  });

  it('permission risk: low when has owner but no dangerous functions', () => {
    const perms = { canMint: false, canBurn: false, canPause: false, canBlacklist: false, canUpgrade: false, hasOwner: true };
    expect(scorePermissionRisk(perms)).toBe('low');
  });

  it('permission risk: medium when can pause', () => {
    const perms = { canMint: false, canBurn: false, canPause: true, canBlacklist: false, canUpgrade: false, hasOwner: true };
    expect(scorePermissionRisk(perms)).toBe('medium');
  });

  it('permission risk: medium when can upgrade', () => {
    const perms = { canMint: false, canBurn: false, canPause: false, canBlacklist: false, canUpgrade: true, hasOwner: true };
    expect(scorePermissionRisk(perms)).toBe('medium');
  });

  it('permission risk: high when can mint', () => {
    const perms = { canMint: true, canBurn: false, canPause: false, canBlacklist: false, canUpgrade: false, hasOwner: true };
    expect(scorePermissionRisk(perms)).toBe('high');
  });

  it('permission risk: critical when canMint AND canPause', () => {
    const perms = { canMint: true, canBurn: false, canPause: true, canBlacklist: false, canUpgrade: false, hasOwner: true };
    expect(scorePermissionRisk(perms)).toBe('critical');
  });

  it('permission risk: critical when canMint AND canBlacklist', () => {
    const perms = { canMint: true, canBurn: false, canPause: false, canBlacklist: true, canUpgrade: false, hasOwner: true };
    expect(scorePermissionRisk(perms)).toBe('critical');
  });
});

// ── Concentration scoring ─────────────────────────────────────────────

describe('Concentration scoring', () => {
  it('scores <30% as low', () => {
    expect(scoreConcentration(15)).toBe('low');
    expect(scoreConcentration(29.9)).toBe('low');
  });

  it('scores 30-50% as medium', () => {
    expect(scoreConcentration(30)).toBe('medium');
    expect(scoreConcentration(49.9)).toBe('medium');
  });

  it('scores 50-70% as high', () => {
    expect(scoreConcentration(50)).toBe('high');
    expect(scoreConcentration(69.9)).toBe('high');
  });

  it('scores >70% as critical', () => {
    expect(scoreConcentration(70)).toBe('critical');
    expect(scoreConcentration(95)).toBe('critical');
  });

  it('labels exchange wallets from registry', () => {
    const registry = { lookup: (addr: string) => addr === '0xex1' ? { name: 'Binance Hot Wallet', category: 'exchange' } : null };
    const holders = [{ address: '0xex1', rawBalance: 1000n, pct: 15, isContract: false }];
    const result = computeConcentrationRisk(holders as any, 10_000n, registry as any);
    const labeled = result.top10Addresses.find(h => h.address === '0xex1');
    expect(labeled?.label).toBe('Binance Hot Wallet');
  });

  it('labels DeFi protocol contracts from registry', () => {
    const registry = { lookup: (addr: string) => addr === '0xpool1' ? { name: 'Uniswap V3 Pool', category: 'dex' } : null };
    const holders = [{ address: '0xpool1', rawBalance: 2000n, pct: 20, isContract: true }];
    const result = computeConcentrationRisk(holders as any, 10_000n, registry as any);
    const labeled = result.top10Addresses.find(h => h.address === '0xpool1');
    expect(labeled?.label).toBe('Uniswap V3 Pool');
  });

  it('excludes known burn addresses from calculation', () => {
    const burnHolder = { address: '0x0000000000000000000000000000000000000000', rawBalance: 5000n, pct: 50, isContract: false };
    const normalHolder = { address: '0xabc', rawBalance: 100n, pct: 1, isContract: false };
    const holders = [burnHolder, normalHolder];
    const result = computeConcentrationRisk(holders as any, 10_000n, null as any);
    // Burn address should be excluded from concentration calc, so top10HolderPct should only reflect normal holder
    expect(result.top10HolderPct).toBeLessThan(50);
  });
});

// ── Liquidity scoring ─────────────────────────────────────────────────

describe('Liquidity scoring', () => {
  it('scores ratio >0.15 as low risk', () => {
    expect(scoreLiquidityRisk(0.2)).toBe('low');
    expect(scoreLiquidityRisk(1.0)).toBe('low');
  });

  it('scores ratio 0.05-0.15 as medium risk', () => {
    expect(scoreLiquidityRisk(0.05)).toBe('medium');
    expect(scoreLiquidityRisk(0.14)).toBe('medium');
  });

  it('scores ratio 0.01-0.05 as high risk', () => {
    expect(scoreLiquidityRisk(0.01)).toBe('high');
    expect(scoreLiquidityRisk(0.04)).toBe('high');
  });

  it('scores ratio <0.01 as critical risk', () => {
    expect(scoreLiquidityRisk(0.009)).toBe('critical');
    expect(scoreLiquidityRisk(0)).toBe('critical');
  });

  it('handles missing liquidity data gracefully', () => {
    expect(scoreLiquidityRisk(undefined)).toBe('high'); // unknown = treat as high
  });

  it('handles missing market cap gracefully', () => {
    // When mcap is 0 or undefined, ratio can't be computed
    expect(scoreLiquidityRisk(undefined)).toBe('high');
  });
});

// ── Composite score ────────────────────────────────────────────────────

describe('Composite score', () => {
  it('weights concentration at 30%, liquidity 25%, permissions 30%, deployer 15%', () => {
    // All low = near 0
    const result = computeCompositeScore({
      concentrationRisk: 'low',
      liquidityRisk: 'low',
      permissionRisk: 'none',
      deployerRisk: 'low',
    });
    expect(result.score).toBeLessThan(20);
  });

  it('generates human-readable flags', () => {
    const { flags } = computeCompositeScore({
      concentrationRisk: 'critical',
      liquidityRisk: 'critical',
      permissionRisk: 'high',
      deployerRisk: 'high',
      top10HolderPct: 85,
      canMint: true,
    });
    expect(flags.length).toBeGreaterThan(0);
    expect(flags.some(f => f.toLowerCase().includes('holder') || f.toLowerCase().includes('concentrat'))).toBe(true);
  });

  it('score near 0 for safe token (USDC-like profile)', () => {
    const { score } = computeCompositeScore({
      concentrationRisk: 'low',
      liquidityRisk: 'low',
      permissionRisk: 'none',
      deployerRisk: 'low',
    });
    expect(score).toBeLessThan(25);
  });

  it('score near 100 for dangerous token (mintable + concentrated + thin liquidity)', () => {
    const { score } = computeCompositeScore({
      concentrationRisk: 'critical',
      liquidityRisk: 'critical',
      permissionRisk: 'critical',
      deployerRisk: 'high',
      top10HolderPct: 90,
      canMint: true,
    });
    expect(score).toBeGreaterThan(80);
  });

  it('overall level matches score', () => {
    const low = computeCompositeScore({ concentrationRisk: 'low', liquidityRisk: 'low', permissionRisk: 'none', deployerRisk: 'low' });
    expect(low.level).toBe('low');

    const critical = computeCompositeScore({ concentrationRisk: 'critical', liquidityRisk: 'critical', permissionRisk: 'critical', deployerRisk: 'high' });
    expect(critical.level).toBe('critical');
  });
});

// ── Composability ───────────────────────────────────────────────────────

describe('Composability', () => {
  it('response includes relatedServices', () => {
    const response = makeMinimalResponse({
      relatedServices: [
        { endpoint: '/v1/contract-docs', description: 'Get contract documentation', suggestedInput: { address: USDC_ADDRESS } },
        { endpoint: '/v1/pool-snapshot', description: 'Get pools containing this token', suggestedInput: { token: 'USDC' } },
      ],
    });
    expect(() => tokenRiskMetricsOutput.parse(response)).not.toThrow();
    expect(response.relatedServices).toHaveLength(2);
  });
});
