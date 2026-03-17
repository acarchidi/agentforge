/**
 * Solana Data Source
 *
 * Provides RPC access to Solana mainnet for:
 * - SPL token accounts (for delegate/approval scanning)
 * - Transaction history (for activity analysis)
 *
 * Uses standard Solana JSON-RPC or Helius API if key provided.
 */

const DEFAULT_RPC = 'https://api.mainnet-beta.solana.com';

function getRpcUrl(): string {
  return process.env.SOLANA_RPC_URL || process.env.HELIUS_API_KEY
    ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
    : DEFAULT_RPC;
}

// ── Types ──────────────────────────────────────────────────────────

export interface SplDelegate {
  /** Token mint address */
  mint: string;
  /** Delegate address that has authority to spend */
  delegate: string;
  /** Delegated amount in raw units */
  delegatedAmount: string;
  /** Total token balance in raw units */
  totalBalance: string;
  /** Token account address */
  tokenAccount: string;
}

interface TokenAccountInfo {
  mint: string;
  owner: string;
  delegate?: string;
  delegatedAmount?: { amount: string; uiAmount: number; decimals: number };
  tokenAmount: { amount: string; uiAmount: number; decimals: number };
}

interface ParsedTokenAccount {
  pubkey: string;
  account: {
    data: {
      parsed: {
        info: TokenAccountInfo;
        type: string;
      };
      program: string;
    };
  };
}

export interface SolanaTransaction {
  signature: string;
  slot: number;
  blockTime: number | null;
  err: unknown;
  memo: string | null;
}

// ── RPC Helper ────────────────────────────────────────────────────

async function solanaRpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(getRpcUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) throw new Error(`Solana RPC error: ${res.status}`);

  const data = (await res.json()) as {
    result: T;
    error?: { code: number; message: string };
  };

  if (data.error) {
    throw new Error(`Solana RPC error: ${data.error.message}`);
  }

  return data.result;
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Fetch all SPL token accounts for a wallet address.
 * Returns parsed token account data including delegate info.
 */
export async function fetchSolanaTokenAccounts(
  walletAddress: string,
): Promise<ParsedTokenAccount[]> {
  // Token Program ID
  const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

  const result = await solanaRpc<{ value: ParsedTokenAccount[] }>(
    'getTokenAccountsByOwner',
    [
      walletAddress,
      { programId: TOKEN_PROGRAM_ID },
      { encoding: 'jsonParsed' },
    ],
  );

  return result.value ?? [];
}

/**
 * Parse SPL token accounts to extract delegate authorities.
 * These are the Solana equivalent of ERC-20 approvals.
 */
export function parseSplDelegates(accounts: ParsedTokenAccount[]): SplDelegate[] {
  const delegates: SplDelegate[] = [];

  for (const account of accounts) {
    try {
      const info = account.account?.data?.parsed?.info;
      if (!info) continue;

      // Only include accounts that have a delegate set
      if (!info.delegate) continue;

      delegates.push({
        mint: info.mint,
        delegate: info.delegate,
        delegatedAmount: info.delegatedAmount?.amount ?? '0',
        totalBalance: info.tokenAmount?.amount ?? '0',
        tokenAccount: account.pubkey,
      });
    } catch {
      // Skip malformed accounts
    }
  }

  return delegates;
}

/**
 * Fetch recent transaction signatures for a wallet.
 * Returns up to `limit` most recent signatures.
 */
export async function fetchSolanaTransactions(
  walletAddress: string,
  limit = 50,
): Promise<SolanaTransaction[]> {
  const result = await solanaRpc<SolanaTransaction[]>(
    'getSignaturesForAddress',
    [
      walletAddress,
      { limit },
    ],
  );

  return result ?? [];
}
