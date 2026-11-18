/**
 * Split MCP usage into health-check pollers and real usage (growth plan WP-10d).
 *
 * A "poller" is a client whose every MCP call in the window was one of the
 * POLLER_TOOLS (today only `gas_oracle`, the tool uptime bots use as a cheap
 * liveness probe). Calls without a client hash cannot be attributed and count
 * as real usage.
 */
export const POLLER_TOOLS: readonly string[] = ['gas_oracle'];

export interface McpUsageRow {
  client_hash: string | null;
  name: string;
  calls: number;
}

export interface McpUsageSplit {
  total: { calls: number; clients: number };
  pollers: { calls: number; clients: number };
  real: { calls: number; clients: number };
}

export function splitMcpUsage(rows: McpUsageRow[], pollerTools: readonly string[] = POLLER_TOOLS): McpUsageSplit {
  const poller = new Set(pollerTools);
  const byClient = new Map<string, { calls: number; onlyPollerTools: boolean }>();
  let anonCalls = 0;
  for (const r of rows) {
    const calls = Number(r.calls) || 0;
    if (!r.client_hash) {
      anonCalls += calls;
      continue;
    }
    const c = byClient.get(r.client_hash) ?? { calls: 0, onlyPollerTools: true };
    c.calls += calls;
    if (!poller.has(r.name)) c.onlyPollerTools = false;
    byClient.set(r.client_hash, c);
  }
  const split: McpUsageSplit = {
    total: { calls: anonCalls, clients: byClient.size },
    pollers: { calls: 0, clients: 0 },
    real: { calls: anonCalls, clients: 0 },
  };
  for (const c of byClient.values()) {
    split.total.calls += c.calls;
    const bucket = c.onlyPollerTools ? split.pollers : split.real;
    bucket.calls += c.calls;
    bucket.clients += 1;
  }
  return split;
}
