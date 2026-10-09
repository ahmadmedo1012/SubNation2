# A9 — Backend Code Organization & Consistency Audit (R124)

- **Agent**: R124-A9 (READ-ONLY audit; only this report file created)
- **Repo state**: `main @ c736d13`, clean tree
- **Scope**: `backend/src/**` (422 ts files, 59,061 non-test LOC), `shared/db/src/**`, `shared/api-zod`, `shared/api-spec`, `shared/error-codes`
- **Method**: static analysis only — ripgrep sweeps, per-file line inventories, export-vs-reference dead-code scan (backend + frontend + scripts + shared), no tests executed
- **Exclusions honored**: inventory/catalog/restock behavior and WhatsApp pairing logic untouched and not proposed for refactoring (wallet POST /topups split explicitly recommended AGAINST — see #9)

## Executive summary

The backend is in **unusually good organizational shape** for its size: file-per-resource routes with an `admin/` subtree permission-gated at mount time, single-source auth middlewares, a central error handler with a shared Arabic envelope, fully centralized rate limiting, zero TODO/FIXME markers, zero `@ts-ignore`, zero thrown strings, and zero empty `catch {}`. The real issues are **consistency debt, not structural debt**: a duplicated coupon body schema (shared contract vs hand-rolled local), the copilot route family bypassing the shared error envelope (47 sites, 3 sub-styles), stalled adoption of both the `toNumber()` money helper (70 raw `parseFloat(String())` remain) and the generated `@workspace/api-zod` request schemas (5 route files import them out of ~25 that validate bodies), one stale outlier module (`admin/diagnostics.ts` — 411 lines, zero test imports, pre-R120 validation style), and ~40 lines of verified-dead exports. No P0/P1. Nothing here blocks a release; every fix is small, local, and mechanical.

**Counts: P0: 0 · P1: 0 · P2: 7 · P3: 9**

---

## Findings

### 1. [P2] `CreateCouponBody` exists twice — generated contract schema has ZERO importers, route hand-rolls a divergent copy
- **Evidence**: `shared/api-zod/src/generated/api.ts:1294` exports `CreateCouponBody` (from `shared/api-spec/openapi.yaml`); `backend/src/routes/coupons.ts:34` defines its **own local** `CreateCouponBody` (+ `PatchCouponBody` :50, `ValidateCouponBody` :69). Repo-wide search for the generated symbol: only `coupons.ts:34` (the local one) matches — the generated schema is imported **nowhere** (backend, frontend, or scripts).
- **Drift already visible**: local copy has `.trim()` on code/description, an `ISO_DATE` regex + `refine` on `expires_at`, and `value.max(10_000)`; the generated copy has none of the trim/regex/refine semantics. Two sources of truth for a money-adjacent write body (fixed-coupon value is a direct wallet-debit magnitude at checkout).
- **Minimal fix**: align `openapi.yaml` to the local (stricter) semantics → regenerate → `import { CreateCouponBody } from "@workspace/api-zod"` in coupons.ts and delete the local block (~45 lines net deletion). Alternative (ponytail-cheaper): delete the unused spec side if the coupon bodies are deliberately handler-owned.
- **Impact**: today the OpenAPI contract documents a *weaker* body than the route enforces — the R123 response-contract suite cannot pin this endpoint's request shape; any future regeneration drift stays invisible.

### 2. [P2] Copilot route family bypasses the shared error envelope — 47 hand-rolled `{error, code}` bodies in 3 different sub-styles
- **Evidence**: 339 error responses across routes use `createErrorResponse()`; **49** hand-roll `res.status(n).json({ error: …, code: … })`. 47 of the 49 are the copilot family:
  - `routes/admin/copilot/previews.ts`: **31** sites with **string-literal** codes (`{ error: "المعاينة غير موجودة", code: "COPILOT_PREVIEW_NOT_FOUND" }` at :48, :52, :56, :88, :130, …)
  - `routes/admin/copilot/settings.ts`: 4 sites (3 string-literal)
  - `routes/admin/copilot/ask.ts`: 5 sites (inline `{error, code: ErrorCode.X}` objects, e.g. :135, :145)
  - `routes/admin/copilot/draft.ts`: 7 sites (inline objects referencing `ErrorCode.COPILOT_*`, e.g. :57, :64)
  - Only `routes/admin/copilot/history.ts:72` uses `createErrorResponse`.
- The `ErrorCode` enum in `shared/error-codes` **already contains** all `COPILOT_*` members — previews.ts/settings.ts simply don't use it, so a typo'd literal compiles fine.
- **Minimal fix**: mechanical swap to `createErrorResponse(msg, ErrorCode.X)` in previews.ts + settings.ts (34 sites, response bytes unchanged: same `{error, code, details?}` shape); ask.ts/draft.ts keep semantics, just route through the helper.
- **Impact**: enum-typed codes (compile-time typo protection), uniform `details` handling, and one envelope contract for the whole API surface the frontend's `getErrorMessage` maps.

### 3. [P2] Generated request-schema adoption is thin — 5 of ~25 body-validating route files consume `@workspace/api-zod`; the rest hand-roll local perimeters or typeof-guards
- **Evidence**: importers of `@workspace/api-zod` in routes: `orders.ts`, `wallet.ts`, `health.ts`, `admin/auth.ts`, `admin/products.ts` (5 files). Hand-rolled instead:
  - 10 inline `z.object` bodies: `admin/risk.ts` ×5 (:90, :95, :101, :108, :545 — documented "Local zod perimeter" because the risk admin writes are **absent from the OpenAPI spec**), `support.ts` ×2 (:35, :39), `coupons.ts` ×3, `admin/pricing-calculator.ts` (:62)
  - Manual cast-then-typeof-guards: `auth.ts:224` (`req.body as {provider?: string…}` + typeof battery), `auth.ts:512`/`:675` (firebase session/refresh — **`AuthFirebaseSessionBody`/`AuthFirebaseRefreshBody` already exist in generated api.ts**), `admin/diagnostics.ts:334/:360` (raw `req.body?.name` typeof reads)
- **Minimal fix**: (a) extend `openapi.yaml` with the missing admin/risk + support write bodies, regenerate, import; (b) switch `auth.ts:512/:675` to the already-generated firebase bodies. Do **not** rewrite the documented handler-extended rules (wallet's conditional battery) — only replace the pure-type perimeters.
- **Impact**: request-body parity with the R123 response-contract suite; kills the "two validation truths" class before it multiplies. The 21-endpoint R123 suite has no request-body twin — this is the gap.

### 4. [P2] `routes/admin/diagnostics.ts` is the stale outlier module: zero test coverage + pre-R120 validation style
- **Evidence**: 411 lines, exports `adminDiagnosticsRouter` (mounted at `admin/index.ts:125` behind `requirePermission("settings")`). Repo-wide test search: **no test file imports it** — the only route module mounted in production with no direct test file (next-closest: copilot `ask/draft/previews/settings` routes are covered indirectly via `admin-no-store-stragglers.test.ts` + service tests; diagnostics has neither). Also the **only** route still reading raw `req.body?.name` / `req.body?.phone` with typeof guards (:334, :360) — the exact pattern `admin/risk.ts:81` documents as eliminated elsewhere in R120-B6/A6-F8.
- **Minimal fix**: add one route-level test file mirroring `admin-observability-single-mode.test.ts` (whatsapp-sessions + inventory-health endpoints are already import-safe); migrate the 2 raw body reads to a local zod perimeter in the same pass.
- **Impact**: the admin diagnostics surface (WhatsApp session inspection, sentry-debug, inventory-health) currently ships untested; validation style debt concentrated in exactly the untested file.

### 5. [P2] `toNumber()` money-helper consolidation stalled: 70 raw `parseFloat(String(...))` copies remain, and the same column converts differently on different surfaces
- **Evidence**: `lib/numeric.ts` was created (round-3) explicitly to replace this idiom ("appeared 40+ times… the most repeated money idiom in the repo"). Current counts: `toNumber(` ×17 vs `parseFloat(String(` ×**70** (non-test). Money-path examples: `services/topup.service.ts` ×6 (:140, :414, :415, :533, :604, :665), `services/refund.service.ts:158`, `services/checkout.service.ts:337/:360/:390`, `lib/pricing.ts:128/:195/:206`. Cross-surface inconsistency on the **same column**: `routes/wallet.ts:723` formats `topup.amount` with `toNumber()` while `routes/admin/topups.ts:118` maps the identical column with `parseFloat(String(...))`.
- **Caveat (why it stalled)**: semantics differ — `toNumber(null/""/garbage) → 0`, `parseFloat(String(null)) → NaN`. Adoption must be per-site, preserving each call's null policy.
- **Minimal fix**: adopt `toNumber()` at the sites where the value is known non-null (the 6 topup.service sites read rows just inserted/selected — safe), and make `wallet.ts`/`admin/topups.ts` use the same helper for `wallet_topups.amount`. Leave the deliberate `lib/pricing.ts` parse sites (they document fallback behavior) until touched.
- **Impact**: one money-conversion policy (the M1 "Infinity corrupts a wallet row" class the helper's docstring cites); identical output for the identical column across user/admin surfaces.

### 6. [P2] Verified dead exports: 4 symbols, ~40 deletable lines (each grep-verified across backend + frontend + scripts + shared, incl. tests)
- **Evidence**:
  - `lib/sentry.ts:545` `breadcrumbSubsystem()` — zero callers anywhere (referenced only by its own docstring at :33)
  - `lib/correlation.ts:83` `getCorrelationContext()` — zero callers (sibling `getCorrelationId` **is** used; the ALS store accessor was never consumed)
  - `lib/logger.ts:215` `authLogger()` and `:219` `workerLogger()` — zero callers (the other two convenience loggers, `alertingLogger`/`cwvLogger`, ARE used by `services/alerting.service.ts:43` and `routes/cwv.ts:3`; `childLogger` is used internally but its **export** keyword has no external consumer)
  - `lib/session.ts:7` `SESSION_TTL_MS` — used internally at :46; the `export` keyword has no external consumer
- **Not dead** (verified against the initial candidate list): copilot tool arrays (`READ_TOOLS`/`DRAFT_TOOLS`/`OPERATIONAL_TOOLS`/`DIRECT_TOOLS` — consumed via `*ForScopes` wrappers in `ask.ts:42-57`), `cacheGet` (internal + tests), `runInspection` (scripts/inspect.ts), all `__reset*ForTests` fixtures (test-only by design).
- **Minimal fix**: delete the two functions + two logger helpers (and the dead `export` keyword on `SESSION_TTL_MS`/`childLogger`). One commit, zero behavior.
- **Impact**: −40 lines; removes "why does this exist" friction in the two most-imported modules in the codebase.

### 7. [P2] Two swallowed catches on admin surfaces — 500s returned with no error log
- **Evidence**: `routes/admin/alerts.ts:126` (`catch {` → `res.status(500).json(...)` for `/unread-count` — no `err` binding, no log) and `routes/admin/referrals.ts:194` (`catch {` → 500 for the points-credit tx — no log). These are the only two catch blocks in the entire routes tree that neither log nor intentionally swallow with a documented fallback (16 bare `catch {}` total; the other 14 are documented fallback semantics — health degraded-state, probe-200-false, JSON.parse guards, constant-time-compare).
- **Minimal fix**: 2 lines — `catch (err) { req.log.error({ err }, "..."); … }` (alerts.ts already uses the `(req.log ?? logger)` fallback idiom at :116 for bare-router test mounts).
- **Impact**: restores the "every 500 tells you why in logs" invariant the other 78 route catch blocks maintain.

### 8. [P3] `routes/auth-settings.ts` is the god-file: 1,267 lines carrying 4 unrelated responsibilities
- **Evidence**:
  1. Provider metadata + masked-config rendering (:52-:213)
  2. **~600 lines of Telegram auth-flow business logic in a route file**: `findOrCreateTelegramUser` (:416), `handleTelegramAuth` (:522), `handleTelegramWebAppAuth` (:724) — user creation, referral codes, session minting, replay-claim, risk emission
  3. Telegram callback CORS/same-origin helpers (:1023-:1141)
  4. Admin provider-settings router + dynamic zod schema builder (:1143-:1267)
- Also holds 4 of the codebase's 8 real `as any` casts (:144, :145, :173, :176 — raw `db.execute` row typing).
- **Minimal fix** (when next touched, not as a standalone refactor): extract the three Telegram flow functions to `services/telegram-auth-flow.ts` (they already only depend on lib/ + db), keep both routers in the route file. The sibling `services/firebase-auth.service.ts` (637 lines) is the template — firebase got a service, telegram didn't.
- **Impact**: the file is the #1 route-module size outlier (next: admin/auth.ts 971); the auth flows are the least-testable code in it (covered only via 3 CSRF/referral-gate route tests).

### 9. [P3] `wallet.ts` POST /topups is a 468-line fat handler — but recommend ACCEPTED DEBT, do not split
- **Evidence**: `routes/wallet.ts:250-718`: schema parse + 9-field manual validation battery + durable-idempotency replay + advisory-lock transaction with 3 dedup layers + auto-reject heuristic + Telegram approval-card construction + notify + risk emit, in one closure. The approval twin lives in `services/topup.service.ts` (713 lines) — creation stayed in the route.
- **Judgment**: **split-or-acceptable → acceptable.** The money-invariant docs (`docs/FINAL_MONEY_INVARIANTS.md` M2/M3) cite exact line numbers into this handler; every recent round (B2-F2, B4-R1, R104, R108) surgically patched it, and the R117 worklog shows what cite-drift costs when this file moves. Moving it now buys organization points at real regression risk on the highest-stakes money path. Revisit only when the next behavioral change touches it (extract `submitTopup()` into topup.service.ts then, with the test battery as the net).
- **Impact**: recorded so future rounds don't re-litigate; the handler is long but linear, commented per guard, and fully covered (`wallet-topups*.test.ts` ×5).

### 10. [P3] try/catch→500 duplication: ~80 route catch blocks largely re-implement the central error handler
- **Evidence**: central handler at `app.ts:1647` already logs (`logger.error` + full err) and returns the standard 500 envelope. Routes still wrap handlers in their own try/catch + log + 500: `admin/alerts.ts` ×9 (8 of them redundant — identical shape `catch (err) { req.log.error({err}, …); return res.status(500).json(createErrorResponse("خطأ", …)) }`), `health.ts` ×11 (justified — custom degraded shapes), `admin/diagnostics.ts` ×8, `auth.ts` ×8 (justified — specific messages).
- **Minimal fix (ponytail)**: in `admin/alerts.ts` only, drop the try/catch and let the central handler take over (~30 lines deleted, response body changes only from `"خطأ"` to the central `"خطأ في الخادم..."` — both `INTERNAL_ERROR`-coded; needs a one-line test update in the alerts tests). Other files: leave alone (their catches carry route-specific messages).
- **Impact**: demonstrates the pattern; the central handler is already the right shape (Sentry captures upstream — see its :1642 note).

### 11. [P3] Oversized files: 28 files > 500 lines (non-test) — top 5 split-or-acceptable judgment
| File | LOC | Judgment |
|---|---|---|
| `src/migrate.ts` | 3,981 | **Acceptable as ledger** — 30 append-only `apply*Stage` functions, each individually tested (`jobs/__tests__/migrate-v1m*.test.ts`). It is 6.7% of the backend in one file; a `migrations/` dir with one file per stage would halve merge-conflict surface, but the append-only pattern is deliberate and boot-migrations.ts consumes it whole. Split opportunistically, never mid-stage. |
| `src/app.ts` | 1,740 | **Split candidate** — mixes security/helmet/CORS/CSRF config, limiter mounts, **and ~700 lines of SPA-shell + OG share-card HTML rewriting** (:944-:1640: `SPA_SHELL_HTML`, `rewriteMetaTag`, `buildShareDescription`, product lookup). The share-card block is a self-contained rendering concern → `lib/share-card.ts` (it already only depends on db + lib). Rate-limiter block (:485-:673) could follow to `lib/limiters.ts`. |
| `services/openwa.service.ts` | 1,532 | Acceptable — single concern (WhatsApp gateway client), 6 dedicated test files, recent R117 hardening; splitting would churn the settle-gate invariants. |
| `routes/auth-settings.ts` | 1,267 | **Split** — finding #8. |
| `lib/socket.ts` | 1,146 | Acceptable — single concern (Socket.IO server: auth handshake, rooms, connection caps), heavily tested (socket-*.test.ts ×5). |

(Remainder >500: alerting.service 1,078, whatsapp-otp.service 999, admin/auth 971, health 951, auth 872, admin/risk 864, admin/products 845, products 802, checkout.service 792, boot-migrations 764, admin/orders 747, wallet 736, audits/neon-audit 727, topup.service 713, copilot/admin-direct 703, copilot/tools/read 682, firebase-auth.service 637, telegram.ts 619, sentry 589, scheduler-coordinator 578, audits/context7-audit 561, test/db 555, inspection-runner 544 — all single-concern or test infrastructure; none flagged.)

### 12. [P3] Naming-convention drift across five dimensions (all cosmetic; rename only on touch)
- **Evidence**:
  - `jobs/`: 4 camelCase files (`stockWatcher.ts`, `couponWatcher.ts`, `flashSaleWatcher.ts`, `alertLogger.ts`) among 15 kebab-case (`forecast-runner.ts`, `session-prune.ts`, …)
  - `services/` root: `.service.ts` suffix on 12 files but `whatsapp-watch.ts` breaks it; subpackages (`copilot/`, `enrichment/`, `forecast/`, `providers/`) use no suffix
  - `shared/db/src/schema/`: kebab-case (`admin-sessions.ts`, `product-variants.ts`, `idempotency-keys.ts`, `account-link-consents.ts`, `scheduler-leader-lease.ts`, `provider-fulfillments.ts`) mixed with snake_case (`admin_alerts.ts`, `wallet_topups.ts`, `users.ts`, …) — two conventions in one 38-file dir
  - admin mount style: path-in-leaf (`users.ts` defines `/users`, `orders.ts` `/orders`, `topups.ts` `/topups`, mounted at `/`) vs path-at-mount (`alerts.ts`, `admins.ts`, `settings.ts`, `observability.ts`, `diagnostics.ts` define relative paths, mounted at `"/alerts"` etc. — `admin/index.ts:34-131`)
  - risk modules split across layers: `lib/risk-{dsl,emit,aggregate,metrics}.ts` + `services/risk-{scoring,rules,alerts,config-cache}.service.ts`; plus `telegram.ts`/`notify.ts`/`instrument.ts` at `src/` root instead of `lib/`
- **Minimal fix**: none now (renames churn tests + imports for zero behavior); adopt "kebab-case + suffix-less" for any NEW file and converge the schema dir's 6 kebab files to snake_case (the majority) the next time a schema file is touched.
- **Impact**: pure consistency; documented so the next round doesn't rediscover it.

### 13. [P3] Test placement split: admin route tests live in two different `__tests__` trees; 4 integration tests outside `src/`
- **Evidence**: 14 `admin-*.test.ts` files in `routes/__tests__/` (e.g. `admin-flash-sales.test.ts`, `admin-risk-config.test.ts`) vs 15 in `routes/admin/__tests__/` (e.g. `admin-product-seo-fields.test.ts`, `2fa-totp-encryption.test.ts`) — same kind of tests, two homes. Plus `backend/tests/` (root) holds 4 worker/scheduler integration tests (`worker-sigterm`, `scheduler-leadership-retry`, …) outside the `src/**/__tests__` convention. Naming itself is uniformly kebab `.test.ts` (223 files, zero `.spec.ts`) — good.
- **Minimal fix**: `git mv` the 14 `routes/__tests__/admin-*.test.ts` files into `routes/admin/__tests__/` (import paths are `../../` → `../` mechanical); leave `backend/tests/` (worker-tier integration differs genuinely).
- **Impact**: `routes/admin/__tests__` becomes the single place to see which admin surfaces are tested — directly serves finding #4's gap-hunting.

### 14. [P3] Type-safety outliers: all 15 unsafe-`any` spots live in exactly 3 files; money fields clean
- **Evidence**: 8 real `as any` casts (comments excluded): `lib/db-instrumentation.ts` ×3 (:116, :181, :209 — driver monkey-patching, eslint-disable'd), `lib/body-parser-recovery.ts:80`, `routes/auth-settings.ts` ×4 (raw `db.execute` rows). 7 `: any` **parameter annotations**, all in `routes/health.ts` (:118, :133, :151, :180, :328, :394, :449 — the redis client param; `lib/redis-client.ts` exports no client type alias to import). 33 `as never` (mostly pg-enum narrowing in risk/copilot — the documented `risk.ts:126` idiom), 108 `as unknown as` (drizzle `tx` casts dominate). **Zero** `@ts-ignore`/`@ts-expect-error`, zero eslint-disable outside the 4 justified instrumentation spots, and **zero unsafe casts on money fields** (conversions all go through `parseFloat(String())`/`toNumber()`/`roundLyd*`).
- **Minimal fix**: export `type RedisClient` from `lib/redis-client.ts` and use it in health.ts's 7 signatures; type the auth-settings `db.execute` rows like `routes/admin/risk.ts` does (zod perimeter or a typed `extractRows`).
- **Impact**: takes the codebase from "3 files hold all the anys" to effectively zero; health.ts is also the file most newly-copied checks will paste from.

### 15. [P3] Logging hygiene: console.\* confined to justified fallbacks, but two conventions coexist
- **Evidence**: 11 `console.*` in non-test src: `lib/sentry.ts` ×5 (boot-time, before logger exists — fine), `lib/metrics.ts` ×5 + `services/alerting.service.ts` ×2 (metric-increment failure fallbacks — logger→metrics→logger recursion avoidance, defensible but undocumented in metrics.ts). Structured logging is otherwise excellent: 233 `category:`-tagged lines, correlation IDs via ALS, redaction pinned by tests. Two logger-access conventions coexist: the `logger` singleton (everywhere) vs `alertingLogger()`/`cwvLogger()` **factory-per-call** helpers (`lib/logger.ts:215-228` — each call mints a new child; 2 of the 4 helpers are dead, see #6) vs `req.log` (pino-http, 10 route sites, with the `(req.log ?? logger)` bare-router fallback idiom). 71 `req as AuthenticatedRequest`/`as AdminAuthenticatedRequest` casts (35+36) could vanish via Express declaration-merging, but the current per-route cast is a deliberate runtime-narrowing choice — not recommended to churn.
- **Minimal fix**: add the one-line recursion-rationale comment to `lib/metrics.ts:340`; delete the 2 dead helpers (#6). Nothing else.
- **Impact**: documents the two defensible console clusters so future rounds stop flagging them.

### 16. [P3] No circular dependencies — but 3 layering inversions worth recording
- **Evidence**: full import sweep: `middlewares → services` (risk-soft-block.ts:55, risk-hard-block.ts:53 → risk-config-cache; requireCopilotPhase.ts:13 → copilot/phase-flags — acyclic, fine), `lib → services` runtime edges: `lib/web-scheduler.ts:88` (→ alerting.service) and `lib/risk-emit.ts:28` (→ risk-scoring.service) — both verified acyclic (no back-edge); `lib/socket.ts:91` imports `__testables` from `middlewares/cloudflareClientIp` (a lib→middleware edge that exists only for a test export). `lib/audit.ts:21` + `lib/permissions.ts:3` import only `type` from middlewares (erased at runtime). No `services → routes`, no `jobs → routes`, no route↔service cycle anywhere.
- **Minimal fix**: none required; if touched, move `cloudflareClientIp`'s testable helper into lib and re-export from the middleware (deletes the inverted edge).
- **Impact**: the import graph is sound; recording the 3 inversion points prevents future "why does lib import services" confusion.

---

## VERIFIED-OK (no action)

- **Route organization**: file-per-resource, kebab-case, coherent `admin/` subtree with `requirePermission` gates applied at mount (`admin/index.ts:38-131`), copilot nested one level deeper with its own index — no orphan routes, no path collisions, no legacy/deprecated files, no `.bak`/`.old` copies anywhere.
- **Middleware reuse**: auth is single-source — `requireUser`/`requireAdmin`/`requirePermission` (×39 uses); only 4 files verify tokens manually and all are legitimately special (auth.ts logout/sessions reads the raw token; metrics.ts bearer-scrape auth; admin/auth.ts is login itself).
- **Rate limiting**: 100% centralized in app.ts (:511-:673, 5 limiters) + the copilot bucket in `lib/copilot/rate-limit.ts` — zero inline limiter construction in any route.
- **Query-param hygiene**: `intParam`/`pageParam`/`limitParam`/`escapeLikeTerm` shared helpers in `lib/http.ts` with documented adoption-drift guards (A6-F14, R122 page ceiling).
- **Error architecture**: central handler (app.ts:1647) with ZodError→400 mapping, minimal client issue shapes (R120-B3), Sentry captured upstream to avoid double-fire; error classes (`ServiceError`, `RefundError`, `AdjustmentError`, `ConflictError`, `WhatsAppGatewayError`, `FirebaseAuthError`…) all map through `lib/service-error.ts` `mapServiceErrorToCode`; zero thrown strings; zero empty catches (2 unlogged ones = finding #7).
- **Test discipline**: 223 test files, uniform kebab-`.test.ts`, colocation convention (`__tests__/` per directory), per-file test DBs, behavior-named (not method-named) suites; the R123 OpenAPI response-contract suite (21 endpoints) pins the real app.
- **Schema organization**: `shared/db/src/schema/` = one file per table (38 files, largest 210 lines), re-exported through one index.
- **Debt hygiene**: zero TODO/FIXME/HACK markers; zero ts-ignore; 4 eslint-disables, all justified instrumentation anys.

## Quick wins (smallest-complete-change order)

1. **Delete 4 dead exports** (`lib/sentry.ts:545`, `lib/correlation.ts:83`, `lib/logger.ts:215/:219` + dead `export` keywords on `SESSION_TTL_MS`/`childLogger`) — ~40 lines, zero callers verified, zero risk. (Findings #6)
2. **Log the 2 swallowed catches** (`admin/alerts.ts:126`, `admin/referrals.ts:194`) — 2 lines. (#7)
3. **Swap copilot string-literal codes for `ErrorCode` via `createErrorResponse`** in `previews.ts` (31) + `settings.ts` (3) — mechanical, byte-identical responses. (#2)
4. **Adopt the generated firebase bodies** in `auth.ts:512/:675` (`AuthFirebaseSessionBody`/`AuthFirebaseRefreshBody` already exist) and decide the coupon duplicate (#1/#3).
5. **Move the 14 `routes/__tests__/admin-*.test.ts`** into `routes/admin/__tests__/` — one `git mv` + mechanical import-path fix; makes the diagnostics coverage gap (#4) visible in one directory listing.
6. **Export a `RedisClient` type** and type health.ts's 7 `: any` params. (#14)

**Explicitly NOT recommended** (recorded to prevent churn): splitting `wallet.ts` POST /topups (#9 — money-invariant cites), renaming the 6 kebab schema files or camelCase jobs standalone (#12), collapsing the 71 auth-request casts via declaration merging (#15), restructuring `migrate.ts` outside a stage-boundary change (#11).
