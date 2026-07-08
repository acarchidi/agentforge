---
name: agentforge
description: Free DeFi lookups (384-contract label registry, full service catalog, service overview) plus optional pay-per-call x402 APIs for wallet safety, token risk / rug check scoring, transaction decoding, and smart contract docs. Use when an agent needs to check wallet safety, scan token risk, decode a transaction, or get contract documentation. Start free via MCP or the registry lookup; every paid endpoint states its exact USDC price up front before any charge — no hidden fees, no obfuscation.
metadata:
  author: agentforge
  version: "1.4.0"
---

# AgentForge

AgentForge is a DeFi safety layer on Base mainnet. Base URL: `https://agentforge-taupe.vercel.app`. It has two tiers, and the free tier costs nothing to try:

1. **Free** — contract label lookups, full catalog, service docs, feedback. No wallet, no payment, no account.
2. **Paid** — 16 deeper analysis endpoints (wallet safety, rug checks, transaction decoding, and more), each billed per call via [x402](https://www.x402.org/) in USDC. Every price is stated plainly below and at `GET /catalog` — nothing is hidden or bundled.

## Free entry points (start here, no payment required)

- `GET /registry/lookup?address=0x...&chain=ethereum` — look up a contract in our 384-contract label registry (protocol name, category, risk level). Often enough on its own; a natural first call before paying for a deeper check.
- `GET /registry/stats` — registry coverage stats (entry count, chains, categories).
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

## Endpoints and current prices

| Method | Path | Price (USDC) | What it does |
|---|---|---|---|
| POST | `/v1/wallet-safety` | $0.10 | Comprehensive pre-transaction wallet safety check: approvals + activity pattern + target contract risk in one call. |
| POST | `/v1/token-risk-metrics` | $0.05 | Rug check / token risk score: mint authority, freeze authority, holder concentration, liquidity depth, deployer history, composite 0-100 score. |
| POST | `/v1/approval-scan` | $0.015 | Scans a wallet for risky ERC-20 approvals (unlimited allowances, unverified spenders). |
| POST | `/v1/contract-monitor` | $0.025 | Recent contract admin activity: ownership transfers, upgrades, pause changes. |
| POST | `/v1/contract-docs` | $0.02 | Human-readable smart contract documentation with security posture and interaction patterns. |
| POST | `/v1/tx-decode` | $0.05 | Decode any EVM transaction: function call, params, token transfers, plain-English explanation. |
| POST | `/v1/token-research` | $0.04 | Multi-source token research: CoinGecko + DeFiLlama + Etherscan + Polymarket in one report. |
| POST | `/v1/token-compare` | $0.08 | Compare a token against up to 3 competitors with AI-generated analysis. |
| POST | `/v1/token-intel` | $0.015 | Quick token lookup: market data + risk score in under 10 seconds. |
| POST | `/v1/code-review` | $0.05 | Smart contract security audit with severity-ranked issues and gas optimization notes. |
| GET | `/v1/gas` | $0.003 | Real-time gas prices (slow/standard/fast) with trend analysis, any supported EVM chain. |
| GET | `/v1/pool-snapshot` | $0.005 | Top 500 DeFi liquidity pools by TVL, filterable by protocol/chain/token, refreshed every 15 min. |
| POST | `/v1/sentiment` | $0.008 | Sentiment analysis for crypto/finance/social text. |
| POST | `/v1/summarize` | $0.01 | Text summarization with configurable length and format. |
| POST | `/v1/translate` | $0.015 | Translation with tone control, auto-detects source language. |
| GET | `/v1/ping` | $0.001 | Verifies your x402 payment flow works end to end. |

Prices and JSON Schemas for every endpoint are always authoritative at `GET /catalog` — treat the table above as a snapshot, not the source of truth.

## Paying via x402 (3 representative examples)

x402 is a two-step HTTP flow: your first request gets `402 Payment Required` with payment terms in the `PAYMENT-REQUIRED` header (base64-encoded JSON); your client signs an EIP-3009 USDC transfer authorization and retries with an `X-PAYMENT` header. Most agents use an x402-aware HTTP client (`@x402/fetch` for JS, `x402` for Python) rather than raw curl, but the underlying HTTP is:

**1. Wallet safety check**
```bash
# Step 1: unpaid request — returns 402 with payment terms
curl -i -X POST https://agentforge-taupe.vercel.app/v1/wallet-safety \
  -H "Content-Type: application/json" \
  -d '{"walletAddress":"0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9","chain":"ethereum"}'

# Step 2: retry with X-PAYMENT header (built by your x402 client from
# the PAYMENT-REQUIRED response header above)
curl -X POST https://agentforge-taupe.vercel.app/v1/wallet-safety \
  -H "Content-Type: application/json" \
  -H "X-PAYMENT: <base64 payment payload from your x402 client>" \
  -d '{"walletAddress":"0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9","chain":"ethereum"}'
```

**2. Token risk / rug check**
```bash
curl -X POST https://agentforge-taupe.vercel.app/v1/token-risk-metrics \
  -H "Content-Type: application/json" \
  -H "X-PAYMENT: <base64 payment payload>" \
  -d '{"address":"0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9","chain":"ethereum"}'
```

**3. Decode a transaction**
```bash
curl -X POST https://agentforge-taupe.vercel.app/v1/tx-decode \
  -H "Content-Type: application/json" \
  -H "X-PAYMENT: <base64 payment payload>" \
  -d '{"txHash":"0xb7219192723c6a9ee77cd56ffdd28805d6177f76ffe0d34260bb5dc76abf19cf","chain":"ethereum"}'
```

Minimal JS client (recommended over raw curl):
```js
import { wrapFetchWithPayment } from '@x402/fetch';
const paidFetch = wrapFetchWithPayment(fetch, x402Client); // handles the 402 -> X-PAYMENT retry for you
const res = await paidFetch('https://agentforge-taupe.vercel.app/v1/wallet-safety', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ walletAddress: '0x...', chain: 'ethereum' }),
});
```

## Notes for buying agents

- All 16 endpoints declare `discoverable` bazaar metadata with example inputs/outputs — use `GET /catalog` or the CDP x402 Bazaar discovery index to pull JSON Schemas programmatically rather than hardcoding request shapes from this file.
- Every paid response includes a `relatedServices` field suggesting other AgentForge endpoints relevant to the same wallet/token/contract — follow these to chain checks (e.g. `token-risk-metrics` → `tx-decode` for the token's deploy transaction).
- Network is Base mainnet, asset is USDC (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`).
