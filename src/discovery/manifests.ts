/**
 * Small discovery manifests that directories crawl:
 *  - /.well-known/mcp/server-card.json — static MCP server card (Smithery and
 *    other MCP directories fall back to it when a live scan fails)
 *  - /.well-known/agent-registration.json — ERC-8004 registration file, the
 *    agentURI of our entry in the Base Identity Registry
 */

import { z } from 'zod';
import { mcpServer, MCP_SERVER_VERSION } from '../mcp/server.js';
import { config } from '../config.js';

/** Base Identity Registry (ERC-8004). */
export const ERC8004_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
/** Set once scripts/register8004.ts has minted our agent id; null until then. */
export const ERC8004_AGENT_ID: number | null = 1153855;

const DESCRIPTION =
  'DeFi safety tools for AI agents, paid per call over x402 (USDC on Base or Solana, no API keys). ' +
  'One-call preflight before any on-chain action, transaction simulation, signature and permit phishing checks, ' +
  'sanctions and scam address screening, rug checks, risk-scored new launches, and Aave liquidation risk, ' +
  'on Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain, Avalanche, Linea, Unichain, Sonic and Solana.';

interface RegisteredTool {
  title?: string;
  description?: string;
  inputSchema?: z.ZodType;
  annotations?: Record<string, unknown>;
}

function toolList() {
  const tools = (mcpServer as unknown as { _registeredTools: Record<string, RegisteredTool> })._registeredTools;
  return Object.entries(tools).map(([name, t]) => {
    let inputSchema: Record<string, unknown> = { type: 'object' };
    try {
      if (t.inputSchema) {
        const { $schema: _, ...rest } = z.toJSONSchema(t.inputSchema, { unrepresentable: 'any' }) as Record<string, unknown>;
        inputSchema = rest;
      }
    } catch {
      // keep the bare object schema
    }
    return { name, ...(t.title ? { title: t.title } : {}), description: t.description ?? '', inputSchema, ...(t.annotations ? { annotations: t.annotations } : {}) };
  });
}

let cachedCard: { base: string; card: Record<string, unknown> } | null = null;

export function mcpServerCard(base: string): Record<string, unknown> {
  if (cachedCard?.base === base) return cachedCard.card;
  const card = {
    $schema: 'https://static.modelcontextprotocol.io/schemas/mcp-server-card/v1.json',
    version: '1.0',
    protocolVersion: '2025-06-18',
    serverInfo: { name: 'io.github.acarchidi/agentforge', title: 'AgentForge', version: MCP_SERVER_VERSION },
    description: DESCRIPTION,
    iconUrl: `${base}/brand/agentforge-icon-512.png`,
    documentationUrl: `${base}/SKILL.md`,
    transport: { type: 'streamable-http', endpoint: `${base}/mcp` },
    capabilities: { tools: { listChanged: false } },
    authentication: { required: false, schemes: [] },
    tools: toolList(),
  };
  cachedCard = { base, card };
  return card;
}

export function agentRegistration(base: string): Record<string, unknown> {
  return {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: 'AgentForge',
    description: DESCRIPTION,
    image: `${base}/brand/agentforge-icon-512.png`,
    services: [
      { name: 'web', endpoint: `${base}/` },
      { name: 'MCP', endpoint: `${base}/mcp`, version: '2025-06-18' },
      { name: 'A2A', endpoint: `${base}/.well-known/agent.json`, version: '0.2.0' },
      { name: 'OpenAPI', endpoint: `${base}/openapi.json`, version: '3.1.0' },
      { name: 'x402', endpoint: `${base}/.well-known/x402` },
      { name: 'email', endpoint: config.CONTACT_EMAIL },
    ],
    x402Support: true,
    active: true,
    registrations: ERC8004_AGENT_ID === null
      ? []
      : [{ agentId: ERC8004_AGENT_ID, agentRegistry: `eip155:8453:${ERC8004_REGISTRY}` }],
    supportedTrust: ['reputation'],
  };
}
