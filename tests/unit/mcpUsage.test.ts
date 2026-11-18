import { describe, it, expect } from 'vitest';
import { splitMcpUsage } from '../../src/analytics/mcpUsage.js';

describe('splitMcpUsage', () => {
  it('separates gas_oracle-only clients from real usage', () => {
    const s = splitMcpUsage([
      { client_hash: 'bot1', name: 'gas_oracle', calls: 40 },
      { client_hash: 'bot2', name: 'gas_oracle', calls: 30 },
      { client_hash: 'dev1', name: 'gas_oracle', calls: 2 },
      { client_hash: 'dev1', name: 'preflight', calls: 3 },
      { client_hash: 'dev2', name: 'content_scan', calls: 5 },
    ]);
    expect(s.total).toEqual({ calls: 80, clients: 4 });
    expect(s.pollers).toEqual({ calls: 70, clients: 2 });
    // dev1 also called gas_oracle, but used a real tool, so all its calls are real usage.
    expect(s.real).toEqual({ calls: 10, clients: 2 });
  });

  it('counts unattributed calls as real usage without inventing a client', () => {
    const s = splitMcpUsage([
      { client_hash: null, name: 'gas_oracle', calls: 4 },
      { client_hash: 'a', name: 'summarize', calls: 1 },
    ]);
    expect(s.real).toEqual({ calls: 5, clients: 1 });
    expect(s.pollers).toEqual({ calls: 0, clients: 0 });
    expect(s.total).toEqual({ calls: 5, clients: 1 });
  });

  it('handles an empty window and numeric strings from the driver', () => {
    expect(splitMcpUsage([]).total).toEqual({ calls: 0, clients: 0 });
    const s = splitMcpUsage([{ client_hash: 'x', name: 'gas_oracle', calls: '7' as unknown as number }]);
    expect(s.pollers).toEqual({ calls: 7, clients: 1 });
  });
});
