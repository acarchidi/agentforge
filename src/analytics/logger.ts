import { getStore, maybePrune, type AnalyticsEvent } from './store.js';

/**
 * Record one analytics event. Never throws — analytics must not break a paid
 * request or an MCP tool call. Callers may `await` it to make sure the write
 * lands before a serverless function is frozen.
 */
export async function logEvent(event: AnalyticsEvent): Promise<void> {
  try {
    await getStore().insertEvent(event);
    void maybePrune();
  } catch (error) {
    console.error('Failed to log analytics event:', error);
  }
}

/** Back-compat shim for older call sites: a paid HTTP call without payment context. */
export function logCall(log: {
  endpoint: string;
  success: boolean;
  latencyMs: number;
  inputSize?: number;
  outputSize?: number;
  errorType?: string;
}): Promise<void> {
  return logEvent({
    kind: 'paid',
    name: log.endpoint,
    success: log.success,
    latencyMs: log.latencyMs,
    inputSize: log.inputSize,
    outputSize: log.outputSize,
    errorClass: log.errorType,
  });
}
