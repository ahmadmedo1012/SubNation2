> **ARCHIVED (2026-10-12, R135 docs sweep).** Moved from `docs/inspection-r134/A1-backend-contracts.md`; dated historical record — content unchanged except cross-round `docs/inspection-*/` citations repointed to their `docs/history/` homes, not current state (see ../README.md for the current index).

# R134-A1 — Backend API contracts & error-path audit

**Agent:** A1 (backend-contracts, round 134) · **Repo:** `main` @ `5d5227c`, clean tree
**Surface:** `backend/src/routes/*.ts` + `backend/src/routes/admin/**` + `backend/src/app.ts` + the contract middleware/libs (`lib/errors.ts`, `lib/http.ts`, `lib/arabic-search.ts`, `middlewares/{requireUser,requireAdmin,idempotency,risk-*,requireCopilotPhase}.ts`, `lib/body-parser-recovery.ts`, `lib/copilot/rate-limit.ts`) + `shared/api-spec/openapi.yaml` (96 paths, orval source of truth) vs the live route tree.
**Method:** full reads of every route file at HEAD (public family line-by-line: products/cart/auth/auth-whatsapp/auth-settings/orders/wallet/coupons/loyalty/notifications/support/health/metrics/cwv/seo/telegram-webhook; admin family: mount graph `routes/index.ts` + `routes/admin/index.ts` + all 24 admin route files + 5 copilot leaves, plus targeted reads of every `catch` block in the routes tree), spec-vs-route path+method diff (automated extraction of both sides), and a read of `docs/history/inspection-r126/A4-admin-data-contracts.md` BEFORE reporting so its dispositioned items are not re-reported. Sibling cross-refs: `docs/history/inspection-r134/A5-security-ci.md` read BEFORE writing (A5-F1 RBAC mount composition is referenced, not re-reported; A5-F2 requireUser no-store ditto). Exclusion list respected (A7-F4 body_hash, A7-F5 Telegram 409, A8-F1/F2/F3/F4, A5-F4/F6, Cloudflare CDN, inventory loading, Embronic). r129/B4 + r130/A9 inherited-open register respected (metrics any-scope, admins.ts mount-only auth, copilot rate-limit fail-open — not re-litigated).
**Read-only:** zero source/test/config modifications, zero git mutations, zero live probes needed (every claim below is file:line verified at HEAD). Only this report + the worklog append were written.

**Verdict: 0 P0 · 0 P1 · 0 P2 · 4 P3 · 6 P4.** The backend contract surface is in
the best shape of any round I have audited: the `{error, code}` envelope is
near-universal (including rate-limiter bodies, CSRF/CORS gates, the global error
handler and the /api 404 fallback), status-code semantics are consistent across
both families, the Arabic-search invariants (R122/R132) are held byte-for-byte,
and the R133 "auth failure → infrastructure verdict" class has **no remaining
instance** on the backend. The findings are completeness/hygiene residues, not
broken journeys.

---

## A. Verified-held (the audit's positive results — each re-checked at HEAD)

| # | Claim | Evidence |
|---|---|---|
| A-1 | **Envelope discipline is universal.** Every user-facing error path answers `{error, code}` via `createErrorResponse`; the four documented outliers (Telegram reason-twins `auth-settings.ts:386-389`, copilot debug `{error,message}` `admin/copilot/settings.ts:174-179`, idempotency `message` twin `middlewares/idempotency.ts:189-198`, CWV beacon reasons) are comment-documented. Rate-limiter bodies are JSON+`RATE_LIMITED` (`app.ts:528-531, 574-577, 594, 615, 655-658`) — no plain-text 429 anywhere. Global handler: SyntaxError→400, ZodError→400 minimal `{path,code}` issues, `.errors`→400 count, else 500 (`app.ts:1798-1841`); unmatched `/api/*` → 404 envelope + `no-store` (`app.ts:931-942`). | `lib/errors.ts`, `app.ts`, all route files |
| A-2 | **Status semantics coherent across families.** 401 = auth (UNAUTHORIZED / SESSION_EXPIRED / INVALID_TOKEN / ACCOUNT_NOT_FOUND for valid-token-deleted-user, one shape since r103 — `auth.ts:367-370`, `wallet.ts:100-106`, `orders.ts:216-219`); 403 = scope (FORBIDDEN, `lib/permissions.ts:69-85`, disabled-admin `requireAdmin.ts:139-141`); 404 = missing/non-owned with honest no-op→404 conversions (`auth.ts:857-868` sessions, `auth.ts:313-337` unlink, `notifications.ts:104-119`, `coupons.ts:421-435`, `cart.ts:343-359`, `admin/alerts.ts:193-215`); 409 = conflicts (CONFLICT / ALREADY_EXISTS / OUT_OF_STOCK on claim race `orders.ts:246-254`); 423 risk blocks with severity ordering (`middlewares/risk-{hard,soft}-block.ts:128,214`); 429 with Retry-After (`admin/orders.ts:328-353` credentials gate, lockout `admin/auth.ts:146-154`, topup cap `wallet.ts:586-595`); 425 copilot cooldown (`admin/copilot/previews.ts:361`); 502/503 gateway/service with typed codes (`auth-whatsapp.ts:128-177` — reason→status→code matrix is exemplary). | cited lines |
| A-3 | **Arabic-search invariants (R122/R132) HELD.** Pure-English queries expand to nothing → byte-identical single-ILIKE SQL (`arabic-search.ts:487-491`); every expanded term is `escapeLikeTerm`'d AND parameterized, incl. the compound AND-branches and the prefix-ranking tier (`products.ts:422-431, 511-521`, `compoundCondition` at 374-383); expansion bounded (≤8 tokens / ≤3 skeletons / ≤4 latin / ≤4 compounds / ≤3 categories — `arabic-search.ts:404-410, 459-462`); search stays uncacheable in-process (`products.ts:360, 599`, B6-02). No LIKE injection surface: all pattern strings pass through `escapeLikeTerm` before the `%…%` wrap (public route verified; admin sweep below has ONE exception → A1-F2). | `lib/arabic-search.ts`, `routes/products.ts` |
| A-4 | **Param validation honesty near-total.** `intParam` digit-exact strict parse (`lib/http.ts:10-21`, A5-14) on every `:id`/`:variantId` route audited (cart R122 A3-P2-3, coupons, notifications, support, admin users/topups/orders/products/variants/alerts/audit-logs filters); `pageParam` MAX_PAGE=10 000 ceiling + `limitParam` clamps on every list incl. the admin money queues (`admin/topups.ts:78-86`, `admin/orders.ts:221-227`, `admin/users.ts:38-40`, `admin/alerts.ts:29-37`); enum-typed filters schema-gated to 400 (order status `admin/orders.ts:195-205`, topup status `admin/topups.ts:56-70`, ticket status `admin/tickets.ts:37-48`, coupon bodies M2). | cited lines |
| A-5 | **Admin gating: no ungated admin route found.** Full sweep of all admin route registrations: `protectedRouter.use(requireAdmin)` (`admin/index.ts:40`) fronts risk/forecast/enrichment/topups/products+variants/pricing×3/flash-sales/users/referrals/tickets/alerts/security/audit-logs/admins/settings/observability/diagnostics/orders + copilot (leaf `requireAdmin` on all 9 copilot routes incl. ask/draft phase gates); `adminStatsRouter` self-gates `requireAdmin+finance` per route (`admin/stats.ts:61-84, 180-190`); `adminAuthRouter` mounts public-by-design login/verify-2fa/probe with requireAdmin on the other six (`admin/auth.ts` route table); coupons-admin and auth-settings-admin carry inline `requireAdmin+finance/settings` (`coupons.ts:257-421`, `routes/index.ts:59`); `/api/metrics` has its own constant-time token/JWT gate mirroring requireAdmin incl. temp-token + sid + is_active (`metrics.ts:33-113`). **Cross-ref A5-F1** (this round): the route-level complement of their mount-level finding — nothing is MISSING, the gates are over-composed (fail-closed). | route sweep |
| A-6 | **Cache-header coverage complete on public GETs.** Catalog family `public, max-age=0, s-maxage=60/30, SWR` incl. the `/api/catalog/stats` + `/api/flash-sale` aliases (`products.ts:36-47`, `routes/index.ts:41-46`); auth providers `s-maxage=60` (`auth-settings.ts:181-182`); healthz 5 s / summary 15 s / live 5 s (`health.ts:514, 805, 840`); robots/sitemap cached (`seo.ts`); share card `max-age=60, s-maxage=300` (`app.ts:1710`); every user-scoped family `no-store` at router level (cart/orders/wallet/loyalty/support/notifications + `/me` `/probe` `/sessions` `/providers/linked`); every admin family `no-store` (router-level or stamped by `requireAdmin` at entry, R126-L4 — covers all copilot leaves). | cited lines |
| A-7 | **No remaining "auth failure → infrastructure verdict" mapping (the R133 class).** Every catch in the routes tree was read. `healthz/summary`'s catch is the public honest-degraded for aggregate failure only (no auth path reaches it — the route is public; `health.ts:802-815`); `healthz/ready` gates BEFORE the try — a 401/403 never enters the verdict computation (`health.ts:820-829`); observability catches surface `null`/`stale:true`/`unhealthy` with documented reasons (`admin/observability.ts:59-66, 94-97, 219-222`); the whatsapp gateway mapper classifies by status (`admin/diagnostics.ts:301-318`); admin 500s log with the `(req.log ?? logger)` fallback idiom (with one file-internal inconsistency → A1-F8). | routes tree catch sweep |
| A-8 | **Money-path contracts exhaustive and replay-honest.** POST /orders maps all 12 CheckoutService reasons to exact status+code (`orders.ts:194-320`); POST /wallet/topups carries the full dedup battery (advisory lock → same-receipt 409 → pending cap 429 → durable idempotency claim with drizzle-wrapped 23505 recovery — `wallet.ts:427-595`); replay = 200 + `Idempotent-Replayed` + no duplicate notify (`orders.ts:324-333`, `wallet.ts:414-425, 545-568`); coupon validate ⇄ checkout parity incl. the total-discount cap and the final>0 gate (`coupons.ts:180-242`). | cited lines |

---

## B. Findings

### A1-F1 [P3] `INVALID_REQUEST_BODY` is emitted outside the ErrorCode enum — the shared enum's exhaustiveness contract is broken for this code

**Where:** `backend/src/lib/body-parser-recovery.ts:112-115` (the malformed-JSON 400
shown to bot probes and misconfigured clients), vs `shared/error-codes/src/index.ts`
(no such member) and `frontend/src/lib/errors.ts` (no map entry).

**Mechanics.** The malformed-body 400 answers `{error: "بيانات الطلب غير صالحة",
code: "INVALID_REQUEST_BODY"}`. Rounds 93/94 established the contract "the enum must
stay exhaustive over what the backend actually emits" (the COPILOT_* and CSRF_CONFIG
members were added for exactly this class of leak — `shared/error-codes/src/index.ts:80-108`
documents it). `INVALID_REQUEST_BODY` is in neither the shared enum nor the frontend
Arabic map nor the openapi ErrorCode enum, and is the ONLY backend-emitted code with
zero references outside its emit site (grep-verified). Client impact is graceful
(`frontend/src/lib/errors.ts:174-196` prefers the server's Arabic `error` string; a
code-only reader falls to the generic fallback), so this is contract-completeness,
not a broken journey — but it is precisely the drift class the shared enum was built
to kill. Bonus inconsistency: the app-level global handler answers the SAME failure
class (a SyntaxError that escapes recovery) with mapped `INVALID_DATA`
(`app.ts:1801-1802`) — two codes for one failure class.

**Fix sketch (S):** add `INVALID_REQUEST_BODY` to `shared/error-codes` + the frontend
map + the spec enum (keeping the string identical), or fold the emit into
`ErrorCode.INVALID_DATA` for one code per class. Either way add the member to the
exhaustiveness check the copilot codes already ride.

---

### A1-F2 [P3] `GET /api/admin/products?search=` never got the `escapeLikeTerm` sweep — `%`/`_` act as wildcards in the command-palette search

**Where:** `backend/src/routes/admin/products.ts:82-83, 119-125` vs the two sibling
routes the r103 sweep fixed: `admin/users.ts:43-50` and `admin/orders.ts:229-233`
(each carries the explicit "a bare `%` in the palette search must not match every
row" rationale).

**Mechanics.** `searchLike = \`%${searchRaw.toLowerCase().slice(0, 100)}%\`` — no
`escapeLikeTerm`, so a literal `%` matches every row and `_` matches any character.
This is pattern hygiene, not injection (the value stays a bound parameter — the
documented AUD103-3-F4 classification), and the blast radius is small (admin-only,
result set capped at 200 by the same handler). But the inconsistency is real and the
r103 comment in the sibling routes claims the sweep; a future copy-paste from this
route re-seeds the class. The `users`/`orders` twins prove the intended idiom.

**Fix sketch (S):** wrap with `escapeLikeTerm` before the `%…%` (one line, mirrors
`admin/orders.ts:233`); add the wildcard probe to `admin-input-bounds.test.ts` if
that suite covers the palette.

---

### A1-F3 [P3] OpenAPI parity: the PUBLIC auth-family tail is absent from the generated spec — plus the (dispositioned) admin remainder enumerated for the record

**Where:** `shared/api-spec/openapi.yaml` (96 paths — the sole orval input,
`shared/api-spec/orval.config.ts`) vs the route tree.

**Public-family gaps (new slice — NOT covered by the R126-A4 B-3 admin disposition):**

| Route | Code | Spec |
|---|---|---|
| POST `/api/auth/logout-all-devices` | `routes/auth.ts:107` | absent |
| GET `/api/auth/providers/linked` | `routes/auth.ts:186` | absent |
| POST `/api/auth/providers/unlink` | `routes/auth.ts:222` | absent |
| DELETE `/api/auth/sessions/{id}` | `routes/auth.ts:857` | absent (spec has GET `/auth/sessions` only) |
| POST `/api/auth/onboarding/complete` | `routes/auth.ts:825` | absent |
| PATCH `/api/admin/settings/auth/{id}` | `routes/auth-settings.ts:586` | absent (spec has GET `/admin/settings/auth` only) |

None appear in any sidecar spec either (`specs/010/011/012`). These are
SPA-consumed, cookie-authenticated contracts the generated client cannot express —
the same exposure class batches 1-2 closed for the admin family (the
response-contract suite pins 47 endpoints; these six would fit it directly).

**Admin-family remainder (CONTINUATION of the documented R126-A4 B-3 plan — listed
for completeness, not re-reported as new):** risk detail/labels/rules/config/synth
(8 method-endpoints, `admin/risk.ts:222-873` — only `/risk/dashboard` + `/risk/events`
are exposed), admins CRUD family (7, `admin/admins.ts:71-446`), product inventory
sub-routes (3, `admin/products.ts:464,551,642`), copilot settings GET+PATCH (2,
`admin/copilot/settings.ts:35,118` — absent from BOTH the main spec and the copilot
sidecar), alerts `/test` (1, `admin/alerts.ts:44`), observability
`deploys/recent`+`sentry/summary` (2), security `auth-stats` (1, `admin/security.ts:70`),
admin session lifecycle (`verify-2fa`, `probe`, `session`, `logout`, `change-password`,
`profile`, `2fa/setup`, `2fa/verify-setup` — 8, `admin/auth.ts:308-922`), enrichment
(3 — sidecar spec exists at `specs/012` but the orval client generates from the main
spec only), diagnostics ops family (8), healthz subchecks (8, incl. the documented
B-10 `healthz/ready` deviation), `/api/metrics` + `/api/cwv` (ops/beacon, arguably
never spec-worthy).

**Fix sketch (M):** batch-3 exposure — the six public auth-tail paths first (they are
the only ones a non-admin client can hit), then risk/admins/inventory as the admin
batch continues the R126 §D plan. Each lands with an `openapi-response-contracts`
pin per the established convention.

---

### A1-F4 [P3] `logout-all-devices` non-Firebase branch under-reports what it did — deletes ALL sessions, says "logged out from the current device"

**Where:** `backend/src/routes/auth.ts:122` (delete every session row) vs
`auth.ts:166-182` (the non-Firebase success branch answers
`"تم تسجيل الخروج من الجهاز الحالي"` — "logged out from the current device").

**Mechanics.** For a WhatsApp/Telegram user (no `firebaseUid`), the route deletes
every `sessions` row for the user at :122, skips the Firebase branch, then returns
the current-device message. The Firebase branch (:146) returns the honest
"من جميع الأجهزة" ("from all devices"). The response is a truthful success for a
smaller action than the one performed — the exact over/under-promise asymmetry the
repo's own silent-no-op→404 and honest-copy discipline exists to prevent. No
behavioral defect (all sessions ARE dead; `requireUser` enforces the row), message
only.

**Fix sketch (S):** return the all-devices message on the non-Firebase branch too
(the session rows are the only transport for these users — the statement is simply
true), or split the copy when the Firebase revocation was skipped.

---

### A1-F5 [P4] Cart add accepts non-integer `product_id` → mislabeled 404 instead of the contract 400

**Where:** `backend/src/routes/cart.ts:165-170` — `if (!product_id || typeof
product_id !== "number")` passes `1.5`/`-3` through; `eq(productsTable.id, 1.5)`
matches nothing and the route answers 404 "المنتج غير موجود".

The repo's `intParam` discipline (A5-14) makes digit-exact 400 the established
contract for bad ids everywhere else; the body-field twin of that check here should
be `Number.isInteger(product_id) && product_id > 0`. The variant check has the same
shape (`cart.ts:167-170`) but lands on a 400 anyway (variant not found → 400
"الباقة المختارة غير متاحة"), so only `product_id` mislabels. **Fix (S):** add the
integer/positivity guard to both fields.

---

### A1-F6 [P4] `apiLimiter.skip` carries three dead entries — and its comment explains a route that does not exist

**Where:** `backend/src/app.ts:532-548` — the skip list tests
`path === "/health"` (no `/api/health` route exists; the health router mounts
`/healthz` — the round-3 note above it documents that very fix, then keeps the
stale entry) and `/assets/` + `/static/` (mount-relative under `/api`; the static
mounts live at app root, outside the limiter entirely).

Harmless at runtime (three string compares that never match real traffic), but the
block is the first place a future maintainer learns the skip semantics, and one of
its entries lies. **Fix (S):** delete the three entries or replace with a comment
marking them as intentionally-absent.

---

### A1-F7 [P4] Copy-pasted comment: the "by-slug" header block sits above `GET /:id/recommendations`

**Where:** `backend/src/routes/products.ts:843-849` — the full
"── /api/products/by-slug/:slug ── … Same response shape as /:id … MUST be
registered BEFORE /:id" comment block (a duplicate of the one at :685-692 that
correctly heads the by-slug route) is pasted above the recommendations route, whose
real ordering note ("Mounted BEFORE /:id at the parent /products router level") is
its last line. Misleading for the next editor of that route. **Fix (S):** delete the
stale block.

---

### A1-F8 [P4] `admin/alerts.ts`: six routes drop the file's own `(req.log ?? logger)` fallback — a bare-router consumer would crash inside the catch

**Where:** `backend/src/routes/admin/alerts.ts:153, 165, 178, 188, 208, 218` —
GET `/` (:153), PATCH `/read-all` (:165), PATCH `/:id/read` (:178), DELETE `/read`
(:188), DELETE `/:id` (:208) and DELETE `/` (:218) call bare `req.log.error(...)`
in their catches, while the same file's `/test` (:84), `/unread-count` (:116) and
`/new` (:130) established and documented the fallback
("bare-router test mounts must not turn a handled 500 into an unhandled HTML
crash"). If pino-http is not mounted (bare-router test/future consumer), a DB
failure in those six routes throws `TypeError` INSIDE the catch — the opposite of
the handled 500 the code intends. Production always mounts pino-http, so this is
robustness-consistency only. Same routes also answer the terse `"خطأ"` where the
family style is a specific message. **Fix (S):** apply the fallback idiom (6 lines).

---

### A1-F9 [P4] `risk/synth` critical-alert dispatch failure is swallowed with zero trace

**Where:** `backend/src/routes/admin/risk.ts:873` —
`void sendCriticalRiskAlert({...}).catch(() => {})`. Every other fire-and-forget in
the routes tree either logs (`.catch((err) => logger.warn(...))` — e.g.
`admin/orders.ts:155-160, 541-543`) or documents why silence is safe. This one is a
bare `() => {}` on a money-adjacent alert channel (the synth route exists to
demonstrate the dispatch). **Fix (S):** add the warn-log twin (or a comment if
`sendCriticalRiskAlert` is internally logged — it is not, per its call sites).

---

### A1-F10 [P4] Copilot previews: GET `/:id` and POST `/:id/cancel` carry no phase gate — the parent mount's "each leaf enforces its own phase + scope gate" comment overstates

**Where:** `backend/src/routes/admin/copilot/previews.ts:44` (GET) and `:90` (POST
cancel) vs the gated siblings at `:132` and `:283`
(`requireCopilotPhase("phase3_enabled")`); the over-claiming comment at
`backend/src/routes/admin/copilot/index.ts:9-10` and `admin/index.ts:42-43`.

Behavior is defensible (read-only fetch + cancel-as-cleanup work in every phase
state; every route still sits behind `requireAdmin` + the copilot rate limiter), but
the documented invariant is inaccurate, and a future leaf added under that comment
inherits a false sense of the gate convention. **Fix (S):** either add the phase
gate to both (matching siblings) or fix the comment to "each MUTATING EXECUTION leaf
enforces its phase gate; read/cancel are always available."

---

## C. Cross-references & non-findings (so the next auditor doesn't re-derive)

- **A5-F1 (this round, P2)** — RBAC mount composition over-restriction. My
  route-level sweep is the complement: every admin route IS gated (A-5 above);
  nothing missing, fail-closed. Not re-reported here.
- **A5-F2 (this round, P4)** — `requireUser` 401s ship no `no-store`. Observed
  independently; theirs.
- **r129/B4 + r130/A9 inherited-open register** — `/api/metrics` any-scope,
  admins.ts mount-only auth, copilot rate-limit fail-open: verified still present,
  still dispositioned, not re-reported.
- **R126-A4 B-3 / B-10** — OpenAPI admin exposure plan + `healthz/ready` 401
  deviation: respected; the admin remainder is enumerated under A1-F3 only for the
  record, and the six public auth-tail paths are flagged as the new slice.
- **R133 fixes verified intact at HEAD** — `healthz/ready` gates before its verdict
  computation; the risk-event 404-vs-outage fork lives in the frontend; no backend
  instance of the mapping-auth→infra class remains (A-7).
- **Deliberate non-findings checked and cleared:** `/api/products` list returns a
  bare array (family convention — orders/topups/tickets/users/notifications-bell all
  bare arrays; envelopes are the documented exceptions: notifications opt-in
  `?page=`, admin alerts, admin audit-logs); the `/products` route marks
  `s-maxage=60` even for `?search=` responses (edge caches per query-string key —
  same 60 s freshness budget as the catalog family, no in-process caching — by
  design per B6-02); idempotency 409 twin-envelope, Telegram callback
  `{ok:false}` 403 and the copilot debug `{error,message}` shape are
  comment-documented outliers; `POST /api/auth/telegram/callback`'s
  server_error → redirect is the documented OAuth-flow contract.

## D. Priority counts + fix order

| Priority | Count | Items |
|---|---|---|
| P0 | 0 | — |
| P1 | 0 | — |
| P2 | 0 | — |
| P3 | 4 | F1 (enum gap), F2 (LIKE hygiene), F3 (spec parity — public tail), F4 (logout-all message) |
| P4 | 6 | F5–F10 |

Suggested order: F1+F4 (trivial, contract-visible) → F2 (one-liner, regression-test
with it) → F3 batch-3 public tail (the only item with client-facing value) → the
P4 tail as drive-by edits (all S, all single-file).
