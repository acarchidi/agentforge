import { describe, it, expect } from 'vitest';
import {
  contractDocsInput,
  contractDocsOutput,
} from '../../src/schemas/contractDocs.js';

describe('Contract Docs Schema Validation', () => {
  // ── Input schema ──────────────────────────────────────────────────

  it('accepts valid input with defaults', () => {
    const result = contractDocsInput.parse({
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    });
    expect(result.chain).toBe('ethereum');
    expect(result.focusFunctions).toBeUndefined();
  });

  it('accepts all valid chains', () => {
    for (const chain of [
      'ethereum', 'base', 'polygon', 'arbitrum', 'optimism', 'avalanche',
    ] as const) {
      const result = contractDocsInput.parse({ address: '0xabc', chain });
      expect(result.chain).toBe(chain);
    }
  });

  it('accepts focusFunctions array', () => {
    const result = contractDocsInput.parse({
      address: '0xabc',
      focusFunctions: ['transfer', 'approve', 'mint'],
    });
    expect(result.focusFunctions).toEqual(['transfer', 'approve', 'mint']);
  });

  it('rejects empty address', () => {
    expect(() => contractDocsInput.parse({ address: '' })).toThrow();
  });

  it('rejects invalid chain', () => {
    expect(() =>
      contractDocsInput.parse({ address: '0xabc', chain: 'solana' }),
    ).toThrow();
  });

  // ── Output schema ─────────────────────────────────────────────────

  it('validates minimal output for unverified contract', () => {
    const output = contractDocsOutput.parse({
      contract: {
        address: '0xabc',
        chain: 'ethereum',
        name: null,
        compilerVersion: null,
        isVerified: false,
        isProxy: false,
        implementationAddress: null,
      },
      functions: [],
      events: [],
      summary: {
        totalFunctions: 0,
        readFunctions: 0,
        writeFunctions: 0,
        adminFunctions: 0,
        riskLevel: 'high',
        overview: 'Contract is not verified.',
      },
      metadata: {
        model: 'none',
        processingTimeMs: 100,
        estimatedCostUsd: 0,
        abiSize: 0,
      },
    });
    expect(output.contract.isVerified).toBe(false);
    expect(output.functions).toHaveLength(0);
    expect(output.summary.riskLevel).toBe('high');
  });

  it('validates full output with functions and events', () => {
    const output = contractDocsOutput.parse({
      contract: {
        address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        chain: 'ethereum',
        name: 'FiatTokenV2_2',
        compilerVersion: 'v0.6.12+commit.27d51765',
        isVerified: true,
        isProxy: true,
        implementationAddress: '0x123',
      },
      functions: [
        {
          name: 'transfer',
          signature: 'transfer(address,uint256)',
          type: 'write',
          description: 'Transfer tokens to a recipient',
          parameters: [
            { name: 'to', type: 'address', description: 'Recipient address' },
            { name: 'value', type: 'uint256', description: 'Amount to transfer' },
          ],
          returns: [{ type: 'bool', description: 'Success status' }],
          riskFlags: ['can_transfer_funds'],
        },
        {
          name: 'balanceOf',
          signature: 'balanceOf(address)',
          type: 'read',
          description: 'Get balance of an address',
          parameters: [
            { name: 'account', type: 'address', description: 'Address to query' },
          ],
          returns: [{ type: 'uint256', description: 'Token balance' }],
          riskFlags: [],
        },
        {
          name: 'pause',
          signature: 'pause()',
          type: 'write',
          description: 'Pause all transfers',
          parameters: [],
          returns: [],
          riskFlags: ['owner_only', 'can_pause'],
        },
      ],
      events: [
        {
          name: 'Transfer',
          description: 'Emitted when tokens are transferred',
          parameters: [
            { name: 'from', type: 'address', indexed: true },
            { name: 'to', type: 'address', indexed: true },
            { name: 'value', type: 'uint256', indexed: false },
          ],
        },
      ],
      summary: {
        totalFunctions: 3,
        readFunctions: 1,
        writeFunctions: 2,
        adminFunctions: 1,
        riskLevel: 'medium',
        overview: 'ERC-20 token with pausable transfers and admin controls.',
      },
      metadata: {
        model: 'claude-sonnet-4-20250514',
        processingTimeMs: 2500,
        estimatedCostUsd: 0.008,
        abiSize: 45,
      },
    });
    expect(output.functions).toHaveLength(3);
    expect(output.events).toHaveLength(1);
    expect(output.contract.isProxy).toBe(true);
    expect(output.functions[0].riskFlags).toContain('can_transfer_funds');
    expect(output.functions[2].riskFlags).toContain('owner_only');
    expect(output.functions[2].riskFlags).toContain('can_pause');
  });

  it('accepts all valid risk flags', () => {
    const validFlags = [
      'owner_only', 'can_transfer_funds', 'can_modify_state',
      'can_pause', 'can_upgrade', 'can_mint', 'can_burn',
      'can_blacklist', 'self_destruct', 'delegatecall',
      'unchecked_external_call',
    ] as const;

    const output = contractDocsOutput.parse({
      contract: {
        address: '0xabc',
        chain: 'ethereum',
        name: 'Test',
        compilerVersion: '0.8.0',
        isVerified: true,
        isProxy: false,
        implementationAddress: null,
      },
      functions: [
        {
          name: 'dangerous',
          signature: 'dangerous()',
          type: 'write',
          description: 'A very dangerous function',
          parameters: [],
          returns: [],
          riskFlags: [...validFlags],
        },
      ],
      events: [],
      summary: {
        totalFunctions: 1,
        readFunctions: 0,
        writeFunctions: 1,
        adminFunctions: 1,
        riskLevel: 'high',
        overview: 'Highly dangerous contract.',
      },
      metadata: {
        model: 'test',
        processingTimeMs: 0,
        estimatedCostUsd: 0,
        abiSize: 1,
      },
    });
    expect(output.functions[0].riskFlags).toHaveLength(validFlags.length);
  });

  it('rejects invalid risk flag', () => {
    expect(() =>
      contractDocsOutput.parse({
        contract: {
          address: '0xabc',
          chain: 'ethereum',
          name: null,
          compilerVersion: null,
          isVerified: true,
          isProxy: false,
          implementationAddress: null,
        },
        functions: [
          {
            name: 'test',
            signature: 'test()',
            type: 'write',
            description: 'test',
            parameters: [],
            returns: [],
            riskFlags: ['invalid_flag'],
          },
        ],
        events: [],
        summary: {
          totalFunctions: 1,
          readFunctions: 0,
          writeFunctions: 1,
          adminFunctions: 0,
          riskLevel: 'low',
          overview: 'test',
        },
        metadata: {
          model: 'test',
          processingTimeMs: 0,
          estimatedCostUsd: 0,
          abiSize: 1,
        },
      }),
    ).toThrow();
  });

  it('rejects invalid function type', () => {
    expect(() =>
      contractDocsOutput.parse({
        contract: {
          address: '0xabc',
          chain: 'ethereum',
          name: null,
          compilerVersion: null,
          isVerified: true,
          isProxy: false,
          implementationAddress: null,
        },
        functions: [
          {
            name: 'test',
            signature: 'test()',
            type: 'constructor', // not read/write/payable
            description: 'test',
            parameters: [],
            returns: [],
            riskFlags: [],
          },
        ],
        events: [],
        summary: {
          totalFunctions: 1,
          readFunctions: 0,
          writeFunctions: 1,
          adminFunctions: 0,
          riskLevel: 'low',
          overview: 'test',
        },
        metadata: {
          model: 'test',
          processingTimeMs: 0,
          estimatedCostUsd: 0,
          abiSize: 1,
        },
      }),
    ).toThrow();
  });

  it('validates output with interactionPatterns', () => {
    const output = contractDocsOutput.parse({
      contract: {
        address: '0xabc',
        chain: 'ethereum',
        name: 'Token',
        compilerVersion: '0.8.0',
        isVerified: true,
        isProxy: false,
        implementationAddress: null,
      },
      functions: [],
      events: [],
      interactionPatterns: [
        {
          pattern: 'Transfer tokens',
          description: 'Send ERC-20 tokens to another address',
          functions: ['approve', 'transferFrom'],
          gasEstimate: '~60,000 gas',
        },
        {
          pattern: 'Check balance',
          description: 'Query token balance for an address',
          functions: ['balanceOf'],
          gasEstimate: null,
        },
      ],
      summary: {
        totalFunctions: 0,
        readFunctions: 0,
        writeFunctions: 0,
        adminFunctions: 0,
        riskLevel: 'low',
        overview: 'test',
      },
      metadata: { model: 'test', processingTimeMs: 0, estimatedCostUsd: 0, abiSize: 0 },
    });
    expect(output.interactionPatterns).toHaveLength(2);
    expect(output.interactionPatterns![0].gasEstimate).toBe('~60,000 gas');
    expect(output.interactionPatterns![1].gasEstimate).toBeNull();
  });

  it('validates output with securityPosture', () => {
    const output = contractDocsOutput.parse({
      contract: {
        address: '0xabc',
        chain: 'ethereum',
        name: 'Token',
        compilerVersion: '0.8.0',
        isVerified: true,
        isProxy: false,
        implementationAddress: null,
      },
      functions: [],
      events: [],
      securityPosture: {
        hasOwnerControls: true,
        isPausable: true,
        isUpgradeable: false,
        hasMintCapability: false,
        hasBlacklistCapability: true,
        usesExternalCalls: false,
        adminFunctionCount: 3,
        assessment: 'Contract has admin controls including pause and blacklist capabilities.',
      },
      summary: {
        totalFunctions: 0,
        readFunctions: 0,
        writeFunctions: 0,
        adminFunctions: 3,
        riskLevel: 'medium',
        overview: 'test',
      },
      metadata: { model: 'test', processingTimeMs: 0, estimatedCostUsd: 0, abiSize: 0 },
    });
    expect(output.securityPosture).toBeDefined();
    expect(output.securityPosture!.hasOwnerControls).toBe(true);
    expect(output.securityPosture!.isPausable).toBe(true);
    expect(output.securityPosture!.hasBlacklistCapability).toBe(true);
    expect(output.securityPosture!.adminFunctionCount).toBe(3);
  });

  it('accepts output with relatedServices', () => {
    const output = contractDocsOutput.parse({
      contract: { address: '0xabc', chain: 'ethereum', name: null, compilerVersion: null, isVerified: true, isProxy: false, implementationAddress: null },
      functions: [],
      events: [],
      summary: { totalFunctions: 0, readFunctions: 0, writeFunctions: 0, adminFunctions: 0, riskLevel: 'low', overview: 'test' },
      metadata: { model: 'test', processingTimeMs: 0, estimatedCostUsd: 0, abiSize: 0 },
      relatedServices: [
        { endpoint: '/v1/contract-monitor', description: 'Monitor activity', suggestedInput: { address: '0xabc', chain: 'ethereum' } },
      ],
    });
    expect(output.relatedServices).toHaveLength(1);
  });

  // ── proxyInfo schema ─────────────────────────────────────────────

  it('accepts output with proxyInfo for proxy contracts', () => {
    const output = contractDocsOutput.parse({
      contract: {
        address: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84',
        chain: 'ethereum',
        name: 'Lido',
        compilerVersion: '0.4.24',
        isVerified: true,
        isProxy: true,
        implementationAddress: '0x6ca84080381e43938476814be61b779a8bb6a600',
      },
      functions: [
        {
          name: 'submit',
          signature: 'submit(address)',
          type: 'payable',
          description: 'Submit ETH for staking',
          parameters: [{ name: '_referral', type: 'address', description: 'Referral address' }],
          returns: [{ type: 'uint256', description: 'Amount of stETH minted' }],
          riskFlags: ['can_transfer_funds'],
        },
      ],
      events: [],
      proxyInfo: {
        isProxy: true,
        proxyType: 'ERC-897',
        proxyAddress: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84',
        implementationAddress: '0x6ca84080381e43938476814be61b779a8bb6a600',
        governanceFramework: 'Aragon',
        note: 'Docs reflect implementation logic. Proxy is upgradeable via Aragon governance.',
      },
      summary: {
        totalFunctions: 1,
        readFunctions: 0,
        writeFunctions: 0,
        adminFunctions: 0,
        riskLevel: 'medium',
        overview: 'Lido liquid staking protocol.',
      },
      metadata: { model: 'test', processingTimeMs: 0, estimatedCostUsd: 0, abiSize: 30 },
    });
    expect(output.proxyInfo).toBeDefined();
    expect(output.proxyInfo!.isProxy).toBe(true);
    expect(output.proxyInfo!.proxyType).toBe('ERC-897');
    expect(output.proxyInfo!.governanceFramework).toBe('Aragon');
    expect(output.proxyInfo!.note).toContain('implementation logic');
  });

  it('accepts output without proxyInfo (non-proxy contracts)', () => {
    const output = contractDocsOutput.parse({
      contract: {
        address: '0xabc',
        chain: 'ethereum',
        name: 'Token',
        compilerVersion: '0.8.0',
        isVerified: true,
        isProxy: false,
        implementationAddress: null,
      },
      functions: [],
      events: [],
      summary: {
        totalFunctions: 0,
        readFunctions: 0,
        writeFunctions: 0,
        adminFunctions: 0,
        riskLevel: 'low',
        overview: 'Simple token.',
      },
      metadata: { model: 'test', processingTimeMs: 0, estimatedCostUsd: 0, abiSize: 5 },
    });
    expect(output.proxyInfo).toBeUndefined();
  });

  it('proxyInfo requires proxyAddress and implementationAddress', () => {
    expect(() =>
      contractDocsOutput.parse({
        contract: {
          address: '0xabc',
          chain: 'ethereum',
          name: null,
          compilerVersion: null,
          isVerified: true,
          isProxy: true,
          implementationAddress: '0x123',
        },
        functions: [],
        events: [],
        proxyInfo: {
          isProxy: true,
          // missing proxyAddress and implementationAddress
          note: 'test',
        },
        summary: {
          totalFunctions: 0,
          readFunctions: 0,
          writeFunctions: 0,
          adminFunctions: 0,
          riskLevel: 'low',
          overview: 'test',
        },
        metadata: { model: 'test', processingTimeMs: 0, estimatedCostUsd: 0, abiSize: 0 },
      }),
    ).toThrow();
  });

  it('proxyInfo optional fields are truly optional', () => {
    const output = contractDocsOutput.parse({
      contract: {
        address: '0xabc',
        chain: 'ethereum',
        name: null,
        compilerVersion: null,
        isVerified: true,
        isProxy: true,
        implementationAddress: '0x123',
      },
      functions: [],
      events: [],
      proxyInfo: {
        isProxy: true,
        proxyAddress: '0xabc',
        implementationAddress: '0x123',
        note: 'Docs reflect implementation. Proxy type unknown.',
      },
      summary: {
        totalFunctions: 0,
        readFunctions: 0,
        writeFunctions: 0,
        adminFunctions: 0,
        riskLevel: 'medium',
        overview: 'Proxy contract.',
      },
      metadata: { model: 'test', processingTimeMs: 0, estimatedCostUsd: 0, abiSize: 0 },
    });
    expect(output.proxyInfo!.proxyType).toBeUndefined();
    expect(output.proxyInfo!.governanceFramework).toBeUndefined();
  });

  it('rejects invalid risk level in summary', () => {
    expect(() =>
      contractDocsOutput.parse({
        contract: {
          address: '0xabc',
          chain: 'ethereum',
          name: null,
          compilerVersion: null,
          isVerified: true,
          isProxy: false,
          implementationAddress: null,
        },
        functions: [],
        events: [],
        summary: {
          totalFunctions: 0,
          readFunctions: 0,
          writeFunctions: 0,
          adminFunctions: 0,
          riskLevel: 'critical', // not low/medium/high
          overview: 'test',
        },
        metadata: {
          model: 'test',
          processingTimeMs: 0,
          estimatedCostUsd: 0,
          abiSize: 0,
        },
      }),
    ).toThrow();
  });
});
