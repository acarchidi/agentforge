/**
 * Re-credit a prepaid-credits purchase from its Base settlement tx (admin).
 *
 * Use when the settlement hook logged "crediting failed for settled tx". Reads
 * the receipt, finds the USDC Transfer to PAY_TO_ADDRESS, maps the amount to a
 * pack and credits the sender. Idempotent: a tx already credited is skipped.
 *
 * Usage: npx tsx scripts/creditByTx.ts <txHash>
 */
import { config as env } from 'dotenv';
env({ path: '.env.local', quiet: true });
env({ quiet: true });

import { createPublicClient, http, parseEventLogs, erc20Abi } from 'viem';
import { base } from 'viem/chains';
import { config } from '../src/config.js';
import { PACK_BY_PRICE_MICRO } from '../src/credits/auth.js';
import { getCreditStore } from '../src/credits/store.js';
import { CHAIN_INFO } from '../src/utils/chains.js';

const tx = process.argv[2] as `0x${string}` | undefined;
if (!tx || !/^0x[0-9a-f]{64}$/i.test(tx)) throw new Error('usage: creditByTx.ts <txHash>');

const client = createPublicClient({ chain: base, transport: http() });
const receipt = await client.getTransactionReceipt({ hash: tx });
const transfer = parseEventLogs({ abi: erc20Abi, logs: receipt.logs, eventName: 'Transfer' }).find(
  (l) => l.address.toLowerCase() === CHAIN_INFO.base.usdc && l.args.to.toLowerCase() === config.PAY_TO_ADDRESS.toLowerCase(),
);
if (!transfer) throw new Error('no USDC transfer to PAY_TO_ADDRESS in this tx');
const pack = PACK_BY_PRICE_MICRO.get(transfer.args.value);
if (!pack) throw new Error(`amount ${transfer.args.value} is not a credit pack price`);
const wallet = transfer.args.from.toLowerCase();
const result = await getCreditStore().credit(wallet, pack.creditMicro, tx);
console.log(result, wallet, `+$${Number(pack.creditMicro) / 1e6}`);
