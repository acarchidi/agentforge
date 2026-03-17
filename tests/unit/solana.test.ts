import { describe, it, expect } from 'vitest';
import { isValidSolanaAddress, isSolanaAddress, isEvmAddress } from '../../src/utils/addressValidation.js';

describe('Solana Address Validation', () => {
  // Valid Solana addresses (real mainnet addresses)
  const VALID_SOLANA_ADDRESSES = [
    'So11111111111111111111111111111111111111112', // Wrapped SOL
    '11111111111111111111111111111111',            // System Program (32 chars)
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
    'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // Bonk
    '7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj', // Lido stSOL
    'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',   // Token Program
    'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',  // Associated Token Program
  ];

  // Invalid Solana addresses
  const INVALID_SOLANA_ADDRESSES = [
    '',
    '0x1234567890abcdef1234567890abcdef12345678',    // EVM address
    'abc',                                            // Too short
    'So11111111111111111111111111111111111111112O',    // Contains 'O' (invalid base58)
    'So11111111111111111111111111111111111111112I',    // Contains 'I'
    'So1111111111111111111111111111111111111111l',     // Contains 'l'
    '0',                                               // Way too short
    'So111111111111111111111111111111111111111111111111111', // Way too long
  ];

  describe('isValidSolanaAddress', () => {
    it('returns true for valid Solana addresses', () => {
      for (const addr of VALID_SOLANA_ADDRESSES) {
        expect(isValidSolanaAddress(addr), `should be valid: ${addr}`).toBe(true);
      }
    });

    it('returns false for invalid Solana addresses', () => {
      for (const addr of INVALID_SOLANA_ADDRESSES) {
        expect(isValidSolanaAddress(addr), `should be invalid: ${addr}`).toBe(false);
      }
    });

    it('returns false for EVM addresses', () => {
      expect(isValidSolanaAddress('0xdAC17F958D2ee523a2206206994597C13D831ec7')).toBe(false);
      expect(isValidSolanaAddress('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')).toBe(false);
    });
  });

  describe('isSolanaAddress', () => {
    it('returns true for Solana-style addresses', () => {
      expect(isSolanaAddress('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')).toBe(true);
    });

    it('returns false for EVM-style addresses', () => {
      expect(isSolanaAddress('0xdAC17F958D2ee523a2206206994597C13D831ec7')).toBe(false);
    });
  });

  describe('isEvmAddress', () => {
    it('returns true for EVM addresses', () => {
      expect(isEvmAddress('0xdAC17F958D2ee523a2206206994597C13D831ec7')).toBe(true);
      expect(isEvmAddress('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')).toBe(true);
    });

    it('returns false for Solana addresses', () => {
      expect(isEvmAddress('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')).toBe(false);
    });
  });
});

describe('Solana Data Source', () => {
  // These are unit tests that don't hit real APIs
  // They test the data source module's structure and helper functions

  it('exports expected functions', async () => {
    const mod = await import('../../src/services/dataSources/solana.js');
    expect(typeof mod.fetchSolanaTokenAccounts).toBe('function');
    expect(typeof mod.fetchSolanaTransactions).toBe('function');
    expect(typeof mod.parseSplDelegates).toBe('function');
  });

  it('parseSplDelegates returns empty array for empty input', async () => {
    const { parseSplDelegates } = await import('../../src/services/dataSources/solana.js');
    const result = parseSplDelegates([]);
    expect(result).toEqual([]);
  });

  it('parseSplDelegates extracts delegate info from token account data', async () => {
    const { parseSplDelegates } = await import('../../src/services/dataSources/solana.js');

    // Mock Solana parsed token account data
    const mockAccounts = [
      {
        pubkey: 'TokenAccountAddr1111111111111111111111111',
        account: {
          data: {
            parsed: {
              info: {
                mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                owner: 'WalletAddr1111111111111111111111111111111',
                delegate: 'DelegateAddr1111111111111111111111111111',
                delegatedAmount: { uiAmount: 1000, decimals: 6, amount: '1000000000' },
                tokenAmount: { uiAmount: 5000, decimals: 6, amount: '5000000000' },
              },
              type: 'account',
            },
            program: 'spl-token',
          },
        },
      },
      {
        pubkey: 'TokenAccountAddr2222222222222222222222222',
        account: {
          data: {
            parsed: {
              info: {
                mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
                owner: 'WalletAddr1111111111111111111111111111111',
                // No delegate — should be excluded
                tokenAmount: { uiAmount: 100, decimals: 6, amount: '100000000' },
              },
              type: 'account',
            },
            program: 'spl-token',
          },
        },
      },
    ];

    const delegates = parseSplDelegates(mockAccounts);
    expect(delegates).toHaveLength(1);
    expect(delegates[0].mint).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    expect(delegates[0].delegate).toBe('DelegateAddr1111111111111111111111111111');
    expect(delegates[0].delegatedAmount).toBe('1000000000');
  });
});

// Set env vars for schema tests
process.env.PAY_TO_ADDRESS = '0x0000000000000000000000000000000000000000';
process.env.X402_NETWORK = 'base-sepolia';
process.env.X402_FACILITATOR_URL = 'https://x402.org/facilitator';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
process.env.ADMIN_TOKEN = 'test-admin-token-1234567890';
process.env.PRICE_TOKEN_INTEL = '$0.015';
process.env.PRICE_CODE_REVIEW = '$0.05';
process.env.PRICE_TOKEN_RESEARCH = '$0.04';
process.env.PRICE_CONTRACT_DOCS = '$0.02';
process.env.PRICE_CONTRACT_MONITOR = '$0.025';
process.env.PRICE_TOKEN_COMPARE = '$0.08';
process.env.PRICE_TX_DECODE = '$0.01';
process.env.PRICE_APPROVAL_SCAN = '$0.015';
process.env.PRICE_GAS = '$0.003';
process.env.PRICE_WALLET_SAFETY = '$0.035';
process.env.DATABASE_PATH = ':memory:';

describe('Solana Schema Validation', () => {
  it('approvalScanInput accepts solana chain', async () => {
    const { approvalScanInput } = await import('../../src/schemas/approvalScanner.js');
    // Solana address format should be accepted when chain is solana
    const result = approvalScanInput.safeParse({
      address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      chain: 'solana',
    });
    expect(result.success).toBe(true);
  });

  it('approvalScanInput still accepts EVM addresses for EVM chains', async () => {
    const { approvalScanInput } = await import('../../src/schemas/approvalScanner.js');
    const result = approvalScanInput.safeParse({
      address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      chain: 'ethereum',
    });
    expect(result.success).toBe(true);
  });

  it('approvalScanInput rejects invalid addresses', async () => {
    const { approvalScanInput } = await import('../../src/schemas/approvalScanner.js');
    const result = approvalScanInput.safeParse({
      address: 'invalid',
      chain: 'solana',
    });
    expect(result.success).toBe(false);
  });

  it('walletSafetyInput accepts solana chain', async () => {
    const { walletSafetyInput } = await import('../../src/schemas/walletSafety.js');
    const result = walletSafetyInput.safeParse({
      walletAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      chain: 'solana',
    });
    expect(result.success).toBe(true);
  });

  it('walletSafetyInput accepts solana target contract', async () => {
    const { walletSafetyInput } = await import('../../src/schemas/walletSafety.js');
    const result = walletSafetyInput.safeParse({
      walletAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      chain: 'solana',
      targetContract: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    });
    expect(result.success).toBe(true);
  });

  it('walletSafetyInput rejects Solana address for EVM chain', async () => {
    const { walletSafetyInput } = await import('../../src/schemas/walletSafety.js');
    const result = walletSafetyInput.safeParse({
      walletAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      chain: 'ethereum',
    });
    expect(result.success).toBe(false);
  });

  it('walletSafetyInput rejects EVM address for solana chain', async () => {
    const { walletSafetyInput } = await import('../../src/schemas/walletSafety.js');
    const result = walletSafetyInput.safeParse({
      walletAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      chain: 'solana',
    });
    expect(result.success).toBe(false);
  });
});
