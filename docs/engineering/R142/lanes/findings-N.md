# Lane N findings — API contracts & generated code (R142, Task 142-N1)

Read-only audit at `a9f5e83` (tree clean except this lane's `docs/engineering/` output).
Scope: `shared/api-spec/openapi.yaml` (all 8,957 lines), orval config + generated
clients (`api-client-react` 13,061 + 3,825 lines; `api-zod` 4,620 lines — derivation
validated, not line-reviewed), `custom-fetch.ts` wrapper (fully read), the drift-gate
scripts' contract (owner lane A — cross-checked), `specs/**` (design-time artifacts),
plus cross-checks into backend routes, `shared/db` enums, and 20+ frontend call sites.

Gates re-run at HEAD during this audit: route parity **green** (111 documented ops =
111 implemented; 173 implemented total, 89 allowlisted known gaps), error-code sync
**green** (55/55), Arabic message map typecheck-exhaustive (`Record<ErrorCode,string>`).
The gates prove synchronization; the findings below are the semantic layer they cannot see.

---

## Findings

### N-1 (P2) — The generated client drops every spec header parameter; the money-path Idempotency-Key rides an untyped escape hatch

- **What this is:** `openapi.yaml` declares 7 header parameters: `Idempotency-Key` on
  POST `/orders` (:888), PATCH `/admin/orders/bulk-status` (:2173), POST
  `/admin/topups/{id}/approve` (:2320), POST `/admin/topups/{id}/reject` (:2426), POST
  `/admin/referrals/{id}/credit` (:2719), PATCH `/admin/users/{id}` (:3370), and the
  required `x-telegram-bot-api-secret-token` on POST `/webhook/telegram` (:5368).
- **Problem:** the orval `react-query` target emits **none of them**. Generated
  `createOrder(createOrderBody, options)` (`api.ts:2548-2578`), `approveTopup(id, body,
  options)` (:6146+), and `telegramWebhook(body, options)` (:10680+) have no header
  argument — a repo-wide grep finds **zero** `*Headers` types in the generated client,
  while the **zod target from the same spec generates them**
  (`shared/api-zod/src/generated/api.ts:803-808` — `createOrderHeaderIdempotencyKeyMax`
  etc.), proving the spec data reaches orval and only the react-query client drops it.
  Consequences:
  - `CreateOrderMutationVariables = { data }` only (`api.ts:2620`) — the generated hook
    cannot carry a per-purchase key at all (its `request` option is one static
    `RequestInit` for every mutation call).
  - Every money page works around it by hand: `product.tsx:351` and `checkout.tsx:610`
    call the raw `createOrder()` with untyped `headers: {"Idempotency-Key": …}`;
    `wallet.tsx:447` snapshots `topupKeyRef.current` into a static hook `request`;
    `loyalty.tsx:233-241` abandons the typed client entirely (raw `fetch` + hand-parsed
    `IDEMPOTENCY_IN_FLIGHT` code its generated error type doesn't know); the admin
    pages re-wrap with `useMutation` — the repo documents the reason itself at
    `frontend/src/pages/admin/topups.tsx:221-224`: *"We use useMutation directly (not
    the generated useApproveTopup / useRejectTopup hooks) because the generated hooks
    fix the variable type to `{id, data}`, which doesn't accommodate the per-call
    idempotencyKey we need to thread through."*
  - **Risk:** the double-charge guard (middleware engages only with keys ≥ 8 chars) is
    outside the type contract. A future call site using `useCreateOrder` compiles
    clean while sending no key — a network retry or double-click then double-charges.
    Today's call sites all pass it by hand and `money-races-r140.test.ts` pins the
    behavior, which is what keeps this P2 instead of P1.
- **Fix (flows through spec/orval config — never hand-edit generated files):** verify
  orval 8.40's fetch-client header emission (the zod target proves the input is there);
  if confirmed as a generator gap, either (a) upgrade/pin an orval version that emits
  header params into the fetch signature, or (b) teach `customFetch` a typed
  `idempotencyKey?: string` option (the mutator is hand-written code, the sanctioned
  extension point — G-1's fix will touch this file anyway) and route the money
  mutations through a thin hand-written wrapper module that composes the generated
  functions, deleting the four ad-hoc workarounds above.

### N-2 (P3) — Spec omits the idempotency contract on the two USER-facing money mutations

- **What this is:** POST `/wallet/topups` and POST `/loyalty/convert-points` are both
  mounted behind the idempotency middleware (`backend/src/routes/wallet.ts:249`,
  `backend/src/routes/loyalty.ts:129`) and the frontend sends fresh
  `Idempotency-Key`s on both (`wallet.tsx:447`, `loyalty.tsx:235`).
- **Problem:** the spec documents neither the header parameter nor the
  409 `IDEMPOTENCY_KEY_REUSE`/`IDEMPOTENCY_IN_FLIGHT` responses (nor the cached-2xx
  replay) for either op — `openapi.yaml:1122-1170` and `:1594-1637` — even though the
  identical contract is documented for `/orders` and all five admin money routes. The
  generated error unions are correspondingly blind:
  `CreateTopupMutationError = ErrorType<ErrorResponse | TopupLimitErrorResponse>`
  (`api.ts:3229`) and `ConvertPointsMutationError = ErrorType<ErrorResponse>`
  (`api.ts:4439`) — no `IdempotencyConflictResponse`. These are the only two
  idempotency-mounted mutations of the eight (`rg 'idempotency\(' backend/src/routes`)
  whose documented contract misses it.
- **Fix:** add the `Idempotency-Key` header param + the 409 oneOf
  (`ErrorResponse | IdempotencyConflictResponse`) + the replay semantics note to both
  operations in `openapi.yaml`, then `pnpm --filter @workspace/api-spec run codegen`.
  One spec edit + one regeneration; zero handler changes.

### N-3 (P3) — `/admin/pricing/calculate` has no response schema: the loose `{[key:string]:unknown}` forces a double type-cast escape

- **What this is:** the 200 response of the variant-aware economics simulator is a
  bare `type: object` with no properties (`openapi.yaml:3189-3195`) — despite the
  description promising margins, worst-case caps, guardrails and SAFE/WATCH/THIN/LOSS
  risk states.
- **Problem:** the generated client types it as
  `AdminPricingCalculate200 = { [key: string]: unknown }`
  (`api.schemas.ts:3473`) and the zod mirror as `zod.object({}).passthrough()`
  (`shared/api-zod/src/generated/api.ts:2662`) — a pin that can never fail. The pricing
  console therefore double-casts: `setResult(data as unknown as CalculatorResponse)`
  (`frontend/src/pages/admin/pricing.tsx:384`) into a page-local type — the code
  comment itself says *"The response schema is open-ended … so it is cast to the
  page-local CalculatorResponse contract."* The real response shape exists only in the
  backend handler and a frontend local type; every gate is structurally blind to
  drift between them.
- **Fix:** write the response schema field-by-field from the handler (the documented
  R126-L8b idiom), regenerate, and add a row to
  `backend/src/__tests__/openapi-response-contracts.test.ts`; delete the page-local
  `CalculatorResponse`.

### N-4 (P3) — Admin settings «التكاملات» tab shows permanently wrong TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID statuses — a live UI bug born from bypassing the contract

- **What this is:** GET `/api/admin/settings` emits exactly four fields
  (`backend/src/routes/admin/settings.ts:15-22`; spec `AdminSettings`
  `openapi.yaml:7559-7572` — the spec is correct and even pinned by the contract
  suite).
- **Problem:** the settings page fetches it with raw `fetch` (not the generated
  `useGetAdminSettings`) and casts `sysSettings as unknown as TelegramSettings`
  (`frontend/src/pages/admin/settings.tsx:169`) into a legacy local type whose
  required `telegram_chat_set` and optional `telegram_bot_set`
  (`settings-page-meta.ts:18-23`) the backend has **never emitted** (repo-wide grep:
  zero producers; `isTelegramConfigured()` is the only real signal). The rows at
  `TelegramStatusRows.tsx:22-44` read `settings?.telegram_bot_set` /
  `settings?.telegram_chat_set` — always `undefined` — so both rows **always render
  «غير موجود» (red)** even when the token and chat id are configured. Only
  «الحالة العامة» works. The `as unknown as` cast over a raw fetch is exactly what
  let a wrong local contract survive while the generated one knew the truth.
- **Fix:** two lines in `TelegramStatusRows.tsx`: drive both rows from real signals
  (drop them, or merge them into the «الحالة العامة» verdict; the masked
  `/admin/settings/auth` provider config is a real per-token signal if granular rows
  are wanted). Alternatively make the backend emit the two booleans — but that is a
  spec+handler+codegen change for an operator nicety; the frontend fix is smaller.

### N-5 (P3) — GET `/notifications` is dual-shaped at runtime; the spec (and the generated client) document only the array arm

- **What this is:** the backend answers paramless requests with the plain ≤40 array
  (bell shape) but any **named** `?page=` with the paged envelope
  `{notifications, total, page, limit, hasMore}` (default 20 / max 100)
  (`backend/src/routes/notifications.ts:38-93`, R128-IMP-5 A9-F2).
- **Problem:** the spec documents only the array (`openapi.yaml:1887-1906` — no
  `page`/`limit` params, no envelope), so `useListNotifications` types only
  `NotificationItem[]`, and the notifications page bypasses the client with raw
  `fetch` + a local `NotificationsPage` interface
  (`frontend/src/pages/notifications.tsx:63-105`). The contract suite pins the
  paramless arm only. Same drift class as N-2 (path parity green, contract stale) —
  this one on a documented op.
- **Fix:** document the opt-in paged arm in the spec (two query params + an envelope
  schema; the dual-shape compat note mirrors what the handler comment already
  explains), regenerate, pin the paged arm in the contract suite; optionally migrate
  the page to the generated hook with `page`/`limit` params.

### N-6 (P4) — Copilot + probe spec-truth gaps: undocumented request fields and response fields the handlers actually use

- **ask body:** POST `/admin/copilot/ask` requestBody documents only `intent_text` +
  `context` (`openapi.yaml:4383-4396`), but the handler consumes `history` and
  `stream` (`backend/src/routes/admin/copilot/ask.ts:102-104`) and the panel sends
  both (`CopilotPanel.tsx:413-420`). The 200 is typed `string` (SSE) while the
  non-stream JSON arm (`AskResponse` with `text/tool_uses/input_tokens/output_tokens/
  correlation_id`) lives only in `frontend/src/components/admin/copilot/copilot-types.ts`.
- **confirm response:** `CopilotConfirmResponse` (`openapi.yaml:8084-8102`) omits
  `cooldown_starts_at`/`cooldown_ends_at`, which the backend emits
  (`previews.ts:213-215, :377`) and the frontend's local `ConfirmResponse` carries.
- **probe description:** `/auth/probe`'s description promises `csrf_token`
  (`openapi.yaml:642-645`) — no layer emits it (handler `auth.ts:428-514`; repo-wide
  grep zero). The schema is right; the description is stale.
- **Impact:** none at runtime today (backend parses leniently; zod strips extras) —
  this is the eroding-the-authority class: the spec stops being the place to look.
- **Fix:** three small spec edits (ask body properties, confirm response fields,
  probe description) + `pnpm codegen`; the copilot local types then collapse into
  generated ones.

### N-7 (P4) — Pricing family: possible 403 (and 401) responses undocumented

- `/admin/pricing/*` sits behind `requirePermission("inventory")`
  (`backend/src/routes/admin/index.ts:64`), so 403 is reachable — but none of the four
  ops document it (`openapi.yaml:3209-3283`); `/admin/pricing/calculate` also omits
  401 despite `requireAdmin`. Typing impact is nil (all error bodies are
  `ErrorResponse`, already in the unions); this is spec-of-record completeness. The
  route gate's own ⚠️ output also lists three stale allowlist entries
  (`get /api/admin/settings`, `get /api/admin/settings/auth`, `get /api/admin/risk/events`
  are documented *and* still in `KNOWN_UNDOCUMENTED`) — worth cleaning in the same pass.
- **Fix:** add the missing error responses in the spec; drop the three stale
  allowlist rows in `scripts/check-openapi-routes.ts`.

### N-8 (P4) — `customFetch(timeoutMs: 0)` + boot-gate 503s = retry loop with no terminator

- The boot-gate retry loop's sole terminator is the deadline check
  (`custom-fetch.ts:587`), but `timeoutMs: 0` (documented "disable the timeout")
  sets `deadlineAt = null` (`:577`) so the check can never fire — a server stuck in
  the starting-gate answers 503-marker forever while the client retries at 5 s
  intervals forever. No production caller passes `0` today (grep: tests only, which
  use it deliberately). **Fix:** one guard — cap boot-gate retries (e.g. a fixed
  attempt ceiling) or refuse gate-budget activation when `timeoutMs <= 0`.

### N-9 (P4) — Split-deployment mode: orval requests bypass the `credentials: "include"` bridge

- `main.tsx:58-60` calls `setBaseUrl(apiBaseUrl)` when `VITE_API_URL` is set, so
  `customFetch` absolutizes `/api/...` **before** the patched `window.fetch`
  (`api-config.ts:41-62`) sees it — the bridge only rewrites *relative* `/api` paths
  and adds `credentials: "include"`. Result in split mode: raw-fetch call sites keep
  cookies, generated-client requests don't (default `same-origin` cross-origin), and
  cookie-auth sessions 401 on every orval call. Dormant — the split stack is retired
  and build vars stay empty (`api-config.ts:7-10` documents this). **Fix:** one line
  — when `_baseUrl` is active and no explicit `credentials` was provided, set
  `credentials: "include"` in `customFetch` (or drop `setBaseUrl` and let the bridge
  own rewriting).

### N-10 (P4) — `home.tsx` builds product-list params as `Record<string, string>`, defeating the generated param typing

- `frontend/src/pages/home.tsx:185-190` types the query params as
  `Record<string, string>` — verified via `tsc` that such a record is assignable to
  the all-optional `ListProductsParams`, so `available_only` rides as the string
  `"true"` and a garbage `sort` value would pass untyped (serialization happens to
  be identical today via the generated URL builder's `String(value)`).
  `category.tsx:145` does it correctly (`fields: "list" as const`). **Fix:** type the
  object as `ListProductsParams` (import from the client), building booleans as
  booleans.

---

## Contract-quality table (spec of record, all 111 documented ops read)

| Dimension | Verdict | Evidence |
|---|---|---|
| Error envelope | **Strong** — `{error, code}` (`ErrorResponse`, 280 refs) on every op read; documented exceptions are deliberate and schema'd (idempotency `message` alias, topup/copilot 429 extras, copilot refusal `{code,message,reasons}`, webhook `{ok}` acks, metrics-500 `{error,message}` handler-faithful) | openapi.yaml:5463-5483 + per-op responses |
| Security schemes | **Accurate** — `auth_token`/`admin_token` httpOnly cookies + Bearer fallbacks as OR-alternatives per op; public ops `security: []`; matches `requireUser`/`requireAdmin` middleware reality; CSRF gate documented in `info.description` | openapi.yaml:5408-5445; backend middlewares |
| Pagination | **Consistent-per-family** — three deliberate idioms (plain array + limit/page; total/hasMore envelopes; keyset `next_cursor`), each documented per-op with its clamps | orders/wallet/ledger vs alerts/audit-logs vs risk/copilot-history |
| Required fields | **Good** — every schema read carries a reviewed `required` set; conditional rules OpenAPI can't express are called out in descriptions (e.g. `UpdateAdminUserBody.note`) | components/schemas pass |
| Deprecated ops | **Clean** — one deprecated *param* (copilot history `entity_type`, documented no-op, unused by the FE); zero deprecated operations | openapi.yaml:4774 |
| Enums vs DB | **No drift** — order/topup/ticket status, ledger ×2, coupon type, risk ×3, referral status match pgEnums exactly; 3 spec enums (loyalty_tier, payment_method, ticket category) are route-guarded tightenings over varchar columns | shared/db/src/schema/* |
| Request validation | **Real** — generated zod bodies are the actual route perimeters on 6 route files (orders/wallet/admin-products/admin-login/coupons/health) | backend route imports |
| Response pinning | **Partial** — 49/111 ops (44%) safeParse-pinned by the contract suite; the rest rely on hand-maintenance (see drift verdict) | openapi-response-contracts.test.ts census |
| Header params | **Broken in client** (N-1) while correct in spec and in the zod target | see N-1 |

## Drift-coverage verdict — what the existing gates CANNOT catch

Gates in place: (1) route parity (method+path, both directions, allowlisted gaps);
(2) ErrorCode enum ↔ const ↔ typecheck'd Arabic map (closed three-legged contract);
(3) orval drift (spec↔generated byte-sync via `clean:true` regen + `git diff` — also
catches hand-edits of generated files; determinism anchored by lockfile-pinned
orval 8.40.0 + prettier); (4) response-contract suite (49 ops, over-promising
direction only — zod strips unknown keys, so under-documentation passes).

Silent-drift classes with a live example each:

1. **Spec loosened + regenerated** — both sides change consistently, every gate green
   (the `AdminPricingCalculate200` loose object is the standing example, N-3).
2. **Handler emits fields the spec doesn't know** — zod strip semantics hide it from
   the pin suite; frontend re-declares local types (copilot `cooldown_starts_at`,
   `AskResponse`; N-6).
3. **Handler grows undocumented params/shapes** — route parity only checks existence
   (`/notifications` paged envelope, N-5; `history`/`stream` on copilot ask, N-6).
4. **Idempotency/behavioral contracts documented as prose only** — no machine check
   that a documented header appears in the generated client (N-1: 7/7 dropped) or that
   mounted middleware matches documented responses (N-2).
5. **Frontend bypasses the generated client** (raw `fetch` + `as unknown as` casts) —
   typecheck green because the cast erases the contract; local types drift from
   reality with user-visible effect (N-4 is the proven live case; loyalty/notifications
   pages are the same pattern without visible breakage).
6. **Error-response completeness per op** — nothing asserts that ops behind
   `requirePermission` document 403 (N-7) or that documented status-code sets match
   what guards can emit.
7. **`as`-cast escape hatch census** — repo-wide hunt: **zero** `as any` in non-test
   frontend/backend source (all hits are comments about removed casts), zero
   `@ts-ignore`/`@ts-expect-error`; the real escapes are the narrower
   `as unknown as` (8 sites, 5 contract-relevant) and `Record<string,string>` params
   (N-10) — the typed surface is otherwise genuinely consumed.

Cheapest coverage wins, in value order: extend the response-contract suite beyond 49
ops (it already has the harness); add a tiny CI check that every spec header param
survives codegen (grep the generated file for the header name — would have caught
N-1 the day it appeared); spec edits for N-2/N-5/N-6/N-7 are one PR + regeneration.

## Not checked / limits

- The 13,061 + 3,825 + 4,620 generated lines were derivation-validated and
  spot-checked (14 ops react side, 8 schemas zod side), not line-reviewed — per the
  lane charter.
- Regenerate-diff was NOT executed in the sandbox (per instructions); determinism is
  argued from the gate's logic + pinned toolchain + lane A's green CI run.
- `specs/**` read structurally (design-time speckit artifacts; three OpenAPI fragments
  verified unreferenced by build/CI/runtime) — individual 100-line task files were
  skimmed for class, not deep-read.
- Binary inventory entries (44) blob+size-verified only.
