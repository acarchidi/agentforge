# AgentForge distribution roadmap

> The 90-day operating plan (guard, x402 trust layer, growth engine, executor protocol) is `docs/growth-plan.md`; progress is in `docs/growth-log.md`.

Last updated 2026-11-03. Owner of every step below is Claude unless marked **(you)**.

AgentForge's buyers are AI agents and the developers who wire them up. Agents find
paid tools programmatically (discovery indexes, MCP registries); developers find them in
curated GitHub lists and directories. So distribution runs on two tracks, and the
machine track matters more: it is where a paying agent actually picks a vendor.

## Track A — machine discovery (where agents choose a vendor)

| # | Channel | How it lists you | Status | Next action |
|---|---|---|---|---|
| A1 | **CDP x402 Bazaar** (discovery index, ~107k resources) | Any endpoint with a settled payment in the last 30 days | **All 24 settled 11-03** (tx-simulate and lending-health first-paid via keepalive) | none; the daily check reminds before any listing lapses |
| A2 | **Official MCP Registry** | `server.json` published via GitHub OIDC | Live v1.8.0, auto-publishes on every `server.json` change | none |
| A3 | **Glama connectors** (feeds awesome-remote-mcp-servers, scores tool quality) | Auto-ingests from the MCP Registry | Listed. **Done 11-03:** tool annotations + limit disclosure shipped (PR #14). Endpoint answers `initialize` in ~0.2s; the 61% health history includes earlier outages | Re-check the score after Glama re-crawls |
| A4 | **x402scan** | Register the `/.well-known/x402` URL | **Registered 11-03: 24/24 resources**, 14 stale ones retired. Favicon + free-endpoint marking shipped | Optional **(you)**: add a public contact email to `openapi.json` `info.contact` (x402scan uses it to verify ownership) |
| A5 | **llms.txt** | Crawlers and agents read `/llms.txt` at the site root | **Live 11-03** (generated from the agent card) | none |
| A6 | PulseMCP, mcp.so, other MCP directories | Most mirror the MCP Registry | Unverified | Re-check in a week; submit only where mirroring didn't happen and no account is required |

## Track B — curated lists (where developers look)

| # | List | Fit | Status | Next action |
|---|---|---|---|---|
| B1 | **punkpeye/awesome-remote-mcp-servers** (2.5k★, merges daily) | Finance section is full of x402 crypto tools; requires a Glama badge (have it) | **PR open:** [#3754](https://github.com/punkpeye/awesome-remote-mcp-servers/pull/3754) | Respond to CI/review |
| B2 | **xpaysh/awesome-x402** (301★; last merge 2026-07-28) | Tools & Utilities → Security & Analysis | **PR open:** [#2113](https://github.com/xpaysh/awesome-x402/pull/2113) | May sit; maintainers slow |
| B3 | **Haustorium12/gold-402** (active, daily merges, strict format) | Crypto & DeFi Data | **PR open:** [#454](https://github.com/Haustorium12/gold-402/pull/454) (their bot probes the 402) | Respond to probe results |
| — | wong2/awesome-mcp-servers (4.4k★) | Remote servers fit, but the repo has never merged a PR (maintainer commits directly) | Skip | — |
| — | Merit-Systems/awesome-agentic-commerce | Lists protocol infrastructure, not individual APIs | Skip | — |
| — | punkpeye/awesome-mcp-servers | Installable servers only; remote ones go to B1 | Skip | — |
| — | Solana Agent Kit plugin | Repo hasn't merged in months | Skip | — |

## Track D — framework integrations (AgentForge inside the tools developers build with)

| # | Channel | Status | Next action |
|---|---|---|---|
| D1 | **agentforge-tools SDK** ([repo](https://github.com/acarchidi/agentforge-tools)) — typed client, x402 paying fetch with spend cap, tools for OpenAI / Vercel AI SDK / LangChain / ElizaOS | **On npm 11-03:** [`agentforge-tools`](https://www.npmjs.com/package/agentforge-tools) 0.2.0 | Future releases: you approve `npm publish` (npm requires 2FA) |
| D2 | **Coinbase AgentKit** action provider (6 actions, pays from the agent's wallet, policy-enforced spend cap) | **PR open:** [coinbase/agentkit#1619](https://github.com/coinbase/agentkit/pull/1619), GitHub-signed commit, tests/lint/tsc clean | Respond to review |
| D3 | **ElizaOS** | Shipped as `agentforge-tools/eliza`; ElizaOS's plugin registry has been down since ~May 2026 and core no longer merges third-party plugins. ElizaOS's `plugin-mcp` already reaches all 25 tools via the MCP server | Submit to the registry if it reopens |
| D4 | **Vercel AI SDK tools registry** (ai-sdk.dev/resources/tools) | **PR open:** [vercel/ai#24464](https://github.com/vercel/ai/pull/24464), with docs at [/docs/ai-sdk](https://agentforge-taupe.vercel.app/docs/ai-sdk) and an end-to-end run with a real model | Respond to review |
| D5 | **mcp.so** (2.1k★, issue-based) | **Submitted:** [chatmcp/mcpso#6689](https://github.com/chatmcp/mcpso/issues/6689) | none |
| D6 | **PulseMCP** | Submissions paused since 2026-09-03; will ingest from the MCP Registry on reopen | none |
| D7 | GitHub discoverability | **Done 11-03:** README added, topics + description on both repos | none |

## Track E — rank where agents search (CDP Bazaar)

- **Baseline 2026-11-03** (`npx tsx scripts/bazaarRank.ts`, 26 realistic agent queries): AgentForge appeared in **8/26**, top 3 in **3** (#1 for "token approval scanner" and "smart contract documentation"). Every route was named "AgentForge"; competitors name each endpoint after its job.
- **Shipped (PR #22):** job-first per-route names (e.g. "Pre-Sign Transaction Simulation", "Sanctions & Scam Address Check"), 5 query-phrased tags per route, query-first descriptions.
- **Takes effect** when each endpoint next settles (the index re-reads metadata on settlement): `npm run keepalive -- --all` **(you: needs ~$0.55 more USDC on Base)**. Re-measure afterwards.

## Track F — tools for x402 builders

| Item | Status |
|---|---|
| **x402-sanctions-guard** (Express/Hono middleware: screens each payer for OFAC/scam before settlement; [repo](https://github.com/acarchidi/x402-sanctions-guard)) | Released v0.1.0, live-tested (OFAC payer → 403, normal payer → 200). npm publish **(you: approve)**. Listed: [gold-402#455](https://github.com/Haustorium12/gold-402/pull/455) |
| GOAT SDK plugin | **Skipped:** no merged PR since 2025-08, `@goat-sdk/core` unpublished since 2025-05 |

## Track G — security services to add (researched 2026-11-03)

Every security niche in the Bazaar already has 1-3 small sellers with 1-7 payers each: the market is fragmented, so breadth in **one call** is the opening. Priority order:

1. **`/v1/signature-check`** — **SHIPPED 2026-11-03 (v1.9.0, $0.003, PR #24; in agentforge-tools 0.3.0; on x402scan).** decode and risk-score EIP-712 / Permit / Permit2 / Seaport / setApprovalForAll / EIP-3009 signatures, including x402 payment requirements (payTo screened, asset is genuine USDC, amount vs the Bazaar-listed price). Signature phishing is the leading drainer vector and is invisible to transaction simulation. No new data costs.
2. **On-chain prompt-injection scan** — token names/symbols/metadata, NFT metadata, and memos scanned for instructions aimed at agents before they reach an LLM. Agent-specific; deterministic rules first, Haiku only for ambiguous text.
3. **`/v1/url-check`** — crypto phishing / drainer-kit domains for agents that browse dApps. Needs a permissively licensed domain list (MetaMask eth-phishing-detect license to verify; ScamSniffer is GPL).
4. **Address-poisoning check** — lookalike addresses in a wallet's history vs the intended recipient. Ethereum works on free Etherscan; Base needs a keyed provider.
5. **`/v1/preflight` bundle** — one "is this action safe?" call routing a tx, signature, URL, or recipient through all of the above with a single verdict.

## Track C — needs your accounts (not doable by Claude)

Posting on X / dev.to / Farcaster, and anything behind a sign-up. Ready-to-post copy
lives in `_launch/POSTS.md`. The single highest-leverage human action historically:
the only real traffic spike followed the July launch post. **(you, optional)**

**To do (you):**
- [ ] Create an AgentForge X account (sign up with agentforge.api@gmail.com). It unblocks:
  - the Hypurr ecosystem form, already filled in and waiting only on the X link;
  - the launch post in `_launch/OUTREACH-2026-11.md`;
  - an "X link" field that more directories require.
- [ ] Sign in to Google as agentforge.api@gmail.com in the browser pane for the Circle Agent Marketplace form.
- [ ] Review and OK the outreach drafts in `_launch/OUTREACH-2026-11.md`: ERC-8004 / EF / SEAL / Solana grant / Hyperliquid. On hold by your request.
- [ ] LobeHub and the Claude connectors directory: one sign-in each in the browser pane.

## How we'll know it works

The daily payment check tags every payer NEW or REPEAT. Success = new outside payers on
the new endpoints within two weeks, and at least one REPEAT payer outside the four
monitoring bots. Check in on 2026-11-17.
