import express from 'express';
import { config } from './config.js';
import { createPaymentMiddleware } from './middleware/x402.js';
import { rateLimit } from './middleware/rateLimit.js';
import { paidRouter } from './routes/paid.js';
import { freeRouter } from './routes/free.js';
import { adminRouter } from './routes/admin.js';
import { initDb, getDb } from './analytics/db.js';
import { mcpServer } from './mcp/server.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

const app = express();

// Parse JSON bodies
app.use(express.json({ limit: '1mb' }));

// CORS — allow agent clients from any origin
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-PAYMENT, X-PAYMENT-RESPONSE',
  );
  res.setHeader('Access-Control-Expose-Headers', 'X-PAYMENT-RESPONSE');
  if (_req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

// Rate limiting
app.use(rateLimit);

// Free routes (no payment required)
app.use(freeRouter);

// Admin routes (token auth, no x402)
app.use(adminRouter);

// MCP server (free — bypasses x402)
app.post('/mcp', async (req, res) => {
  try {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('MCP error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'MCP_ERROR', message: 'MCP request failed' });
    }
  }
});

app.get('/mcp', (_req, res) => {
  res.status(405).json({ error: 'Method Not Allowed. Use POST for MCP requests.' });
});

app.delete('/mcp', (_req, res) => {
  res.status(405).json({ error: 'Method Not Allowed. Use POST for MCP requests.' });
});

// x402 payment middleware — intercepts paid routes
app.use(createPaymentMiddleware());

// Paid routes (x402 has already verified payment before these execute)
app.use(paidRouter);

// Global error handler
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  },
);

// Initialize analytics DB and start server
initDb();
const server = app.listen(config.PORT, () => {
  console.log(`AgentForge running on port ${config.PORT}`);
  console.log(`Network: ${config.X402_NETWORK}`);
  console.log(`Receiving wallet: ${config.PAY_TO_ADDRESS}`);
  console.log(
    'Endpoints: /v1/token-intel, /v1/code-review, /v1/token-research, /v1/contract-docs, /v1/contract-monitor, /v1/token-compare, /v1/tx-decode, /v1/approval-scan, /v1/gas, /v1/ping',
  );
  console.log('MCP server: POST /mcp (Streamable HTTP)');
});

// Graceful shutdown
function shutdown(signal: string) {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  server.close(() => {
    try {
      const db = getDb();
      db.close();
    } catch {
      // DB may not be open
    }
    console.log('Server closed.');
    process.exit(0);
  });

  // Force exit after 10 seconds if graceful shutdown hangs
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
