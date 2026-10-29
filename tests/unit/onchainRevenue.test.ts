import { describe, it, expect } from 'vitest';
import { summarizeRevenue, type Transfer } from '../../src/analytics/onchainRevenue.js';

const now = new Date('2026-10-29T12:00:00Z');
const t = (ts: string, from: string, usd: number): Transfer => ({ ts, from, usd, chain: 'Base', tx: `0x${ts}` });

describe('summarizeRevenue', () => {
  it('drops buyer test wallets and buckets by month and the last 30 days', () => {
    const s = summarizeRevenue([
      t('2026-07-10T00:00:00Z', '0xAAA', 0.05),
      t('2026-10-08T06:12:00Z', '0xBBB', 0.1),
      t('2026-10-20T00:00:00Z', '0xbbb', 0.002),
      t('2026-10-21T00:00:00Z', '0x794241C8B08C4B91FF840A64ECD74FF9BDF7C135', 1),
    ], now);

    expect(s.payments).toBe(3);
    expect(s.usd).toBeCloseTo(0.152);
    expect(s.payers).toBe(2);
    expect(s.last30d).toEqual({ payments: 2, usd: 0.102, payers: 1 });
    expect(Object.keys(s.byMonth)).toEqual(['2026-07', '2026-10']);
    expect(s.topPayers[0]).toEqual({ payer: '0xbbb', payments: 2, usd: 0.102 });
  });

  it('returns zeros for no transfers', () => {
    const s = summarizeRevenue([], now);
    expect(s).toMatchObject({ payments: 0, usd: 0, payers: 0, topPayers: [] });
  });
});
