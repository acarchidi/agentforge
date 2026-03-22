/**
 * Contract permission detection from ABI.
 * Pure functions — no external calls, fully testable.
 */

// ── Signature lists ────────────────────────────────────────────────────

const MINT_SIGNATURES = new Set(['mint', 'mintto', '_mint', 'minttokens', 'issue', 'create', 'generatetokens']);
const BURN_SIGNATURES = new Set(['burn', 'burnfrom', '_burn', 'burntokens', 'destroy', 'redeem', 'retire']);
const PAUSE_SIGNATURES = new Set(['pause', 'unpause', 'setpaused', 'emergencystop']);
const BLACKLIST_SIGNATURES = new Set(['blacklist', 'addblacklist', 'deny', 'freeze', 'addtoblacklist', 'ban', 'block', 'blocklist', 'setblacklist', 'adddenylist', 'denylist']);
const OWNER_SIGNATURES = new Set(['owner', 'transferownership', 'renounceownership', 'setowner', 'admin', 'getadmin']);

// ── Types ──────────────────────────────────────────────────────────────

export interface AbiFunction {
  name: string;
  type: string;
  stateMutability?: string;
  inputs?: unknown[];
  outputs?: unknown[];
}

export interface PermissionFlags {
  canMint: boolean;
  canBurn: boolean;
  canPause: boolean;
  canBlacklist: boolean;
  canUpgrade: boolean;
  hasOwner: boolean;
}

export type PermissionRisk = 'none' | 'low' | 'medium' | 'high' | 'critical';

// ── Detection ─────────────────────────────────────────────────────────

/**
 * Parse a contract ABI to detect dangerous permission functions.
 * Only considers non-view, non-pure functions (state-mutating).
 * The canUpgrade flag is passed in separately (from contract-docs proxy detection).
 */
export function detectPermissions(
  abi: AbiFunction[],
  options: { canUpgrade?: boolean } = {},
): PermissionFlags {
  // Only consider state-mutating functions
  const mutateFns = abi.filter(
    (fn) =>
      fn.type === 'function' &&
      fn.stateMutability !== 'view' &&
      fn.stateMutability !== 'pure',
  );

  const names = mutateFns.map((fn) => fn.name.toLowerCase());

  return {
    canMint: names.some((n) => MINT_SIGNATURES.has(n)),
    canBurn: names.some((n) => BURN_SIGNATURES.has(n)),
    canPause: names.some((n) => PAUSE_SIGNATURES.has(n)),
    canBlacklist: names.some((n) => BLACKLIST_SIGNATURES.has(n)),
    canUpgrade: options.canUpgrade ?? false,
    hasOwner: abi.some((fn) => OWNER_SIGNATURES.has(fn.name?.toLowerCase() ?? '')),
  };
}

/**
 * Score permission risk based on detected capabilities.
 *
 * Risk levels:
 *  none     — no owner, no special permissions
 *  low      — has owner but no dangerous capabilities
 *  medium   — can pause OR can upgrade
 *  high     — can mint OR can blacklist (but not combined with each other in dangerous ways)
 *  critical — can mint AND (can pause OR can blacklist)
 */
export function scorePermissionRisk(flags: PermissionFlags): PermissionRisk {
  if (!flags.hasOwner && !flags.canMint && !flags.canPause && !flags.canBlacklist && !flags.canUpgrade) {
    return 'none';
  }

  const dangerous = flags.canMint && (flags.canPause || flags.canBlacklist);
  if (dangerous) return 'critical';

  if (flags.canMint || flags.canBlacklist) return 'high';

  if (flags.canPause || flags.canUpgrade) return 'medium';

  if (flags.hasOwner) return 'low';

  return 'none';
}
