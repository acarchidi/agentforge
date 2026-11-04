# AgentForge

**DeFi safety tools for AI agents.** Simulate a transaction before signing it, screen counterparties for sanctions and scams, catch new token launches already risk-scored, rug-check tokens, and check liquidation risk — paid per call in USDC over [x402](https://x402.org). No API keys, no accounts.

- Live: https://agentforge-taupe.vercel.app
- MCP server: `https://agentforge-taupe.vercel.app/mcp` (free up to a daily cap) — official MCP Registry: `io.github.acarchidi/agentforge`
- SDK + framework tools: [`agentforge-tools` on npm](https://www.npmjs.com/package/agentforge-tools) (OpenAI, [Vercel AI SDK](https://agentforge-taupe.vercel.app/docs/ai-sdk), LangChain, ElizaOS)
- Discovery: [x402 manifest](https://agentforge-taupe.vercel.app/.well-known/x402) · [OpenAPI](https://agentforge-taupe.vercel.app/openapi.json) · [catalog](https://agentforge-taupe.vercel.app/catalog) · [llms.txt](https://agentforge-taupe.vercel.app/llms.txt) · [agent card](https://agentforge-taupe.vercel.app/.well-known/agent.json)

## Use it in 30 seconds

**MCP (no wallet):**

```bash
claude mcp add --transport http agentforge https://agentforge-taupe.vercel.app/mcp
```

Cursor, Windsurf, Claude Desktop, ElizaOS: add an HTTP MCP server with the same URL.

**From code, paying per call:**

```bash
npm install agentforge-tools
```

```ts
import { AgentForge } from 'agentforge-tools';

const af = new AgentForge({ privateKey: process.env.AGENT_KEY as `0x${string}`, maxPaymentUsd: 0.1 });
const sim = await af.simulateTransaction({ chain: 'base', from: '0xYourWallet', transactions: [{ to, data }] });
if (sim.verdict === 'avoid') throw new Error('refusing to sign');
```

**Any x402 client:** send the request unpaid, get a `402` with the exact price, pay, retry. Failed calls (4xx/5xx) are never charged.

**Coinbase AgentKit:** an `agentforge` action provider is proposed upstream in [coinbase/agentkit#1619](https://github.com/coinbase/agentkit/pull/1619).

## Endpoints

| Endpoint | Price (USDC) | What it does |
|---|---|---|
| `POST /v1/token-intel` | $0.015 | Token metadata enrichment with market data and AI risk assessment. |
| `POST /v1/token-research` | $0.03 | Multi-source token intelligence: market data, DeFi metrics, contract verification, prediction markets, price history, holder distribution, and AI risk assessment. |
| `POST /v1/contract-docs` | $0.05 | Human-readable smart contract documentation with function descriptions, risk flags, interaction patterns, security posture, and admin capability analysis. |
| `POST /v1/contract-monitor` | $0.025 | Monitor recent contract admin activity. Detects ownership transfers, upgrades, pause state changes, and suspicious admin operations. |
| `POST /v1/token-compare` | $0.08 | Compare a primary token against up to 3 competitors with full research, abbreviated metrics, and AI comparative analysis. |
| `POST /v1/tx-decode` | $0.05 | Decode any EVM transaction: function call, parameters, token transfers, and plain-English explanation. |
| `POST /v1/approval-scan` | $0.015 | Scan a wallet for risky ERC-20 token approvals. Identifies unlimited approvals, unverified spender contracts, and generates risk assessment. |
| `POST /v1/wallet-safety` | $0.10 | Comprehensive wallet safety check: approval scanning, suspicious pattern detection, target contract assessment, and composite risk scoring (0-100). |
| `POST /v1/sentiment` | $0.003 | AI-powered sentiment analysis for crypto, finance, and social media text. Returns score, confidence, label, reasoning, and per-entity sentiment. |
| `POST /v1/summarize` | $0.008 | AI-powered text summarization with configurable length, format, and optional topic focus. Returns summary, key points, and compression ratio. |
| `POST /v1/translate` | $0.002 | AI-powered translation with tone control and automatic source language detection. Preserves formatting and cultural nuances. |
| `GET /v1/gas` | $0.003 | Current gas prices (slow/standard/fast) for any supported EVM chain with trend analysis. |
| `GET /v1/pool-snapshot` | $0.005 | Cached snapshot of top 500 DeFi liquidity pools. Filter by protocol, chain, or token. Returns TVL, APY, volume, IL risk, and registry enrichment. |
| `POST /v1/token-risk-metrics` | $0.05 | Quantitative token risk metrics: holder concentration, liquidity depth, contract permissions, deployer history, and composite risk score (0-100). |
| `POST /v1/trade-check` | $0.025 | Check a token before you buy it: rug-check metrics + AI risk assessment + current gas in one call, with a proceed/caution/avoid verdict. Cheaper than the three calls separately. |
| `POST /v1/preflight` | $0.008 + $0.004/token | **Is this action safe?** One call before any on-chain action: transactions simulated, signatures checked for phishing, recipients screened, tokens rug-checked, one proceed/caution/avoid verdict. |
| `POST /v1/tx-simulate` | $0.005 | Simulate an EVM transaction (or approve-then-swap sequence) before signing: revert reason, asset changes, approvals, counterparty screening, proceed/caution/avoid verdict. |
| `GET /v1/lending/health` | $0.003 | Aave v3 liquidation risk for a wallet across nine chains: collateral, debt, health factor, status, collateral drop to liquidation. |
| `GET /v1/launches` | $0.005 | Feed of newly launched tokens (Base, Ethereum, Arbitrum, BNB Chain), each already risk-scored. Poll with since=<previous nextSince> to get only new launches. |
| `POST /v1/address-check` | $0.003 for the first address + $0.001 per additional, up to 100 per call | Counterparty screening for 1-100 EVM or Solana addresses: OFAC sanctions, scam/phishing wallets, labeled protocols, brand-new addresses. |
| `POST /v1/risk-batch` | $0.004 per token, 2-25 tokens per call | Rug-check 2-25 EVM tokens in one call: holder, permission, and liquidity risk scores per token. |
| `POST /v1/solana/tx-explain` | $0.05 | Decode a Solana transaction into plain English: labeled programs, token/SOL movements, and risk flags. Falls back to raw RPC decoding if enhanced parsing is unavailable. |
| `POST /v1/solana/tx-simulate` | $0.15 | Simulate a Solana transaction before signing it: balance changes, program labels, deterministic risk rules, and a proceed/caution/avoid recommendation. |
| `POST /v1/solana/token-risk-scan` | $0.35 | Solana token risk / rug check: mint authority, freeze authority, holder concentration, liquidity depth, and a composite 0-100 risk score. |

`GET /v1/ping` ($0.001) verifies your x402 setup and returns the service catalog. Free: `GET /registry/lookup` (contract labels), `GET /v1/solana/program-lookup`.

## Development

```bash
npm install
npm run dev        # http://localhost:3402
npm test
```

Payments: x402 v2, USDC on Base (and Solana for the Solana endpoints), settled through the CDP facilitator. Every paid route returns `402` to an unpaid request; `GET /health/paid` checks all of them.

## License

MIT. See [LICENSE](LICENSE).
