import { describe, it, expect, vi } from 'vitest';
import { config as loadEnv } from 'dotenv';
loadEnv({ quiet: true });

const { getSupportedWithFallback, parseSupportedSnapshot } = await import('../../src/middleware/x402.js');

const snapshot = JSON.stringify({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453' }], extensions: [], signers: {} });

describe('facilitator /supported fallback', () => {
  it('returns the live response when the fetch succeeds', async () => {
    const live = { kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453' }], extensions: [], signers: {} };
    await expect(getSupportedWithFallback(async () => live as never, snapshot)).resolves.toBe(live);
  });

  it('uses the snapshot when the live fetch fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await getSupportedWithFallback(async () => { throw new Error('timeout'); }, snapshot);
    expect(result.kinds[0].network).toBe('eip155:8453');
  });

  it('rethrows when there is no usable snapshot', async () => {
    const fail = async () => { throw new Error('timeout'); };
    await expect(getSupportedWithFallback(fail, undefined)).rejects.toThrow('timeout');
    await expect(getSupportedWithFallback(fail, '{"kinds":[]}')).rejects.toThrow('timeout');
    await expect(getSupportedWithFallback(fail, 'not json')).rejects.toThrow('timeout');
  });

  it('retries a 401 once with a fresh call before falling back', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const live = { kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453' }], extensions: [], signers: {} };
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('Facilitator getSupported failed (401): Unauthorized'))
      .mockResolvedValueOnce(live);
    await expect(getSupportedWithFallback(fn, undefined)).resolves.toBe(live);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry other errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('timeout'));
    await expect(getSupportedWithFallback(fn, undefined)).rejects.toThrow('timeout');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('parses only snapshots with a non-empty kinds array', () => {
    expect(parseSupportedSnapshot(snapshot)?.kinds).toHaveLength(1);
    expect(parseSupportedSnapshot('{}')).toBeUndefined();
  });
});
