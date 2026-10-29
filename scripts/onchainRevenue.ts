/**
 * Outside revenue straight from the chain: every USDC transfer into our Base and
 * Solana pay-to addresses, minus our buyer test wallets. Needs no database.
 *
 * Base comes from the Blockscout API filtered to the real USDC contract, so
 * address-poisoning transfers of fake "USDC" tokens are excluded. Solana comes
 * from the public RPC (slow; limited to the newest SOLANA_LIMIT signatures).
 *
 * Usage:  npx tsx scripts/onchainRevenue.ts [--json]
 */
import { summarizeRevenue, type Transfer } from '../src/analytics/onchainRevenue.js';

const BASE_PAY_TO = process.env.PAY_TO_ADDRESS ?? '0xFA6F352E71c44d217df04eCAD902C82B72D2378c';
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const SOLANA_PAY_TO = process.env.SOLANA_PAY_TO_ADDRESS ?? 'EtDHxiEoha4nj1LRmnpxxmD5zbbzegH8ohYrknZ2JMZv';
const SOLANA_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOLANA_RPC = process.env.SOLANA_PUBLIC_RPC ?? 'https://api.mainnet-beta.solana.com';
const SOLANA_LIMIT = 200;

async function getJson(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function baseTransfers(): Promise<Transfer[]> {
  const out: Transfer[] = [];
  let params = '';
  for (let page = 0; page < 50; page++) {
    const url = `https://base.blockscout.com/api/v2/addresses/${BASE_PAY_TO}/token-transfers?type=ERC-20&filter=to&token=${BASE_USDC}${params}`;
    const data = await getJson(url);
    for (const item of data.items ?? []) {
      if (item.token?.address_hash?.toLowerCase() !== BASE_USDC.toLowerCase()) continue;
      out.push({
        ts: item.timestamp,
        from: item.from.hash,
        usd: Number(item.total.value) / 1e6,
        chain: 'Base',
        tx: item.transaction_hash,
      });
    }
    if (!data.next_page_params) break;
    params = `&${new URLSearchParams(data.next_page_params).toString()}`;
  }
  return out;
}

async function rpc(method: string, params: unknown[]): Promise<any> {
  const data = await getJson(SOLANA_RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return data.result;
}

async function solanaTransfers(): Promise<Transfer[]> {
  const accounts = await rpc('getTokenAccountsByOwner', [SOLANA_PAY_TO, { mint: SOLANA_USDC }, { encoding: 'jsonParsed' }]);
  const out: Transfer[] = [];
  for (const { pubkey } of accounts?.value ?? []) {
    const sigs = await rpc('getSignaturesForAddress', [pubkey, { limit: SOLANA_LIMIT }]);
    for (const { signature, err } of sigs ?? []) {
      if (err) continue;
      const tx = await rpc('getTransaction', [signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]);
      const pre = tx?.meta?.preTokenBalances ?? [];
      const post = tx?.meta?.postTokenBalances ?? [];
      const ours = post.find((b: any) => b.mint === SOLANA_USDC && b.owner === SOLANA_PAY_TO);
      const before = pre.find((b: any) => b.accountIndex === ours?.accountIndex);
      const received = Number(ours?.uiTokenAmount.amount ?? 0) - Number(before?.uiTokenAmount.amount ?? 0);
      if (received <= 0) continue;
      const payer = pre.find((b: any) => b.mint === SOLANA_USDC && b.owner !== SOLANA_PAY_TO)?.owner ?? 'unknown';
      out.push({ ts: new Date(tx.blockTime * 1000).toISOString(), from: payer, usd: received / 1e6, chain: 'Solana', tx: signature });
    }
  }
  return out;
}

const [base, solana] = await Promise.all([
  baseTransfers(),
  solanaTransfers().catch((error) => {
    console.error(`Solana lookup failed: ${error}`);
    return [] as Transfer[];
  }),
]);
const summary = summarizeRevenue([...base, ...solana]);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`Outside revenue: ${summary.payments} payments, $${summary.usd} from ${summary.payers} wallets`);
  console.log(`Last 30 days:    ${summary.last30d.payments} payments, $${summary.last30d.usd} from ${summary.last30d.payers} wallets`);
  for (const [month, m] of Object.entries(summary.byMonth)) {
    console.log(`  ${month}: ${m.payments} payments, $${m.usd}, ${m.payers} wallets`);
  }
  console.log('Top payers:');
  for (const p of summary.topPayers) console.log(`  ${p.payer}  ${p.payments}x  $${p.usd}`);
}
