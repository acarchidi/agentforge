/**
 * EVM chains the security endpoints serve, in one place.
 *
 * Adding a chain: it needs a public RPC that answers JSON-RPC batches, and
 * Etherscan v2 must cover its chain id (token risk uses verified source). Set
 * `simulate` only when the RPC answers `eth_simulateV1` with traceTransfers —
 * Avalanche's public RPCs don't, so it is left out of tx-simulate.
 * Override any RPC with EVM_RPC_URL_<CHAIN> (e.g. EVM_RPC_URL_BSC).
 */

export const EVM_CHAINS = [
  'ethereum', 'base', 'arbitrum', 'optimism', 'polygon',
  'bsc', 'avalanche', 'linea', 'unichain', 'sonic',
] as const;
export type EvmChain = (typeof EVM_CHAINS)[number];

/** Chains whose public RPC supports eth_simulateV1 (tx-simulate, preflight). */
export const SIMULATE_CHAINS = [
  'ethereum', 'base', 'arbitrum', 'optimism', 'polygon',
  'bsc', 'linea', 'unichain', 'sonic',
] as const satisfies readonly EvmChain[];

export interface ChainInfo {
  id: number;
  name: string;
  rpc: string;
  nativeSymbol: string;
  /** Circle USDC (Binance-Peg USDC on BSC). */
  usdc: string;
  dexscreener: string;
  geckoterminal: string;
  coingecko: string;
}

export const CHAIN_INFO: Record<EvmChain, ChainInfo> = {
  ethereum: { id: 1, name: 'Ethereum', rpc: 'https://ethereum-rpc.publicnode.com', nativeSymbol: 'ETH', usdc: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', dexscreener: 'ethereum', geckoterminal: 'eth', coingecko: 'ethereum' },
  base: { id: 8453, name: 'Base', rpc: 'https://mainnet.base.org', nativeSymbol: 'ETH', usdc: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', dexscreener: 'base', geckoterminal: 'base', coingecko: 'base' },
  arbitrum: { id: 42161, name: 'Arbitrum', rpc: 'https://arb1.arbitrum.io/rpc', nativeSymbol: 'ETH', usdc: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', dexscreener: 'arbitrum', geckoterminal: 'arbitrum', coingecko: 'arbitrum-one' },
  optimism: { id: 10, name: 'Optimism', rpc: 'https://mainnet.optimism.io', nativeSymbol: 'ETH', usdc: '0x0b2c639c533813f4aa9d7837caf62653d097ff85', dexscreener: 'optimism', geckoterminal: 'optimism', coingecko: 'optimistic-ethereum' },
  polygon: { id: 137, name: 'Polygon', rpc: 'https://polygon-bor-rpc.publicnode.com', nativeSymbol: 'POL', usdc: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', dexscreener: 'polygon', geckoterminal: 'polygon_pos', coingecko: 'polygon-pos' },
  bsc: { id: 56, name: 'BNB Chain', rpc: 'https://bsc-rpc.publicnode.com', nativeSymbol: 'BNB', usdc: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', dexscreener: 'bsc', geckoterminal: 'bsc', coingecko: 'binance-smart-chain' },
  avalanche: { id: 43114, name: 'Avalanche', rpc: 'https://avalanche-c-chain-rpc.publicnode.com', nativeSymbol: 'AVAX', usdc: '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e', dexscreener: 'avalanche', geckoterminal: 'avax', coingecko: 'avalanche' },
  linea: { id: 59144, name: 'Linea', rpc: 'https://linea-rpc.publicnode.com', nativeSymbol: 'ETH', usdc: '0x176211869ca2b568f2a7d4ee941e073a821ee1ff', dexscreener: 'linea', geckoterminal: 'linea', coingecko: 'linea' },
  unichain: { id: 130, name: 'Unichain', rpc: 'https://unichain-rpc.publicnode.com', nativeSymbol: 'ETH', usdc: '0x078d782b760474a361dda0af3839290b0ef57ad6', dexscreener: 'unichain', geckoterminal: 'unichain', coingecko: 'unichain' },
  sonic: { id: 146, name: 'Sonic', rpc: 'https://sonic-rpc.publicnode.com', nativeSymbol: 'S', usdc: '0x29219dd400f2bf60e5a23d13be72b486d4038894', dexscreener: 'sonic', geckoterminal: 'sonic', coingecko: 'sonic' },
};

export const CHAIN_BY_ID: Record<number, EvmChain> = Object.fromEntries(
  EVM_CHAINS.map((c) => [CHAIN_INFO[c].id, c]),
) as Record<number, EvmChain>;

/** Chain → numeric chain id (Etherscan v2 `chainid`). */
export const CHAIN_IDS: Record<EvmChain, number> = Object.fromEntries(
  EVM_CHAINS.map((c) => [c, CHAIN_INFO[c].id]),
) as Record<EvmChain, number>;
