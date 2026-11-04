/**
 * On-chain facts about a freshly launched token, gathered with two JSON-RPC
 * batches plus two (paced) Etherscan calls. New tokens are usually unverified,
 * so permissions come from scanning the runtime bytecode for function
 * selectors (PUSH4 operands in the dispatcher) instead of from an ABI.
 */

import { decodeFunctionResult, encodeFunctionData, erc20Abi, parseAbi, toFunctionSelector } from 'viem';
import { rpcBatch, type EvmChain } from '../utils/evmRpc.js';
import { fetchContractCreation, fetchContractSource } from '../services/dataSources/etherscan.js';

/** EIP-1967 implementation slot: bytes32(uint256(keccak256('eip1967.proxy.implementation')) - 1). */
const EIP1967_IMPL_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const ownerAbi = parseAbi(['function owner() view returns (address)']);
/**
 * Uniswap v4 (and v4-based launchpads like Bankr) identify pools by a 32-byte
 * id; the tokens sit in the chain's singleton PoolManager.
 */
const V4_POOL_MANAGER: Partial<Record<EvmChain, string>> = {
  ethereum: '0x000000000004444c5dc75cb358380d2e3de08a90',
  base: '0x498581ff718922c3f8e6a244956af099b2652b2b',
  arbitrum: '0x360e68faccca8ca495c1b759fd9eee466db9fb32',
  bsc: '0x28e2ea090877bf75740558f6bfb36a5ffee9e9df',
};
const DEAD = new Set(['0x0000000000000000000000000000000000000000', '0x000000000000000000000000000000000000dead']);

const SIGNATURES = {
  mint: ['mint(address,uint256)', 'mint(uint256)', 'mintTo(address,uint256)'],
  blacklist: [
    'blacklist(address)', 'addToBlacklist(address)', 'addBlacklist(address)', 'setBlacklist(address,bool)',
    'blacklistAddress(address,bool)', 'setBot(address,bool)', 'setBots(address[],bool)', 'blockBots(address[])',
  ],
  pause: ['pause()', 'setPaused(bool)'],
  feeSetter: [
    'setFee(uint256)', 'setFees(uint256,uint256)', 'setTaxes(uint256,uint256)', 'setBuyTax(uint256)',
    'setSellTax(uint256)', 'updateFees(uint256,uint256)', 'setTaxFee(uint256)', 'setBuyFee(uint256)', 'setSellFee(uint256)',
  ],
  maxTxSetter: ['setMaxTxAmount(uint256)', 'setMaxWalletSize(uint256)', 'setMaxWallet(uint256)', 'setMaxTx(uint256)'],
} as const;

type Capability = keyof typeof SIGNATURES;

const SELECTORS: Record<Capability, string[]> = Object.fromEntries(
  Object.entries(SIGNATURES).map(([k, sigs]) => [k, sigs.map((s) => toFunctionSelector(`function ${s}`).slice(2))]),
) as Record<Capability, string[]>;

export interface TokenFacts {
  name?: string;
  symbol?: string;
  decimals?: number;
  /** Decimal string — bigint doesn't survive JSON. */
  totalSupply?: string;
  /** Owner address, or null when the contract has no owner() function. */
  owner: string | null;
  ownerRenounced: boolean;
  isProxy: boolean;
  /** null = Etherscan couldn't say (rate limit, unsupported chain). */
  verified: boolean | null;
  capabilities: Record<Capability, boolean>;
  creator?: string;
  creatorHoldingPct?: number;
  /**
   * Share of total supply held by the launch pool (v4: the PoolManager).
   * Works on every chain, unlike creator lookup (Etherscan's free plan has no
   * contract-creation data on Base). Low = most supply is held off-pool.
   */
  supplyInPoolPct?: number;
}

/** Exported for tests: which capability selectors appear as PUSH4 operands. */
export function scanCapabilities(bytecode: string): Record<Capability, boolean> {
  const code = bytecode.toLowerCase();
  const out = {} as Record<Capability, boolean>;
  for (const [cap, sels] of Object.entries(SELECTORS) as [Capability, string[]][]) {
    out[cap] = sels.some((sel) => code.includes(`63${sel}`));
  }
  return out;
}

function call(to: string, data: string) {
  return { method: 'eth_call', params: [{ to, data }, 'latest'] };
}

function decode<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

function pctOf(part: bigint, total: bigint): number {
  return Number((part * 10_000n) / total) / 100;
}

function balanceCall(token: string, holder: string) {
  return call(token, encodeFunctionData({ abi: erc20Abi, functionName: 'balanceOf', args: [holder as `0x${string}`] }));
}

function decodeBalance(hex: string | null | undefined): bigint | undefined {
  return hex && hex !== '0x'
    ? decode(() => decodeFunctionResult({ abi: erc20Abi, functionName: 'balanceOf', data: hex as `0x${string}` }))
    : undefined;
}

/** Pool address (or the v4 PoolManager for 32-byte pool ids) that holds the launch's liquidity. */
function liquidityHolder(chain: EvmChain, poolAddress: string | undefined): string | undefined {
  if (!poolAddress) return undefined;
  if (/^0x[a-f0-9]{40}$/i.test(poolAddress)) return poolAddress;
  if (/^0x[a-f0-9]{64}$/i.test(poolAddress)) return V4_POOL_MANAGER[chain];
  return undefined;
}

export async function getTokenFacts(chain: EvmChain, token: string, poolAddress?: string): Promise<TokenFacts | null> {
  const [code, nameHex, symbolHex, decimalsHex, supplyHex, ownerHex, implSlot] = (await rpcBatch(chain, [
    { method: 'eth_getCode', params: [token, 'latest'] },
    call(token, encodeFunctionData({ abi: erc20Abi, functionName: 'name' })),
    call(token, encodeFunctionData({ abi: erc20Abi, functionName: 'symbol' })),
    call(token, encodeFunctionData({ abi: erc20Abi, functionName: 'decimals' })),
    call(token, encodeFunctionData({ abi: erc20Abi, functionName: 'totalSupply' })),
    call(token, encodeFunctionData({ abi: ownerAbi, functionName: 'owner' })),
    { method: 'eth_getStorageAt', params: [token, EIP1967_IMPL_SLOT, 'latest'] },
  ])) as (string | null)[];

  if (!code || code === '0x') return null; // not a contract (or RPC failed)

  const implementation = implSlot && /^0x0*$/.test(implSlot) === false ? `0x${implSlot.slice(-40)}` : null;
  let scanned = code;
  if (implementation) {
    const [implCode] = (await rpcBatch(chain, [{ method: 'eth_getCode', params: [implementation, 'latest'] }])) as (string | null)[];
    if (implCode && implCode !== '0x') scanned = code + implCode;
  }

  const owner = ownerHex && ownerHex !== '0x'
    ? decode(() => (decodeFunctionResult({ abi: ownerAbi, functionName: 'owner', data: ownerHex as `0x${string}` }) as string).toLowerCase()) ?? null
    : null;
  const totalSupply = supplyHex && supplyHex !== '0x'
    ? decode(() => decodeFunctionResult({ abi: erc20Abi, functionName: 'totalSupply', data: supplyHex as `0x${string}` }))
    : undefined;

  const [source, creation] = await Promise.all([fetchContractSource(token, chain), fetchContractCreation(token, chain)]);
  const creator = creation?.creatorAddress?.toLowerCase() ?? undefined;

  let creatorHoldingPct: number | undefined;
  let supplyInPoolPct: number | undefined;
  const holder = liquidityHolder(chain, poolAddress);
  if (totalSupply && totalSupply > 0n && (creator || holder)) {
    const holders = [creator, holder].filter((h): h is string => !!h);
    const balances = (await rpcBatch(chain, holders.map((h) => balanceCall(token, h)))) as (string | null)[];
    const byHolder = new Map(holders.map((h, i) => [h, decodeBalance(balances[i])]));
    const c = creator ? byHolder.get(creator) : undefined;
    const p = holder ? byHolder.get(holder) : undefined;
    if (c !== undefined) creatorHoldingPct = pctOf(c, totalSupply);
    // A v4 PoolManager can hold the token for several pools; cap at 100%.
    if (p !== undefined) supplyInPoolPct = Math.min(100, pctOf(p, totalSupply));
  }

  return {
    name: nameHex ? decode(() => decodeFunctionResult({ abi: erc20Abi, functionName: 'name', data: nameHex as `0x${string}` })) : undefined,
    symbol: symbolHex ? decode(() => decodeFunctionResult({ abi: erc20Abi, functionName: 'symbol', data: symbolHex as `0x${string}` })) : undefined,
    decimals: decimalsHex ? decode(() => decodeFunctionResult({ abi: erc20Abi, functionName: 'decimals', data: decimalsHex as `0x${string}` })) : undefined,
    totalSupply: totalSupply?.toString(),
    owner,
    ownerRenounced: owner !== null && DEAD.has(owner),
    isProxy: !!implementation || !!source?.isProxy,
    verified: source ? source.isVerified : null,
    capabilities: scanCapabilities(scanned),
    creator,
    creatorHoldingPct,
    supplyInPoolPct,
  };
}
