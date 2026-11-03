import { describe, it, expect } from 'vitest';
import { ROUTE_METADATA } from '../../src/middleware/x402.js';
import { ENDPOINT_PRICES } from '../../src/pricing.js';

// The x402 bazaar extension drops service names over 32 chars and tags past
// the 5th or over 32 chars; keep every route inside the limits it ranks on.
describe('Bazaar listing metadata', () => {
  it('covers every paid endpoint', () => {
    for (const path of Object.keys(ENDPOINT_PRICES)) expect(ROUTE_METADATA[path], path).toBeDefined();
  });

  it('stays within the SDK limits', () => {
    for (const [path, m] of Object.entries(ROUTE_METADATA)) {
      expect(m.name.length, path).toBeLessThanOrEqual(32);
      expect(m.name).toMatch(/^[\x20-\x7E]+$/);
      expect(m.tags.length, path).toBeLessThanOrEqual(5);
      for (const t of m.tags) expect(t.length, `${path} ${t}`).toBeLessThanOrEqual(32);
      expect(new Set(m.tags.map((t) => t.toLowerCase())).size, path).toBe(m.tags.length);
    }
  });
});
