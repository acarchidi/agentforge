import { describe, it, expect } from 'vitest';
import { mcpServer } from '../../src/mcp/server.js';

describe('MCP Server', () => {
  it('has correct server name and version', () => {
    const info = (mcpServer as any).server._serverInfo;
    expect(info.name).toBe('agentforge');
    expect(info.version).toBe('1.0.0');
  });

  it('registers all 16 tools', () => {
    const tools = Object.keys((mcpServer as any)._registeredTools);
    expect(tools).toHaveLength(16);
    expect(tools).toContain('token_intel');
    expect(tools).toContain('token_research');
    expect(tools).toContain('code_review');
    expect(tools).toContain('contract_docs');
    expect(tools).toContain('contract_monitor');
    expect(tools).toContain('token_compare');
    expect(tools).toContain('tx_decode');
    expect(tools).toContain('approval_scan');
    expect(tools).toContain('gas_oracle');
    expect(tools).toContain('sentiment');
    expect(tools).toContain('summarize');
    expect(tools).toContain('translate');
    expect(tools).toContain('wallet_safety');
    expect(tools).toContain('registry_lookup');
  });

  it('does not register duplicate tools', () => {
    const tools = Object.keys((mcpServer as any)._registeredTools);
    const unique = new Set(tools);
    expect(unique.size).toBe(tools.length);
  });

  it('each tool has a description', () => {
    const tools = (mcpServer as any)._registeredTools as Record<string, { description: string }>;
    for (const [name, tool] of Object.entries(tools)) {
      expect(tool.description, `${name} should have a description`).toBeTruthy();
      expect(typeof tool.description).toBe('string');
    }
  });
});
