# AgentForge distribution roadmap

Last updated 2026-11-03. Owner of every step below is Claude unless marked **(you)**.

AgentForge's buyers are AI agents and the developers who wire them up. Agents find
paid tools programmatically (discovery indexes, MCP registries); developers find them in
curated GitHub lists and directories. So distribution runs on two tracks, and the
machine track matters more: it is where a paying agent actually picks a vendor.

## Track A — machine discovery (where agents choose a vendor)

| # | Channel | How it lists you | Status | Next action |
|---|---|---|---|---|
| A1 | **CDP x402 Bazaar** (discovery index, ~107k resources) | Any endpoint with a settled payment in the last 30 days | Listed, 22 + 2 new pending first payment | `npm run keepalive` **(you, one click)** to list tx-simulate and lending-health; daily check reminds before lapses |
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

## Track C — needs your accounts (not doable by Claude)

Posting on X / dev.to / Farcaster, and anything behind a sign-up. Ready-to-post copy
lives in `_launch/POSTS.md`. The single highest-leverage human action historically:
the only real traffic spike followed the July launch post. **(you, optional)**

## How we'll know it works

The daily payment check tags every payer NEW or REPEAT. Success = new outside payers on
the new endpoints within two weeks, and at least one REPEAT payer outside the four
monitoring bots. Check in on 2026-11-17.
