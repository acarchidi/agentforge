/**
 * GeckoTerminal public API (free, no key, ~30 calls/min per IP).
 *
 * Used to discover newly created DEX pools and to refresh their trading
 * activity. Same company as CoinGecko, which the token services already use.
 */

export type LaunchChain = 'base' | 'ethereum' | 'arbitrum';

const GT_NETWORK: Record<LaunchChain, string> = {
  base: 'base',
  ethereum: 'eth',
  arbitrum: 'arbitrum',
};

/** Quote assets: when one of these is a pool's base token, the launch is the other side. */
const QUOTE_ASSETS: Record<LaunchChain, Set<string>> = {
  base: new Set([
    '0x4200000000000000000000000000000000000006', // WETH
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC
    '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca', // USDbC
    '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf', // cbBTC
    '0x0000000000000000000000000000000000000000', // native ETH (Uniswap v4)
  ]),
  ethereum: new Set([
    '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
    '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT
    '0x0000000000000000000000000000000000000000',
  ]),
  arbitrum: new Set([
    '0x82af49447d8a07e3bd95bd0d56f35241523fbab1', // WETH
    '0xaf88d065e77c8cc2239327c5edb3a432268e5831', // USDC
    '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', // USDT
    '0x0000000000000000000000000000000000000000',
  ]),
};

export interface PoolActivity {
  buys: number;
  sells: number;
  buyers: number;
  sellers: number;
}

export interface GtPool {
  chain: LaunchChain;
  poolAddress: string;
  tokenAddress: string;
  dex: string;
  name: string;
  poolCreatedAt: string;
  liquidityUsd: number | null;
  fdvUsd: number | null;
  marketCapUsd: number | null;
  volumeH24Usd: number | null;
  priceChangeH1Pct: number | null;
  txH1: PoolActivity;
  txH24: PoolActivity;
}

interface GtPoolRaw {
  attributes: Record<string, any>;
  relationships: {
    base_token?: { data?: { id?: string } };
    quote_token?: { data?: { id?: string } };
    dex?: { data?: { id?: string } };
  };
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

function activity(v: any): PoolActivity {
  return { buys: v?.buys ?? 0, sells: v?.sells ?? 0, buyers: v?.buyers ?? 0, sellers: v?.sellers ?? 0 };
}

/** "base_0xabc…" → "0xabc…" */
function tokenFromId(id: string | undefined): string | null {
  if (!id) return null;
  const i = id.indexOf('_');
  return i === -1 ? null : id.slice(i + 1).toLowerCase();
}

export function parsePool(chain: LaunchChain, raw: GtPoolRaw): GtPool | null {
  const a = raw.attributes ?? {};
  const base = tokenFromId(raw.relationships?.base_token?.data?.id);
  const quote = tokenFromId(raw.relationships?.quote_token?.data?.id);
  const token = base && !QUOTE_ASSETS[chain].has(base) ? base : quote && !QUOTE_ASSETS[chain].has(quote) ? quote : null;
  if (!token || !/^0x[a-f0-9]{40}$/.test(token)) return null;
  return {
    chain,
    poolAddress: String(a.address ?? '').toLowerCase(),
    tokenAddress: token,
    dex: raw.relationships?.dex?.data?.id ?? 'unknown',
    name: String(a.name ?? ''),
    poolCreatedAt: String(a.pool_created_at ?? new Date().toISOString()),
    liquidityUsd: num(a.reserve_in_usd),
    fdvUsd: num(a.fdv_usd),
    marketCapUsd: num(a.market_cap_usd),
    volumeH24Usd: num(a.volume_usd?.h24),
    priceChangeH1Pct: num(a.price_change_percentage?.h1),
    txH1: activity(a.transactions?.h1),
    txH24: activity(a.transactions?.h24),
  };
}

async function gtGet(path: string): Promise<GtPoolRaw[]> {
  const res = await fetch(`https://api.geckoterminal.com/api/v2${path}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`GeckoTerminal error: ${res.status}`);
  const json = (await res.json()) as { data?: GtPoolRaw[] };
  return Array.isArray(json.data) ? json.data : [];
}

/** Newest pools first, 20 per page. */
export async function fetchNewPools(chain: LaunchChain, page = 1): Promise<GtPool[]> {
  const raw = await gtGet(`/networks/${GT_NETWORK[chain]}/new_pools?page=${page}`);
  return raw.map((r) => parsePool(chain, r)).filter((p): p is GtPool => p !== null);
}

/** Current stats for up to 30 pools in one call. */
export async function fetchPoolsMulti(chain: LaunchChain, poolAddresses: string[]): Promise<GtPool[]> {
  if (poolAddresses.length === 0) return [];
  const raw = await gtGet(`/networks/${GT_NETWORK[chain]}/pools/multi/${poolAddresses.slice(0, 30).join(',')}`);
  return raw.map((r) => parsePool(chain, r)).filter((p): p is GtPool => p !== null);
}
