/**
 * Watch checkers. RPC-only (no LLM), and batched: every contract-admin and
 * lending-health watch on the same chain shares ONE JSON-RPC batch request
 * per scheduler run, so cost grows with chains, not watches.
 */

import { encodeFunctionData, parseAbi } from 'viem';
import { rpcBatch, type EvmChain, type RpcCall } from '../utils/evmRpc.js';
import { AAVE_V3_POOL, positionFrom } from '../services/lendingHealth.js';
import { getTokenRiskMetricsWithCost } from '../services/tokenRiskMetrics/index.js';
import type { WatchType } from '../schemas/watch.js';

export interface WatchForCheck {
  id: string;
  type: WatchType;
  chain: string;
  target: string;
  params: { threshold?: number };
  lastState: Record<string, unknown> | null;
}

export interface WatchEvent {
  event: 'change' | 'threshold';
  summary: string;
  previous: unknown;
  current: unknown;
}

export interface CheckResult {
  id: string;
  ok: boolean;
  state: Record<string, unknown> | null;
  events: WatchEvent[];
}

const IMPL_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const ADMIN_SLOT = '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103';
/** Legacy ZeppelinOS proxy slots (USDC's FiatTokenProxy and other pre-EIP-1967 proxies). */
const ZOS_IMPL_SLOT = '0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3';
const ZOS_ADMIN_SLOT = '0x10d6a54a4754c8869d6886b5f5d7fbfa5b4522237ea5c60d11bc4e7a1ff9390b';
const OWNER = '0x8da5cb5b';
const PAUSED = '0x5c975abb';
const poolAbi = parseAbi(['function getUserAccountData(address user) view returns (uint256,uint256,uint256,uint256,uint256,uint256)']);

const word = (v: unknown) => (typeof v === 'string' && /^0x[0-9a-f]{64}$/i.test(v) ? v.toLowerCase() : null);
const addrFromWord = (v: unknown) => {
  const w = word(v);
  return w ? `0x${w.slice(26)}` : null;
};
const short = (a: unknown) => (typeof a === 'string' && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : String(a));

const CONTRACT_FIELDS = ['owner', 'implementation', 'admin', 'paused'] as const;

function contractAdminCalls(target: string): RpcCall[] {
  return [
    { method: 'eth_call', params: [{ to: target, data: OWNER }, 'latest'] },
    { method: 'eth_getStorageAt', params: [target, IMPL_SLOT, 'latest'] },
    { method: 'eth_getStorageAt', params: [target, ADMIN_SLOT, 'latest'] },
    { method: 'eth_call', params: [{ to: target, data: PAUSED }, 'latest'] },
    { method: 'eth_getStorageAt', params: [target, ZOS_IMPL_SLOT, 'latest'] },
    { method: 'eth_getStorageAt', params: [target, ZOS_ADMIN_SLOT, 'latest'] },
  ];
}

const ZERO = '0x0000000000000000000000000000000000000000';
/** EIP-1967 slot if set, else the legacy ZeppelinOS slot. */
const firstSet = (...vals: Array<string | null>) => vals.find((v) => v && v !== ZERO) ?? vals[0] ?? null;

/** Exported for tests. */
export function contractAdminState(results: (unknown | null)[]): Record<string, unknown> | null {
  // Storage reads always answer on a healthy node; both null means the RPC failed.
  if (results[1] === null && results[2] === null) return null;
  const paused = word(results[3]);
  return {
    owner: addrFromWord(results[0]),
    implementation: firstSet(addrFromWord(results[1]), addrFromWord(results[4])),
    admin: firstSet(addrFromWord(results[2]), addrFromWord(results[5])),
    paused: paused === null ? null : BigInt(paused) !== 0n,
  };
}

/** Exported for tests. */
export function contractAdminEvents(prev: Record<string, unknown> | null, cur: Record<string, unknown>): WatchEvent[] {
  if (!prev) return [];
  const events: WatchEvent[] = [];
  for (const f of CONTRACT_FIELDS) {
    if (prev[f] === cur[f]) continue;
    const label = f === 'paused' ? (cur[f] ? 'Contract was paused' : 'Contract was unpaused') : `${f[0].toUpperCase()}${f.slice(1)} changed ${short(prev[f])} → ${short(cur[f])}`;
    events.push({ event: 'change', summary: label, previous: { [f]: prev[f] }, current: { [f]: cur[f] } });
  }
  return events;
}

const STATUS_RANK: Record<string, number> = { no_debt: 0, safe: 1, watch: 2, danger: 3, critical: 4, liquidatable: 5 };

function lendingState(chain: string, data: unknown): Record<string, unknown> | null {
  if (typeof data !== 'string') return null;
  const p = positionFrom(chain, data);
  return p
    ? { healthFactor: p.healthFactor, status: p.status, collateralUsd: p.collateralUsd, debtUsd: p.debtUsd }
    : { healthFactor: null, status: 'no_debt', collateralUsd: 0, debtUsd: 0 };
}

/** Exported for tests. */
export function lendingEvents(prev: Record<string, unknown> | null, cur: Record<string, unknown>, threshold?: number): WatchEvent[] {
  if (!prev) return [];
  const events: WatchEvent[] = [];
  if (prev.status !== cur.status) {
    const worse = (STATUS_RANK[String(cur.status)] ?? 0) > (STATUS_RANK[String(prev.status)] ?? 0);
    events.push({
      event: 'change',
      summary: `Aave position ${worse ? 'worsened' : 'improved'}: ${prev.status} → ${cur.status} (health factor ${cur.healthFactor ?? 'n/a'})`,
      previous: prev,
      current: cur,
    });
  }
  const hfPrev = typeof prev.healthFactor === 'number' ? prev.healthFactor : Infinity;
  const hfCur = typeof cur.healthFactor === 'number' ? cur.healthFactor : Infinity;
  if (threshold !== undefined && (hfPrev >= threshold) !== (hfCur >= threshold)) {
    events.push({
      event: 'threshold',
      summary: `Health factor ${hfCur < threshold ? 'fell below' : 'recovered above'} ${threshold} (now ${cur.healthFactor ?? 'n/a'})`,
      previous: prev,
      current: cur,
    });
  }
  return events;
}

/** Exported for tests. */
export function tokenRiskEvents(prev: Record<string, unknown> | null, cur: Record<string, unknown>, threshold = 50): WatchEvent[] {
  if (!prev) return [];
  const events: WatchEvent[] = [];
  const a = Number(prev.score);
  const b = Number(cur.score);
  if ((a >= threshold) !== (b >= threshold)) {
    events.push({ event: 'threshold', summary: `Risk score ${b >= threshold ? 'rose above' : 'fell below'} ${threshold}: ${a} → ${b}`, previous: prev, current: cur });
  }
  const before = new Set((prev.flags as string[] | undefined) ?? []);
  const added = ((cur.flags as string[] | undefined) ?? []).filter((f) => !before.has(f));
  if (added.length) events.push({ event: 'change', summary: `New risk flag${added.length > 1 ? 's' : ''}: ${added.join('; ')}`, previous: prev, current: cur });
  return events;
}

async function checkTokenRisk(w: WatchForCheck): Promise<CheckResult> {
  try {
    const { output } = await getTokenRiskMetricsWithCost({ address: w.target, chain: w.chain as never });
    const state = { score: output.overallRisk.score, level: output.overallRisk.level, flags: output.overallRisk.flags };
    return { id: w.id, ok: true, state, events: tokenRiskEvents(w.lastState, state, w.params.threshold) };
  } catch {
    return { id: w.id, ok: false, state: w.lastState, events: [] };
  }
}

/** Public RPCs cap batch size; 80 calls per request stays under every limit we use. */
const MAX_BATCH = 80;

async function chunkedBatch(chain: EvmChain, calls: RpcCall[]): Promise<(unknown | null)[]> {
  const chunks: RpcCall[][] = [];
  for (let i = 0; i < calls.length; i += MAX_BATCH) chunks.push(calls.slice(i, i + MAX_BATCH));
  const parts = await Promise.all(chunks.map((c) => rpcBatch(chain, c, 15_000).catch(() => c.map(() => null))));
  return parts.flat();
}

/** Check every watch, batching RPC calls per chain. Never throws. */
export async function runChecks(watches: WatchForCheck[]): Promise<CheckResult[]> {
  const results = new Map<string, CheckResult>();
  const rpcWatches = new Map<string, WatchForCheck[]>();
  for (const w of watches) {
    if (w.type === 'token-risk') continue;
    rpcWatches.set(w.chain, [...(rpcWatches.get(w.chain) ?? []), w]);
  }

  await Promise.all([
    ...[...rpcWatches].map(async ([chain, ws]) => {
      const calls: RpcCall[] = [];
      const spans: Array<[WatchForCheck, number, number]> = [];
      for (const w of ws) {
        const start = calls.length;
        if (w.type === 'contract-admin') calls.push(...contractAdminCalls(w.target));
        else calls.push({
          method: 'eth_call',
          params: [{ to: AAVE_V3_POOL[chain as keyof typeof AAVE_V3_POOL], data: encodeFunctionData({ abi: poolAbi, functionName: 'getUserAccountData', args: [w.target as `0x${string}`] }) }, 'latest'],
        });
        spans.push([w, start, calls.length]);
      }
      const out = await chunkedBatch(chain as EvmChain, calls);
      for (const [w, s, e] of spans) {
        const slice = out.slice(s, e);
        const state = w.type === 'contract-admin' ? contractAdminState(slice) : lendingState(chain, slice[0]);
        if (!state) {
          results.set(w.id, { id: w.id, ok: false, state: w.lastState, events: [] });
          continue;
        }
        const events = w.type === 'contract-admin'
          ? contractAdminEvents(w.lastState, state)
          : lendingEvents(w.lastState, state, w.params.threshold);
        results.set(w.id, { id: w.id, ok: true, state, events });
      }
    }),
    // token-risk is daily and Etherscan-paced; run a few at a time.
    (async () => {
      const ws = watches.filter((w) => w.type === 'token-risk');
      for (let i = 0; i < ws.length; i += 4) {
        for (const r of await Promise.all(ws.slice(i, i + 4).map(checkTokenRisk))) results.set(r.id, r);
      }
    })(),
  ]);

  return watches.map((w) => results.get(w.id) ?? { id: w.id, ok: false, state: w.lastState, events: [] });
}

/** How often each type is checked (minutes). The cron runs every 30 minutes. */
export const CHECK_EVERY_MIN: Record<WatchType, number> = { 'contract-admin': 30, 'lending-health': 30, 'token-risk': 1440 };
