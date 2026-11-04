/**
 * Register AgentForge in the ERC-8004 Identity Registry on Base (one-time).
 *
 * Mints an agent id whose agentURI is our /.well-known/agent-registration.json,
 * so x402 clients and explorers (8004scan) can find and rate the service.
 * Sends one transaction from TEST_WALLET_PRIVATE_KEY; needs a little ETH on
 * Base for gas (well under $0.01). Run with --dry-run to simulate only.
 *
 * Usage: npm run register:8004 [-- --dry-run]
 */
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

import { createPublicClient, createWalletClient, http, parseAbi, parseEventLogs } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { ERC8004_REGISTRY } from '../src/discovery/manifests.js';

const AGENT_URI = 'https://agentforge-taupe.vercel.app/.well-known/agent-registration.json';
const abi = parseAbi([
  'function register(string agentURI) returns (uint256 agentId)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
]);

const key = process.env.TEST_WALLET_PRIVATE_KEY as `0x${string}` | undefined;
if (!key) throw new Error('TEST_WALLET_PRIVATE_KEY not set in .env');
const account = privateKeyToAccount(key);
const pub = createPublicClient({ chain: base, transport: http() });
const wallet = createWalletClient({ account, chain: base, transport: http() });

const eth = await pub.getBalance({ address: account.address });
console.log(`Wallet ${account.address}: ${Number(eth) / 1e18} ETH on Base`);

const { request, result } = await pub.simulateContract({ account, address: ERC8004_REGISTRY, abi, functionName: 'register', args: [AGENT_URI] });
console.log(`Simulation OK: would mint agent id ${result}`);
if (process.argv.includes('--dry-run')) process.exit(0);
if (eth === 0n) {
  console.error('No ETH for gas. Send ~$0.05 of ETH on Base to the wallet above, then rerun.');
  process.exit(1);
}

const hash = await wallet.writeContract(request);
console.log(`Sent: https://basescan.org/tx/${hash}`);
const receipt = await pub.waitForTransactionReceipt({ hash });
const minted = parseEventLogs({ abi, logs: receipt.logs, eventName: 'Transfer' })[0];
console.log(`\nRegistered. Agent id: ${minted?.args.tokenId ?? result}`);
console.log(`Explorer: https://8004scan.io/agents/base/${minted?.args.tokenId ?? result}`);
