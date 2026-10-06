# R118-A5 — Test Quality & Coverage Audit (SubNation2)

- **Scope:** `backend/` (163 test files: 159 in `src/**` + 4 in `tests/`) and `frontend/` (108 test files in `src/**`), plus both `vitest.config.ts`, `src/test/*` harnesses, and the money-invariant regression matrix.
- **HEAD:** `ef3d0c3` (main, clean tree). Money contract of record: `docs/FINAL_MONEY_INVARIANTS.md` (M1–M14; NOTE: it lives at `docs/FINAL_MONEY_INVARIANTS.md`, **not** `docs/operations/…` as older runbooks say).
- **Method:** READ-ONLY. Full-suite runs and coverage tooling were **not** executed (box constraints + `@vitest/coverage-v8` not installed — `vitest run … --coverage` exits with `MISSING DEPENDENCY`). Targeted single-file runs performed: `whatsapp-otp-start-lock` (4/4 ✓), `admin-credentials-gate` (2/2 ✓), `checkout-idempotency` (7/7 ✓), frontend `profile-me-error` (2/2 ✓, reproduces the known act() warnings), `referrals-search-race` (2/2 ✓, 2.28 s wall-clock). All mapping done by rg import-graph analysis (router/hook/page imports in test files) with spot reads.
- **Overall verdict:** this is an unusually disciplined suite — **zero** skipped/todo/empty/always-true tests found, and 13/14 money invariants are genuinely enforced. The gaps are concentrated in (1) two critical untested paths (admin bulk price recompute, firebase login provisioning), (2) admin/ops route surfaces with zero tests, and (3) timing-based frontend race tests that are the top flake risk.

**Findings by severity: P1: 2 · P2: 12 · P3: 12** (severity roll-up: P1 = pricing-recompute route + firebase login path; P2 = 10 more untested money/security-adjacent surfaces incl. M9 weakness; P3 = ops/SEO/UI clusters + infra hygiene)

---

## 1. MONEY-INVARIANT TEST MAPPING (M1–M14)

| # | Invariant (source cite) | Enforcing test (file:line, verified at HEAD) | Verdict |
|---|---|---|---|
| M1 | Topup approval atomic, no double-credit (`services/topup.service.ts:82-127`, CAS `UPDATE … WHERE walletBalance = balanceBefore`) | `services/__tests__/topup.service.test.ts:55` (approve reads balance INSIDE tx), `:110` (double-approve → fail, balance unchanged), `:139` (approve-then-reject credits nothing) | **enforced** |
| M2 | Topup creation dedup in-transaction + MAX_PENDING=3 (`routes/wallet.ts:429`, `:447-470`) | `routes/__tests__/wallet-topups-idempotency.test.ts:138-230` (5 cases incl. 409 reuse), `services/__tests__/topup-composite-dedup.test.ts` (7), `routes/__tests__/wallet-topups.test.ts` (28 incl. `429 TOPUP_LIMIT_EXCEEDED`) | **enforced** |
| M3 | mobile_transfer requires payment_reference (`routes/wallet.ts:365`) | `routes/__tests__/wallet-topups-payment-reference.test.ts:101` (whitespace-only → 400), `:114` (omitted → 400), `:81` (trim canonicalization), `:123` (lypay null still round-trips) | **enforced** |
| M4 | Purchase = one atomic tx (`services/checkout.service.ts:294`; pre-tx `:253`; in-tx selection `:255`) | `services/__tests__/checkout-claim-race.test.ts:59` (concurrent claimer → INVENTORY_CLAIMED, zero money movement), `checkout-idempotency.test.ts:118`, `routes/__tests__/checkout.test.ts:127` (INSUFFICIENT_BALANCE), plus variants/stacked/coupon-maxed/expiry suites | **enforced** |
| M5 | Durable idempotency replay-safe on every money route (`lib/idempotency.ts`) | `middlewares/__tests__/idempotency.test.ts:286-321` — the sentinel `SET NX EX 60` and cached `EX 86400` flags are asserted on a capture-double (`:302-307`), so deleting `EX` from either SET **fails CI**; plus `:327` replay, `:355` 409 reuse, `:376` in-flight, `:425`/`:464` TTL expiry, `:501` non-2xx release, `:556` subject isolation, `:589` replay redaction; route-level: `wallet-topups-durable-idempotency`, `orders-idempotency-route`, `cross-intent-durable-idempotency`, `loyalty-durable-idempotency` | **enforced** |
| M6 | Retry after paid order replays ownership, never re-charges (`checkout.service.ts:141-166`) | `checkout-idempotency.test.ts:153` ("replay short-circuits BEFORE the balance check — a drained wallet still gets its order back"), `:118`, `:204` (per-user scoping) | **enforced** |
| M7 | Refunds transactional + points-race safe, events after commit (`services/refund.service.ts:271`) | `refund.service.test.ts` (5), `refund-points-race.test.ts:79/123/144/163` (3-column predicate interleavings → CONCURRENCY_ERROR, no partial refund) | **enforced** |
| M8 | Admin adjustments intent-keyed (`services/adjustment.service.ts`, r99 fix) | `adjustment.service.test.ts` (9), `routes/__tests__/admin-adjustment-idempotency.test.ts:154` (one ledger row per key), `:218` (in-tx collision rolls wallet write back), `adjustment-cap.test.ts:43-93` | **enforced** |
| M9 | Negative balance unreachable | Compositional only: `routes/__tests__/checkout.test.ts:127` (INSUFFICIENT_BALANCE), topup CAS (M1), adjustment caps (M8). **No direct test**: no concurrent-debit race draining a shared balance, no assertion anywhere that `walletBalance` can never go < 0 under racing debits | **weakly enforced** |
| M10 | `orders.amount` frozen (price snapshot) | `services/__tests__/price-snapshot-immutability.test.ts:74` — re-prices product to 999 after purchase, asserts order.amount stays 27 and refund credits exactly 27. (The doc *understates* this as "pinned by audit" — a real regression suite exists.) | **enforced** |
| M11 | Inventory claims single-writer | `checkout-claim-race.test.ts:59`, `checkout-inventory-corrupt.test.ts`, `checkout-product-stale.test.ts` | **enforced** |
| M12 | Topup path can't hit the historical FK 500 (V1-M20 polymorphic idempotency) | `topup-auto-guards.test.ts:131` (TRUE 23505 between in-tx check and insert → 409 + full rollback), `:116`; `wallet-topups-durable-idempotency.test.ts:207` (topup id with no orders row claims cleanly), `:233` (FK drop probe); `jobs/__tests__/migrate-v1m12.test.ts` | **enforced** |
| M13 | Loyalty convert idempotent-durable (V1-M19) | `loyalty-durable-idempotency.test.ts:102` (convert once, single ledger row), `:145` (distinct key converts again), `:177` (keyless legacy tolerant) | **enforced** |
| M14 | Duplicate-claim prevention on credentials (fail-closed on corrupt/stale) | `checkout-inventory-corrupt.test.ts` (corrupt rows fail closed inside the tx) | **enforced** |

**Summary: 13/14 enforced, 1 weakly enforced (M9), 0 NOT TESTED.** Money-path suite index in the doc verified — all 30 listed files exist (one location drift, see Flaky-risk & infra item 6).

---

## 2. WEAK-TEST HUNT (patterns searched, with results)

Patterns swept across both trees (`backend/src`, `backend/tests`, `frontend/src`, `--glob '*test*'`): `expect(true)`, `expect(1).toBe(1)`, `expect.assertions(0)`, `.skip(`, `.todo(`, `xit(`/`fit(`/`xdescribe(`/`fdescribe(`, `// TODO` inside tests, empty/one-line `it` bodies (perl multiline scan), bare `catch {}` / `catch {/* */}` in tests, mock-returns-mock tautologies.

**Result: zero hits of every always-green pattern.** No skipped, focused, TODO-stubbed, empty-bodied, or tautological tests exist in either tree. The weak/weak-ish spots that DO exist:

| # | Finding | Evidence | Why weak / what it should assert |
|---|---|---|---|
| W-1 | **firebase-auth.service tests only pin flag-forwarding** — 4 cases assert `checkRevoked` true/false/default is forwarded to `verifyIdToken`. The service's actual job (637 lines: user provisioning tx, referral event, identity upsert, session issuance) has zero assertions. | `backend/src/services/__tests__/firebase-auth.service.test.ts:97-128` (only 4 `it`s); provisioning tx at `services/firebase-auth.service.ts:459-499` | Escalated to **P1 gap G-2** (login path). Should assert: new-user provisioning row shape, existing-uid re-login → same user, phone-collision link path, session row + response token, referral event pending + no instant welcome credit. |
| W-2 | **OTP lock-pool suite can't catch a rewiring regression.** The 4 new tests inject a fake pool via `__setOtpStartLockPoolForTests` — excellent for gate behavior, but nothing pins that production resolves `@workspace/db`'s **dedicated** `lockPool` (max 2, 2 s connect timeout). Re-pointing the gate at the runtime pool would still pass. | `services/__tests__/whatsapp-otp-start-lock.test.ts:111` (injection); resolver at `services/whatsapp-otp.service.ts:208-212`; pool config `shared/db/src/index.ts:120-124` (`max: 2`, `connectionTimeoutMillis: 2_000`) | See TOP-20 #5 — pin `lockPool !== pool` + config (`dbPoolConfig` is already exported "for unit tests (R4)" at `shared/db/src/index.ts:136` and used only by `db-statement-timeout.test.ts`). |
| W-3 | **admin-credentials-gate doesn't assert the deduped admin alert** the commit message claims ("over-budget 429 … + deduped admin alert"). Only 429/Retry-After/isolation/decrypt_failed are asserted. | `routes/__tests__/admin-credentials-gate.test.ts:118-156` | Add: after the 61st reveal, exactly ONE `admin_alerts` row is inserted for that admin across repeated over-budget hits (dedup), zero for in-budget admin B. |
| W-4 | **profile-me-error healthy-path test is synchronous and triggers the known act() warnings** (reproduced live: 2 × "An update to ProfilePage inside a test was not wrapped in act(...)"). The page's mount-effect fetch (stubbed `/api/auth/providers/linked` probe) resolves after the test body returns. | `frontend/src/pages/__tests__/profile-me-error.test.tsx:118-132` (non-async body); stderr captured in this audit's run | Make test 2 `async` and settle (`await waitFor(() => {})` / `await act(async () => {})`) before asserting — removes the warnings without changing assertions. |
| W-5 | **Frontend pricing-console test mocks the entire backend** — the dry-run/confirm UX is tested against a stub that always returns the contract shape. It cannot fail for backend-side recompute bugs, which is where the real money risk lives (see P1 gap G-1). | `frontend/src/pages/admin/__tests__/pricing-console.test.tsx:132-180` (fetch counter stub) | Keep the UX test, but pair it with the backend route suite (TOP-20 #1) so the contract is pinned on both sides of the HTTP boundary. |
| W-6 | **Wall-clock race orchestration** — three suites orchestrate debounce/late-response interleavings with real sleeps (340/700/800 ms; 260/400/500 ms; 650 ms). All green today (referrals suite ran 2/2 in 2.28 s), but they are the first flake candidates on a loaded 2-CPU runner. | `frontend/src/pages/admin/__tests__/referrals-search-race.test.tsx:102-134`, `global-search.test.tsx:152-168`, `components/__tests__/notification-bell-markread.test.tsx:179-200` | Migrate to `vi.useFakeTimers()` + `advanceTimersByTime(700)` (the repo already uses fake timers in 26 files — the pattern is established). |

---

## 3. FINDINGS — coverage gaps & infra issues

### Backend routes with ZERO route-level tests

| Route file | Size / role | Severity |
|---|---|---|
| `routes/admin/pricing-config.ts` | `PUT /pricing/config` (global pricing rule) + `POST /pricing/recompute` (rewrites EVERY active variant price + refreshes display prices, `:92-203`) | **P1** (recompute is a bulk money-path write; only the lib bounds are tested) |
| `routes/auth.ts` (firebase + sessions half) | `POST /firebase/session` (login), `POST /firebase/refresh`, `GET/DELETE /sessions`, `/logout`, `/logout-all-devices`, `/onboarding/complete` — only `/probe` and `/providers/unlink` are route-tested (`auth-probe-revocation`, `auth-unlink`) | **P1** (login/provisioning) for firebase/session; **P2** for sessions/logout endpoints |
| `routes/admin/product-variants.ts` | Full variant CRUD incl. price writes (`:103-327`) | P2 (money-adjacent admin writes) |
| `routes/admin/stats.ts` | `GET /stats`, `GET /chart-data` (`:28-85`) | P3 |
| `routes/admin/diagnostics.ts` | 12 endpoints incl. WhatsApp session control (start/pair-code/QR/delete) + `POST /telegram-test` (`:70-406`) | P3 |
| `routes/admin/forecast.ts`, `routes/admin/enrichment.ts` | `GET /forecast/*` (53-96), `GET /enrichment/list`, `POST /enrichment/:id/{publish,reject}` | P3 |
| `routes/notifications.ts` | `GET /`, `POST /read-all`, `POST /:id/read` (`:17-49`) | P3 |
| `routes/seo.ts` | `robots.txt` (`:96`) + `sitemap.xml` (`:221`) — the allow-list the frontend `robotsForPath` mirrors | P3 |

Covered and verified good: wallet, orders, checkout, cart, loyalty, coupons, support, cwv, metrics, health, auth-whatsapp, telegram-webhook, auth-settings (public router via telegram-callback-csrf/telegram-referral-gate; **admin half `authProviderAdminRouter` `auth-settings.ts:1099-1151` untested**), admin/{auth, orders, products, users, topups, tickets, referrals, alerts, risk, security, settings×(via admin tests? no — `admin/settings.ts` zero), flash-sales, observability, admins, pricing-calculator, copilot}.

### Backend services / lib with zero or near-zero tests

| Module | Evidence | Severity |
|---|---|---|
| `services/firebase-auth.service.ts` | only flag-forwarding tests (W-1) | P1 (with the route gap) |
| `services/risk-rules.service.ts` (157 l), `risk-scoring.service.ts` (267 l), `risk-alerts.service.ts` (128 l) | zero test imports anywhere; only `risk-config-cache` is touched (`risk-hard-block.test.ts:21` import, `:202` `invalidateRiskConfig`) | P2 |
| `services/forecast/{aggregate,forecast-store,forecast.service,run-store}.ts`, `services/enrichment/{candidates,draft-store,enrichment.service,prompts,publish,run-store}.ts` | only `validator`/`statistical`/`reorder`/`alerts-dedupe`/`forecast-gate` tested | P3 |
| `lib/numeric.ts` (`toNumber`, 26 l) | zero direct tests; the doc header calls it the M1-class corruption guard ("a single Infinity flowing into a wallet UPDATE corrupts the row") — policy (null/""/garbage/Infinity → fallback) is unpinned | P2 |
| `lib/money.ts` (`roundLyd`/`roundLydString`, 28 l) | zero direct tests; only integration-level via `routes/__tests__/wallet-topups.test.ts:774-781` (10.555 → credited 10.56 + ledger) | P3 |
| `routes/health.ts` `checkNeonWith` warmup probe | exported "for unit tests" (`:241`) but zero tests exercise it — the R117 A4-P2 cold-resume fix (slow first probe, measured second probe) is unpinned | P2 |
| `shared/db` `lockPool` config/wiring | no test pins `max: 2` / `connectionTimeoutMillis: 2_000` / separation from runtime pool (W-2) | P2 |

Well-tested and verified (no action): `idempotency.ts` (14 + 4 route suites), `lockout.ts` (9 incl. 23505 races), `rate-limit-store.ts` (6 resilience), `jwt.ts` (admin-secret split 7), `permissions.ts`, `encryption.ts` (+ `safeDecrypt-gcm`), `admin-session.ts` (7), `pg-leader-lease.ts` (2), `scheduler-coordinator.ts` (bounded-release watchdogs, stateful fake redis), `pricing.ts`/`pricing-config.ts` lib, `catalog-cache.ts`, `economic-golden-matrix.test.ts` (10 economics scenarios). `ledger.ts`/`points-ledger.ts` have no direct unit suites but are exercised by every money suite (40+ call sites); a cheap direct contract test (award/reversal pair + `remainingAwardForOrder` cap) would complete the set.

### Frontend zero-test inventory

- **Pages (storefront):** `referrals.tsx` (545 l — referral link copy, `points_earned` sum = money data; P2), `auth-callback.tsx` (100 l — session bootstrap incl. legacy `?token=` + 12 s hang escape; P2), `category.tsx` (396 l — 7 live category landing pages from `CATEGORY_META`), `not-found.tsx`, `onboarding.tsx`, `status.tsx`, `telegram-callback.tsx`, `terms.tsx` (P3 cluster).
- **Pages (admin):** `dashboard.tsx` (953 l), `settings.tsx` (1288 l), `admins.tsx` (657 l), `risk.tsx`, `risk-event.tsx`, `enrichment.tsx`, `layout.tsx` (P3 cluster; layout has indirect coverage via `admin-layout-alerts`? — no, that tests the alerts badge on pages, not layout.tsx itself).
- **Hooks:** `use-socket.ts` (164 l — wallet/topup invalidation + toasts = money surface; P2), `use-telegram-webapp-auto-login.ts`, `use-on-screen.ts`, `useKeyboardShortcuts.ts` (P3).
- **Admin orders decrypt_failed UI** (`admin/orders.tsx:1267,1438`): backend contract tested (`admin-credentials-gate`), frontend rendering of the honest mismatch message untested (P3→ listed in TOP-20 #14 as P2 value pick given it's the operator's only signal of a key mismatch).
- **`robotsForPath`** (`App.tsx:188`) — the private-funnel `noindex` derivation mirrors the backend robots allow-list; zero tests either side (P3).
- **`index.html` static `<link rel=canonical>`** (R117 A4 P3-4, `frontend/index.html:63`) — read by `seo-head-inject.test.ts` but never asserted (P3).

### R116/R117 feature-test depth (mission item 5) — verdict: GENUINE, not smoke

- `8acba4a` backend +6: `whatsapp-otp-start-lock.test.ts` (4/4 ✓ run in this audit) asserts call ORDER (`try_lock` before send), `release(false)` vs `release(true)` on unlock failure (`:124`, `:173`), no-send for the lock loser + DB-boundary untouched (`:147-151`), busy verdict on pool saturation (`:194`). `admin-credentials-gate.test.ts` (2/2 ✓) asserts 60×200 then 61st→429 + `Retry-After: 300` + different-admin isolation (`:132-152`) and `decrypt_failed:true` under key flip (`:160-183`). Residual unpinned: pool wiring (W-2), warmup probe, boot-warn restore.
- `6538909` frontend +4: `product-r117-contracts.test.tsx` asserts gutter classes on order-5/6/9 blocks (`:159-169`), FAQ DOM-order positions between trust and CTA (`:177-193`), sticky-bar hidden with keyboard + short-viewport fallback class (`:198-217`); `route-change-focus.test.tsx:134-150` updated to pin the RouteAnnouncer no-stale-double-announce fix. All assert the fix, none smoke-only.
- `e394815`: schema/openapi mirror only, no tests — correct (contract gate `check-openapi-routes` 83/83 covers it).

### Flaky-risk & infra

1. **Vitest configs** — backend: node env, `src/test/env.ts` bootstrap, `@workspace/db`→pglite alias (no test can reach prod), **no explicit `testTimeout`** (default 5 s — fine; the 60-reveal gate test ran in 375 ms), default forks pool. Frontend: jsdom, setup file w/ cleanup + `crypto.randomUUID` polyfill, `testTimeout: 10_000`. Neither config sets `pool`/`sequential` — fine at current scale. **Nothing in either config explains the act() warnings** — that is test-authoring (W-4), not config.
2. **DB strategy** — consistent single pattern: `initTestDb()` once + `resetTestDb()` (single `TRUNCATE … RESTART IDENTITY CASCADE` over 19 tables, `src/test/db.ts:483-485`) per test. No drift found; the pglite alias guarantee is documented and real.
3. **No real network** in any unit test (all URLs are fixtures/loopback); `catalog-cache` has a dedicated reset-aware suite.
4. **Helper duplication (P3):** 44 test files define their own `buildApp`, 36 define `seedUser`, 31 define a `listen()` helper, 22 `seedProduct` — est. 1,500–2,000 lines extractable into `src/test/http.ts` + `src/test/fixtures.ts`. One deliberate exception to unify around: `wallet-topups.test.ts:29-33` documents the deterministic phone-counter convention ("no Math.random — unique-phone collisions made suites flaky"), while ~12 other suites still seed phones/names with `Math.random` (e.g. `admin-credentials-gate.test.ts:68,84,89`) — safe today only because of TRUNCATE-per-test.
5. **Dead files:** none — all 4 `backend/tests/*.test.ts` and all 108 frontend files match their include patterns and contain live describes.
6. **Money-doc drift (P3):** §2 index lists `checkout-coupon-expiry-in-tx` under `services/__tests__/` but it lives in `routes/__tests__/`; M10 understates its own enforcement (a real suite exists — `price-snapshot-immutability.test.ts:74`); M2/M3 source line cites are stale post-R116-merge (per R117-A3, e.g. M3 actual guard `wallet.ts:365` — doc says `:349`); doc header path in runbooks says `docs/operations/FINAL_MONEY_INVARIANTS.md` but the file is `docs/FINAL_MONEY_INVARIANTS.md`.

---

## 4. THE TOP-20 MISSING TESTS (implementable as-written)

> Conventions: backend route tests mount the router on a fresh express app (`buildApp()` pattern, real pglite `db`, `signAdminToken`/`signUserToken` from `lib/jwt`); frontend tests use RTL + `QueryClientProvider` + `vi.mock("@workspace/api-client-react")` per the existing page-test pattern.

1. **[P1]** `backend/src/routes/admin/__tests__/pricing-config-recompute.test.ts`
   - `it("bulk recompute rewrites drifted variants to computeRetailLYD and refreshes product price = MIN(active variant)")` — seed 2 products × 2 variants, one drifted (cost 10, rule 10×2 ⇒ price 20, stored 25): POST `/api/admin/pricing/recompute`; assert variant `price_lyd=20`, `products.price=MIN(active)`, response `variants_updated:1`.
   - `it("re-running after success is a no-op (variants_updated: 0)")` — second POST asserts 0 and unchanged rows (the idempotence claim at `pricing-config.ts:106`).
   - `it("dry_run=true returns counts + before→after sample and writes ZERO rows")` — POST with `?dry_run=true`; assert `variants_drifted`, `sample[0].price_before/after`, and DB rows unchanged.
   - `it("the audit row carries per-variant before/after values")` — select `audit_logs` where action=`pricing.recompute`; assert `changes[0]` has `{variant_id, before, after}` (the A5 P1-1 recovery trail).
2. **[P1]** `backend/src/routes/__tests__/auth-firebase-session.test.ts`
   - `it("valid idToken provisions the user (firebaseUid, referralCode, balance 0.00) and creates a session")` — `vi.mock("../../lib/firebase-admin")` to return a fixed decoded token; POST `/api/auth/firebase/session`; assert `users` + `sessions` + `user_auth_identities` rows and response token.
   - `it("re-login same uid → same user, second session, no duplicate")`; `it("existing-phone user via a different provider links an identity instead of 500")` (unique-phone collision — today's behavior unpinned); `it("?ref referral attaches a pending referral_events row and does NOT grant the welcome bonus")` (policy B at `firebase-auth.service.ts:470-473`); `it("invalid token → 401, zero rows")`.
3. **[P2]** `backend/src/lib/__tests__/numeric.test.ts` — `toNumber` matrix: `null/undefined/""/"  "` → fallback 0; `"abc"` → fallback; `"Infinity"/"NaN"` → fallback (the corruption guard); `"12.34"` → 12.34; finite number passthrough; custom fallback `toNumber(x, -1)`; non-string non-number (object/bool) → fallback.
4. **[P2]** `backend/src/services/__tests__/wallet-never-negative.test.ts` (M9 direct) — two concurrent `CheckoutService.purchase` calls for one user whose balance covers exactly one: assert exactly one `ok`, final `walletBalance = 0.00` (never −x), one ledger row; plus exact-balance purchase (`50 − 50`) leaves `0.00` and a second purchase returns `INSUFFICIENT_BALANCE` with balance intact. Use the `Promise.all` + `tx-interleave` helper pattern from `services/__tests__/helpers/tx-interleave.ts`.
5. **[P2]** `backend/src/lib/__tests__/lock-pool-wiring.test.ts` — source-contract test (repo precedent: `no-native-confirm.test.ts`): assert `shared/db/src/index.ts` still creates `lockPool` with `max: 2` + `connectionTimeoutMillis: 2_000` and that `whatsapp-otp.service.ts`'s resolver reads `mod.lockPool` (not `pool`); ideally also a runtime assertion that `lockPool !== pool`.
6. **[P2]** `backend/src/routes/__tests__/health-neon-warmup.test.ts` — import `checkNeonWith` (already exported `health.ts:241`): `it("cold-resume shape: slow first probe, fast second → ok, not degraded")` (probe = 600 ms then 5 ms); `it("a genuinely failing probe escalates (warmup failure is not swallowed)")` (probe always rejects → failing/degraded verdict); `it("latency threshold still marks slow steady-state probes degraded")`.
7. **[P2]** `backend/src/routes/__tests__/auth-sessions.test.ts` — `POST /logout` revokes the current session (row gone, still 200); `POST /logout-all-devices` keeps only the current; `GET /sessions` lists the caller's sessions only; `DELETE /sessions/:id` on another user's session → 403/404 (no cross-user revocation); `POST /onboarding/complete` marks onboarding once.
8. **[P2]** `backend/src/routes/admin/__tests__/product-variants.test.ts` — POST create: price bounds + negative price 400 + duplicate label rejection; PATCH price change reflected; DELETE a variant referenced by an order → guarded (or defined behavior pinned); requireAdmin 401 + inventory permission.
9. **[P2]** `backend/src/routes/admin/__tests__/pricing-config-put.test.ts` — PUT in-bounds updates the rule + writes `pricing.config.update` audit + bumps catalog cache; out-of-bounds (rate 0.05 / 2000, markup −1, cap 95.5) → 400 with the range message; empty patch → 400; GET returns effective rule.
10. **[P2]** `backend/src/services/__tests__/risk-scoring.test.ts` — fixture users/events → score is bounded and monotonic in event severity; crossing the threshold yields the hard-block verdict consumed by `middlewares/risk-hard-block.ts`; `risk-config-cache` invalidation changes the verdict on next call; rules engine: a known-benign pattern does NOT score.
11. **[P2]** `frontend/src/pages/__tests__/referrals-page.test.tsx` — error card on overview query failure (outage ≠ empty — the 93-C5 pattern, unpinned on this page), referral-link copy writes `?ref=CODE` to clipboard, `points_earned` sum renders from events, empty-events state.
12. **[P2]** `frontend/src/pages/__tests__/auth-callback.test.tsx` — modern cookie path bounces to `/` (no token in URL); legacy `?token=…` calls `setToken` then navigates; `?auth_error=…` renders the error banner; 12 s hang escape button appears under `vi.useFakeTimers()` + `advanceTimersByTime(12_000)` (`HANG_TIMEOUT_MS`, `auth-callback.tsx:7`).
13. **[P2]** `frontend/src/hooks/__tests__/use-socket.test.tsx` — render a harness with the hook + mocked `connectSocket` emitting `order-updated` → assert toast + `queryClient.invalidateQueries` on the orders key; `topup-updated` approved/rejected → toast variant + wallet+topups keys invalidated; unmount → disconnect called (page-scoped socket economics).
14. **[P2]** `frontend/src/pages/__tests__/admin-orders-decrypt-failed.test.tsx` — with the credentials hook mocked to `{has_credentials:true, delivered_email:null, decrypt_failed:true}`: assert the honest ENCRYPTION_KEY-mismatch message renders on the desktop row (`orders.tsx:1267`) AND the mobile card (`:1438`), and that it does NOT render when `decrypt_failed` is absent.
15. **[P3]** `backend/src/routes/__tests__/notifications.test.ts` — 401 without token; ownership (foreign `/:id/read` → 404); `read-all` marks all + returns count; list pagination shape.
16. **[P3]** `backend/src/routes/__tests__/seo.test.ts` — `robots.txt` allow-list parity with the documented public surface (admin/wallet/orders-detail disallowed); `sitemap.xml` excludes archived/inactive products and carries the canonical host; content-types.
17. **[P3]** `frontend/src/pages/__tests__/category-page.test.tsx` — each of the 7 live slugs renders its `CATEGORY_META` h1/intro (the round-100 fix), unknown slug renders the 404 shape, product grid + empty-state.
18. **[P3]** `frontend/src/pages/admin/__tests__/admin-settings.test.tsx` — settings load error state (no silent vanish), save failure surfaces the message, dirty-guard blocks navigation, TOTP section copy per `FINAL_ADMIN_TOTP_SETUP`.
19. **[P3]** `frontend/src/pages/__tests__/admin-dashboard.test.tsx` — KPI query failure renders error+retry (not zeros), loading skeleton, empty-catalog state; chart data range validation message.
20. **[P3]** `backend/src/lib/__tests__/money.test.ts` — `roundLyd` boundary matrix from the module's own doc header: `10.555→10.56`, `10.5551→10.56`, `10.5549→10.55`, `10.4999→10.50`, negative halves `−10.555→−10.56`, `±Infinity/NaN` passthrough; `roundLydString` returns a plain 2-dp string (insert boundary for `wallet.ts`/`topup.service.ts`).

*(Infra work orders not in the top-20: extract `src/test/http.ts` + `fixtures.ts` (finding §3.4); migrate the 3 wall-clock race suites to fake timers (W-6); fix W-4 act() settle; extend `seo-head-inject.test.ts` to pin the static canonical link; add the boot-warn test for `warnLegacySplitOriginEnvAtBoot` (`lib/origins.ts`, restored in 8acba4a, zero tests); update `FINAL_MONEY_INVARIANTS.md` suite index + M2/M3/M10 cites.)*

---

## 5. Stats

- Backend: 163 test files (159 `src/**` + 4 `tests/`), last full green ≈1,453 tests (r117 worklog: 1447 + 6).
- Frontend: 108 test files, 747 tests at the R117-A2 full run.
- Money invariants: **13/14 enforced, 1 weakly (M9), 0 untested.**
- Skipped / always-green / TODO tests: **0** in both trees.

**Findings by severity: P1: 2 · P2: 12 · P3: 12**
