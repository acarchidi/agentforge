import dotenv from 'dotenv';
dotenv.config();

import { createPublicClient, http, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';

const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const ERC20_ABI = [
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

async function main() {
  const pk = process.env.TEST_WALLET_PRIVATE_KEY;
  if (!pk) {
    console.error('No TEST_WALLET_PRIVATE_KEY in .env');
    process.exit(1);
  }

  const account = privateKeyToAccount(pk as `0x${string}`);
  console.log(`Buyer wallet: ${account.address}`);

  const client = createPublicClient({ chain: base, transport: http() });

  const [ethBal, usdcBal] = await Promise.all([
    client.getBalance({ address: account.address }),
    client.readContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [account.address],
    }),
  ]);

  console.log(`ETH Balance:  ${formatUnits(ethBal, 18)} ETH`);
  console.log(`USDC Balance: ${formatUnits(usdcBal, 6)} USDC`);

  const needed = 0.086 + 0.003 + 0.01 + 0.015 + 0.015 + 0.035 + 0.08 + 0.008 + 0.01 + 0.015 + 0.04 + 0.05;
  console.log(`\nEstimated USDC needed for all remaining endpoints: ~$${needed.toFixed(3)}`);
  const usdcNum = Number(formatUnits(usdcBal, 6));
  console.log(`Sufficient funds: ${usdcNum >= needed ? 'YES' : 'NO — needs top-up'}`);
}

main().catch(console.error);
