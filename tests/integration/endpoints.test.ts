import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';

// Integration tests hit the routes WITHOUT x402 middleware.
// This tests the service logic in isolation from payment.

// We need to set env vars before importing routes (which import config)
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

let app: express.Application;
let adminToken: string;

beforeAll(async () => {
  // Dynamic imports after env vars are set
  const { paidRouter } = await import('../../src/routes/paid.js');
  const { freeRouter } = await import('../../src/routes/free.js');
  const { adminRouter } = await import('../../src/routes/admin.js');
  const { initDb } = await import('../../src/analytics/db.js');
  const { config } = await import('../../src/config.js');

  adminToken = config.ADMIN_TOKEN;

  initDb();
  app = express();
  app.use(express.json());
  app.use(freeRouter);
  app.use(adminRouter);

  // MCP routes (mirrors src/index.ts — mounted before x402 middleware)
  app.get('/mcp', (_req, res) => {
    res.status(405).json({ error: 'Method Not Allowed. Use POST for MCP requests.' });
  });
  app.delete('/mcp', (_req, res) => {
    res.status(405).json({ error: 'Method Not Allowed. Use POST for MCP requests.' });
  });

  app.use(paidRouter);
});

describe('Free Endpoints', () => {
  it('GET /health returns 200', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.timestamp).toBeDefined();
  });

  it('GET /catalog returns service list with 16 services', async () => {
    const res = await request(app).get('/catalog');
    expect(res.status).toBe(200);
    expect(res.body.services).toBeInstanceOf(Array);
    expect(res.body.services.length).toBe(16);
    expect(res.body.payment.protocol).toBe('x402');
    expect(res.body.version).toBe('1.4.0');
  });

  it('GET /catalog services have endpoint and price', async () => {
    const res = await request(app).get('/catalog');
    for (const service of res.body.services) {
      expect(service.endpoint).toBeDefined();
      expect(service.price).toBeDefined();
      expect(service.description).toBeDefined();
    }
  });

  it('GET /catalog includes all paid endpoints', async () => {
    const res = await request(app).get('/catalog');
    const endpoints = res.body.services.map((s: { endpoint: string }) => s.endpoint);
    expect(endpoints).toContain('POST /v1/contract-monitor');
    expect(endpoints).toContain('POST /v1/token-compare');
    expect(endpoints).toContain('POST /v1/tx-decode');
    expect(endpoints).toContain('POST /v1/approval-scan');
    expect(endpoints).toContain('GET /v1/gas');
  });

  it('GET /catalog includes sentiment/summarize/translate', async () => {
    const res = await request(app).get('/catalog');
    const endpoints = res.body.services.map((s: { endpoint: string }) => s.endpoint);
    expect(endpoints).toContain('POST /v1/sentiment');
    expect(endpoints).toContain('POST /v1/summarize');
    expect(endpoints).toContain('POST /v1/translate');
  });

  it('GET /catalog includes wallet-safety', async () => {
    const res = await request(app).get('/catalog');
    const endpoints = res.body.services.map((s: { endpoint: string }) => s.endpoint);
    expect(endpoints).toContain('POST /v1/wallet-safety');
  });
});

describe('Feedback Endpoint', () => {
  it('POST /feedback accepts valid feedback', async () => {
    const res = await request(app).post('/feedback').send({
      type: 'feature_request',
      message: 'Add support for Solana tokens in contract-monitor',
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('POST /feedback accepts all feedback types', async () => {
    for (const type of ['feature_request', 'bug_report', 'service_request', 'general']) {
      const res = await request(app).post('/feedback').send({ type, message: 'test' });
      expect(res.status).toBe(200);
    }
  });

  it('POST /feedback accepts optional fields', async () => {
    const res = await request(app).post('/feedback').send({
      type: 'bug_report',
      endpoint: '/v1/token-intel',
      message: 'Getting 500 errors',
      contact: 'user@example.com',
    });
    expect(res.status).toBe(200);
  });

  it('POST /feedback returns 400 for missing message', async () => {
    const res = await request(app).post('/feedback').send({ type: 'general' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('POST /feedback returns 400 for invalid type', async () => {
    const res = await request(app).post('/feedback').send({
      type: 'complaint',
      message: 'test',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('POST /feedback returns 400 for empty body', async () => {
    const res = await request(app).post('/feedback').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });
});

describe('Validation (no LLM calls)', () => {
  it('POST /v1/token-intel returns 400 for missing address', async () => {
    const res = await request(app).post('/v1/token-intel').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('POST /v1/code-review returns 400 for missing code', async () => {
    const res = await request(app).post('/v1/code-review').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('POST /v1/token-research returns 400 for missing query', async () => {
    const res = await request(app).post('/v1/token-research').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('POST /v1/token-research returns 400 for empty query', async () => {
    const res = await request(app).post('/v1/token-research').send({ query: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('POST /v1/contract-docs returns 400 for missing address', async () => {
    const res = await request(app).post('/v1/contract-docs').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('POST /v1/contract-docs returns 400 for empty address', async () => {
    const res = await request(app).post('/v1/contract-docs').send({ address: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('POST /v1/contract-monitor returns 400 for missing address', async () => {
    const res = await request(app).post('/v1/contract-monitor').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('POST /v1/contract-monitor returns 400 for empty address', async () => {
    const res = await request(app).post('/v1/contract-monitor').send({ address: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('POST /v1/token-compare returns 400 for missing primary', async () => {
    const res = await request(app).post('/v1/token-compare').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('POST /v1/token-compare returns 400 for missing compare', async () => {
    const res = await request(app).post('/v1/token-compare').send({ primary: 'ETH' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('POST /v1/token-compare returns 400 for empty compare array', async () => {
    const res = await request(app).post('/v1/token-compare').send({
      primary: 'ETH',
      compare: [],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('POST /v1/token-compare returns 400 for >3 comparisons', async () => {
    const res = await request(app).post('/v1/token-compare').send({
      primary: 'ETH',
      compare: ['SOL', 'AVAX', 'MATIC', 'ARB'],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('POST /v1/tx-decode returns 400 for missing txHash', async () => {
    const res = await request(app).post('/v1/tx-decode').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('POST /v1/tx-decode returns 400 for invalid txHash', async () => {
    const res = await request(app).post('/v1/tx-decode').send({ txHash: 'not-a-hash' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('POST /v1/approval-scan returns 400 for missing address', async () => {
    const res = await request(app).post('/v1/approval-scan').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('POST /v1/approval-scan returns 400 for invalid address', async () => {
    const res = await request(app).post('/v1/approval-scan').send({ address: 'bad' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('POST /v1/wallet-safety returns 400 for missing walletAddress', async () => {
    const res = await request(app).post('/v1/wallet-safety').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('POST /v1/wallet-safety returns 400 for invalid walletAddress', async () => {
    const res = await request(app).post('/v1/wallet-safety').send({ walletAddress: 'bad' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('GET /v1/gas returns 400 for invalid chain', async () => {
    const res = await request(app).get('/v1/gas').query({ chain: 'solana' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('handles malformed JSON gracefully', async () => {
    const res = await request(app)
      .post('/v1/token-intel')
      .set('Content-Type', 'application/json')
      .send('not json');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});

describe('Dashboard', () => {
  it('GET / returns 200 with HTML containing AGENTFORGE', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.text).toContain('AGENTFORGE');
  });

  it('GET /dashboard returns 200 with HTML (legacy route)', async () => {
    const res = await request(app).get('/dashboard');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.text).toContain('AGENTFORGE');
  });

  it('GET /admin returns 200 with HTML for admin dashboard', async () => {
    const res = await request(app).get('/admin');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.text).toContain('AGENTFORGE');
    expect(res.text).toContain('noindex');
  });
});

describe('Discovery Layer', () => {
  it('GET /openapi.json returns valid OpenAPI 3.1 spec with current endpoints', async () => {
    const res = await request(app).get('/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.1.0');
    expect(res.body.info.title).toBe('AgentForge API');
    expect(res.body.info.version).toBe('1.4.0');
    const paths = Object.keys(res.body.paths);
    // Must contain all current service paths
    expect(paths).toContain('/v1/token-intel');
    expect(paths).toContain('/v1/code-review');
    expect(paths).toContain('/v1/token-research');
    expect(paths).toContain('/v1/contract-docs');
    expect(paths).toContain('/v1/contract-monitor');
    expect(paths).toContain('/v1/token-compare');
    expect(paths).toContain('/v1/tx-decode');
    expect(paths).toContain('/v1/approval-scan');
    expect(paths).toContain('/v1/wallet-safety');
    expect(paths).toContain('/v1/gas');
    expect(paths).toContain('/v1/sentiment');
    expect(paths).toContain('/v1/summarize');
    expect(paths).toContain('/v1/translate');
    expect(paths).toContain('/v1/ping');
    expect(paths).toContain('/health');
    expect(paths).toContain('/catalog');
    expect(paths).toContain('/feedback');
    expect(paths).toContain('/.well-known/agent.json');
  });

  it('GET /.well-known/openapi.json returns same spec as /openapi.json', async () => {
    const [res1, res2] = await Promise.all([
      request(app).get('/openapi.json'),
      request(app).get('/.well-known/openapi.json'),
    ]);
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res2.body).toEqual(res1.body);
  });

  it('GET /.well-known/ai-plugin.json returns valid plugin manifest with mcp', async () => {
    const res = await request(app).get('/.well-known/ai-plugin.json');
    expect(res.status).toBe(200);
    expect(res.body.schema_version).toBe('v1');
    expect(res.body.name_for_model).toBe('agentforge');
    expect(res.body.name_for_human).toBe('AgentForge');
    expect(res.body.description_for_model).toBeDefined();
    expect(res.body.api.type).toBe('openapi');
    expect(res.body.api.url).toContain('/openapi.json');
    expect(res.body.mcp).toBeDefined();
    expect(res.body.mcp.url).toContain('/mcp');
    expect(res.body.mcp.transport).toBe('streamable-http');
  });

  it('GET /robots.txt returns text/plain with Allow and Disallow directives', async () => {
    const res = await request(app).get('/robots.txt');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toContain('User-agent: *');
    expect(res.text).toContain('Allow: /catalog');
    expect(res.text).toContain('Allow: /openapi.json');
    expect(res.text).toContain('Allow: /.well-known/');
    expect(res.text).toContain('Disallow: /admin');
  });

  it('GET /about returns JSON with current services', async () => {
    const res = await request(app).get('/about');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('AgentForge');
    expect(res.body.version).toBe('1.4.0');
    expect(res.body.services).toBeDefined();
    // Current services
    expect(res.body.services.token_intelligence).toBeDefined();
    expect(res.body.services.code_review).toBeDefined();
    expect(res.body.services.token_research).toBeDefined();
    expect(res.body.services.contract_docs).toBeDefined();
    expect(res.body.services.contract_monitor).toBeDefined();
    expect(res.body.services.token_compare).toBeDefined();
    expect(res.body.services.tx_decode).toBeDefined();
    expect(res.body.services.approval_scan).toBeDefined();
    expect(res.body.services.wallet_safety).toBeDefined();
    expect(res.body.services.gas_oracle).toBeDefined();
    expect(res.body.services.ping).toBeDefined();
    // New NLP services
    expect(res.body.services.sentiment).toBeDefined();
    expect(res.body.services.summarize).toBeDefined();
    expect(res.body.services.translate).toBeDefined();
    // Free endpoints section
    expect(res.body.free_endpoints).toBeDefined();
    expect(res.body.free_endpoints.feedback).toBeDefined();
    // Discovery — includes agent_card
    expect(res.body.discovery).toBeDefined();
    expect(res.body.discovery.catalog).toContain('/catalog');
    expect(res.body.discovery.openapi).toContain('/openapi.json');
    expect(res.body.discovery.agent_card).toContain('/.well-known/agent.json');
    expect(res.body.discovery.mcp).toContain('/mcp');
    // MCP section
    expect(res.body.mcp).toBeDefined();
    expect(res.body.mcp.tools).toHaveLength(13);
    expect(res.body.mcp.transport).toBe('streamable-http');
    // Composability section
    expect(res.body.composability).toBeDefined();
    expect(res.body.composability.chains).toBeDefined();
    expect(res.body.composability.example.relatedServices).toBeInstanceOf(Array);
  });

  it('GET /.well-known/agent.json returns valid A2A agent card', async () => {
    const res = await request(app).get('/.well-known/agent.json');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('AgentForge');
    expect(res.body.version).toBe('1.4.0');
    expect(res.body.description).toBeDefined();
    expect(res.body.provider).toBeDefined();
    expect(res.body.provider.organization).toBe('AgentForge');
    expect(res.body.capabilities).toBeDefined();
    expect(res.body.authentication).toBeDefined();
    expect(res.body.authentication.schemes).toBeInstanceOf(Array);
    // x402 auth scheme
    const x402 = res.body.authentication.schemes.find(
      (s: { scheme: string }) => s.scheme === 'x402',
    );
    expect(x402).toBeDefined();
    expect(x402.asset).toBe('USDC');
    // Skills
    expect(res.body.skills).toBeInstanceOf(Array);
    expect(res.body.skills.length).toBe(16);
    const skillIds = res.body.skills.map((s: { id: string }) => s.id);
    expect(skillIds).toContain('wallet-safety');
    expect(skillIds).toContain('token-research');
    expect(skillIds).toContain('approval-scan');
    expect(skillIds).toContain('contract-docs');
    // Protocols
    expect(res.body.protocols).toBeDefined();
    expect(res.body.protocols.mcp).toBeDefined();
    expect(res.body.protocols.mcp.transport).toBe('streamable-http');
    expect(res.body.protocols.openapi).toBeDefined();
    expect(res.body.protocols.x402).toBeDefined();
  });

  it('GET /.well-known/agent.json skills all have required fields', async () => {
    const res = await request(app).get('/.well-known/agent.json');
    for (const skill of res.body.skills) {
      expect(skill.id).toBeDefined();
      expect(skill.name).toBeDefined();
      expect(skill.description).toBeDefined();
      expect(skill.tags).toBeInstanceOf(Array);
      expect(skill.examples).toBeInstanceOf(Array);
      expect(skill.examples.length).toBeGreaterThan(0);
      expect(skill.price).toBeDefined();
      expect(skill.price).toMatch(/^\$/);
    }
  });

  it('GET /catalog includes inputSchema and outputSchema for all services', async () => {
    const res = await request(app).get('/catalog');
    expect(res.status).toBe(200);
    for (const service of res.body.services) {
      expect(service.inputSchema).toBeDefined();
      expect(service.outputSchema).toBeDefined();
      expect(service.operationId).toBeDefined();
      expect(service.tags).toBeInstanceOf(Array);
    }
  });

  it('All /catalog schemas for paid POST services are valid JSON Schema objects', async () => {
    const res = await request(app).get('/catalog');
    const paidServices = res.body.services.filter(
      (s: { endpoint: string }) => s.endpoint !== 'GET /v1/ping',
    );
    for (const service of paidServices) {
      expect(service.inputSchema).not.toBeNull();
      expect(typeof service.inputSchema).toBe('object');
      expect(service.inputSchema.type).toBeDefined();
      expect(service.outputSchema).not.toBeNull();
      expect(typeof service.outputSchema).toBe('object');
      expect(service.outputSchema.type).toBeDefined();
    }
    // Ping is the only service allowed to have null inputSchema
    const ping = res.body.services.find(
      (s: { endpoint: string }) => s.endpoint === 'GET /v1/ping',
    );
    expect(ping).toBeDefined();
    expect(ping.inputSchema).toBeNull();
    expect(ping.outputSchema).not.toBeNull();
  });
});

describe('MCP Endpoint', () => {
  it('GET /mcp returns 405', async () => {
    const res = await request(app).get('/mcp');
    expect(res.status).toBe(405);
    expect(res.body.error).toContain('Method Not Allowed');
  });

  it('DELETE /mcp returns 405', async () => {
    const res = await request(app).delete('/mcp');
    expect(res.status).toBe(405);
    expect(res.body.error).toContain('Method Not Allowed');
  });
});

describe('x402 Discovery', () => {
  it('GET /.well-known/x402 returns current paid resources', async () => {
    const res = await request(app).get('/.well-known/x402');
    expect(res.status).toBe(200);
    expect(res.body.resources).toBeInstanceOf(Array);
    // Current endpoints
    expect(res.body.resources).toContain('POST /v1/token-intel');
    expect(res.body.resources).toContain('POST /v1/code-review');
    expect(res.body.resources).toContain('POST /v1/token-research');
    expect(res.body.resources).toContain('POST /v1/contract-docs');
    expect(res.body.resources).toContain('POST /v1/contract-monitor');
    expect(res.body.resources).toContain('POST /v1/token-compare');
    expect(res.body.resources).toContain('POST /v1/tx-decode');
    expect(res.body.resources).toContain('POST /v1/approval-scan');
    expect(res.body.resources).toContain('POST /v1/wallet-safety');
    expect(res.body.resources).toContain('GET /v1/gas');
    expect(res.body.resources).toContain('GET /v1/ping');
    // New NLP endpoints
    expect(res.body.resources).toContain('POST /v1/sentiment');
    expect(res.body.resources).toContain('POST /v1/summarize');
    expect(res.body.resources).toContain('POST /v1/translate');
    // All entries must be strings
    for (const r of res.body.resources) {
      expect(typeof r).toBe('string');
    }
  });

  it('OpenAPI spec has x-payment-info on all paid endpoints', async () => {
    const res = await request(app).get('/openapi.json');
    const paidPaths = [
      '/v1/token-intel', '/v1/code-review', '/v1/token-research',
      '/v1/contract-docs', '/v1/contract-monitor', '/v1/token-compare',
      '/v1/tx-decode', '/v1/approval-scan', '/v1/wallet-safety', '/v1/gas',
      '/v1/sentiment', '/v1/summarize', '/v1/translate',
      '/v1/ping',
    ];
    for (const p of paidPaths) {
      const method = (p === '/v1/ping' || p === '/v1/gas') ? 'get' : 'post';
      const op = res.body.paths[p]?.[method];
      expect(op).toBeDefined();
      expect(op['x-agentcash-auth']).toEqual({ mode: 'paid' });
      expect(op['x-payment-info']).toBeDefined();
      expect(op['x-payment-info'].protocols).toContain('x402');
      expect(op['x-payment-info'].pricingMode).toBe('fixed');
    }
  });

  it('OpenAPI spec free endpoints have free auth mode', async () => {
    const res = await request(app).get('/openapi.json');
    for (const p of ['/health', '/catalog']) {
      const op = res.body.paths[p]?.get;
      expect(op).toBeDefined();
      expect(op['x-agentcash-auth']).toEqual({ mode: 'free' });
      expect(op['x-payment-info']).toBeUndefined();
    }
  });

  it('OpenAPI spec feedback endpoint has free auth mode', async () => {
    const res = await request(app).get('/openapi.json');
    const op = res.body.paths['/feedback']?.post;
    expect(op).toBeDefined();
    expect(op['x-agentcash-auth']).toEqual({ mode: 'free' });
    expect(op['x-payment-info']).toBeUndefined();
  });
});

describe('Admin Endpoints', () => {
  it('GET /admin/recent-calls returns 401 without token', async () => {
    const res = await request(app).get('/admin/recent-calls');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });

  it('GET /admin/recent-calls returns 200 with valid token', async () => {
    const res = await request(app)
      .get('/admin/recent-calls')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.calls).toBeInstanceOf(Array);
  });

  it('GET /admin/stats returns 401 without token', async () => {
    const res = await request(app).get('/admin/stats');
    expect(res.status).toBe(401);
  });

  it('GET /admin/stats returns 200 with valid token', async () => {
    const res = await request(app)
      .get('/admin/stats')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.overview).toBeDefined();
    expect(res.body.revenue).toBeDefined();
    expect(res.body.last24h).toBeDefined();
    expect(res.body.generatedAt).toBeDefined();
  });

  it('GET /admin/feedback returns 401 without token', async () => {
    const res = await request(app).get('/admin/feedback');
    expect(res.status).toBe(401);
  });

  it('GET /admin/feedback returns 200 with valid token', async () => {
    const res = await request(app)
      .get('/admin/feedback')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.feedback).toBeInstanceOf(Array);
  });

  it('Feedback submitted via POST /feedback appears in admin feed', async () => {
    // Submit feedback
    await request(app).post('/feedback').send({
      type: 'bug_report',
      endpoint: '/v1/token-intel',
      message: 'Integration test feedback entry',
      contact: 'test@test.com',
    });

    // Fetch admin feedback
    const res = await request(app)
      .get('/admin/feedback')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const match = res.body.feedback.find(
      (f: { message: string }) => f.message === 'Integration test feedback entry',
    );
    expect(match).toBeDefined();
    expect(match.type).toBe('bug_report');
    expect(match.endpoint).toBe('/v1/token-intel');
    expect(match.contact).toBe('test@test.com');
  });

  it('GET /admin/revenue/daily returns 200 with valid token', async () => {
    const res = await request(app)
      .get('/admin/revenue/daily')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.daily).toBeInstanceOf(Array);
  });

  it('GET /admin/revenue/daily returns 401 without token', async () => {
    const res = await request(app).get('/admin/revenue/daily');
    expect(res.status).toBe(401);
  });
});
