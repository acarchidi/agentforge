/**
 * Preflight — POST /v1/preflight. One "is this action safe?" call.
 *
 * Routes whatever the agent is about to do through the matching checks and
 * rolls them into one verdict: transactions → simulation (reverts, assets out,
 * approvals, counterparty screening), typed data / x402 requests → signature
 * check, recipients → sanctions and scam screening, tokens → rug check. Tokens
 * the simulation shows the wallet receiving are rug-checked too (up to two,
 * inside the base price), so a swap into a honeypot is caught without the
 * agent knowing to ask. Token names, symbols and labels the checks surface
 * are run through the content-scan rules, so a token whose name is a prompt
 * injection is reported too. The checks run in parallel; no LLM anywhere.
 */

import { getTokenRiskMetricsWithCost } from './tokenRiskMetrics/index.js';
import { simulateEvmTxWithCost } from './txSimulate.js';
import { signatureCheckWithCost } from './signatureCheck.js';
import { screenAddresses } from './addressCheck.js';
import { scanStrings } from './contentScan.js';
import { getRegistry } from '../registry/lookup.js';
import { CHAIN_BY_ID, CHAIN_INFO, SIMULATE_CHAINS, type EvmChain } from '../utils/chains.js';
import {
  preflightInput,
  preflightOutput,
  type PreflightOutput,
} from '../schemas/preflight.js';
import { PREFLIGHT_BASE, RISK_BATCH_PER_TOKEN, formatUsd, priceFor } from '../pricing.js';

type Verdict = PreflightOutput['verdict'];
type TokenItem = NonNullable<PreflightOutput['tokens']>[number];

const RANK: Record<Verdict, number> = { proceed: 0, caution: 1, avoid: 2 };
const MAX_RECEIVED_TOKENS = 2;
/** Token checks share this budget so the request settles well inside Vercel's 60s limit. */
const TOKEN_DEADLINE_MS = 25_000;
const EVM_RE = /^0x[a-fA-F0-9]{40}$/;
const APPROVAL_SCAN_CHAINS = new Set<string>(['ethereum', 'base', 'polygon', 'arbitrum', 'optimism', 'avalanche']);

const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

function chainFromTypedData(td: unknown): EvmChain | undefined {
  try {
    const obj = typeof td === 'string' ? JSON.parse(td) : td;
    const id = Number((obj as { domain?: { chainId?: unknown } })?.domain?.chainId);
    return Number.isFinite(id) ? CHAIN_BY_ID[id] : undefined;
  } catch {
    return undefined;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timed out')), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/**
 * Same thresholds as /v1/trade-check (critical → avoid, high → caution), except
 * that a token our registry labels safe or low-risk proceeds: issuer-mintable
 * majors (USDC, Binance-Peg assets, CAKE) score "high" on owner powers alone.
 */
async function checkToken(address: string, chain: EvmChain, source: TokenItem['source'], ms: number, texts: string[]): Promise<TokenItem> {
  try {
    const { output: m } = await withTimeout(getTokenRiskMetricsWithCost({ address, chain }), ms);
    for (const t of [m.name, m.symbol]) if (typeof t === 'string' && t) texts.push(t);
    const { score, level } = m.overallRisk;
    const known = getRegistry().lookup(address, chain);
    const trusted = known && (known.riskLevel === 'safe' || known.riskLevel === 'low');
    const verdict: Verdict = trusted ? 'proceed' : level === 'critical' || score >= 75 ? 'avoid' : level === 'high' || score >= 50 ? 'caution' : 'proceed';
    const flags = trusted ? [`Known token: ${known.name}`, ...m.overallRisk.flags] : m.overallRisk.flags;
    return { address, source, status: 'ok', verdict, riskScore: score, riskLevel: level, flags };
  } catch (e) {
    return { address, source, status: 'error', error: e instanceof Error ? e.message : 'token check failed' };
  }
}

/** Received tokens worth rug-checking: not the chain's USDC and not a labeled, low-risk contract. */
function receivedTokens(sim: Awaited<ReturnType<typeof simulateEvmTxWithCost>>['output'], chain: EvmChain, skip: Set<string>): string[] {
  const registry = getRegistry();
  return sim.assetChanges
    .filter((a) => a.standard === 'erc20' && !a.delta.startsWith('-') && a.delta !== '0')
    .map((a) => a.token.toLowerCase())
    .filter((t) => t !== CHAIN_INFO[chain].usdc && !skip.has(t))
    .filter((t) => {
      const known = registry.lookup(t, chain);
      return !known || (known.riskLevel !== 'safe' && known.riskLevel !== 'low');
    })
    .slice(0, MAX_RECEIVED_TOKENS);
}

export async function preflightWithCost(
  input: unknown,
): Promise<{ output: PreflightOutput; estimatedCostUsd: number }> {
  const startTime = Date.now();
  const v = preflightInput.parse(input);
  const chain: EvmChain = v.chain ?? chainFromTypedData(v.typedData) ?? 'base';
  const requested = [...new Set((v.tokens ?? []).map((t) => t.toLowerCase()))];

  const skipped: PreflightOutput['skipped'] = [];
  /** Untrusted strings the checks bring back (token names/symbols, labels); scanned for prompt injection below. */
  const texts: string[] = [];
  const canSimulate = (SIMULATE_CHAINS as readonly string[]).includes(chain);
  if (v.transactions && !canSimulate) {
    skipped.push({ check: 'simulation', reason: `Simulation is not available on ${CHAIN_INFO[chain].name} (its public RPC lacks eth_simulateV1); recipients and tokens were still checked` });
  }

  const tokenDeadline = startTime + TOKEN_DEADLINE_MS;
  const [simR, sigR, addrR, reqTokens] = await Promise.allSettled([
    v.transactions && canSimulate
      ? simulateEvmTxWithCost({ chain, from: v.from, transactions: v.transactions })
      : Promise.resolve(null),
    v.typedData || v.paymentRequired
      ? signatureCheckWithCost({
          typedData: v.typedData,
          paymentRequired: v.paymentRequired,
          signer: v.from,
          chain: v.chain,
          expectedMaxUsd: v.expectedMaxUsd,
        })
      : Promise.resolve(null),
    v.recipients?.length
      ? screenAddresses(v.recipients.map((a) => ({ address: a.trim(), chain: EVM_RE.test(a.trim()) ? chain : 'solana' })))
      : Promise.resolve(null),
    Promise.all(requested.map((t) => checkToken(t, chain, 'requested', tokenDeadline - Date.now(), texts))),
  ]);

  const sim = simR.status === 'fulfilled' ? simR.value?.output ?? null : null;
  const sig = sigR.status === 'fulfilled' ? sigR.value?.output ?? null : null;
  const addresses = addrR.status === 'fulfilled' ? addrR.value : null;
  const tokens: TokenItem[] = reqTokens.status === 'fulfilled' ? reqTokens.value : [];
  if (simR.status === 'rejected') skipped.push({ check: 'simulation', reason: `Simulation failed: ${simR.reason instanceof Error ? simR.reason.message : 'RPC error'}` });
  if (sigR.status === 'rejected') skipped.push({ check: 'signature', reason: `Signature check failed: ${sigR.reason instanceof Error ? sigR.reason.message : 'error'}` });
  if (addrR.status === 'rejected') skipped.push({ check: 'addresses', reason: 'Recipient screening failed' });

  if (sim) {
    const extra = receivedTokens(sim, chain, new Set(requested));
    tokens.push(...(await Promise.all(extra.map((t) => checkToken(t, chain, 'received', Math.max(3_000, tokenDeadline - Date.now()), texts)))));
    for (const a of sim.assetChanges) if (a.symbol) texts.push(a.symbol);
    for (const a of sim.approvals) if (a.symbol) texts.push(a.symbol);
  }
  if (sig) for (const g of sig.grants) if (g.symbol) texts.push(g.symbol);

  // Prompt-injection scan over whatever untrusted strings the checks surfaced (no extra RPC).
  const scannable = [...new Set(texts.map((t) => t.trim()).filter(Boolean))];
  const injection = scannable.length ? scanStrings(scannable) : null;

  const checksRun: PreflightOutput['checksRun'] = [];
  if (sim) checksRun.push('simulation');
  if (sig) checksRun.push('signature');
  if (addresses) checksRun.push('addresses');
  if (tokens.some((t) => t.status === 'ok')) checksRun.push('tokens');
  // Nothing ran: fail the request (no charge) rather than sell an empty verdict.
  if (checksRun.length === 0) {
    throw new Error(`No check could run: ${skipped.map((s) => s.reason).join('; ') || 'token checks failed'}`);
  }

  // ── Roll up ──────────────────────────────────────────────────────
  const found: Array<{ verdict: Verdict; text: string }> = [];
  if (sim) {
    for (const r of sim.reasons) found.push({ verdict: sim.verdict, text: `[simulation] ${r}` });
    if (sim.verdict !== 'proceed' && sim.reasons.length === 0) found.push({ verdict: sim.verdict, text: '[simulation] flagged' });
  }
  if (sig) {
    found.push({ verdict: sig.verdict, text: `[signature] ${sig.summary}` });
    for (const r of sig.reasons) found.push({ verdict: sig.verdict, text: `[signature] ${r}` });
  }
  for (const a of addresses ?? []) {
    if (a.verdict === 'no_known_issues') continue;
    const v2: Verdict = a.verdict === 'block' ? 'avoid' : 'caution';
    found.push({ verdict: v2, text: `[recipient ${short(a.address)}] ${a.reasons.join('; ') || a.verdict}` });
  }
  for (const t of tokens) {
    if (t.status !== 'ok' || t.verdict === 'proceed') continue;
    found.push({
      verdict: t.verdict as Verdict,
      text: `[token ${short(t.address)}${t.source === 'received' ? ', received' : ''}] risk ${t.riskScore}/100 (${t.riskLevel})${t.flags?.length ? `: ${t.flags.slice(0, 4).join(', ')}` : ''}`,
    });
  }
  for (const t of tokens) {
    if (t.status === 'error') found.push({ verdict: 'caution', text: `[token ${short(t.address)}] could not be rug-checked (${t.error})` });
  }
  if (injection && injection.verdict !== 'clean') {
    const rules = [...new Set(injection.findings.map((f) => f.rule))].join(', ');
    found.push({
      verdict: injection.verdict === 'malicious' ? 'caution' : 'proceed',
      text: `[prompt-injection] token metadata ${injection.verdict} (${rules}): ${injection.findings[0]?.excerpt ?? ''}`,
    });
  }
  if (skipped.length) for (const s of skipped) found.push({ verdict: 'caution', text: `[${s.check}] ${s.reason}` });

  found.sort((a, b) => RANK[b.verdict] - RANK[a.verdict]);
  const verdict: Verdict = found.reduce<Verdict>((w, f) => (RANK[f.verdict] > RANK[w] ? f.verdict : w), 'proceed');
  const reasons = [...new Set(found.map((f) => f.text))];
  const lead = found.find((f) => f.verdict === verdict && f.text)?.text.replace(/^\[[^\]]+\]\s*/, '');
  const summary = verdict === 'proceed'
    ? `No known issues across ${checksRun.join(', ')} on ${CHAIN_INFO[chain].name}.`
    : `${verdict === 'avoid' ? 'Avoid' : 'Caution'}: ${lead ?? 'see reasons'}`;

  const tokensCharged = Math.min(v.tokens?.length ?? 0, 5);
  const riskiestToken = tokens.filter((t) => t.status === 'ok').sort((a, b) => (b.riskScore ?? 0) - (a.riskScore ?? 0))[0];
  const output = preflightOutput.parse({
    verdict,
    summary,
    reasons,
    chain,
    checksRun,
    ...(sim ? { simulation: { ...sim, relatedServices: undefined } } : {}),
    ...(sig ? { signature: { ...sig, relatedServices: undefined } } : {}),
    ...(addresses ? { addresses } : {}),
    ...(tokens.length ? { tokens } : {}),
    ...(injection ? { promptInjection: { verdict: injection.verdict, findings: injection.findings } } : {}),
    skipped,
    pricing: {
      base: formatUsd(PREFLIGHT_BASE),
      perToken: formatUsd(RISK_BATCH_PER_TOKEN),
      tokensCharged,
      total: formatUsd(priceFor('/v1/preflight', v)),
    },
    metadata: { processingTimeMs: Date.now() - startTime },
    relatedServices: [
      ...(riskiestToken
        ? [{
            endpoint: '/v1/trade-check',
            description: 'Full pre-trade check on the riskiest token (rug check + AI risk + gas)',
            suggestedInput: { address: riskiestToken.address, chain },
          }]
        : []),
      ...(v.from && APPROVAL_SCAN_CHAINS.has(chain)
        ? [{
            endpoint: '/v1/approval-scan',
            description: 'Allowances this wallet has already granted',
            suggestedInput: { address: v.from, chain },
          }]
        : []),
      {
        endpoint: '/v1/lending/health',
        description: 'Liquidation risk for this wallet on Aave v3',
        suggestedInput: { address: v.from ?? '0x…your-wallet', chain: 'all' },
      },
      {
        endpoint: '/v1/content-scan',
        description: 'Scan the tool result, page, or message that proposed this action for prompt injection before acting on it',
        suggestedInput: { text: '…the untrusted text that proposed this action…' },
      },
    ],
  });
  return { output, estimatedCostUsd: 0 };
}
