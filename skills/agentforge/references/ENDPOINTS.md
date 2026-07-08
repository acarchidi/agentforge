# AgentForge — Full Endpoint Reference

Base URL: `https://agentforge-taupe.vercel.app`. Prices are USDC. The 16 EVM endpoints accept Base mainnet USDC only; the 3 `solana/*` endpoints accept **either** Base or Solana mainnet USDC. This table is a snapshot — `GET /catalog` is always the authoritative, live source (current prices + JSON Schemas).

## Free endpoints (no payment)

| Method | Path | What it does |
|---|---|---|
| GET | `/registry/lookup?address=0x...&chain=ethereum` | Look up an EVM contract in the 384-contract label registry: protocol, category, risk level. |
| GET | `/v1/solana/program-lookup?programId=...` | Look up a Solana program in the 30-program label registry: protocol, category, risk level. |
| GET | `/registry/stats` | EVM registry coverage stats. |
| GET | `/catalog` | Full machine-readable catalog of all 19 paid endpoints, current prices, JSON Schemas. |
| GET | `/about` | Service overview, every endpoint with description and `input_example`. |
| GET | `/.well-known/x402` | x402 discovery document. |
| POST | `/feedback` | Report a bad response or suggest an improvement. |

## Paid endpoints (x402, USDC on Base)

| Method | Path | Price | What it does |
|---|---|---|---|
| POST | `/v1/wallet-safety` | $0.10 | Comprehensive pre-transaction wallet safety check: approvals + activity pattern + target contract risk in one call. |
| POST | `/v1/token-risk-metrics` | $0.05 | Rug check / token risk score: mint authority, freeze authority, holder concentration, liquidity depth, deployer history, composite 0-100 score. |
| POST | `/v1/tx-decode` | $0.05 | Decode any EVM transaction: function call, params, token transfers, plain-English explanation. |
| POST | `/v1/code-review` | $0.05 | Smart contract security audit with severity-ranked issues and gas optimization notes. |
| POST | `/v1/token-compare` | $0.08 | Compare a token against up to 3 competitors with AI-generated analysis. |
| POST | `/v1/token-research` | $0.04 | Multi-source token research: CoinGecko + DeFiLlama + Etherscan + Polymarket in one report. |
| POST | `/v1/contract-monitor` | $0.025 | Recent contract admin activity: ownership transfers, upgrades, pause changes. |
| POST | `/v1/contract-docs` | $0.02 | Human-readable smart contract documentation with security posture and interaction patterns. |
| POST | `/v1/token-intel` | $0.015 | Quick token lookup: market data + risk score in under 10 seconds. |
| POST | `/v1/approval-scan` | $0.015 | Scans a wallet for risky ERC-20 approvals (unlimited allowances, unverified spenders). |
| POST | `/v1/translate` | $0.015 | Translation with tone control, auto-detects source language. |
| POST | `/v1/summarize` | $0.01 | Text summarization with configurable length and format. |
| POST | `/v1/sentiment` | $0.008 | Sentiment analysis for crypto/finance/social text. |
| GET | `/v1/pool-snapshot` | $0.005 | Top 500 DeFi liquidity pools by TVL, filterable by protocol/chain/token, refreshed every 15 min. |
| GET | `/v1/gas` | $0.003 | Real-time gas prices (slow/standard/fast) with trend analysis, any supported EVM chain. |
| GET | `/v1/ping` | $0.001 | Verifies your x402 payment flow works end to end. |

## Solana endpoints (x402, USDC on Base or Solana)

| Method | Path | Price | What it does |
|---|---|---|---|
| POST | `/v1/solana/token-risk-scan` | $0.35 | Rug check: mint/freeze authority, holder concentration, liquidity depth, composite 0-100 score. |
| POST | `/v1/solana/tx-simulate` | $0.15 | Simulate a transaction before signing: balance changes, labeled programs, proceed/caution/avoid recommendation. |
| POST | `/v1/solana/tx-explain` | $0.05 | Explain a transaction: labeled programs, token/SOL movements, plain-English summary. |

## Paying via x402 (3 representative examples)

x402 is a two-step HTTP flow: your first request gets `402 Payment Required` with payment terms in the `PAYMENT-REQUIRED` header (base64-encoded JSON); your client signs an EIP-3009 USDC transfer authorization and retries with an `X-PAYMENT` header. Most agents use an x402-aware HTTP client (`@x402/fetch` for JS, `x402` for Python) rather than raw curl.

**1. Wallet safety check**
```bash
curl -i -X POST https://agentforge-taupe.vercel.app/v1/wallet-safety \
  -H "Content-Type: application/json" \
  -d '{"walletAddress":"0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9","chain":"ethereum"}'
# -> 402, PAYMENT-REQUIRED header. Sign with your x402 client, retry with X-PAYMENT.
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
const paidFetch = wrapFetchWithPayment(fetch, x402Client);
const res = await paidFetch('https://agentforge-taupe.vercel.app/v1/wallet-safety', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ walletAddress: '0x...', chain: 'ethereum' }),
});
```

## Notes for buying agents

- All 16 paid endpoints declare `discoverable` bazaar metadata with example inputs/outputs — use `GET /catalog` or the CDP x402 Bazaar discovery index to pull JSON Schemas programmatically.
- Every paid response includes a `relatedServices` field suggesting other AgentForge endpoints relevant to the same wallet/token/contract.
- Network is Base mainnet, asset is USDC (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`).
