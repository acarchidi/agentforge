import { describe, it, expect } from 'vitest';
import {
  txDecoderInput,
  txDecoderOutput,
} from '../../src/schemas/txDecoder.js';

describe('Transaction Decoder Schema Validation', () => {
  // ── Input schema ──────────────────────────────────────────────────

  it('accepts valid tx hash with defaults', () => {
    const result = txDecoderInput.parse({
      txHash: '0x' + 'a'.repeat(64),
    });
    expect(result.chain).toBe('ethereum');
  });

  it('accepts valid tx hash with chain', () => {
    const result = txDecoderInput.parse({
      txHash: '0x' + 'b1c2d3'.padEnd(64, '0'),
      chain: 'base',
    });
    expect(result.chain).toBe('base');
  });

  it('accepts all valid chains', () => {
    for (const chain of [
      'ethereum', 'base', 'polygon', 'arbitrum', 'optimism', 'avalanche',
    ] as const) {
      const result = txDecoderInput.parse({
        txHash: '0x' + 'a'.repeat(64),
        chain,
      });
      expect(result.chain).toBe(chain);
    }
  });

  it('rejects tx hash missing 0x prefix', () => {
    expect(() =>
      txDecoderInput.parse({ txHash: 'a'.repeat(64) }),
    ).toThrow();
  });

  it('rejects tx hash with wrong length', () => {
    expect(() =>
      txDecoderInput.parse({ txHash: '0x' + 'a'.repeat(63) }),
    ).toThrow();
  });

  it('rejects tx hash with invalid characters', () => {
    expect(() =>
      txDecoderInput.parse({ txHash: '0x' + 'g'.repeat(64) }),
    ).toThrow();
  });

  it('rejects invalid chain', () => {
    expect(() =>
      txDecoderInput.parse({ txHash: '0x' + 'a'.repeat(64), chain: 'solana' }),
    ).toThrow();
  });

  // ── Output schema ─────────────────────────────────────────────────

  it('validates full output with decoded call', () => {
    const output = txDecoderOutput.parse({
      transaction: {
        hash: '0x' + 'a'.repeat(64),
        from: '0x' + '1'.repeat(40),
        to: '0x' + '2'.repeat(40),
        value: '0',
        valueUsd: null,
        gasUsed: '21000',
        gasPrice: '20000000000',
        gasCostUsd: null,
        timestamp: '2025-01-01T00:00:00.000Z',
        blockNumber: 12345678,
        status: 'success',
      },
      decodedCall: {
        functionName: 'transfer',
        functionSignature: 'transfer(address,uint256)',
        parameters: [
          { name: 'to', type: 'address', value: '0x' + '3'.repeat(40), decoded: null },
          { name: 'amount', type: 'uint256', value: '1000000', decoded: null },
        ],
        contractName: 'USDC',
        contractVerified: true,
      },
      explanation: 'Transferred 1 USDC to 0x333...333',
      tokenTransfers: [
        {
          token: '0x' + '4'.repeat(40),
          from: '0x' + '1'.repeat(40),
          to: '0x' + '3'.repeat(40),
          amount: '1000000',
          symbol: 'USDC',
        },
      ],
      metadata: {
        chain: 'ethereum',
        processingTimeMs: 1500,
        estimatedCostUsd: 0.001,
      },
    });
    expect(output.transaction.status).toBe('success');
    expect(output.decodedCall?.functionName).toBe('transfer');
    expect(output.tokenTransfers).toHaveLength(1);
    expect(output.explanation).toBeTruthy();
  });

  it('validates output with null decodedCall (unverified contract)', () => {
    const output = txDecoderOutput.parse({
      transaction: {
        hash: '0x' + 'a'.repeat(64),
        from: '0x' + '1'.repeat(40),
        to: '0x' + '2'.repeat(40),
        value: '1000000000000000000',
        valueUsd: null,
        gasUsed: '21000',
        gasPrice: '20000000000',
        gasCostUsd: null,
        timestamp: '2025-01-01T00:00:00.000Z',
        blockNumber: 12345678,
        status: 'success',
      },
      decodedCall: null,
      explanation: 'Sent 1 ETH to 0x222...222',
      tokenTransfers: [],
      metadata: {
        chain: 'ethereum',
        processingTimeMs: 800,
        estimatedCostUsd: 0.001,
      },
    });
    expect(output.decodedCall).toBeNull();
    expect(output.tokenTransfers).toHaveLength(0);
  });

  it('validates output with failed transaction status', () => {
    const output = txDecoderOutput.parse({
      transaction: {
        hash: '0x' + 'a'.repeat(64),
        from: '0x' + '1'.repeat(40),
        to: '0x' + '2'.repeat(40),
        value: '0',
        valueUsd: null,
        gasUsed: '21000',
        gasPrice: '20000000000',
        gasCostUsd: null,
        timestamp: '2025-01-01T00:00:00.000Z',
        blockNumber: 12345678,
        status: 'failed',
      },
      decodedCall: null,
      explanation: 'Transaction reverted.',
      tokenTransfers: [],
      metadata: { chain: 'ethereum', processingTimeMs: 500, estimatedCostUsd: 0.001 },
    });
    expect(output.transaction.status).toBe('failed');
  });

  it('accepts output with relatedServices', () => {
    const output = txDecoderOutput.parse({
      transaction: {
        hash: '0x' + 'a'.repeat(64),
        from: '0x' + '1'.repeat(40),
        to: '0x' + '2'.repeat(40),
        value: '0',
        valueUsd: null,
        gasUsed: '21000',
        gasPrice: '20000000000',
        gasCostUsd: null,
        timestamp: '2025-01-01T00:00:00.000Z',
        blockNumber: 12345678,
        status: 'success',
      },
      decodedCall: null,
      explanation: 'test',
      tokenTransfers: [],
      relatedServices: [
        { endpoint: '/v1/contract-docs', description: 'Generate docs', suggestedInput: { address: '0x123' } },
      ],
      metadata: { chain: 'ethereum', processingTimeMs: 0, estimatedCostUsd: 0 },
    });
    expect(output.relatedServices).toHaveLength(1);
  });
});
