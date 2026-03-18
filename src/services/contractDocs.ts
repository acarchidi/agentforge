/**
 * Contract Documentation service.
 * Fetches verified ABI from Etherscan, uses Claude to generate
 * human-readable documentation with risk flags.
 */

import { callClaude } from '../llm/anthropic.js';
import { cleanLlmJson } from '../utils/cleanJson.js';
import {
  contractDocsInput,
  contractDocsOutput,
  type ContractDocsInput,
  type ContractDocsOutput,
} from '../schemas/contractDocs.js';
import {
  fetchContractSource,
  parseAbi,
  type AbiEntry,
} from './dataSources/etherscan.js';
import { getRegistry } from '../registry/lookup.js';
import { getCacheStore } from '../cache/store.js';
import { getPrecomputedDocs } from '../cache/precomputedDocs.js';

const SYSTEM_PROMPT = `You are a smart contract documentation expert. Given a contract ABI (and optionally source code), generate human-readable documentation for each function and event, plus interaction patterns and a security posture summary.

For each function, provide:
- A clear one-sentence description of what it does
- Description of each parameter
- Risk flags from the provided list
- Whether it's a read, write, or payable function

Risk flags to use (pick all that apply):
"owner_only", "can_transfer_funds", "can_modify_state", "can_pause", "can_upgrade",
"can_mint", "can_burn", "can_blacklist", "self_destruct", "delegatecall", "unchecked_external_call"

Return ONLY a JSON object matching this schema:
{
  "functions": [
    {
      "name": <string>,
      "signature": <string, e.g. "transfer(address,uint256)">,
      "type": <"read"|"write"|"payable">,
      "description": <string>,
      "parameters": [{"name": <string>, "type": <string>, "description": <string>}],
      "returns": [{"type": <string>, "description": <string>}],
      "riskFlags": [<string>, ...]
    }
  ],
  "events": [
    {
      "name": <string>,
      "description": <string>,
      "parameters": [{"name": <string>, "type": <string>, "indexed": <boolean>}]
    }
  ],
  "interactionPatterns": [
    {
      "pattern": <string, e.g. "Approve and Swap">,
      "description": <string, explain the multi-step interaction>,
      "functions": [<string, function names involved>],
      "gasEstimate": <string or null, e.g. "~150,000 gas">
    }
  ],
  "securityPosture": {
    "hasOwnerControls": <boolean>,
    "isPausable": <boolean>,
    "isUpgradeable": <boolean>,
    "hasMintCapability": <boolean>,
    "hasBlacklistCapability": <boolean>,
    "usesExternalCalls": <boolean>,
    "adminFunctionCount": <number>,
    "assessment": <string, one-paragraph security posture summary>
  },
  "summary": {
    "totalFunctions": <number>,
    "readFunctions": <number>,
    "writeFunctions": <number>,
    "adminFunctions": <number>,
    "riskLevel": <"low"|"medium"|"high">,
    "overview": <string, one paragraph contract summary>
  }
}

You must return ONLY a JSON object. No markdown. No code fences. No preamble.`;

function classifyFunction(entry: AbiEntry): 'read' | 'write' | 'payable' {
  if (entry.stateMutability === 'payable') return 'payable';
  if (entry.stateMutability === 'view' || entry.stateMutability === 'pure') return 'read';
  return 'write';
}

function buildSignature(entry: AbiEntry): string {
  const inputs = (entry.inputs ?? []).map((i) => i.type).join(',');
  return `${entry.name ?? 'unknown'}(${inputs})`;
}

function buildAbiSummary(entries: AbiEntry[], focusFunctions?: string[]): string {
  const functions = entries.filter((e) => e.type === 'function');
  const events = entries.filter((e) => e.type === 'event');

  let filtered = functions;
  if (focusFunctions && focusFunctions.length > 0) {
    const focusSet = new Set(focusFunctions.map((f) => f.toLowerCase()));
    filtered = functions.filter(
      (f) => f.name && focusSet.has(f.name.toLowerCase()),
    );
    // If none matched, fall back to all functions
    if (filtered.length === 0) filtered = functions;
  }

  // Limit functions to keep output within max_tokens budget.
  // Each documented function costs ~150-200 output tokens.
  const MAX_FUNCS = 35;
  if (filtered.length > MAX_FUNCS) {
    filtered = filtered.slice(0, MAX_FUNCS);
  }

  const funcLines = filtered.map((f) => {
    const sig = buildSignature(f);
    const type = classifyFunction(f);
    const outputs = (f.outputs ?? []).map((o) => o.type).join(', ');
    return `- ${sig} [${type}]${outputs ? ` -> (${outputs})` : ''}`;
  });

  const eventLines = events.slice(0, 20).map((e) => {
    const params = (e.inputs ?? [])
      .map((p) => `${p.type}${p.indexed ? ' indexed' : ''} ${p.name}`)
      .join(', ');
    return `- ${e.name}(${params})`;
  });

  return `FUNCTIONS (${filtered.length} of ${functions.length}):\n${funcLines.join('\n')}\n\nEVENTS (${Math.min(events.length, 20)} of ${events.length}):\n${eventLines.join('\n')}`;
}

export interface ContractDocsResult {
  output: ContractDocsOutput;
  estimatedCostUsd: number;
}

export async function contractDocsWithCost(
  input: ContractDocsInput,
): Promise<ContractDocsResult> {
  const validated = contractDocsInput.parse(input);
  const startTime = Date.now();

  // Check static precomputed cache first (loaded from JSON at cold start)
  const precomputed = getPrecomputedDocs().lookup(validated.address, validated.chain);
  if (precomputed) {
    return { output: precomputed, estimatedCostUsd: 0 };
  }

  // Then check the in-memory runtime cache (populated by live requests)
  const cacheKey = `docs:${validated.chain}:${validated.address.toLowerCase()}`;
  const cache = getCacheStore();
  const cached = await cache.get<ContractDocsOutput>(cacheKey);
  if (cached) {
    return { output: cached, estimatedCostUsd: 0 };
  }

  // Fetch contract source + ABI from Etherscan
  const source = await fetchContractSource(validated.address, validated.chain);
  const registryEntry = getRegistry().lookup(validated.address, validated.chain);

  if (!source || !source.isVerified || !source.abi) {
    // Return minimal response for unverified contracts
    const output = contractDocsOutput.parse({
      contract: {
        address: validated.address,
        chain: validated.chain,
        name: registryEntry?.name ?? null,
        compilerVersion: null,
        isVerified: false,
        isProxy: false,
        implementationAddress: null,
        registryLabel: registryEntry?.name,
        registryProtocol: registryEntry?.protocol,
        registryCategory: registryEntry?.category,
      },
      functions: [],
      events: [],
      summary: {
        totalFunctions: 0,
        readFunctions: 0,
        writeFunctions: 0,
        adminFunctions: 0,
        riskLevel: 'high',
        overview:
          'Contract source code is not verified on Etherscan. Cannot generate documentation. Unverified contracts carry higher risk.',
      },
      metadata: {
        model: 'none',
        processingTimeMs: Date.now() - startTime,
        estimatedCostUsd: 0,
        abiSize: 0,
      },
    });
    return { output, estimatedCostUsd: 0 };
  }

  // ── Proxy-following logic ──────────────────────────────────────────
  // When a contract is a proxy with a known implementation, fetch the
  // implementation's ABI/source and document THAT — because that's what
  // agents actually call when they interact with the proxy address.
  // The proxy metadata (upgrade mechanism, governance) is preserved in
  // the proxyInfo field.

  let effectiveSource = source;
  let proxyInfoData: {
    isProxy: boolean;
    proxyType?: string;
    proxyAddress: string;
    implementationAddress: string;
    governanceFramework?: string;
    note: string;
  } | undefined;

  if (source.isProxy && source.implementationAddress) {
    const implSource = await fetchContractSource(source.implementationAddress, validated.chain);

    if (implSource && implSource.isVerified && implSource.abi) {
      // Detect proxy type from proxy source code
      let proxyType: string | undefined;
      let governanceFramework: string | undefined;
      const proxySrc = source.sourceCode?.toLowerCase() ?? '';

      if (proxySrc.includes('erc897') || proxySrc.includes('ercproxy') || proxySrc.includes('proxytype')) {
        proxyType = 'ERC-897';
      } else if (proxySrc.includes('eip1967') || proxySrc.includes('_implementation_slot')) {
        proxyType = 'ERC-1967';
      } else if (proxySrc.includes('uupsupgradeable') || proxySrc.includes('upgradetoandcall')) {
        proxyType = 'UUPS';
      } else if (proxySrc.includes('transparentupgradeableproxy')) {
        proxyType = 'TransparentProxy';
      }

      if (proxySrc.includes('aragon') || proxySrc.includes('appproxy') || proxySrc.includes('kernel')) {
        governanceFramework = 'Aragon';
      } else if (proxySrc.includes('openzeppelin') || proxySrc.includes('@openzeppelin')) {
        governanceFramework = 'OpenZeppelin';
      } else if (proxySrc.includes('gnosis') || proxySrc.includes('safe')) {
        governanceFramework = 'Gnosis Safe';
      }

      proxyInfoData = {
        isProxy: true,
        proxyType,
        proxyAddress: validated.address,
        implementationAddress: source.implementationAddress,
        governanceFramework,
        note: `Documentation reflects the implementation contract logic at ${source.implementationAddress}. ` +
          `The proxy at ${validated.address} delegates all calls to the implementation via ${proxyType ?? 'delegatecall'}. ` +
          (governanceFramework
            ? `Upgrades are governed by the ${governanceFramework} framework.`
            : 'The proxy is upgradeable — implementation address may change.'),
      };

      // Use the implementation's source and ABI for documentation
      effectiveSource = {
        ...implSource,
        // Keep proxy metadata from the original source
        isProxy: true,
        implementationAddress: source.implementationAddress,
      };
    }
    // If implementation is not verified, fall through and document the proxy's own ABI
  }

  const abiEntries = parseAbi(effectiveSource.abi!);
  const abiSummary = buildAbiSummary(abiEntries, validated.focusFunctions);

  // Include source code context if available (truncated)
  let sourceContext = '';
  if (effectiveSource.sourceCode && effectiveSource.sourceCode.length > 0) {
    const truncated = effectiveSource.sourceCode.slice(0, 6000);
    sourceContext = `\n\nSOURCE CODE (truncated):\n${truncated}`;
  }

  // If proxy contract, note it in the LLM prompt
  let proxyNote = '';
  if (proxyInfoData) {
    proxyNote = `\nNOTE: This is a PROXY contract at ${validated.address}. You are documenting the IMPLEMENTATION at ${source.implementationAddress}.`;
    proxyNote += `\nProxy type: ${proxyInfoData.proxyType ?? 'unknown'}.`;
    if (proxyInfoData.governanceFramework) {
      proxyNote += ` Governance: ${proxyInfoData.governanceFramework}.`;
    }
    proxyNote += `\nIn your securityPosture assessment, mention the proxy/upgrade mechanism and its governance.`;
  } else if (source.isProxy && source.implementationAddress) {
    proxyNote = `\nNOTE: This is a proxy contract. Implementation at ${source.implementationAddress} (unverified — documenting proxy ABI only).`;
  }

  // Add registry context if available
  let registryNote = '';
  if (registryEntry) {
    registryNote = `\nKnown Protocol: ${registryEntry.protocol ?? 'unknown'} | Category: ${registryEntry.category ?? 'unknown'} | Risk: ${registryEntry.riskLevel ?? 'unknown'}`;
  }

  const contractName = registryEntry?.name ?? effectiveSource.contractName ?? validated.address;
  const prompt = `Contract: ${contractName}\nChain: ${validated.chain}\nCompiler: ${effectiveSource.compilerVersion ?? 'unknown'}${proxyNote}${registryNote}\n\nABI:\n${abiSummary}${sourceContext}`;

  // Scale max_tokens based on ABI complexity to avoid truncated JSON.
  // Each documented function costs ~150-200 output tokens.
  // Events, patterns, security posture add ~1000-1500 tokens.
  const funcCount = abiEntries.filter((e) => e.type === 'function').length;
  const effectiveFuncCount = Math.min(funcCount, 35); // matches MAX_FUNCS in buildAbiSummary
  const maxTokens = effectiveFuncCount <= 12 ? 4000
    : effectiveFuncCount <= 20 ? 6000
    : 8192; // Claude supports up to 8192

  const response = await callClaude({
    system: SYSTEM_PROMPT,
    userMessage: prompt,
    maxTokens,
    temperature: 0.1,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleanLlmJson(response.text));
  } catch {
    throw new Error(`LLM returned invalid JSON: ${response.text.slice(0, 200)}`);
  }

  const llmResult = parsed as Record<string, unknown>;

  const related: Array<{ endpoint: string; description: string; suggestedInput: Record<string, unknown> }> = [
    {
      endpoint: '/v1/contract-monitor',
      description: 'Monitor recent admin activity on this contract',
      suggestedInput: { address: validated.address, chain: validated.chain },
    },
    {
      endpoint: '/v1/token-intel',
      description: 'Quick price and risk check for this token',
      suggestedInput: { address: validated.address, chain: validated.chain },
    },
  ];
  if (source.sourceCode) {
    related.push({
      endpoint: '/v1/code-review',
      description: 'Security audit of this contract source code',
      suggestedInput: { code: source.sourceCode.slice(0, 10000), language: 'solidity' },
    });
  }

  const output = contractDocsOutput.parse({
    contract: {
      address: validated.address,
      chain: validated.chain,
      name: effectiveSource.contractName,
      compilerVersion: effectiveSource.compilerVersion,
      isVerified: effectiveSource.isVerified,
      isProxy: source.isProxy,
      implementationAddress: source.implementationAddress,
      registryLabel: registryEntry?.name,
      registryProtocol: registryEntry?.protocol,
      registryCategory: registryEntry?.category,
    },
    functions: llmResult.functions ?? [],
    events: llmResult.events ?? [],
    interactionPatterns: llmResult.interactionPatterns ?? undefined,
    securityPosture: llmResult.securityPosture ?? undefined,
    proxyInfo: proxyInfoData,
    summary: llmResult.summary ?? {
      totalFunctions: abiEntries.filter((e) => e.type === 'function').length,
      readFunctions: 0,
      writeFunctions: 0,
      adminFunctions: 0,
      riskLevel: 'medium',
      overview: 'Documentation generated from contract ABI.',
    },
    metadata: {
      model: 'claude-sonnet-4-20250514',
      processingTimeMs: Date.now() - startTime,
      estimatedCostUsd: response.usage.estimatedCostUsd,
      abiSize: abiEntries.length,
    },
    relatedServices: related,
  });

  await cache.set(cacheKey, output, 86_400); // 24-hour TTL
  return { output, estimatedCostUsd: response.usage.estimatedCostUsd };
}
