/**
 * Holder concentration analysis.
 * Pure functions — testable without external calls.
 */

// Known burn / dead addresses to exclude from concentration calculations
const BURN_ADDRESSES = new Set([
  '0x0000000000000000000000000000000000000000',
  '0x000000000000000000000000000000000000dead',
  '0x0000000000000000000000000000000000000001',
]);

export type ConcentrationRisk = 'low' | 'medium' | 'high' | 'critical';

export interface HolderEntry {
  address: string;
  rawBalance: bigint;
  pct: number;
  isContract: boolean;
}

export interface ConcentrationResult {
  top10HolderPct: number;
  top10Addresses: Array<{
    address: string;
    label?: string;
    pct: number;
    isContract: boolean;
  }>;
  concentrationRisk: ConcentrationRisk;
}

// ── Pure scoring ──────────────────────────────────────────────────────

/** Map raw top10 percentage to a risk level. */
export function scoreConcentration(top10HolderPct: number): ConcentrationRisk {
  if (top10HolderPct < 30) return 'low';
  if (top10HolderPct < 50) return 'medium';
  if (top10HolderPct < 70) return 'high';
  return 'critical';
}

/** Parse Etherscan token holder list into HolderEntry array. */
export function parseHolderList(
  raw: Array<{ TokenHolderAddress: string; TokenHolderQuantity: string }>,
): HolderEntry[] {
  return raw.map((h) => ({
    address: h.TokenHolderAddress.toLowerCase(),
    rawBalance: BigInt(h.TokenHolderQuantity),
    pct: 0, // filled by computeHolderPct
    isContract: false, // unknown without on-chain call; set by caller if available
  }));
}

/** Compute what percentage of totalSupply a balance represents. */
export function computeHolderPct(balance: bigint, totalSupply: bigint): number {
  if (totalSupply === 0n) return 0;
  return Number((balance * 10_000n) / totalSupply) / 100;
}

/**
 * Compute concentration risk from raw holder data.
 * - Excludes known burn addresses
 * - Enriches addresses with registry labels
 */
export function computeConcentrationRisk(
  holders: HolderEntry[],
  totalSupply: bigint,
  registry: { lookup(addr: string, chain?: string): { name: string; category?: string } | null } | null,
): ConcentrationResult {
  // Exclude burn addresses
  const nonBurn = holders.filter((h) => !BURN_ADDRESSES.has(h.address.toLowerCase()));

  // Compute percentages for remaining holders
  const withPct = nonBurn.map((h) => ({
    ...h,
    pct: computeHolderPct(h.rawBalance, totalSupply),
  }));

  // Take top 10 by percentage
  const top10 = withPct
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 10);

  const top10HolderPct = top10.reduce((sum, h) => sum + h.pct, 0);

  // Enrich with registry labels
  const labeled = top10.map((h) => {
    const entry = registry?.lookup(h.address);
    return {
      address: h.address,
      label: entry?.name,
      pct: h.pct,
      isContract: h.isContract,
    };
  });

  return {
    top10HolderPct,
    top10Addresses: labeled,
    concentrationRisk: scoreConcentration(top10HolderPct),
  };
}
