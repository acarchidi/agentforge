import { callClaude } from '../../llm/anthropic.js';
import { fetchHeliusEnhancedTransactions, type HeliusEnhancedTransaction } from '../dataSources/helius.js';
import { solanaRpc } from '../dataSources/solana.js';
import { getSolanaProgramRegistry } from '../../registry/solanaPrograms.js';
import {
  type SolanaTxExplainInput,
  type SolanaTxExplainOutput,
} from '../../schemas/solanaTxExplain.js';

const SET_AUTHORITY_DISCRIMINATOR_HINT = 'SetAuthority';

interface LabeledInstruction {
  programId: string;
  label?: string;
  category?: string;
  isVerified: boolean;
}

export function labelInstructions(programIds: string[]): LabeledInstruction[] {
  const registry = getSolanaProgramRegistry();
  return programIds.map((programId) => {
    const entry = registry.lookup(programId);
    return {
      programId,
      label: entry?.name,
      category: entry?.category,
      isVerified: entry?.verified ?? false,
    };
  });
}

/**
 * Deterministic risk flags derived from parsed instruction data. Kept
 * separate from the LLM explanation so it's stable/testable regardless
 * of model output.
 */
export function detectTxExplainRiskFlags(
  labeled: LabeledInstruction[],
  rawInstructionData: string[],
): string[] {
  const flags: string[] = [];

  const unknownPrograms = labeled.filter((i) => !i.isVerified);
  if (unknownPrograms.length > 0) {
    flags.push(`Interacts with ${unknownPrograms.length} unverified/unknown program(s)`);
  }

  const highRisk = labeled.filter((i) => i.category === 'launchpad' || i.category === 'memecoin-infra');
  if (highRisk.length > 0) {
    flags.push('Interacts with a memecoin launchpad program — elevated rug/volatility risk');
  }

  if (rawInstructionData.some((d) => d.includes(SET_AUTHORITY_DISCRIMINATOR_HINT))) {
    flags.push('Transaction may change an authority (mint, freeze, or account owner)');
  }

  return flags;
}

function buildContextFromHelius(tx: HeliusEnhancedTransaction, labeled: LabeledInstruction[]): string {
  const labels = labeled.map((l) => l.label ?? l.programId).join(', ');
  return [
    `Transaction type: ${tx.type}`,
    `Source: ${tx.source}`,
    `Success: ${!tx.transactionError}`,
    `Fee payer: ${tx.feePayer}`,
    `Programs involved: ${labels}`,
    `Token transfers: ${JSON.stringify(tx.tokenTransfers)}`,
    `Native SOL transfers: ${JSON.stringify(tx.nativeTransfers)}`,
  ].join('\n');
}

async function explainFromHelius(
  signature: string,
  tx: HeliusEnhancedTransaction,
): Promise<{ output: SolanaTxExplainOutput; estimatedCostUsd: number }> {
  const programIds = [...new Set(tx.instructions.map((i) => i.programId))];
  const labeled = labelInstructions(programIds);
  const riskFlags = detectTxExplainRiskFlags(
    labeled,
    tx.instructions.map((i) => i.data ?? ''),
  );

  let explanation: string;
  let estimatedCostUsd = 0;
  try {
    const context = buildContextFromHelius(tx, labeled);
    const llm = await callClaude({
      model: 'claude-haiku-4-5-20251001',
      system:
        'You explain Solana transactions in plain English for a non-technical trader. ' +
        'Write 2-4 sentences. State what happened, which tokens/amounts moved, and whether ' +
        'it succeeded. Do not speculate beyond the given data.',
      userMessage: context,
      maxTokens: 300,
    });
    explanation = llm.text.trim();
    estimatedCostUsd = llm.usage.estimatedCostUsd;
  } catch {
    explanation = tx.transactionError
      ? 'This transaction failed on-chain.'
      : `A ${tx.type.toLowerCase().replace(/_/g, ' ')} transaction via ${tx.source}.`;
  }

  const output: SolanaTxExplainOutput = {
    signature,
    success: !tx.transactionError,
    fee: tx.fee,
    feePayer: tx.feePayer,
    timestamp: tx.timestamp ?? null,
    instructions: labeled,
    tokenMovements: tx.tokenTransfers.map((t) => ({
      mint: t.mint,
      amount: t.tokenAmount,
      from: t.fromUserAccount,
      to: t.toUserAccount,
    })),
    nativeSolMovements: tx.nativeTransfers.map((t) => ({
      amount: t.amount,
      from: t.fromUserAccount,
      to: t.toUserAccount,
    })),
    explanation,
    riskFlags,
    parseQuality: 'full',
    relatedServices: buildRelatedServices(programIds[0]),
  };

  return { output, estimatedCostUsd };
}

interface RawTransactionResult {
  meta: { err: unknown; fee: number } | null;
  transaction: { message: { accountKeys: Array<{ pubkey: string } | string> } };
  blockTime: number | null;
}

async function explainFromRawRpc(signature: string): Promise<{ output: SolanaTxExplainOutput; estimatedCostUsd: number }> {
  const result = await solanaRpc<RawTransactionResult | null>('getTransaction', [
    signature,
    { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 },
  ]);

  if (!result) {
    throw new Error(`Transaction ${signature} not found on Solana`);
  }

  const accountKeys = result.transaction.message.accountKeys.map((k) =>
    typeof k === 'string' ? k : k.pubkey,
  );
  const labeled = labelInstructions(accountKeys.slice(0, 5));
  const success = !result.meta?.err;

  const output: SolanaTxExplainOutput = {
    signature,
    success,
    fee: result.meta?.fee,
    timestamp: result.blockTime,
    instructions: labeled,
    tokenMovements: [],
    explanation: success
      ? 'Transaction succeeded. Detailed parsing was unavailable, so this is a best-effort structural summary — see the raw instructions for exact accounts involved.'
      : 'Transaction failed on-chain. Detailed parsing was unavailable for the failure reason.',
    riskFlags: labeled.some((l) => !l.isVerified) ? ['Interacts with unverified/unrecognized programs'] : [],
    parseQuality: 'partial',
    relatedServices: buildRelatedServices(accountKeys[0]),
  };

  return { output, estimatedCostUsd: 0 };
}

function buildRelatedServices(sampleProgramOrMint?: string): SolanaTxExplainOutput['relatedServices'] {
  return [
    {
      endpoint: '/v1/solana/tx-simulate',
      description: 'Simulate a similar transaction before signing it',
      suggestedInput: { transaction: '<base64 unsigned transaction>' },
    },
    {
      endpoint: '/v1/solana/program-lookup',
      description: 'Look up any program ID seen in this transaction',
      suggestedInput: { programId: sampleProgramOrMint ?? '' },
    },
  ];
}

export async function explainSolanaTxWithCost(
  input: SolanaTxExplainInput,
): Promise<{ output: SolanaTxExplainOutput; estimatedCostUsd: number }> {
  let heliusResults: HeliusEnhancedTransaction[] = [];
  try {
    heliusResults = await fetchHeliusEnhancedTransactions([input.signature]);
  } catch {
    heliusResults = [];
  }

  const tx = heliusResults[0];
  if (tx) {
    return explainFromHelius(input.signature, tx);
  }

  return explainFromRawRpc(input.signature);
}
