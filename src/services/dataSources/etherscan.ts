/**
 * Etherscan v2 data source — unified across EVM chains.
 * Free tier: 5 calls/sec. Provides contract verification, ABI, source code, creation info.
 */

import { config } from '../../config.js';
import { SimpleCache } from '../../utils/cache.js';

const sourceCache = new SimpleCache<EtherscanSource>(3600); // 1 hour
const creationCache = new SimpleCache<EtherscanCreation>(3600); // 1 hour

const CHAIN_ID_MAP: Record<string, number> = {
  ethereum: 1,
  base: 8453,
  polygon: 137,
  arbitrum: 42161,
  optimism: 10,
  avalanche: 43114,
};

export interface EtherscanSource {
  isVerified: boolean;
  contractName: string | null;
  compilerVersion: string | null;
  optimizationUsed: boolean | null;
  sourceCode: string | null;
  abi: string | null; // JSON string of ABI array
  implementationAddress: string | null;
  isProxy: boolean;
}

export interface EtherscanCreation {
  creationTxHash: string | null;
  creatorAddress: string | null;
}

async function etherscanFetch(
  chainId: number,
  module: string,
  action: string,
  params: Record<string, string>,
): Promise<unknown> {
  const apiKey = config.ETHERSCAN_API_KEY;
  const searchParams = new URLSearchParams({
    chainid: String(chainId),
    module,
    action,
    ...params,
    ...(apiKey ? { apikey: apiKey } : {}),
  });

  const res = await fetch(`https://api.etherscan.io/v2/api?${searchParams.toString()}`, {
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) throw new Error(`Etherscan API error: ${res.status}`);
  const data = (await res.json()) as { status: string; message: string; result: unknown };

  if (data.status === '0' && data.message === 'NOTOK') {
    throw new Error(`Etherscan error: ${data.result}`);
  }

  return data.result;
}

/** Get contract source code and verification status */
export async function fetchContractSource(
  address: string,
  chain: string,
): Promise<EtherscanSource | null> {
  const chainId = CHAIN_ID_MAP[chain];
  if (!chainId) return null;

  const cacheKey = `src:${chainId}:${address}`;
  const cached = sourceCache.get(cacheKey);
  if (cached) return cached;

  try {
    const result = await etherscanFetch(chainId, 'contract', 'getsourcecode', {
      address,
    });

    const entries = result as Array<Record<string, unknown>>;
    if (!Array.isArray(entries) || entries.length === 0) return null;

    const entry = entries[0];
    const contractName = (entry.ContractName as string) || null;
    const isVerified = !!contractName && contractName !== '';
    const implementation = (entry.Implementation as string) || null;

    const source: EtherscanSource = {
      isVerified,
      contractName: isVerified ? contractName : null,
      compilerVersion: isVerified ? ((entry.CompilerVersion as string) || null) : null,
      optimizationUsed: isVerified
        ? (entry.OptimizationUsed as string) === '1'
        : null,
      sourceCode: isVerified ? ((entry.SourceCode as string) || null) : null,
      abi: isVerified && entry.ABI !== 'Contract source code not verified'
        ? (entry.ABI as string) || null
        : null,
      implementationAddress: implementation || null,
      isProxy: !!implementation,
    };

    sourceCache.set(cacheKey, source);
    return source;
  } catch {
    return null;
  }
}

/** Get contract creation transaction and creator address */
export async function fetchContractCreation(
  address: string,
  chain: string,
): Promise<EtherscanCreation | null> {
  const chainId = CHAIN_ID_MAP[chain];
  if (!chainId) return null;

  const cacheKey = `create:${chainId}:${address}`;
  const cached = creationCache.get(cacheKey);
  if (cached) return cached;

  try {
    const result = await etherscanFetch(chainId, 'contract', 'getcontractcreation', {
      contractaddresses: address,
    });

    const entries = result as Array<Record<string, unknown>>;
    if (!Array.isArray(entries) || entries.length === 0) return null;

    const entry = entries[0];
    const creation: EtherscanCreation = {
      creationTxHash: (entry.txHash as string) || null,
      creatorAddress: (entry.contractCreator as string) || null,
    };

    creationCache.set(cacheKey, creation);
    return creation;
  } catch {
    return null;
  }
}

/** Fetch recent transactions for a contract */
export interface EtherscanTransaction {
  hash: string;
  from: string;
  to: string;
  functionName: string | null;
  timeStamp: string;
  value: string;
}

export async function fetchTransactionList(
  address: string,
  chain: string,
  lookbackHours: number,
): Promise<EtherscanTransaction[]> {
  const chainId = CHAIN_ID_MAP[chain];
  if (!chainId) return [];

  try {
    const result = await etherscanFetch(chainId, 'account', 'txlist', {
      address,
      startblock: '0',
      endblock: '99999999',
      page: '1',
      offset: '200',
      sort: 'desc',
    });

    const entries = result as Array<Record<string, unknown>>;
    if (!Array.isArray(entries)) return [];

    const cutoff = Math.floor(Date.now() / 1000) - lookbackHours * 3600;

    return entries
      .filter((e) => Number(e.timeStamp) >= cutoff)
      .map((e) => ({
        hash: (e.hash as string) ?? '',
        from: (e.from as string) ?? '',
        to: (e.to as string) ?? '',
        functionName: (e.functionName as string) || null,
        timeStamp: (e.timeStamp as string) ?? '0',
        value: (e.value as string) ?? '0',
      }));
  } catch {
    return [];
  }
}

/** Fetch top token holders */
export interface TokenHolder {
  address: string;
  balance: string;
  percentage: number;
  isContract: boolean;
}

export async function fetchTokenHolderList(
  contractAddress: string,
  chain: string,
): Promise<TokenHolder[]> {
  const chainId = CHAIN_ID_MAP[chain];
  if (!chainId) return [];

  try {
    const result = await etherscanFetch(chainId, 'token', 'tokenholderlist', {
      contractaddress: contractAddress,
      page: '1',
      offset: '20',
    });

    const entries = result as Array<Record<string, unknown>>;
    if (!Array.isArray(entries)) return [];

    // Calculate total from the entries we have (rough approximation)
    let totalBalance = 0;
    for (const e of entries) {
      totalBalance += Number(e.TokenHolderQuantity ?? 0);
    }

    return entries.map((e) => {
      const balance = Number(e.TokenHolderQuantity ?? 0);
      return {
        address: (e.TokenHolderAddress as string) ?? '',
        balance: String(e.TokenHolderQuantity ?? '0'),
        percentage: totalBalance > 0 ? (balance / totalBalance) * 100 : 0,
        isContract: false, // Etherscan doesn't return this directly
      };
    });
  } catch {
    return [];
  }
}

/** Parse ABI JSON string into structured entries */
export interface AbiEntry {
  type: string;
  name?: string;
  inputs?: Array<{ name: string; type: string; indexed?: boolean }>;
  outputs?: Array<{ name: string; type: string }>;
  stateMutability?: string;
}

export function parseAbi(abiJson: string): AbiEntry[] {
  try {
    const parsed = JSON.parse(abiJson) as AbiEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
