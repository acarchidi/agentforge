#!/usr/bin/env tsx
/**
 * Pre-Compute Contract Docs — Static JSON Bundle
 *
 * Generates contract documentation for high-value contracts from the
 * registry and writes results to src/cache/data/precomputed-docs.json.
 *
 * This JSON file is loaded at cold start (same pattern as registry.json)
 * and serves as an instant, zero-cost cache for contract-docs requests.
 *
 * Uses Claude Haiku 4.5 for all contracts:
 *   - ~15-30 seconds per contract
 *   - ~$0.01-0.02 per contract
 *   - Fast, cost-efficient, excellent performance on contract analysis
 *
 * Usage:
 *   npm run precompute:docs                        # default limit 1000
 *   npm run precompute:docs -- --limit 5           # small test run
 *   npm run precompute:docs -- --resume            # skip already-cached entries
 *   npm run precompute:docs -- --resume --limit 500
 */

import dotenv from 'dotenv';
dotenv.config();

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRegistry } from '../src/registry/lookup.js';
import { config } from '../src/config.js';
import { cleanLlmJson } from '../src/utils/cleanJson.js';
import {
  contractDocsOutput,
  type ContractDocsOutput,
} from '../src/schemas/contractDocs.js';
import {
  fetchContractSource,
  parseAbi,
  type AbiEntry,
} from '../src/services/dataSources/etherscan.js';
import type { ContractLabel } from '../src/registry/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.resolve(__dirname, '../src/cache/data/precomputed-docs.json');

// ── CLI args ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name: string, defaultVal: number): number {
  const idx = args.indexOf(`--${name}`);
  if (idx >= 0 && args[idx + 1]) return Number(args[idx + 1]);
  return defaultVal;
}
const hasFlag = (name: string) => args.includes(`--${name}`);

const LIMIT = getArg('limit', 1000);
const RESUME = hasFlag('resume');

// ── Model selection (Haiku / Sonnet tiering) ──────────────────────────

interface ModelConfig {
  model: string;
  label: string;
  inputPricePer1M: number;
  outputPricePer1M: number;
}

const HAIKU: ModelConfig = {
  model: 'claude-haiku-4-5-20251001',
  label: 'Haiku',
  inputPricePer1M: 1.00,
  outputPricePer1M: 5.00,
};

const SONNET: ModelConfig = {
  model: 'claude-sonnet-4-20250514',
  label: 'Sonnet',
  inputPricePer1M: 3.00,
  outputPricePer1M: 15.00,
};

function selectModel(_funcCount: number): ModelConfig {
  // Use Sonnet for retry pass: handles large ABIs that Haiku truncates
  return SONNET;
}

async function callClaudeWithModel(params: {
  system: string;
  userMessage: string;
  maxTokens: number;
  temperature: number;
  modelConfig: ModelConfig;
}): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number; estimatedCostUsd: number } }> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: params.modelConfig.model,
      max_tokens: params.maxTokens,
      temperature: params.temperature,
      system: params.system,
      messages: [{ role: 'user', content: params.userMessage }],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude API error ${response.status}: ${error}`);
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text?: string }>;
    usage: { input_tokens: number; output_tokens: number };
  };

  const textBlock = data.content.find((b) => b.type === 'text');
  if (!textBlock?.text) throw new Error('Claude returned no text content');

  const inputCost = (data.usage.input_tokens / 1_000_000) * params.modelConfig.inputPricePer1M;
  const outputCost = (data.usage.output_tokens / 1_000_000) * params.modelConfig.outputPricePer1M;

  return {
    text: textBlock.text,
    usage: {
      inputTokens: data.usage.input_tokens,
      outputTokens: data.usage.output_tokens,
      estimatedCostUsd: inputCost + outputCost,
    },
  };
}

// ── Inline doc generation ─────────────────────────────────────────────

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

function buildAbiSummary(entries: AbiEntry[], MAX_FUNCS = 35): string {
  const functions = entries.filter((e) => e.type === 'function');
  const events = entries.filter((e) => e.type === 'event');
  const filtered = functions.slice(0, MAX_FUNCS);

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

async function generateDocs(
  address: string,
  chain: string,
  registryEntry: ContractLabel | null,
): Promise<{ output: ContractDocsOutput; costUsd: number; modelUsed: string; funcCount: number } | null> {
  const startTime = Date.now();
  const source = await fetchContractSource(address, chain);

  if (!source || !source.isVerified || !source.abi) {
    return null; // skip unverified
  }

  // Proxy-following
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
    const implSource = await fetchContractSource(source.implementationAddress, chain);
    if (implSource && implSource.isVerified && implSource.abi) {
      let proxyType: string | undefined;
      let governanceFramework: string | undefined;
      const proxySrc = source.sourceCode?.toLowerCase() ?? '';

      if (proxySrc.includes('erc897') || proxySrc.includes('ercproxy')) proxyType = 'ERC-897';
      else if (proxySrc.includes('eip1967') || proxySrc.includes('_implementation_slot')) proxyType = 'ERC-1967';
      else if (proxySrc.includes('uupsupgradeable')) proxyType = 'UUPS';
      else if (proxySrc.includes('transparentupgradeableproxy')) proxyType = 'TransparentProxy';

      if (proxySrc.includes('aragon')) governanceFramework = 'Aragon';
      else if (proxySrc.includes('openzeppelin')) governanceFramework = 'OpenZeppelin';
      else if (proxySrc.includes('gnosis') || proxySrc.includes('safe')) governanceFramework = 'Gnosis Safe';

      proxyInfoData = {
        isProxy: true,
        proxyType,
        proxyAddress: address,
        implementationAddress: source.implementationAddress,
        governanceFramework,
        note: `Documentation reflects the implementation contract logic at ${source.implementationAddress}. The proxy at ${address} delegates all calls via ${proxyType ?? 'delegatecall'}.`,
      };

      effectiveSource = { ...implSource, isProxy: true, implementationAddress: source.implementationAddress };
    }
  }

  const abiEntries = parseAbi(effectiveSource.abi!);
  const funcCount = abiEntries.filter((e) => e.type === 'function').length;

  // For large ABIs: cap documented functions to keep JSON output under max_tokens.
  // ~350 tokens per complex DeFi function; 15 funcs × 350 ≈ 5250 → fits in 8192.
  // For small/medium ABIs include source code context for richer descriptions.
  const isXLAbi = funcCount > 50;   // e.g. Curve pools (61 funcs)
  const isLargeAbi = funcCount > 25; // e.g. Aave, Compound (30-50 funcs)
  const maxFuncs = isXLAbi ? 15 : isLargeAbi ? 20 : 35;
  const abiSummary = buildAbiSummary(abiEntries, maxFuncs);

  let sourceContext = '';
  if (!isLargeAbi && effectiveSource.sourceCode && effectiveSource.sourceCode.length > 0) {
    sourceContext = `\n\nSOURCE CODE (truncated):\n${effectiveSource.sourceCode.slice(0, 6000)}`;
  }

  let proxyNote = '';
  if (proxyInfoData) {
    proxyNote = `\nNOTE: This is a PROXY contract at ${address}. You are documenting the IMPLEMENTATION at ${source.implementationAddress}.`;
  }

  let registryNote = '';
  if (registryEntry) {
    registryNote = `\nKnown Protocol: ${registryEntry.protocol ?? 'unknown'} | Category: ${registryEntry.category ?? 'unknown'} | Risk: ${registryEntry.riskLevel ?? 'unknown'}`;
  }

  const contractName = registryEntry?.name ?? effectiveSource.contractName ?? address;
  const prompt = `Contract: ${contractName}\nChain: ${chain}\nCompiler: ${effectiveSource.compilerVersion ?? 'unknown'}${proxyNote}${registryNote}\n\nABI:\n${abiSummary}${sourceContext}`;

  const effectiveFuncCount = Math.min(funcCount, maxFuncs);
  // Give generous token budget: 8192 for all cases where output might need it
  const maxTokens = effectiveFuncCount <= 12 ? 4000 : 8192;

  // Model tiering: Haiku for simple contracts, Sonnet for complex ones
  const modelConfig = selectModel(funcCount);

  const response = await callClaudeWithModel({
    system: SYSTEM_PROMPT,
    userMessage: prompt,
    maxTokens,
    temperature: 0.1,
    modelConfig,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleanLlmJson(response.text));
  } catch {
    throw new Error(`LLM returned invalid JSON: ${response.text.slice(0, 200)}`);
  }

  const llmResult = parsed as Record<string, unknown>;

  const output = contractDocsOutput.parse({
    contract: {
      address,
      chain,
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
      totalFunctions: funcCount,
      readFunctions: 0,
      writeFunctions: 0,
      adminFunctions: 0,
      riskLevel: 'medium',
      overview: 'Documentation generated from contract ABI.',
    },
    metadata: {
      model: modelConfig.model,
      processingTimeMs: Date.now() - startTime,
      estimatedCostUsd: response.usage.estimatedCostUsd,
      abiSize: abiEntries.length,
    },
    relatedServices: [
      {
        endpoint: '/v1/contract-monitor',
        description: 'Monitor recent admin activity on this contract',
        suggestedInput: { address, chain },
      },
    ],
  });

  return { output, costUsd: response.usage.estimatedCostUsd, modelUsed: modelConfig.label, funcCount };
}

// ── Priority scoring ─────────────────────────────────────────────────

function priorityScore(entry: ContractLabel): number {
  let score = 0;
  if (entry.chain === 'ethereum') score += 10;
  else if (entry.chain === 'base') score += 7;
  else if (entry.chain === 'arbitrum') score += 6;
  else if (entry.chain === 'polygon' || entry.chain === 'optimism') score += 5;
  else if (entry.chain === 'avalanche') score += 4;
  else if (entry.chain === 'bsc') score += 3;
  else score += 1;

  const highValueCats = ['dex', 'lending', 'stablecoin', 'liquid-staking', 'bridge'];
  if (entry.category && highValueCats.includes(entry.category)) score += 8;
  else if (entry.category === 'token' || entry.category === 'governance') score += 5;
  else if (entry.category === 'oracle' || entry.category === 'derivatives') score += 6;
  else if (entry.category === 'yield' || entry.category === 'nft-marketplace') score += 4;
  else if (entry.category === 'multisig' || entry.category === 'infrastructure') score += 3;

  if (entry.protocol) score += 3;
  if (entry.riskLevel === 'safe') score += 4;
  else if (entry.riskLevel === 'low') score += 2;
  if (entry.source === 'manual') score += 5;
  else if (entry.source === 'curated') score += 4;

  return score;
}

// ── Main ──────────────────────────────────────────────────────────────

interface PrecomputedEntry {
  address: string;
  chain: string;
  docs: ContractDocsOutput;
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║   Contract Docs Pre-Compute → Static JSON Bundle       ║');
  console.log('║   Stage 2: Haiku 4.5 (Cost-Optimized)                 ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log();

  // Always load existing entries when --resume is set
  let existingEntries: PrecomputedEntry[] = [];
  const existingKeys = new Set<string>();

  if (fs.existsSync(OUTPUT_PATH)) {
    const existing = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf-8'));
    existingEntries = existing.entries ?? [];
    for (const e of existingEntries) {
      existingKeys.add(`${e.chain}:${e.address.toLowerCase()}`);
    }
    console.log(`  Existing cache: ${existingEntries.length} entries`);
  }

  const registry = getRegistry();
  const stats = registry.getStats();
  console.log(`  Registry: ${stats.totalEntries} entries across ${stats.chains.length} chains`);

  // Gather ALL registry entries as candidates (not just specific categories)
  const allRegistryEntries = registry.getAllEntries();

  // Deduplicate by address:chain
  const seen = new Set<string>();
  const unique: ContractLabel[] = [];
  for (const entry of allRegistryEntries) {
    const key = `${entry.address.toLowerCase()}:${entry.chain}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(entry);
    }
  }

  // Sort by priority, take top N
  const sorted = unique.sort((a, b) => priorityScore(b) - priorityScore(a));
  const targets = sorted.slice(0, LIMIT);

  // Filter out already-cached entries (--resume behavior: always skip cached)
  const toCompute = RESUME
    ? targets.filter((t) => !existingKeys.has(`${t.chain}:${t.address.toLowerCase()}`))
    : targets;

  console.log(`  Candidates: ${unique.length} unique contracts`);
  console.log(`  Targets: ${targets.length} (limit: ${LIMIT})`);
  if (RESUME) {
    console.log(`  Already cached (skipping): ${targets.length - toCompute.length}`);
  }
  console.log(`  To compute: ${toCompute.length}`);
  console.log(`  Model: Claude Haiku 4.5 (all contracts)`);
  console.log();

  const newEntries: PrecomputedEntry[] = [];
  let totalCost = 0;
  let failedCount = 0;
  const failures: Array<{ name: string; chain: string; error: string }> = [];

  // Incremental save interval
  const SAVE_INTERVAL = 10; // Save every 10 *attempts* (not just successes)
  const REPORT_INTERVAL = 200; // Report every 200 contracts

  for (let i = 0; i < toCompute.length; i++) {
    const entry = toCompute[i];
    const globalIdx = existingEntries.length + newEntries.length + 1;
    const label = `[${i + 1}/${toCompute.length}]`;

    process.stdout.write(`  ${label} ⏳ ${entry.name} (${entry.chain})...`);
    const start = Date.now();

    try {
      const registryEntry = registry.lookup(entry.address, entry.chain);
      const result = await generateDocs(entry.address, entry.chain, registryEntry);

      const elapsed = Date.now() - start;

      if (!result) {
        console.log(` ⊘ unverified (${elapsed}ms)`);
        failedCount++;
        failures.push({ name: entry.name, chain: entry.chain, error: 'Not verified on Etherscan' });
      } else {
        const isProxy = result.output.contract.isProxy ? ' [proxy]' : '';
        console.log(` ✓ ${result.funcCount}f${isProxy} (${(elapsed / 1000).toFixed(1)}s, $${result.costUsd.toFixed(4)})`);
        newEntries.push({
          address: entry.address,
          chain: entry.chain,
          docs: result.output,
        });
        totalCost += result.costUsd;
      }
    } catch (error) {
      const elapsed = Date.now() - start;
      const msg = error instanceof Error ? error.message : String(error);
      console.log(` ✗ FAILED (${(elapsed / 1000).toFixed(1)}s): ${msg.slice(0, 100)}`);
      failedCount++;
      failures.push({ name: entry.name, chain: entry.chain, error: msg.slice(0, 150) });
    }

    // Incremental save every N *attempts* (crash recovery — not dependent on success count)
    if (newEntries.length > 0 && (i + 1) % SAVE_INTERVAL === 0) {
      const interim = [...existingEntries, ...newEntries];
      const interimData = { version: '1.0.0', generatedAt: new Date().toISOString(), entries: interim };
      fs.writeFileSync(OUTPUT_PATH, JSON.stringify(interimData, null, 2) + '\n');
      process.stdout.write(`  💾 Saved checkpoint: ${interim.length} total entries\n`);
    }

    // Progress report every REPORT_INTERVAL contracts
    if ((i + 1) % REPORT_INTERVAL === 0) {
      const totalSoFar = existingEntries.length + newEntries.length;
      const avgCostPerContract = newEntries.length > 0 ? (totalCost / newEntries.length).toFixed(4) : '0';
      console.log();
      console.log(`  ── Progress Report (${i + 1}/${toCompute.length}) ──`);
      console.log(`  Total cached: ${totalSoFar}`);
      console.log(`  New this run: ${newEntries.length}`);
      console.log(`  Failed: ${failedCount}`);
      console.log(`  Cumulative cost: $${totalCost.toFixed(4)} (avg $${avgCostPerContract}/contract)`);
      console.log();
    }

    // Rate limit — 8s between requests to respect Claude API rate limits
    // (5s was too short when prior request failed fast, leaving a ~5.5s effective gap)
    if (i < toCompute.length - 1) {
      await new Promise((r) => setTimeout(r, 8000));
    }
  }

  // ── Final merge and write ────────────────────────────────────────────

  const allCachedEntries = [...existingEntries, ...newEntries];

  const outputData = {
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    entries: allCachedEntries,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(outputData, null, 2) + '\n');

  // ── Summary ────────────────────────────────────────────────────────

  const proxyCount = allCachedEntries.filter(
    (e) => e.docs.contract.isProxy && e.docs.contract.implementationAddress,
  ).length;
  const directCount = allCachedEntries.length - proxyCount;

  // Chain breakdown
  const chainCounts = new Map<string, number>();
  for (const e of allCachedEntries) {
    chainCounts.set(e.chain, (chainCounts.get(e.chain) ?? 0) + 1);
  }

  console.log();
  console.log('════════════════════════════════════════════════════════════');
  console.log('  FINAL RESULTS');
  console.log('════════════════════════════════════════════════════════════');
  console.log(`  New this run:   ${newEntries.length} contracts (Haiku 4.5)`);
  console.log(`  Existing:       ${existingEntries.length} contracts preserved`);
  console.log(`  Failed:         ${failedCount}`);
  console.log(`  ────────────────────────────────────`);
  console.log(`  Total cached:   ${allCachedEntries.length}`);
  console.log(`  Proxy-resolved: ${proxyCount}`);
  console.log(`  Direct:         ${directCount}`);
  const avgCost = newEntries.length > 0 ? (totalCost / newEntries.length).toFixed(4) : '0';
  console.log(`  LLM cost:       $${totalCost.toFixed(4)} (avg $${avgCost}/contract)`);
  console.log(`  Output:         ${OUTPUT_PATH}`);
  console.log(`  File size:      ${(fs.statSync(OUTPUT_PATH).size / 1024 / 1024).toFixed(2)} MB`);

  console.log();
  console.log('  By chain:');
  for (const [chain, count] of [...chainCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${chain}: ${count}`);
  }

  if (failures.length > 0) {
    console.log();
    console.log(`  Failed contracts (${failures.length}):`);
    for (const f of failures.slice(0, 30)) {
      console.log(`    - ${f.name} (${f.chain}): ${f.error}`);
    }
    if (failures.length > 30) {
      console.log(`    ... and ${failures.length - 30} more`);
    }
  }

  console.log();
}

main().catch((err) => {
  console.error('Pre-compute failed:', err);
  process.exit(1);
});
