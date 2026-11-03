/**
 * Rebuild src/cache/data/address-reputation.json from public, permissively
 * licensed address lists:
 *
 *  - OFAC SDN digital-currency addresses, extracted by
 *    github.com/0xB10C/ofac-sanctioned-digital-currency-addresses (MIT; the
 *    underlying SDN list is US-government public data).
 *  - MyEtherWallet ethereum-lists darklist (MIT): phishing / scam wallets.
 *
 * EVM addresses are chain-agnostic (the same key controls the address on
 * every EVM chain), so all EVM lists are merged into one map.
 *
 * Usage:  npx tsx scripts/refreshAddressLists.ts
 * Run it periodically (OFAC adds addresses a few times a year) and commit the result.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const OFAC_BASE = 'https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists';
const OFAC_EVM = ['ETH', 'ARB', 'BSC', 'USDC', 'USDT', 'ETC'];
const OFAC_SOL = ['SOL'];
const MEW_DARKLIST = 'https://raw.githubusercontent.com/MyEtherWallet/ethereum-lists/master/src/addresses/addresses-darklist.json';

interface Hit {
  source: 'ofac-sdn' | 'mew-darklist';
  note?: string;
}

async function text(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.text();
}

function add(map: Record<string, Hit[]>, key: string, hit: Hit) {
  const list = (map[key] ??= []);
  if (!list.some((h) => h.source === hit.source)) list.push(hit);
}

const evm: Record<string, Hit[]> = {};
const solana: Record<string, Hit[]> = {};
const counts: Record<string, number> = {};

for (const asset of OFAC_EVM) {
  const lines = (await text(`${OFAC_BASE}/sanctioned_addresses_${asset}.txt`)).split('\n').map((l) => l.trim()).filter(Boolean);
  for (const a of lines) {
    if (/^0x[a-fA-F0-9]{40}$/.test(a)) add(evm, a.toLowerCase(), { source: 'ofac-sdn', note: `OFAC SDN list (${asset})` });
  }
  counts[`ofac-${asset}`] = lines.length;
}
for (const asset of OFAC_SOL) {
  const lines = (await text(`${OFAC_BASE}/sanctioned_addresses_${asset}.txt`)).split('\n').map((l) => l.trim()).filter(Boolean);
  for (const a of lines) add(solana, a, { source: 'ofac-sdn', note: `OFAC SDN list (${asset})` });
  counts[`ofac-${asset}`] = lines.length;
}

const dark = JSON.parse(await text(MEW_DARKLIST)) as Array<{ address: string; comment?: string }>;
for (const d of dark) {
  if (/^0x[a-fA-F0-9]{40}$/.test(d.address)) add(evm, d.address.toLowerCase(), { source: 'mew-darklist', note: d.comment?.slice(0, 200) });
}
counts['mew-darklist'] = dark.length;

const out = {
  generatedAt: new Date().toISOString(),
  sources: [
    { id: 'ofac-sdn', license: 'MIT (extraction) / public domain (SDN list)', url: 'https://github.com/0xB10C/ofac-sanctioned-digital-currency-addresses' },
    { id: 'mew-darklist', license: 'MIT', url: 'https://github.com/MyEtherWallet/ethereum-lists' },
  ],
  counts,
  evm,
  solana,
};

const dest = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/cache/data/address-reputation.json');

// Only rewrite when the address sets change: generatedAt alone must not
// produce a commit (and a production deploy) from the scheduled workflow.
const sameLists = (() => {
  try {
    const prev = JSON.parse(readFileSync(dest, 'utf8'));
    return JSON.stringify([prev.evm, prev.solana]) === JSON.stringify([evm, solana]);
  } catch {
    return false;
  }
})();
if (sameLists) {
  console.log('Address lists unchanged; nothing written.', counts);
  process.exit(0);
}
writeFileSync(dest, `${JSON.stringify(out, null, 1)}\n`);
console.log(`Wrote ${Object.keys(evm).length} EVM + ${Object.keys(solana).length} Solana addresses to ${dest}`, counts);
