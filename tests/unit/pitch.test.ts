import { describe, it, expect } from 'vitest';
import { withPitch, unpaidBody, mcpInstructions, guardPitch, creditsPitch } from '../../src/discovery/pitch.js';
import { pingCatalog } from '../../src/discovery/upsell.js';
import { buildRouteConfig } from '../../src/middleware/x402.js';

describe('pitch: what every agent touching AgentForge learns', () => {
  it('appends the Guard to security responses and credits to per-call payers, once', () => {
    const out = withPitch('/v1/preflight', { verdict: 'proceed', relatedServices: [] }, { paidWithCredits: false }) as { relatedServices: Array<{ endpoint: string }> };
    expect(out.relatedServices.map((r) => r.endpoint)).toEqual(['npm:agentforge-tools', '/v1/credits/buy']);
    const again = withPitch('/v1/preflight', out, { paidWithCredits: false }) as typeof out;
    expect(again.relatedServices).toHaveLength(2);
  });

  it('skips the Guard on non-security endpoints and credits for credit payers', () => {
    const gas = withPitch('/v1/gas', { relatedServices: [] }, { paidWithCredits: false }) as { relatedServices: Array<{ endpoint: string }> };
    expect(gas.relatedServices.map((r) => r.endpoint)).toEqual(['/v1/credits/buy']);
    const viaCredits = withPitch('/v1/sentiment', { relatedServices: [] }, { paidWithCredits: true }) as { relatedServices: unknown[] };
    expect(viaCredits.relatedServices).toHaveLength(0);
    expect(withPitch('/v1/x', { noList: true }, { paidWithCredits: false })).toEqual({ noList: true });
  });

  it('every paid route has an unpaid 402 body that names price, credits, MCP and the Guard', () => {
    const routes = buildRouteConfig() as Record<string, { unpaidResponseBody?: (c: unknown) => { contentType: string; body: Record<string, unknown> } }>;
    const keys = Object.keys(routes).filter((k) => !k.startsWith('*'));
    expect(keys.length).toBeGreaterThan(25);
    for (const k of keys) {
      const fn = routes[k].unpaidResponseBody;
      expect(fn, k).toBeTypeOf('function');
      const { contentType, body } = fn!({});
      expect(contentType).toBe('application/json');
      expect(body.error).toBe('PAYMENT_REQUIRED');
      expect(body.guard).toEqual(guardPitch());
      expect((body.cheaperOptions as Record<string, unknown>).credits).toEqual(creditsPitch());
    }
    expect(unpaidBody('/v1/content-scan').price).toMatch(/per 4 KB/i);
  });

  it('ping and MCP instructions mention the Guard, credits and content_scan', () => {
    const ping = pingCatalog();
    expect(ping.guard).toEqual(guardPitch());
    expect(ping.credits).toEqual(creditsPitch());
    const text = mcpInstructions(10);
    expect(text).toMatch(/preflight/);
    expect(text).toMatch(/content_scan/);
    expect(text).toMatch(/agentforge-tools/);
  });
});
