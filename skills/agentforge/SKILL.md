---
name: agentforge
description: Free DeFi lookups (384-contract label registry, Solana program registry, full service catalog) plus optional pay-per-call x402 APIs for wallet safety, token risk / rug check scoring, transaction decode and simulate, and smart contract docs — on Ethereum, Base, and Solana. Use when an agent needs to check wallet safety, scan token risk, decode or simulate a transaction, or get contract documentation. Start free via MCP (no wallet) or a registry lookup; every paid endpoint states its exact USDC price up front before any charge — no hidden fees, no obfuscation.
metadata:
  author: agentforge
  version: "1.5.0"
license: MIT
---

# AgentForge

AgentForge is a DeFi safety layer on Base and Solana mainnet. Base URL: `https://agentforge-taupe.vercel.app`. It has two tiers, and the free tier costs nothing to try:

1. **Free** — contract/program label lookups, full catalog, service docs, feedback. No wallet, no payment, no account.
2. **Paid** — 19 deeper analysis endpoints (wallet safety, rug checks, transaction decode/simulate, and more), each billed per call via [x402](https://www.x402.org/) in USDC. Every price is stated plainly, nothing hidden or bundled. Full endpoint list, prices, and payment examples: [references/ENDPOINTS.md](references/ENDPOINTS.md).

## Free entry points (start here, no payment required)

- `GET /registry/lookup?address=0x...&chain=ethereum` — look up an EVM contract in the 384-contract label registry (protocol name, category, risk level).
- `GET /v1/solana/program-lookup?programId=...` — look up a Solana program in the 63-program label registry.
- `GET /registry/stats` — EVM registry coverage stats.
- `GET /catalog` — full machine-readable catalog of all 19 paid endpoints with current prices and JSON schemas.
- `GET /about` — service overview, every endpoint with description and `input_example` payload.
- `GET /.well-known/x402` — x402 discovery document (accepted networks, assets, payTo address).
- `POST /feedback` — report a bad response or suggest an improvement.

## MCP server — free, no wallet needed

All 20 tools are exposed over MCP at `https://agentforge-taupe.vercel.app/mcp` (Streamable HTTP). MCP calls are **free**: no wallet, no x402, no account.

- Lookups (`registry_lookup`, `solana_program_lookup`) and cheap data (`gas_oracle`, `pool_snapshot`) are unlimited.
- Every analysis tool is free for 10 calls per tool per client per day. Past that, the tool returns the matching paid x402 endpoint and its exact price.

Add it to Claude Code:
```bash
claude mcp add --transport http agentforge https://agentforge-taupe.vercel.app/mcp
```
Cursor, Windsurf, Claude Desktop: add an HTTP MCP server with the same URL.

Use the paid HTTP endpoints below when you need more volume than the free daily allowance, or when your agent already pays via x402.

## When to use the paid endpoints

- Before executing a DeFi transaction: check `wallet-safety` or `approval-scan` (EVM) — or `solana/tx-simulate` (Solana).
- Before touching a new token: run `token-risk-metrics` (EVM) or `solana/token-risk-scan` (Solana) — rug check: mint/freeze authority, holder concentration, liquidity.
- To understand a transaction: `tx-decode` (EVM) or `solana/tx-explain` (Solana) turn raw transaction data into a plain-English explanation.
- To understand a contract: `contract-docs` generates function-level documentation with a security posture summary.
- For general AI text tasks tied to crypto/DeFi content: `sentiment`, `summarize`, `translate`.

See [references/ENDPOINTS.md](references/ENDPOINTS.md) for the full price table, JSON Schema pointers, and x402 payment examples for 3 representative endpoints.
