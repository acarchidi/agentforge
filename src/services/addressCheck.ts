/**
 * Address reputation check — POST /v1/address-check.
 *
 * Screens 1-100 counterparty addresses before an agent sends to, approves, or
 * interacts with them: OFAC sanctions, known scam/phishing wallets, the
 * AgentForge contract label registry, and (EVM) whether the address is a
 * contract and how much history it has. Meant to sit in front of every
 * transfer, so it is fast and cheap: list lookups are in-memory and the
 * on-chain context is one batched RPC request per chain. No LLM.
 */

import reputation from '../cache/data/address-reputation.json' with { type: 'json' };
import { getRegistry } from '../registry/lookup.js';
import { getSolanaProgramRegistry } from '../registry/solanaPrograms.js';
import { rpcBatch, type EvmChain } from '../utils/evmRpc.js';
import {
  addressCheckInput,
  addressCheckOutput,
  type AddressCheckItem,
  type AddressCheckOutput,
} from '../schemas/addressCheck.js';
import { formatUsd, priceFor } from '../pricing.js';

interface Hit {
  source: string;
  note?: string;
}

const EVM_LISTS = reputation.evm as Record<string, Hit[]>;
const SOLANA_LISTS = reputation.solana as Record<string, Hit[]>;

const EVM_RE = /^0x[a-fA-F0-9]{40}$/;
const SOLANA_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function listReasons(hits: Hit[]): { sanctioned: boolean; scam: boolean; reasons: string[] } {
  const sanctioned = hits.some((h) => h.source === 'ofac-sdn');
  const scam = hits.some((h) => h.source === 'mew-darklist');
  const reasons: string[] = [];
  if (sanctioned) reasons.push('On the OFAC SDN sanctions list — transacting may be illegal for US persons');
  for (const h of hits.filter((x) => x.source === 'mew-darklist')) {
    reasons.push(`Flagged as scam/phishing wallet${h.note ? `: ${h.note}` : ''}`);
  }
  return { sanctioned, scam, reasons };
}

/** Exported for tests: the verdict logic over already-gathered signals. */
export function decideVerdict(item: Omit<AddressCheckItem, 'verdict'>): AddressCheckItem['verdict'] {
  if (!item.valid) return 'caution';
  if (item.sanctioned || item.flaggedScam) return 'block';
  const risk = item.knownEntity?.riskLevel;
  if (risk === 'high' || risk === 'critical') return 'caution';
  if (item.isContract === false && item.txCount === 0 && !item.knownEntity) return 'caution';
  return 'no_known_issues';
}

/**
 * Screen addresses against sanctions/scam lists, the label registry, and (EVM)
 * on-chain context. Shared by /v1/address-check and /v1/tx-simulate.
 */
export async function screenAddresses(items: Array<{ address: string; chain: string }>): Promise<AddressCheckItem[]> {

  // On-chain context: one batched RPC request per EVM chain (code + nonce per address).
  const evmByChain = new Map<EvmChain, number[]>();
  items.forEach((it, i) => {
    if (it.chain !== 'solana' && EVM_RE.test(it.address)) {
      const c = it.chain as EvmChain;
      evmByChain.set(c, [...(evmByChain.get(c) ?? []), i]);
    }
  });
  const onchain = new Map<number, { isContract: boolean | null; txCount: number | null }>();
  await Promise.all(
    [...evmByChain].map(async ([chain, idxs]) => {
      const calls = idxs.flatMap((i) => [
        { method: 'eth_getCode', params: [items[i].address, 'latest'] },
        { method: 'eth_getTransactionCount', params: [items[i].address, 'latest'] },
      ]);
      const res = await rpcBatch(chain, calls).catch(() => calls.map(() => null));
      idxs.forEach((i, k) => {
        const code = res[k * 2] as string | null;
        const nonce = res[k * 2 + 1] as string | null;
        onchain.set(i, {
          isContract: code === null ? null : code !== '0x',
          txCount: nonce === null ? null : Number.parseInt(nonce, 16),
        });
      });
    }),
  );

  const registry = getRegistry();
  const solRegistry = getSolanaProgramRegistry();

  return items.map((it, i) => {
    const isSolana = it.chain === 'solana';
    const valid = isSolana ? SOLANA_RE.test(it.address) : EVM_RE.test(it.address);
    const hits = valid ? (isSolana ? SOLANA_LISTS[it.address] : EVM_LISTS[it.address.toLowerCase()]) ?? [] : [];
    const { sanctioned, scam, reasons } = listReasons(hits);

    let knownEntity: AddressCheckItem['knownEntity'];
    if (valid && isSolana) {
      const p = solRegistry.lookup(it.address);
      if (p) knownEntity = { name: p.name, category: p.category, riskLevel: p.riskLevel };
    } else if (valid) {
      const c = registry.lookup(it.address, it.chain) ?? registry.lookup(it.address);
      if (c) knownEntity = { name: c.name, category: c.category, riskLevel: c.riskLevel };
    }

    const chainInfo = onchain.get(i);
    if (!valid) reasons.push(isSolana ? 'Not a valid Solana address' : 'Not a valid 0x-prefixed EVM address');
    if (knownEntity) {
      reasons.push(`Known entity: ${knownEntity.name}${knownEntity.category ? ` (${knownEntity.category})` : ''}`);
      if (knownEntity.riskLevel === 'high' || knownEntity.riskLevel === 'critical') {
        reasons.push(`Registry risk level: ${knownEntity.riskLevel}`);
      }
    }
    if (chainInfo?.isContract === false && chainInfo.txCount === 0 && !knownEntity) {
      reasons.push('Brand-new address with no outgoing transactions — common for freshly generated scam or address-poisoning wallets');
    }

    const base: Omit<AddressCheckItem, 'verdict'> = {
      address: it.address,
      chain: it.chain,
      reasons,
      sanctioned,
      flaggedScam: scam,
      knownEntity,
      ...(isSolana ? {} : { isContract: chainInfo?.isContract ?? null, txCount: chainInfo?.txCount ?? null }),
      valid,
    };
    return { ...base, verdict: decideVerdict(base) };
  });

}

export async function addressCheckWithCost(
  input: unknown,
): Promise<{ output: AddressCheckOutput; estimatedCostUsd: number }> {
  const validated = addressCheckInput.parse(input);
  const entries = validated.addresses ?? [{ address: validated.address as string, chain: undefined }];
  const items = entries.map((e) => ({ address: e.address.trim(), chain: e.chain ?? validated.chain }));
  const results = await screenAddresses(items);

  const count = (v: AddressCheckItem['verdict']) => results.filter((r) => r.verdict === v).length;
  const firstEvm = results.find((r) => r.valid && r.chain !== 'solana');

  const output = addressCheckOutput.parse({
    results,
    summary: { checked: results.length, block: count('block'), caution: count('caution'), noKnownIssues: count('no_known_issues') },
    sources: { listsGeneratedAt: reputation.generatedAt, lists: reputation.sources.map((s) => s.id) },
    pricing: { addressesCharged: results.length, total: formatUsd(priceFor('/v1/address-check', validated)) },
    relatedServices: [
      ...(firstEvm
        ? [
            {
              endpoint: '/v1/wallet-safety',
              description: 'Full safety check on your own wallet before the interaction: approvals, activity patterns, target contract risk',
              suggestedInput: { walletAddress: '0x…your-wallet', targetContract: firstEvm.address, chain: firstEvm.chain },
            },
            {
              endpoint: '/v1/tx-simulate',
              description: 'Simulate the transfer or approval to this address before signing it',
              suggestedInput: { chain: firstEvm.chain, from: '0x…your-wallet', transactions: [{ to: '0x…token-or-contract', data: '0x…' }] },
            },
            {
              endpoint: '/v1/approval-scan',
              description: 'See which spenders already hold token approvals on a wallet',
              suggestedInput: { address: firstEvm.address, chain: firstEvm.chain },
            },
          ]
        : []),
    ],
  });

  return { output, estimatedCostUsd: 0 };
}
