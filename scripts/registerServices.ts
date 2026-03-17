/**
 * Discovery Registration Checklist
 *
 * Run this after deploying to a public URL to get a registration checklist.
 */

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3402';

async function checkServer() {
  try {
    const healthRes = await fetch(`${SERVER_URL}/health`);
    if (!healthRes.ok) throw new Error(`Health check failed: ${healthRes.status}`);
    console.log('[OK] Server is reachable at', SERVER_URL);

    const catalogRes = await fetch(`${SERVER_URL}/catalog`);
    const catalog = (await catalogRes.json()) as { services: Array<{ endpoint: string }> };
    console.log(`[OK] Catalog lists ${catalog.services.length} services:`);
    for (const svc of catalog.services) {
      console.log(`     - ${svc.endpoint}`);
    }
  } catch (error) {
    console.error('[FAIL] Cannot reach server:', error);
    console.error('Make sure the server is running and SERVER_URL is set correctly.');
    process.exit(1);
  }
}

async function main() {
  console.log('AgentForge Discovery Registration\n');
  console.log('==================================\n');

  await checkServer();

  console.log('\nRegistration Checklist:');
  console.log('======================\n');
  console.log('1. [ ] Deploy server to public URL (Railway, Render, Fly.io, VPS)');
  console.log('2. [x] Verify /health returns 200');
  console.log('3. [x] Verify /catalog returns correct service list');
  console.log('4. [ ] Submit to x402scan.com (https://x402scan.com/submit)');
  console.log('5. [ ] Verify auto-indexing on x402 Bazaar (https://x402bazaar.com)');
  console.log('6. [ ] Register on Nexus by Thirdweb (https://nexus.thirdweb.com)');
  console.log('7. [ ] Test payment flow on testnet with funded wallet');
  console.log('8. [ ] Switch to mainnet (update .env: X402_NETWORK=base)');
  console.log('9. [ ] Test payment flow on mainnet with small amount');
  console.log('10.[ ] Monitor first real transactions in /dashboard');
  console.log('\nOptional:');
  console.log('11.[ ] Wrap endpoints as MCP tools for direct LLM agent integration');
  console.log('12.[ ] Set up UptimeRobot monitoring on /health');
}

main().catch(console.error);
