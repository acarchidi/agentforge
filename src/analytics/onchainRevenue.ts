/**
 * Outside-revenue summary from on-chain USDC transfers into our pay-to addresses.
 * Chain data is the source of truth: it does not depend on the Neon record,
 * which drops rows when the database times out on a cold start.
 */

export interface Transfer {
  /** ISO timestamp of the block. */
  ts: string;
  from: string;
  /** USD value (USDC has 6 decimals; callers convert). */
  usd: number;
  chain: "Base" | "Solana";
  tx: string;
}

export interface RevenueSummary {
  payments: number;
  usd: number;
  payers: number;
  last30d: { payments: number; usd: number; payers: number };
  byMonth: Record<string, { payments: number; usd: number; payers: number }>;
  topPayers: Array<{ payer: string; payments: number; usd: number }>;
}

/** Our own buyer test wallets; their payments are not outside revenue. */
export const TEST_PAYERS = new Set([
  "0x794241c8b08c4b91ff840a64ecd74ff9bdf7c135", // Base buyer test wallet
  "2Yz9zLptbTPLzxH1FgZzeQePLBnntvrNUU4qHYweJu6T", // Solana buyer test wallet
]);

function isTestPayer(from: string): boolean {
  return TEST_PAYERS.has(from) || TEST_PAYERS.has(from.toLowerCase());
}

function bucket(rows: Transfer[]) {
  return {
    payments: rows.length,
    usd: round(rows.reduce((sum, r) => sum + r.usd, 0)),
    payers: new Set(rows.map((r) => r.from.toLowerCase())).size,
  };
}

function round(usd: number): number {
  return Math.round(usd * 1e6) / 1e6;
}

/**
 * Summarize outside payments. Callers must pass only transfers of the real
 * USDC contract/mint, so address-poisoning spam with fake tokens is already out.
 */
export function summarizeRevenue(
  transfers: Transfer[],
  now = new Date(),
): RevenueSummary {
  const outside = transfers.filter((t) => !isTestPayer(t.from));
  const cutoff = now.getTime() - 30 * 24 * 60 * 60 * 1000;

  const months = new Map<string, Transfer[]>();
  const payers = new Map<string, Transfer[]>();
  for (const t of outside) {
    const month = t.ts.slice(0, 7);
    months.set(month, [...(months.get(month) ?? []), t]);
    const payer = t.from.toLowerCase();
    payers.set(payer, [...(payers.get(payer) ?? []), t]);
  }

  return {
    ...bucket(outside),
    last30d: bucket(outside.filter((t) => Date.parse(t.ts) >= cutoff)),
    byMonth: Object.fromEntries(
      [...months].sort().map(([m, rows]) => [m, bucket(rows)]),
    ),
    topPayers: [...payers]
      .map(([payer, rows]) => ({
        payer,
        payments: rows.length,
        usd: bucket(rows).usd,
      }))
      .sort((a, b) => b.usd - a.usd || b.payments - a.payments)
      .slice(0, 10),
  };
}
