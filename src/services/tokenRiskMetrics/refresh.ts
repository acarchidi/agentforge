/**
 * Refresh script helpers for token risk metrics.
 * Pure functions for stage/resume logic, testable without side effects.
 */

/**
 * Compute the slice of addresses to process based on limit.
 */
export function computeStage(addresses: string[], limit: number, _resume?: string): string[] {
  return addresses.slice(0, limit);
}

/**
 * Return addresses starting from the given resumeFrom address (inclusive).
 * Returns all addresses if resumeFrom is not found.
 */
export function shouldResumeFrom(addresses: string[], resumeFrom: string): string[] {
  const idx = addresses.findIndex((a) => a.toLowerCase() === resumeFrom.toLowerCase());
  if (idx === -1) return addresses;
  return addresses.slice(idx);
}
