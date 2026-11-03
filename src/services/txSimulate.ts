/**
 * EVM pre-sign transaction simulation — POST /v1/tx-simulate.
 *
 * Runs 1-5 transactions through `eth_simulateV1` with `traceTransfers` (free on
 * public RPCs; `debug_traceCall` is not), then reports what would happen to the
 * sender: reverts, net asset changes, approvals granted, and sanctions/scam
 * screening of every counterparty, rolled into proceed / caution / avoid.
 * Meant to sit in front of every transaction an agent signs, so it is
 * RPC-only: no LLM, three batched RPC requests.
 */

import { decodeAbiParameters, decodeFunctionData, erc20Abi, encodeFunctionData, decodeFunctionResult, formatUnits, toHex } from 'viem';
import { rpcUrl, rpcBatch, type EvmChain } from '../utils/evmRpc.js';
import { screenAddresses } from './addressCheck.js';
import { getRegistry } from '../registry/lookup.js';
import { txSimulateInput, txSimulateOutput, type TxSimulateOutput } from '../schemas/txSimulate.js';

const TOPIC = {
  transfer: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
  approval: '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925',
  approvalForAll: '0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31',
  transferSingle: '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62',
};
/** traceTransfers reports native ETH moves as Transfer logs from this pseudo-address. */
const NATIVE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const UNLIMITED = 2n ** 255n;

interface SimLog { address: string; topics: string[]; data: string }
interface SimCall { status: string; gasUsed?: string; returnData?: string; logs?: SimLog[]; error?: { message?: string; data?: string } }

const topicAddr = (t: string) => `0x${t.slice(-40)}`.toLowerCase();

/** Revert payload: `returnData` is an empty "0x" on revert; the reason is in `error.data`. */
const revertData = (c: SimCall | undefined) =>
  c?.returnData && c.returnData !== '0x' ? c.returnData : c?.error?.data;

/**
 * Intended counterparty from ERC-20/721 calldata, so a recipient is screened
 * even when the call reverts (USDC, for one, reverts transfers to sanctioned
 * addresses — the screening should still say why).
 */
function intendedCounterparty(data: string): { address: string; role: 'recipient' | 'spender' } | null {
  try {
    const { functionName, args } = decodeFunctionData({ abi: erc20Abi, data: data as `0x${string}` });
    if (functionName === 'transfer') return { address: String(args[0]).toLowerCase(), role: 'recipient' };
    if (functionName === 'transferFrom') return { address: String(args[1]).toLowerCase(), role: 'recipient' };
    if (functionName === 'approve') return { address: String(args[0]).toLowerCase(), role: 'spender' };
  } catch {
    // not ERC-20 calldata
  }
  return null;
}

/** Exported for tests. */
export function decodeRevert(data: string | undefined): string {
  if (!data || data === '0x') return 'reverted without a reason';
  try {
    if (data.startsWith('0x08c379a0')) {
      return decodeAbiParameters([{ type: 'string' }], `0x${data.slice(10)}`)[0] as string;
    }
    if (data.startsWith('0x4e487b71')) {
      const code = decodeAbiParameters([{ type: 'uint256' }], `0x${data.slice(10)}`)[0] as bigint;
      return `panic 0x${code.toString(16)}`;
    }
  } catch {
    // fall through
  }
  return `custom error ${data.slice(0, 10)}`;
}

async function simulate(chain: EvmChain, from: string, txs: Array<{ to: string; data: string; value: string; gas?: string }>) {
  const calls = txs.map((t) => ({
    from,
    to: t.to,
    data: t.data,
    value: t.value.startsWith('0x') ? t.value : toHex(BigInt(t.value)),
    ...(t.gas ? { gas: t.gas } : {}),
  }));
  const res = await fetch(rpcUrl(chain), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'eth_simulateV1',
      params: [{ blockStateCalls: [{ calls }], traceTransfers: true, validation: false }, 'latest'],
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Simulation RPC error: ${res.status}`);
  const json = (await res.json()) as { result?: Array<{ calls: SimCall[] }>; error?: { message?: string } };
  return json;
}

export async function simulateEvmTxWithCost(
  input: unknown,
): Promise<{ output: TxSimulateOutput; estimatedCostUsd: number }> {
  const v = txSimulateInput.parse(input);
  const chain = v.chain as EvmChain;
  const from = v.from.toLowerCase();
  const registry = getRegistry();
  const label = (a: string) => registry.lookup(a, chain)?.name ?? registry.lookup(a)?.name;
  const reasons: string[] = [];

  const sim = await simulate(chain, from, v.transactions);

  // Whole-request failure (e.g. sender can't cover `value`): nothing executed.
  if (!sim.result) {
    const msg = sim.error?.message ?? 'simulation failed';
    const output = txSimulateOutput.parse({
      chain, from, verdict: 'avoid',
      reasons: [`Simulation rejected: ${msg}`],
      calls: v.transactions.map((t, index) => ({ index, to: t.to, toLabel: label(t.to), success: false, revertReason: msg })),
      assetChanges: [], approvals: [], counterparties: [],
      note: 'The node refused to execute this sequence, most often because the sender cannot cover the ETH value being sent.',
      relatedServices: [],
    });
    return { output, estimatedCostUsd: 0 };
  }

  const simCalls = sim.result[0]?.calls ?? [];
  const calls = v.transactions.map((t, index) => {
    const c = simCalls[index];
    const success = c?.status === '0x1';
    if (!success) reasons.push(`Transaction ${index + 1} reverts: ${decodeRevert(revertData(c))}`);
    return {
      index,
      to: t.to,
      toLabel: label(t.to),
      success,
      gasUsed: c?.gasUsed ? Number.parseInt(c.gasUsed, 16) : undefined,
      revertReason: success ? undefined : decodeRevert(revertData(c)),
    };
  });

  // ── Logs → asset deltas, approvals, recipients ──
  const deltas = new Map<string, { standard: 'native' | 'erc20' | 'erc721' | 'erc1155'; delta: bigint; tokenId?: string }>();
  const bump = (key: string, standard: 'native' | 'erc20' | 'erc721' | 'erc1155', amt: bigint, tokenId?: string) => {
    const prev = deltas.get(key) ?? { standard, delta: 0n, tokenId };
    deltas.set(key, { ...prev, delta: prev.delta + amt });
  };
  const approvals: TxSimulateOutput['approvals'] = [];
  const recipients = new Set<string>();
  let assetsOut = 0;
  let assetsIn = 0;
  let nftOut = false;

  for (const log of simCalls.flatMap((c) => c.logs ?? [])) {
    const token = log.address.toLowerCase();
    const [t0, t1, t2, t3] = log.topics;
    if (t0 === TOPIC.transfer && t1 && t2) {
      const src = topicAddr(t1);
      const dst = topicAddr(t2);
      const isNft = log.topics.length === 4;
      const standard = token === NATIVE ? 'native' : isNft ? 'erc721' : 'erc20';
      const amount = isNft ? 1n : BigInt(log.data === '0x' ? 0 : log.data);
      const key = isNft ? `${token}:${BigInt(t3).toString()}` : token;
      if (src === from) {
        bump(key, standard, -amount, isNft ? BigInt(t3).toString() : undefined);
        recipients.add(dst);
        assetsOut++;
        if (isNft) nftOut = true;
      }
      if (dst === from) {
        bump(key, standard, amount, isNft ? BigInt(t3).toString() : undefined);
        assetsIn++;
      }
    } else if (t0 === TOPIC.transferSingle && log.topics.length === 4) {
      const src = topicAddr(log.topics[2]);
      const dst = topicAddr(log.topics[3]);
      const [id, value] = decodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], log.data as `0x${string}`);
      const key = `${token}:${id.toString()}`;
      if (src === from) { bump(key, 'erc1155', -value, id.toString()); recipients.add(dst); assetsOut++; nftOut = true; }
      if (dst === from) { bump(key, 'erc1155', value, id.toString()); assetsIn++; }
    } else if (t0 === TOPIC.approval && t1 && t2 && topicAddr(t1) === from) {
      const amount = BigInt(log.data === '0x' ? 0 : log.data);
      if (amount > 0n) approvals.push({ token, spender: topicAddr(t2), amount: amount.toString(), unlimited: amount >= UNLIMITED, kind: 'erc20' });
    } else if (t0 === TOPIC.approvalForAll && t1 && t2 && topicAddr(t1) === from) {
      const approved = BigInt(log.data === '0x' ? 0 : log.data) !== 0n;
      if (approved) approvals.push({ token, spender: topicAddr(t2), unlimited: true, kind: 'operator' });
    }
  }

  // ── Token metadata (one batch) ──
  const tokens = [...new Set([...deltas.keys()].map((k) => k.split(':')[0]).filter((t) => t !== NATIVE))];
  const approvalTokens = approvals.map((a) => a.token).filter((t) => !tokens.includes(t));
  const metaTokens = [...tokens, ...new Set(approvalTokens)];
  const meta = new Map<string, { symbol?: string; decimals?: number }>();
  if (metaTokens.length) {
    const res = await rpcBatch(chain, metaTokens.flatMap((t) => [
      { method: 'eth_call', params: [{ to: t, data: encodeFunctionData({ abi: erc20Abi, functionName: 'symbol' }) }, 'latest'] },
      { method: 'eth_call', params: [{ to: t, data: encodeFunctionData({ abi: erc20Abi, functionName: 'decimals' }) }, 'latest'] },
    ])).catch(() => [] as unknown[]);
    metaTokens.forEach((t, i) => {
      const sym = res[i * 2] as string | null | undefined;
      const dec = res[i * 2 + 1] as string | null | undefined;
      const safe = <T,>(f: () => T) => { try { return f(); } catch { return undefined; } };
      meta.set(t, {
        symbol: sym && sym !== '0x' ? safe(() => decodeFunctionResult({ abi: erc20Abi, functionName: 'symbol', data: sym as `0x${string}` })) : undefined,
        decimals: dec && dec !== '0x' ? safe(() => Number(decodeFunctionResult({ abi: erc20Abi, functionName: 'decimals', data: dec as `0x${string}` }))) : undefined,
      });
    });
  }

  const assetChanges: TxSimulateOutput['assetChanges'] = [...deltas]
    .filter(([, d]) => d.delta !== 0n)
    .map(([key, d]) => {
      const token = key.split(':')[0];
      const m = d.standard === 'native' ? { symbol: 'ETH', decimals: 18 } : meta.get(token) ?? {};
      const decimals = d.standard === 'erc20' || d.standard === 'native' ? m.decimals : undefined;
      return {
        token: d.standard === 'native' ? 'native' : token,
        symbol: m.symbol,
        decimals,
        standard: d.standard,
        delta: d.delta.toString(),
        deltaFormatted: decimals !== undefined ? formatUnits(d.delta, decimals) : undefined,
        tokenId: d.tokenId,
      };
    });
  for (const a of approvals) {
    a.symbol = meta.get(a.token)?.symbol;
    a.spenderLabel = label(a.spender);
  }

  // ── Native balance: simulation skips balance validation, so check it here ──
  const valueSent = v.transactions.reduce((sum, t) => sum + BigInt(t.value), 0n);
  const [balHex] = await rpcBatch(chain, [{ method: 'eth_getBalance', params: [from, 'latest'] }]).catch(() => [null]);
  const nativeBalance = typeof balHex === 'string' ? BigInt(balHex) : null;
  const insufficientValue = nativeBalance !== null && valueSent > nativeBalance;
  if (insufficientValue) {
    reasons.push(`Sender holds ${formatUnits(nativeBalance as bigint, 18)} ETH but the transactions send ${formatUnits(valueSent, 18)} ETH, so this will fail on-chain`);
  }
  const noGas = nativeBalance === 0n && !insufficientValue;

  // ── Counterparty screening ──
  const roles = new Map<string, 'to' | 'recipient' | 'spender'>();
  for (const t of v.transactions) roles.set(t.to.toLowerCase(), 'to');
  for (const t of v.transactions) {
    const ic = intendedCounterparty(t.data);
    if (ic && ic.address !== from && !roles.has(ic.address)) roles.set(ic.address, ic.role);
  }
  for (const r of recipients) if (r !== from && !roles.has(r)) roles.set(r, 'recipient');
  for (const a of approvals) roles.set(a.spender, 'spender');
  const screened = await screenAddresses([...roles.keys()].map((address) => ({ address, chain })));
  const counterparties: TxSimulateOutput['counterparties'] = screened.map((s) => ({
    address: s.address,
    role: roles.get(s.address.toLowerCase()) as 'to' | 'recipient' | 'spender',
    verdict: s.verdict,
    label: s.knownEntity?.name,
    isContract: s.isContract,
  }));
  const byAddr = new Map(counterparties.map((c) => [c.address.toLowerCase(), c]));

  // ── Verdict (first match wins) ──
  let verdict: TxSimulateOutput['verdict'] = 'proceed';
  const anyRevert = calls.some((c) => !c.success);
  const blocked = counterparties.filter((c) => c.verdict === 'block');
  const approvalToEoa = approvals.filter((a) => byAddr.get(a.spender)?.isContract === false);
  const unknownRecipientsOnly = assetsOut > 0 && assetsIn === 0
    && [...recipients].every((r) => byAddr.get(r)?.isContract === false && !byAddr.get(r)?.label);

  for (const b of blocked) reasons.push(`${b.role} ${b.address} is on a sanctions or scam list`);
  for (const a of approvalToEoa) reasons.push(`Grants ${a.kind === 'operator' ? 'operator rights' : 'a token approval'} to a plain wallet (${a.spender}), a common drainer pattern`);

  if (anyRevert || blocked.length || approvalToEoa.length || insufficientValue) {
    verdict = 'avoid';
  } else {
    const unlimitedUnknown = approvals.filter((a) => a.unlimited && !a.spenderLabel);
    for (const a of unlimitedUnknown) reasons.push(`Unlimited ${a.kind === 'operator' ? 'operator approval' : 'approval'} to an unlabeled contract (${a.spender})`);
    if (nftOut) reasons.push('NFTs leave the wallet');
    const cautionParties = counterparties.filter((c) => c.verdict === 'caution');
    for (const c of cautionParties) reasons.push(`${c.role} ${c.address} needs caution (new or high-risk address)`);
    if (unknownRecipientsOnly) reasons.push('Assets go to an unlabeled wallet and nothing comes back');
    if (noGas) reasons.push('Sender has no ETH to pay gas; the transaction cannot be broadcast from this wallet as-is');
    if (unlimitedUnknown.length || nftOut || cautionParties.length || unknownRecipientsOnly || noGas) verdict = 'caution';
  }
  if (verdict === 'proceed') reasons.push('Executes successfully; no risky approvals or flagged counterparties');

  const received = assetChanges.find((a) => a.standard === 'erc20' && BigInt(a.delta) > 0n);
  const output = txSimulateOutput.parse({
    chain,
    from,
    verdict,
    reasons,
    calls,
    assetChanges,
    approvals,
    counterparties,
    note: 'Simulated against the latest block without gas-balance validation; state can change before you broadcast.',
    relatedServices: [
      {
        endpoint: '/v1/approval-scan',
        description: 'See which spenders already hold approvals on this wallet',
        suggestedInput: { address: from, chain },
      },
      ...(received
        ? [{
            endpoint: '/v1/trade-check',
            description: `Pre-trade risk check on the token this transaction gives you${received.symbol ? ` (${received.symbol})` : ''}`,
            suggestedInput: { address: received.token, chain },
          }]
        : []),
      {
        endpoint: '/v1/address-check',
        description: 'Screen more counterparties against sanctions and scam lists',
        suggestedInput: { addresses: counterparties.slice(0, 5).map((c) => ({ address: c.address, chain })) },
      },
    ],
  });
  return { output, estimatedCostUsd: 0 };
}
