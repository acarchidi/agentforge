/**
 * Transaction Decoder service.
 * Fetches a transaction from Etherscan, decodes function call using ABI,
 * extracts ERC-20 transfers, generates plain-English explanation via Claude.
 */

import { Interface } from 'ethers';
import { callClaude } from '../llm/anthropic.js';
import { cleanLlmJson } from '../utils/cleanJson.js';
import { SimpleCache } from '../utils/cache.js';
import { config } from '../config.js';
import {
  txDecoderInput,
  txDecoderOutput,
  type TxDecoderInput,
  type TxDecoderOutput,
} from '../schemas/txDecoder.js';
import { getRegistry } from '../registry/lookup.js';

const abiCache = new SimpleCache<string>(3600); // 1-hour cache for ABIs

const CHAIN_ID_MAP: Record<string, number> = {
  ethereum: 1,
  base: 8453,
  polygon: 137,
  arbitrum: 42161,
  optimism: 10,
  avalanche: 43114,
};

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

  const res = await fetch(
    `https://api.etherscan.io/v2/api?${searchParams.toString()}`,
    { signal: AbortSignal.timeout(10_000) },
  );
  if (!res.ok) throw new Error(`Etherscan API error: ${res.status}`);
  const data = (await res.json()) as {
    status: string;
    message: string;
    result: unknown;
  };
  return data.result;
}

async function fetchTx(
  chainId: number,
  txHash: string,
): Promise<Record<string, unknown> | null> {
  try {
    const result = await etherscanFetch(chainId, 'proxy', 'eth_getTransactionByHash', {
      txhash: txHash,
    });
    return result && typeof result === 'object' ? (result as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function fetchReceipt(
  chainId: number,
  txHash: string,
): Promise<Record<string, unknown> | null> {
  try {
    const result = await etherscanFetch(chainId, 'proxy', 'eth_getTransactionReceipt', {
      txhash: txHash,
    });
    return result && typeof result === 'object' ? (result as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function fetchAbi(
  chainId: number,
  address: string,
): Promise<string | null> {
  const cacheKey = `abi:${chainId}:${address}`;
  const cached = abiCache.get(cacheKey);
  if (cached) return cached;

  try {
    const result = await etherscanFetch(chainId, 'contract', 'getabi', {
      address,
    });
    if (typeof result === 'string' && result.startsWith('[')) {
      abiCache.set(cacheKey, result);
      return result;
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchTokenTransfers(
  chainId: number,
  txHash: string,
): Promise<Array<Record<string, unknown>>> {
  try {
    const result = await etherscanFetch(chainId, 'account', 'tokentx', {
      txhash: txHash,
      page: '1',
      offset: '100',
    });
    return Array.isArray(result) ? (result as Array<Record<string, unknown>>) : [];
  } catch {
    return [];
  }
}

function hexToDecimal(hex: string): string {
  try {
    return BigInt(hex).toString();
  } catch {
    return '0';
  }
}

export interface TxDecoderResult {
  output: TxDecoderOutput;
  estimatedCostUsd: number;
}

export async function decodeTransactionWithCost(
  input: TxDecoderInput,
): Promise<TxDecoderResult> {
  const validated = txDecoderInput.parse(input);
  const startTime = Date.now();
  const chainId = CHAIN_ID_MAP[validated.chain];

  // Fetch tx + receipt in parallel
  const [tx, receipt] = await Promise.all([
    fetchTx(chainId, validated.txHash),
    fetchReceipt(chainId, validated.txHash),
  ]);

  if (!tx) {
    throw new Error(`Transaction ${validated.txHash} not found on ${validated.chain}`);
  }

  const toAddress = (tx.to as string) ?? '';
  const registryEntry = toAddress ? getRegistry().lookup(toAddress, validated.chain) : null;
  const inputData = (tx.input as string) ?? '0x';
  const value = hexToDecimal((tx.value as string) ?? '0x0');
  const gasUsed = receipt ? hexToDecimal((receipt.gasUsed as string) ?? '0x0') : '0';
  const gasPrice = hexToDecimal((tx.gasPrice as string) ?? '0x0');
  const blockNumber = Number(BigInt((tx.blockNumber as string) ?? '0x0'));
  const status: 'success' | 'failed' =
    receipt && (receipt.status as string) === '0x1' ? 'success' : 'failed';

  // Fetch ABI + token transfers in parallel
  const [abiJson, tokenTxs] = await Promise.all([
    toAddress ? fetchAbi(chainId, toAddress) : Promise.resolve(null),
    fetchTokenTransfers(chainId, validated.txHash),
  ]);

  // Decode function call
  let decodedCall: TxDecoderOutput['decodedCall'] = null;
  let contractName: string | null = null;
  const contractVerified = !!abiJson;

  if (abiJson && inputData.length >= 10) {
    try {
      const iface = new Interface(abiJson);
      const decoded = iface.parseTransaction({ data: inputData });
      if (decoded) {
        contractName = registryEntry?.name ?? null;
        decodedCall = {
          functionName: decoded.name,
          functionSignature: decoded.signature,
          parameters: decoded.fragment.inputs.map((param, i) => ({
            name: param.name || `param${i}`,
            type: param.type,
            value: String(decoded.args[i]),
            decoded: null,
          })),
          contractName,
          contractVerified,
          registryLabel: registryEntry?.name,
          registryProtocol: registryEntry?.protocol,
        };
      }
    } catch {
      // ABI didn't match — fall back to method selector
      decodedCall = {
        functionName: null,
        functionSignature: inputData.slice(0, 10),
        parameters: [],
        contractName: registryEntry?.name ?? null,
        contractVerified,
        registryLabel: registryEntry?.name,
        registryProtocol: registryEntry?.protocol,
      };
    }
  } else if (inputData.length >= 10) {
    decodedCall = {
      functionName: null,
      functionSignature: inputData.slice(0, 10),
      parameters: [],
      contractName: registryEntry?.name ?? null,
      contractVerified: false,
      registryLabel: registryEntry?.name,
      registryProtocol: registryEntry?.protocol,
    };
  }

  // Map token transfers
  const tokenTransfers = tokenTxs.map((t) => ({
    token: (t.contractAddress as string) ?? '',
    from: (t.from as string) ?? '',
    to: (t.to as string) ?? '',
    amount: (t.value as string) ?? '0',
    symbol: (t.tokenSymbol as string) || null,
  }));

  // Build context for Claude explanation
  const txSummary = {
    hash: validated.txHash,
    chain: validated.chain,
    from: (tx.from as string) ?? '',
    to: toAddress,
    toLabel: registryEntry?.name ?? undefined,
    toProtocol: registryEntry?.protocol ?? undefined,
    value,
    status,
    decodedFunction: decodedCall?.functionName ?? decodedCall?.functionSignature ?? 'unknown',
    parameters: decodedCall?.parameters ?? [],
    tokenTransfers: tokenTransfers.map((t) => `${t.amount} ${t.symbol ?? t.token} from ${t.from} to ${t.to}`),
  };

  const { text: explanation, usage } = await callClaude({
    system:
      'You are a blockchain transaction analyst. Given transaction details, provide a clear, concise one-sentence explanation of what happened. Be specific about amounts and addresses when available. Return ONLY the explanation sentence, no JSON.',
    userMessage: JSON.stringify(txSummary),
    maxTokens: 200,
    temperature: 0.1,
  });

  // Get block timestamp (approximate from receipt or use current)
  let timestamp = new Date().toISOString();
  if (receipt && (receipt.blockNumber as string)) {
    try {
      const blockResult = await etherscanFetch(chainId, 'proxy', 'eth_getBlockByNumber', {
        tag: (receipt.blockNumber as string) ?? (tx.blockNumber as string),
        boolean: 'false',
      });
      if (blockResult && typeof blockResult === 'object') {
        const block = blockResult as Record<string, unknown>;
        if (block.timestamp) {
          timestamp = new Date(Number(BigInt(block.timestamp as string)) * 1000).toISOString();
        }
      }
    } catch {
      // Use current time as fallback
    }
  }

  const output = txDecoderOutput.parse({
    transaction: {
      hash: validated.txHash,
      from: (tx.from as string) ?? '',
      to: toAddress,
      value,
      valueUsd: null,
      gasUsed,
      gasPrice,
      gasCostUsd: null,
      timestamp,
      blockNumber,
      status,
    },
    decodedCall,
    explanation: explanation.trim(),
    tokenTransfers,
    relatedServices: [
      {
        endpoint: '/v1/contract-docs',
        description: 'Generate documentation for the target contract',
        suggestedInput: { address: toAddress, chain: validated.chain },
      },
      {
        endpoint: '/v1/contract-monitor',
        description: 'Monitor recent activity on the target contract',
        suggestedInput: { address: toAddress, chain: validated.chain },
      },
    ],
    metadata: {
      chain: validated.chain,
      processingTimeMs: Date.now() - startTime,
      estimatedCostUsd: usage.estimatedCostUsd,
    },
  });

  return { output, estimatedCostUsd: usage.estimatedCostUsd };
}
