/**
 * Minimal EVM JSON-RPC client over public endpoints.
 *
 * Batch-first: one HTTP request carries every call for a token or an address
 * list, which keeps us inside public-endpoint rate limits. Override any chain's
 * endpoint with EVM_RPC_URL_<CHAIN> (e.g. EVM_RPC_URL_BASE) when a keyed
 * provider is available.
 */

import { CHAIN_INFO, type EvmChain } from './chains.js';

export type { EvmChain };

export function rpcUrl(chain: EvmChain): string {
  return process.env[`EVM_RPC_URL_${chain.toUpperCase()}`] || CHAIN_INFO[chain].rpc;
}

export interface RpcCall {
  method: string;
  params: unknown[];
}

/** One result per call, in order; a failed call yields `null` rather than throwing. */
export async function rpcBatch(chain: EvmChain, calls: RpcCall[], timeoutMs = 10_000): Promise<(unknown | null)[]> {
  if (calls.length === 0) return [];
  const body = calls.map((c, i) => ({ jsonrpc: '2.0', id: i, method: c.method, params: c.params }));
  const res = await fetch(rpcUrl(chain), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`RPC ${chain} error: ${res.status}`);
  const json = (await res.json()) as Array<{ id: number; result?: unknown; error?: unknown }> | { error?: unknown };
  if (!Array.isArray(json)) throw new Error(`RPC ${chain} rejected batch`);
  const out: (unknown | null)[] = calls.map(() => null);
  for (const r of json) {
    if (typeof r.id === 'number' && r.id < out.length && r.error === undefined) out[r.id] = r.result ?? null;
  }
  return out;
}
