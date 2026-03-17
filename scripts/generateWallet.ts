import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const key = generatePrivateKey();
const account = privateKeyToAccount(key);

console.log('=== New EVM Wallet ===');
console.log(`Address:     ${account.address}`);
console.log(`Private Key: ${key}`);
console.log('');
console.log('IMPORTANT:');
console.log('- Save the private key securely. You cannot recover it.');
console.log('- Set PAY_TO_ADDRESS in .env to the Address above.');
console.log('- For testnet: get USDC from https://faucet.circle.com (Base Sepolia)');
console.log('- For mainnet: transfer USDC to this address on Base network');
console.log(
  `- View balance at: https://basescan.org/address/${account.address}`,
);
