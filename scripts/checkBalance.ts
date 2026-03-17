import { createPublicClient, http, formatUnits } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import dotenv from 'dotenv';

dotenv.config();

const USDC_ADDRESSES: Record<string, `0x${string}`> = {
  base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  'base-sepolia': '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
};

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
  const address = process.env.PAY_TO_ADDRESS as `0x${string}`;
  const network = (process.env.X402_NETWORK || 'base-sepolia') as string;

  if (!address) {
    console.error('PAY_TO_ADDRESS not set in .env');
    process.exit(1);
  }

  const chain = network === 'base' ? base : baseSepolia;
  const client = createPublicClient({
    chain,
    transport: http(),
  });

  const usdcAddress = USDC_ADDRESSES[network];
  if (!usdcAddress) {
    console.error(`Unknown network: ${network}`);
    process.exit(1);
  }

  console.log(`Checking balance for ${address} on ${network}...`);

  const [ethBalance, usdcBalance] = await Promise.all([
    client.getBalance({ address }),
    client.readContract({
      address: usdcAddress,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [address],
    }),
  ]);

  console.log(`ETH Balance:  ${formatUnits(ethBalance, 18)} ETH`);
  console.log(`USDC Balance: ${formatUnits(usdcBalance, 6)} USDC`);
}

main().catch(console.error);
