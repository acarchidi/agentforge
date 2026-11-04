# AgentForge growth plan (written 2026-11-04)

This is the operating plan for the next 90 days. It is written so that a model with less context
than the author can execute it one work package at a time, with no human in the loop except the
one-time setup list in §7. The executor protocol is §6. Progress is ticked in §8 and logged in
`docs/growth-log.md`.

Companion documents: `docs/distribution-roadmap.md` (where we are listed),
`docs/specs/tier2-tier3-implementation-spec.md` (repo conventions, "add a paid endpoint" checklist,
gotchas; **read its §0 before touching code**).

---

## 1. Where we are (measured 2026-11-04)

| Fact | Value | Source |
|---|---|---|
| Paid endpoints live | 28 (EVM x 11 chains, Solana), all listed in the CDP Bazaar, MCP Registry, Glama, x402scan, gold-402 | `/catalog`, roadmap |
| Settled revenue, last 120 days | $2.65, of which about $2.55 is our own keepalive wallet | `scripts/revenueReport.ts 120` |
| Outside payers, last 30 days | 17 wallets; 5 paid on 2+ days but 4 of those are one operator's uptime bot pinging 4×/day; every payment $0.001–$0.003 (`/v1/ping`, `/v1/gas`) | `scripts/dailyPayments.ts 720` |
| Outside MCP tool calls, last 30 days | 55 calls from 12 clients (about 1/day) | Neon `events` |
| Credits bought by outsiders | 0 (the one $1 pack is ours) | Neon |
| Watches bought by outsiders | 0 | Neon |
| x402 market | ~370k payments/day, ~$28k/day, median payment $0.006; 42% of Bazaar calls are web search, 23% market data; security is a sliver split across 1–7-payer sellers | Artemis, Turnkey Bazaar analysis |
| Competition entering | GoPlus x402 security API (40+ chains, Mar 2026); x402station Guard (buyer-side vendor check, $0.001/call); True402, Rug Munch, Edge Market ($0.04–$0.10 rug checks) | web |
| Fear in the market | Bankr/Grok prompt-injection drain, ~$204k (May 2026, MetaMask report); OpenClaw plaintext-key theft; wallets now market "policies enforced outside the AI" (Virtuals, Coinbase Agentic Wallets, MetaMask + Blockaid) | web |

**Diagnosis.** Supply is finished and distribution is finished; demand is the problem. Every
AgentForge endpoint is a *tool the LLM must decide to call*. LLMs do not decide to buy safety, and
developers who find us in a directory probe once for $0.001 and leave. Recurring revenue only exists
inside a **loop**: a signing path, a payment path, a polling feed, or a subscription. We are in none
of those loops today. The 28 endpoints are the inventory; the next 90 days put that inventory
inside loops and make us findable at the moments fear spikes.

**Break-even.** Fixed cost is about $25/month (Vercel Pro; Neon free; LLM cost is 4% of revenue).
At $0.008 per preflight that is ~3,100 checks/month, i.e. **one agent doing ~100 guarded actions a
day**. Dominance is not a revenue target; it is the default-integration position described in §3.

---

## 2. The three bets (ranked by return on effort)

### Bet 1 — Stop being a tool, become the guard in the signing loop

Ship **AgentForge Guard**: drop-in wrappers that run `/v1/preflight` on *every* transaction,
signature and x402 payment an agent produces, and refuse to sign on `avoid`. The LLM no longer
chooses; the wallet layer enforces. This is the only honest answer to "my agent got
prompt-injected": a policy outside the model that cannot be talked out of refusing.

- Entry points, in order of audience size: viem account/wallet-client wrapper (every TS agent uses
  viem), x402 client `PaymentPolicy` (every x402 buyer), Coinbase AgentKit wallet-provider wrapper,
  OpenClaw `before_tool_call` plugin, Claude Code / Cursor `PreToolUse` hook, ElizaOS guard.
- Paid through **credits with auto top-up** (the SDK buys a $5 pack when the balance drops under
  $0.50). That is the recurring revenue mechanic: one toll per signed action, prepaid in packs,
  no per-call settlement fee.
- Every integrator can set `referrer`, so a framework or plugin author earns 10% of their users'
  credit purchases forever. Users recruit users because recruiters get paid.
- Why it wins against GoPlus/Blockaid: no account, no key, one call, open source, pays in the
  same USDC the agent already holds, and nobody else bundles simulation + signature decode +
  sanctions + rug check + x402 payment screening into one verdict.

### Bet 2 — Own the trust layer of the x402 market itself

Every x402 payment has a buyer who cannot tell a real seller from a honeypot, and a seller who
cannot tell a sanctioned payer from a customer. Sit between them:

- **x402 vendor reliability index** (spec T3-B): crawl the Bazaar daily, probe each resource's
  402 for free, score uptime, price drift, payTo sanctions, schema quality, age and zombie state.
  Publish a free page per seller and a paid `/v1/vendor-check`. The buyer-side guard from Bet 1
  consumes it, so the toll applies to *all* x402 spend, not just DeFi.
- **Seller side**: publish `x402-sanctions-guard` to npm and offer a free "AgentForge-screened"
  badge to sellers who embed it. Sellers want the badge, embed the middleware, their buyers see
  the brand, buyers install the guard. That is the flywheel.
- Moat: longitudinal history. x402scan shows today; we show 90 days. The feed is also the asset
  a facilitator or wallet would license later.

### Bet 3 — A growth engine that runs itself

We already compute data people search for and never publish it. Turn the cache into pages:

- Per-token risk pages (`/t/<chain>/<address>`) from the launch feed and risk metrics, per-contract
  docs pages from the precomputed docs, per-vendor pages from Bet 2, a daily "new launches,
  risk-scored" page per chain, and a weekly **Agent Safety Report** (drainer signatures caught,
  sanctioned payers screened, launches flagged). Each page ends with the API call and the MCP
  install line. Sitemap + `llms.txt` + JSON-LD so Google, Perplexity, ChatGPT and Claude cite us
  when someone asks "is this token/vendor safe?".
- The weekly report auto-posts to dev.to (API key, one-time) and the repo; the one traffic spike
  we ever had came from a post.
- A scheduled executor (§6) works through §8 three times a week, opening and merging its own PRs,
  so the plan ships without the owner.

**Not a bet: scanning more contracts for its own sake.** Pre-scanning is worth doing only as free
content (Bet 3), RPC-only, no LLM. Paid scanning scales with demand, not with inventory.

---

## 3. Moat and flywheel, stated plainly

1. **Position**: the default pre-sign hook in the libraries agents already use (viem, x402 client,
   AgentKit, OpenClaw). Defaults are sticky; nobody rips out a guard that has never blocked a
   legitimate action.
2. **Data**: 90-day history on every x402 seller, every launch we scored, every drainer signature
   pattern we caught. Grows daily at zero marginal cost.
3. **Incentives**: referral revenue for integrators, badges for sellers, credits bonus for buyers.
4. **Trust surface**: ERC-8004 agent #1153855 posting validations on-chain; signed verdicts; MIT
   code; a public safety report every week. Fear buyers want to see the work.
5. **Cost**: everything in the loop is deterministic (RPC + lists). LLMs only touch the long-tail
   text endpoints. Competitors with LLM-in-the-loop cannot match $0.003–$0.008.

Easing the fear honestly: we never say "unhackable". We say: *your agent can be fooled; its wallet
cannot be, because the guard decides outside the model, and here is the public log of what it
refused this week.*

---

## 4. Work packages

Each WP is one PR (or one PR per bullet where marked). Follow `docs/specs/...-spec.md` §0 for repo
conventions and the paid-endpoint checklist. Acceptance = all tests pass, `npm run build` clean,
the listed checks true on production after merge. "Owner" items are the one-click actions in §7
and never block the rest of a WP.

### WP-1 · AgentForge Guard core (repo `acarchidi/agentforge-tools`, local clone `~/dev/agentforge-tools`)

Goal: `npm i agentforge-tools` → one line → every signature goes through preflight.

Deliverables (one PR, version 0.5.0):
- `src/guard.ts` exporting:
  - `guardAccount(account, opts)`: wraps a viem `LocalAccount`/`Account`. Intercepts
    `signTransaction`, `signTypedData`, `sendTransaction` (if present). Builds the preflight body
    (`chain` from `opts.chain` or the tx `chainId`, `from`, `transactions:[{to,data,value}]` or
    `typedData`), calls `/v1/preflight`. Verdict `avoid` → throw `GuardBlockedError` carrying the
    report. `caution` → `opts.onCaution` (`'block' | 'allow' | fn`, default `'allow'` with a
    console warning). Errors from AgentForge → `opts.failOpen` (default **false**: block, because
    a guard that fails open is theater; document the trade-off).
  - `guardWalletClient(client, opts)`: same for a viem `WalletClient`.
  - `agentForgePaymentPolicy(opts)`: an `@x402/core` client `PaymentPolicy` /
    `BeforePaymentCreationHook` (types are exported from `@x402/core/client`). Sends the
    `PaymentRequired` to `/v1/preflight` as `paymentRequired` with `expectedMaxUsd`. Rejects
    `avoid`. Register with `client.registerPolicy(...)` (AgentKit pins x402 2.7, which has
    `registerPolicy`, not `setSpendControls`; support both).
  - `GuardBlockedError` with `.report`.
- `src/credits.ts`: `createCreditFetch({ privateKey, autoTopUp: { pack: 5, whenBelowUsd: 0.5 }, referrer? })`
  returns a fetch that signs `X-AgentForge-Credit` (scheme in `agentforge/src/credits/auth.ts`:
  base64 JSON `{wallet, ts, nonce, sig}` over `creditMessage(...)`), checks `GET /credits/balance`
  at most once per minute, and when low pays `POST /v1/credits/buy?pack=5&ref=<referrer>` through
  the existing paying fetch. Guard uses this fetch by default when `privateKey` is given.
- README section "Guard" with the three one-liners (viem, x402 client, AgentKit) and the referral
  sentence: "Set `referrer` to your wallet and earn 10% of your users' credit purchases."
- Tests: a fake preflight server (supertest or `undici` MockAgent) returning proceed/caution/avoid;
  assert block/allow/throw paths, fail-closed on 5xx, top-up triggers once when balance low,
  referrer appears in the buy URL.
- Acceptance on prod: a script in `scripts/` of the SDK repo signs a Base transfer to a sanctioned
  address with `guardAccount` against production and is blocked; a WETH wrap passes. Paste output
  in the PR. Publishing to npm: see WP-2 (until then, tag the release; the owner's one-click or the
  workflow publishes).

### WP-2 · No-touch npm publishing (both npm packages)

- Add `.github/workflows/publish.yml` to `agentforge-tools` and `x402-sanctions-guard`: on a `v*`
  tag, `actions/setup-node@v6` (npm ≥ 11.5.1), `permissions: id-token: write`, `npm ci`, `npm test`,
  `npm publish --provenance --access public`. No secret: npm **trusted publishing** (OIDC).
- Owner one-time (§7-A): on npmjs.com → package → Settings → Trusted publisher → GitHub Actions,
  repo `acarchidi/<repo>`, workflow `publish.yml`. Until done, the workflow fails with a clear
  message and the executor leaves the tag in place; nothing else blocks.
- `package.json` `repository.url` must match the GitHub URL exactly (case included).

### WP-3 · Prompt-injection content scan + guard integration (main repo)

- `POST /v1/content-scan` ($0.001; per-item `$0.001` per 4 KB chunk, max 64 KB): deterministic
  rules over text an agent is about to feed its LLM: instruction verbs aimed at agents
  ("ignore previous", "transfer", "approve", "send to"), encoded payloads (base64, hex, Morse,
  zero-width/homoglyph text), embedded addresses and private-key-like strings, URLs on the
  phishing list from WP-7. Output: `{ verdict, findings[], addresses[], urls[] }`. No LLM.
  Also run these rules inside `/v1/preflight` over token names/symbols/metadata and tx memos
  the simulation touches (Track G #2); add a `promptInjection` block to its output.
- Guard (`agentforge-tools` 0.6.0): `scanToolResult(text)` helper and an OpenClaw plugin package
  `agentforge-tools/openclaw` using `before_tool_call` (see GatewayStack governance for the hook
  shape) that (a) blocks wallet-tool calls whose args fail preflight and (b) scans tool results.
  OpenClaw ≥ 2026.5.6 required (CVE-2026-53845 hook bypass).
- Acceptance: the Bankr Morse-code payload (reconstruct from the public write-ups) is flagged;
  a normal DEX quote JSON is not.

### WP-4 · x402 vendor reliability index (spec T3-B, main repo)

- `scripts/crawlVendors.ts`: paginate the CDP discovery index (`.../discovery/resources`,
  100/page, ~30k–100k entries) and the `search?query=` endpoint; for each resource, an unpaid
  request → record status, latency, 402 presence, `accepts[]` (scheme, network, payTo, price,
  asset), description length, schema presence. Screen `payTo` with `screenAddresses()` from
  `src/services/addressCheck.ts`. Check asset is genuine USDC (`src/utils/chains.ts` CHAIN_INFO).
  Store one row per (resource, day) in Neon table `vendor_probes` plus a rolled-up `vendors`
  table (score 0–100, flags: `dead`, `zombie_30d`, `payTo_sanctioned`, `fake_asset`,
  `price_drift`, `new_7d`, `no_schema`). Memory twin for tests.
- Runs in **GitHub Actions** (`.github/workflows/crawl-vendors.yml`, daily 05:00 UTC, matrix of
  4 shards, 20 concurrent fetches, 8 s timeout, skip hosts that failed 3 days running to one probe
  a week). Needs `DATABASE_URL` as a repo secret (§7-B). Never pays anything.
- `GET /v1/vendor-check?url=` ($0.002; batch POST up to 50 at $0.001 each): the score, flags,
  history sparkline (30 daily points), and the preflight-style verdict. Free: `GET /x402/vendors`
  (JSON list, top/bottom 100) and `GET /x402/vendors/<host>` (HTML + JSON-LD, WP-6 renders it).
- Guard: `agentForgePaymentPolicy` sends `resource.url`; preflight's `paymentRequired` path
  consults `vendors` when present and adds a `vendor` block to the verdict.
- Acceptance: our own 28 resources score ≥ 90; a known-dead resource (pick one with
  `lastCalledAt` > 25 days and HTTP 5xx) scores `dead`; crawl finishes under 30 min.

### WP-5 · Seller badge + sanctions guard distribution

- `x402-sanctions-guard` 0.2.0: optional `report: true` sends a hashed daily count of screened
  payers to `POST /v1/badge/report` (free, signed with the seller's payTo key) so the badge is
  live; `GET /badge/<host>.svg` returns "screened by AgentForge · <n> payers checked". README
  gets the badge snippet. Publish via WP-2.
- Vendor pages (WP-4) show the badge when a seller reports.
- Outreach without accounts: `scripts/badgeOutreach.ts` lists the top-200 sellers by score that
  have a GitHub repo in their metadata; the executor opens at most 5 PRs a week adding the
  middleware (one-file change + README badge) **only** to repos whose README invites PRs or that
  have merged an outside PR in 90 days. Log each in `docs/growth-log.md`.

### WP-6 · Public pages engine (main repo)

- A small server-side renderer (`src/pages/`) with one template, no framework: title, verdict
  badge, key facts table, "check this programmatically" block (curl + MCP line + SDK line),
  JSON-LD (`Dataset`/`Report`), `<link rel=canonical>`, `<meta name=description>`.
- Routes (all free, cached 1 h at the edge via `Cache-Control: s-maxage`):
  - `/t/<chain>/<address>`: token risk page from `tokenRiskMetrics` (RPC-only path; **no** LLM
    on an unpaid page) + launch-feed data if present.
  - `/c/<chain>/<address>`: contract page from precomputed docs when they exist (never compute on
    demand), otherwise registry label + admin snapshot.
  - `/launches/<chain>/<yyyy-mm-dd>`: that day's launches, risk-sorted.
  - `/x402/vendors/<host>` and `/x402/vendors` (WP-4).
  - `/report/<yyyy-ww>`: weekly Agent Safety Report (WP-8).
- `/sitemap.xml` built from Neon (launches, vendors, precomputed docs) in chunks of 5,000;
  `/llms.txt` lists the index pages; `/robots.txt` allows them.
- Add Vercel Web Analytics script tag to all pages (owner enables in dashboard, §7-C).
- Acceptance: Lighthouse SEO ≥ 95 on a token page; `curl -sI` shows `s-maxage`; sitemap
  validates; no LLM call is reachable from any unpaid page (grep the handlers).

### WP-7 · Raise the security standard (main repo)

- `url-check` inside preflight and `content-scan`: ingest MetaMask `eth-phishing-detect` (MIT;
  verify at ingest), ScamSniffer (GPL: **do not vendor**; call their public API only if terms
  allow, else skip), and `urlscan`-free sources. Monthly refresh in the existing
  `refresh-address-lists.yml`.
- Address poisoning: in `preflight`, when `from` has Etherscan history, flag recipients that
  match the first/last 4 chars of a recent counterparty but differ elsewhere (Ethereum free
  Etherscan; Base only if `EVM_RPC_URL_BASE` is a keyed provider).
- Signed verdicts: every preflight/vendor-check response carries `signature` (EIP-191 over the
  canonical JSON of `{verdict, inputHash, ts}`) by a `VERDICT_SIGNER_KEY` env key; publish the
  address at `/.well-known/agentforge-signer.json`. Agents can prove to their operator that a
  verdict was obtained.
- ERC-8004 Validation Registry: `scripts/postValidation.ts` posts a validation response for a
  given request hash with the report URI; wired as an optional `?validate=1` on preflight that
  queues the post (needs ETH on the signer wallet, §7-D). Until funded the flag is a no-op.

### WP-8 · Weekly Agent Safety Report + auto-publish

- `scripts/weeklyReport.ts`: from Neon and the caches: launches scored (per chain, % `avoid`),
  sanctioned/scam addresses screened, signatures decoded and flagged, vendors turned dead/zombie,
  prompt-injection findings; top-5 lists linking to WP-6 pages. Writes `docs/reports/<yyyy-ww>.md`
  and the data for `/report/<yyyy-ww>`.
- `.github/workflows/weekly-report.yml` (Mondays 07:00 UTC): run, commit, and POST to dev.to
  (`DEVTO_API_KEY` secret, §7-E) with canonical URL pointing at our page. Without the key it only
  commits.
- Numbers must be real counts; if a counter is zero, the report says zero.

### WP-9 · Framework coverage (agentforge-tools)

- AgentKit: `guardWalletProvider(provider)` wrapper (every `signTransaction`/`signTypedData`/
  `sendTransaction` of any `WalletProvider`); update PR coinbase/agentkit#1619 to mention it.
- Claude Code / Cursor: `npx agentforge-tools hook` prints a `PreToolUse` hook config that calls
  `preflight` when tool input contains `to`+`data` or `typedData`; document in `llms-install.md`.
- ElizaOS: `agentforge-tools/eliza` gains a guard evaluator.
- Python: `agentforge-guard` package (viem-equivalent for `web3.py`/`eth_account` signers) so the
  LangChain Python table, CrewAI and Agentverse listings become possible (roadmap note).
  Publish via PyPI trusted publishing (same OIDC idea, §7-A).

### WP-10 · Measurement and kill switches

- `scripts/growthMetrics.ts` (run by the executor every session, output pasted in the log):
  outside payers 30d (new/repeat), outside credit purchases, guard-origin calls (SDK sends
  `User-Agent: agentforge-tools/<v> guard`; count them), vendor-check calls, npm weekly downloads
  (`https://api.npmjs.org/downloads/point/last-week/agentforge-tools`), pages indexed
  (`site:` not automatable → use Vercel Web Analytics MCP `aggregate_pageviews`), referral payouts.
- Review dates: **2026-12-02** and **2027-01-15**.
- Kill/pivot rule (2027-01-15): if outside credit purchases = 0 **and** repeat payers < 3,
  stop adding DeFi endpoints; move the executor to the horizontal story (content-scan,
  url-check, vendor index as a licensed feed) and write a new plan. If guard-origin calls
  exist from ≥ 3 wallets, double down on WP-9 and WP-5.

---

## 5. Pricing and unit economics for the new work

| Item | Price | Worst-case cost | Note |
|---|---|---|---|
| preflight via guard | $0.008 (+$0.004/token) | ~$0.002 RPC/lists; $0 facilitator via credits | unchanged |
| content-scan | $0.001 per 4 KB | ~$0 | deterministic |
| vendor-check | $0.002 single, $0.001 batch | $0 (reads Neon) | crawl cost is GitHub Actions minutes |
| credits packs | $1/$5/$20 → $1.10/$5.75/$24 | facilitator $0.001 once | the recurring mechanic |
| referral | 10% to referrer, 5% extra to buyer | margin | growth cost, pay only on real purchases |
| pages | free | Vercel function time, cached 1 h | no LLM on unpaid paths |

Keep the rule from the spec: every call profitable after facilitator fee, LLM and upstream.

---

## 6. Executor protocol (the "dumber model" runbook)

A scheduled Claude task **`agentforge-growth`** runs Mon/Wed/Fri (its prompt is `docs/growth-executor.md`). Each run:

1. `cd /Users/pizza/AgentForge && git checkout main && git pull`. Read this file and
   `docs/growth-log.md`. Read `docs/specs/tier2-tier3-implementation-spec.md` §0.
2. Run `npx tsx scripts/dailyPayments.ts 72` and (once it exists) `scripts/growthMetrics.ts`;
   write a 3-line metrics entry to the log.
3. Pick the **first unchecked item in §8 whose dependencies are checked**. If a previous run left
   an open PR, finish that first (CI, merge, verify prod) instead of starting new work.
4. Implement on a branch `growth/wp-<n>-<slug>`. Small, complete, tested. Follow the spec's
   checklist for any new paid endpoint. Never widen scope beyond the item.
5. `npm run build && npm test`. Open the PR with a body that names the item, the acceptance
   check, and pasted smoke output. Wait for the Vercel check. **Merge it yourself** when green
   (`gh pr merge --squash --delete-branch`). Verify production: `/catalog` version,
   `/health/paid`, and the item's own acceptance check.
6. Tick the item in §8, append to `docs/growth-log.md` (date, item, PR link, metrics line,
   anything blocked), commit to main directly (docs only).
7. If blocked by an owner action, add one line to §7's "waiting" list, send one PushNotification
   with the exact click/command, and move to the next unblocked item. Never wait.
8. Hard rules: never spend USDC or ETH (the owner clicks `npm run keepalive`); never create
   accounts or log in anywhere; never publish to npm/PyPI by hand (tags + workflow only); never
   add LLM calls to guard, crawl, cron or page paths; never commit secrets; one item per run;
   stop after the merge is verified. If tests fail twice on the same item, leave the PR open as
   draft, log why, and stop.

Cadence can be changed in the scheduled-tasks list. Each run is a fresh session; this file is its
memory.

---

## 7. One-time owner actions (each is one click or one paste; nothing else needs you)

A. **npm trusted publishing** (unblocks WP-2, WP-5, WP-9 publishing): npmjs.com → package
   `agentforge-tools` → Settings → "Trusted publisher" → GitHub Actions → repository
   `acarchidi/agentforge-tools`, workflow `publish.yml`. Repeat for `x402-sanctions-guard`.
   The executor will tell you when the workflow exists.
B. **`DATABASE_URL` as a GitHub Actions secret** on `acarchidi/agentforge` (unblocks the vendor
   crawl and weekly report). One command in the AgentForge folder:
   `vercel env pull .env.local && gh secret set DATABASE_URL < <(grep '^DATABASE_URL=' .env.local | cut -d= -f2- | tr -d '"')`
C. **Vercel Web Analytics**: Vercel dashboard → agentforge → Analytics → Enable.
D. **ETH for ERC-8004 validations** (optional): send ~$5 of ETH on Base to the buyer wallet
   `0x7942…C135`. Until then validations are skipped silently.
E. **dev.to API key** (optional, for auto-posting the weekly report): dev.to → Settings →
   Extensions → "DEV Community API Keys" → generate → `gh secret set DEVTO_API_KEY`.
F. **Keepalive** stays yours: when the daily check says `LISTINGS_DUE`, click Run on
   `npm run keepalive` (about $1 a month).

Waiting on owner (executor appends here):
- 2026-11-04 · **npm trusted publisher** for `agentforge-tools` and `x402-sanctions-guard` (§7-A), then push the release tags. In each clone: `cd ~/dev/agentforge-tools && git tag v0.5.0 && git push origin v0.5.0` and `cd ~/dev/x402-sanctions-guard && git tag v0.1.0 && git push origin v0.1.0`. Tag pushes trigger publishing, which auto mode refuses to do for you.
- 2026-11-04 · **Guard live acceptance** (~$0.02 USDC from the Base test wallet): `cd ~/dev/agentforge-tools && TEST_WALLET_PRIVATE_KEY=$(grep '^TEST_WALLET_PRIVATE_KEY=' ~/AgentForge/.env | cut -d= -f2-) npx tsx scripts/guardAcceptance.ts`

---

## 8. Checklist (the executor ticks these; keep order)

- [x] WP-2a `agentforge-tools`: `publish.yml` with OIDC trusted publishing (no secrets)
- [x] WP-1a `agentforge-tools` 0.5.0: `guardAccount`, `guardWalletClient`, `GuardBlockedError`, tests, README "Guard"
- [x] WP-1b `agentforge-tools` 0.5.0: `createCreditFetch` with auto top-up + `referrer`; guard uses it
- [x] WP-1c `agentforge-tools` 0.5.0: `agentForgePaymentPolicy` for `@x402/core` clients (v2.7 and 2.26 APIs)
- [ ] WP-1d prod acceptance (owner runs `scripts/guardAcceptance.ts` in agentforge-tools, ~$0.02) + owner pushes tag `v0.5.0` (script and tag push are owner clicks; see §7)
- [x] WP-10a `scripts/growthMetrics.ts` + `User-Agent` tagging in the SDK + log format
- [x] WP-3a main: `/v1/content-scan` endpoint (deterministic rules, per-chunk price) + preflight `promptInjection` block
- [ ] WP-6a main: page renderer + `/t/<chain>/<address>` + `/c/<chain>/<address>` + sitemap + llms.txt entries
- [ ] WP-4a main: `scripts/crawlVendors.ts` + Neon tables + Memory twin + `crawl-vendors.yml` (needs §7-B)
- [ ] WP-4b main: `/v1/vendor-check` (single + batch) + `/x402/vendors` JSON + preflight `vendor` block
- [ ] WP-6b main: `/x402/vendors/<host>` and `/launches/<chain>/<date>` pages
- [x] WP-2b `x402-sanctions-guard`: `publish.yml` + tag `v0.1.0`
- [ ] WP-5a `x402-sanctions-guard` 0.2.0 reporting + main `/v1/badge/report` + `/badge/<host>.svg`
- [ ] WP-8a `scripts/weeklyReport.ts` + `/report/<yyyy-ww>` page + `weekly-report.yml` (dev.to optional, §7-E)
- [ ] WP-3b `agentforge-tools/openclaw` plugin (`before_tool_call`) + `scanToolResult`
- [x] WP-9a `guardWalletProvider` for AgentKit (shipped in 0.5.0; coinbase/agentkit#1619 still to be updated once 0.5.0 is on npm)
- [x] WP-9b Claude Code / Cursor `PreToolUse` hook generator + `llms-install.md` section
- [ ] WP-7a url-check lists (eth-phishing-detect) in preflight/content-scan + monthly refresh
- [ ] WP-7b signed verdicts + `/.well-known/agentforge-signer.json`
- [ ] WP-7c address-poisoning check in preflight (Ethereum first)
- [ ] WP-5b `scripts/badgeOutreach.ts` + first 5 seller PRs (log each)
- [ ] WP-7d `scripts/postValidation.ts` ERC-8004 validations (no-op until §7-D)
- [ ] WP-9c ElizaOS guard evaluator
- [ ] WP-9d Python `agentforge-guard` + PyPI trusted publishing
- [ ] WP-10b 2026-12-02 review: metrics table in the log, re-rank the remaining items
- [ ] WP-10c 2027-01-15 review: apply the kill/pivot rule, write the next plan
