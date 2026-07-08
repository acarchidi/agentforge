/**
 * Helius Data Source
 *
 * Enhanced Transactions API (human-parsed tx events) and DAS (Digital
 * Asset Standard) getAsset for token/NFT metadata.
 */

import { config } from '../../config.js';

const HELIUS_API_BASE = 'https://api.helius.xyz';
const HELIUS_RPC_BASE = 'https://mainnet.helius-rpc.com';

// ── Types ──────────────────────────────────────────────────────────

export interface HeliusTokenTransfer {
  fromUserAccount: string;
  toUserAccount: string;
  mint: string;
  tokenAmount: number;
}

export interface HeliusNativeTransfer {
  fromUserAccount: string;
  toUserAccount: string;
  amount: number;
}

export interface HeliusAccountData {
  account: string;
  nativeBalanceChange: number;
}

export interface HeliusEnhancedTransaction {
  signature: string;
  type: string;
  source: string;
  fee: number;
  feePayer: string;
  timestamp: number;
  slot: number;
  transactionError: unknown | null;
  instructions: Array<{ programId: string; accounts: string[]; data: string }>;
  tokenTransfers: HeliusTokenTransfer[];
  nativeTransfers: HeliusNativeTransfer[];
  accountData: HeliusAccountData[];
}

export interface HeliusAsset {
  id: string;
  content?: {
    metadata?: { name?: string; symbol?: string };
  };
  token_info?: {
    symbol?: string;
    decimals?: number;
    token_program?: string;
  };
  mutable?: boolean;
  interface?: string;
}

// ── Enhanced Transactions ────────────────────────────────────────────

/**
 * Fetch parsed transaction events for a list of signatures via Helius
 * Enhanced Transactions API. Returns an empty array (not a throw) when
 * Helius has no parsed data for the given signature(s) — the caller is
 * expected to fall back to raw RPC decoding in that case.
 */
export async function fetchHeliusEnhancedTransactions(
  signatures: string[],
): Promise<HeliusEnhancedTransaction[]> {
  const res = await fetch(`${HELIUS_API_BASE}/v0/transactions?api-key=${config.HELIUS_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transactions: signatures }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`Helius Enhanced Transactions error: ${res.status}`);
  }

  const data = (await res.json()) as HeliusEnhancedTransaction[] | { error: string };
  if (!Array.isArray(data)) {
    throw new Error(`Helius Enhanced Transactions error: ${data.error ?? 'unknown'}`);
  }
  return data;
}

// ── DAS (getAsset) ────────────────────────────────────────────────

/**
 * Fetch DAS metadata for a mint (name, symbol, mutability, token standard).
 * Returns null on any error rather than throwing — DAS coverage for
 * long-tail tokens is incomplete, and callers should degrade gracefully.
 */
export async function fetchHeliusAsset(mint: string): Promise<HeliusAsset | null> {
  try {
    const res = await fetch(`${HELIUS_RPC_BASE}/?api-key=${config.HELIUS_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getAsset',
        params: { id: mint },
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) return null;

    const data = (await res.json()) as { result?: HeliusAsset; error?: unknown };
    return data.result ?? null;
  } catch {
    return null;
  }
}
