# CLAUDE.md — AgentForge

## Project Overview

AgentForge is an AI Agent-as-a-Service Factory — a production-grade TypeScript API providing 14+ DeFi safety and intelligence tools for autonomous agents, monetized via the x402 payment protocol (USDC on Base blockchain). It also exposes all tools via the Model Context Protocol (MCP).

## Tech Stack

- **Language**: TypeScript 5.9 (strict mode, ES2022 target, NodeNext modules)
- **Runtime**: Node.js 22
- **Framework**: Express 5.2
- **Validation**: Zod 4.3
- **Testing**: Vitest 4.0 + Supertest 7.2
- **Linting/Formatting**: Biome 2.4 (replaces ESLint/Prettier)
- **Database**: SQLite (better-sqlite3) with WAL mode
- **LLM**: Anthropic Claude (Sonnet 4) via `@anthropic-ai/sdk`
- **Payment**: x402 protocol (`@x402/*`, `@coinbase/x402`)
- **Web3**: ethers.js 6.16, viem 2.21
- **MCP**: `@modelcontextprotocol/sdk` 1.27

## Quick Commands

```bash
npm install          # Install dependencies
npm run dev          # Dev server with watch (tsx watch)
npm run build        # TypeScript compilation (tsc)
npm start            # Production start (node dist/index.js)
npm test             # Run tests once (vitest run)
npm run test:watch   # Watch mode tests
npm run lint         # Biome linting check on ./src
```

## Repository Structure

```
src/
├── index.ts              # Express app entry point, middleware ordering
├── config.ts             # Environment validation via Zod
├── routes/
│   ├── free.ts           # Free endpoints: health, catalog, OpenAPI, dashboard
│   ├── admin.ts          # Admin endpoints (ADMIN_TOKEN auth)
│   └── paid.ts           # 13 paid endpoints (x402 payment wall)
├── middleware/
│   ├── x402.ts           # Payment verification middleware
│   └── rateLimit.ts      # Rate limiting (60 req/min per IP)
├── services/             # Business logic (one file per tool)
│   ├── tokenIntel.ts     # Token metadata & risk scoring
│   ├── tokenResearch.ts  # Multi-source token intelligence
│   ├── codeReview.ts     # Smart contract security analysis
│   ├── contractDocs.ts   # Contract documentation generation
│   ├── contractMonitor.ts
│   ├── tokenCompare.ts
│   ├── txDecoder.ts
│   ├── approvalScanner.ts
│   ├── gasOracle.ts
│   ├── sentiment.ts
│   ├── summarize.ts
│   ├── translate.ts
│   ├── walletSafety/     # Multi-file service (index, riskScore, patterns)
│   └── dataSources/      # Third-party API integrations
│       ├── etherscan.ts
│       ├── coingecko.ts
│       ├── defillama.ts
│       ├── polymarket.ts
│       └── solana.ts
├── schemas/              # Zod schemas (input + output per service)
├── mcp/
│   └── server.ts         # MCP tool registration (14 tools)
├── analytics/
│   ├── db.ts             # SQLite init (calls, revenue, feedback tables)
│   ├── logger.ts         # Call/revenue logging
│   └── queries.ts        # Analytics queries
├── cache/
│   └── store.ts          # In-memory cache with Vercel KV support
├── registry/
│   ├── lookup.ts         # Known Contract Label Registry
│   └── data/registry.json
├── discovery/
│   └── agentCard.ts      # Google A2A protocol agent card
├── llm/
│   └── anthropic.ts      # Claude API calls with cost estimation
└── utils/                # Cache, retry, address validation, OpenAPI gen

api/
└── index.ts              # Vercel serverless entry point

tests/
├── unit/                 # 21 unit test files (mirrors src/ structure)
└── integration/
    └── endpoints.test.ts

scripts/                  # Dev & deployment utilities (tsx runners)
dashboard/                # Static HTML frontend (index.html, admin.html)
```

## Architecture

### Service-With-Cost Pattern

Every AI service returns `{ output: T, estimatedCostUsd: number }`. This is the core convention — always follow it when adding new services.

### Three-Tier Route Structure

1. **Free** (`/routes/free.ts`): No auth — health, catalog, OpenAPI spec
2. **Admin** (`/routes/admin.ts`): `ADMIN_TOKEN` header auth — analytics, settings
3. **Paid** (`/routes/paid.ts`): x402 payment required — all AI tools

### Middleware Ordering (in index.ts)

JSON parsing → CORS → Rate limiting → Free routes → Admin routes → MCP endpoint → **x402 payment wall** → Paid routes → Error handler

### Schema-Driven Validation

All endpoints validate input/output with Zod schemas. Schemas auto-convert to JSON Schema for OpenAPI and x402 discovery. Validation errors return `{ error: 'VALIDATION_ERROR', message, details }` with status 400.

## Code Conventions

### TypeScript

- **Strict mode** is on — no implicit `any`
- **ESM imports** — always use `.js` extension in import paths
- Derive types from Zod: `z.infer<typeof schema>`
- Use `unknown` + type narrowing instead of `any`

### Naming

- Functions: `camelCase`
- Types/Interfaces: `PascalCase`
- Env vars: `SCREAMING_SNAKE_CASE`
- Endpoints: `/v1/<resource>` REST-style
- Service functions: `getXxxWithCost()` pattern

### File Organization

- One service per file in `services/`
- Matching Zod schema file in `schemas/`
- Tests mirror the `src/` structure under `tests/unit/`

### Error Handling

- Validation errors: 400 with structured response
- Internal errors: 500, no stack traces exposed
- Graceful shutdown: 10s timeout + cleanup

### Logging

- `console.log` / `console.error` (no external logger — serverless-friendly)
- Structured analytics via `logCall()` and `logRevenue()`

## Testing

### Running Tests

```bash
npm test              # Vitest, single run
npm run test:watch    # Vitest, watch mode
```

### Test Patterns

- **Set env vars before imports** — config is validated at import time:
  ```typescript
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
  const { module } = await import('../../src/module.js');
  ```
- Use Supertest for HTTP endpoint tests
- Test database uses `:memory:` SQLite
- Default test timeout: 30 seconds
- Always test both success and error paths

### Test Structure

- `tests/unit/` — Schema validation, service output format, cache behavior, utilities
- `tests/integration/` — Full endpoint request → response workflows

## Linting & Formatting

Biome handles both linting and formatting (configured in `biome.json`):

```bash
npm run lint          # Check rules
npx @biomejs/biome check --write ./src  # Auto-fix
```

Rules: Biome recommended set, 2-space indentation, auto-organized imports.

## Environment Variables

Copy `.env.example` and fill in required values. Key variables:

| Variable | Required | Purpose |
|----------|----------|---------|
| `ANTHROPIC_API_KEY` | Yes | Claude API access |
| `PAY_TO_ADDRESS` | Yes | EVM wallet for x402 payments |
| `X402_NETWORK` | Yes | `base-sepolia` or `base` |
| `X402_FACILITATOR_URL` | Yes | x402 facilitator endpoint |
| `ADMIN_TOKEN` | Yes | 16+ char admin auth token |
| `PORT` | No | Default 3402 |
| `NODE_ENV` | No | `development` / `production` / `test` |
| `ETHERSCAN_API_KEY` | No | Etherscan contract lookups |
| `DATABASE_PATH` | No | Custom SQLite path |

Pricing env vars (`PRICE_TOKEN_INTEL`, `PRICE_CODE_REVIEW`, etc.) configure per-endpoint x402 prices in USD.

## Deployment

- **Docker**: `docker compose up --build` (preferred for production)
- **Vercel**: Serverless via `api/index.ts`, configured in `vercel.json`
- **Render**: Docker runtime with disk mount, configured in `render.yaml`
- **Railway / VPS**: Use `scripts/deploy-vps.sh`

## Adding a New Service

1. Create `src/services/newService.ts` — export function returning `{ output, estimatedCostUsd }`
2. Create `src/schemas/newService.ts` — define Zod input + output schemas
3. Add endpoint in `src/routes/paid.ts` (or `free.ts`)
4. Register MCP tool in `src/mcp/server.ts`
5. Add pricing env var `PRICE_NEW_SERVICE` to `src/config.ts`
6. Write tests in `tests/unit/newService.test.ts`
7. Update catalog in free routes
