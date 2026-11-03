/**
 * Process-wide pacing for Etherscan v2 calls.
 *
 * The free plan allows 5 calls/sec per key and answers over-limit calls with a
 * NOTOK body instead of an HTTP error, which callers used to misread as "no
 * ABI" or "unverified". Every Etherscan caller awaits a slot here first.
 */

const MIN_GAP_MS = 220;
let nextSlot = 0;

export async function etherscanSlot(): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + MIN_GAP_MS;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

export function isEtherscanRateLimit(result: unknown): boolean {
  return /rate limit/i.test(String(result));
}
