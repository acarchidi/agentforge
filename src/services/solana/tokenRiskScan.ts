import { callClaude } from '../../llm/anthropic.js';
import { solanaRpc } from '../dataSources/solana.js';
import { fetchHeliusAsset } from '../dataSources/helius.js';
import { fetchDexScreenerData } from '../dataSources/dexscreener.js';
import { getSolanaProgramRegistry } from '../../registry/solanaPrograms.js';
import type { SolanaTokenRiskScanInput, SolanaTokenRiskScanOutput } from '../../schemas/solanaTokenRiskScan.js';

// ── Base weights (must sum to 100) ──────────────────────────────────
const WEIGHT_MINT = 20;
const WEIGHT_FREEZE = 15;
const WEIGHT_CONCENTRATION = 30;
const WEIGHT_LIQUIDITY = 25;
const WEIGHT_METADATA = 10;

export interface AuthorityInfo {
  mintAuthority: string | null;
  freezeAuthority: string | null;
}

export function computeAuthorityFlags(info: AuthorityInfo): { canMint: boolean; canFreeze: boolean } {
  return {
    canMint: info.mintAuthority !== null,
    canFreeze: info.freezeAuthority !== null,
  };
}

interface HolderEntry {
  address: string;
  pct: number;
  isPool: boolean;
}

/**
 * Excludes pool/AMM-owned accounts from the top-holder list before computing
 * concentration — a DEX pool legitimately holding a large share isn't the
 * same risk signal as a single wallet holding it.
 */
export function excludePoolAccounts(
  accounts: Array<{ address: string; owner: string; pct: number }>,
): { nonPool: HolderEntry[]; poolCount: number } {
  const registry = getSolanaProgramRegistry();
  const nonPool: HolderEntry[] = [];
  let poolCount = 0;

  for (const acc of accounts) {
    const isPool = registry.isKnownPool(acc.owner);
    if (isPool) {
      poolCount++;
    }
    nonPool.push({ address: acc.address, pct: acc.pct, isPool });
  }

  return { nonPool, poolCount };
}

export function computeTop10Concentration(holders: HolderEntry[]): number {
  const nonPoolHolders = holders.filter((h) => !h.isPool).slice(0, 10);
  const sum = nonPoolHolders.reduce((acc, h) => acc + h.pct, 0);
  return Math.min(100, Math.round(sum * 100) / 100);
}

export interface ScoreInputs {
  canMint: boolean;
  canFreeze: boolean;
  top10ConcentrationPct: number;
  liquidityUsd: number | null;
  metadataMutable: boolean | null;
}

export interface ScoreResult {
  score: number;
  level: SolanaTokenRiskScanOutput['level'];
  flags: string[];
  weightsUsed: { mint: number; freeze: number; concentration: number; liquidity: number; metadata: number };
}

/**
 * Deterministic composite risk score, 0-100 (higher = riskier). No LLM
 * involved. When liquidity or metadata data is unavailable, that weight is
 * redistributed proportionally across the remaining available components so
 * the score always reflects a full 100-point scale of what we DO know,
 * rather than silently capping below 100 or treating "unknown" as "safe".
 */
export function computeCompositeScore(inputs: ScoreInputs): ScoreResult {
  const liquidityAvailable = inputs.liquidityUsd !== null;
  const metadataAvailable = inputs.metadataMutable !== null;

  const baseWeights = {
    mint: WEIGHT_MINT,
    freeze: WEIGHT_FREEZE,
    concentration: WEIGHT_CONCENTRATION,
    liquidity: liquidityAvailable ? WEIGHT_LIQUIDITY : 0,
    metadata: metadataAvailable ? WEIGHT_METADATA : 0,
  };

  const missingWeight =
    (liquidityAvailable ? 0 : WEIGHT_LIQUIDITY) + (metadataAvailable ? 0 : WEIGHT_METADATA);
  const availableTotal = baseWeights.mint + baseWeights.freeze + baseWeights.concentration + baseWeights.liquidity + baseWeights.metadata;

  const scaleFactor = missingWeight > 0 && availableTotal > 0 ? 100 / availableTotal : 1;
  const weightsUsed = {
    mint: baseWeights.mint * scaleFactor,
    freeze: baseWeights.freeze * scaleFactor,
    concentration: baseWeights.concentration * scaleFactor,
    liquidity: baseWeights.liquidity * scaleFactor,
    metadata: baseWeights.metadata * scaleFactor,
  };

  const flags: string[] = [];
  let score = 0;

  if (inputs.canMint) {
    score += weightsUsed.mint;
    flags.push('Mint authority is active — supply can be inflated at any time');
  }
  if (inputs.canFreeze) {
    score += weightsUsed.freeze;
    flags.push('Freeze authority is active — holder accounts can be frozen');
  }

  const concentrationRisk = (Math.min(100, inputs.top10ConcentrationPct) / 100) * weightsUsed.concentration;
  score += concentrationRisk;
  if (inputs.top10ConcentrationPct >= 50) {
    flags.push(`Top 10 non-pool holders control ${inputs.top10ConcentrationPct.toFixed(1)}% of supply`);
  }

  if (liquidityAvailable) {
    // $0 liquidity -> full liquidity weight as risk; $50k+ -> ~0 risk.
    const liquidityRisk = Math.max(0, weightsUsed.liquidity - (inputs.liquidityUsd! / 2000) * (weightsUsed.liquidity / 25));
    score += Math.min(weightsUsed.liquidity, liquidityRisk);
    if (inputs.liquidityUsd! < 5000) {
      flags.push(`Thin liquidity ($${inputs.liquidityUsd!.toFixed(0)}) — price impact and rug risk elevated`);
    }
  } else {
    flags.push('Liquidity data unavailable — risk weight redistributed to other factors');
  }

  if (metadataAvailable) {
    if (inputs.metadataMutable) {
      score += weightsUsed.metadata;
      flags.push('Token metadata is mutable — name/symbol/image can change post-launch');
    }
  } else {
    flags.push('Metadata unavailable — risk weight redistributed to other factors');
  }

  const finalScore = Math.max(0, Math.min(100, Math.round(score * 100) / 100));

  let level: ScoreResult['level'];
  if (finalScore < 10) level = 'safe';
  else if (finalScore < 30) level = 'low';
  else if (finalScore < 55) level = 'medium';
  else if (finalScore < 80) level = 'high';
  else level = 'critical';

  return { score: finalScore, level, flags, weightsUsed };
}

// ── Orchestration ─────────────────────────────────────────────────

interface ParsedMintAccountInfo {
  value: {
    data: {
      parsed: {
        info: {
          mintAuthority: string | null;
          freezeAuthority: string | null;
          supply: string;
          decimals: number;
        };
      };
    };
  } | null;
}

interface LargestAccountsResult {
  value: Array<{ address: string; amount: string; uiAmount: number }>;
}

interface TokenAccountOwnerInfo {
  value: { data: { parsed: { info: { owner: string } } } } | null;
}

export async function scanSolanaTokenRiskWithCost(
  input: SolanaTokenRiskScanInput,
): Promise<{ output: SolanaTokenRiskScanOutput; estimatedCostUsd: number }> {
  const mint = input.mint;

  const mintInfo = await solanaRpc<ParsedMintAccountInfo>('getAccountInfo', [
    mint,
    { encoding: 'jsonParsed' },
  ]);

  if (!mintInfo.value) {
    throw new Error(`Mint ${mint} not found on Solana — not a valid token mint`);
  }

  const { mintAuthority, freezeAuthority, supply, decimals } = mintInfo.value.data.parsed.info;
  const { canMint, canFreeze } = computeAuthorityFlags({ mintAuthority, freezeAuthority });

  // Holder concentration (best-effort — degrade gracefully on RPC issues)
  let holderEntries: HolderEntry[] = [];
  let holdersAvailable = false;
  try {
    const largest = await solanaRpc<LargestAccountsResult>('getTokenLargestAccounts', [mint]);
    const totalSupply = Number(supply) / 10 ** decimals || 1;

    const withOwners = await Promise.all(
      largest.value.slice(0, 20).map(async (acc) => {
        try {
          const accInfo = await solanaRpc<TokenAccountOwnerInfo>('getAccountInfo', [
            acc.address,
            { encoding: 'jsonParsed' },
          ]);
          const owner = accInfo.value?.data.parsed.info.owner ?? '';
          const pct = (acc.uiAmount / totalSupply) * 100;
          return { address: acc.address, owner, pct };
        } catch {
          return null;
        }
      }),
    );

    const resolved = withOwners.filter((v): v is { address: string; owner: string; pct: number } => v !== null);
    const { nonPool } = excludePoolAccounts(resolved);
    holderEntries = nonPool;
    holdersAvailable = true;
  } catch {
    holdersAvailable = false;
  }

  const top10Pct = holdersAvailable ? computeTop10Concentration(holderEntries) : 0;

  // Metadata (Helius DAS) — degrade gracefully, null on failure
  const asset = await fetchHeliusAsset(mint);
  const metadataAvailable = asset !== null;
  const metadataMutable = asset?.mutable ?? null;

  // Liquidity (DexScreener) — degrade gracefully, null on failure
  const dex = await fetchDexScreenerData(mint);
  const liquidityAvailable = dex !== null;

  const scoreResult = computeCompositeScore({
    canMint,
    canFreeze,
    top10ConcentrationPct: holdersAvailable ? top10Pct : 0,
    liquidityUsd: liquidityAvailable ? dex!.totalLiquidityUsd : null,
    metadataMutable: metadataAvailable ? (metadataMutable ?? false) : null,
  });

  if (!holdersAvailable) {
    scoreResult.flags.push('Holder concentration data unavailable');
  }

  let summary: string | undefined;
  let estimatedCostUsd = 0;
  try {
    const llm = await callClaude({
      model: 'claude-haiku-4-5-20251001',
      system: 'Summarize a token risk report in one plain-English sentence for a trader. Be direct.',
      userMessage: `Score: ${scoreResult.score}/100 (${scoreResult.level}). Flags: ${scoreResult.flags.join('; ')}`,
      maxTokens: 100,
    });
    summary = llm.text.trim();
    estimatedCostUsd = llm.usage.estimatedCostUsd;
  } catch {
    summary = undefined;
  }

  const output: SolanaTokenRiskScanOutput = {
    mint,
    authorities: {
      mintAuthority,
      canMint,
      freezeAuthority,
      canFreeze,
      supply,
      decimals,
    },
    holders: {
      top10Pct,
      entries: holderEntries.slice(0, 20).map((h) => ({ address: h.address, pct: h.pct, isPool: h.isPool })),
    },
    liquidity: {
      totalUsd: liquidityAvailable ? dex!.totalLiquidityUsd : null,
      volume24hUsd: liquidityAvailable ? dex!.totalVolume24hUsd : null,
      topPoolCount: liquidityAvailable ? dex!.pairCount : undefined,
      ageDays: liquidityAvailable && dex!.oldestPairCreatedAt
        ? Math.floor((Date.now() - dex!.oldestPairCreatedAt) / 86_400_000)
        : null,
      available: liquidityAvailable,
    },
    metadata: {
      name: asset?.content?.metadata?.name,
      symbol: asset?.content?.metadata?.symbol ?? asset?.token_info?.symbol,
      mutable: metadataMutable ?? undefined,
    },
    score: scoreResult.score,
    level: scoreResult.level,
    flags: scoreResult.flags,
    summary,
    dataCompleteness: {
      holdersAvailable,
      liquidityAvailable,
      metadataAvailable,
    },
    relatedServices: [
      {
        endpoint: '/v1/solana/tx-explain',
        description: "Explain this token's deploy or recent transactions",
        suggestedInput: { signature: '<a transaction signature involving this mint>' },
      },
      {
        endpoint: '/v1/solana/program-lookup',
        description: 'Look up the mint or freeze authority program',
        suggestedInput: { programId: mintAuthority ?? freezeAuthority ?? '' },
      },
    ],
  };

  return { output, estimatedCostUsd };
}
