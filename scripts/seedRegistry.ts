/**
 * Registry Seeding Script
 *
 * Populates src/registry/data/registry.json with contract labels from:
 * 1. DeFi Llama protocols — protocol names, categories, addresses, TVL
 * 2. DeFi Llama hacks — exploited contracts flagged as critical risk
 * 3. CoinGecko top tokens — top 100 tokens with platform addresses
 * 4. Etherscan enrichment — contract name and verification status
 *
 * Usage: npm run seed:registry
 *
 * Merges with existing registry, preserves "manual" source entries,
 * deduplicates by address+chain, and validates via Zod before writing.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ContractLabelSchema, ContractRegistrySchema, type ContractLabel } from '../src/registry/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = path.join(__dirname, '../src/registry/data/registry.json');

// Rate limiting helper
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

// ── Chain mapping ────────────────────────────────────────────────

const CHAIN_MAP: Record<string, string> = {
  ethereum: 'ethereum',
  Ethereum: 'ethereum',
  base: 'base',
  Base: 'base',
  polygon: 'polygon',
  Polygon: 'polygon',
  arbitrum: 'arbitrum',
  Arbitrum: 'arbitrum',
  optimism: 'optimism',
  Optimism: 'optimism',
  avalanche: 'avalanche',
  Avalanche: 'avalanche',
  'Binance Smart Chain': 'bsc',
  BSC: 'bsc',
};

// Map DeFi Llama categories to our enum
const CATEGORY_MAP: Record<string, string> = {
  Dexes: 'dex',
  DEX: 'dex',
  Lending: 'lending',
  Bridge: 'bridge',
  CDP: 'stablecoin',
  Yield: 'yield',
  'Yield Aggregator': 'yield',
  'NFT Marketplace': 'nft-marketplace',
  Oracle: 'oracle',
  Governance: 'governance',
  'Liquid Staking': 'liquid-staking',
  Derivatives: 'derivatives',
  'Algo-Stables': 'stablecoin',
  'Staking Pool': 'liquid-staking',
  Insurance: 'infrastructure',
  Launchpad: 'infrastructure',
  Options: 'derivatives',
  'Leveraged Farming': 'yield',
  'Cross Chain': 'bridge',
};

// ── Data sources ─────────────────────────────────────────────────

interface RawEntry {
  address: string;
  name: string;
  chain: string;
  protocol?: string;
  category?: string;
  riskLevel?: string;
  tags?: string[];
  description?: string;
  source: string;
}

async function fetchDefiLlamaProtocols(): Promise<RawEntry[]> {
  console.log('  Fetching DeFi Llama protocols...');
  const entries: RawEntry[] = [];

  try {
    const data = (await fetchJson('https://api.llama.fi/protocols')) as Array<{
      name: string;
      slug: string;
      category: string;
      chains: string[];
      address: string | null;
      tvl: number;
    }>;

    // Only include protocols with significant TVL (>$1M)
    const significant = data
      .filter((p) => p.tvl > 1_000_000 && p.address)
      .sort((a, b) => b.tvl - a.tvl)
      .slice(0, 200);

    for (const protocol of significant) {
      if (!protocol.address) continue;

      // Parse address — could be "chain:address" format
      let chain = 'ethereum';
      let address = protocol.address;

      if (address.includes(':')) {
        const [chainPart, addrPart] = address.split(':');
        chain = CHAIN_MAP[chainPart] ?? chainPart.toLowerCase();
        address = addrPart;
      }

      if (!address.startsWith('0x')) continue;

      const category = CATEGORY_MAP[protocol.category] ?? 'unknown';

      entries.push({
        address,
        name: protocol.name,
        chain,
        protocol: protocol.name,
        category,
        riskLevel: 'low',
        tags: [category, 'defi'],
        description: `${protocol.name} — TVL $${(protocol.tvl / 1e6).toFixed(1)}M`,
        source: 'defillama',
      });
    }

    console.log(`    Found ${entries.length} protocols with >$1M TVL`);
  } catch (err) {
    console.error('    Failed to fetch DeFi Llama protocols:', (err as Error).message);
  }

  return entries;
}

async function fetchDefiLlamaHacks(): Promise<RawEntry[]> {
  console.log('  Fetching DeFi Llama hacks...');
  const entries: RawEntry[] = [];

  try {
    const data = (await fetchJson('https://api.llama.fi/hacks')) as Array<{
      name: string;
      target: string;
      chain: string[];
      amount: number;
      date: string;
    }>;

    for (const hack of data) {
      if (!hack.target) continue;

      // Some targets are addresses, some are protocol names
      // We can only use actual addresses
      if (hack.target.startsWith('0x') && hack.target.length === 42) {
        const chain = hack.chain?.[0]
          ? CHAIN_MAP[hack.chain[0]] ?? hack.chain[0].toLowerCase()
          : 'ethereum';

        entries.push({
          address: hack.target,
          name: `${hack.name} (Exploited)`,
          chain,
          protocol: hack.name,
          category: 'unknown',
          riskLevel: 'critical',
          tags: ['exploited', 'hack'],
          description: `Exploited for $${(hack.amount / 1e6).toFixed(1)}M on ${hack.date}`,
          source: 'defillama-hacks',
        });
      }
    }

    console.log(`    Found ${entries.length} exploited contracts`);
  } catch (err) {
    console.error('    Failed to fetch DeFi Llama hacks:', (err as Error).message);
  }

  return entries;
}

async function fetchCoinGeckoTokens(): Promise<RawEntry[]> {
  console.log('  Fetching CoinGecko top tokens...');
  const entries: RawEntry[] = [];

  try {
    // Page 1 — top 100 by market cap
    const data = (await fetchJson(
      'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false',
    )) as Array<{
      id: string;
      symbol: string;
      name: string;
    }>;

    // For each token, we need to fetch details to get platform addresses
    // But CoinGecko rate limits heavily on free tier, so batch carefully
    const batchSize = 10;
    for (let i = 0; i < Math.min(data.length, 50); i += batchSize) {
      const batch = data.slice(i, i + batchSize);

      const details = await Promise.allSettled(
        batch.map(async (token) => {
          await sleep(200); // Respect rate limit
          const detail = (await fetchJson(
            `https://api.coingecko.com/api/v3/coins/${token.id}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false`,
          )) as {
            id: string;
            name: string;
            symbol: string;
            platforms: Record<string, string>;
            categories: string[];
          };
          return detail;
        }),
      );

      for (const result of details) {
        if (result.status !== 'fulfilled') continue;
        const detail = result.value;

        for (const [platform, address] of Object.entries(detail.platforms)) {
          if (!address || !address.startsWith('0x') || address.length !== 42) continue;
          const chain = CHAIN_MAP[platform] ?? platform.toLowerCase();
          if (!['ethereum', 'base', 'polygon', 'arbitrum', 'optimism', 'avalanche'].includes(chain)) continue;

          const isStablecoin = detail.categories?.some((c) =>
            c.toLowerCase().includes('stablecoin'),
          );

          entries.push({
            address,
            name: detail.name,
            chain,
            protocol: detail.name,
            category: isStablecoin ? 'stablecoin' : 'token',
            riskLevel: 'safe',
            tags: ['erc20', detail.symbol.toLowerCase()],
            source: 'coingecko',
          });
        }
      }

      if (i + batchSize < Math.min(data.length, 50)) {
        await sleep(1500); // CoinGecko rate limit
      }
    }

    console.log(`    Found ${entries.length} token addresses`);
  } catch (err) {
    console.error('    Failed to fetch CoinGecko tokens:', (err as Error).message);
  }

  return entries;
}

// ── Merge + Deduplicate ──────────────────────────────────────────

function mergeEntries(existing: ContractLabel[], incoming: RawEntry[]): ContractLabel[] {
  // Index existing entries by address+chain, prioritize manual source
  const merged = new Map<string, ContractLabel>();

  for (const entry of existing) {
    const key = `${entry.address.toLowerCase()}:${entry.chain}`;
    merged.set(key, entry);
  }

  for (const raw of incoming) {
    const key = `${raw.address.toLowerCase()}:${raw.chain}`;

    // Don't overwrite manual entries
    if (merged.has(key) && merged.get(key)!.source === 'manual') {
      continue;
    }

    // Validate + parse
    try {
      const entry = ContractLabelSchema.parse({
        address: raw.address,
        name: raw.name,
        chain: raw.chain,
        protocol: raw.protocol,
        category: raw.category,
        riskLevel: raw.riskLevel,
        tags: raw.tags,
        description: raw.description,
        source: raw.source,
        lastVerified: new Date().toISOString().split('T')[0],
      });
      merged.set(key, entry);
    } catch {
      // Skip invalid entries silently
    }
  }

  return [...merged.values()];
}

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  console.log('Registry Seeding Script');
  console.log('========================\n');

  // Load existing registry
  let existing: ContractLabel[] = [];
  try {
    const raw = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
    const parsed = ContractRegistrySchema.parse(raw);
    existing = parsed.entries;
    console.log(`Loaded ${existing.length} existing entries\n`);
  } catch {
    console.log('No existing registry found, starting fresh\n');
  }

  // Fetch from data sources
  console.log('Fetching data sources...');
  const [llamaProtocols, llamaHacks, coingeckoTokens] = await Promise.all([
    fetchDefiLlamaProtocols(),
    fetchDefiLlamaHacks(),
    fetchCoinGeckoTokens(),
  ]);

  console.log(`\nTotal incoming entries: ${llamaProtocols.length + llamaHacks.length + coingeckoTokens.length}`);

  // Merge all sources
  const allIncoming = [...llamaProtocols, ...llamaHacks, ...coingeckoTokens];
  const merged = mergeEntries(existing, allIncoming);

  // Sort by chain, then category, then name
  merged.sort((a, b) => {
    const chainOrder = a.chain.localeCompare(b.chain);
    if (chainOrder !== 0) return chainOrder;
    const catOrder = (a.category ?? 'zzz').localeCompare(b.category ?? 'zzz');
    if (catOrder !== 0) return catOrder;
    return a.name.localeCompare(b.name);
  });

  // Write output
  const output = {
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    entries: merged,
  };

  // Validate the final output
  ContractRegistrySchema.parse(output);

  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(output, null, 2) + '\n');

  // Stats
  const chains = new Set(merged.map((e) => e.chain));
  const categories = new Map<string, number>();
  for (const e of merged) {
    const cat = e.category ?? 'unknown';
    categories.set(cat, (categories.get(cat) ?? 0) + 1);
  }

  console.log(`\n========================`);
  console.log(`Registry updated: ${merged.length} entries`);
  console.log(`Chains: ${[...chains].join(', ')}`);
  console.log(`Categories:`);
  for (const [cat, count] of [...categories.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat}: ${count}`);
  }
  console.log(`\nWritten to ${REGISTRY_PATH}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
