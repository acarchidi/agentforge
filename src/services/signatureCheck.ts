/**
 * Signature check — POST /v1/signature-check.
 *
 * Most wallet drains now come from a signature, not a transaction: a gasless
 * ERC-20 permit, a Permit2 allowance, or a marketplace order that "sells"
 * assets for nothing. Transaction simulation never sees these, because nothing
 * is broadcast until the attacker uses the signature. This decodes EIP-712
 * typed data (or an x402 payment request) before the agent signs, says in one
 * sentence what signing would allow, screens every spender and recipient, and
 * returns proceed / caution / avoid. Deterministic: no LLM.
 */

import { decodeFunctionResult, encodeFunctionData, erc20Abi, formatUnits } from 'viem';
import { rpcBatch } from '../utils/evmRpc.js';
import { CHAIN_BY_ID, CHAIN_INFO, EVM_CHAINS, type EvmChain } from '../utils/chains.js';
import { screenAddresses } from './addressCheck.js';
import { getRegistry } from '../registry/lookup.js';
import {
  signatureCheckInput,
  signatureCheckOutput,
  type SignatureCheckOutput,
} from '../schemas/signatureCheck.js';

type Kind = SignatureCheckOutput['kind'];
type Verdict = SignatureCheckOutput['verdict'];
type Grant = SignatureCheckOutput['grants'][number];

const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const caip = (c: EvmChain) => `eip155:${CHAIN_INFO[c].id}`;
const NETWORK_NAME: Record<string, string> = {
  ...Object.fromEntries(EVM_CHAINS.map((c) => [caip(c), CHAIN_INFO[c].name])),
  'eip155:84532': 'Base Sepolia', [SOLANA]: 'Solana',
};
const CHAIN_BY_CAIP: Record<string, EvmChain | 'solana'> = {
  ...Object.fromEntries(EVM_CHAINS.map((c) => [caip(c), c])),
  [SOLANA]: 'solana',
};

/** Circle USDC per network (CAIP-2). Used to spot fake "USD Coin" domains and non-USDC x402 assets. */
const USDC: Record<string, string> = {
  ...Object.fromEntries(EVM_CHAINS.map((c) => [caip(c), CHAIN_INFO[c].usdc])),
  'eip155:84532': '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
  [SOLANA]: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
};
const PERMIT2 = '0x000000000022d473030f116ddee9f6b43ac78ba3';
const UNLIMITED = 2n ** 159n; // ≥ half of uint160 (Permit2's max) counts as unlimited; uint256 maxes are far above
const LONG_SECONDS = 30 * 24 * 3600;

const lc = (s: unknown) => String(s ?? '').toLowerCase();
const big = (v: unknown): bigint | null => {
  try {
    return v === undefined || v === null || v === '' ? null : BigInt(String(v));
  } catch {
    return null;
  }
};
const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const when = (secs: bigint | null): string | null => {
  if (secs === null || secs === 0n) return null;
  if (secs > 10_000_000_000n) return 'never';
  return new Date(Number(secs) * 1000).toISOString();
};

interface Analysis {
  kind: Kind;
  chain: EvmChain;
  grants: Grant[];
  /** Addresses to screen, with the role they play. */
  parties: Array<{ address: string; role: string }>;
  reasons: string[];
  avoid: boolean;
  caution: boolean;
  owner?: string;
  summary: (labels: Map<string, string>) => string;
}

/** Exported for tests: classify EIP-712 typed data without network calls. */
export function analyzeTypedData(
  td: { domain: Record<string, unknown>; primaryType: string; message: Record<string, unknown> },
  opts: { chain?: EvmChain; signer?: string; now?: number } = {},
): Analysis {
  const now = BigInt(Math.floor((opts.now ?? Date.now()) / 1000));
  const d = td.domain ?? {};
  const m = td.message ?? {};
  const chainId = Number(big(d.chainId) ?? 0n);
  const chain = CHAIN_BY_ID[chainId] ?? opts.chain ?? 'base';
  const verifying = lc(d.verifyingContract);
  const reasons: string[] = [];
  let avoid = false;
  let caution = false;

  if (opts.chain && CHAIN_BY_ID[chainId] && CHAIN_BY_ID[chainId] !== opts.chain) {
    reasons.push(`Signature is for chain ${chainId} (${CHAIN_BY_ID[chainId]}), not ${opts.chain}`);
    caution = true;
  }

  // A domain that claims to be USD Coin must be Circle's USDC contract on that chain.
  const claimedUsdc = /^usd ?coin$|^usdc$/i.test(String(d.name ?? ''));
  const realUsdc = USDC[`eip155:${chainId}`];
  if (claimedUsdc && realUsdc && verifying && verifying !== realUsdc) {
    reasons.push(`Domain claims to be "${d.name}" but ${short(verifying)} is not USDC on this chain — impersonation`);
    avoid = true;
  }

  const expiry = (secs: bigint | null, what: string) => {
    if (secs === null) return;
    if (secs > 10_000_000_000n) {
      reasons.push(`${what} never expires`);
      caution = true;
    } else if (secs - now > BigInt(LONG_SECONDS)) {
      reasons.push(`${what} lasts more than 30 days`);
      caution = true;
    } else if (secs < now) {
      reasons.push(`${what} has already expired`);
    }
  };

  const grants: Grant[] = [];
  const parties: Analysis['parties'] = [];
  const grant = (token: string, to: string, amount: bigint | null, unlimited: boolean, expires: bigint | null) => {
    grants.push({ token: lc(token), to: lc(to), amount: amount?.toString(), unlimited, expires: when(expires) });
    parties.push({ address: lc(to), role: 'spender' });
  };

  const pt = td.primaryType;
  const isPermit2 = verifying === PERMIT2 || /^permit2$/i.test(String(d.name ?? ''));
  let kind: Kind = 'unknown-typed-data';
  let owner: string | undefined;

  if (isPermit2 && /^Permit(Single|Batch)$/.test(pt)) {
    kind = 'permit2-allowance';
    const details = (pt === 'PermitBatch' ? (m.details as unknown[]) : [m.details]) as Array<Record<string, unknown>>;
    for (const det of details ?? []) {
      const amt = big(det.amount);
      grant(String(det.token), String(m.spender), amt, (amt ?? 0n) >= UNLIMITED, big(det.expiration));
      expiry(big(det.expiration), 'The Permit2 allowance');
    }
    expiry(big(m.sigDeadline), 'The signature');
  } else if (isPermit2 && /^Permit(Batch)?(Witness)?TransferFrom$/.test(pt)) {
    kind = 'permit2-transfer';
    const permitted = (Array.isArray(m.permitted) ? m.permitted : [m.permitted]) as Array<Record<string, unknown>>;
    for (const p of permitted) {
      const amt = big(p.amount);
      grant(String(p.token), String(m.spender), amt, (amt ?? 0n) >= UNLIMITED, big(m.deadline));
    }
    expiry(big(m.deadline), 'The transfer permission');
  } else if (pt === 'Permit' && 'spender' in m && 'value' in m) {
    kind = 'erc20-permit';
    owner = lc(m.owner);
    const amt = big(m.value);
    grant(verifying, String(m.spender), amt, (amt ?? 0n) >= UNLIMITED, big(m.deadline));
    expiry(big(m.deadline), 'The permit');
  } else if (pt === 'Permit' && 'allowed' in m) {
    kind = 'dai-permit';
    owner = lc(m.holder);
    const allowed = m.allowed === true || m.allowed === 'true';
    if (allowed) grant(verifying, String(m.spender), null, true, big(m.expiry));
    expiry(big(m.expiry), 'The permit');
  } else if (/^seaport$/i.test(String(d.name ?? '')) && Array.isArray(m.offer)) {
    kind = 'seaport-order';
    owner = lc(m.offerer);
    const offer = m.offer as Array<Record<string, unknown>>;
    const consideration = (m.consideration ?? []) as Array<Record<string, unknown>>;
    const toOfferer = consideration.filter((c) => lc(c.recipient) === owner && (big(c.startAmount) ?? 0n) > 0n);
    for (const c of consideration) {
      if (lc(c.recipient) !== owner) parties.push({ address: lc(c.recipient), role: 'order recipient' });
    }
    for (const o of offer) {
      grants.push({ token: lc(o.token), to: 'order filler', amount: big(o.startAmount)?.toString(), unlimited: false, expires: when(big(m.endTime)) });
    }
    if (offer.length > 0 && toOfferer.length === 0) {
      reasons.push('Marketplace order gives away your assets and pays you nothing in return — classic signature drainer');
      avoid = true;
    }
    expiry(big(m.endTime), 'The order');
  } else if (/^(Transfer|Receive)WithAuthorization$/.test(pt)) {
    kind = 'transfer-authorization';
    owner = lc(m.from);
    const amt = big(m.value);
    grants.push({ token: verifying, to: lc(m.to), amount: amt?.toString(), unlimited: false, expires: when(big(m.validBefore)) });
    parties.push({ address: lc(m.to), role: 'recipient' });
  } else {
    reasons.push(`Unrecognized typed data "${pt}" — cannot tell what it authorizes; only sign if you trust the requester`);
    caution = true;
    for (const [k, v] of Object.entries(m)) {
      if (typeof v === 'string' && /^0x[a-fA-F0-9]{40}$/.test(v) && /spender|operator|to|recipient|delegate|taker/i.test(k)) {
        parties.push({ address: lc(v), role: k });
      }
    }
  }

  if (owner && opts.signer && owner !== lc(opts.signer)) {
    reasons.push(`Signature is for wallet ${short(owner)}, not the signer ${short(opts.signer)}`);
    caution = true;
  }
  for (const g of grants) {
    if (g.unlimited && kind !== 'seaport-order') {
      reasons.push(`Grants an unlimited allowance to ${short(g.to)}`);
    }
  }

  const summary = (labels: Map<string, string>): string => {
    const who = (a: string) => labels.get(a) ? `${labels.get(a)} (${short(a)})` : short(a);
    const amt = (g: Grant) => (g.unlimited ? 'an unlimited amount of' : g.amountFormatted ?? g.amount ?? 'some');
    const tok = (g: Grant) => g.symbol ?? short(g.token);
    const g = grants[0];
    switch (kind) {
      case 'erc20-permit':
      case 'dai-permit':
      case 'permit2-allowance':
        return g ? `Lets ${who(g.to)} spend ${amt(g)} ${tok(g)} from this wallet${g.expires ? ` until ${g.expires === 'never' ? 'revoked' : g.expires.slice(0, 10)}` : ''}, without any further approval.` : 'Grants no allowance.';
      case 'permit2-transfer':
        return g ? `Lets ${who(g.to)} transfer ${amt(g)} ${tok(g)} out of this wallet once.` : 'Authorizes a Permit2 transfer.';
      case 'seaport-order':
        return `Lists ${grants.length} asset(s) for sale; you receive ${avoid ? 'nothing' : 'the consideration items addressed to you'}.`;
      case 'transfer-authorization':
        return g ? `Sends ${amt(g)} ${tok(g)} to ${who(g.to)} when submitted.` : 'Authorizes a token transfer.';
      default:
        return `Signs unrecognized "${pt}" data for ${d.name ?? 'an unnamed app'}.`;
    }
  };

  return { kind, chain, grants, parties, reasons, avoid, caution, owner, summary };
}

async function tokenMeta(chain: EvmChain, tokens: string[]): Promise<Map<string, { symbol?: string; decimals?: number }>> {
  const out = new Map<string, { symbol?: string; decimals?: number }>();
  const list = [...new Set(tokens.filter((t) => /^0x[a-f0-9]{40}$/.test(t)))];
  if (!list.length) return out;
  const res = await rpcBatch(chain, list.flatMap((t) => [
    { method: 'eth_call', params: [{ to: t, data: encodeFunctionData({ abi: erc20Abi, functionName: 'symbol' }) }, 'latest'] },
    { method: 'eth_call', params: [{ to: t, data: encodeFunctionData({ abi: erc20Abi, functionName: 'decimals' }) }, 'latest'] },
  ])).catch(() => [] as unknown[]);
  const safe = <T,>(f: () => T) => { try { return f(); } catch { return undefined; } };
  list.forEach((t, i) => {
    const s = res[i * 2] as string | null | undefined;
    const dd = res[i * 2 + 1] as string | null | undefined;
    out.set(t, {
      symbol: s && s !== '0x' ? safe(() => decodeFunctionResult({ abi: erc20Abi, functionName: 'symbol', data: s as `0x${string}` })) : undefined,
      decimals: dd && dd !== '0x' ? safe(() => Number(decodeFunctionResult({ abi: erc20Abi, functionName: 'decimals', data: dd as `0x${string}` }))) : undefined,
    });
  });
  return out;
}

function worst(a: Verdict, b: Verdict): Verdict {
  const rank = { proceed: 0, caution: 1, avoid: 2 } as const;
  return rank[a] >= rank[b] ? a : b;
}

async function checkTypedData(raw: unknown, signer: string | undefined, chain: EvmChain | undefined) {
  const td = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const a = analyzeTypedData(td as Parameters<typeof analyzeTypedData>[0], { chain, signer });

  const [screened, meta] = await Promise.all([
    a.parties.length ? screenAddresses(a.parties.map((p) => ({ address: p.address, chain: a.chain }))) : Promise.resolve([]),
    tokenMeta(a.chain, a.grants.map((g) => g.token)),
  ]);
  const registry = getRegistry();
  const labels = new Map<string, string>();
  const counterparties: SignatureCheckOutput['counterparties'] = screened.map((s, i) => {
    const label = s.knownEntity?.name ?? registry.lookup(s.address, a.chain)?.name;
    if (label) labels.set(s.address.toLowerCase(), label);
    return { address: s.address, role: a.parties[i].role, verdict: s.verdict, label, isContract: s.isContract };
  });
  for (const g of a.grants) {
    const m = meta.get(g.token);
    g.symbol = m?.symbol;
    g.toLabel = labels.get(g.to);
    if (g.amount && m?.decimals !== undefined && !g.unlimited) g.amountFormatted = formatUnits(BigInt(g.amount), m.decimals);
  }

  let verdict: Verdict = a.avoid ? 'avoid' : a.caution ? 'caution' : 'proceed';
  const reasons = [...a.reasons];
  for (const c of counterparties) {
    if (c.verdict === 'block') {
      reasons.push(`${c.role} ${c.address} is on a sanctions or scam list`);
      verdict = 'avoid';
    }
  }
  // Permissions granted to a plain wallet are the signature-drainer signature.
  const grantKinds: Kind[] = ['erc20-permit', 'dai-permit', 'permit2-allowance', 'permit2-transfer'];
  if (grantKinds.includes(a.kind)) {
    for (const g of a.grants) {
      const c = counterparties.find((x) => x.address.toLowerCase() === g.to);
      if (c?.isContract === false) {
        reasons.push(`Grants token permissions to a plain wallet (${g.to}), not a contract — the common signature-drainer pattern`);
        verdict = 'avoid';
      } else if (g.unlimited && !g.toLabel) {
        verdict = worst(verdict, 'caution');
      }
    }
  }
  if (verdict === 'proceed') reasons.push('No risky permissions, flagged counterparties, or impersonation found');

  return { kind: a.kind, verdict, summary: a.summary(labels), reasons, grants: a.grants, counterparties, chain: a.chain };
}

async function checkPayment(pr: { accepts: Array<Record<string, unknown>> }, signer: string | undefined, expectedMaxUsd: number | undefined) {
  const opts = pr.accepts.map((o) => {
    const network = String(o.network);
    const chain = CHAIN_BY_CAIP[network];
    const asset = String(o.asset);
    const usdc = USDC[network];
    const assetIsUsdc = !!usdc && (chain === 'solana' ? asset === usdc : lc(asset) === usdc);
    const atomic = big(o.amount ?? o.maxAmountRequired);
    const amountUsd = assetIsUsdc && atomic !== null ? Number(atomic) / 1e6 : null;
    return { o, network, chain, asset, payTo: String(o.payTo), assetIsUsdc, atomic, amountUsd };
  });

  const toScreen = opts.filter((p) => p.chain).map((p) => ({ address: p.payTo, chain: p.chain as string }));
  const screened = toScreen.length ? await screenAddresses(toScreen) : [];
  const byPayTo = new Map(screened.map((s) => [s.chain === 'solana' ? s.address : s.address.toLowerCase(), s]));

  const paymentOptions: NonNullable<SignatureCheckOutput['paymentOptions']> = opts.map((p) => {
    const reasons: string[] = [];
    let verdict: Verdict = 'proceed';
    if (!p.chain) { reasons.push(`Unsupported network ${p.network}`); verdict = 'caution'; }
    if (!p.assetIsUsdc) { reasons.push(`Asset ${short(p.asset)} is not Circle USDC on ${p.network}; the price can't be checked in USD`); verdict = worst(verdict, 'caution'); }
    const s = byPayTo.get(p.chain === 'solana' ? p.payTo : lc(p.payTo));
    if (s?.verdict === 'block') { reasons.push(`payTo ${p.payTo} is on a sanctions or scam list`); verdict = 'avoid'; }
    if (p.amountUsd !== null && expectedMaxUsd !== undefined && p.amountUsd > expectedMaxUsd) {
      reasons.push(`Asks for $${p.amountUsd} — above your expected maximum of $${expectedMaxUsd}`);
      verdict = 'avoid';
    }
    const extra = (p.o.extra ?? {}) as Record<string, unknown>;
    if (p.assetIsUsdc && p.chain !== 'solana' && extra.name !== undefined && !/^usd ?coin$|^usdc$/i.test(String(extra.name))) {
      reasons.push(`EIP-712 name "${extra.name}" doesn't match USDC; the signature would be for a different token domain`);
      verdict = worst(verdict, 'caution');
    }
    if (verdict === 'proceed') reasons.push('Genuine USDC to a payee with no known issues');
    return { network: p.network, asset: p.asset, assetIsUsdc: p.assetIsUsdc, amountUsd: p.amountUsd, payTo: p.payTo, verdict, reasons };
  });

  const best = paymentOptions.reduce<Verdict>((v, o) => (({ proceed: 0, caution: 1, avoid: 2 })[o.verdict] < ({ proceed: 0, caution: 1, avoid: 2 })[v] ? o.verdict : v), 'avoid');
  const pick = paymentOptions.find((o) => o.verdict === best) ?? paymentOptions[0];
  const grants: Grant[] = opts.map((p) => ({
    token: p.chain === 'solana' ? p.asset : lc(p.asset),
    symbol: p.assetIsUsdc ? 'USDC' : undefined,
    to: p.chain === 'solana' ? p.payTo : lc(p.payTo),
    amount: p.atomic?.toString(),
    amountFormatted: p.amountUsd !== null ? String(p.amountUsd) : undefined,
    unlimited: false,
    expires: null,
  }));
  const counterparties = screened.map((s) => ({ address: s.address, role: 'payTo', verdict: s.verdict, label: s.knownEntity?.name, isContract: s.isContract }));
  const reasons = best === 'avoid'
    ? ['Every payment option failed a check: ' + [...new Set(paymentOptions.flatMap((o) => o.reasons.filter((r) => !r.startsWith('Genuine'))))].join('; ')]
    : pick.reasons;
  const summary = pick.amountUsd !== null
    ? `Pays $${pick.amountUsd} USDC on ${NETWORK_NAME[pick.network] ?? pick.network} to ${short(pick.payTo)}${paymentOptions.length > 1 ? ` (best of ${paymentOptions.length} options)` : ''}.`
    : `Pays ${short(pick.asset)} on ${NETWORK_NAME[pick.network] ?? pick.network} to ${short(pick.payTo)}.`;
  void signer;
  return { kind: 'x402-payment' as const, verdict: best, summary, reasons, grants, counterparties, paymentOptions, chain: (pick && CHAIN_BY_CAIP[pick.network] !== 'solana' ? CHAIN_BY_CAIP[pick.network] : 'base') as EvmChain };
}

export async function signatureCheckWithCost(
  input: unknown,
): Promise<{ output: SignatureCheckOutput; estimatedCostUsd: number }> {
  const v = signatureCheckInput.parse(input);
  const r = v.typedData
    ? await checkTypedData(v.typedData, v.signer, v.chain)
    : await checkPayment(v.paymentRequired as { accepts: Array<Record<string, unknown>> }, v.signer, v.expectedMaxUsd);

  const spender = r.grants.find((g) => /^0x[a-f0-9]{40}$/.test(g.to))?.to;
  const output = signatureCheckOutput.parse({
    ...r,
    relatedServices: [
      ...(spender
        ? [{
            endpoint: '/v1/address-check',
            description: 'Deeper screening of the spender or recipient',
            suggestedInput: { addresses: [{ address: spender, chain: r.chain }] },
          }]
        : []),
      ...(v.signer
        ? [{
            endpoint: '/v1/approval-scan',
            description: 'See every allowance this wallet has already granted',
            suggestedInput: { address: v.signer, chain: r.chain },
          }]
        : []),
      {
        endpoint: '/v1/tx-simulate',
        description: 'Simulate the transaction that will use this signature before broadcasting it',
        suggestedInput: { chain: r.chain, from: v.signer ?? '0x…your-wallet', transactions: [{ to: '0x…', data: '0x…' }] },
      },
      {
        endpoint: '/v1/content-scan',
        description: 'Scan the page, message, or tool result that asked for this signature for prompt injection before acting on it',
        suggestedInput: { text: '…the untrusted text that requested this signature…' },
      },
    ],
  });
  return { output, estimatedCostUsd: 0 };
}
