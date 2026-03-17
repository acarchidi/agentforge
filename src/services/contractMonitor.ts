/**
 * Contract Monitor service — monitors recent contract activity for admin ops.
 * Uses Etherscan transaction list + ABI decoding to identify admin operations.
 */

import { callClaude } from '../llm/anthropic.js';
import { cleanLlmJson } from '../utils/cleanJson.js';
import {
  contractMonitorInput,
  contractMonitorOutput,
  type ContractMonitorInput,
  type ContractMonitorOutput,
} from '../schemas/contractMonitor.js';
import {
  fetchContractSource,
  parseAbi,
  fetchTransactionList,
} from './dataSources/etherscan.js';
import { getRegistry } from '../registry/lookup.js';

const ADMIN_FUNCTIONS = new Set([
  'transferownership', 'renounceownership', 'setowner', 'changeowner',
  'pause', 'unpause', 'setpaused',
  'upgradeto', 'upgradetoandcall', 'setimplementation',
  'mint', 'burn',
  'blacklist', 'addblacklist', 'removeblacklist',
  'setadmin', 'grantRole', 'revokeRole', 'grantrole', 'revokerole',
  'setfee', 'setfees', 'setprice',
  'withdraw', 'withdrawall', 'sweep',
  'setproxy', 'migrate',
]);

function isAdminFunction(functionName: string): boolean {
  const lower = functionName.toLowerCase().replace(/[^a-z]/g, '');
  return ADMIN_FUNCTIONS.has(lower) ||
    lower.startsWith('set') ||
    lower.startsWith('update') ||
    lower.includes('admin') ||
    lower.includes('owner') ||
    lower.includes('pause') ||
    lower.includes('upgrade');
}

const ANALYSIS_PROMPT = `You are a smart contract security analyst. Given a list of recent admin transactions on a contract, analyze the risk level.

Return ONLY a JSON object:
{
  "level": <"none"|"low"|"medium"|"high"|"critical">,
  "alerts": [<string array of specific concerns>],
  "recommendation": <string, one-paragraph recommendation>
}

Scoring:
- none: No admin activity detected
- low: Routine admin operations (fee adjustments, etc.)
- medium: Notable admin changes (role changes, pausing)
- high: Significant changes (ownership transfer, implementation upgrade)
- critical: Multiple high-risk operations in short timeframe

You must return ONLY a JSON object. No markdown. No code fences.`;

export interface ContractMonitorResult {
  output: ContractMonitorOutput;
  estimatedCostUsd: number;
}

export async function contractMonitorWithCost(
  input: ContractMonitorInput,
): Promise<ContractMonitorResult> {
  const validated = contractMonitorInput.parse(input);
  const startTime = Date.now();
  let totalCost = 0;

  // Fetch contract info
  const source = await fetchContractSource(validated.address, validated.chain);
  const registryEntry = getRegistry().lookup(validated.address, validated.chain);
  const contractName = source?.contractName ?? registryEntry?.name ?? null;
  const isProxy = source?.isProxy ?? false;

  // Build function signature map from ABI
  const functionMap = new Map<string, string>();
  if (source?.abi) {
    const entries = parseAbi(source.abi);
    for (const e of entries) {
      if (e.type === 'function' && e.name) {
        const inputs = (e.inputs ?? []).map((i) => i.type).join(',');
        functionMap.set(e.name, `${e.name}(${inputs})`);
      }
    }
  }

  // Fetch recent transactions
  const txList = await fetchTransactionList(
    validated.address,
    validated.chain,
    validated.lookbackHours,
  );

  // Identify admin transactions
  const adminTxs: Array<{
    txHash: string;
    functionName: string;
    timestamp: string;
    from: string;
    summary: string;
  }> = [];

  let implementationChanged = false;
  let ownershipChanged = false;
  let pauseStateChanged = false;

  for (const tx of txList) {
    const fnName = tx.functionName?.split('(')[0] ?? '';
    if (!fnName || !isAdminFunction(fnName)) continue;

    const lower = fnName.toLowerCase();
    if (lower.includes('upgrade') || lower.includes('implementation')) implementationChanged = true;
    if (lower.includes('owner')) ownershipChanged = true;
    if (lower.includes('pause')) pauseStateChanged = true;

    adminTxs.push({
      txHash: tx.hash,
      functionName: fnName,
      timestamp: new Date(Number(tx.timeStamp) * 1000).toISOString(),
      from: tx.from,
      summary: `${fnName} called by ${tx.from.slice(0, 10)}...`,
    });
  }

  // Risk analysis
  let riskAlert: { level: string; alerts: string[]; recommendation: string };

  if (adminTxs.length === 0) {
    riskAlert = {
      level: 'none',
      alerts: [],
      recommendation: `No admin transactions detected in the last ${validated.lookbackHours} hours. Contract appears stable.`,
    };
  } else {
    // Use LLM for risk analysis
    const txSummary = adminTxs
      .slice(0, 20)
      .map((t) => `- ${t.functionName} by ${t.from} at ${t.timestamp}`)
      .join('\n');

    const response = await callClaude({
      system: ANALYSIS_PROMPT,
      userMessage: `Contract: ${contractName ?? validated.address}\nChain: ${validated.chain}\nIs Proxy: ${isProxy}\nLookback: ${validated.lookbackHours}h\n\nAdmin transactions (${adminTxs.length} total):\n${txSummary}`,
      maxTokens: 500,
      temperature: 0.1,
    });

    totalCost += response.usage.estimatedCostUsd;
    riskAlert = JSON.parse(cleanLlmJson(response.text));
  }

  const output = contractMonitorOutput.parse({
    contract: {
      address: validated.address,
      chain: validated.chain,
      name: contractName,
      isProxy,
      registryLabel: registryEntry?.name,
      registryProtocol: registryEntry?.protocol,
      registryCategory: registryEntry?.category,
    },
    recentActivity: {
      transactionCount: txList.length,
      adminTransactions: adminTxs.slice(0, 50),
      implementationChanged,
      ownershipChanged,
      pauseStateChanged,
    },
    riskAlert,
    metadata: {
      lookbackHours: validated.lookbackHours,
      processingTimeMs: Date.now() - startTime,
      estimatedCostUsd: totalCost,
    },
    relatedServices: [
      {
        endpoint: '/v1/contract-docs',
        description: 'Understand this contract — functions, events, risk flags',
        suggestedInput: { address: validated.address, chain: validated.chain },
      },
      {
        endpoint: '/v1/token-intel',
        description: 'Quick price and risk check for this token',
        suggestedInput: { address: validated.address, chain: validated.chain },
      },
    ],
  });

  return { output, estimatedCostUsd: totalCost };
}
