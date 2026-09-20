import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'af-analytics-'));
process.env.DATABASE_PATH = path.join(tmp, 'test.db');
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;

const { getStore, resetStore } = await import('../../src/analytics/store.js');
const { logEvent } = await import('../../src/analytics/logger.js');
const { hashClientId, paymentContextFromRequest } = await import('../../src/analytics/clientId.js');
const { createMcpServer, MCP_DAILY_CAP, relatedServicesFor } = await import('../../src/mcp/server.js');

describe('analytics store (sqlite fallback)', () => {
  beforeAll(async () => {
    resetStore();
    await getStore().init();
  });
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('uses sqlite when no DATABASE_URL is set', () => {
    expect(getStore().backend).toBe('sqlite');
  });

  it('records events and aggregates them in the daily summary', async () => {
    await logEvent({ kind: 'paid', name: '/v1/ping', success: true, latencyMs: 12, clientHash: 'c1', amountUsd: 0.001, paymentNetwork: 'eip155:8453', paymentScheme: 'exact' });
    await logEvent({ kind: 'paid', name: '/v1/ping', success: true, latencyMs: 15, clientHash: 'c1', amountUsd: 0.001 });
    await logEvent({ kind: 'mcp', name: 'gas_oracle', success: true, latencyMs: 40, clientHash: 'm1', chain: 'base' });
    await logEvent({ kind: 'mcp', name: 'gas_oracle', success: false, latencyMs: 40, clientHash: 'm2', errorClass: 'internal' });

    const summary = await getStore().dailySummary(1);
    const ping = summary.perDay.find((r) => r.name === '/v1/ping');
    expect(ping?.calls).toBe(2);
    expect(ping?.uniqueClients).toBe(1);
    const gas = summary.perDay.find((r) => r.name === 'gas_oracle');
    expect(gas?.uniqueClients).toBe(2);
    expect(summary.split[0].mcp).toBe(2);
    expect(summary.split[0].paid).toBe(2);
    expect(summary.topTools.length).toBeGreaterThan(0);
    const repeat = summary.repeatClients.find((r) => r.name === '/v1/ping');
    expect(repeat?.repeatClients).toBe(1);

    const revenue = await getStore().revenue();
    expect(Number((revenue[0] as { total_revenue_usd: number }).total_revenue_usd)).toBeCloseTo(0.002, 5);
  });

  it('counts per-client events for today', async () => {
    await logEvent({ kind: 'mcp', name: 'solana_tx_explain', success: true, clientHash: 'capme' });
    expect(await getStore().countToday('mcp', 'solana_tx_explain', 'capme')).toBe(1);
    expect(await getStore().countToday('mcp', 'solana_tx_explain', 'other')).toBe(0);
  });

  it('prunes old rows only', async () => {
    expect(await getStore().pruneOlderThan(90)).toBe(0);
  });
});

describe('client hashing', () => {
  it('never returns the raw identifier and is stable', () => {
    const h = hashClientId('0xABCDEF');
    expect(h).toHaveLength(16);
    expect(h).not.toContain('abcdef');
    expect(hashClientId('0xabcdef')).toBe(h);
  });

  it('extracts payer, network and scheme from a v2 PAYMENT-SIGNATURE header', () => {
    const payload = {
      x402Version: 2,
      accepted: { scheme: 'exact', network: 'eip155:8453', extra: { name: 'USD Coin', version: '2' } },
      payload: { signature: '0x', authorization: { from: '0x794241c8b08C4b91FF840A64Ecd74ff9BDf7C135', to: '0x0' } },
    };
    const header = Buffer.from(JSON.stringify(payload)).toString('base64');
    const ctx = paymentContextFromRequest({ headers: { 'payment-signature': header } } as never);
    expect(ctx.paymentNetwork).toBe('eip155:8453');
    expect(ctx.paymentScheme).toBe('exact');
    expect(ctx.clientHash).toBe(hashClientId('0x794241c8b08C4b91FF840A64Ecd74ff9BDf7C135'));
  });

  it('tags permit2 transfers distinctly', () => {
    const payload = {
      x402Version: 2,
      accepted: { scheme: 'exact', network: 'eip155:8453', extra: { assetTransferMethod: 'permit2' } },
      payload: { permit2Authorization: { from: '0x1111111111111111111111111111111111111111' } },
    };
    const header = Buffer.from(JSON.stringify(payload)).toString('base64');
    expect(paymentContextFromRequest({ headers: { 'payment-signature': header } } as never).paymentScheme).toBe('exact/permit2');
  });
});

describe('MCP daily cap and relatedServices', () => {
  it('lists the paid endpoint with price for every paid tool', () => {
    const rel = relatedServicesFor('solana_token_risk_scan', null);
    expect(rel[0].endpoint).toContain('/v1/solana/token-risk-scan');
    expect(rel[0].price).toMatch(/^\$/);
    expect(relatedServicesFor('gas_oracle', null)[0].endpoint).toContain('/v1/gas');
  });

  it('caps a capped tool after MCP_DAILY_CAP calls and returns the pay-per-use pointer', async () => {
    const clientHash = 'cap-test-client';
    for (let i = 0; i < MCP_DAILY_CAP; i++) {
      await logEvent({ kind: 'mcp', name: 'solana_tx_simulate', success: true, clientHash });
    }
    const server = createMcpServer({ clientHash });
    const tool = (server as any)._registeredTools['solana_tx_simulate'];
    const res = await tool.handler({ transaction: 'AAAA' }, {});
    expect(res.isError).toBe(true);
    const body = JSON.parse(res.content[0].text);
    expect(body.error).toBe('DAILY_CAP_REACHED');
    expect(body.payPerUse.endpoint).toContain('/v1/solana/tx-simulate');
    expect(body.payPerUse.price).toMatch(/^\$/);
    expect(body.payPerUse.instruction).toContain('x402');
    expect(await getStore().countToday('cap_hit', 'solana_tx_simulate', clientHash)).toBe(1);
  });

  it('does not cap free or EVM tools', async () => {
    const clientHash = 'uncapped-client';
    for (let i = 0; i < MCP_DAILY_CAP + 2; i++) {
      await logEvent({ kind: 'mcp', name: 'solana_program_lookup', success: true, clientHash });
    }
    const server = createMcpServer({ clientHash });
    const tool = (server as any)._registeredTools['solana_program_lookup'];
    const res = await tool.handler({ programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' }, {});
    expect(res.isError).toBeUndefined();
    const body = JSON.parse(res.content[0].text);
    expect(Array.isArray(body.relatedServices)).toBe(true);
  });
});

describe('AgentKit free trial storage', () => {
  it('increments atomically up to the limit then refuses', async () => {
    const store = getStore();
    expect(await store.tryIncrementUsage('/v1/solana/tx-explain', 'h1', 2)).toBe(true);
    expect(await store.tryIncrementUsage('/v1/solana/tx-explain', 'h1', 2)).toBe(true);
    expect(await store.tryIncrementUsage('/v1/solana/tx-explain', 'h1', 2)).toBe(false);
    expect(await store.tryIncrementUsage('/v1/solana/tx-explain', 'h2', 2)).toBe(true);
  });

  it('tracks nonces', async () => {
    const store = getStore();
    expect(await store.hasUsedNonce('n1')).toBe(false);
    await store.recordNonce('n1');
    expect(await store.hasUsedNonce('n1')).toBe(true);
  });
});

describe('discoverability metadata', () => {
  it('declares the agentkit trial only on tx-explain and permit2 once per EVM route', async () => {
    const { applyDiscoverabilityMetadata, ROUTE_METADATA } = await import('../../src/middleware/x402.ts');
    const mk = (path: string) => ({
      accepts: [{ scheme: 'exact', network: 'eip155:8453', payTo: '0x0', price: '$0.01' }],
      extensions: { bazaar: { info: {}, schema: {} } },
    });
    const routes: Record<string, any> = {
      'POST /v1/solana/tx-explain': mk('/v1/solana/tx-explain'),
      'POST /v1/solana/token-risk-scan': mk('/v1/solana/token-risk-scan'),
      'GET /v1/ping': mk('/v1/ping'),
    };
    routes['* /v1/ping'] = routes['GET /v1/ping']; // alias shares the object, like the real config
    applyDiscoverabilityMetadata(routes);
    expect(routes['POST /v1/solana/tx-explain'].extensions.agentkit).toBeDefined();
    expect(routes['POST /v1/solana/tx-explain'].extensions.agentkit._options.mode).toEqual({ type: 'free-trial', uses: 25 });
    expect(routes['POST /v1/solana/token-risk-scan'].extensions.agentkit).toBeUndefined();
    expect(routes['GET /v1/ping'].extensions.agentkit).toBeUndefined();
    for (const r of Object.values(routes)) {
      expect(r.serviceName).toBe('AgentForge');
      expect(r.iconUrl).toContain('/brand/agentforge-icon-512.png');
      expect(r.extensions.bazaar.discoverable).toBe(true);
      expect(Object.keys(ROUTE_METADATA)).toContain(r.extensions.bazaar.tags && Object.keys(ROUTE_METADATA).find((k) => ROUTE_METADATA[k].tags === r.tags));
      const permit2 = r.accepts.filter((a: any) => a.extra?.assetTransferMethod === 'permit2');
      expect(permit2).toHaveLength(1);
    }
  });
});
