/**
 * Multi-chain address validation utilities.
 *
 * Supports EVM (0x-prefixed hex) and Solana (base58) addresses.
 */

// Base58 alphabet used by Bitcoin/Solana (no 0, O, I, l)
const BASE58_REGEX = /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/;
const EVM_REGEX = /^0x[a-fA-F0-9]{40}$/;

/**
 * Check if a string is a valid Solana base58 address.
 * Solana public keys are 32-44 characters of base58.
 */
export function isValidSolanaAddress(address: string): boolean {
  if (!address || address.length < 32 || address.length > 44) return false;
  return BASE58_REGEX.test(address);
}

/**
 * Check if an address looks like a Solana address (base58, not 0x-prefixed).
 */
export function isSolanaAddress(address: string): boolean {
  return !address.startsWith('0x') && isValidSolanaAddress(address);
}

/**
 * Check if a string is a valid Solana transaction signature.
 * Signatures are 64-byte ed25519 signatures, base58-encoded to ~86-88 chars —
 * longer than the 32-44 char range used for addresses/public keys.
 */
export function isValidSolanaSignature(signature: string): boolean {
  if (!signature || signature.length < 80 || signature.length > 90) return false;
  return BASE58_REGEX.test(signature);
}

/**
 * Check if an address is a valid EVM address (0x + 40 hex chars).
 */
export function isEvmAddress(address: string): boolean {
  return EVM_REGEX.test(address);
}

/**
 * Validate an address for a specific chain.
 * Returns true if the address format matches the chain type.
 */
export function isValidAddressForChain(address: string, chain: string): boolean {
  if (chain === 'solana') {
    return isValidSolanaAddress(address);
  }
  return isEvmAddress(address);
}
