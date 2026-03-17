/**
 * First-Run Verification Script
 *
 * Verifies a deployed AgentForge server is working correctly.
 *
 * Usage:
 *   AGENTFORGE_URL=https://your-url.railway.app ADMIN_TOKEN=your-token npx tsx scripts/firstRun.ts
 */

import dotenv from 'dotenv';
dotenv.config();

const BASE_URL = process.env.AGENTFORGE_URL || 'http://localhost:3402';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

const results: CheckResult[] = [];

async function check(
  name: string,
  fn: () => Promise<string>,
): Promise<void> {
  try {
    const detail = await fn();
    results.push({ name, pass: true, detail });
    console.log(`  ✓ ${name}: ${detail}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    results.push({ name, pass: false, detail: msg });
    console.log(`  ✗ ${name}: ${msg}`);
  }
}

async function main() {
  console.log(`\nAgentForge First-Run Verification`);
  console.log(`Server: ${BASE_URL}\n`);

  // 1. Health check
  await check('Health endpoint', async () => {
    const res = await fetch(`${BASE_URL}/health`);
    if (res.status !== 200) throw new Error(`Status ${res.status}`);
    const body = (await res.json()) as { status: string };
    return `Status: ${body.status}`;
  });

  // 2. Catalog
  await check('Service catalog', async () => {
    const res = await fetch(`${BASE_URL}/catalog`);
    if (res.status !== 200) throw new Error(`Status ${res.status}`);
    const body = (await res.json()) as { services: unknown[] };
    return `${body.services.length} services listed`;
  });

  // 3. x402 gating — each paid endpoint should return 402
  for (const endpoint of [
    '/v1/sentiment',
    '/v1/summarize',
    '/v1/token-intel',
    '/v1/code-review',
    '/v1/translate',
  ]) {
    await check(`x402 gating: ${endpoint}`, async () => {
      const res = await fetch(`${BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'test' }),
      });
      if (res.status === 402) {
        return 'Correctly returns 402 Payment Required';
      } else if (res.status === 200) {
        throw new Error(
          'CRITICAL: Returns 200 without payment! Middleware not working.',
        );
      } else {
        throw new Error(`Unexpected status: ${res.status}`);
      }
    });
  }

  // 4. Ping endpoint
  await check('Ping endpoint (x402)', async () => {
    const res = await fetch(`${BASE_URL}/v1/ping`);
    if (res.status === 402) return 'Correctly gated';
    if (res.status === 404) return 'Not implemented (optional)';
    throw new Error(`Unexpected status: ${res.status}`);
  });

  // 5. Admin endpoints
  if (ADMIN_TOKEN) {
    await check('Admin stats', async () => {
      const res = await fetch(`${BASE_URL}/admin/stats`, {
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      if (res.status !== 200) throw new Error(`Status ${res.status}`);
      return 'Admin API accessible';
    });

    await check('Admin auth rejection', async () => {
      const res = await fetch(`${BASE_URL}/admin/stats`, {
        headers: { Authorization: 'Bearer wrong-token' },
      });
      if (res.status === 401) return 'Correctly rejects bad token';
      throw new Error(`Expected 401, got ${res.status}`);
    });
  }

  // 6. Dashboard page
  await check('Dashboard page', async () => {
    const res = await fetch(`${BASE_URL}/dashboard`);
    if (res.status === 200) return 'Dashboard HTML served';
    if (res.status === 404) return 'Not found (check static file serving)';
    throw new Error(`Status ${res.status}`);
  });

  // 7. CORS headers
  await check('CORS headers', async () => {
    const res = await fetch(`${BASE_URL}/health`);
    const cors = res.headers.get('access-control-allow-origin');
    if (cors === '*') return 'CORS enabled (*)';
    throw new Error(`Missing or incorrect CORS header: ${cors}`);
  });

  // Summary
  console.log('\n─────────────────────────────────');
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    console.log('\nFailed checks:');
    for (const r of results.filter((r) => !r.pass)) {
      console.log(`  ✗ ${r.name}: ${r.detail}`);
    }
    console.log('\nFix these before accepting payments.');
    process.exit(1);
  } else {
    console.log(
      '\nAll checks passed. Server is ready for x402 payments.',
    );
    console.log('\nNext: get testnet USDC and run npm run test:x402');
  }
}

main().catch(console.error);
