/**
 * Approval Scanner service.
 * Scans token approvals for a wallet, identifies risky spenders,
 * and generates a risk assessment via Claude.
 *
 * Supports:
 * - EVM chains: ERC-20 approval events via Etherscan
 * - Solana: SPL token delegate authorities via Solana RPC
 */

import { callClaude } from '../llm/anthropic.js';
import { cleanLlmJson } from '../utils/cleanJson.js';
import { config } from '../config.js';
import {
  approvalScanInput,
  approvalScanOutput,
  type ApprovalScanInput,
  type ApprovalScanOutput,
} from '../schemas/approvalScanner.js';
import { getRegistry } from '../registry/lookup.js';
import { fetchSolanaTokenAccounts, parseSplDelegates } from './dataSources/solana.js';

const CHAIN_ID_MAP: Record<string, number> = {
  ethereum: 1,
  base: 8453,
  polygon: 137,
  arbitrum: 42161,
  optimism: 10,
  avalanche: 43114,
};

const MAX_UINT256 =
  'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

// Approval event topic0 = keccak256("Approval(address,address,uint256)")
const APPROVAL_TOPIC =
  '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925';

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

interface TokenTx {
  contractAddress: string;
  tokenSymbol: string;
  tokenName: string;
}

interface ApprovalLog {
  address: string; // token contract
  topics: string[];
  data: string;
  tokenSymbol: string | null;
  tokenName: string | null;
}

export interface ApprovalScanResult {
  output: ApprovalScanOutput;
  estimatedCostUsd: number;
}

// ── Solana Approval Scan ──────────────────────────────────────────

async function scanSolanaApprovals(
  address: string,
): Promise<ApprovalScanResult> {
  const startTime = Date.now();
  const registry = getRegistry();

  // Fetch SPL token accounts and parse delegate authorities
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
    // Continue with empty delegates
  }

  // Build approval-like structure from SPL delegates
  const approvals = delegates.map((d) => {
    const registryEntry = registry.lookup(d.delegate, 'solana');
    const knownLabel = registryEntry?.name ?? null;

    let riskLevel: 'safe' | 'low' | 'medium' | 'high' | 'critical' = 'medium';
    let riskReason: string | null = 'SPL token delegate authority';

    if (registryEntry?.riskLevel === 'safe' || registryEntry?.riskLevel === 'low') {
      riskLevel = 'safe';
      riskReason = null;
    } else if (registryEntry?.riskLevel === 'high' || registryEntry?.riskLevel === 'critical') {
      riskLevel = registryEntry.riskLevel;
      riskReason = `Registry risk: ${registryEntry.riskLevel}`;
    } else if (knownLabel) {
      riskLevel = 'low';
      riskReason = null;
    }

    return {
      token: {
        address: d.mint,
        symbol: null as string | null,
        name: null as string | null,
      },
      spender: {
        address: d.delegate,
        contractName: null as string | null,
        isVerified: false,  // Solana doesn't have the same verification model
        label: knownLabel,
        registryLabel: registryEntry?.name,
        registryProtocol: registryEntry?.protocol,
        registryRisk: registryEntry?.riskLevel,
      },
      allowance: d.delegatedAmount,
      riskLevel,
      riskReason,
    };
  });

  const riskyCount = approvals.filter(
    (a) => a.riskLevel === 'high' || a.riskLevel === 'critical',
  ).length;

  let overallRisk: 'clean' | 'low' | 'medium' | 'high' | 'critical' = 'clean';
  let recommendation = 'No active SPL token delegates found. Wallet is clean.';
  let estimatedCostUsd = 0;

  if (approvals.length > 0) {
    const summaryContext = {
      wallet: address,
      chain: 'solana',
      totalApprovals: approvals.length,
      unlimitedApprovals: 0,
      riskyApprovals: riskyCount,
      note: 'Solana SPL token delegate scan — delegates have authority to transfer delegated token amounts.',
      approvals: approvals.slice(0, 15).map((a) => ({
        token: a.token.address.slice(0, 12) + '...',
        spender: a.spender.label ?? a.spender.address.slice(0, 12) + '...',
        allowance: a.allowance,
        risk: a.riskLevel,
        reason: a.riskReason,
      })),
    };

    try {
      const { text, usage } = await callClaude({
        system:
          'You are a blockchain security analyst specializing in Solana. Given a wallet\'s SPL token delegate data, assess the overall risk and provide a concise recommendation. Return ONLY a JSON object: {"overallRisk": "clean"|"low"|"medium"|"high"|"critical", "recommendation": "<one short paragraph>"}',
        userMessage: JSON.stringify(summaryContext),
        maxTokens: 300,
        temperature: 0.1,
      });
      estimatedCostUsd = usage.estimatedCostUsd;

      try {
        const parsed = JSON.parse(cleanLlmJson(text)) as {
          overallRisk: string;
          recommendation: string;
        };
        overallRisk = (parsed.overallRisk as typeof overallRisk) ?? 'medium';
        recommendation = parsed.recommendation ?? 'Review your SPL token delegates regularly.';
      } catch {
        if (riskyCount > 0) overallRisk = 'high';
        else if (approvals.length > 0) overallRisk = 'low';
        recommendation = text.trim();
      }
    } catch {
      if (riskyCount > 0) overallRisk = 'high';
      else overallRisk = 'low';
      recommendation = 'Unable to generate AI assessment. Review delegate authorities manually.';
    }
  }

  const related: Array<{
    endpoint: string;
    description: string;
    suggestedInput: Record<string, unknown>;
  }> = [{
    endpoint: '/v1/wallet-safety',
    description: 'Full wallet safety check with activity analysis',
    suggestedInput: { walletAddress: address, chain: 'solana' },
  }];

  const output = approvalScanOutput.parse({
    wallet: { address, chain: 'solana' },
    approvals,
    summary: {
      totalApprovals: approvals.length,
      unlimitedApprovals: 0,
      riskyApprovals: riskyCount,
      overallRisk,
      recommendation,
    },
    relatedServices: related,
    metadata: {
      chain: 'solana',
      processingTimeMs: Date.now() - startTime,
      estimatedCostUsd,
      approvalsScanned: approvals.length,
    },
  });

  return { output, estimatedCostUsd };
}

// ── Main Entry Point ─────────────────────────────────────────────

export async function scanApprovalsWithCost(
  input: ApprovalScanInput,
): Promise<ApprovalScanResult> {
  const validated = approvalScanInput.parse(input);

  // Route to Solana scanner if chain is solana
  if (validated.chain === 'solana') {
    return scanSolanaApprovals(validated.address);
  }

  const startTime = Date.now();
  const chainId = CHAIN_ID_MAP[validated.chain];

  // Step 1: Fetch token transfer history to discover tokens
  let tokenTxs: TokenTx[] = [];
  try {
    const result = await etherscanFetch(chainId, 'account', 'tokentx', {
      address: validated.address,
      page: '1',
      offset: '500',
      sort: 'desc',
    });
    if (Array.isArray(result)) {
      tokenTxs = (result as Array<Record<string, unknown>>).map((t) => ({
        contractAddress: (t.contractAddress as string) ?? '',
        tokenSymbol: (t.tokenSymbol as string) ?? '',
        tokenName: (t.tokenName as string) ?? '',
      }));
    }
  } catch {
    // Continue with empty list
  }

  // Step 2: Extract unique token addresses (limit to 20 most recent)
  const seen = new Set<string>();
  const uniqueTokens: TokenTx[] = [];
  for (const tx of tokenTxs) {
    const addr = tx.contractAddress.toLowerCase();
    if (!seen.has(addr)) {
      seen.add(addr);
      uniqueTokens.push(tx);
      if (uniqueTokens.length >= 20) break;
    }
  }

  // Step 3: Fetch approval logs for the wallet
  // Use logs endpoint with topic0=Approval and topic1=owner (padded wallet address)
  const paddedOwner = '0x' + validated.address.slice(2).toLowerCase().padStart(64, '0');
  const approvalLogs: ApprovalLog[] = [];

  try {
    const result = await etherscanFetch(chainId, 'logs', 'getLogs', {
      fromBlock: '0',
      toBlock: 'latest',
      topic0: APPROVAL_TOPIC,
      topic1: paddedOwner,
      page: '1',
      offset: '200',
    });
    if (Array.isArray(result)) {
      for (const log of result as Array<Record<string, unknown>>) {
        const tokenAddr = ((log.address as string) ?? '').toLowerCase();
        const matchingToken = uniqueTokens.find(
          (t) => t.contractAddress.toLowerCase() === tokenAddr,
        );
        approvalLogs.push({
          address: tokenAddr,
          topics: (log.topics as string[]) ?? [],
          data: (log.data as string) ?? '0x0',
          tokenSymbol: matchingToken?.tokenSymbol ?? null,
          tokenName: matchingToken?.tokenName ?? null,
        });
      }
    }
  } catch {
    // Continue with empty approvals
  }

  // Step 4: Parse approvals — extract spender and allowance from each log
  // topic2 = spender (address), data = allowance (uint256)
  // Keep only the latest approval per token+spender pair
  const latestApprovals = new Map<
    string,
    { tokenAddr: string; spender: string; allowance: string; symbol: string | null; name: string | null }
  >();

  for (const log of approvalLogs) {
    if (log.topics.length < 3) continue;
    const spender = '0x' + log.topics[2].slice(26);
    const allowanceHex = log.data.slice(2);
    const key = `${log.address}:${spender}`;
    latestApprovals.set(key, {
      tokenAddr: log.address,
      spender,
      allowance: allowanceHex,
      symbol: log.tokenSymbol,
      name: log.tokenName,
    });
  }

  // Filter out zero approvals (revoked)
  const activeApprovals = [...latestApprovals.values()].filter(
    (a) => a.allowance !== '0'.repeat(64) && a.allowance !== '',
  );

  // Step 5: Look up spender contracts (batch — limit to first 10 unique spenders)
  const uniqueSpenders = [...new Set(activeApprovals.map((a) => a.spender))].slice(0, 10);
  const spenderInfo = new Map<
    string,
    { contractName: string | null; isVerified: boolean }
  >();

  // Fetch spender info sequentially to respect rate limits
  for (const spenderAddr of uniqueSpenders) {
    try {
      const result = await etherscanFetch(chainId, 'contract', 'getsourcecode', {
        address: spenderAddr,
      });
      const entries = result as Array<Record<string, unknown>>;
      if (Array.isArray(entries) && entries.length > 0) {
        const name = (entries[0].ContractName as string) || null;
        spenderInfo.set(spenderAddr.toLowerCase(), {
          contractName: name,
          isVerified: !!name && name !== '',
        });
      }
    } catch {
      spenderInfo.set(spenderAddr.toLowerCase(), {
        contractName: null,
        isVerified: false,
      });
    }
  }

  // Step 6: Build structured approvals with risk assessment
  const approvals = activeApprovals.map((a) => {
    const spenderLower = a.spender.toLowerCase();
    const info = spenderInfo.get(spenderLower) ?? {
      contractName: null,
      isVerified: false,
    };
    const registry = getRegistry();
    const registryEntry = registry.lookup(spenderLower, validated.chain);
    const knownLabel = registryEntry?.name ?? null;
    const isUnlimited = a.allowance.toLowerCase().includes(MAX_UINT256);

    let riskLevel: 'safe' | 'low' | 'medium' | 'high' | 'critical' = 'low';
    let riskReason: string | null = null;

    if (registryEntry && registryEntry.riskLevel === 'safe') {
      riskLevel = 'safe';
    } else if (registryEntry && (registryEntry.riskLevel === 'high' || registryEntry.riskLevel === 'critical')) {
      riskLevel = registryEntry.riskLevel;
      riskReason = `Registry risk: ${registryEntry.riskLevel}`;
    } else if (knownLabel) {
      riskLevel = 'safe';
    } else if (isUnlimited && !info.isVerified) {
      riskLevel = 'critical';
      riskReason = 'Unlimited approval to unverified contract';
    } else if (isUnlimited) {
      riskLevel = 'medium';
      riskReason = 'Unlimited approval to verified contract';
    } else if (!info.isVerified) {
      riskLevel = 'high';
      riskReason = 'Approval to unverified contract';
    }

    return {
      token: {
        address: a.tokenAddr,
        symbol: a.symbol,
        name: a.name,
      },
      spender: {
        address: a.spender,
        contractName: info.contractName,
        isVerified: info.isVerified,
        label: knownLabel,
        registryLabel: registryEntry?.name,
        registryProtocol: registryEntry?.protocol,
        registryRisk: registryEntry?.riskLevel,
      },
      allowance: isUnlimited ? 'unlimited' : BigInt('0x' + a.allowance).toString(),
      riskLevel,
      riskReason,
    };
  });

  const unlimitedCount = approvals.filter((a) => a.allowance === 'unlimited').length;
  const riskyCount = approvals.filter(
    (a) => a.riskLevel === 'high' || a.riskLevel === 'critical',
  ).length;

  // Step 7: Get Claude risk assessment
  const summaryContext = {
    wallet: validated.address,
    chain: validated.chain,
    totalApprovals: approvals.length,
    unlimitedApprovals: unlimitedCount,
    riskyApprovals: riskyCount,
    approvals: approvals.slice(0, 15).map((a) => ({
      token: a.token.symbol ?? a.token.address,
      spender: a.spender.label ?? a.spender.contractName ?? a.spender.address,
      allowance: a.allowance,
      risk: a.riskLevel,
      reason: a.riskReason,
    })),
  };

  let overallRisk: 'clean' | 'low' | 'medium' | 'high' | 'critical' = 'clean';
  let recommendation = 'No active approvals found. Wallet is clean.';
  let estimatedCostUsd = 0;

  if (approvals.length > 0) {
    const { text, usage } = await callClaude({
      system:
        'You are a blockchain security analyst. Given a wallet\'s token approval data, assess the overall risk and provide a concise recommendation. Return ONLY a JSON object: {"overallRisk": "clean"|"low"|"medium"|"high"|"critical", "recommendation": "<one short paragraph>"}',
      userMessage: JSON.stringify(summaryContext),
      maxTokens: 300,
      temperature: 0.1,
    });
    estimatedCostUsd = usage.estimatedCostUsd;

    try {
      const parsed = JSON.parse(cleanLlmJson(text)) as {
        overallRisk: string;
        recommendation: string;
      };
      overallRisk = (parsed.overallRisk as typeof overallRisk) ?? 'medium';
      recommendation = parsed.recommendation ?? 'Review your approvals regularly.';
    } catch {
      // Fallback risk calculation
      if (riskyCount > 0) overallRisk = 'high';
      else if (unlimitedCount > 0) overallRisk = 'medium';
      else overallRisk = 'low';
      recommendation = text.trim();
    }
  }

  // Build relatedServices for risky spenders
  const related: Array<{
    endpoint: string;
    description: string;
    suggestedInput: Record<string, unknown>;
  }> = [];

  const riskySpenders = approvals
    .filter((a) => a.riskLevel === 'high' || a.riskLevel === 'critical')
    .slice(0, 3);

  for (const a of riskySpenders) {
    related.push({
      endpoint: '/v1/contract-docs',
      description: `Investigate risky spender ${a.spender.address.slice(0, 10)}...`,
      suggestedInput: { address: a.spender.address, chain: validated.chain },
    });
  }

  if (related.length === 0) {
    related.push({
      endpoint: '/v1/token-intel',
      description: 'Check token details for any token in your wallet',
      suggestedInput: { address: validated.address, chain: validated.chain },
    });
  }

  const output = approvalScanOutput.parse({
    wallet: { address: validated.address, chain: validated.chain },
    approvals,
    summary: {
      totalApprovals: approvals.length,
      unlimitedApprovals: unlimitedCount,
      riskyApprovals: riskyCount,
      overallRisk,
      recommendation,
    },
    relatedServices: related,
    metadata: {
      chain: validated.chain,
      processingTimeMs: Date.now() - startTime,
      estimatedCostUsd,
      approvalsScanned: approvals.length,
    },
  });

  return { output, estimatedCostUsd };
}
