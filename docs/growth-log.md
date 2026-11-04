# Growth log

One entry per executor run (newest first). Format: date · item · PR · metrics line · blocked/notes.

## 2026-11-04 · WP-2a, WP-1a/1b/1c, WP-9a/9b, WP-10a, WP-3a, WP-2b shipped
- agentforge-tools 0.5.0 merged (PR acarchidi/agentforge-tools#1): Guard for viem accounts/wallet clients, x402 `onBeforePaymentCreation` hook + `guardPayingFetch`, AgentKit `guardWalletProvider`, Claude Code/Cursor `PreToolUse` hook CLI, `createCreditFetch` with auto top-up and `referrer`; publish.yml (npm trusted publishing). Not on npm until the owner configures the trusted publisher and pushes `v0.5.0`.
- Main repo: `/v1/content-scan` ($0.001 per 4 KB, deterministic prompt-injection rules; Bankr-style Morse and base64 payloads flagged) + preflight `promptInjection` block (PR #43, v1.12.0, live, 29/29 healthy). `scripts/growthMetrics.ts` + `events.client_tag` for guard-origin traffic (PR #42, live).
- x402-sanctions-guard: publish.yml merged; tag `v0.1.0` is the owner's click.
- Decision (owner, 2026-11-04): Bets 2 and 3 (vendor trust index, pages engine) are on hold; execute Bet 1 and the security/measurement items only.
- METRICS 30d payers=17 repeat=5 payments=41 usd=0.06 credit_packs=0 credit_calls=0 guard_calls=0 mcp_calls=58 npm_tools=283 npm_guard=n/a (4 of the 5 repeat payers are one uptime bot).
- Next: WP-3b (OpenClaw plugin), WP-7a/7b (url-check lists, signed verdicts), WP-7c, WP-9c; after 0.5.0 is on npm, update coinbase/agentkit#1619 and the README/docs that still say "tools only".

## 2026-11-04 · plan written
- Baseline: settled revenue 120d $2.65 (≈$2.55 ours); outside payers 30d: 17 new / 0 repeat, all ping/gas; outside MCP calls 30d: 55 from 12 clients; outside credit purchases: 0.
- Listings: all 28 endpoints good until ~2026-12-04 (keepalive run 2026-11-04).
- Next: WP-2a (publish workflow), then WP-1a (guard).
