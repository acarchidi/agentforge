/**
 * Wallet Safety Check — Composite Endpoint
 *
 * Combines approval scanning, recent transaction analysis, and contract
 * interaction checks into one comprehensive safety assessment. This is
 * the endpoint an agent calls before executing any DeFi transaction.
 *
 * Pipeline:
 *   1. Look up wallet address in registry
 *   2. Run in PARALLEL: approval scan, recent tx fetch, target contract check
 *   3. Enrich contract addresses with registry labels
 *   4. Detect suspicious patterns
 *   5. Calculate composite risk score
 *   6. Generate LLM summary and action items
 *   7. Build relatedServices suggestions
 */

import { callClaude } from '../../llm/anthropic.js';
import { cleanLlmJson } from '../../utils/cleanJson.js';
import { config } from '../../config.js';
import { getRegistry } from '../../registry/lookup.js';
import {
  fetchContractSource,
  fetchTransactionList,
  type EtherscanSource,
} from '../dataSources/etherscan.js';
import {
  fetchSolanaTokenAccounts,
  parseSplDelegates,
  fetchSolanaTransactions,
} from '../dataSources/solana.js';
import {
  walletSafetyInput,
  walletSafetyOutput,
  type WalletSafetyInput,
  type WalletSafetyOutput,
  type Depth,
} from '../../schemas/walletSafety.js';
import {
  detectRapidApprovals,
  detectInteractionWithFlagged,
  detectUnverifiedContractApproval,
  detectMixerInteraction,
  detectLargeOutflowNewAddress,
  detectApprovalToEOA,
  detectPhishingSignature,
  type TransactionRecord,
  type ApprovalRecord,
  type RegistryEntry,
} from './patterns.js';
import {
  calculateRiskScore,
  calculateApprovalRisk,
  calculateActivityRisk,
  calculateTargetRisk,
  riskScoreToLevel,
  type ApprovalRiskInput,
} from './riskScore.js';

// ── Constants ────────────────────────────────────────────────────────

const CHAIN_ID_MAP: Record<string, number> = {
  ethereum: 1,
  base: 8453,
  polygon: 137,
  arbitrum: 42161,
  optimism: 10,
};

const MAX_UINT256 =
  'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

const APPROVAL_TOPIC =
  '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925';

// ── Etherscan helpers (local to this service) ────────────────────────

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
    { signal: AbortSignal.timeout(15_000) },
  );
  if (!res.ok) throw new Error(`Etherscan API error: ${res.status}`);
  const data = (await res.json()) as {
    status: string;
    message: string;
    result: unknown;
  };
  return data.result;
}

// ── Sub-pipeline: Approval Scan ──────────────────────────────────────

interface ApprovalDetail {
  token: string;
  spender: string;
  spenderLabel?: string;
  spenderProtocol?: string;
  spenderRisk: string;
  allowance: string;
  recommendation: 'revoke' | 'reduce' | 'ok';
  // Internal fields for risk scoring
  isVerified: boolean;
  isKnownSafe: boolean;
  registryRisk: string;
}

async function scanApprovals(
  address: string,
  chain: string,
  chainId: number,
): Promise<{ details: ApprovalDetail[]; status: 'success' | 'partial' | 'failed' }> {
  try {
    const paddedOwner = '0x' + address.slice(2).toLowerCase().padStart(64, '0');
    const registry = getRegistry();

    // Fetch approval logs
    let logs: Array<Record<string, unknown>> = [];
    try {
      const result = await etherscanFetch(chainId, 'logs', 'getLogs', {
        fromBlock: '0',
        toBlock: 'latest',
        topic0: APPROVAL_TOPIC,
        topic1: paddedOwner,
        page: '1',
        offset: '200',
      });
      if (Array.isArray(result)) logs = result as Array<Record<string, unknown>>;
    } catch {
      return { details: [], status: 'failed' };
    }

    // Parse approval logs
    const rawApprovals: Array<{
      tokenAddr: string;
      spender: string;
      allowanceHex: string;
    }> = [];

    for (const log of logs) {
      const topics = (log.topics as string[]) ?? [];
      if (topics.length < 3) continue;
      const tokenAddr = ((log.address as string) ?? '').toLowerCase();
      const spender = '0x' + (topics[2] ?? '').slice(26);
      const dataHex = ((log.data as string) ?? '0x0').replace('0x', '');
      rawApprovals.push({ tokenAddr, spender, allowanceHex: dataHex });
    }

    // Deduplicate by token+spender (keep latest)
    const seen = new Map<string, typeof rawApprovals[0]>();
    for (const a of rawApprovals) {
      const key = `${a.tokenAddr}:${a.spender.toLowerCase()}`;
      seen.set(key, a); // Last one wins (most recent in log order)
    }

    // Filter out zero allowances and build details
    const details: ApprovalDetail[] = [];

    for (const a of seen.values()) {
      if (!a.allowanceHex || a.allowanceHex === '0'.repeat(64)) continue;

      const isUnlimited =
        a.allowanceHex.toLowerCase().replace(/^0+/, '') === MAX_UINT256 ||
        a.allowanceHex.length >= 64;

      // Registry lookup for spender
      const registryEntry = registry.lookup(a.spender, chain);
      const isKnownSafe = registryEntry?.riskLevel === 'safe' || registryEntry?.riskLevel === 'low';

      // Quick Etherscan check for verification
      let isVerified = false;
      try {
        const src = await fetchContractSource(a.spender, chain);
        isVerified = src?.isVerified ?? false;
      } catch {
        // Treat as unverified
      }

      // Determine risk and recommendation
      let spenderRisk = 'unknown';
      let recommendation: 'revoke' | 'reduce' | 'ok' = 'ok';

      if (registryEntry) {
        spenderRisk = registryEntry.riskLevel ?? 'unknown';
      } else if (!isVerified) {
        spenderRisk = 'high';
      } else if (isUnlimited) {
        spenderRisk = 'medium';
      } else {
        spenderRisk = 'low';
      }

      if (spenderRisk === 'high' || spenderRisk === 'critical') {
        recommendation = 'revoke';
      } else if (isUnlimited && !isKnownSafe) {
        recommendation = 'reduce';
      }

      details.push({
        token: a.tokenAddr,
        spender: a.spender,
        spenderLabel: registryEntry?.name,
        spenderProtocol: registryEntry?.protocol,
        spenderRisk,
        allowance: isUnlimited ? 'unlimited' : BigInt('0x' + a.allowanceHex).toString(),
        recommendation,
        isVerified,
        isKnownSafe,
        registryRisk: registryEntry?.riskLevel ?? 'unknown',
      });

      // Rate limit Etherscan
      await new Promise((r) => setTimeout(r, 250));
    }

    return { details, status: details.length > 0 || rawApprovals.length === 0 ? 'success' : 'partial' };
  } catch {
    return { details: [], status: 'failed' };
  }
}

// ── Sub-pipeline: Solana Approval Scan ───────────────────────────

async function scanSolanaApprovalsSub(
  address: string,
): Promise<{ details: ApprovalDetail[]; status: 'success' | 'partial' | 'failed' }> {
  try {
    const registry = getRegistry();

    let delegates: Array<{
      mint: string;
      delegate: string;
      delegatedAmount: string;
      totalBalance: string;
      tokenAccount: string;
    }> = [];

    try {
      const tokenAccounts = await fetchSolanaTokenAccounts(address);
      delegates = parseSplDelegates(tokenAccounts);
    } catch {
      return { details: [], status: 'failed' };
    }

    const details: ApprovalDetail[] = delegates.map((d) => {
      const registryEntry = registry.lookup(d.delegate, 'solana');
      const isKnownSafe = registryEntry?.riskLevel === 'safe' || registryEntry?.riskLevel === 'low';

      let spenderRisk = 'medium';
      let recommendation: 'revoke' | 'reduce' | 'ok' = 'ok';

      if (registryEntry) {
        spenderRisk = registryEntry.riskLevel ?? 'unknown';
      } else {
        // Unknown delegate on Solana — moderate risk
        spenderRisk = 'medium';
      }

      if (spenderRisk === 'high' || spenderRisk === 'critical') {
        recommendation = 'revoke';
      } else if (!isKnownSafe && Number(d.delegatedAmount) > 0) {
        recommendation = 'reduce';
      }

      return {
        token: d.mint,
        spender: d.delegate,
        spenderLabel: registryEntry?.name,
        spenderProtocol: registryEntry?.protocol,
        spenderRisk,
        allowance: d.delegatedAmount,
        recommendation,
        isVerified: false, // Solana doesn't have the same verification model
        isKnownSafe,
        registryRisk: registryEntry?.riskLevel ?? 'unknown',
      };
    });

    return { details, status: 'success' };
  } catch {
    return { details: [], status: 'failed' };
  }
}

// ── Sub-pipeline: Solana Recent Activity ─────────────────────────

async function analyzeSolanaRecentActivity(
  address: string,
  depth: Depth,
): Promise<{
  activity: {
    transactionCount30d: number;
    uniqueContractsInteracted: number;
    suspiciousPatterns: Array<{
      pattern: string;
      severity: 'info' | 'warning' | 'danger';
      description: string;
      transactions?: string[];
    }>;
  };
  status: 'success' | 'partial' | 'failed';
}> {
  try {
    const limit = depth === 'deep' ? 100 : 50;
    const txs = await fetchSolanaTransactions(address, limit);

    if (txs.length === 0) {
      return {
        activity: {
          transactionCount30d: 0,
          uniqueContractsInteracted: 0,
          suspiciousPatterns: [],
        },
        status: 'success',
      };
    }

    // Count recent transactions (within 30 days)
    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - (30 * 24 * 3600);
    const recentTxs = txs.filter((tx) => (tx.blockTime ?? 0) >= thirtyDaysAgo);

    // Detect patterns from Solana transaction signatures
    const patterns: Array<{
      pattern: string;
      severity: 'info' | 'warning' | 'danger';
      description: string;
      transactions?: string[];
    }> = [];

    // Check for failed transactions
    const failedTxs = txs.filter((tx) => tx.err !== null);
    if (failedTxs.length > txs.length * 0.3) {
      patterns.push({
        pattern: 'high_failure_rate',
        severity: 'warning',
        description: `${failedTxs.length} of ${txs.length} recent transactions failed (${Math.round((failedTxs.length / txs.length) * 100)}% failure rate)`,
        transactions: failedTxs.slice(0, 3).map((tx) => tx.signature),
      });
    }

    // Check for rapid transaction bursts (more than 10 txs in 60 seconds)
    const sortedTxs = [...txs].filter((tx) => tx.blockTime !== null).sort((a, b) => (a.blockTime ?? 0) - (b.blockTime ?? 0));
    for (let i = 0; i < sortedTxs.length - 10; i++) {
      const window = (sortedTxs[i + 10]?.blockTime ?? 0) - (sortedTxs[i]?.blockTime ?? 0);
      if (window > 0 && window < 60) {
        patterns.push({
          pattern: 'rapid_transactions',
          severity: 'info',
          description: 'Burst of 10+ transactions within 60 seconds detected — may indicate bot activity',
          transactions: sortedTxs.slice(i, i + 10).map((tx) => tx.signature),
        });
        break; // Only report once
      }
    }

    return {
      activity: {
        transactionCount30d: recentTxs.length,
        uniqueContractsInteracted: 0, // Solana signatures don't expose program IDs directly
        suspiciousPatterns: patterns,
      },
      status: 'success',
    };
  } catch {
    return {
      activity: {
        transactionCount30d: 0,
        uniqueContractsInteracted: 0,
        suspiciousPatterns: [],
      },
      status: 'failed',
    };
  }
}

// ── Sub-pipeline: Solana Target Contract Assessment ──────────────

async function assessSolanaTargetContract(
  targetAddress: string,
): Promise<{
  assessment: {
    address: string;
    label?: string;
    protocol?: string;
    riskLevel: string;
    isVerified: boolean;
    isProxy: boolean;
    concerns: string[];
    recommendation: 'proceed' | 'caution' | 'avoid';
  };
  status: 'success' | 'partial' | 'failed';
}> {
  try {
    const registry = getRegistry();
    const registryEntry = registry.lookup(targetAddress, 'solana');

    const concerns: string[] = [];
    let riskLevel = 'unknown';
    let recommendation: 'proceed' | 'caution' | 'avoid' = 'caution';

    if (registryEntry) {
      riskLevel = registryEntry.riskLevel ?? 'unknown';
      if (riskLevel === 'safe' || riskLevel === 'low') {
        recommendation = 'proceed';
      } else if (riskLevel === 'high') {
        recommendation = 'avoid';
        concerns.push('Flagged as high risk in contract registry');
      } else if (riskLevel === 'critical') {
        recommendation = 'avoid';
        concerns.push('Flagged as critical risk — known malicious program');
      }
    } else {
      concerns.push('Not found in known contract registry');
      concerns.push('Solana programs cannot be verified via Etherscan — exercise caution');
    }

    return {
      assessment: {
        address: targetAddress,
        label: registryEntry?.name,
        protocol: registryEntry?.protocol,
        riskLevel,
        isVerified: false, // Solana doesn't use Etherscan verification
        isProxy: false,    // Solana upgradeability is different
        concerns,
        recommendation,
      },
      status: 'success',
    };
  } catch {
    return {
      assessment: {
        address: targetAddress,
        riskLevel: 'unknown',
        isVerified: false,
        isProxy: false,
        concerns: ['Unable to assess Solana program'],
        recommendation: 'caution',
      },
      status: 'failed',
    };
  }
}

// ── Sub-pipeline: Recent Activity ────────────────────────────────────

async function analyzeRecentActivity(
  address: string,
  chain: string,
  chainId: number,
  depth: Depth,
  approvalDetails: ApprovalDetail[],
): Promise<{
  activity: {
    transactionCount30d: number;
    uniqueContractsInteracted: number;
    suspiciousPatterns: Array<{
      pattern: string;
      severity: 'info' | 'warning' | 'danger';
      description: string;
      transactions?: string[];
    }>;
  };
  status: 'success' | 'partial' | 'failed';
}> {
  try {
    const lookbackHours = depth === 'deep' ? 90 * 24 : 30 * 24;
    const txs = await fetchTransactionList(address, chain, lookbackHours);

    if (txs.length === 0) {
      return {
        activity: {
          transactionCount30d: 0,
          uniqueContractsInteracted: 0,
          suspiciousPatterns: [],
        },
        status: 'success',
      };
    }

    // Map to our TransactionRecord type
    const transactions: TransactionRecord[] = txs.map((tx) => ({
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      value: tx.value,
      timestamp: Number(tx.timeStamp),
      functionName: tx.functionName ?? '',
      isError: '0',
    }));

    // Count unique contracts
    const uniqueContracts = new Set<string>();
    for (const tx of transactions) {
      if (tx.to) uniqueContracts.add(tx.to.toLowerCase());
    }

    // Build registry context for pattern detection
    const registry = getRegistry();
    const allAddresses = new Set<string>();
    for (const tx of transactions) {
      if (tx.to) allAddresses.add(tx.to.toLowerCase());
      allAddresses.add(tx.from.toLowerCase());
    }

    const registryEntries: RegistryEntry[] = [];
    for (const addr of allAddresses) {
      const entry = registry.lookup(addr, chain);
      if (entry) {
        registryEntries.push({
          address: entry.address,
          name: entry.name,
          chain: entry.chain,
          riskLevel: entry.riskLevel ?? 'unknown',
          category: entry.category ?? 'unknown',
          tags: entry.tags,
        });
      }
    }

    // Convert approval details to ApprovalRecord format for pattern detection
    const approvalRecords: ApprovalRecord[] = approvalDetails.map((a, i) => ({
      hash: `approval-${i}`,
      token: a.token,
      spender: a.spender,
      allowance: a.allowance,
      timestamp: Math.floor(Date.now() / 1000), // Current time for recent approvals
    }));

    // Build verified set from approval details
    const verifiedContracts = new Set<string>();
    const contractAddresses = new Set<string>();
    for (const a of approvalDetails) {
      if (a.isVerified) {
        verifiedContracts.add(a.spender.toLowerCase());
        contractAddresses.add(a.spender.toLowerCase());
      }
    }
    // Also add registry entries as known contracts
    for (const entry of registryEntries) {
      contractAddresses.add(entry.address.toLowerCase());
    }

    // Run pattern detection
    const patterns: Array<{
      pattern: string;
      severity: 'info' | 'warning' | 'danger';
      description: string;
      transactions?: string[];
    }> = [];

    // Standard patterns (always run for standard+deep)
    const rapid = detectRapidApprovals(approvalRecords);
    if (rapid) patterns.push(rapid);

    const flagged = detectInteractionWithFlagged(transactions, registryEntries);
    if (flagged) patterns.push(flagged);

    const unverified = detectUnverifiedContractApproval(approvalRecords, verifiedContracts);
    if (unverified) patterns.push(unverified);

    const eoa = detectApprovalToEOA(approvalRecords, contractAddresses);
    if (eoa) patterns.push(eoa);

    // Deep-only patterns
    if (depth === 'deep') {
      const mixer = detectMixerInteraction(transactions, registryEntries);
      if (mixer) patterns.push(mixer);

      // Build prior interaction set (addresses the wallet has interacted with before recent window)
      const priorInteractions = new Set<string>();
      const recentTxAddresses = new Map<string, number>();
      for (const tx of transactions) {
        const addr = tx.to?.toLowerCase();
        if (!addr) continue;
        const count = recentTxAddresses.get(addr) ?? 0;
        recentTxAddresses.set(addr, count + 1);
        if (count > 0) priorInteractions.add(addr);
      }

      // Rough ETH price (could be fetched from CoinGecko, using reasonable estimate)
      const ethPriceUsd = 2500;

      const outflow = detectLargeOutflowNewAddress(
        transactions, address, priorInteractions, ethPriceUsd,
      );
      if (outflow) patterns.push(outflow);
    }

    return {
      activity: {
        transactionCount30d: transactions.length,
        uniqueContractsInteracted: uniqueContracts.size,
        suspiciousPatterns: patterns,
      },
      status: 'success',
    };
  } catch {
    return {
      activity: {
        transactionCount30d: 0,
        uniqueContractsInteracted: 0,
        suspiciousPatterns: [],
      },
      status: 'failed',
    };
  }
}

// ── Sub-pipeline: Target Contract Assessment ─────────────────────────

async function assessTargetContract(
  targetAddress: string,
  chain: string,
): Promise<{
  assessment: {
    address: string;
    label?: string;
    protocol?: string;
    riskLevel: string;
    isVerified: boolean;
    isProxy: boolean;
    concerns: string[];
    recommendation: 'proceed' | 'caution' | 'avoid';
  };
  status: 'success' | 'partial' | 'failed';
}> {
  try {
    const registry = getRegistry();
    const registryEntry = registry.lookup(targetAddress, chain);

    // Fetch contract source from Etherscan
    let source: EtherscanSource | null = null;
    try {
      source = await fetchContractSource(targetAddress, chain);
    } catch {
      // Continue without source info
    }

    const isVerified = source?.isVerified ?? false;
    const isProxy = source?.isProxy ?? false;
    const concerns: string[] = [];

    // Determine risk level
    let riskLevel = 'unknown';
    if (registryEntry) {
      riskLevel = registryEntry.riskLevel ?? 'unknown';
    } else if (!isVerified) {
      riskLevel = 'unknown';
      concerns.push('Contract source code not verified on Etherscan');
      concerns.push('Not found in known contract registry');
    } else {
      riskLevel = 'unknown';
      concerns.push('Not found in known contract registry');
    }

    if (isProxy) {
      concerns.push('Contract is a proxy — implementation can be changed by admin');
    }

    if (riskLevel === 'high') {
      concerns.push('Flagged as high risk in contract registry');
    } else if (riskLevel === 'critical') {
      concerns.push('Flagged as critical risk — known malicious contract');
    }

    // Determine recommendation
    let recommendation: 'proceed' | 'caution' | 'avoid' = 'caution';
    if (riskLevel === 'critical') {
      recommendation = 'avoid';
    } else if (riskLevel === 'high') {
      recommendation = 'avoid';
    } else if (riskLevel === 'safe' || riskLevel === 'low') {
      recommendation = isProxy ? 'caution' : 'proceed';
    } else if (!isVerified) {
      recommendation = 'caution';
    }

    return {
      assessment: {
        address: targetAddress,
        label: registryEntry?.name,
        protocol: registryEntry?.protocol,
        riskLevel,
        isVerified,
        isProxy,
        concerns,
        recommendation,
      },
      status: 'success',
    };
  } catch {
    return {
      assessment: {
        address: targetAddress,
        riskLevel: 'unknown',
        isVerified: false,
        isProxy: false,
        concerns: ['Unable to fetch contract data'],
        recommendation: 'caution',
      },
      status: 'failed',
    };
  }
}

// ── LLM Summary Generation ───────────────────────────────────────────

async function generateSummary(
  context: Record<string, unknown>,
  depth: Depth,
): Promise<{ summary: string; actionItems: string[]; costUsd: number }> {
  if (depth === 'quick') {
    // Template-based for quick mode — no LLM call
    const approvals = context.approvals as { totalApprovals: number; riskyApprovals: number; unlimitedApprovals: number };
    const riskScore = context.riskScore as number;

    const items: string[] = [];
    if (approvals.unlimitedApprovals > 0) {
      items.push(`Review and consider revoking ${approvals.unlimitedApprovals} unlimited approval(s)`);
    }
    if (approvals.riskyApprovals > 0) {
      items.push(`Revoke ${approvals.riskyApprovals} risky approval(s) immediately`);
    }

    const summary = riskScore <= 10
      ? 'Wallet appears safe. No significant risks detected in approval scan.'
      : riskScore <= 30
        ? `Wallet has ${approvals.totalApprovals} approvals with minor concerns. Review recommended.`
        : riskScore <= 60
          ? `Wallet has moderate risk. Found ${approvals.riskyApprovals} risky and ${approvals.unlimitedApprovals} unlimited approvals.`
          : `Wallet has elevated risk. Immediate action recommended for ${approvals.riskyApprovals} risky approvals.`;

    return { summary, actionItems: items, costUsd: 0 };
  }

  // LLM-generated summary for standard and deep
  try {
    const { text, usage } = await callClaude({
      system: `You are a DeFi security analyst. Given wallet safety analysis data, produce a concise assessment. Return ONLY a JSON object: {"summary": "<2-3 sentence assessment>", "actionItems": ["<specific action 1>", "<specific action 2>", ...]}. Action items should be specific and actionable. Maximum 5 action items.`,
      userMessage: JSON.stringify(context),
      maxTokens: 500,
      temperature: 0.1,
    });

    try {
      const parsed = JSON.parse(cleanLlmJson(text)) as {
        summary: string;
        actionItems: string[];
      };
      return {
        summary: parsed.summary ?? 'Analysis complete. Review findings above.',
        actionItems: parsed.actionItems ?? [],
        costUsd: usage.estimatedCostUsd,
      };
    } catch {
      return {
        summary: text.trim().slice(0, 500),
        actionItems: [],
        costUsd: usage.estimatedCostUsd,
      };
    }
  } catch {
    return {
      summary: 'Unable to generate AI summary. Review raw findings above.',
      actionItems: [],
      costUsd: 0,
    };
  }
}

// ── Main Export ───────────────────────────────────────────────────────

export interface WalletSafetyResult {
  output: WalletSafetyOutput;
  estimatedCostUsd: number;
}

export async function walletSafetyWithCost(
  input: WalletSafetyInput,
): Promise<WalletSafetyResult> {
  const validated = walletSafetyInput.parse(input);
  const startTime = Date.now();
  const isSolana = validated.chain === 'solana';
  const chainId = isSolana ? 0 : CHAIN_ID_MAP[validated.chain];

  // ── Step 1: Look up wallet address in registry ─────────────────────
  const registry = getRegistry();
  const walletEntry = registry.lookup(validated.walletAddress, validated.chain);

  // ── Step 2: Run sub-pipelines in PARALLEL ──────────────────────────
  // Route to Solana or EVM implementations based on chain
  const approvalPromise = isSolana
    ? scanSolanaApprovalsSub(validated.walletAddress)
    : scanApprovals(validated.walletAddress, validated.chain, chainId);

  const activityPromise = validated.depth === 'quick'
    ? Promise.resolve({ activity: null, status: 'skipped' as const })
    : isSolana
      ? analyzeSolanaRecentActivity(validated.walletAddress, validated.depth)
      : analyzeRecentActivity(
          validated.walletAddress, validated.chain, chainId,
          validated.depth, [], // Will be enriched below
        );

  const targetPromise = validated.targetContract
    ? isSolana
      ? assessSolanaTargetContract(validated.targetContract)
      : assessTargetContract(validated.targetContract, validated.chain)
    : Promise.resolve({ assessment: null, status: 'skipped' as const });

  const [approvalResult, activityResult, targetResult] = await Promise.all([
    approvalPromise,
    activityPromise,
    targetPromise,
  ]);

  // For standard/deep on EVM, re-run activity analysis with approval details if initial had none
  let finalActivity = activityResult;
  if (!isSolana && validated.depth !== 'quick' && approvalResult.details.length > 0 && activityResult.status !== 'skipped') {
    // Enrich with approval data for better pattern detection
    finalActivity = await analyzeRecentActivity(
      validated.walletAddress, validated.chain, chainId,
      validated.depth, approvalResult.details,
    );
  }

  // ── Step 3: Calculate composite risk score ─────────────────────────
  const approvalRiskInputs: ApprovalRiskInput[] = approvalResult.details.map((d) => ({
    allowance: d.allowance,
    isKnownSafe: d.isKnownSafe,
    isVerified: d.isVerified,
    registryRisk: d.registryRisk,
  }));

  const approvalRisk = calculateApprovalRisk(approvalRiskInputs);

  const activityRisk = finalActivity.activity
    ? calculateActivityRisk(finalActivity.activity.suspiciousPatterns)
    : 0;

  let targetRisk: number | null = null;
  if (targetResult.assessment) {
    const regEntry = validated.targetContract
      ? registry.lookup(validated.targetContract, validated.chain)
      : null;
    targetRisk = calculateTargetRisk({
      registryRisk: regEntry?.riskLevel ?? targetResult.assessment.riskLevel,
      isVerified: targetResult.assessment.isVerified,
      inRegistry: !!regEntry,
    });
  }

  const riskScore = calculateRiskScore(approvalRisk, activityRisk, targetRisk);
  const overallRisk = riskScoreToLevel(riskScore);

  // ── Step 4: Build approval summary ─────────────────────────────────
  const totalApprovals = approvalResult.details.length;
  const riskyApprovals = approvalResult.details.filter(
    (d) => d.spenderRisk === 'high' || d.spenderRisk === 'critical',
  ).length;
  const unlimitedApprovals = approvalResult.details.filter(
    (d) => d.allowance === 'unlimited',
  ).length;

  // ── Step 5: Generate summary ───────────────────────────────────────
  const summaryContext = {
    walletAddress: validated.walletAddress,
    chain: validated.chain,
    riskScore,
    overallRisk,
    approvals: {
      totalApprovals,
      riskyApprovals,
      unlimitedApprovals,
      topConcerns: approvalResult.details
        .filter((d) => d.recommendation !== 'ok')
        .slice(0, 5)
        .map((d) => ({
          spender: d.spenderLabel ?? d.spender,
          risk: d.spenderRisk,
          allowance: d.allowance,
          recommendation: d.recommendation,
        })),
    },
    patterns: finalActivity.activity?.suspiciousPatterns ?? [],
    target: targetResult.assessment
      ? {
          address: targetResult.assessment.address,
          label: targetResult.assessment.label,
          risk: targetResult.assessment.riskLevel,
          recommendation: targetResult.assessment.recommendation,
          concerns: targetResult.assessment.concerns,
        }
      : null,
  };

  const { summary, actionItems, costUsd } = await generateSummary(
    summaryContext as unknown as Record<string, unknown>,
    validated.depth,
  );

  // ── Step 6: Build relatedServices ──────────────────────────────────
  const relatedServices: Array<{
    endpoint: string;
    description: string;
    suggestedInput: Record<string, unknown>;
  }> = [];

  relatedServices.push({
    endpoint: '/v1/approval-scan',
    description: 'Detailed approval risk analysis',
    suggestedInput: { address: validated.walletAddress, chain: validated.chain },
  });

  if (validated.targetContract) {
    relatedServices.push({
      endpoint: '/v1/contract-docs',
      description: 'Full documentation for target contract',
      suggestedInput: { address: validated.targetContract, chain: validated.chain },
    });
  }

  // Suggest contract-monitor for concerning contracts found in activity
  const concerningContracts = finalActivity.activity?.suspiciousPatterns
    .flatMap((p) => p.transactions ?? [])
    .slice(0, 2);
  if (concerningContracts && concerningContracts.length > 0) {
    relatedServices.push({
      endpoint: '/v1/contract-monitor',
      description: 'Monitor admin activity on concerning contracts',
      suggestedInput: { address: validated.walletAddress, chain: validated.chain },
    });
  }

  // ── Step 7: Assemble output ────────────────────────────────────────
  const output = walletSafetyOutput.parse({
    walletAddress: validated.walletAddress,
    chain: validated.chain,
    overallRisk,
    riskScore,
    timestamp: new Date().toISOString(),

    approvals: {
      totalApprovals,
      riskyApprovals,
      unlimitedApprovals,
      approvalDetails: approvalResult.details.map((d) => ({
        token: d.token,
        spender: d.spender,
        spenderLabel: d.spenderLabel,
        spenderProtocol: d.spenderProtocol,
        spenderRisk: d.spenderRisk,
        allowance: d.allowance,
        recommendation: d.recommendation,
      })),
    },

    recentActivity: finalActivity.activity ?? undefined,

    targetContractAssessment: targetResult.assessment ?? undefined,

    summary,
    actionItems,
    relatedServices,

    metadata: {
      chain: validated.chain,
      depth: validated.depth,
      processingTimeMs: Date.now() - startTime,
      estimatedCostUsd: costUsd,
      subsystemResults: {
        approvalScan: approvalResult.status,
        recentActivity: finalActivity.status === 'skipped' ? 'skipped' : finalActivity.status,
        targetAssessment: targetResult.status === 'skipped' ? 'skipped' : targetResult.status,
      },
    },
  });

  return { output, estimatedCostUsd: costUsd };
}
