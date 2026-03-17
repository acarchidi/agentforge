import { describe, it, expect, beforeAll } from 'vitest';

// Set env vars before any imports
process.env.PAY_TO_ADDRESS = '0x0000000000000000000000000000000000000000';
process.env.X402_NETWORK = 'base-sepolia';
process.env.X402_FACILITATOR_URL = 'https://x402.org/facilitator';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
process.env.ADMIN_TOKEN = 'test-admin-token-1234567890';
process.env.PRICE_TOKEN_INTEL = '$0.015';
process.env.PRICE_CODE_REVIEW = '$0.05';
process.env.PRICE_TOKEN_RESEARCH = '$0.04';
process.env.PRICE_CONTRACT_DOCS = '$0.02';
process.env.PRICE_CONTRACT_MONITOR = '$0.025';
process.env.PRICE_TOKEN_COMPARE = '$0.08';
process.env.PRICE_TX_DECODE = '$0.01';
process.env.PRICE_APPROVAL_SCAN = '$0.015';
process.env.PRICE_GAS = '$0.003';
process.env.PRICE_WALLET_SAFETY = '$0.035';
process.env.DATABASE_PATH = ':memory:';

describe('A2A Agent Card Generator', () => {
  let generateAgentCard: (baseUrl: string) => Record<string, unknown>;

  beforeAll(async () => {
    const mod = await import('../../src/discovery/agentCard.js');
    generateAgentCard = mod.generateAgentCard;
  });

  it('returns a valid agent card object', () => {
    const card = generateAgentCard('https://agentforge-taupe.vercel.app');
    expect(card).toBeDefined();
    expect(typeof card).toBe('object');
  });

  it('has required top-level fields', () => {
    const card = generateAgentCard('https://agentforge-taupe.vercel.app');
    expect(card.name).toBe('AgentForge');
    expect(card.description).toBeDefined();
    expect(typeof card.description).toBe('string');
    expect(card.url).toBe('https://agentforge-taupe.vercel.app');
    expect(card.version).toBeDefined();
  });

  it('includes provider information', () => {
    const card = generateAgentCard('https://agentforge-taupe.vercel.app');
    const provider = card.provider as Record<string, unknown>;
    expect(provider).toBeDefined();
    expect(provider.organization).toBe('AgentForge');
    expect(provider.url).toBe('https://agentforge-taupe.vercel.app');
  });

  it('has capabilities listing supported protocols', () => {
    const card = generateAgentCard('https://agentforge-taupe.vercel.app');
    const capabilities = card.capabilities as Record<string, unknown>;
    expect(capabilities).toBeDefined();
    expect(capabilities.streaming).toBe(false);
    expect(capabilities.pushNotifications).toBe(false);
  });

  it('lists authentication methods including x402', () => {
    const card = generateAgentCard('https://agentforge-taupe.vercel.app');
    const auth = card.authentication as Record<string, unknown>;
    expect(auth).toBeDefined();
    expect(auth.schemes).toBeInstanceOf(Array);
    const schemes = auth.schemes as Array<Record<string, unknown>>;
    const x402Scheme = schemes.find((s) => s.scheme === 'x402');
    expect(x402Scheme).toBeDefined();
    expect(x402Scheme!.asset).toBe('USDC');
    expect(x402Scheme!.network).toBeDefined();
  });

  it('lists all paid services as skills', () => {
    const card = generateAgentCard('https://agentforge-taupe.vercel.app');
    const skills = card.skills as Array<Record<string, unknown>>;
    expect(skills).toBeInstanceOf(Array);
    expect(skills.length).toBeGreaterThanOrEqual(14);

    // Check all expected skills are present
    const skillIds = skills.map((s) => s.id);
    expect(skillIds).toContain('wallet-safety');
    expect(skillIds).toContain('contract-docs');
    expect(skillIds).toContain('tx-decode');
    expect(skillIds).toContain('approval-scan');
    expect(skillIds).toContain('contract-monitor');
    expect(skillIds).toContain('token-research');
    expect(skillIds).toContain('token-intel');
    expect(skillIds).toContain('code-review');
    expect(skillIds).toContain('token-compare');
    expect(skillIds).toContain('gas-oracle');
    expect(skillIds).toContain('sentiment');
    expect(skillIds).toContain('summarize');
    expect(skillIds).toContain('translate');
    expect(skillIds).toContain('ping');
  });

  it('each skill has required fields', () => {
    const card = generateAgentCard('https://agentforge-taupe.vercel.app');
    const skills = card.skills as Array<Record<string, unknown>>;
    for (const skill of skills) {
      expect(skill.id, `skill missing id`).toBeDefined();
      expect(skill.name, `${skill.id} missing name`).toBeDefined();
      expect(skill.description, `${skill.id} missing description`).toBeDefined();
      expect(skill.tags, `${skill.id} missing tags`).toBeInstanceOf(Array);
      expect(skill.examples, `${skill.id} missing examples`).toBeInstanceOf(Array);
      expect((skill.examples as unknown[]).length).toBeGreaterThan(0);
    }
  });

  it('each skill has a price field', () => {
    const card = generateAgentCard('https://agentforge-taupe.vercel.app');
    const skills = card.skills as Array<Record<string, unknown>>;
    for (const skill of skills) {
      expect(skill.price, `${skill.id} missing price`).toBeDefined();
      expect(typeof skill.price).toBe('string');
      expect((skill.price as string).startsWith('$')).toBe(true);
    }
  });

  it('includes discovery endpoints', () => {
    const card = generateAgentCard('https://agentforge-taupe.vercel.app');
    const endpoints = card.defaultInputModes as string[] | undefined;
    // A2A protocol uses defaultInputModes and defaultOutputModes
    expect(card.defaultInputModes).toBeDefined();
    expect(card.defaultOutputModes).toBeDefined();
  });

  it('uses correct base URL', () => {
    const card = generateAgentCard('https://custom.example.com');
    expect(card.url).toBe('https://custom.example.com');

    const provider = card.provider as Record<string, unknown>;
    expect(provider.url).toBe('https://custom.example.com');
  });

  it('includes MCP endpoint reference', () => {
    const card = generateAgentCard('https://agentforge-taupe.vercel.app');
    const protocols = card.protocols as Record<string, unknown> | undefined;
    expect(protocols).toBeDefined();
    expect(protocols!.mcp).toBeDefined();
    const mcp = protocols!.mcp as Record<string, unknown>;
    expect(mcp.url).toBe('https://agentforge-taupe.vercel.app/mcp');
    expect(mcp.transport).toBe('streamable-http');
  });

  it('includes OpenAPI endpoint reference', () => {
    const card = generateAgentCard('https://agentforge-taupe.vercel.app');
    const protocols = card.protocols as Record<string, unknown>;
    expect(protocols.openapi).toBeDefined();
    const openapi = protocols.openapi as Record<string, unknown>;
    expect(openapi.url).toBe('https://agentforge-taupe.vercel.app/openapi.json');
  });

  it('includes x402 discovery reference', () => {
    const card = generateAgentCard('https://agentforge-taupe.vercel.app');
    const protocols = card.protocols as Record<string, unknown>;
    expect(protocols.x402).toBeDefined();
    const x402 = protocols.x402 as Record<string, unknown>;
    expect(x402.url).toBe('https://agentforge-taupe.vercel.app/.well-known/x402');
  });
});
