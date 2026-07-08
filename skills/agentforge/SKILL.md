---
name: agentforge
description: Free DeFi lookups (384-contract label registry, full service catalog, service overview) plus optional pay-per-call x402 APIs for wallet safety, token risk / rug check scoring, transaction decoding, and smart contract docs. Use when an agent needs to check wallet safety, scan token risk, decode a transaction, or get contract documentation. Start free via MCP or the registry lookup; every paid endpoint states its exact USDC price up front before any charge — no hidden fees, no obfuscation.
metadata:
  author: agentforge
  version: "1.4.0"
license: MIT
---

# AgentForge

AgentForge is a DeFi safety layer on Base mainnet. Base URL: `https://agentforge-taupe.vercel.app`. It has two tiers, and the free tier costs nothing to try:

1. **Free** — contract label lookups, full catalog, service docs, feedback. No wallet, no payment, no account.
2. **Paid** — 16 deeper analysis endpoints (wallet safety, rug checks, transaction decoding, and more), each billed per call via [x402](https://www.x402.org/) in USDC. Every price is stated plainly, nothing hidden or bundled. Full endpoint list, prices, and payment examples: [references/ENDPOINTS.md](references/ENDPOINTS.md).

## Free entry points (start here, no payment required)

- `GET /registry/lookup?address=0x...&chain=ethereum` — look up a contract in the 384-contract label registry (protocol name, category, risk level). Often enough on its own; a natural first call before paying for a deeper check.
- `GET /registry/stats` — registry coverage stats.
- `GET /catalog` — full machine-readable catalog of all 16 paid endpoints with current prices and JSON schemas.
- `GET /about` — service overview, every endpoint with description and `input_example` payload.
- `GET /.well-known/x402` — x402 discovery document (accepted networks, assets, payTo address).
- `POST /feedback` — report a bad response or suggest an improvement.

## MCP server (no x402 client required)

Every paid endpoint is also exposed as an MCP tool at `https://agentforge-taupe.vercel.app/mcp` (Streamable HTTP transport). If your agent runtime already has an x402-aware wallet wired into its MCP layer (e.g. `@coinbase/payments-mcp`), you can call tools directly instead of handling the raw HTTP 402 flow yourself — payment is still required per call, MCP just handles the mechanics.

## When to use the paid endpoints

- Before executing a DeFi transaction: check `wallet-safety` or `approval-scan`.
- Before touching a new token: run `token-risk-metrics` (rug check — mint/freeze authority, holder concentration, liquidity).
- To understand a transaction: `tx-decode` turns raw calldata into a plain-English explanation.
- To understand a contract: `contract-docs` generates function-level documentation with a security posture summary.
- For general AI text tasks tied to crypto/DeFi content: `sentiment`, `summarize`, `translate`.

See [references/ENDPOINTS.md](references/ENDPOINTS.md) for the full price table, JSON Schema pointers, and x402 payment examples for 3 representative endpoints.
