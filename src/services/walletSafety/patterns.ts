/**
 * Suspicious Pattern Detection for Wallet Safety Check
 *
 * Each detection function is pure and independently testable.
 * Takes transaction/approval data and returns a PatternMatch or null.
 */

import type { PatternMatch } from '../../schemas/walletSafety.js';

// ── Types used by pattern functions ──────────────────────────────────

export interface TransactionRecord {
  hash: string;
  from: string;
  to: string;
  value: string;
  timestamp: number;
  functionName?: string;
  isError?: string;
}

export interface ApprovalRecord {
  hash: string;
  token: string;
  spender: string;
  allowance: string;
  timestamp: number;
}

export interface RegistryEntry {
  address: string;
  name: string;
  chain: string;
  riskLevel: string;
  category: string;
  tags?: string[];
}

export interface PermitRecord {
  hash: string;
  spender: string;
  timestamp: number;
}

// ── Constants ────────────────────────────────────────────────────────

const ONE_DAY = 86_400; // seconds

// ── Pattern 1: rapid-approvals ───────────────────────────────────────

/**
 * Trigger: >3 token approvals within any 24-hour window in the last 30 days.
 * Severity: warning
 * Why: Phishing attacks often batch approval requests.
 */
export function detectRapidApprovals(approvals: ApprovalRecord[]): PatternMatch | null {
  if (approvals.length <= 3) return null;

  // Sort by timestamp ascending
  const sorted = [...approvals].sort((a, b) => a.timestamp - b.timestamp);

  // Sliding window: for each approval, count how many fall within +24h
  for (let i = 0; i < sorted.length; i++) {
    const windowStart = sorted[i].timestamp;
    const windowEnd = windowStart + ONE_DAY;
    const windowApprovals = sorted.filter(
      (a) => a.timestamp >= windowStart && a.timestamp <= windowEnd,
    );

    if (windowApprovals.length > 3) {
      return {
        pattern: 'rapid-approvals',
        severity: 'warning',
        description: `${windowApprovals.length} token approvals within a 24-hour window`,
        transactions: windowApprovals.map((a) => a.hash),
      };
    }
  }

  return null;
}

// ── Pattern 2: interaction-with-flagged ──────────────────────────────

/**
 * Trigger: Any transaction to/from an address with riskLevel 'high' or 'critical'.
 * Severity: danger
 * Why: Direct interaction with known-bad contracts.
 */
export function detectInteractionWithFlagged(
  txs: TransactionRecord[],
  registry: RegistryEntry[],
): PatternMatch | null {
  const flaggedAddresses = new Map<string, RegistryEntry>();
  for (const entry of registry) {
    if (entry.riskLevel === 'high' || entry.riskLevel === 'critical') {
      flaggedAddresses.set(entry.address.toLowerCase(), entry);
    }
  }

  if (flaggedAddresses.size === 0) return null;

  const matchedTxs: string[] = [];

  for (const tx of txs) {
    const toMatch = flaggedAddresses.get(tx.to.toLowerCase());
    const fromMatch = flaggedAddresses.get(tx.from.toLowerCase());
    if (toMatch || fromMatch) {
      matchedTxs.push(tx.hash);
    }
  }

  if (matchedTxs.length === 0) return null;

  return {
    pattern: 'interaction-with-flagged',
    severity: 'danger',
    description: `Transaction to address flagged as high risk in registry`,
    transactions: matchedTxs,
  };
}

// ── Pattern 3: unverified-contract-approval ──────────────────────────

/**
 * Trigger: Token approval granted to a contract that is not verified on Etherscan.
 * Severity: warning
 * Why: Unverified contracts can't be inspected for malicious logic.
 */
export function detectUnverifiedContractApproval(
  approvals: ApprovalRecord[],
  verifiedContracts: Set<string>,
): PatternMatch | null {
  const matchedTxs: string[] = [];

  for (const approval of approvals) {
    if (!verifiedContracts.has(approval.spender.toLowerCase())) {
      matchedTxs.push(approval.hash);
    }
  }

  if (matchedTxs.length === 0) return null;

  return {
    pattern: 'unverified-contract-approval',
    severity: 'warning',
    description: `Token approval granted to ${matchedTxs.length} unverified contract(s)`,
    transactions: matchedTxs,
  };
}

// ── Pattern 4: mixer-interaction ─────────────────────────────────────

/**
 * Trigger: Any transaction to an address tagged as 'mixer' in registry.
 * Severity: danger
 * Why: Indicates funds laundering or association with laundered funds.
 */
export function detectMixerInteraction(
  txs: TransactionRecord[],
  registry: RegistryEntry[],
): PatternMatch | null {
  const mixerAddresses = new Set<string>();
  for (const entry of registry) {
    if (entry.tags?.includes('mixer')) {
      mixerAddresses.add(entry.address.toLowerCase());
    }
  }

  if (mixerAddresses.size === 0) return null;

  const matchedTxs: string[] = [];

  for (const tx of txs) {
    if (mixerAddresses.has(tx.to.toLowerCase()) || mixerAddresses.has(tx.from.toLowerCase())) {
      matchedTxs.push(tx.hash);
    }
  }

  if (matchedTxs.length === 0) return null;

  return {
    pattern: 'mixer-interaction',
    severity: 'danger',
    description: `Transaction to address tagged as mixer in registry`,
    transactions: matchedTxs,
  };
}

// ── Pattern 5: large-outflow-new-address ─────────────────────────────

/**
 * Trigger: Transfer of >$10,000 equivalent to an address with no prior tx history.
 * Severity: warning
 * Why: Could indicate compromised wallet or social engineering.
 */
export function detectLargeOutflowNewAddress(
  txs: TransactionRecord[],
  walletAddress: string,
  priorInteractions: Set<string>,
  ethPriceUsd: number,
): PatternMatch | null {
  const THRESHOLD_USD = 10_000;
  const wallet = walletAddress.toLowerCase();
  const matchedTxs: string[] = [];

  for (const tx of txs) {
    if (tx.from.toLowerCase() !== wallet) continue;
    if (!tx.to) continue;

    const toAddr = tx.to.toLowerCase();
    if (priorInteractions.has(toAddr)) continue;

    // Convert wei to ETH, then to USD
    const valueWei = BigInt(tx.value);
    const valueEth = Number(valueWei) / 1e18;
    const valueUsd = valueEth * ethPriceUsd;

    if (valueUsd > THRESHOLD_USD) {
      matchedTxs.push(tx.hash);
    }
  }

  if (matchedTxs.length === 0) return null;

  return {
    pattern: 'large-outflow-new-address',
    severity: 'warning',
    description: `Transfer of >$10,000 to an address with no prior transaction history`,
    transactions: matchedTxs,
  };
}

// ── Pattern 6: approval-to-eoa ───────────────────────────────────────

/**
 * Trigger: Token approval granted to an externally owned account (not a contract).
 * Severity: danger
 * Why: Legitimate approvals go to smart contracts (DEX routers, etc.), not EOAs.
 */
export function detectApprovalToEOA(
  approvals: ApprovalRecord[],
  contractAddresses: Set<string>,
): PatternMatch | null {
  const matchedTxs: string[] = [];

  for (const approval of approvals) {
    if (!contractAddresses.has(approval.spender.toLowerCase())) {
      matchedTxs.push(approval.hash);
    }
  }

  if (matchedTxs.length === 0) return null;

  return {
    pattern: 'approval-to-eoa',
    severity: 'danger',
    description: `Token approval granted to ${matchedTxs.length} EOA(s) instead of contracts`,
    transactions: matchedTxs,
  };
}

// ── Pattern 7: phishing-signature ────────────────────────────────────

/**
 * Trigger: Permit/permit2 signature to address not in registry or <30 days deployment.
 * Severity: danger
 * Why: Common phishing vector.
 */
export function detectPhishingSignature(
  permits: PermitRecord[],
  registryAddresses: Set<string>,
  deploymentAges: Map<string, number>,
): PatternMatch | null {
  const matchedTxs: string[] = [];

  for (const permit of permits) {
    const spender = permit.spender.toLowerCase();

    // Skip if known in registry
    if (registryAddresses.has(spender)) continue;

    // Check deployment age — <30 days is suspicious
    const age = deploymentAges.get(spender);
    if (age === undefined || age < 30) {
      matchedTxs.push(permit.hash);
    }
  }

  if (matchedTxs.length === 0) return null;

  return {
    pattern: 'phishing-signature',
    severity: 'danger',
    description: `Permit signature to ${matchedTxs.length} address(es) not in registry or recently deployed`,
    transactions: matchedTxs,
  };
}
