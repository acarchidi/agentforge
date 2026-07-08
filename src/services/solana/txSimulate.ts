import { VersionedTransaction, Transaction } from '@solana/web3.js';
import { callClaude } from '../../llm/anthropic.js';
import { solanaRpc } from '../dataSources/solana.js';
import { getSolanaProgramRegistry } from '../../registry/solanaPrograms.js';
import type { SolanaTxSimulateInput, SolanaTxSimulateOutput } from '../../schemas/solanaTxSimulate.js';

interface ProgramInvoked {
  programId: string;
  label?: string;
  category?: string;
  isVerified: boolean;
}

export function labelProgramsInvoked(programIds: string[]): ProgramInvoked[] {
  const registry = getSolanaProgramRegistry();
  const unique = [...new Set(programIds)];
  return unique.map((programId) => {
    const entry = registry.lookup(programId);
    return {
      programId,
      label: entry?.name,
      category: entry?.category,
      isVerified: entry?.verified ?? false,
    };
  });
}

interface TokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { uiAmount: number | null };
}

/**
 * Diff pre/post SOL and SPL token balances into a flat list of changes.
 * Zero-delta accounts are omitted — only genuinely changed balances matter.
 */
export function computeBalanceChanges(
  accountKeys: string[],
  preSol: number[],
  postSol: number[],
  preTokens: TokenBalance[],
  postTokens: TokenBalance[],
): SolanaTxSimulateOutput['balanceChanges'] {
  const changes: SolanaTxSimulateOutput['balanceChanges'] = [];

  for (let i = 0; i < accountKeys.length; i++) {
    const before = (preSol[i] ?? 0) / 1e9;
    const after = (postSol[i] ?? 0) / 1e9;
    if (before !== after) {
      changes.push({ account: accountKeys[i], type: 'sol', before, after, delta: after - before });
    }
  }

  const postByIndex = new Map(postTokens.map((t) => [t.accountIndex, t]));
  const seenIndices = new Set<number>();

  for (const pre of preTokens) {
    seenIndices.add(pre.accountIndex);
    const post = postByIndex.get(pre.accountIndex);
    const before = pre.uiTokenAmount.uiAmount ?? 0;
    const after = post?.uiTokenAmount.uiAmount ?? 0;
    if (before !== after) {
      changes.push({
        account: accountKeys[pre.accountIndex] ?? `account_${pre.accountIndex}`,
        type: 'token',
        mint: pre.mint,
        before,
        after,
        delta: after - before,
      });
    }
  }
  for (const post of postTokens) {
    if (seenIndices.has(post.accountIndex)) continue;
    const after = post.uiTokenAmount.uiAmount ?? 0;
    if (after !== 0) {
      changes.push({
        account: accountKeys[post.accountIndex] ?? `account_${post.accountIndex}`,
        type: 'token',
        mint: post.mint,
        before: 0,
        after,
        delta: after,
      });
    }
  }

  return changes;
}

/**
 * Deterministic risk rules over simulation logs and invoked programs.
 * No LLM involved — must be stable and cheap to evaluate on every call.
 */
export function detectSimulateRiskFlags(
  logs: string[],
  programsInvoked: ProgramInvoked[],
  simulationFailed: boolean,
): string[] {
  const flags: string[] = [];
  const logText = logs.join('\n');

  if (simulationFailed) {
    flags.push('Simulation failed — transaction would not succeed as constructed');
  }
  if (/SetAuthority/i.test(logText)) {
    flags.push('Changes a mint, freeze, or account authority');
  }
  if (/Approve/i.test(logText) || /delegate/i.test(logText)) {
    flags.push('Grants a token delegate/approval — a third party could move funds without further signatures');
  }
  if (/CloseAccount/i.test(logText)) {
    flags.push('Closes a token account, reclaiming rent — confirm this is intended');
  }
  const unverified = programsInvoked.filter((p) => !p.isVerified);
  if (unverified.length > 0) {
    flags.push(`Invokes ${unverified.length} unverified/unrecognized program(s)`);
  }

  return flags;
}

export function deriveRecommendation(
  simulationFailed: boolean,
  riskFlags: string[],
): SolanaTxSimulateOutput['recommendation'] {
  if (simulationFailed) return 'avoid';
  const severeFlags = riskFlags.filter(
    (f) => f.includes('authority') || f.includes('delegate') || f.includes('unverified'),
  );
  if (severeFlags.length > 0) return 'caution';
  if (riskFlags.length > 0) return 'caution';
  return 'proceed';
}

function decodeAccountKeys(transactionBase64: string): string[] {
  const buffer = Buffer.from(transactionBase64, 'base64');
  try {
    const versioned = VersionedTransaction.deserialize(buffer);
    return versioned.message.staticAccountKeys.map((k) => k.toBase58());
  } catch {
    const legacy = Transaction.from(buffer);
    return legacy.instructions
      .flatMap((ix) => ix.keys.map((k) => k.pubkey.toBase58()).concat(ix.programId.toBase58()))
      .filter((v, i, arr) => arr.indexOf(v) === i);
  }
}

interface SimulateTransactionResult {
  err: unknown;
  logs: string[] | null;
  unitsConsumed?: number;
  accounts?: Array<{ lamports: number; data: [string, string] } | null> | null;
}

export async function simulateSolanaTxWithCost(
  input: SolanaTxSimulateInput,
): Promise<{ output: SolanaTxSimulateOutput; estimatedCostUsd: number }> {
  const accountKeys = decodeAccountKeys(input.transaction);

  const result = await solanaRpc<{ value: SimulateTransactionResult }>('simulateTransaction', [
    input.transaction,
    {
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: 'confirmed',
      innerInstructions: true,
      encoding: 'base64',
      accounts: { encoding: 'base64', addresses: accountKeys },
    },
  ]);

  const sim = result.value;
  const simulationFailed = sim.err !== null && sim.err !== undefined;
  const logs = sim.logs ?? [];
  const programsInvoked = labelProgramsInvoked(accountKeys);
  const riskFlags = detectSimulateRiskFlags(logs, programsInvoked, simulationFailed);
  const recommendation = deriveRecommendation(simulationFailed, riskFlags);

  // Balance deltas: the `accounts` response only gives post-state (lamports);
  // without a pre-simulation snapshot we report post-state deltas as 0 unless
  // available, but token balance deltas are frequently absent from `accounts`
  // in the base64-account-encoding mode, so we keep this best-effort.
  const balanceChanges: SolanaTxSimulateOutput['balanceChanges'] = [];
  if (sim.accounts) {
    for (let i = 0; i < sim.accounts.length; i++) {
      const acc = sim.accounts[i];
      if (!acc) continue;
      // Only SOL lamports are reliably available here; token deltas require
      // pre-state we don't have without an extra RPC round-trip per account.
      balanceChanges.push({
        account: accountKeys[i] ?? `account_${i}`,
        type: 'sol',
        before: 0,
        after: acc.lamports / 1e9,
        delta: acc.lamports / 1e9,
      });
    }
  }

  let explanation: string;
  let estimatedCostUsd = 0;
  const nontrivialLogs = logs.length > 3 || riskFlags.length > 0;
  if (nontrivialLogs) {
    try {
      const llm = await callClaude({
        model: 'claude-haiku-4-5-20251001',
        system:
          'You explain the outcome of a simulated Solana transaction in plain English for a ' +
          'non-technical trader, in 2-4 sentences. State whether it would succeed, what programs ' +
          'it touches, and highlight any risk flags given to you. Do not speculate beyond the data.',
        userMessage: [
          `Simulation success: ${!simulationFailed}`,
          `Programs invoked: ${programsInvoked.map((p) => p.label ?? p.programId).join(', ')}`,
          `Risk flags: ${riskFlags.join('; ') || 'none'}`,
          `Logs (truncated): ${logs.slice(0, 15).join('\n')}`,
        ].join('\n'),
        maxTokens: 300,
      });
      explanation = llm.text.trim();
      estimatedCostUsd = llm.usage.estimatedCostUsd;
    } catch {
      explanation = simulationFailed
        ? 'Simulation failed. See logs for the on-chain error.'
        : 'Simulation succeeded. See programsInvoked and balanceChanges for details.';
    }
  } else {
    explanation = simulationFailed
      ? 'Simulation failed. See logs for the on-chain error.'
      : 'Simulation succeeded with minimal, low-risk activity.';
  }

  const output: SolanaTxSimulateOutput = {
    success: !simulationFailed,
    computeUnitsConsumed: sim.unitsConsumed,
    logs: logs.slice(0, 50),
    errorMessage: simulationFailed ? JSON.stringify(sim.err) : undefined,
    balanceChanges,
    programsInvoked,
    riskFlags,
    recommendation,
    explanation,
    relatedServices: [
      {
        endpoint: '/v1/solana/tx-explain',
        description: 'Explain a similar, already-confirmed transaction',
        suggestedInput: { signature: '<confirmed tx signature>' },
      },
      {
        endpoint: '/v1/solana/program-lookup',
        description: 'Look up any program ID this transaction invokes',
        suggestedInput: { programId: accountKeys[0] ?? '' },
      },
    ],
  };

  return { output, estimatedCostUsd };
}
