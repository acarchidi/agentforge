# AgentForge Tier 2 + Tier 3: Implementation Spec

Status: ready to implement. Written 2026-11-03 against AgentForge v1.7.0 (the Tier 1 work: `/v1/risk-batch`, `/v1/address-check`, `/v1/launches`).
Every hash, selector, contract address and RPC capability cited here was checked live on 2026-11-03.
Audience: an implementing model or engineer working in this repo. Follow it literally. Where it says
**MUST**, a reviewer will reject the change without it.

## Contents

0. [Ground rules and repo conventions](#0-ground-rules-and-repo-conventions) (read first)
1. [Build order](#1-build-order)
2. [T2-C Prepaid credit packs](#2-t2-c--prepaid-credit-packs) (enabler; build first)
3. [T3-A EVM pre-sign transaction simulation](#3-t3-a--evm-pre-sign-transaction-simulation)
4. [T2-A Watch subscriptions + webhook delivery](#4-t2-a--watch-subscriptions--webhook-delivery)
5. [T2-B Lending position health](#5-t2-b--lending-position-health)
6. [T3-B x402 vendor reliability index](#6-t3-b--x402-vendor-reliability-index)
7. [Appendix: verified facts and constants](#7-appendix--verified-facts-and-constants)

---

## 0. Ground rules and repo conventions

### 0.1 Non-negotiables

1. **Every call must be profitable after all costs.** Costs to count: Anthropic tokens (see
   `src/llm/anthropic.ts` `RATES`), the CDP facilitator fee (**$0.001 per settlement** after the first
   1,000 settlements a month), and any paid upstream API. Free upstreams (public RPC, free-plan
   Etherscan, DexScreener, GeckoTerminal) cost $0 but are rate-limited. Write the worst-case cost next
   to each price in a code comment in `src/config.ts`, as the existing `PRICE_TRADE_CHECK` comment does.
2. **No LLM calls in any recurring or high-volume path** (credits spend, simulation, watch checks,
   lending checks, vendor index). Every feature in this spec is deterministic code over data.
   `contractMonitor`, `approvalScanner` and `walletSafety` call Claude, so **do not reuse those
   services inside watch checks**. Write the RPC-only checkers described below instead.
3. **No work after the response.** The app runs as one Vercel function (`api/index.ts`,
   `maxDuration: 60`) with no `waitUntil`. All work happens inside a request or a cron invocation,
   and must finish in **≤ 45 s**, leaving headroom for x402 settlement.
4. **Mount new middleware and routers in BOTH `src/index.ts` (local) and `api/index.ts` (Vercel).**
   They mirror each other. Order matters: free routers → admin → MCP → **(new credits gate)** →
   `createPaymentMiddleware()` → `paidRouter`.
5. **Never publish, deploy, register, or pay** as part of implementing. That includes pushing to the
   MCP registry, running buyer scripts, and deploying to Vercel. Those are the owner's actions.
   Implement, test, commit to a branch, and stop.
6. **Secrets:** never log, return, or commit secrets. New secrets (`CRON_SECRET`, `WATCH_MASTER_KEY`)
   come from env. If one is missing, the feature disables itself with a clear 503, not a crash.

### 0.2 "Add a paid endpoint" checklist

Every new paid endpoint touches all of these. Tier 1 (`/v1/risk-batch`, `/v1/address-check`,
`/v1/launches`) is the reference implementation: copy its patterns, and grep for `risk-batch` to see
every touchpoint.

| # | File | What to add |
|---|---|---|
| 1 | `src/schemas/<name>.ts` | Zod `xInput` / `xOutput`; include `relatedServices: relatedServicesField` |
| 2 | `src/services/<name>.ts` | `export async function xWithCost(input: unknown): Promise<{ output; estimatedCostUsd }>`; call `xInput.parse(input)` first and `xOutput.parse(...)` last |
| 3 | `src/config.ts` | `PRICE_X: z.string().startsWith('$').default('$…')`, with a worst-case cost comment |
| 4 | `src/pricing.ts` | `ENDPOINT_PRICES['/v1/x']`; if per-item, a `priceFor()` case plus `PRICING_RULES` text; if an MCP tool, `TOOL_TO_ENDPOINT` |
| 5 | `src/middleware/x402.ts` | `ROUTE_METADATA` entry, and a `routeConfig['METHOD /v1/x']` with `accepts`, `description` (job-first, ends `Category: data.`), and `declareDiscoveryExtension({...})` with `input`, `inputSchema`, `output.schema`, `output.example`. Per-item price: `price: perItemPrice('/v1/x')` |
| 6 | `src/routes/paid.ts` | POST: `createHandler('/v1/x', xWithCost)`; GET: `handlePaid(req, res, '/v1/x', xWithCost, req.query)` |
| 7 | `src/mcp/server.ts` | `server.tool('x', '<job-first description>', { zod shape }, (input) => call('x', xWithCost, input))`. Add GET paths to `GET_ENDPOINTS`. Tools are capped at 10/day unless listed in `UNCAPPED_TOOLS` |
| 8 | `src/health/paidHealthCheck.ts` | `{ method, path }` in `PAID_ENDPOINTS_FOR_HEALTH` |
| 9 | `src/discovery/agentCard.ts` | `SKILLS` entry (id, name, job-first description, tags, 3 examples, price, endpoint, method) |
| 10 | `src/routes/free.ts` | `/catalog` `services[]`, `/about` `services{}`, `/.well-known/x402` `resources[]`, `ALL_PRICES` |
| 11 | `src/utils/openapi.ts` | Path entry with `x-x402-price`, `x-payment-info` (`pricingMode: 'fixed' \| 'dynamic'`) |
| 12 | `src/discovery/upsell.ts` | `FEATURED` if it's a flagship; add it to other services' `relatedServices` where it's the natural next call |
| 13 | `dashboard/index.html`, `dashboard/agent-skill.md` | Card; price-table row; "When to use" bullet; tool/endpoint counts |
| 14 | `scripts/buyerAgentAll.ts` | Entry with a valid sample body. The CDP discovery index lists a resource only after a settled payment in the last 30 days |
| 15 | Tests | Bump counts in `tests/integration/endpoints.test.ts` (catalog `services.length`, agent-card `skills.length`), `tests/unit/mcp.test.ts` (tool count, `CAPPED_TOOLS.size`), `tests/unit/paidHealthCheck.test.ts` (3 places: `toHaveLength`, `{ length: N }`, `toBe(N)` ×2) |
| 16 | Versions | One bump per release, in all of: `agentCard.ts`, `free.ts` (×2), `openapi.ts`, `mcp/server.ts` `MCP_SERVER_VERSION`, `agent-skill.md` frontmatter, `server.json`, and the tests asserting it |

### 0.3 Reusable building blocks (already in the repo)

- `src/utils/evmRpc.ts`: `rpcBatch(chain, calls)` for batched JSON-RPC over public endpoints, with an
  override per chain via `EVM_RPC_URL_<CHAIN>`. Failed calls yield `null`; it never throws per call.
- `src/utils/etherscanPacer.ts`: `await etherscanSlot()` before **every** Etherscan call (free plan:
  5/s). `isEtherscanRateLimit(result)` detects the NOTOK rate-limit string.
- `src/launches/store.ts`: the pattern for a Neon-backed store with a Memory twin, a `get…Store()`
  singleton, and a `set…Store()` test hook. Copy it for every new table. Tests run with no
  `DATABASE_URL`, so the Memory twin is what the tests exercise.
- `src/launches/store.ts` `tryLease()`: the cross-instance "at most once per N seconds" lease
  (`INSERT … ON CONFLICT … WHERE last_run_at < now() - make_interval(secs => $2) RETURNING`).
- `src/pricing.ts` `priceFor(endpoint, body)`: the single source of truth for what a request costs.
  The x402 quote, the analytics row, and (after T2-C) the credit debit **MUST** all use it.
- `src/services/addressCheck.ts`: OFAC and scam-list lookups plus `decideVerdict`. T3-A needs to
  screen counterparties. Extract a pure `screenAddresses(items)` from `addressCheckWithCost`, so both
  the endpoint and the simulator call it, rather than duplicating list logic.
- `viem` 2.x is a dependency: `encodeFunctionData`, `decodeFunctionResult`, `erc20Abi`, `parseAbi`,
  `toFunctionSelector`, `privateKeyToAccount` (tests), `createPublicClient`, `verifyMessage`.

### 0.4 Gotchas found the hard way (2026-11-03)

- Etherscan free plan: `tokenholderlist` is Pro-only. **Base** isn't supported for
  `getcontractcreation` or `gastracker` ("Free API access is not supported for this chain").
  `getsourcecode` works on Base. Rate-limit and plan errors come back as HTTP 200 with
  `status: "0"`, never as HTTP errors.
- `mainnet.base.org` answers `eth_getLogs` over any useful range with "request limit reached".
  **Do not design anything that depends on public `eth_getLogs`.** If logs become necessary, gate the
  feature on `EVM_RPC_URL_<CHAIN>` being set to a keyed provider.
- `debug_traceCall` isn't available on public RPCs. **`eth_simulateV1` is** (verified on
  mainnet.base.org, base-rpc.publicnode.com, ethereum-rpc.publicnode.com, arb1.arbitrum.io/rpc).
  Optimism and Polygon are unverified; check before enabling them.
- Blockscout (`*.blockscout.com/api`) is behind a Cloudflare challenge, so it's unusable server-side.
- GeckoTerminal public API: about 30 calls/min per IP. DexScreener `tokens/v1/{chain}/{a,b,…}`: up to
  30 tokens per call.
- x402 `exact` on EVM settles an EIP-3009 `transferWithAuthorization` for **exactly** the signed
  amount, so a payment can't be partially settled. Anything usage-based must be priced before
  verification (`perItemPrice`) or go through credits (T2-C).
- Neon HTTP driver (`@neondatabase/serverless` `neon()`): every `sql.query()` is its own transaction.
  Make money movements **single atomic statements** (`UPDATE … WHERE balance >= $n RETURNING`, or a
  CTE). Pass timestamps as ISO strings; Postgres coerces untyped parameters.
- Neon auto-suspends after about 5 minutes idle. **A cron that touches Neon every ≤ 5 minutes keeps it
  awake around the clock.** That's a real monthly cost: say so in the PR description, and gate crons
  behind an env flag (below).
- zsh: quote any URL containing `?` in shell commands.

### 0.5 Definition of done (every feature)

1. `npm run build` is clean, and `npm test` passes with new tests for every rule in the feature's
   "Tests" section.
2. Local dev server (`.claude/launch.json` → `agentforge-api`, port 3402): the unpaid request returns
   **402**, and the decoded `PAYMENT-REQUIRED` amount matches `priceFor`:
   ```bash
   curl -s -D - -o /dev/null -X POST 'localhost:3402/v1/x' -H 'content-type: application/json' -d '{…}' | grep -i '^payment-required:' | cut -d' ' -f2 | tr -d '\r' | base64 -d
   ```
3. `GET /health/paid` reports the new endpoint healthy.
4. A throwaway `scripts/_tmp_*.mts` smoke script calls the service function directly against live
   upstreams with `DATABASE_URL` unset, prints the real output, and is deleted afterwards. Paste the
   output into the PR.
5. Every touchpoint in the §0.2 checklist is updated. Grep for an existing Tier 1 endpoint name to
   confirm nothing was missed.
6. Commit on a feature branch and open a PR. Don't merge or deploy.

---

## 1. Build order

| Order | Feature | Why this order | New infra |
|---|---|---|---|
| 1 | **T2-C Prepaid credits** | Removes the $0.001-per-call facilitator floor for every later feature; changes the payment path, so it's best done before more endpoints exist | Credits gate middleware, 3 tables |
| 2 | **T3-A EVM tx simulation** | Self-contained, RPC-only, called before every transaction | none |
| 3 | **T2-A Watches** (contract-admin + token-risk types) | First time-driven feature | Cron router, `CRON_SECRET`, webhook sender, 2 tables |
| 4 | **T2-B Lending health** | Reuses the watch infrastructure | none (adds a watch type) |
| 5 | **T3-B x402 vendor index** | Largest data job; reuses the cron router | 3 tables |

Ship each as its own PR, stacked in this order.

---

## 2. T2-C: Prepaid credit packs

### 2.1 Goal

An agent pays once with x402 (for example $5), receives a prepaid balance, and then calls any paid
endpoint by **signing** the request instead of paying per call. That removes the per-settlement fee
from high-frequency loops (address checks before every transfer, launch-feed polling, simulation
before every transaction).

### 2.2 API

**`POST /v1/credits/buy?pack=<1|5|20>`** is x402-paid and dynamically priced by the `pack` query param.

| pack | Price | Credited | Bonus |
|---|---|---|---|
| 1 | $1.00 | $1.10 | 10% |
| 5 | $5.00 | $5.75 | 15% |
| 20 | $20.00 | $24.00 | 20% |

- Price function: `(ctx) => '$' + PACKS[ctx.adapter.getQueryParam?.('pack') ?? '1']?.price`. An
  invalid pack quotes pack 1, and then the handler returns **400** (not charged).
- The handler responds `200 { status: 'credited_on_settlement', wallet, pack, creditUsd, balanceUrl }`.
  The actual credit happens in the settlement hook (§2.5).

**`GET /credits/balance?wallet=0x…`** is free and public, on `freeRouter`.
Response: `{ wallet, balanceUsd, updatedAt, packs: [...] }`.

**Spending:** any paid endpoint, plus the request header `X-AgentForge-Credit` (§2.4).

### 2.3 Storage (Neon, plus a Memory twin)

```sql
CREATE TABLE IF NOT EXISTS credit_accounts (
  wallet TEXT PRIMARY KEY,                 -- lowercase 0x address
  balance_micro BIGINT NOT NULL DEFAULT 0, -- micro-USD (1e-6), never floats
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS credit_ledger (
  id BIGSERIAL PRIMARY KEY,
  wallet TEXT NOT NULL,
  delta_micro BIGINT NOT NULL,             -- +purchase, -spend, +refund
  kind TEXT NOT NULL,                      -- 'purchase' | 'spend' | 'refund'
  endpoint TEXT,
  tx_hash TEXT UNIQUE,                     -- purchases only: settlement tx (idempotency key)
  request_id TEXT,                         -- spends/refunds: uuid per request
  ts TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_wallet_ts ON credit_ledger(wallet, ts DESC);
CREATE TABLE IF NOT EXISTS credit_nonces (
  wallet TEXT NOT NULL,
  nonce TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (wallet, nonce)
);
```

Store interface (`src/credits/store.ts`):

```ts
interface CreditStore {
  credit(wallet: string, micro: bigint, txHash: string): Promise<'credited' | 'duplicate'>;
  debit(wallet: string, micro: bigint, endpoint: string, requestId: string): Promise<bigint | null>; // null = insufficient
  refund(wallet: string, micro: bigint, endpoint: string, requestId: string): Promise<void>;
  balance(wallet: string): Promise<{ micro: bigint; updatedAt: string | null }>;
  useNonce(wallet: string, nonce: string, ttlSec: number): Promise<boolean>; // false = replay
}
```

Atomic SQL (each is ONE statement):

- `credit`:
  ```sql
  WITH ins AS (INSERT INTO credit_ledger (wallet, delta_micro, kind, tx_hash) VALUES ($1,$2,'purchase',$3)
               ON CONFLICT (tx_hash) DO NOTHING RETURNING wallet, delta_micro)
  INSERT INTO credit_accounts (wallet, balance_micro) SELECT wallet, delta_micro FROM ins
  ON CONFLICT (wallet) DO UPDATE SET balance_micro = credit_accounts.balance_micro + EXCLUDED.balance_micro, updated_at = now()
  RETURNING balance_micro
  ```
  Zero rows means a duplicate.
- `debit`:
  ```sql
  WITH d AS (UPDATE credit_accounts SET balance_micro = balance_micro - $2, updated_at = now()
             WHERE wallet = $1 AND balance_micro >= $2 RETURNING balance_micro)
  INSERT INTO credit_ledger (wallet, delta_micro, kind, endpoint, request_id)
  SELECT $1, -$2, 'spend', $3, $4 FROM d RETURNING (SELECT balance_micro FROM d)
  ```
- `useNonce`: `INSERT … ON CONFLICT DO NOTHING RETURNING nonce`. Prune expired nonces at most once an
  hour per process (`DELETE FROM credit_nonces WHERE expires_at < now()`).

### 2.4 Request signing (spend auth)

Header: `X-AgentForge-Credit: <base64(JSON)>`, where the JSON is
`{ "wallet": "0x…", "ts": <unix seconds>, "nonce": "<32 hex chars>", "sig": "0x…" }`.

Signed message (EIP-191 `personal_sign`), exactly this string with `\n` separators:

```
AgentForge credit spend
method:<UPPERCASE METHOD>
path:<req.path, e.g. /v1/address-check>
query:<raw query string without '?', or empty>
body-sha256:<hex sha256 of the raw JSON body string, or of '' for GET>
ts:<ts>
nonce:<nonce>
```

- The raw body string is needed for the hash. Change `express.json({ limit: '1mb' })` in **both**
  entry files to `express.json({ limit: '1mb', verify: (req, _res, buf) => { (req as any).rawBody = buf.toString('utf8'); } })`.
- Verify with `createPublicClient({ chain: base, transport: http(rpcUrl('base')) }).verifyMessage({ address, message, signature })`.
  This handles EOAs **and** smart-contract wallets (ERC-1271/6492). Many CDP agent wallets are smart
  accounts.
- Reject (401 `CREDIT_AUTH_INVALID` with a `reason`) when: the base64 or JSON is malformed,
  `|now − ts| > 120 s`, the nonce isn't 32 hex chars, the signature is invalid, or the nonce was
  already used (`useNonce` false → reason `replay`).
- Wallets are case-insensitive: lowercase them everywhere.

### 2.5 Crediting on settlement

In `src/middleware/x402.ts`, the existing `server.onAfterSettle(async (ctx) => { … })` hook resolves
the resource path. If it is `/v1/credits/buy`:

```ts
const wallet = ctx.result.payer?.toLowerCase();             // EVM: 0x…; Solana payers: reject, see below
const paidMicro = BigInt(ctx.result.amount ?? ctx.requirements.amount); // USDC 6dp = micro-USD
const pack = PACK_BY_PRICE_MICRO.get(paidMicro);           // 1_000_000n → pack 1, etc.
if (wallet && pack && ctx.result.transaction) await getCreditStore().credit(wallet, pack.creditMicro, ctx.result.transaction);
```

- **Phase 1 is EVM only.** Offer `/v1/credits/buy` only on `networkId` (Base). Don't add a Solana
  `accepts` entry. Signing works with an EVM key only.
- If crediting throws, log `console.error` with the tx hash and **don't** throw. The payment
  settled, and the owner can re-credit by tx hash with an admin script (§2.8).

### 2.6 The credits gate (`src/middleware/credits.ts`)

```ts
export function creditsGate(paidRouter: Router): RequestHandler
```

Mount it immediately **before** `createPaymentMiddleware()` in both entry files:
`app.use(creditsGate(paidRouter))`. Behavior:

1. No `X-AgentForge-Credit` header → `next()` (the normal x402 path).
2. If the path isn't a paid endpoint (`!(req.path in ENDPOINT_PRICES)`), or is `/v1/credits/buy` or
   `/v1/ping`, → `next()`.
3. Verify the signature (§2.4) → 401 on failure.
4. Compute `micro = BigInt(Math.round(priceFor(req.path, req.method === 'GET' ? req.query : req.body) * 1e6))`.
5. `debit(...)`. If it returns `null`, respond **402** `{ error: 'INSUFFICIENT_CREDITS', balanceUsd, priceUsd, buy: '<PUBLIC_BASE_URL>/v1/credits/buy?pack=5' }`
   and **don't** fall through to x402.
6. Set `res.locals.payment = { scheme: 'credits', wallet, micro, requestId }`, then
   `res.on('finish', () => { if (res.statusCode >= 400) store.refund(...) })`. This mirrors x402's
   "no settlement on ≥ 400" rule.
7. `return paidRouter(req, res, next)`. The request is served without touching the x402 middleware.

In `src/routes/paid.ts` `handlePaid`, when `res.locals.payment?.scheme === 'credits'` set
`paymentScheme: 'credits'` and `clientHash: hashClientId(wallet)`, and keep `amountUsd: priceFor(...)`.

### 2.7 Accounting

- Cash revenue is still the `settled` rows: purchases appear as `/v1/credits/buy`. Credit spends are
  `paid` rows with `payment_scheme = 'credits'` and are **not** cash. Don't add them to revenue.
- `scripts/revenueReport.ts`: add a "credit liability" line (`SUM(balance_micro)/1e6` from
  `credit_accounts`) and a "credit spend (non-cash)" line.
- `scripts/dailyPayments.ts`: no change needed. Purchases show up as `/v1/credits/buy` payments.

### 2.8 Admin script

`scripts/creditByTx.ts <txHash>`: reads the settlement from Base (`eth_getTransactionReceipt`, USDC
Transfer log to `PAY_TO_ADDRESS`), maps the amount to a pack, and calls `credit()`. It's idempotent
via `tx_hash`.

### 2.9 Discovery

- `ROUTE_METADATA['/v1/credits/buy']`: `category: 'Infra'`, tags `['prepaid credits', 'bulk discount', 'x402', 'high volume']`.
- Add one line to every per-item endpoint description and to `pingCatalog().hint`: "High volume? Prepay
  with /v1/credits/buy (up to 20% bonus) and sign requests instead of paying per call." The ping is
  where loop-builders arrive, so put it there.
- Skill doc: a "Prepaid credits" section with a full TypeScript signing example
  (`privateKeyToAccount(...).signMessage({ message })`).

### 2.10 Tests (`tests/unit/credits.test.ts`)

Use `privateKeyToAccount(generatePrivateKey())` and the Memory store.
1. A valid signature debits `priceFor` and the handler runs (mock a trivial paid route via a test
   `Router`).
2. Replaying the same nonce → 401 `replay`. `ts` 121 s old → 401. Tampered body (hash mismatch) → 401.
3. Insufficient balance → 402 `INSUFFICIENT_CREDITS`, and the balance is unchanged.
4. Handler responds 400 → the refund restores the balance exactly.
5. `credit()` twice with the same tx hash → second call `'duplicate'`, credited once.
6. Concurrency: 20 parallel debits of 1 micro against a balance of 10 → exactly 10 succeed (Memory
   store must serialize; the Postgres SQL is atomic by construction).
7. A header on `/v1/ping` → falls through to x402 (`next()` called).

### 2.11 Acceptance

- One $1 purchase on Base mainnet credits $1.10, verified by the owner after deploy (don't do it yourself).
- A signed `POST /v1/address-check` with a balance returns 200 with no x402 headers. Without a
  balance it returns `INSUFFICIENT_CREDITS`.

---

## 3. T3-A: EVM pre-sign transaction simulation

### 3.1 Goal

`POST /v1/tx-simulate`: before an agent signs any EVM transaction (or a short sequence such as
approve + swap), show exactly what would happen, including revert or success, every asset leaving or
entering the wallet, and approvals granted, with a `proceed`/`caution`/`avoid` verdict. Meant to sit
in front of every transaction, so it's RPC-only and cheap.

### 3.2 Input (`src/schemas/txSimulate.ts`)

```ts
const hex = z.string().regex(/^0x[0-9a-fA-F]*$/);
const addr = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const tx = z.object({
  to: addr,
  data: hex.default('0x'),
  value: z.union([hex, z.string().regex(/^\d+$/)]).default('0x0'), // wei; decimal string or hex
  gas: hex.optional(),
});
export const txSimulateInput = z.object({
  chain: z.enum(['ethereum', 'base', 'arbitrum']).default('base'), // add optimism/polygon only after verifying eth_simulateV1 there
  from: addr,
  transactions: z.array(tx).min(1).max(5), // executed in order, state carries over
});
```

### 3.3 Algorithm (`src/services/txSimulate.ts`)

1. Build the RPC request (via `rpcBatch` with one call, or a direct `fetch`):
   ```json
   {"method":"eth_simulateV1","params":[{"blockStateCalls":[{"calls":[{ "from": FROM, "to": TO, "data": DATA, "value": VALUE_HEX }, …]}],
     "traceTransfers": true, "validation": false}, "latest"]}
   ```
   Convert decimal `value` strings to hex with `toHex(BigInt(v))`.
2. Response: `result[0].calls[i]` = `{ status: '0x1'|'0x0', gasUsed, returnData, logs[], error? }`.
   `traceTransfers` adds **synthetic native-ETH Transfer logs** whose `address` is
   `0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee` (verified 2026-11-03).
3. For each call, record success. If it fails, decode `returnData` (or `error.data`):
   `0x08c379a0` → `Error(string)` via `decodeAbiParameters([{type:'string'}], '0x'+data.slice(10))`;
   `0x4e487b71` → `Panic(uint256)` with its code; otherwise `revertReason: 'unknown'`.
4. Parse logs across all calls:
   - `Transfer` topic0 `0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef`:
     3 topics plus data → ERC-20 (amount = data); 4 topics → ERC-721 (tokenId = topics[3]).
   - `Approval` topic0 `0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925`, where
     owner == `from` → an approval granted (spender = topics[2], amount = data).
   - `ApprovalForAll` topic0 `0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31`,
     where owner == `from` and approved = true → NFT operator approval.
   - ERC-1155 `TransferSingle` `0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62`:
     include it, decoding `(id, value)` from data.
5. Compute **net asset changes for `from`**, keyed by token address (or `native`): sum incoming minus
   outgoing. Fetch `symbol` and `decimals` for every token with one `rpcBatch`, and format amounts
   with `formatUnits`.
6. Counterparties: every address that received assets from `from`, every approved spender, and every
   `to`. Screen them with `screenAddresses()` (extracted from addressCheck, §0.3) and label them with
   `getRegistry().lookup()`.
7. Verdict rules, applied in order, first match wins:
   - **avoid**: any call reverted; any counterparty `block` (sanctioned or scam); any approval or
     operator approval granted to an address that's an EOA (`eth_getCode` = `0x`); or `from` loses
     ≥ 1 asset and receives nothing while the recipient is unknown and not a contract.
   - **caution**: an unlimited approval (amount ≥ 2^255) to a spender not in the registry; any
     NFT leaving the wallet; any counterparty with verdict `caution`; or the simulation used
     `validation:false` while `from`'s ETH balance is below `gasUsed × baseFee` (add the note
     "may fail on-chain for insufficient gas").
   - **proceed**: everything else.
8. Output (`txSimulateOutput`):
   `{ chain, from, verdict, reasons[], calls: [{ index, to, toLabel?, success, gasUsed, revertReason? }], assetChanges: [{ token, symbol, decimals, standard: 'native'|'erc20'|'erc721'|'erc1155', delta, deltaFormatted, tokenId? }], approvals: [{ token, spender, spenderLabel?, amount, unlimited, kind: 'erc20'|'operator' }], counterparties: [{ address, verdict, label? }], note, relatedServices }`.
   Related services: `/v1/address-check` (counterparties), `/v1/approval-scan` (the wallet's existing
   approvals), `/v1/trade-check` (the token received, if any).

### 3.4 Pricing

`PRICE_TX_SIMULATE` = **$0.005**. Cost: 1 simulate + 1 metadata batch + 1 code batch = 3 public RPC
requests, no LLM, so the only cost is the $0.001 fee. Margin about $0.004, or about $0.005 via credits.

### 3.5 Discovery copy

- Description: "Simulate an EVM transaction (or an approve-then-swap sequence) before signing: revert
  check, every asset leaving or entering the wallet, approvals granted, counterparty sanctions/scam
  screening, and a proceed/caution/avoid verdict. Category: security."
- ROUTE_METADATA tags: `['simulate transaction', 'pre-sign check', 'transaction firewall', 'asset changes', 'approval check', 'evm']`.
- Put it in upsell `FEATURED` right after `/v1/trade-check`, with cadence "Call before every transaction you sign".
- The existing `/v1/solana/tx-simulate` stays as is. Cross-link the two in their descriptions ("EVM
  version: /v1/tx-simulate").

### 3.6 Tests (`tests/unit/txSimulate.test.ts`)

Mock `rpcBatch` (or `fetch`) with recorded `eth_simulateV1` fixtures. Record real ones with a temp
script and save them under `tests/fixtures/simulate/*.json`:
1. A USDC transfer → one ERC-20 outgoing delta, verdict `proceed` for a contract recipient. For a
   fresh EOA recipient (nonce 0) the counterparty is `caution`, so the verdict is `caution`.
2. Native ETH send → `native` delta from a synthetic `0xeeee…` log.
3. A reverting call with an `Error(string)` → `avoid`, with `revertReason` decoded.
4. `approve(spender, MAX)` to an unknown contract → `caution` with an unlimited approval; to an EOA →
   `avoid`.
5. A recipient on the OFAC list → `avoid`.
6. Two-call sequence (approve, then transferFrom by the spender) → state carries over and both
   appear in `calls`.

### 3.7 Acceptance

A live smoke run on Base: a USDC transfer simulation from any funded address returns the correct
delta in under 2 s.

---

## 4. T2-A: Watch subscriptions + webhook delivery

### 4.1 Goal

An agent pays once to have something watched for N days, and gets an HTTPS webhook when it changes.
The revenue is prepaid; the checks are RPC-only.

### 4.2 Watch types (phase 1)

| type | target | check (RPC/Etherscan only) | alert when | cadence | price/day |
|---|---|---|---|---|---|
| `contract-admin` | contract address | one `rpcBatch`: `owner()` (if present), EIP-1967 implementation slot, EIP-1967 admin slot, `paused()` (selector `0x5c975abb`, if present) | any value changes | 5 min | $0.01 |
| `token-risk` | ERC-20 address | `getTokenRiskMetricsWithCost` (no LLM) | score crosses `params.threshold` (default 50) in either direction, or a new flag appears | 24 h | $0.02 |
| `lending-health` | wallet address | T2-B §5.3 | see §5.4 | 5 min | $0.01 |

Slots: implementation `0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc`, admin
`0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103`.

**Not in phase 1:** an `approvals` watch. It needs `eth_getLogs`, which fails on public RPC (§0.4).
Document it as phase 2, gated on a keyed RPC.

### 4.3 API

- **`POST /v1/watch`** is x402 per-item (`perItemPrice`):
  `price = PRICE_PER_DAY[type] × days`, with a minimum charge of $0.05.
  Input: `{ type, chain: 'ethereum'|'base'|'arbitrum'|'optimism'|'polygon', target, webhookUrl, days: 1–90, params?: { threshold?: number } }`.
  - The handler validates `webhookUrl` (§4.6), creates the watch, sends a `test` event (5 s timeout),
    and returns `{ watchId, secret, type, chain, target, expiresAt, nextCheckAt, webhookTest: { ok, status?, error? }, manage: { status: 'GET /watch/:id', cancel: 'DELETE /watch/:id' } }`.
  - A failed test event does **not** fail the purchase (the webhook may come up later). Report it.
- **`POST /v1/watch/:id/extend`** is x402 per-item by `days`, extends `expires_at`, and needs the
  `X-Watch-Secret` header (x402 route matching: register the pattern as
  `POST /v1/watch/*/extend`, following the existing wildcard handling in `createPaymentMiddleware`).
- **`GET /watch/:id`** and **`DELETE /watch/:id`** are free, on `freeRouter`, and need the
  `X-Watch-Secret` header. GET returns status, `lastCheckAt`, `lastState`, and the last 20 alerts with
  delivery status. DELETE sets `status='cancelled'` (no refunds; say so in the docs).

### 4.4 Secrets

- Env `WATCH_MASTER_KEY` (32+ random bytes, base64) **MUST** be set. Without it, `POST /v1/watch`
  returns 503 `WATCHES_DISABLED`.
- `secret = base64url(HMAC_SHA256(WATCH_MASTER_KEY, watchId))`. Nothing secret is stored. Check the
  header with `crypto.timingSafeEqual` against the recomputed value.
- Webhook signature header (Stripe-style):
  `X-AgentForge-Signature: t=<unix>,v1=<hex HMAC_SHA256(secret, t + "." + rawBody)>`. Document the
  verification snippet in the skill doc.

### 4.5 Storage

```sql
CREATE TABLE IF NOT EXISTS watches (
  id TEXT PRIMARY KEY,                    -- 'w_' + 24 hex chars (crypto.randomBytes(12))
  type TEXT NOT NULL, chain TEXT NOT NULL, target TEXT NOT NULL,
  webhook_url TEXT NOT NULL,
  params JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',  -- active | expired | cancelled
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  next_check_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_check_at TIMESTAMPTZ,
  last_state JSONB,
  consecutive_check_failures INT NOT NULL DEFAULT 0,
  payer_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_watches_due ON watches(status, next_check_at);
CREATE TABLE IF NOT EXISTS watch_alerts (
  id BIGSERIAL PRIMARY KEY,
  watch_id TEXT NOT NULL REFERENCES watches(id),
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  event TEXT NOT NULL,                    -- test | change | threshold | expired
  payload JSONB NOT NULL,
  delivered BOOLEAN NOT NULL DEFAULT false,
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_watch_alerts_pending ON watch_alerts(delivered, next_attempt_at);
```

### 4.6 Webhook URL validation (SSRF): MUST

`src/watches/webhook.ts` `validateWebhookUrl(url)`:
- `https:` only, with a hostname (not a raw IP), and port 443 or unset.
- `dns.promises.lookup(host, { all: true })`. Reject if **any** resolved address is loopback
  (127/8, ::1), private (10/8, 172.16/12, 192.168/16, fc00::/7), link-local (169.254/16, fe80::/10),
  CGNAT (100.64/10), unspecified (0.0.0.0, ::), multicast, or IPv4-mapped IPv6 of any of these.
- Re-validate on **every** delivery, since DNS can change.
- `fetch(url, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(5000), headers: { 'content-type': 'application/json', 'user-agent': 'AgentForge-Webhooks/1.0', 'x-agentforge-signature': … }, body })`.
  Any 2xx is a success. A 3xx counts as a failure, and redirects are never followed.

### 4.7 Cron runner

- New `src/routes/cron.ts` → `cronRouter`, mounted in both entry files next to `adminRouter`
  (before the payment middleware). Auth: `req.headers.authorization === \`Bearer ${process.env.CRON_SECRET}\``,
  otherwise 401. If `CRON_SECRET` is unset, return 503. Vercel Cron sends this header automatically
  when the `CRON_SECRET` env var exists.
- `vercel.json`: add `"crons": [{ "path": "/internal/cron/watches", "schedule": "*/5 * * * *" }]`.
- **Neon cost gate:** at the top of the handler, `if (process.env.WATCHES_ENABLED !== 'true') return res.json({ skipped: 'disabled' })`,
  before any DB access. The owner turns it on only once watches are for sale. Put this in the PR
  description: a 5-minute cron keeps Neon awake around the clock, so check the plan's compute-hour
  cost against expected watch revenue.
- `GET /internal/cron/watches` handler, with a deadline of 45 s from the start:
  1. Claim due watches atomically:
     ```sql
     UPDATE watches SET next_check_at = now() + make_interval(mins => CASE type WHEN 'token-risk' THEN 1440 ELSE 5 END)
     WHERE id IN (SELECT id FROM watches WHERE status = 'active' AND next_check_at <= now()
                  ORDER BY next_check_at LIMIT 100 FOR UPDATE SKIP LOCKED)
     RETURNING *
     ```
  2. Run checkers with concurrency 10 (copy `mapLimit` from `src/services/riskBatch.ts`). Each
     checker returns `{ state, events: Array<{event, summary, previous, current}> }`. Persist
     `last_state`, `last_check_at`, and reset or increment `consecutive_check_failures`. After 12
     consecutive failures, insert one `change` alert with summary "Watch target could not be checked".
  3. Insert alerts for events, then deliver pending alerts (`delivered = false AND next_attempt_at <= now() AND attempts < 6`, up to 100).
     On failure, set `attempts + 1` and `next_attempt_at = now() + 2^attempts minutes`.
  4. Expire: `UPDATE watches SET status='expired' WHERE status='active' AND expires_at < now() RETURNING *`,
     and queue an `expired` alert for each.
  5. Respond `{ checked, alertsQueued, delivered, failed, expired, ms }`.
- First check: on creation set `last_state` from an immediate check, so the first cron run doesn't
  alert on the baseline. Do that inside the create handler, within the deadline.

### 4.8 Webhook payload

```json
{ "watchId": "w_…", "event": "change", "type": "contract-admin", "chain": "base", "target": "0x…",
  "detectedAt": "ISO", "summary": "Implementation changed 0xabc… → 0xdef…",
  "previous": { … }, "current": { … },
  "next": [{ "endpoint": "/v1/contract-docs", "suggestedInput": { … } }] }
```

The `next` field is upsell: point at `/v1/contract-docs` or `/v1/trade-check` for the target.

### 4.9 Tests (`tests/unit/watches.test.ts`)

1. `validateWebhookUrl`: rejects `http:`, raw IPs, `localhost`, and hosts resolving to 10.x, 169.254.169.254
   and `::ffff:127.0.0.1` (mock `dns.promises.lookup`). Accepts a public resolution.
2. Signature: the recomputed HMAC matches; a tampered body fails.
3. `contract-admin` checker: an implementation-slot change emits one `change` event; an identical
   state emits none (mock `rpcBatch`).
4. Cron: 401 without auth; `skipped` when disabled; claims only due, active watches; expires past-due
   watches; retries a failed delivery with backoff and stops after 6 attempts.
5. Pricing: `priceFor('/v1/watch', { type: 'contract-admin', days: 30 })` = 0.30; 1 day = 0.05 (minimum).

---

## 5. T2-B: Lending position health

### 5.1 Goal

A one-shot check on how close a wallet's lending position is to liquidation, plus a watch type that
alerts before it happens. Aave v3 in phase 1; Compound v3 in phase 2.

### 5.2 Aave v3 Pool addresses (verified on 2026-11-03: `getUserAccountData` returns 6 words on each)

| chain | Pool |
|---|---|
| ethereum | `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2` |
| base | `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` |
| arbitrum | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` |
| optimism | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` |
| polygon | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` |

### 5.3 `GET /v1/lending/health?address=0x…&chain=<chain|all>` ($0.003 fixed)

- `chain=all` (the default) queries all five in parallel with one `rpcBatch` per chain.
- Call `getUserAccountData(address)` (selector `0xbf92857c`). Decode with `parseAbi(['function getUserAccountData(address) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)'])`.
- Units: `*Base` values are USD with **8 decimals** (Aave v3 base currency). Thresholds and LTV are
  basis points. `healthFactor` has 18 decimals and equals `2^256 − 1` when there's no debt: report
  `healthFactor: null, status: 'no_debt'`.
- Per-chain status: `safe` (HF ≥ 1.5), `watch` (1.2–1.5), `danger` (1.05–1.2), `critical` (1.0–1.05),
  `liquidatable` (< 1.0). Skip chains with zero collateral and zero debt.
- `collateralDropToLiquidationPct = (1 − 1/HF) × 100`, labeled "approximate: assumes debt value
  constant and collateral moves together".
- Output: `{ address, positions: [{ protocol: 'aave-v3', chain, collateralUsd, debtUsd, availableBorrowsUsd, liquidationThresholdPct, ltvPct, healthFactor, status, collateralDropToLiquidationPct }], worst: <position|null>, relatedServices }`.
  Related services: `POST /v1/watch` with `{ type: 'lending-health', target: address, chain: worst.chain, days: 30, webhookUrl: 'https://…' }`.
  That's the conversion path from a one-shot check to a subscription.
- MCP tool `lending_health`, capped.

### 5.4 Watch type `lending-health`

- `params.threshold` defaults to 1.2.
- Bands: `ok` (HF ≥ threshold + 0.1), `warn` (< threshold), `critical` (< 1.05), `liquidated`
  (debt went to about 0 while collateral dropped sharply, or HF < 1 seen). Alert only on a **band
  change** (hysteresis). Store `lastBand` in `last_state`.
- `chain` for the watch is one chain (no `all`); the agent creates one watch per chain.

### 5.5 Tests

Decode a recorded `getUserAccountData` fixture; the no-debt sentinel → `no_debt`; band transitions
`ok → warn → critical → ok` emit exactly 3 events; `ok → ok` (HF wiggling above threshold + 0.1)
emits none.

---

## 6. T3-B: x402 vendor reliability index

### 6.1 Goal

Agents choosing among x402 vendors (107,339 resources in the CDP index on 2026-11-03) get ranked,
**independently probed** reliability data: is the endpoint up, does it return a valid 402, how fast
is it, and how much real paid usage does it have. AgentForge already sees monitoring bots paying
`/v1/ping` four times a day, which shows demand for this data. Our probes are **unpaid**, so they're
free to run.

### 6.2 Data source: CDP discovery index (public, no key)

`GET https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources?limit=<n>&offset=<o>` returns
`{ items: [...], pagination: { limit, offset, total }, x402Version }`. Each item has `resource` (URL),
`type`, `accepts[]` (`amount` in atomic units, `asset`, `network`, `payTo`, `scheme`), `description`,
`serviceName`, `tags`, `iconUrl`, `extensions` (bazaar info, including example input and HTTP method),
`lastUpdated`, and `quality: { l30DaysTotalCalls, l30DaysUniquePayers, lastCalledAt }`. Verify the
maximum `limit` empirically (start at 100; fall back to 20).

### 6.3 Storage

```sql
CREATE TABLE IF NOT EXISTS x402_resources (
  resource TEXT PRIMARY KEY, host TEXT NOT NULL,
  service_name TEXT, description TEXT, tags JSONB, method TEXT, example_input JSONB,
  networks JSONB, min_price_usd DOUBLE PRECISION, pay_to TEXT,
  l30_calls INT, l30_payers INT, last_called_at TIMESTAMPTZ, index_updated_at TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_seen_in_index_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_probed_at TIMESTAMPTZ, probe_ok_7d DOUBLE PRECISION, latency_p50_ms INT, quality_score DOUBLE PRECISION,
  search TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', coalesce(service_name,'') || ' ' || coalesce(description,'') || ' ' || coalesce(tags::text,''))) STORED
);
CREATE INDEX IF NOT EXISTS idx_x402_search ON x402_resources USING GIN(search);
CREATE INDEX IF NOT EXISTS idx_x402_probe_due ON x402_resources(last_probed_at NULLS FIRST);
CREATE TABLE IF NOT EXISTS x402_probes (
  resource TEXT NOT NULL, ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  status INT, latency_ms INT, valid_402 BOOLEAN, error TEXT
);
CREATE INDEX IF NOT EXISTS idx_x402_probes_resource_ts ON x402_probes(resource, ts DESC);
CREATE TABLE IF NOT EXISTS x402_crawl_state (id TEXT PRIMARY KEY, next_offset INT NOT NULL, total INT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
```

Retention: delete probes older than 14 days, at most once a day. Storage at full coverage is roughly
100k resource rows (~100 MB) plus probes. Note it in the PR and check the Neon plan.

### 6.4 Cron jobs (reuse `cronRouter`; gate both with `X402_INDEX_ENABLED === 'true'`)

1. **`/internal/cron/x402-crawl`**, every 10 minutes: read `next_offset`; fetch up to 40 pages
   sequentially (stop at the 40 s deadline); upsert rows (`host = new URL(resource).host`,
   `min_price_usd = min(accepts.amount)/1e6` over USDC accepts, `method` and `example_input` from
   `extensions.bazaar.info` when present); advance the offset; wrap to 0 at `total`. A full sweep
   takes about 27 runs, which is a few hours.
2. **`/internal/cron/x402-probe`**, every 10 minutes: pick up to 300 resources ordered by
   `last_probed_at NULLS FIRST, l30_calls DESC`. **Politeness: MUST**
   - at most 1 in-flight probe per host, and at most 1 probe per host per 10 minutes;
   - send `User-Agent: AgentForge-x402-index/1.0 (+<PUBLIC_BASE_URL>/about)`;
   - **never** send payment headers; only the method and example input the index declares
     (default GET, no body);
   - 8 s timeout; never follow redirects;
   - honor `X402_INDEX_DENYLIST` (comma-separated hosts) and our own host (skip it).
   Record `status`, `latency_ms`, and `valid_402` (status 402 **and** a parseable `PAYMENT-REQUIRED`
   header (base64 JSON with `accepts[]`) or a v1 JSON body with `accepts[]`). Then refresh the rollups
   for the probed resources: `probe_ok_7d` (share of probes with `valid_402`), `latency_p50_ms`
   (`percentile_cont(0.5)`), and `quality_score`.
3. **Quality score** (0–100, pure function in `src/x402index/score.ts`, unit-tested):
   `40 × probe_ok_7d + 30 × min(1, log10(l30_payers + 1) / 3) + 15 × recency + 15 × latencyScore`,
   where `recency = max(0, 1 − daysSince(last_called_at)/30)` and
   `latencyScore = latency_p50 ≤ 500 ? 1 : latency_p50 ≥ 5000 ? 0 : (5000 − p50)/4500`. Resources
   with fewer than 3 probes get `probe_ok_7d` treated as 0.5 and are labeled `insufficient_data`.

### 6.5 Endpoints

- **`GET /v1/x402/vendors?q=&tag=&network=&maxPriceUsd=&minQuality=&sort=quality|price|adoption&limit=1..50`**,
  $0.003. Full-text `q` via `search @@ plainto_tsquery('simple', $q)`. Returns
  `{ results: [{ resource, serviceName, description, priceUsd, networks, quality: { score, probeOk7d, latencyP50Ms, l30Payers, l30Calls, lastCalledAt, label } }], total, generatedAt }`.
- **`GET /v1/x402/vendor?resource=<url>`**, $0.003: one resource plus its last 50 probes.
- **`GET /x402/stats`**, free: counts by network and tag, and the top 10 by quality. This is the
  public teaser and SEO page; link it from `/about` and the dashboard.
- MCP tool `x402_vendors`, capped. ROUTE_METADATA category `'Infra'`, tags
  `['x402 directory', 'vendor reliability', 'api uptime', 'agent tools', 'service discovery']`.

### 6.6 Tests

Quality-score function table tests; crawler upsert maps an index item correctly (fixture: one real
item saved to `tests/fixtures/x402/item.json`); the prober enforces 1 probe per host per 10 minutes
(fake clock) and never sends `X-PAYMENT`, `PAYMENT-SIGNATURE` or `X-AgentForge-Credit` headers;
`valid_402` parsing accepts the v2 header form and the v1 body form and rejects plain 402s without
`accepts`.

### 6.7 Ethics and ops notes for the PR

Unpaid probes are exactly what every x402 client does before paying. The rate limits above keep load
negligible: 300 probes per 10 minutes across tens of thousands of hosts. Add an opt-out line to
`/about` ("email/denylist") and honor it through `X402_INDEX_DENYLIST`.

---

## 7. Appendix: verified facts and constants

| Fact | Value | Verified |
|---|---|---|
| CDP facilitator fee | first 1,000 settlements a month free, then $0.001 each | project memory 2026-10-20 |
| USDC on Base | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, 6 decimals | in use |
| Uniswap v4 PoolManager | eth `0x000000000004444c5dc75cB358380D2e3dE08A90`, base `0x498581fF718922c3f8e6A244956aF099B2652b2b`, arb `0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32` | `eth_getCode` identical, 2026-11-03 |
| `eth_simulateV1` + `traceTransfers` | works on Base, Ethereum, Arbitrum public RPCs; native transfers appear as logs from `0xeeee…eeee` | 2026-11-03 |
| `debug_traceCall` | not available on public RPCs | 2026-11-03 |
| Aave v3 Pools | see §5.2 | 2026-11-03 |
| CDP discovery index size | 107,339 resources | 2026-11-03 |
| OFAC list source | `github.com/0xB10C/ofac-sanctioned-digital-currency-addresses` (MIT), refreshed via `scripts/refreshAddressLists.ts` | 2026-11-03 |
| Tornado Cash | **delisted** from OFAC SDN in March 2025, so don't hardcode it as sanctioned in tests; use an address from the committed snapshot | 2026-11-03 |

Event topic hashes: Transfer `0xddf252ad…3b3ef`, Approval `0x8c5be1e5…3b925`,
ApprovalForAll `0x17307eab…96c31`, TransferSingle `0xc3d58168…d0f62` (full values in §3.3).
Compute any others with `viem`'s `toEventSelector` instead of copying them from memory.
