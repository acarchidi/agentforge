#!/usr/bin/env tsx
/**
 * Expand Registry — Aggressively populate registry.json with well-known contracts
 * from DeFiLlama protocols (all chains), curated infrastructure, and top tokens.
 *
 * This script supplements the existing seed script by:
 * 1. Parsing DeFiLlama chain:address format for all supported chains
 * 2. Fetching individual protocol detail pages for per-chain addresses
 * 3. Adding a comprehensive curated list of infrastructure contracts
 * 4. Targeting 1000+ unique contract entries
 */

import dotenv from 'dotenv';
dotenv.config();

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ContractLabelSchema, ContractRegistrySchema, type ContractLabel } from '../src/registry/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = path.join(__dirname, '../src/registry/data/registry.json');

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

const SUPPORTED_CHAINS = new Set([
  'ethereum', 'base', 'polygon', 'arbitrum', 'optimism', 'avalanche', 'bsc',
]);

const CHAIN_MAP: Record<string, string> = {
  ethereum: 'ethereum', Ethereum: 'ethereum', eth: 'ethereum',
  base: 'base', Base: 'base',
  polygon: 'polygon', Polygon: 'polygon', matic: 'polygon',
  arbitrum: 'arbitrum', Arbitrum: 'arbitrum', 'Arbitrum One': 'arbitrum',
  optimism: 'optimism', Optimism: 'optimism',
  avalanche: 'avalanche', Avalanche: 'avalanche', avax: 'avalanche',
  bsc: 'bsc', BSC: 'bsc', 'Binance Smart Chain': 'bsc', 'Binance': 'bsc',
};

const CATEGORY_MAP: Record<string, string> = {
  Dexes: 'dex', DEX: 'dex', Dex: 'dex',
  Lending: 'lending', CDP: 'stablecoin',
  Bridge: 'bridge', 'Cross Chain': 'bridge',
  Yield: 'yield', 'Yield Aggregator': 'yield', 'Leveraged Farming': 'yield',
  'NFT Marketplace': 'nft-marketplace',
  Oracle: 'oracle',
  Governance: 'governance',
  'Liquid Staking': 'liquid-staking', 'Staking Pool': 'liquid-staking',
  Derivatives: 'derivatives', Options: 'derivatives', Perpetuals: 'derivatives',
  Insurance: 'infrastructure', Launchpad: 'infrastructure',
  'Algo-Stables': 'stablecoin',
  'Reserve Currency': 'governance',
  RWA: 'token',
  'Liquidity manager': 'dex',
  'Prediction Market': 'derivatives',
  'Decentralized Stablecoin': 'stablecoin',
  Restaking: 'liquid-staking',
  'Liquid Restaking': 'liquid-staking',
  Farm: 'yield',
  Services: 'infrastructure',
  Payments: 'infrastructure',
  Privacy: 'infrastructure',
  'NFT Lending': 'lending',
};

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

// ── Source 1: DeFiLlama protocols (aggressive parsing) ──────────────

async function fetchDefiLlamaProtocols(): Promise<RawEntry[]> {
  console.log('  1. Fetching DeFi Llama protocols (top 500 by TVL)...');
  const entries: RawEntry[] = [];

  try {
    const data = (await fetchJson('https://api.llama.fi/protocols')) as Array<{
      name: string;
      slug: string;
      category: string;
      chains: string[];
      address: string | null;
      tvl: number;
      chainTvls?: Record<string, number>;
    }>;

    // Sort by TVL, take top 500
    const sorted = data
      .filter((p) => p.tvl > 100_000) // Lower threshold: $100K TVL
      .sort((a, b) => b.tvl - a.tvl)
      .slice(0, 500);

    for (const protocol of sorted) {
      if (!protocol.address) continue;

      const category = CATEGORY_MAP[protocol.category] ?? 'unknown';
      const riskLevel = protocol.tvl > 100_000_000 ? 'safe' : protocol.tvl > 10_000_000 ? 'low' : 'medium';

      // Handle both "0xABC..." and "chain:0xABC..." formats
      const addresses: Array<{ address: string; chain: string }> = [];

      if (protocol.address.includes(':')) {
        const parts = protocol.address.split(',');
        for (const part of parts) {
          const trimmed = part.trim();
          if (trimmed.includes(':')) {
            const [chainPart, addrPart] = trimmed.split(':');
            const chain = CHAIN_MAP[chainPart] ?? chainPart.toLowerCase();
            if (SUPPORTED_CHAINS.has(chain) && addrPart?.startsWith('0x') && addrPart.length === 42) {
              addresses.push({ address: addrPart, chain });
            }
          }
        }
      } else if (protocol.address.startsWith('0x') && protocol.address.length === 42) {
        addresses.push({ address: protocol.address, chain: 'ethereum' });
      }

      for (const { address, chain } of addresses) {
        entries.push({
          address,
          name: protocol.name,
          chain,
          protocol: protocol.name,
          category,
          riskLevel,
          tags: [category, 'defi'],
          description: `${protocol.name} — TVL $${(protocol.tvl / 1e6).toFixed(1)}M`,
          source: 'defillama',
        });
      }
    }

    console.log(`    → ${entries.length} protocol addresses extracted`);
  } catch (err) {
    console.error('    ✗ Failed:', (err as Error).message);
  }

  return entries;
}

// ── Source 2: DeFiLlama protocol details (per-chain addresses) ──────

async function fetchProtocolDetails(slugs: string[]): Promise<RawEntry[]> {
  console.log(`  2. Fetching protocol details for ${slugs.length} protocols...`);
  const entries: RawEntry[] = [];
  let fetched = 0;

  for (const slug of slugs) {
    try {
      const data = (await fetchJson(`https://api.llama.fi/protocol/${slug}`)) as {
        name: string;
        address: string | null;
        category: string;
        chains: string[];
        currentChainTvls?: Record<string, number>;
        chainTvls?: Record<string, { tvl: Array<{ date: number; totalLiquidityUSD: number }> }>;
        // Some protocols list per-chain addresses
        misrepresentedTokens?: boolean;
        hallmarks?: Array<[number, string]>;
      };

      // Extract contract addresses from chain-specific data
      if (data.address && data.address.includes(',')) {
        const parts = data.address.split(',');
        for (const part of parts) {
          const trimmed = part.trim();
          if (trimmed.includes(':')) {
            const [chainPart, addrPart] = trimmed.split(':');
            const chain = CHAIN_MAP[chainPart] ?? chainPart.toLowerCase();
            if (SUPPORTED_CHAINS.has(chain) && addrPart?.startsWith('0x') && addrPart.length === 42) {
              const category = CATEGORY_MAP[data.category] ?? 'unknown';
              entries.push({
                address: addrPart,
                name: `${data.name} (${chain})`,
                chain,
                protocol: data.name,
                category,
                riskLevel: 'low',
                tags: [category, 'defi'],
                description: `${data.name} on ${chain}`,
                source: 'defillama-detail',
              });
            }
          }
        }
      }

      fetched++;
      if (fetched % 20 === 0) console.log(`    → Fetched ${fetched}/${slugs.length} details...`);
      await sleep(300); // Rate limit
    } catch {
      // Skip failed fetches silently
    }
  }

  console.log(`    → ${entries.length} per-chain addresses from details`);
  return entries;
}

// ── Source 3: Curated well-known contracts ───────────────────────────

function getCuratedContracts(): RawEntry[] {
  console.log('  3. Adding curated well-known contracts...');

  const curated: Array<{
    address: string;
    name: string;
    chain: string;
    protocol: string;
    category: string;
    riskLevel: string;
    tags: string[];
  }> = [
    // ── Top ERC-20 Tokens (Ethereum) ─────────────────────────────
    { address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', name: 'WETH', chain: 'ethereum', protocol: 'Wrapped Ether', category: 'token', riskLevel: 'safe', tags: ['erc20', 'weth'] },
    { address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', name: 'USDC', chain: 'ethereum', protocol: 'Circle', category: 'stablecoin', riskLevel: 'safe', tags: ['erc20', 'stablecoin'] },
    { address: '0xdac17f958d2ee523a2206206994597c13d831ec7', name: 'USDT', chain: 'ethereum', protocol: 'Tether', category: 'stablecoin', riskLevel: 'safe', tags: ['erc20', 'stablecoin'] },
    { address: '0x6b175474e89094c44da98b954eedeac495271d0f', name: 'DAI', chain: 'ethereum', protocol: 'MakerDAO', category: 'stablecoin', riskLevel: 'safe', tags: ['erc20', 'stablecoin'] },
    { address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', name: 'WBTC', chain: 'ethereum', protocol: 'Wrapped Bitcoin', category: 'token', riskLevel: 'safe', tags: ['erc20', 'wbtc'] },
    { address: '0x514910771af9ca656af840dff83e8264ecf986ca', name: 'LINK', chain: 'ethereum', protocol: 'Chainlink', category: 'oracle', riskLevel: 'safe', tags: ['erc20', 'oracle'] },
    { address: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984', name: 'UNI', chain: 'ethereum', protocol: 'Uniswap', category: 'governance', riskLevel: 'safe', tags: ['erc20', 'governance'] },
    { address: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9', name: 'AAVE', chain: 'ethereum', protocol: 'Aave', category: 'governance', riskLevel: 'safe', tags: ['erc20', 'governance'] },
    { address: '0xd533a949740bb3306d119cc777fa900ba034cd52', name: 'CRV', chain: 'ethereum', protocol: 'Curve', category: 'governance', riskLevel: 'safe', tags: ['erc20', 'governance'] },
    { address: '0xc011a73ee8576fb46f5e1c5751ca3b9fe0af2a6f', name: 'SNX', chain: 'ethereum', protocol: 'Synthetix', category: 'derivatives', riskLevel: 'low', tags: ['erc20', 'derivatives'] },
    { address: '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2', name: 'MKR', chain: 'ethereum', protocol: 'MakerDAO', category: 'governance', riskLevel: 'safe', tags: ['erc20', 'governance'] },
    { address: '0xc00e94cb662c3520282e6f5717214004a7f26888', name: 'COMP', chain: 'ethereum', protocol: 'Compound', category: 'governance', riskLevel: 'safe', tags: ['erc20', 'governance'] },
    { address: '0x0bc529c00c6401aef6d220be8c6ea1667f6ad93e', name: 'YFI', chain: 'ethereum', protocol: 'Yearn Finance', category: 'governance', riskLevel: 'low', tags: ['erc20', 'governance'] },
    { address: '0xba100000625a3754423978a60c9317c58a424e3d', name: 'BAL', chain: 'ethereum', protocol: 'Balancer', category: 'governance', riskLevel: 'safe', tags: ['erc20', 'governance'] },
    { address: '0x111111111117dc0aa78b770fa6a738034120c302', name: '1INCH', chain: 'ethereum', protocol: '1inch', category: 'dex', riskLevel: 'safe', tags: ['erc20', 'dex'] },
    { address: '0x6b3595068778dd592e39a122f4f5a5cf09c90fe2', name: 'SUSHI', chain: 'ethereum', protocol: 'SushiSwap', category: 'dex', riskLevel: 'low', tags: ['erc20', 'dex'] },
    { address: '0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0', name: 'MATIC', chain: 'ethereum', protocol: 'Polygon', category: 'infrastructure', riskLevel: 'safe', tags: ['erc20', 'l2'] },
    { address: '0x4e3fbd56cd56c3e72c1403e103b45db9da5b9d2b', name: 'CVX', chain: 'ethereum', protocol: 'Convex Finance', category: 'yield', riskLevel: 'low', tags: ['erc20', 'yield'] },
    { address: '0x5a98fcbea516cf06857215779fd812ca3bef1b32', name: 'LDO', chain: 'ethereum', protocol: 'Lido', category: 'liquid-staking', riskLevel: 'safe', tags: ['erc20', 'governance'] },
    { address: '0xae78736cd615f374d3085123a210448e74fc6393', name: 'rETH', chain: 'ethereum', protocol: 'Rocket Pool', category: 'liquid-staking', riskLevel: 'safe', tags: ['erc20', 'lst'] },
    { address: '0xbe9895146f7af43049ca1c1ae358b0541ea49704', name: 'cbETH', chain: 'ethereum', protocol: 'Coinbase', category: 'liquid-staking', riskLevel: 'safe', tags: ['erc20', 'lst'] },
    { address: '0xae7ab96520de3a18e5e111b5eaab095312d7fe84', name: 'stETH', chain: 'ethereum', protocol: 'Lido', category: 'liquid-staking', riskLevel: 'safe', tags: ['erc20', 'lst'] },
    { address: '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0', name: 'wstETH', chain: 'ethereum', protocol: 'Lido', category: 'liquid-staking', riskLevel: 'safe', tags: ['erc20', 'lst'] },
    { address: '0x18084fba666a33d37592fa2633fd49a74dd93a88', name: 'tBTC', chain: 'ethereum', protocol: 'Threshold', category: 'token', riskLevel: 'low', tags: ['erc20', 'btc'] },
    { address: '0xa35b1b31ce002fbf2058d22f30f95d405200a15b', name: 'ETHx', chain: 'ethereum', protocol: 'Stader', category: 'liquid-staking', riskLevel: 'low', tags: ['erc20', 'lst'] },
    { address: '0xf1c9acdc66974dfb6decb12aa385b9cd01190e38', name: 'osETH', chain: 'ethereum', protocol: 'Stakewise', category: 'liquid-staking', riskLevel: 'low', tags: ['erc20', 'lst'] },
    { address: '0xfe2e637202056d30016725477c5da089ab0a043a', name: 'sETH2', chain: 'ethereum', protocol: 'Stakewise', category: 'liquid-staking', riskLevel: 'low', tags: ['erc20', 'lst'] },
    { address: '0xac3e018457b222d93114458476f3e3416abbe38f', name: 'sfrxETH', chain: 'ethereum', protocol: 'Frax', category: 'liquid-staking', riskLevel: 'low', tags: ['erc20', 'lst'] },
    { address: '0x5e8422345238f34275888049021821e8e08caa1f', name: 'frxETH', chain: 'ethereum', protocol: 'Frax', category: 'liquid-staking', riskLevel: 'low', tags: ['erc20', 'lst'] },
    { address: '0xa663b02cf0a4b149d2ad41910cb81e23e1c41c32', name: 'sFRAX', chain: 'ethereum', protocol: 'Frax', category: 'stablecoin', riskLevel: 'low', tags: ['erc20', 'stablecoin'] },
    { address: '0x853d955acef822db058eb8505911ed77f175b99e', name: 'FRAX', chain: 'ethereum', protocol: 'Frax', category: 'stablecoin', riskLevel: 'low', tags: ['erc20', 'stablecoin'] },
    { address: '0x056fd409e1d7a124bd7017459dfea2f387b6d5cd', name: 'GUSD', chain: 'ethereum', protocol: 'Gemini', category: 'stablecoin', riskLevel: 'safe', tags: ['erc20', 'stablecoin'] },
    { address: '0x4fabb145d64652a948d72533023f6e7a623c7c53', name: 'BUSD', chain: 'ethereum', protocol: 'Paxos', category: 'stablecoin', riskLevel: 'low', tags: ['erc20', 'stablecoin'] },
    { address: '0x8e870d67f660d95d5be530380d0ec0bd388289e1', name: 'USDP', chain: 'ethereum', protocol: 'Paxos', category: 'stablecoin', riskLevel: 'safe', tags: ['erc20', 'stablecoin'] },
    { address: '0x57ab1ec28d129707052df4df418d58a2d46d5f51', name: 'sUSD', chain: 'ethereum', protocol: 'Synthetix', category: 'stablecoin', riskLevel: 'low', tags: ['erc20', 'stablecoin'] },
    { address: '0x5f98805a4e8be255a32880fdec7f6728c6568ba0', name: 'LUSD', chain: 'ethereum', protocol: 'Liquity', category: 'stablecoin', riskLevel: 'low', tags: ['erc20', 'stablecoin'] },
    { address: '0x1a7e4e63778b4f12a199c062f3efdd288afcbce8', name: 'agEUR', chain: 'ethereum', protocol: 'Angle', category: 'stablecoin', riskLevel: 'low', tags: ['erc20', 'stablecoin'] },
    { address: '0xd5f7838f5c461feff7fe49ea5ebaf7728bb0adfa', name: 'mETH', chain: 'ethereum', protocol: 'Mantle', category: 'liquid-staking', riskLevel: 'low', tags: ['erc20', 'lst'] },
    { address: '0xbf5495efe5db9ce00f80364c8b423567e58d2110', name: 'ezETH', chain: 'ethereum', protocol: 'Renzo', category: 'liquid-staking', riskLevel: 'low', tags: ['erc20', 'lst'] },
    { address: '0xf951e335afb289353dc249e82926178eac7ded78', name: 'swETH', chain: 'ethereum', protocol: 'Swell', category: 'liquid-staking', riskLevel: 'low', tags: ['erc20', 'lst'] },
    { address: '0xfae103dc9cf190ed75350761e95403b7b8afa6c0', name: 'rswETH', chain: 'ethereum', protocol: 'Swell', category: 'liquid-staking', riskLevel: 'low', tags: ['erc20', 'lst'] },
    { address: '0xa1290d69c65a6fe4df752f95823fae25cb99e5a7', name: 'rsETH', chain: 'ethereum', protocol: 'KelpDAO', category: 'liquid-staking', riskLevel: 'low', tags: ['erc20', 'lst'] },
    { address: '0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee', name: 'weETH', chain: 'ethereum', protocol: 'EtherFi', category: 'liquid-staking', riskLevel: 'low', tags: ['erc20', 'lst'] },
    { address: '0x35fa164735182de50811e8e2e824cfb9b6118ac2', name: 'eETH', chain: 'ethereum', protocol: 'EtherFi', category: 'liquid-staking', riskLevel: 'low', tags: ['erc20', 'lst'] },
    { address: '0xd9a442856c234a39a81a089c06451ebaa4306a72', name: 'pufETH', chain: 'ethereum', protocol: 'Puffer', category: 'liquid-staking', riskLevel: 'low', tags: ['erc20', 'lst'] },

    // ── More Tokens ──────────────────────────────────────────────
    { address: '0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce', name: 'SHIB', chain: 'ethereum', protocol: 'Shiba Inu', category: 'token', riskLevel: 'low', tags: ['erc20', 'meme'] },
    { address: '0x2af5d2ad76741191d15dfe7bf6ac92d4bd912ca3', name: 'LEO', chain: 'ethereum', protocol: 'Bitfinex', category: 'token', riskLevel: 'low', tags: ['erc20'] },
    { address: '0x75231f58b43240c9718dd58b4967c5114342a86c', name: 'OKB', chain: 'ethereum', protocol: 'OKX', category: 'token', riskLevel: 'low', tags: ['erc20'] },
    { address: '0xb50721bcf8d664c30412cfbc6cf7a15145234ad1', name: 'ARB', chain: 'ethereum', protocol: 'Arbitrum', category: 'governance', riskLevel: 'safe', tags: ['erc20', 'l2'] },
    { address: '0x4200000000000000000000000000000000000042', name: 'OP', chain: 'optimism', protocol: 'Optimism', category: 'governance', riskLevel: 'safe', tags: ['erc20', 'l2'] },
    { address: '0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3', name: 'ONDO', chain: 'ethereum', protocol: 'Ondo Finance', category: 'token', riskLevel: 'low', tags: ['erc20', 'rwa'] },
    { address: '0x6982508145454ce325ddbe47a25d4ec3d2311933', name: 'PEPE', chain: 'ethereum', protocol: 'Pepe', category: 'token', riskLevel: 'medium', tags: ['erc20', 'meme'] },
    { address: '0x582d872a1b094fc48f5de31d3b73f2d9be47def1', name: 'TON', chain: 'ethereum', protocol: 'Toncoin', category: 'token', riskLevel: 'low', tags: ['erc20'] },
    { address: '0x7420b4b9a0110cdc71fb720908340c03f9bc03ec', name: 'JASMY', chain: 'ethereum', protocol: 'JasmyCoin', category: 'token', riskLevel: 'medium', tags: ['erc20'] },
    { address: '0x4d224452801aced8b2f0aebe155379bb5d594381', name: 'APE', chain: 'ethereum', protocol: 'ApeCoin', category: 'governance', riskLevel: 'low', tags: ['erc20', 'nft'] },
    { address: '0xbb0e17ef65f82ab018d8edd776e8dd940327b28b', name: 'AXS', chain: 'ethereum', protocol: 'Axie Infinity', category: 'token', riskLevel: 'low', tags: ['erc20', 'gaming'] },
    { address: '0x3845badade8e6dff049820680d1f14bd3903a5d0', name: 'SAND', chain: 'ethereum', protocol: 'The Sandbox', category: 'token', riskLevel: 'low', tags: ['erc20', 'gaming'] },
    { address: '0x0f5d2fb29fb7d3cfee444a200298f468908cc942', name: 'MANA', chain: 'ethereum', protocol: 'Decentraland', category: 'token', riskLevel: 'low', tags: ['erc20', 'gaming'] },
    { address: '0x15d4c048f83bd7e37d49ea4c83a07267ec4203da', name: 'GALA', chain: 'ethereum', protocol: 'Gala', category: 'token', riskLevel: 'low', tags: ['erc20', 'gaming'] },
    { address: '0x4a220e6096b25eadb88358cb44068a3248254675', name: 'QNT', chain: 'ethereum', protocol: 'Quant', category: 'infrastructure', riskLevel: 'low', tags: ['erc20'] },
    { address: '0x3432b6a60d23ca0dfca7761b7ab56459d9c964d0', name: 'FXS', chain: 'ethereum', protocol: 'Frax', category: 'governance', riskLevel: 'low', tags: ['erc20', 'governance'] },
    { address: '0xc944e90c64b2c07662a292be6244bdf05cda44a7', name: 'GRT', chain: 'ethereum', protocol: 'The Graph', category: 'infrastructure', riskLevel: 'safe', tags: ['erc20'] },
    { address: '0x0d8775f648430679a709e98d2b0cb6250d2887ef', name: 'BAT', chain: 'ethereum', protocol: 'Basic Attention Token', category: 'token', riskLevel: 'safe', tags: ['erc20'] },
    { address: '0xe41d2489571d322189246dafa5ebde1f4699f498', name: 'ZRX', chain: 'ethereum', protocol: '0x Protocol', category: 'dex', riskLevel: 'safe', tags: ['erc20'] },
    { address: '0x0d438f3b5175bebc262bf23753c1e53d03432bde', name: 'wNXM', chain: 'ethereum', protocol: 'Nexus Mutual', category: 'infrastructure', riskLevel: 'low', tags: ['erc20', 'insurance'] },
    { address: '0x6de037ef9ad2725eb40118bb1702ebb27e4aeb24', name: 'RENDER', chain: 'ethereum', protocol: 'Render', category: 'infrastructure', riskLevel: 'low', tags: ['erc20'] },
    { address: '0x91af0fbb28aba7e31403cb457106ce79397fd4e6', name: 'AMP', chain: 'ethereum', protocol: 'Amp', category: 'token', riskLevel: 'low', tags: ['erc20'] },
    { address: '0x808507121b80c02388fad14726482e061b8da827', name: 'PENDLE', chain: 'ethereum', protocol: 'Pendle', category: 'yield', riskLevel: 'low', tags: ['erc20', 'yield'] },
    { address: '0xd33526068d116ce69f19a9ee46f0bd304f21a51f', name: 'RPL', chain: 'ethereum', protocol: 'Rocket Pool', category: 'liquid-staking', riskLevel: 'safe', tags: ['erc20', 'governance'] },
    { address: '0xc18360217d8f7ab5e7c516566761ea12ce7f9d72', name: 'ENS', chain: 'ethereum', protocol: 'ENS', category: 'infrastructure', riskLevel: 'safe', tags: ['erc20', 'naming'] },
    { address: '0x6810e776880c02933d47db1b9fc05908e5386b96', name: 'GNO', chain: 'ethereum', protocol: 'Gnosis', category: 'infrastructure', riskLevel: 'safe', tags: ['erc20'] },
    { address: '0xd26114cd6ee289accf82350c8d8487fedb8a0c07', name: 'OMG', chain: 'ethereum', protocol: 'OMG Network', category: 'infrastructure', riskLevel: 'low', tags: ['erc20'] },
    { address: '0x090185f2135308bad17527004364ebcc2d37e5f6', name: 'SPELL', chain: 'ethereum', protocol: 'Abracadabra', category: 'lending', riskLevel: 'medium', tags: ['erc20'] },

    // ── DEX Contracts ────────────────────────────────────────────
    // Uniswap
    { address: '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45', name: 'Uniswap V3: SwapRouter02', chain: 'ethereum', protocol: 'Uniswap', category: 'dex', riskLevel: 'safe', tags: ['dex', 'router'] },
    { address: '0xe592427a0aece92de3edee1f18e0157c05861564', name: 'Uniswap V3: SwapRouter', chain: 'ethereum', protocol: 'Uniswap', category: 'dex', riskLevel: 'safe', tags: ['dex', 'router'] },
    { address: '0x1f98431c8ad98523631ae4a59f267346ea31f984', name: 'Uniswap V3: Factory', chain: 'ethereum', protocol: 'Uniswap', category: 'dex', riskLevel: 'safe', tags: ['dex', 'factory'] },
    { address: '0xc36442b4a4522e871399cd717abdd847ab11fe88', name: 'Uniswap V3: NonfungiblePositionManager', chain: 'ethereum', protocol: 'Uniswap', category: 'dex', riskLevel: 'safe', tags: ['dex', 'nft'] },
    { address: '0x7a250d5630b4cf539739df2c5dacb4c659f2488d', name: 'Uniswap V2: Router02', chain: 'ethereum', protocol: 'Uniswap', category: 'dex', riskLevel: 'safe', tags: ['dex', 'router'] },
    { address: '0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f', name: 'Uniswap V2: Factory', chain: 'ethereum', protocol: 'Uniswap', category: 'dex', riskLevel: 'safe', tags: ['dex', 'factory'] },
    { address: '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad', name: 'Uniswap: Universal Router', chain: 'ethereum', protocol: 'Uniswap', category: 'dex', riskLevel: 'safe', tags: ['dex', 'router'] },
    { address: '0xef1c6e67703c7bd7107eed8303fbe6ec2554bf6b', name: 'Uniswap: Universal Router (old)', chain: 'ethereum', protocol: 'Uniswap', category: 'dex', riskLevel: 'safe', tags: ['dex', 'router'] },
    // Uniswap on other chains
    { address: '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45', name: 'Uniswap V3: SwapRouter02', chain: 'arbitrum', protocol: 'Uniswap', category: 'dex', riskLevel: 'safe', tags: ['dex', 'router'] },
    { address: '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45', name: 'Uniswap V3: SwapRouter02', chain: 'polygon', protocol: 'Uniswap', category: 'dex', riskLevel: 'safe', tags: ['dex', 'router'] },
    { address: '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45', name: 'Uniswap V3: SwapRouter02', chain: 'optimism', protocol: 'Uniswap', category: 'dex', riskLevel: 'safe', tags: ['dex', 'router'] },
    { address: '0x2626664c2603336e57b271c5c0b26f421741e481', name: 'Uniswap V3: SwapRouter02', chain: 'base', protocol: 'Uniswap', category: 'dex', riskLevel: 'safe', tags: ['dex', 'router'] },
    { address: '0x1f98431c8ad98523631ae4a59f267346ea31f984', name: 'Uniswap V3: Factory', chain: 'arbitrum', protocol: 'Uniswap', category: 'dex', riskLevel: 'safe', tags: ['dex', 'factory'] },
    { address: '0x1f98431c8ad98523631ae4a59f267346ea31f984', name: 'Uniswap V3: Factory', chain: 'polygon', protocol: 'Uniswap', category: 'dex', riskLevel: 'safe', tags: ['dex', 'factory'] },
    { address: '0x1f98431c8ad98523631ae4a59f267346ea31f984', name: 'Uniswap V3: Factory', chain: 'optimism', protocol: 'Uniswap', category: 'dex', riskLevel: 'safe', tags: ['dex', 'factory'] },
    { address: '0x33128a8fc17869897dce68ed026d694621f6fdfd', name: 'Uniswap V3: Factory', chain: 'base', protocol: 'Uniswap', category: 'dex', riskLevel: 'safe', tags: ['dex', 'factory'] },

    // SushiSwap
    { address: '0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f', name: 'SushiSwap: Router', chain: 'ethereum', protocol: 'SushiSwap', category: 'dex', riskLevel: 'safe', tags: ['dex', 'router'] },
    { address: '0xc0aee478e3658e2610c5f7a4a2e1777ce9e4f2ac', name: 'SushiSwap: Factory', chain: 'ethereum', protocol: 'SushiSwap', category: 'dex', riskLevel: 'safe', tags: ['dex', 'factory'] },

    // Curve
    { address: '0x99a58482bd75cbab83b27ec03ca68ff489b5788f', name: 'Curve: Router', chain: 'ethereum', protocol: 'Curve', category: 'dex', riskLevel: 'safe', tags: ['dex', 'router'] },
    { address: '0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7', name: 'Curve: 3pool', chain: 'ethereum', protocol: 'Curve', category: 'dex', riskLevel: 'safe', tags: ['dex', 'pool'] },
    { address: '0xdc24316b9ae028f1497c275eb9192a3ea0f67022', name: 'Curve: stETH/ETH', chain: 'ethereum', protocol: 'Curve', category: 'dex', riskLevel: 'safe', tags: ['dex', 'pool'] },
    { address: '0xd51a44d3fae010294c616388b506acda1bfaae46', name: 'Curve: Tricrypto2', chain: 'ethereum', protocol: 'Curve', category: 'dex', riskLevel: 'safe', tags: ['dex', 'pool'] },
    { address: '0x0f3159811670c117c372428d4e69ac32325e4d0f', name: 'Curve: crvUSD/USDT', chain: 'ethereum', protocol: 'Curve', category: 'dex', riskLevel: 'safe', tags: ['dex', 'pool'] },
    { address: '0xf5f5b97624542d72a9e06f04804bf81baa15e2b4', name: 'Curve: crvUSD Controller (WETH)', chain: 'ethereum', protocol: 'Curve', category: 'lending', riskLevel: 'safe', tags: ['dex', 'lending'] },

    // Balancer
    { address: '0xba12222222228d8ba445958a75a0704d566bf2c8', name: 'Balancer: Vault', chain: 'ethereum', protocol: 'Balancer', category: 'dex', riskLevel: 'safe', tags: ['dex', 'vault'] },
    { address: '0xba12222222228d8ba445958a75a0704d566bf2c8', name: 'Balancer: Vault', chain: 'arbitrum', protocol: 'Balancer', category: 'dex', riskLevel: 'safe', tags: ['dex', 'vault'] },
    { address: '0xba12222222228d8ba445958a75a0704d566bf2c8', name: 'Balancer: Vault', chain: 'polygon', protocol: 'Balancer', category: 'dex', riskLevel: 'safe', tags: ['dex', 'vault'] },

    // 1inch
    { address: '0x1111111254eeb25477b68fb85ed929f73a960582', name: '1inch: AggregationRouterV5', chain: 'ethereum', protocol: '1inch', category: 'dex', riskLevel: 'safe', tags: ['dex', 'aggregator'] },
    { address: '0x1111111254eeb25477b68fb85ed929f73a960582', name: '1inch: AggregationRouterV5', chain: 'arbitrum', protocol: '1inch', category: 'dex', riskLevel: 'safe', tags: ['dex', 'aggregator'] },
    { address: '0x1111111254eeb25477b68fb85ed929f73a960582', name: '1inch: AggregationRouterV5', chain: 'polygon', protocol: '1inch', category: 'dex', riskLevel: 'safe', tags: ['dex', 'aggregator'] },
    { address: '0x1111111254eeb25477b68fb85ed929f73a960582', name: '1inch: AggregationRouterV5', chain: 'optimism', protocol: '1inch', category: 'dex', riskLevel: 'safe', tags: ['dex', 'aggregator'] },
    { address: '0x1111111254eeb25477b68fb85ed929f73a960582', name: '1inch: AggregationRouterV5', chain: 'base', protocol: '1inch', category: 'dex', riskLevel: 'safe', tags: ['dex', 'aggregator'] },

    // 0x / Paraswap
    { address: '0xdef1c0ded9bec7f1a1670819833240f027b25eff', name: '0x: Exchange Proxy', chain: 'ethereum', protocol: '0x Protocol', category: 'dex', riskLevel: 'safe', tags: ['dex', 'aggregator'] },
    { address: '0xdef1c0ded9bec7f1a1670819833240f027b25eff', name: '0x: Exchange Proxy', chain: 'arbitrum', protocol: '0x Protocol', category: 'dex', riskLevel: 'safe', tags: ['dex', 'aggregator'] },
    { address: '0xdef1c0ded9bec7f1a1670819833240f027b25eff', name: '0x: Exchange Proxy', chain: 'polygon', protocol: '0x Protocol', category: 'dex', riskLevel: 'safe', tags: ['dex', 'aggregator'] },
    { address: '0xdef1c0ded9bec7f1a1670819833240f027b25eff', name: '0x: Exchange Proxy', chain: 'optimism', protocol: '0x Protocol', category: 'dex', riskLevel: 'safe', tags: ['dex', 'aggregator'] },
    { address: '0xdef1c0ded9bec7f1a1670819833240f027b25eff', name: '0x: Exchange Proxy', chain: 'base', protocol: '0x Protocol', category: 'dex', riskLevel: 'safe', tags: ['dex', 'aggregator'] },

    // ── Lending ──────────────────────────────────────────────────
    // Aave V3
    { address: '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2', name: 'Aave V3: Pool', chain: 'ethereum', protocol: 'Aave', category: 'lending', riskLevel: 'safe', tags: ['lending', 'pool'] },
    { address: '0xa97684ead0e402dc232d5a977953df7ecbab3cdb', name: 'Aave V3: PoolAddressesProvider', chain: 'ethereum', protocol: 'Aave', category: 'lending', riskLevel: 'safe', tags: ['lending'] },
    { address: '0x794a61358d6845594f94dc1db02a252b5b4814ad', name: 'Aave V3: Pool', chain: 'arbitrum', protocol: 'Aave', category: 'lending', riskLevel: 'safe', tags: ['lending', 'pool'] },
    { address: '0x794a61358d6845594f94dc1db02a252b5b4814ad', name: 'Aave V3: Pool', chain: 'polygon', protocol: 'Aave', category: 'lending', riskLevel: 'safe', tags: ['lending', 'pool'] },
    { address: '0x794a61358d6845594f94dc1db02a252b5b4814ad', name: 'Aave V3: Pool', chain: 'optimism', protocol: 'Aave', category: 'lending', riskLevel: 'safe', tags: ['lending', 'pool'] },
    { address: '0xa238dd80c259a72e81d7e4664a9801593f98d1c5', name: 'Aave V3: Pool', chain: 'base', protocol: 'Aave', category: 'lending', riskLevel: 'safe', tags: ['lending', 'pool'] },
    { address: '0x794a61358d6845594f94dc1db02a252b5b4814ad', name: 'Aave V3: Pool', chain: 'avalanche', protocol: 'Aave', category: 'lending', riskLevel: 'safe', tags: ['lending', 'pool'] },
    // Aave V2
    { address: '0x7d2768de32b0b80b7a3454c06bdac94a69ddc7a9', name: 'Aave V2: LendingPool', chain: 'ethereum', protocol: 'Aave', category: 'lending', riskLevel: 'safe', tags: ['lending', 'pool'] },
    { address: '0x8dff5e27ea6b7ac08ebfdf9eb090f32ee9a30fcf', name: 'Aave V2: LendingPool', chain: 'polygon', protocol: 'Aave', category: 'lending', riskLevel: 'safe', tags: ['lending', 'pool'] },

    // Compound V3
    { address: '0xc3d688b66703497daa19211eedff47f25384cdc3', name: 'Compound V3: cUSDCv3', chain: 'ethereum', protocol: 'Compound', category: 'lending', riskLevel: 'safe', tags: ['lending', 'comet'] },
    { address: '0xa17581a9e3356d9a858b789d68b4d866e593ae94', name: 'Compound V3: cWETHv3', chain: 'ethereum', protocol: 'Compound', category: 'lending', riskLevel: 'safe', tags: ['lending', 'comet'] },
    { address: '0x9c4ec768c28520b50860ea7a15bd7213a9ff58bf', name: 'Compound V3: cUSDCv3', chain: 'base', protocol: 'Compound', category: 'lending', riskLevel: 'safe', tags: ['lending', 'comet'] },
    { address: '0xa5edbdd9646f8dff606d7448e414884c7d905dca', name: 'Compound V3: cUSDCv3', chain: 'arbitrum', protocol: 'Compound', category: 'lending', riskLevel: 'safe', tags: ['lending', 'comet'] },

    // Spark (MakerDAO)
    { address: '0xc13e21b648a5ee794902342038ff3adab66be987', name: 'Spark: Pool', chain: 'ethereum', protocol: 'Spark', category: 'lending', riskLevel: 'safe', tags: ['lending', 'pool'] },

    // Morpho
    { address: '0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb', name: 'Morpho Blue', chain: 'ethereum', protocol: 'Morpho', category: 'lending', riskLevel: 'low', tags: ['lending'] },
    { address: '0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb', name: 'Morpho Blue', chain: 'base', protocol: 'Morpho', category: 'lending', riskLevel: 'low', tags: ['lending'] },

    // MakerDAO
    { address: '0x5ef30b9986345249bc32d8928b7ee64de9435e39', name: 'MakerDAO: CDPManager', chain: 'ethereum', protocol: 'MakerDAO', category: 'lending', riskLevel: 'safe', tags: ['lending', 'cdp'] },
    { address: '0x35d1b3f3d7966a1dfe207aa4514c12a259a0492b', name: 'MakerDAO: Vat', chain: 'ethereum', protocol: 'MakerDAO', category: 'lending', riskLevel: 'safe', tags: ['lending', 'cdp'] },
    { address: '0x9759a6ac90977b93b58547b4a71c78317f391a28', name: 'MakerDAO: DAI Join', chain: 'ethereum', protocol: 'MakerDAO', category: 'lending', riskLevel: 'safe', tags: ['lending'] },
    { address: '0x197e90f9fad81970ba7976f33cbd77088e5d7cf7', name: 'MakerDAO: Pot (DSR)', chain: 'ethereum', protocol: 'MakerDAO', category: 'yield', riskLevel: 'safe', tags: ['yield', 'savings'] },

    // ── Bridges ──────────────────────────────────────────────────
    { address: '0x3ee18b2214aff97000d974cf647e7c347e8fa585', name: 'Wormhole: Portal Token Bridge', chain: 'ethereum', protocol: 'Wormhole', category: 'bridge', riskLevel: 'low', tags: ['bridge'] },
    { address: '0x3154cf16ccdb4c6d922629664174b904d80f2c35', name: 'Base Bridge', chain: 'ethereum', protocol: 'Base', category: 'bridge', riskLevel: 'safe', tags: ['bridge', 'l2'] },
    { address: '0x99c9fc46f92e8a1c0dec1b1747d010903e884be1', name: 'Optimism: L1 Standard Bridge', chain: 'ethereum', protocol: 'Optimism', category: 'bridge', riskLevel: 'safe', tags: ['bridge', 'l2'] },
    { address: '0x8315177ab297ba92a06054ce80a67ed4dbd7ed3a', name: 'Arbitrum: Bridge', chain: 'ethereum', protocol: 'Arbitrum', category: 'bridge', riskLevel: 'safe', tags: ['bridge', 'l2'] },
    { address: '0xa0c68c638235ee32657e8f720a23cec1bfc6c9a8', name: 'Polygon: PoS Bridge', chain: 'ethereum', protocol: 'Polygon', category: 'bridge', riskLevel: 'safe', tags: ['bridge', 'l2'] },
    { address: '0x5427fefa711eff984124bfbb1ab6fbf5e3da1820', name: 'Synapse: Bridge', chain: 'ethereum', protocol: 'Synapse', category: 'bridge', riskLevel: 'low', tags: ['bridge'] },
    { address: '0x5e4e65926ba27467555eb562121fac00d24e9dd2', name: 'Across: SpokePool', chain: 'ethereum', protocol: 'Across', category: 'bridge', riskLevel: 'low', tags: ['bridge'] },
    { address: '0x5e4e65926ba27467555eb562121fac00d24e9dd2', name: 'Across: SpokePool', chain: 'arbitrum', protocol: 'Across', category: 'bridge', riskLevel: 'low', tags: ['bridge'] },
    { address: '0x5e4e65926ba27467555eb562121fac00d24e9dd2', name: 'Across: SpokePool', chain: 'polygon', protocol: 'Across', category: 'bridge', riskLevel: 'low', tags: ['bridge'] },
    { address: '0x5e4e65926ba27467555eb562121fac00d24e9dd2', name: 'Across: SpokePool', chain: 'optimism', protocol: 'Across', category: 'bridge', riskLevel: 'low', tags: ['bridge'] },
    { address: '0x5e4e65926ba27467555eb562121fac00d24e9dd2', name: 'Across: SpokePool', chain: 'base', protocol: 'Across', category: 'bridge', riskLevel: 'low', tags: ['bridge'] },
    { address: '0x8731d54e9d02c286767d56ac03e8037c07e01e98', name: 'Stargate: Router', chain: 'ethereum', protocol: 'Stargate', category: 'bridge', riskLevel: 'low', tags: ['bridge'] },
    { address: '0x53bf833a5d6c4dda888f69c22c88c9f356a41614', name: 'Stargate: Router', chain: 'arbitrum', protocol: 'Stargate', category: 'bridge', riskLevel: 'low', tags: ['bridge'] },
    { address: '0x45f1a95a4d3f3836523f5c83673c797f4d4d263b', name: 'Stargate: Router', chain: 'polygon', protocol: 'Stargate', category: 'bridge', riskLevel: 'low', tags: ['bridge'] },
    { address: '0xb0d502e938ed5f4df2e681fe6e419ff29631d62b', name: 'Stargate: Router', chain: 'optimism', protocol: 'Stargate', category: 'bridge', riskLevel: 'low', tags: ['bridge'] },
    { address: '0xb49c4e680174e331cb0a7ff3ab58afc9738d5f8b', name: 'Hop: USDC Bridge', chain: 'ethereum', protocol: 'Hop Protocol', category: 'bridge', riskLevel: 'low', tags: ['bridge'] },
    { address: '0x3e4a3a4796d16c0cd582c382691998f7c06420b6', name: 'Hop: ETH Bridge', chain: 'ethereum', protocol: 'Hop Protocol', category: 'bridge', riskLevel: 'low', tags: ['bridge'] },

    // ── NFT Marketplaces ─────────────────────────────────────────
    { address: '0x00000000000000adc04c56bf30ac9d3c0aaf14dc', name: 'Seaport 1.5', chain: 'ethereum', protocol: 'OpenSea', category: 'nft-marketplace', riskLevel: 'safe', tags: ['nft', 'marketplace'] },
    { address: '0x00000000000000adc04c56bf30ac9d3c0aaf14dc', name: 'Seaport 1.5', chain: 'base', protocol: 'OpenSea', category: 'nft-marketplace', riskLevel: 'safe', tags: ['nft', 'marketplace'] },
    { address: '0x00000000000000adc04c56bf30ac9d3c0aaf14dc', name: 'Seaport 1.5', chain: 'polygon', protocol: 'OpenSea', category: 'nft-marketplace', riskLevel: 'safe', tags: ['nft', 'marketplace'] },
    { address: '0x00000000000000adc04c56bf30ac9d3c0aaf14dc', name: 'Seaport 1.5', chain: 'arbitrum', protocol: 'OpenSea', category: 'nft-marketplace', riskLevel: 'safe', tags: ['nft', 'marketplace'] },
    { address: '0x74312363e45dcaba76c59ec49a7aa8a65a67eed3', name: 'X2Y2: Exchange', chain: 'ethereum', protocol: 'X2Y2', category: 'nft-marketplace', riskLevel: 'low', tags: ['nft', 'marketplace'] },
    { address: '0x59728544b08ab483533076417fbbb2fd0b17ce3a', name: 'LooksRare: Exchange', chain: 'ethereum', protocol: 'LooksRare', category: 'nft-marketplace', riskLevel: 'low', tags: ['nft', 'marketplace'] },
    { address: '0x0000000000e655fae4d56241588680f86e3b2377', name: 'Blur: Marketplace', chain: 'ethereum', protocol: 'Blur', category: 'nft-marketplace', riskLevel: 'low', tags: ['nft', 'marketplace'] },

    // ── Yield / Vaults ───────────────────────────────────────────
    { address: '0x4e3fbd56cd56c3e72c1403e103b45db9da5b9d2b', name: 'Convex: CVX', chain: 'ethereum', protocol: 'Convex', category: 'yield', riskLevel: 'safe', tags: ['yield'] },
    { address: '0xf403c135812408bfbe8713b5a23a04b3d48aae31', name: 'Convex: Booster', chain: 'ethereum', protocol: 'Convex', category: 'yield', riskLevel: 'safe', tags: ['yield'] },
    { address: '0xcf50b810e57ac33b91a8390d52e7b5bbee8c3e74', name: 'Convex: cvxCRV Staking', chain: 'ethereum', protocol: 'Convex', category: 'yield', riskLevel: 'safe', tags: ['yield'] },
    { address: '0xa258c4606ca8206d8aa700ce2143d7db854d168c', name: 'Yearn V2: WETH Vault', chain: 'ethereum', protocol: 'Yearn', category: 'yield', riskLevel: 'safe', tags: ['yield', 'vault'] },
    { address: '0xa354f35829ae975e850e23e9615b11da1b3dc4de', name: 'Yearn V2: USDC Vault', chain: 'ethereum', protocol: 'Yearn', category: 'yield', riskLevel: 'safe', tags: ['yield', 'vault'] },
    { address: '0x0d4a11d5eeaac28ec3f61d100daf4d40471f1852', name: 'Uniswap V2: USDT-WETH', chain: 'ethereum', protocol: 'Uniswap', category: 'dex', riskLevel: 'safe', tags: ['dex', 'pool'] },
    { address: '0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc', name: 'Uniswap V2: USDC-WETH', chain: 'ethereum', protocol: 'Uniswap', category: 'dex', riskLevel: 'safe', tags: ['dex', 'pool'] },

    // Pendle
    { address: '0x0000000001e4ef00d069e71d6ba041b0a16f7ea0', name: 'Pendle: Router V4', chain: 'ethereum', protocol: 'Pendle', category: 'yield', riskLevel: 'low', tags: ['yield', 'router'] },
    { address: '0x0000000001e4ef00d069e71d6ba041b0a16f7ea0', name: 'Pendle: Router V4', chain: 'arbitrum', protocol: 'Pendle', category: 'yield', riskLevel: 'low', tags: ['yield', 'router'] },

    // EigenLayer
    { address: '0x858646372cc42e1a627fce94aa7a7033e7cf075a', name: 'EigenLayer: StrategyManager', chain: 'ethereum', protocol: 'EigenLayer', category: 'liquid-staking', riskLevel: 'low', tags: ['restaking'] },
    { address: '0x39053d51b77dc0d36036fc1fcc8cb819df8ef37a', name: 'EigenLayer: DelegationManager', chain: 'ethereum', protocol: 'EigenLayer', category: 'liquid-staking', riskLevel: 'low', tags: ['restaking'] },

    // ── Governance / DAOs ────────────────────────────────────────
    { address: '0x408ed6354d4973f66138c91495f2f2fcbd8724c3', name: 'Uniswap: Governor Bravo', chain: 'ethereum', protocol: 'Uniswap', category: 'governance', riskLevel: 'safe', tags: ['governance', 'dao'] },
    { address: '0xec568fffba36ac8c6e2b3728b1204eadf4c78169', name: 'Compound: Governor Bravo', chain: 'ethereum', protocol: 'Compound', category: 'governance', riskLevel: 'safe', tags: ['governance', 'dao'] },
    { address: '0xbe8e3e3618f7474f8cb1d074a26affef007e98fb', name: 'MakerDAO: DSChief', chain: 'ethereum', protocol: 'MakerDAO', category: 'governance', riskLevel: 'safe', tags: ['governance', 'dao'] },

    // ── Infrastructure ───────────────────────────────────────────
    { address: '0x47fb2585d2c56fe188d0e6ec628a38b74fceeedf', name: 'Chainlink: ETH/USD Feed', chain: 'ethereum', protocol: 'Chainlink', category: 'oracle', riskLevel: 'safe', tags: ['oracle', 'price-feed'] },
    { address: '0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419', name: 'Chainlink: ETH/USD Aggregator', chain: 'ethereum', protocol: 'Chainlink', category: 'oracle', riskLevel: 'safe', tags: ['oracle', 'price-feed'] },
    { address: '0x986b5e1e1755e3c2440e960477f25201b0a8bbd4', name: 'Chainlink: BTC/USD Aggregator', chain: 'ethereum', protocol: 'Chainlink', category: 'oracle', riskLevel: 'safe', tags: ['oracle', 'price-feed'] },
    { address: '0x8fffffd4afb6115b954bd326cbe7b4ba576818f6', name: 'Chainlink: USDC/USD Aggregator', chain: 'ethereum', protocol: 'Chainlink', category: 'oracle', riskLevel: 'safe', tags: ['oracle', 'price-feed'] },
    { address: '0x3e7d1eab13ad0104d2750b8863b489d65364e32d', name: 'Chainlink: USDT/USD Aggregator', chain: 'ethereum', protocol: 'Chainlink', category: 'oracle', riskLevel: 'safe', tags: ['oracle', 'price-feed'] },
    { address: '0xaed0c38402a5d19df6e4c03f4e2dced6e29c1ee9', name: 'Chainlink: DAI/USD Aggregator', chain: 'ethereum', protocol: 'Chainlink', category: 'oracle', riskLevel: 'safe', tags: ['oracle', 'price-feed'] },
    { address: '0xf4030086522a5beea4988f8ca5b36dbc97bee88c', name: 'Chainlink: BTC/USD Feed', chain: 'ethereum', protocol: 'Chainlink', category: 'oracle', riskLevel: 'safe', tags: ['oracle', 'price-feed'] },
    { address: '0x65c816077c29b557bee980ae3cc2dce80204a0c5', name: 'Pyth: Oracle', chain: 'ethereum', protocol: 'Pyth', category: 'oracle', riskLevel: 'low', tags: ['oracle'] },

    // Gnosis Safe / MultiSig
    { address: '0xd9db270c1b5e3bd161e8c8503c55ceabee709552', name: 'Gnosis Safe: Singleton', chain: 'ethereum', protocol: 'Safe', category: 'multisig', riskLevel: 'safe', tags: ['multisig', 'wallet'] },
    { address: '0xa6b71e26c5e0845f74c812102ca7114b6a896ab2', name: 'Gnosis Safe: ProxyFactory', chain: 'ethereum', protocol: 'Safe', category: 'multisig', riskLevel: 'safe', tags: ['multisig', 'factory'] },

    // ENS
    { address: '0x57f1887a8bf19b14fc0df6fd9b2acc9af147ea85', name: 'ENS: Base Registrar', chain: 'ethereum', protocol: 'ENS', category: 'infrastructure', riskLevel: 'safe', tags: ['naming', 'nft'] },
    { address: '0x283af0b28c62c092c9727f1ee09c02ca627eb7f5', name: 'ENS: ETH Registrar Controller', chain: 'ethereum', protocol: 'ENS', category: 'infrastructure', riskLevel: 'safe', tags: ['naming'] },
    { address: '0x00000000000c2e074ec69a0dfb2997ba6c7d2e1e', name: 'ENS: Registry', chain: 'ethereum', protocol: 'ENS', category: 'infrastructure', riskLevel: 'safe', tags: ['naming'] },

    // ── Base-specific contracts ──────────────────────────────────
    { address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', name: 'USDC', chain: 'base', protocol: 'Circle', category: 'stablecoin', riskLevel: 'safe', tags: ['erc20', 'stablecoin'] },
    { address: '0x4200000000000000000000000000000000000006', name: 'WETH', chain: 'base', protocol: 'Wrapped Ether', category: 'token', riskLevel: 'safe', tags: ['erc20', 'weth'] },
    { address: '0x50c5725949a6f0c72e6c4a641f24049a917db0cb', name: 'DAI', chain: 'base', protocol: 'MakerDAO', category: 'stablecoin', riskLevel: 'safe', tags: ['erc20', 'stablecoin'] },
    { address: '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca', name: 'USDbC', chain: 'base', protocol: 'Circle', category: 'stablecoin', riskLevel: 'safe', tags: ['erc20', 'stablecoin'] },
    { address: '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22', name: 'cbETH', chain: 'base', protocol: 'Coinbase', category: 'liquid-staking', riskLevel: 'safe', tags: ['erc20', 'lst'] },
    { address: '0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452', name: 'wstETH', chain: 'base', protocol: 'Lido', category: 'liquid-staking', riskLevel: 'safe', tags: ['erc20', 'lst'] },
    { address: '0x940181a94a35a4569e4529a3cdfb74e38fd98631', name: 'Aerodrome: Router', chain: 'base', protocol: 'Aerodrome', category: 'dex', riskLevel: 'low', tags: ['dex', 'router'] },
    { address: '0x420dd381b31aef6683db6b902084cb0ffece40da', name: 'Aerodrome: Factory', chain: 'base', protocol: 'Aerodrome', category: 'dex', riskLevel: 'low', tags: ['dex', 'factory'] },

    // ── Arbitrum-specific ────────────────────────────────────────
    { address: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1', name: 'WETH', chain: 'arbitrum', protocol: 'Wrapped Ether', category: 'token', riskLevel: 'safe', tags: ['erc20', 'weth'] },
    { address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', name: 'USDC', chain: 'arbitrum', protocol: 'Circle', category: 'stablecoin', riskLevel: 'safe', tags: ['erc20', 'stablecoin'] },
    { address: '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8', name: 'USDC.e', chain: 'arbitrum', protocol: 'Circle', category: 'stablecoin', riskLevel: 'safe', tags: ['erc20', 'stablecoin'] },
    { address: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', name: 'USDT', chain: 'arbitrum', protocol: 'Tether', category: 'stablecoin', riskLevel: 'safe', tags: ['erc20', 'stablecoin'] },
    { address: '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f', name: 'WBTC', chain: 'arbitrum', protocol: 'Wrapped Bitcoin', category: 'token', riskLevel: 'safe', tags: ['erc20', 'wbtc'] },
    { address: '0xfc5a1a6eb076a2c7ad06ed22c90d7e710e35ad0a', name: 'GMX', chain: 'arbitrum', protocol: 'GMX', category: 'derivatives', riskLevel: 'low', tags: ['erc20', 'derivatives'] },
    { address: '0x912ce59144191c1204e64559fe8253a0e49e6548', name: 'ARB', chain: 'arbitrum', protocol: 'Arbitrum', category: 'governance', riskLevel: 'safe', tags: ['erc20', 'governance'] },

    // GMX
    { address: '0x489ee077994b6658eafa855c308275ead8097c4a', name: 'GMX: Vault', chain: 'arbitrum', protocol: 'GMX', category: 'derivatives', riskLevel: 'low', tags: ['derivatives', 'vault'] },
    { address: '0xabd85d0d2b68b2aa9ba6f0e2c27debafd73b3312', name: 'GMX: Router', chain: 'arbitrum', protocol: 'GMX', category: 'derivatives', riskLevel: 'low', tags: ['derivatives', 'router'] },
    { address: '0x2b0bacea04213cba22d2c7e6f0e6e1e6dba8ef24', name: 'GMX V2: Exchange Router', chain: 'arbitrum', protocol: 'GMX', category: 'derivatives', riskLevel: 'low', tags: ['derivatives', 'router'] },

    // Camelot (Arbitrum DEX)
    { address: '0xc873fecbd354f5a56e00e710b90ef4201db2448d', name: 'Camelot: Router', chain: 'arbitrum', protocol: 'Camelot', category: 'dex', riskLevel: 'low', tags: ['dex', 'router'] },

    // ── Polygon-specific ─────────────────────────────────────────
    { address: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270', name: 'WMATIC', chain: 'polygon', protocol: 'Wrapped Matic', category: 'token', riskLevel: 'safe', tags: ['erc20', 'wmatic'] },
    { address: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', name: 'USDC', chain: 'polygon', protocol: 'Circle', category: 'stablecoin', riskLevel: 'safe', tags: ['erc20', 'stablecoin'] },
    { address: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', name: 'USDC.e', chain: 'polygon', protocol: 'Circle', category: 'stablecoin', riskLevel: 'safe', tags: ['erc20', 'stablecoin'] },
    { address: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', name: 'USDT', chain: 'polygon', protocol: 'Tether', category: 'stablecoin', riskLevel: 'safe', tags: ['erc20', 'stablecoin'] },
    { address: '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6', name: 'WBTC', chain: 'polygon', protocol: 'Wrapped Bitcoin', category: 'token', riskLevel: 'safe', tags: ['erc20', 'wbtc'] },
    { address: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619', name: 'WETH', chain: 'polygon', protocol: 'Wrapped Ether', category: 'token', riskLevel: 'safe', tags: ['erc20', 'weth'] },
    { address: '0xa5e0829caced8ffdd4de3c43696c57f7d7a678ff', name: 'QuickSwap: Router', chain: 'polygon', protocol: 'QuickSwap', category: 'dex', riskLevel: 'low', tags: ['dex', 'router'] },

    // ── Optimism-specific ────────────────────────────────────────
    { address: '0x4200000000000000000000000000000000000006', name: 'WETH', chain: 'optimism', protocol: 'Wrapped Ether', category: 'token', riskLevel: 'safe', tags: ['erc20', 'weth'] },
    { address: '0x0b2c639c533813f4aa9d7837caf62653d097ff85', name: 'USDC', chain: 'optimism', protocol: 'Circle', category: 'stablecoin', riskLevel: 'safe', tags: ['erc20', 'stablecoin'] },
    { address: '0x7f5c764cbc14f9669b88837ca1490cca17c31607', name: 'USDC.e', chain: 'optimism', protocol: 'Circle', category: 'stablecoin', riskLevel: 'safe', tags: ['erc20', 'stablecoin'] },
    { address: '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58', name: 'USDT', chain: 'optimism', protocol: 'Tether', category: 'stablecoin', riskLevel: 'safe', tags: ['erc20', 'stablecoin'] },
    { address: '0x68f180fcce6836688e9084f035309e29bf0a2095', name: 'WBTC', chain: 'optimism', protocol: 'Wrapped Bitcoin', category: 'token', riskLevel: 'safe', tags: ['erc20', 'wbtc'] },
    { address: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984', name: 'UNI', chain: 'optimism', protocol: 'Uniswap', category: 'governance', riskLevel: 'safe', tags: ['erc20', 'governance'] },
    { address: '0x9bcef72be871e61ed4fbbc7630889bee758eb81d', name: 'Velodrome: Router', chain: 'optimism', protocol: 'Velodrome', category: 'dex', riskLevel: 'low', tags: ['dex', 'router'] },

    // ── Avalanche-specific ───────────────────────────────────────
    { address: '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7', name: 'WAVAX', chain: 'avalanche', protocol: 'Wrapped Avax', category: 'token', riskLevel: 'safe', tags: ['erc20', 'wavax'] },
    { address: '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e', name: 'USDC', chain: 'avalanche', protocol: 'Circle', category: 'stablecoin', riskLevel: 'safe', tags: ['erc20', 'stablecoin'] },
    { address: '0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7', name: 'USDT', chain: 'avalanche', protocol: 'Tether', category: 'stablecoin', riskLevel: 'safe', tags: ['erc20', 'stablecoin'] },
    { address: '0x152b9d0fdc40c096de345d4d8dea0800a413b2be', name: 'WBTC.e', chain: 'avalanche', protocol: 'Wrapped Bitcoin', category: 'token', riskLevel: 'safe', tags: ['erc20', 'wbtc'] },
    { address: '0x49d5c2bdffac6ce2bfdb6640f4f80f226bc10bab', name: 'WETH.e', chain: 'avalanche', protocol: 'Wrapped Ether', category: 'token', riskLevel: 'safe', tags: ['erc20', 'weth'] },
    { address: '0x60ae616a2155ee3d9a68541ba4544862310933d4', name: 'Trader Joe: Router', chain: 'avalanche', protocol: 'Trader Joe', category: 'dex', riskLevel: 'low', tags: ['dex', 'router'] },
    { address: '0x9ad6c38be94206ca50bb0d90783181834c520808', name: 'Trader Joe: LBRouter', chain: 'avalanche', protocol: 'Trader Joe', category: 'dex', riskLevel: 'low', tags: ['dex', 'router'] },

    // ── BSC-specific ─────────────────────────────────────────────
    { address: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', name: 'WBNB', chain: 'bsc', protocol: 'Wrapped BNB', category: 'token', riskLevel: 'safe', tags: ['erc20', 'wbnb'] },
    { address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', name: 'USDC', chain: 'bsc', protocol: 'Circle', category: 'stablecoin', riskLevel: 'safe', tags: ['erc20', 'stablecoin'] },
    { address: '0x55d398326f99059ff775485246999027b3197955', name: 'USDT', chain: 'bsc', protocol: 'Tether', category: 'stablecoin', riskLevel: 'safe', tags: ['erc20', 'stablecoin'] },
    { address: '0x10ed43c718714eb63d5aa57b78b54704e256024e', name: 'PancakeSwap: Router V2', chain: 'bsc', protocol: 'PancakeSwap', category: 'dex', riskLevel: 'safe', tags: ['dex', 'router'] },
    { address: '0x13f4ea83d0bd40e75c8222255bc855a974568dd4', name: 'PancakeSwap: Router V3', chain: 'bsc', protocol: 'PancakeSwap', category: 'dex', riskLevel: 'safe', tags: ['dex', 'router'] },
    { address: '0x1b81d678ffb9c0263b24a97847620c99d213eb14', name: 'PancakeSwap: Universal Router', chain: 'bsc', protocol: 'PancakeSwap', category: 'dex', riskLevel: 'safe', tags: ['dex', 'router'] },
    { address: '0xcf0febd3f17cef5b47b0cd257acf6025c5bff3b7', name: 'Venus: Comptroller', chain: 'bsc', protocol: 'Venus', category: 'lending', riskLevel: 'low', tags: ['lending'] },
    { address: '0xfd36e2c2a6789db23113685031d7f16329158384', name: 'Venus: vUSDT', chain: 'bsc', protocol: 'Venus', category: 'lending', riskLevel: 'low', tags: ['lending'] },

    // ── Derivatives ──────────────────────────────────────────────
    { address: '0xa4f8c7c1018b9dd3be5835bb07c48cd7c53c3b4e', name: 'dYdX: StarkProxy', chain: 'ethereum', protocol: 'dYdX', category: 'derivatives', riskLevel: 'low', tags: ['derivatives'] },
    { address: '0x8b7b1bfed7e2e8ce072f16e27db5dfafea7c5eeb', name: 'Synthetix V3: Core', chain: 'ethereum', protocol: 'Synthetix', category: 'derivatives', riskLevel: 'low', tags: ['derivatives'] },

    // ── Privacy ──────────────────────────────────────────────────
    { address: '0xba214c1c1928a32bffe790263e38b4af9bfcd659', name: 'Tornado Cash: Router', chain: 'ethereum', protocol: 'Tornado Cash', category: 'infrastructure', riskLevel: 'critical', tags: ['privacy', 'sanctioned'] },

    // ── Additional well-known ERC20s ─────────────────────────────
    { address: '0x4c9edd5852cd905f086c759e8383e09bff1e68b3', name: 'USDe', chain: 'ethereum', protocol: 'Ethena', category: 'stablecoin', riskLevel: 'low', tags: ['erc20', 'stablecoin'] },
    { address: '0x57e114b691db790c35207b2e685d4a43181e6061', name: 'ENA', chain: 'ethereum', protocol: 'Ethena', category: 'governance', riskLevel: 'low', tags: ['erc20', 'governance'] },
    { address: '0x9d39a5de30e57443bff2a8307a4256c8797a3497', name: 'sUSDe', chain: 'ethereum', protocol: 'Ethena', category: 'yield', riskLevel: 'low', tags: ['erc20', 'yield'] },
    { address: '0xa2e3356610840701bdf5611a53974510ae27e2e1', name: 'wBETH', chain: 'ethereum', protocol: 'Binance', category: 'liquid-staking', riskLevel: 'low', tags: ['erc20', 'lst'] },
    { address: '0xc5f0f7b66764f6ec8c8dff7ba683102295e16409', name: 'FDUSD', chain: 'ethereum', protocol: 'First Digital', category: 'stablecoin', riskLevel: 'low', tags: ['erc20', 'stablecoin'] },
    { address: '0xf939e0a03fb07f59a73314e73794be0e57ac1b4e', name: 'crvUSD', chain: 'ethereum', protocol: 'Curve', category: 'stablecoin', riskLevel: 'low', tags: ['erc20', 'stablecoin'] },
    { address: '0xf629cbd94d3791c9250152bd8dfbdf380e2a3b9c', name: 'ENJ', chain: 'ethereum', protocol: 'Enjin', category: 'token', riskLevel: 'low', tags: ['erc20', 'gaming'] },
    { address: '0x0bc529c00c6401aef6d220be8c6ea1667f6ad93e', name: 'YFI', chain: 'ethereum', protocol: 'Yearn', category: 'governance', riskLevel: 'safe', tags: ['erc20', 'governance'] },
    { address: '0x320623b8e4ff03373931769a31fc52a4e78b5d70', name: 'RSR', chain: 'ethereum', protocol: 'Reserve', category: 'governance', riskLevel: 'low', tags: ['erc20'] },
    { address: '0xb0c7a3ba49c7a6eaba6cd4a96c55a1391070ac9a', name: 'MAGIC', chain: 'arbitrum', protocol: 'Treasure', category: 'token', riskLevel: 'low', tags: ['erc20', 'gaming'] },
    { address: '0x539bde0d7dbd336b79148aa742883198bbf60342', name: 'MAGIC', chain: 'ethereum', protocol: 'Treasure', category: 'token', riskLevel: 'low', tags: ['erc20', 'gaming'] },
  ];

  console.log(`    → ${curated.length} curated contracts`);

  return curated.map((c) => ({
    ...c,
    source: 'curated',
  }));
}

// ── Merge + Deduplicate ──────────────────────────────────────────

function mergeEntries(existing: ContractLabel[], incoming: RawEntry[]): ContractLabel[] {
  const merged = new Map<string, ContractLabel>();

  for (const entry of existing) {
    const key = `${entry.address.toLowerCase()}:${entry.chain}`;
    merged.set(key, entry);
  }

  for (const raw of incoming) {
    const key = `${raw.address.toLowerCase()}:${raw.chain}`;
    if (merged.has(key) && merged.get(key)!.source === 'manual') continue;

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
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║   Registry Expansion — Target 500+ Contracts            ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log();

  // Load existing registry
  let existing: ContractLabel[] = [];
  try {
    const raw = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
    const parsed = ContractRegistrySchema.parse(raw);
    existing = parsed.entries;
    console.log(`  Existing registry: ${existing.length} entries\n`);
  } catch {
    console.log('  No existing registry found, starting fresh\n');
  }

  // Fetch from sources
  const [llamaProtocols, curatedContracts] = await Promise.all([
    fetchDefiLlamaProtocols(),
    Promise.resolve(getCuratedContracts()),
  ]);

  // Also try to get DeFiLlama protocol details for top protocols
  const protocolSlugs = await (async () => {
    try {
      const data = (await fetchJson('https://api.llama.fi/protocols')) as Array<{
        slug: string;
        tvl: number;
        address: string | null;
      }>;
      return data
        .filter((p) => p.tvl > 10_000_000)
        .sort((a, b) => b.tvl - a.tvl)
        .slice(0, 100)
        .map((p) => p.slug);
    } catch {
      return [];
    }
  })();

  const detailEntries = await fetchProtocolDetails(protocolSlugs);

  const allIncoming = [...llamaProtocols, ...detailEntries, ...curatedContracts];
  console.log(`\n  Total incoming entries: ${allIncoming.length}`);

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

  ContractRegistrySchema.parse(output);
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(output, null, 2) + '\n');

  // Stats
  const chains = new Map<string, number>();
  const categories = new Map<string, number>();
  const sources = new Map<string, number>();
  for (const e of merged) {
    chains.set(e.chain, (chains.get(e.chain) ?? 0) + 1);
    categories.set(e.category ?? 'unknown', (categories.get(e.category ?? 'unknown') ?? 0) + 1);
    sources.set(e.source ?? 'unknown', (sources.get(e.source ?? 'unknown') ?? 0) + 1);
  }

  console.log(`\n  ══════════════════════════════════════════════════════`);
  console.log(`  Registry updated: ${merged.length} entries (was ${existing.length})`);
  console.log(`\n  By chain:`);
  for (const [chain, count] of [...chains.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${chain}: ${count}`);
  }
  console.log(`\n  By category:`);
  for (const [cat, count] of [...categories.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${cat}: ${count}`);
  }
  console.log(`\n  By source:`);
  for (const [src, count] of [...sources.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${src}: ${count}`);
  }
  console.log(`\n  Written to ${REGISTRY_PATH}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
