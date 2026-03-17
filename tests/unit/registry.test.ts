import { describe, it, expect } from 'vitest';
import {
  ContractLabelSchema,
  ContractRegistrySchema,
  ContractCategoryEnum,
  RiskLevelEnum,
} from '../../src/registry/types.js';
import { ContractRegistryLookup, getRegistry } from '../../src/registry/lookup.js';
import { approvalScanOutput } from '../../src/schemas/approvalScanner.js';
import { txDecoderOutput } from '../../src/schemas/txDecoder.js';
import { contractMonitorOutput } from '../../src/schemas/contractMonitor.js';
import { contractDocsOutput } from '../../src/schemas/contractDocs.js';

// ── Schema Validation ─────────────────────────────────────────────

describe('ContractLabelSchema', () => {
  it('accepts a valid minimal entry', () => {
    const entry = ContractLabelSchema.parse({
      address: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
      name: 'Uniswap V2 Router',
      chain: 'ethereum',
    });
    expect(entry.name).toBe('Uniswap V2 Router');
    // address should be lowercased
    expect(entry.address).toBe('0x7a250d5630b4cf539739df2c5dacb4c659f2488d');
  });

  it('accepts a fully populated entry', () => {
    const entry = ContractLabelSchema.parse({
      address: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
      name: 'Uniswap V2 Router',
      chain: 'ethereum',
      protocol: 'Uniswap',
      category: 'dex',
      riskLevel: 'safe',
      tags: ['swap', 'amm'],
      isProxy: false,
      deployedAt: '2020-05-05',
      description: 'Main Uniswap V2 router contract',
      source: 'manual',
      lastVerified: '2026-01-01',
    });
    expect(entry.protocol).toBe('Uniswap');
    expect(entry.category).toBe('dex');
    expect(entry.riskLevel).toBe('safe');
    expect(entry.tags).toEqual(['swap', 'amm']);
  });

  it('normalizes address to lowercase', () => {
    const entry = ContractLabelSchema.parse({
      address: '0xABCDEF1234567890ABCDEF1234567890ABCDEF12',
      name: 'Test',
      chain: 'ethereum',
    });
    expect(entry.address).toBe('0xabcdef1234567890abcdef1234567890abcdef12');
  });

  it('rejects address without 0x prefix', () => {
    expect(() =>
      ContractLabelSchema.parse({
        address: 'abcdef1234567890abcdef1234567890abcdef12',
        name: 'Test',
        chain: 'ethereum',
      }),
    ).toThrow();
  });

  it('rejects missing name', () => {
    expect(() =>
      ContractLabelSchema.parse({
        address: '0x' + 'a'.repeat(40),
        chain: 'ethereum',
      }),
    ).toThrow();
  });

  it('rejects missing chain', () => {
    expect(() =>
      ContractLabelSchema.parse({
        address: '0x' + 'a'.repeat(40),
        name: 'Test',
      }),
    ).toThrow();
  });

  it('rejects invalid category', () => {
    expect(() =>
      ContractLabelSchema.parse({
        address: '0x' + 'a'.repeat(40),
        name: 'Test',
        chain: 'ethereum',
        category: 'invalid_category',
      }),
    ).toThrow();
  });

  it('rejects invalid riskLevel', () => {
    expect(() =>
      ContractLabelSchema.parse({
        address: '0x' + 'a'.repeat(40),
        name: 'Test',
        chain: 'ethereum',
        riskLevel: 'extreme',
      }),
    ).toThrow();
  });

  it('defaults optional fields to undefined', () => {
    const entry = ContractLabelSchema.parse({
      address: '0x' + 'a'.repeat(40),
      name: 'Test',
      chain: 'ethereum',
    });
    expect(entry.protocol).toBeUndefined();
    expect(entry.category).toBeUndefined();
    expect(entry.riskLevel).toBeUndefined();
    expect(entry.tags).toBeUndefined();
    expect(entry.isProxy).toBeUndefined();
  });
});

describe('ContractCategoryEnum', () => {
  it('accepts all valid categories', () => {
    const categories = [
      'dex', 'lending', 'bridge', 'stablecoin', 'yield', 'nft-marketplace',
      'oracle', 'governance', 'liquid-staking', 'derivatives', 'token',
      'wallet', 'multisig', 'infrastructure', 'unknown',
    ];
    for (const cat of categories) {
      expect(ContractCategoryEnum.parse(cat)).toBe(cat);
    }
  });

  it('rejects invalid category', () => {
    expect(() => ContractCategoryEnum.parse('defi')).toThrow();
  });
});

describe('RiskLevelEnum', () => {
  it('accepts all valid risk levels', () => {
    const levels = ['safe', 'low', 'medium', 'high', 'critical', 'unknown'];
    for (const level of levels) {
      expect(RiskLevelEnum.parse(level)).toBe(level);
    }
  });

  it('rejects invalid risk level', () => {
    expect(() => RiskLevelEnum.parse('extreme')).toThrow();
  });
});

describe('ContractRegistrySchema', () => {
  it('validates a complete registry', () => {
    const registry = ContractRegistrySchema.parse({
      version: '1.0.0',
      generatedAt: '2026-03-08T00:00:00Z',
      entries: [
        {
          address: '0x' + 'a'.repeat(40),
          name: 'Test',
          chain: 'ethereum',
        },
      ],
    });
    expect(registry.entries).toHaveLength(1);
    expect(registry.version).toBe('1.0.0');
  });

  it('validates an empty registry', () => {
    const registry = ContractRegistrySchema.parse({
      version: '1.0.0',
      generatedAt: '2026-03-08T00:00:00Z',
      entries: [],
    });
    expect(registry.entries).toHaveLength(0);
  });

  it('rejects missing version', () => {
    expect(() =>
      ContractRegistrySchema.parse({
        generatedAt: '2026-03-08T00:00:00Z',
        entries: [],
      }),
    ).toThrow();
  });
});

// ── Lookup Class ──────────────────────────────────────────────────

describe('ContractRegistryLookup', () => {
  const sampleEntries = [
    {
      address: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
      name: 'Uniswap V2 Router',
      chain: 'ethereum',
      protocol: 'Uniswap',
      category: 'dex' as const,
      riskLevel: 'safe' as const,
      tags: ['swap', 'amm'],
    },
    {
      address: '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2',
      name: 'Aave V3 Pool',
      chain: 'ethereum',
      protocol: 'Aave',
      category: 'lending' as const,
      riskLevel: 'safe' as const,
    },
    {
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      name: 'USDC',
      chain: 'ethereum',
      protocol: 'Circle',
      category: 'stablecoin' as const,
      riskLevel: 'safe' as const,
    },
    {
      address: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
      name: 'Uniswap V2 Router (Base)',
      chain: 'base',
      protocol: 'Uniswap',
      category: 'dex' as const,
      riskLevel: 'safe' as const,
    },
    {
      address: '0x' + 'ff'.repeat(20),
      name: 'Exploited Contract',
      chain: 'ethereum',
      protocol: 'HackedProtocol',
      category: 'unknown' as const,
      riskLevel: 'critical' as const,
    },
  ];

  function makeLookup() {
    return new ContractRegistryLookup({
      version: '1.0.0',
      generatedAt: '2026-03-08T00:00:00Z',
      entries: sampleEntries,
    });
  }

  it('looks up by address (case-insensitive)', () => {
    const lookup = makeLookup();
    const result = lookup.lookup('0x7A250D5630B4CF539739DF2C5DACB4C659F2488D');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('Uniswap V2 Router');
  });

  it('looks up by address with chain scoping', () => {
    const lookup = makeLookup();
    const result = lookup.lookup('0x7a250d5630b4cf539739df2c5dacb4c659f2488d', 'base');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('Uniswap V2 Router (Base)');
  });

  it('falls back to any-chain when chain-specific not found', () => {
    const lookup = makeLookup();
    // USDC only defined on ethereum, look up on base should still find it
    const result = lookup.lookup('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', 'base');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('USDC');
  });

  it('returns null for unknown address', () => {
    const lookup = makeLookup();
    const result = lookup.lookup('0x' + '00'.repeat(20));
    expect(result).toBeNull();
  });

  it('handles batch lookups', () => {
    const lookup = makeLookup();
    const results = lookup.batchLookup([
      '0x7a250d5630b4cf539739df2c5dacb4c659f2488d',
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      '0x' + '00'.repeat(20),
    ]);
    expect(results.size).toBe(2);
    expect(results.has('0x7a250d5630b4cf539739df2c5dacb4c659f2488d')).toBe(true);
    expect(results.has('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')).toBe(true);
  });

  it('detects high risk contracts', () => {
    const lookup = makeLookup();
    expect(lookup.isHighRisk('0x' + 'ff'.repeat(20))).toBe(true);
    expect(lookup.isHighRisk('0x7a250d5630b4cf539739df2c5dacb4c659f2488d')).toBe(false);
    expect(lookup.isHighRisk('0x' + '00'.repeat(20))).toBe(false);
  });

  it('gets entries by protocol', () => {
    const lookup = makeLookup();
    const uniswap = lookup.getByProtocol('Uniswap');
    expect(uniswap).toHaveLength(2); // ethereum + base
    expect(uniswap.every(e => e.protocol === 'Uniswap')).toBe(true);
  });

  it('returns empty array for unknown protocol', () => {
    const lookup = makeLookup();
    expect(lookup.getByProtocol('NonExistent')).toHaveLength(0);
  });

  it('gets entries by category', () => {
    const lookup = makeLookup();
    const dexEntries = lookup.getByCategory('dex');
    expect(dexEntries).toHaveLength(2);
    expect(dexEntries.every(e => e.category === 'dex')).toBe(true);
  });

  it('returns empty array for unused category', () => {
    const lookup = makeLookup();
    expect(lookup.getByCategory('bridge')).toHaveLength(0);
  });

  it('returns stats', () => {
    const lookup = makeLookup();
    const stats = lookup.getStats();
    expect(stats.totalEntries).toBe(5);
    expect(stats.uniqueAddresses).toBe(4); // one address appears twice (different chains)
    expect(stats.chains).toContain('ethereum');
    expect(stats.chains).toContain('base');
    expect(stats.categoryCounts.dex).toBe(2);
    expect(stats.categoryCounts.lending).toBe(1);
    expect(stats.categoryCounts.stablecoin).toBe(1);
    expect(stats.protocolCount).toBeGreaterThanOrEqual(4);
  });

  it('handles empty registry', () => {
    const lookup = new ContractRegistryLookup({
      version: '1.0.0',
      generatedAt: '2026-03-08T00:00:00Z',
      entries: [],
    });
    expect(lookup.lookup('0x' + 'a'.repeat(40))).toBeNull();
    expect(lookup.batchLookup(['0x' + 'a'.repeat(40)]).size).toBe(0);
    expect(lookup.isHighRisk('0x' + 'a'.repeat(40))).toBe(false);
    expect(lookup.getByProtocol('Uniswap')).toHaveLength(0);
    expect(lookup.getByCategory('dex')).toHaveLength(0);
    const stats = lookup.getStats();
    expect(stats.totalEntries).toBe(0);
    expect(stats.uniqueAddresses).toBe(0);
  });
});

// ── Singleton ─────────────────────────────────────────────────────

describe('getRegistry singleton', () => {
  it('returns same instance on repeated calls', () => {
    const a = getRegistry();
    const b = getRegistry();
    expect(a).toBe(b);
  });

  it('loads from registry.json with entries', () => {
    const registry = getRegistry();
    const stats = registry.getStats();
    expect(stats.totalEntries).toBeGreaterThan(0);
    expect(stats.version).toBeTruthy();
  });

  it('can look up known addresses from registry.json', () => {
    const registry = getRegistry();
    // Uniswap V2 Router should be in the starter registry
    const result = registry.lookup('0x7a250d5630b4cf539739df2c5dacb4c659f2488d');
    expect(result).not.toBeNull();
    expect(result!.name).toContain('Uniswap');
  });
});

// ── Schema backward compatibility ─────────────────────────────────

describe('Schema backward compatibility with registry fields', () => {
  it('approvalScanOutput still validates without registry fields', () => {
    const output = approvalScanOutput.parse({
      wallet: { address: '0x' + 'a'.repeat(40), chain: 'ethereum' },
      approvals: [
        {
          token: { address: '0x' + 'b'.repeat(40), symbol: 'USDC', name: 'USD Coin' },
          spender: { address: '0x' + 'c'.repeat(40), contractName: 'Uniswap', isVerified: true, label: 'Router' },
          allowance: 'unlimited',
          riskLevel: 'safe',
          riskReason: null,
        },
      ],
      summary: { totalApprovals: 1, unlimitedApprovals: 1, riskyApprovals: 0, overallRisk: 'low', recommendation: 'ok' },
      metadata: { chain: 'ethereum', processingTimeMs: 100, estimatedCostUsd: 0, approvalsScanned: 1 },
    });
    expect(output.approvals[0].spender.label).toBe('Router');
  });

  it('approvalScanOutput validates with registry fields', () => {
    const output = approvalScanOutput.parse({
      wallet: { address: '0x' + 'a'.repeat(40), chain: 'ethereum' },
      approvals: [
        {
          token: { address: '0x' + 'b'.repeat(40), symbol: 'USDC', name: 'USD Coin' },
          spender: {
            address: '0x' + 'c'.repeat(40),
            contractName: 'Uniswap',
            isVerified: true,
            label: 'Router',
            registryLabel: 'Uniswap V2 Router',
            registryProtocol: 'Uniswap',
            registryRisk: 'safe',
          },
          allowance: 'unlimited',
          riskLevel: 'safe',
          riskReason: null,
        },
      ],
      summary: { totalApprovals: 1, unlimitedApprovals: 1, riskyApprovals: 0, overallRisk: 'low', recommendation: 'ok' },
      metadata: { chain: 'ethereum', processingTimeMs: 100, estimatedCostUsd: 0, approvalsScanned: 1 },
    });
    expect(output.approvals[0].spender.registryLabel).toBe('Uniswap V2 Router');
    expect(output.approvals[0].spender.registryProtocol).toBe('Uniswap');
    expect(output.approvals[0].spender.registryRisk).toBe('safe');
  });

  it('txDecoderOutput still validates without registry fields', () => {
    const output = txDecoderOutput.parse({
      transaction: {
        hash: '0x' + 'a'.repeat(64), from: '0x' + 'b'.repeat(40), to: '0x' + 'c'.repeat(40),
        value: '0', valueUsd: null, gasUsed: '21000', gasPrice: '1000000000', gasCostUsd: null,
        timestamp: '2026-03-08T00:00:00Z', blockNumber: 12345, status: 'success',
      },
      decodedCall: {
        functionName: 'transfer', functionSignature: 'transfer(address,uint256)',
        parameters: [], contractName: 'USDC', contractVerified: true,
      },
      explanation: 'A transfer',
      tokenTransfers: [],
      metadata: { chain: 'ethereum', processingTimeMs: 100, estimatedCostUsd: 0 },
    });
    expect(output.decodedCall?.functionName).toBe('transfer');
  });

  it('txDecoderOutput validates with registry fields', () => {
    const output = txDecoderOutput.parse({
      transaction: {
        hash: '0x' + 'a'.repeat(64), from: '0x' + 'b'.repeat(40), to: '0x' + 'c'.repeat(40),
        value: '0', valueUsd: null, gasUsed: '21000', gasPrice: '1000000000', gasCostUsd: null,
        timestamp: '2026-03-08T00:00:00Z', blockNumber: 12345, status: 'success',
      },
      decodedCall: {
        functionName: 'transfer', functionSignature: 'transfer(address,uint256)',
        parameters: [], contractName: 'USDC', contractVerified: true,
        registryLabel: 'USD Coin',
        registryProtocol: 'Circle',
      },
      explanation: 'A transfer',
      tokenTransfers: [],
      metadata: { chain: 'ethereum', processingTimeMs: 100, estimatedCostUsd: 0 },
    });
    expect(output.decodedCall?.registryLabel).toBe('USD Coin');
    expect(output.decodedCall?.registryProtocol).toBe('Circle');
  });

  it('contractMonitorOutput still validates without registry fields', () => {
    const output = contractMonitorOutput.parse({
      contract: { address: '0x' + 'a'.repeat(40), chain: 'ethereum', name: 'Test', isProxy: false },
      recentActivity: {
        transactionCount: 0, adminTransactions: [],
        implementationChanged: false, ownershipChanged: false, pauseStateChanged: false,
      },
      riskAlert: { level: 'none', alerts: [], recommendation: 'All clear' },
      metadata: { lookbackHours: 24, processingTimeMs: 100, estimatedCostUsd: 0 },
    });
    expect(output.contract.name).toBe('Test');
  });

  it('contractMonitorOutput validates with registry fields', () => {
    const output = contractMonitorOutput.parse({
      contract: {
        address: '0x' + 'a'.repeat(40), chain: 'ethereum', name: 'Test', isProxy: false,
        registryLabel: 'Aave V3 Pool',
        registryProtocol: 'Aave',
        registryCategory: 'lending',
      },
      recentActivity: {
        transactionCount: 0, adminTransactions: [],
        implementationChanged: false, ownershipChanged: false, pauseStateChanged: false,
      },
      riskAlert: { level: 'none', alerts: [], recommendation: 'All clear' },
      metadata: { lookbackHours: 24, processingTimeMs: 100, estimatedCostUsd: 0 },
    });
    expect(output.contract.registryLabel).toBe('Aave V3 Pool');
    expect(output.contract.registryCategory).toBe('lending');
  });

  it('contractDocsOutput still validates without registry fields', () => {
    const output = contractDocsOutput.parse({
      contract: {
        address: '0x' + 'a'.repeat(40), chain: 'ethereum', name: 'Test',
        compilerVersion: '0.8.0', isVerified: true, isProxy: false, implementationAddress: null,
      },
      functions: [],
      events: [],
      summary: { totalFunctions: 0, readFunctions: 0, writeFunctions: 0, adminFunctions: 0, riskLevel: 'low', overview: 'ok' },
      metadata: { model: 'gpt-4', processingTimeMs: 100, estimatedCostUsd: 0, abiSize: 0 },
    });
    expect(output.contract.name).toBe('Test');
  });

  it('contractDocsOutput validates with registry fields', () => {
    const output = contractDocsOutput.parse({
      contract: {
        address: '0x' + 'a'.repeat(40), chain: 'ethereum', name: 'Test',
        compilerVersion: '0.8.0', isVerified: true, isProxy: false, implementationAddress: null,
        registryLabel: 'Compound Comptroller',
        registryProtocol: 'Compound',
        registryCategory: 'lending',
      },
      functions: [],
      events: [],
      summary: { totalFunctions: 0, readFunctions: 0, writeFunctions: 0, adminFunctions: 0, riskLevel: 'low', overview: 'ok' },
      metadata: { model: 'gpt-4', processingTimeMs: 100, estimatedCostUsd: 0, abiSize: 0 },
    });
    expect(output.contract.registryLabel).toBe('Compound Comptroller');
    expect(output.contract.registryProtocol).toBe('Compound');
    expect(output.contract.registryCategory).toBe('lending');
  });
});
