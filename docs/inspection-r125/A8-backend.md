# A8 — Backend Follow-up + New-Depth Audit (R125)

- **Agent**: R125-A8 (READ-ONLY audit; only this report file created + one worklog entry)
- **Repo state**: `main @ 09857fc`, clean tree (untracked: sibling R125 reports A1–A6)
- **Scope**: `backend/src/**` (198 non-test ts files, 223 test files) — routes, services, db, middleware, jobs/cron, whatsapp, telegram; cross-reads into `shared/db/src/schema`, `shared/api-spec/openapi.yaml`, `shared/error-codes`. Frontend admin audits (A1–A6) own the UI side; this report verifies those routes' backend behavior precisely AND covers backend breadth no prior round measured (route inventory, query efficiency, transaction discipline, latency hygiene, cron inventory, security quick-pass, dead code/duplication, test breadth).
- **Method**: static analysis only — ripgrep sweeps, per-file route/limit/guard inventories, spec-vs-source diff (69 spec paths vs 105 admin-family + 7 storefront absent endpoints, each listed), no builds/tests executed, no production probes.
- **Exclusions honored**: no WhatsApp/OpenWA session/pairing/restart logic touched or proposed (diagnostics finding B-4 is body-parse + tests only); no inventory/catalog-restock logic proposals; no commits.

## Executive summary

The backend remains **structurally strong** — the R124 org-audit's verdict holds at HEAD with zero regressions, and the new-depth lanes came back clean where it matters most: every traced money mutation rides a transaction with a guarded/CAS/advisory-lock flip, idempotency covers all 7 money routes, `delivered_password` is encrypted-at-rest with decrypt-on-demand + audit + volume-gate, external calls all carry timeouts with fire-and-forget notify, cron jobs have per-job error isolation + leader lease + re-entry guards, and no hot list filter lacks an index. The debt is **consistency debt**: the OpenAPI contract covers only 35 of 105 admin-family endpoints (70 absent — 3× A4's "12" live-subset count, exact list in §C), the copilot error envelope ×47 is byte-for-byte unchanged since R124, the deferred backlog (diagnostics, toNumber, auth-settings split, observability no-store, coupons toFixed, V1-M27 docblock) is entirely still open, and two admin routes (tickets, alerts) missed the R122 MAX_PAGE deep-paging ceiling. One new money-adjacent find: the pricing recompute loop is non-transactional.

**Counts: P0: 0 · P1: 0 · P2: 3 · P3: 10**

---

## A. Verified-held (R124 + earlier fixes, re-verified at 09857fc with citations)

| # | Fix | Evidence at HEAD |
|---|-----|------------------|
| A-1 | Coupons compose the GENERATED body schema | `routes/coupons.ts:1,53` — `GeneratedCreateCouponBody.extend(...)`; hand-rolled twin deleted |
| A-2 | Swallowed catches now log | `admin/alerts.ts:126-129`, `admin/referrals.ts:195-200` — both `(req.log ?? logger)` + R124 comments |
| A-3 | Generic /api 404 no-store | `app.ts:939-940` |
| A-4 | R124 dead exports stay dead | `breadcrumbSubsystem`/`getCorrelationContext`/`authLogger`/`workerLogger` — zero hits repo-wide (only the R124 changelog comment at `lib/logger.ts:215`); spot-check of 6 new candidates found 0 dead exports |
| A-5 | `delivered_password` encryption (once P0) | encrypted at rest: `migrate.ts:2396-2409` (V1-M6 widen) + `:3761-3807` (V1-M7 encrypts legacy plaintext rows); decrypt-on-demand ONLY in `admin/orders.ts:326-413` (single-order, `order.credentials_view` audit awaited pre-respond, `recordCredentialsViewAndGate` 429 + deduped sweep alert, `decrypt_failed` honesty flag, router-level no-store); refunded rows nulled in the refund tx |
| A-6 | Money-mutation transaction discipline | topup approve: `topup.service.ts:260-551` (tx: in-tx exact-ref check + guarded status flip + balance UPDATE + ledger in-tx; 23505→409 mapping :558); topup reject: guarded single UPDATE (no money moves) `:640-654`; wallet adjustments: `adjustment.service.ts:172-244` (tx + CAS + idempotency key claimed INSIDE tx); loyalty convert: `loyalty.ts:167-204` (tx + fresh in-tx read + CAS); referral credit: `admin/referrals.ts:166-194` (tx + `WHERE status='pending'` flip + ledger); checkout inventory claim: `FOR UPDATE SKIP LOCKED` (`checkout.service.ts:257`, `manual.provider.ts:40`); wallet POST /topups: per-user advisory lock `wallet.ts:447` |
| A-7 | Idempotency coverage on money routes | 7 route keys: `wallet.topups.create` (wallet.ts:255), `loyalty.convert` (:101), `admin.topups.approve/reject` (topups.ts:144/:183), `admin.orders.bulk-status` (:437), `admin.users.patch` (:138), `admin.referrals.credit` (:138) |
| A-8 | External-call latency hygiene | Telegram: fire-and-forget `void dispatch` (telegram.ts:198/:211), `AbortSignal.timeout(5s)` :392, 2 attempts max, `retry_after` honored :414-427; OpenWA: 8s timeout `openwa.service.ts:637,654`; Sentry flush in the drain sequence (`server.ts:271-305`); Neon pool: 15-conn cap, 30s idle, 10s acquire, per-connection `statement_timeout`, TCP keepalives (`shared/db/src/index.ts:43-89`) |
| A-9 | Cron/jobs discipline | `jobs/cron.ts` — 12 schedules, every job own try/catch + `captureSchedulerFailure` with own job_name, UTC pinned, stop handles captured (:37-42); opportunistic maintenance: throttle + re-entry guard, fire-and-forget (`lib/opportunistic.ts:70-95`); leader lease w/ PG-advisory fallback (`web-scheduler.ts`, `boot-migrations.ts:519`); R5-era dedupe holding (stockWatcher DB-level dedupe :55-61, couponWatcher in-memory + DB dedupe :96-98) |
| A-10 | Rate limiting | 5 centralized limiters (`app.ts:511-683`): api 600/min/IP (CGNAT note), user 1200/min/user, auth 10/15min, whatsapp-start 20/15min, coupon-validate 10/min (enumeration guard, /56-IPv6-safe keyGen); mounts at :882-928; Arabic JSON messages everywhere; route-local ticket limiters (support.ts:106/:206) are per-user keyed — in-memory store acceptable under documented SINGLE_INSTANCE_MODE |
| A-11 | Sensitive-data logging | token LENGTHS only (`auth.ts:648,719`); pino redact single-source (`lib/logger.ts:39-62`); Sentry redacts OTP/token/code fields incl. over-redaction (`lib/sentry.ts:65,124`); `console.*` confined to seed/boot/metrics-fallback clusters (5 files, all justified) |
| A-12 | Admin no-store discipline | 31 of 32 admin route files set no-store (router-level middleware, 98-F3 pattern); the one partial file is finding B-8 |
| A-13 | Index coverage on hot lists | every traced filter has a matching index: orders status+created / user+created, topups status+created / user+created, users phone-trgm + created, auth_activity action + created, admin_alerts created-DESC + dedupe, tickets status+updated / user+created, risk_events created-id-DESC, referral_events referrer+created, products name-trgm + active+category, enrichment state+created (`shared/db/src/schema/*.ts:32,61-62,75-116,...`) — **zero missing indexes found** |
| A-14 | A1–A6 backend-side claims verified precisely | stats co-invalidation: `admin-stats-update` emitted ONLY from orders-bulk (`admin/orders.ts:568,703`) + topups (`topup.service.ts:201,619,685`) — no emit from tickets/users-wallet/products-stock/risk-label (the backend half of A4 B-3); SEO payload: GET projection `admin/products.ts:88-105` omits `seo_title/seo_description` while POST/PATCH write them (:232-233/:326-333); risk cursor: backend DOES return `next_cursor` + `limit+1` hasMore (`admin/risk.ts:191-214`) — frontend ignores it; referrals: `LIMIT 200` silent (`admin/referrals.ts:58`) + search filtered post-LIMIT in JS (:97-101) + stats/top-referrers full-table regardless of status filter (:60-79); security: fixed `.limit(100)`, no pagination/total (`admin/security.ts:65`); enrichment: `next_cursor` + `pending_count` returned honestly (`admin/enrichment.ts:74-95`) |

---

## B. Findings

### B-1. [P2] OpenAPI contract covers 35 of 105 admin-family endpoints — 70 absent, incl. every frontend-live alerts/tickets/risk/security/admins/settings surface
- **Evidence**: 69 paths in `shared/api-spec/openapi.yaml`, 24 admin-prefixed. Source-of-truth route sweep counts 105 admin-family endpoints (§C). Absent (70): admin/auth 8 of 9 (`verify-2fa`, `probe`, `session`, `logout`, `change-password`, `profile`, `2fa/setup`, `2fa/verify-setup`), `chart-data`, referrals list GET, products inventory GET + `inventory/set-count` + inventory POST, copilot settings GET+PATCH, tickets ×4, risk ×10, security ×3, settings GET, alerts ×9, admins ×6, observability ×6, diagnostics 9 of 10 (all but `inventory-health`), enrichment ×3, forecast ×2, `settings/auth` ×2. Plus 7 storefront: `logout-all-devices`, `providers/linked`, `providers/unlink`, `onboarding/complete`, `sessions/:id` DELETE, `metrics`, `cwv`.
- **Why it matters**: no generated zod/hooks (the frontend raw-fetches ~22 of these — A4's "12" counted only its page-level slice), no request/response contract pinning (the R123 21-endpoint contract suite can't grow), orval drift gate blind to ⅔ of the admin surface, and the risk writes' "local zod perimeter" (B-13) exists only because the spec lacks them.
- **Fix sketch**: batch-author by family — priority 1 = the frontend-live reads (tickets, alerts, security, chart-data, referrals list, enrichment list, observability summary family), priority 2 = risk family (kills B-13's perimeters), priority 3 = admins/settings/auth lifecycle. Each family: spec paths → regen → contract-suite rows.
- **Effort**: M per family (spec authoring dominates), L for all 70. **Risk**: low (additive spec + regen).

### B-2. [P2] Copilot error envelope ×47 still hand-rolled — byte-identical to R124's count, plus 2 auth-settings callback outliers
- **Evidence**: multiline-aware count at HEAD: `previews.ts` **31** (string-literal codes — `res.status(404).json({ error: "المعاينة غير موجودة", code: "COPILOT_PREVIEW_NOT_FOUND" })` :48,:52,:56,:88,:130,:134,:138,…), `draft.ts` **7** (inline `ErrorCode.COPILOT_*` objects), `ask.ts` **5** (inline ErrorCode objects :135,:145,:170,…), `settings.ts` **4** (3 string-literal). Only `history.ts` uses `createErrorResponse` (2 sites). All `COPILOT_*` members already exist in the `ErrorCode` enum (`shared/error-codes` :72-116) — the literals simply bypass it, so a typo compiles. Outside copilot: `auth-settings.ts:886,:937` return a nonstandard 3-field `{error, code: reason, reason}` telegram-callback shape.
- **Fix sketch**: mechanical swap to `createErrorResponse(msg, ErrorCode.X)` in the 4 copilot files — response bytes unchanged (helper returns `{error, code, details?}`, `details: undefined` is dropped by serialization); the 2 telegram-callback sites keep their extra `reason` field via `details` or stay as the documented exception.
- **Effort**: S (47 swaps, 5 files). **Risk**: low.

### B-3. [P2] Pricing recompute: non-transactional sequential per-variant UPDATE loop — mid-loop failure leaves mixed prices, and a 263-variant recompute pays 263 round-trips
- **Evidence**: `admin/pricing-config.ts:165-175` — `for (const c of changes) { await db.update(productVariantsTable)... }` with NO transaction; the `products.price` refresh (:179-191), `bumpCatalogCache()` (:204) and the audit row (:196) run only if the loop completes. A connection drop after k of N updates leaves N−k variants at old prices, no cache bump, no audit; the storefront serves `MIN(active variant price)` until a retry (the drift filter makes retry idempotent, so it self-heals — but the intermediate state is shopper-visible). Sequential awaits on Neon ≈ 1.3–4 s for the documented 263-variant case.
- **Fix sketch**: (minimal) wrap loop + products-price refresh + cache bump in `db.transaction`, keep the audit post-tx; (better) one `UPDATE ... FROM (VALUES (...))` statement for all variants, then the existing products refresh in the same tx.
- **Effort**: S (tx wrap) / M (single statement). **Risk**: low (dry-run path untouched; drift filter keeps idempotency).

### B-4. [P3] Backlog #2 open: `admin/diagnostics.ts` still the stale outlier — raw `req.body` typeof-guards + zero direct tests
- **Evidence**: `:334` (`typeof req.body?.name === "string"`) and `:360` (`req.body?.phone`) — the only route still reading bodies this way (the pattern risk.ts:81 documents as eliminated); repo-wide test search: no test file imports the router (only incidental mentions in `health-summary-wedge` / `secret-scan`). 411 lines.
- **Fix sketch**: local zod perimeter for the 2 writes (name/phone strings) + one route-level test file mirroring `admin-observability-single-mode.test.ts`. **Display/observability only — no session/pairing/restart behavior touched.**
- **Effort**: S. **Risk**: low.

### B-5. [P3] R122 MAX_PAGE ceiling missed two routes; `limitParam` adoption is 1 of 12
- **Evidence**: `admin/tickets.ts:61` and `admin/alerts.ts:40` (`parsePagination`) hand-roll `page` with floor-1 but NO 10 000 ceiling — `?page=100000000` × limit 200 → offset ~2×10¹⁰ (the exact abuse shape R122 fixed for orders/users/topups, `lib/http.ts:69-74`). Meanwhile `pageParam()` IS adopted at 8 sites (storefront orders/loyalty ×2/wallet ×2, admin orders/users/topups) and `limitParam()` at exactly 1 (`routes/orders.ts:120`) vs 11 hand-rolled identical idioms (admin forecast:55, topups:81, copilot/history:44, orders:214, tickets:58, users:34, risk:118, alerts:34, enrichment:75; wallet:200 + loyalty documented deliberately stricter — keep).
- **Fix sketch**: swap the 2 page sites to `pageParam()`; swap the byte-identical limit sites to `limitParam()` (http.ts's NOTE lists the intentional exceptions). **Effort**: S. **Risk**: ~zero.

### B-6. [P3] Backlog #3 open: `toNumber()` consolidation stalled at exactly R124's counts — 70 raw `parseFloat(String())` across 21 files
- **Evidence**: money paths: `topup.service.ts` ×6 (:140,:414,:415,:533,:604,:665), `refund.service.ts:158`, `checkout.service.ts:337/:360/:390`, `lib/pricing.ts:128/:195/:206`; cross-surface drift: `wallet.ts:723` formats `topup.amount` with `toNumber()` while `admin/topups.ts:118` maps the identical column with `parseFloat(String())`.
- **Fix sketch**: adopt at the 6 known-non-null topup.service sites + align the two amount-mapping sites; leave `lib/pricing.ts` documented-fallback parses. **Effort**: S/M (per-site null policy). **Risk**: low.

### B-7. [P3] Backlog #4 open: `auth-settings.ts` still the god-file — ~725 lines of Telegram auth-flow logic in a route file
- **Evidence**: 1,267 lines; `findOrCreateTelegramUser` (:416-521), `handleTelegramAuth` (:522-723), `handleTelegramWebAppAuth` (:724-1022), callback/CORS helpers (:1023-1141); 4 of the codebase's 8 `as any` casts (:144,:145,:173,:176). The firebase twin got a service (637-line `firebase-auth.service.ts`); telegram didn't.
- **Fix sketch**: extract the three flow functions to `services/telegram-auth-flow.ts` when next touched (not standalone). **Effort**: M. **Risk**: M (auth flows; only 3 CSRF/referral-gate route tests).

### B-8. [P3] Backlog #5 open: observability router no-store — 5 of 6 GETs unprotected
- **Evidence**: only `/metrics` sets no-store (`admin/observability.ts:163`); `/summary`, `/alerts/recent`, `/deploys/recent`, `/sentry/summary`, `/scheduler` (polled 15 s by the System tab) set nothing — the lone gap in the 31/32 admin file coverage (A-12).
- **Fix sketch**: lift the header to `router.use` (3 lines, same as risk/security/referrals/diagnostics do). **Effort**: S. **Risk**: zero.

### B-9. [P3] Backlog #6 open: coupons.ts toFixed→roundLyd — 1 money-math site
- **Evidence**: `:173` `+(order_amount - discountAmount).toFixed(2)` — `roundLyd(x)` is the pinned idiom (`lib/money.ts:20-23`, adopted by wallet/pricing/topup/pricing-config); `:160` `minOrder.toFixed(2)` is display formatting inside an Arabic 400 message ("59.80" padding is deliberate — keep or route through a `formatLyd` helper).
- **Fix sketch**: 1-line swap at :173. **Effort**: S. **Risk**: ~zero (identical for finite values).

### B-10. [P3] Backlog #7 confirmed: V1-M27 docblock claim "idx_products_archived never a leading predicate" is factually wrong
- **Evidence**: `migrate.ts:1691-1693`. `isArchived` is the SOLE/leading predicate in 3 queries: `admin/products.ts:117` (the no-search branch of the admin products list — `eq(isArchived,false)` alone), `copilot/tools/read.ts:70` (`status==="archived"` filter), `jobs/stockWatcher.ts:145` (archived-units sweep). It appears as a predicate in ~20 queries across 10 files (seo ×2, products ×6, admin/products ×2, pricing-calculator, checkout, forecast-store, copilot read ×3, stockWatcher ×2, app.ts). The DROP itself stays defensible via the docblock's own parenthetical (near-zero selectivity on an almost-always-false boolean) — only the stated rationale is wrong.
- **Fix sketch**: docblock edit only — replace the rationale with the selectivity argument + the 3 leading-predicate citations. **Effort**: S. **Risk**: zero.

### B-11. [P3] security `/auth-stats/summary`: 4 sequential full-table `count(*)` queries where 1 FILTER query does
- **Evidence**: `admin/security.ts:83-117` — total, success, failure, last24h as 4 separate awaited `db.select count(*)` round-trips. `/auth-stats` (:70-81) full-table GROUP BY is small-cardinality (fine).
- **Fix sketch**: one `SELECT count(*) FILTER (WHERE success), count(*) FILTER (WHERE success = false), count(*) FILTER (WHERE created_at >= ...) FROM auth_activity` — 4 round-trips → 1. **Effort**: S. **Risk**: low.

### B-12. [P3] Route-level test thin spots map to the OpenAPI-absent families
- **Evidence**: `admin/forecast.ts` (2 endpoints) — ZERO route tests (service tier has 4 in `services/forecast/__tests__`); `admin/diagnostics.ts` — 0 (B-4); `admin/security.ts` — validation-only (`body-schema-400s`); `admin/risk.ts` — config-only of 10 endpoints (events list/label/bulk-label/dashboard/synth uncovered at route level); `admin/alerts.ts` — `/new` + `/test` covered, 7 of 9 endpoints not; `admin/settings.ts` GET — incidental. Suite shape otherwise healthy: 223 files (routes 68+15, lib 46+2, services 45+4+4+1, jobs 29, src 7, backend/tests 4 worker-tier), uniform kebab-`.test.ts`, per-file DB isolation, R123 contract suite pins the 21 spec'd endpoints.
- **Fix sketch**: author route tests alongside each B-1 family spec (the contract suite grows for free); forecast + diagnostics first (zero-coverage files). **Effort**: M. **Risk**: none (tests only).

### B-13. [P3] Hand-rolled zod perimeters / raw body casts — the R124-A9 #3 remainder
- **Evidence**: local `z.object` perimeters: `admin/risk.ts` ×5 (:90-:112, documented "absent from OpenAPI"), `support.ts` ×2 (:35,:39), `admin/pricing-calculator.ts:62`; raw casts/typeof-guards: `auth.ts:224` (providers/unlink), `:512` + `:675` (firebase session/refresh — `AuthFirebaseSessionBody`/`AuthFirebaseRefreshBody` already generated), `admin/diagnostics.ts:334/:360` (B-4), `admin/users.ts:146` (PATCH battery — thorough but pre-R120 style; bounded, finance-gated, CAS-tx — money discipline is fine, only style debt).
- **Fix sketch**: rides B-1's regen (risk/support/pricing-calculator bodies into spec → import generated; 2-line swap for the firebase bodies today). **Effort**: M (after B-1), S (firebase bodies alone). **Risk**: low.

---

## C. Route inventory (source of truth at 09857fc)

**Storefront + infra** (mounted at `/api`; apiLimiter 600/min/IP unauth + userLimiter 1200/min/user unless noted; user-data GETs carry no-store):

| File | Prefix | Routes | Guards | Body validation | Extra rate limit | Cache | OpenAPI |
|---|---|---|---|---|---|---|---|
| health.ts | /healthz* | 9 GET | public by design | n/a | skipped (probe budget) | probe-shaped | ✅ /healthz |
| metrics.ts | /metrics | 1 GET | requireMetricsAuth (bearer) | n/a | outside /api limiters | — | ❌ (infra) |
| cwv.ts | /cwv | 1 POST | beacon token | cwvBodyParser | — | — | ❌ (infra) |
| seo.ts | /robots.txt, /sitemap.xml | 2 GET | public | n/a | — | cacheable (deliberate) | ❌ (non-API, fine) |
| telegram-webhook.ts | /webhook/telegram | 1 POST | secret-token timingSafeEqual | parsed payload | — | — | ✅ |
| auth.ts | /auth | 11 | requireUser ×7, public ×4 (probe, firebase ×2, logout? no—login flows) | raw casts ×3 (B-13) | authLimiter on firebase ×2 | no-store on 4 sensitive GETs | ✅ 12 paths; ❌ 5 endpoints (B-1) |
| auth-whatsapp.ts | /auth/whatsapp | 2 POST | public (OTP) | typeof guards | whatsappStart 20/15m + auth 10/15m | POSTs (uncacheable) | ✅ both |
| auth-settings.ts | /auth + /admin/settings/auth | 4 public + 2 admin | requireAdmin+settings on admin router | dynamic zod builder (PATCH); initData verify (flows) | authLimiter on /auth/telegram | — | ✅ public 4; ❌ admin 2 (B-1) |
| products.ts | /products | 5 GET + 2 aliases | public | query-only | — | catalogCache s-maxage=60 | ✅ all |
| orders.ts | /orders | 3 | requireUser | generated zod | — | no-store | ✅ |
| wallet.ts | /wallet | 5 | requireUser | generated zod + 9-field battery | — | no-store | ✅ |
| loyalty.ts | /loyalty | 4 | requireUser | local (convert body) | — | no-store | ✅ |
| support.ts | /support/tickets | 4 | requireUser | local zod ×2 | ticket-create 5/h, reply 5/h (in-memory, per-user) | no-store | ✅ |
| notifications.ts | /notifications | 3 | requireUser | — | — | no-store | ✅ |
| coupons.ts | /coupons | 5 | requireUser (validate) + requireAdmin+finance ×4 | generated zod (composed, A-1) | couponValidate 10/min | no-store | ✅ |
| cart.ts | /cart | 5 | requireUser | local | — | no-store | ✅ |

**Admin family** (all behind `protectedRouter.use(requireAdmin)` + per-scope `requirePermission` at mount, `admin/index.ts:38-131`; all no-store except observability B-8; all ride apiLimiter/userLimiter):

| File | Routes | Scope gate | Body validation | Pagination idiom | OpenAPI |
|---|---|---|---|---|---|
| admin/auth.ts | 9 | own requireAdmin ×7; login/verify-2fa/probe public | generated zod (login) | — | ❌ 8 of 9 (B-1) |
| admin/stats.ts | 2 | own requireAdmin | — (query) | 30s cacheWrap | ✅ stats; ❌ chart-data |
| admin/orders.ts | 3 | orders | generated zod (bulk-status) | limitParam-class clamps + pageParam ✅ | ✅ 3 |
| admin/topups.ts | 3 | finance | local zod (action body) | clamps + pageParam ✅ | ✅ 3 |
| admin/users.ts | 2 | users (+finance on money writes) | typeof battery (B-13) | clamps + pageParam ✅ | ✅ 2 |
| admin/referrals.ts | 2 | users (+finance on credit) | — (id in path) | LIMIT 200 fixed (A-14) | ❌ list; ✅ credit |
| admin/tickets.ts | 4 | support | local zod (reply) | clamps but ❌ pageParam (B-5) | ❌ 4 (B-1) |
| admin/products.ts | 7 | inventory | generated zod | LIMIT 200 cap | ✅ 4; ❌ inventory ×3 |
| admin/product-variants.ts | 4 | inventory | local zod | — | ✅ 4 |
| admin/pricing-calculator.ts | 1 | inventory | local zod | — | ✅ |
| admin/pricing-config.ts | 3 | inventory | local zod (config PUT) | — | ✅ 3 |
| admin/flash-sales.ts | 4 | inventory | local zod | — | ✅ 4 |
| admin/forecast.ts | 2 | inventory | — | limit clamp | ❌ 2 (B-1) |
| admin/enrichment.ts | 3 | inventory | — | limit 1-50 + cursor ✅ | ❌ 3 (B-1) |
| admin/risk.ts | 10 | users | local zod ×5 (B-13) | cursor + limit+1 hasMore ✅ | ❌ 10 (B-1) |
| admin/security.ts | 3 | admins | — | fixed limit 100 (A-14) | ❌ 3 (B-1) |
| admin/settings.ts | 1 | settings | — | — | ❌ (B-1) |
| admin/alerts.ts | 9 | support | — | hand-rolled limit+page ❌ pageParam (B-5) | ❌ 9 (B-1) |
| admin/admins.ts | 6 | admins | local zod | — | ❌ 6 (B-1) |
| admin/observability.ts | 6 | settings | — | — | ❌ 6 (B-1) |
| admin/diagnostics.ts | 10 | settings | typeof guards ×2 (B-4) | inventory-health cap 500 | ✅ 1; ❌ 9 |
| copilot/ask.ts | 1 POST | own scope gate | local zod (msg) | — | ✅ |
| copilot/draft.ts | 1 POST | own | local | — | ✅ |
| copilot/previews.ts | 4 | own | local | — | ✅ 4 |
| copilot/history.ts | 1 GET | own | — | limit clamp | ✅ |
| copilot/settings.ts | 2 | own | local zod | — | ❌ 2 (B-1) |

**Totals**: 105 admin-family endpoints, 35 spec'd, **70 absent**. Storefront: ~66 endpoints, 7 absent (5 auth lifecycle + 2 infra). Query-efficiency verdicts: LIMIT discipline good on every list (clamps 50-200, OFFSET+pageParam with R122 ceiling except B-5; risk = the only cursor-paginated list, done correctly); count(*) strategies honest (no fake totals; alerts the only total envelope); N+1: none found in JS loops on hot paths (storefront aggregates ride subquery joins `products.ts:375-398`; stockWatcher grouped COUNT `:42`; R118 batched the bulk-status notifications insert `admin/orders.ts:126-177`); the 2 real await-in-loop sites are bulk refund (deliberate per-order atomicity, partial failures surfaced) and pricing recompute (B-3).

## D. Priority counts

| P0 | P1 | P2 | P3 | Total |
|----|----|----|----|-------|
| 0 | 0 | 3 | 10 | 13 |

P2: B-1 OpenAPI 70-endpoint blind spot · B-2 copilot envelope ×47 · B-3 pricing recompute non-tx.
P3: B-4 diagnostics · B-5 pageParam/limitParam stragglers · B-6 toNumber 70 · B-7 auth-settings split · B-8 observability no-store · B-9 coupons roundLyd · B-10 V1-M27 docblock · B-11 auth-stats FILTER · B-12 test thin spots · B-13 zod perimeter remainder.

## E. Suggested fix order (smallest-complete-change × leverage)

1. **One-liner batch** (S, one commit): B-5 pageParam ×2 + limitParam swaps · B-8 no-store lift · B-9 roundLyd · B-10 docblock · B-11 FILTER counts.
2. **B-2 copilot envelope** (S): 47 mechanical swaps, enum-typoes become compile errors, byte-identical responses.
3. **B-3 pricing recompute tx wrap** (S→M): money-adjacent atomicity before the next pricing push.
4. **B-4 diagnostics** (S): zod perimeter ×2 + first route test file (also closes half of B-12's zero-coverage list).
5. **B-1 first family** (M): tickets + alerts + security + chart-data specs → regen → contract rows (kills most frontend raw-fetch sites + seeds B-12 tests + B-13 for risk in family 2).
6. **B-6 toNumber money-path sites** (S/M) · **B-7 auth-settings split** (M, when next touched) · **B-13** rides B-1 regen.

**Explicitly NOT recommended** (recorded to prevent churn): splitting wallet POST /topups (R124-A9 #9 verdict re-confirmed at HEAD) · renaming schema/jobs naming drift (R124-A9 #12) · collapsing the 71 auth-request casts (R124-A9 #15) · any WhatsApp/OpenWA session/pairing/restart logic change (standing order) · auth.ts firebase zod swap before the generated bodies are confirmed byte-compatible with the typeof battery (do it inside B-1 family 3).
