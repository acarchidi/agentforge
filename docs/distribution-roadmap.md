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
| A3 | **Glama connectors** (feeds awesome-remote-mcp-servers, scores tool quality) | Auto-ingests from the MCP Registry | Listed; snapshot predates 1.8.0 | Raise tool-definition score: add MCP tool annotations (read-only, open-world); investigate health-check failures (2,169 / 3,560 checks healthy) |
| A4 | **x402scan** | Register the `/.well-known/x402` URL | Tracks AgentForge, unclaimed | Submit the registration form |
| A5 | **llms.txt** | Crawlers and agents read `/llms.txt` at the site root | Missing | Serve `/llms.txt` with the job-first catalog |
| A6 | PulseMCP, mcp.so, other MCP directories | Most mirror the MCP Registry | Unverified | Re-check in a week; submit only where mirroring didn't happen and no account is required |

## Track B — curated lists (where developers look)

| # | List | Fit | Status | Next action |
|---|---|---|---|---|
| B1 | **punkpeye/awesome-remote-mcp-servers** (2.5k★, merges daily) | Finance section is full of x402 crypto tools; requires a Glama badge (have it) | Not listed | PR |
| B2 | **xpaysh/awesome-x402** (301★) | Tools & Utilities → Security & Analysis | Not listed; branch prepared in July with stale numbers | Refresh entry, PR |
| B3 | **Haustorium12/gold-402** (active, daily merges, strict format) | Crypto & DeFi Data | Not listed; branch prepared | Refresh entry, PR |
| B4 | **wong2/awesome-mcp-servers** (4.4k★) | Community Servers accepts remote servers | Not listed | PR |
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
