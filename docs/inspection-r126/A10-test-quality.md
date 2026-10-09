# R126-A10 — test quality + staged-plan (T1/T2/T3) execution-readiness audit

**Round:** R126 · **Agent:** A10 · **Tree:** `main @ 186b131` (clean; only untracked `docs/inspection-r126/`)
**Mandate:** (1) re-verify every R125-A9 §6.2 staged-plan claim at HEAD with fresh measurements, (2) deep quality audit of the R125-newest test suites, (3) money/auth coverage-gap map, (4) guest-e2e readiness, (5) flake inventory.
**Mode:** read-only on tracked source. All probe configs + captured outputs live under `/home/z/my-project/tmp-a10/` (12 configs + 12 captured outputs). No installs, no orval, no full suite runs, no commits.

---

## 1. Staged-plan verification at HEAD (§6.2 re-measured)

### 1.1 Method

A9's probe artifacts (`/home/z/my-project/scripts/r125-strict-probe/`, incl. the `out.tests-base.fe.txt` checklist) **no longer exist** — every number below was re-measured from scratch. Probes extend the repo's real tsconfigs via absolute `extends`, re-declaring `references` (NOT inherited through extends) and absolute `typeRoots` per A9 §6.3 discipline; FE probes inject `vite/client.d.ts` via `files:` and override `types: ["node"]`. TS 5.9.3 (repo-installed), `tsc -p <probe> --noEmit`.

**New vs A9:** the shared packages' `dist/*.d.ts` (what `references` redirect to) is **a month stale** (api-zod dist Sep 7 vs src Oct 5; api-client-react dist Sep 10 vs src Oct 5). I therefore ran every headline probe **twice**: with `references` (what a standalone per-package typecheck sees today) and without (pulls shared **src** into the program — what the canonical root `pnpm typecheck` sees after `typecheck:libs` rebuilds dist). Program sizes verified non-empty via `--listFilesOnly`.

### 1.2 Verification table (exact measured numbers)

| # | A9 §6.2 claim | A9 number | HEAD, refs (stale dist) | HEAD, fresh shared types | verdict |
|---|---|---|---|---|---|
| 1 | BE baseline is 0 | 0 | **8** (all stale-dist artifacts) | **0** | ✅ confirmed *with caveat (§1.3)* |
| 2 | **T1a:** BE `tests/` inclusion adds 0 errors | 0 | 8 (same 8) | **0** | ✅ **confirmed** |
| 3 | FE baseline is 0 | 0 | **9** (all stale-dist artifacts) | **0** | ✅ confirmed *with caveat* |
| 4 | **T1b:** FE `e2e/` + both configs inclusion adds 0 errors | 0 | 9 (byte-identical set to #3 — e2e adds **0**) | **0** | ✅ **confirmed** |
| 5 | **T2:** FE tests inclusion = 49 errors / 22 files | 49 / 22 | 64 / — | **55 / 25 files** | ⚠️ **drifted +6 errors / +3 files** (R125's ~88 new tests; current checklist §1.4) |
| 6 | **T3:** `validate.ts:331,376` TS2353 `RequestInit.timeout` | 2 | 2 | 2 | ✅ confirmed + **2 new finds** (§1.5) |
| 7 | SFT flip state (§6.1, context) | plan: enable | — | `strictFunctionTypes: true` already in `tsconfig.base.json:15` — R125 landed it | ✅ done |

Program sizes: BE base 1,977 (= repo's own gate; be-tests 1,981 = +4 top-level tests), FE base 860, FE e2e 1,079, FE tests 1,079, scripts root 1,420 (pulls backend src via `validate.ts` imports — see §1.5).

Cross-check: A9 §5's FE-test-error claim "SFT adds nothing in test files" holds — the 55 are under the current (SFT-on) flags, and the baseline surfaces 0 SFT-class errors.

### 1.3 ⚠️ Execution-readiness P1 for the T1/T2 lane — stale shared `dist`

The **standalone** package typechecks at HEAD are RED with **17 phantom errors that are not the lane's**:

- BE 8: `src/routes/admin/products.ts(245,246,342,343,345,346)` `seo_title`/`seo_description` missing on the stale `UpdateProductBody` infer type + `src/__tests__/openapi-response-contracts.test.ts(19,20)` TS2724 `AddCartItemResponse`/`CreateTopupResponse` not exported — all 6+2 exist in `shared/api-zod/src/generated/api.ts` (Oct 5) but not in `dist` (Sep 7).
- FE 9: `App.tsx(15,340)`, `flash-sales.tsx(10,178)` (`ProductListItem` + `fields` param — R124 additions), `TopupWaitingModal.tsx(89,93)` + `wallet.tsx(929)` (2-arg hook signature), `admin/products.tsx(767,768)` (`AdminProduct.seo_*`) — all resolve against `shared/api-client-react/src` (fresh).

**Rule for the lane:** run the **root** `pnpm typecheck` (which runs `typecheck:libs` = `tsc --build`, refreshing dist) — NOT the per-package script — before measuring T1/T2, or they will mis-attribute 17 phantom errors (and could "fix" them by degrading real code). This is A9 §6.3's documented hazard, now materialized at HEAD.

### 1.4 T2 current checklist — 55 errors / 25 files (fresh-types, authoritative)

A9's checklist file is gone; this is the replacement. Highest-count first:

| # | file (frontend/src) | errors | dominant class |
|---|---|---|---|
| 1 | `pages/admin/__tests__/copilot-persistence.test.ts` | 7 | broken `Conversation` type derivation (`Parameters<…>[0]` now yields the array) — TS2345×5, TS2339, TS2353 |
| 2 | `pages/admin/__tests__/admin-layout-alerts.test.tsx` | 6 | hoisted `authState` typed `{finance}` but `.support` set (TS2339×4) + TS7053 + TS2722 |
| 3 | `pages/__tests__/product-price-honesty.test.tsx` | 6 | **stale Product mock**: `price_from: boolean` (real: numeric/null), extra `variants` prop, number-into-null (TS2322×5, TS2353) |
| 4 | `components/__tests__/session-activity-manager.test.tsx` | 4 | unguarded predicate extraction (TS2532 + TS2722×3) |
| 5 | `pages/admin/__tests__/settings-2fa-re-enroll.test.tsx` | 3 | `setupResponse` annotated `() => Response` but returns `Promise<Response>` (TS2740×3) |
| 6 | `components/__tests__/socket-initializer-resync.test.tsx` | 3 | implicit-any callback params (TS7006×3) |
| 7 | `pages/admin/__tests__/global-search.test.tsx` | 2 | dead responder `routeSearch(() => [], false)` — `never[]` where `Response` expected (TS2322×2) |
| 8 | `pages/admin/__tests__/admin-login-cookie-session.test.tsx` | 2 | unsafe cast + tuple index (TS2352, TS2493) |
| 9 | `pages/__tests__/order-decrypt-failed.test.tsx` | 2 | mock order shape drift (TS2345×2) |
| 10 | `pages/__tests__/seo-money-pages-r120.test.tsx` | 2 | stale Product mock (:77) + partial AuthContextType mock (:238) |
| 11 | `lib/__tests__/seo-builders.test.ts` | 2 | unsafe JSON-LD casts (TS2352×2) |
| 12 | `lib/__tests__/web-vitals-sampling.test.ts` | 2 | implicit-any destructuring (TS7031×2) |
| 13 | `hooks/__tests__/use-toast-severity.test.ts` | 2 | toast-action object carries `onDismiss` the type lacks (TS2353×2) |
| 14 | `pages/admin/__tests__/orders-bulk-status.test.tsx` | 1 | TS7053 string-index |
| 15 | `pages/admin/__tests__/dashboard-chart-scope-gate.test.tsx` | 1 | TS7053 |
| 16 | `pages/admin/__tests__/dashboard-chart-race.test.tsx` | 1 | TS7053 |
| 17 | `pages/__tests__/terms-legal-page.test.tsx` | 1 | icon mock shape (TS2740) |
| 18 | `pages/__tests__/loyalty-convert-journey.test.tsx` | 1 | `findByPlaceholderText` → HTMLElement vs HTMLInputElement (TS2740) |
| 19 | `pages/__tests__/flash-sales.test.tsx` | 1 | **stale Product mock** (TS2739, :35) |
| 20 | `pages/__tests__/checkout-coupon-perline.test.tsx` | 1 | TS2722 possibly-undefined invoke |
| 21 | `lib/__tests__/user-session.test.tsx` | 1 | Mock generic variance (TS2345) |
| 22 | `lib/__tests__/cart.test.tsx` | 1 | mock cart-item shape drift (TS2345, :287) |
| 23 | `components/__tests__/storefront-chrome-r120.test.tsx` | 1 | TS2345 `{}`→string |
| 24 | `components/__tests__/status-badge-v2.test.tsx` | 1 | icon mock `$$typeof` (TS2741) |
| 25 | `components/__tests__/shared-chrome.test.tsx` | 1 | TS2345 `{}`→string |

**By error code (55 total):** TS2345×12, TS2322×7, TS2740×5, TS2722×5, TS2339×5, TS7053×4, TS2353×4, TS7006×3, TS2352×3, TS7031×2, TS2739×2, TS2741×1, TS2532×1, TS2493×1.

**By fix class:** ~34 mock-shape drift / wrong mock typing (the A8 invisible-drift class, incl. the 4 money-adjacent suites: product-price-honesty, flash-sales, seo-money-pages, cart, order-decrypt-failed), ~15 annotation debt (implicit-any / possibly-undefined / string-index), ~4 mutable-scope shape debt, 2 dead-responder. All mechanical; still est. 1–2 focused sessions. A9's priority order holds (stale-Product suites first); `copilot-persistence` (7) remains the single biggest file.

### 1.5 T3 verification + new finds

- ✅ `scripts/validate.ts:331` and `:376` — `fetch(sitemapUrl, { timeout: 10000 })` / `fetch(robotsUrl, { timeout: 10000 })`: TS2353 confirmed; `timeout` is not an undici `RequestInit` property → **silently ignored, no runtime timeout on the fetch itself**. Nuance vs A9's "suite can hang": the per-journey `measure()` Promise.race (validate.ts:119–130) bounds the *result* at 10 s, so the suite does not hang — but the sockets leak past the race and the `timeout:` property is dead code. Fix via `AbortSignal.timeout(10_000)` stands.
- 🆕 **`scripts/src/backup-db.ts:348`** — the presigned-PUT backup upload (full DB backup body, potentially 100s of MB) has **NO timeout and NO signal at all**, and unlike validate.ts there is no race wrapper: a stalled S3 endpoint hangs the **production backup cron** indefinitely. Higher ops risk than the two validate.ts sites; add to T3's fix list.
- 🆕 **`scripts/inspect.ts:59`** — TS5097 `.ts`-extension import fires as soon as scripts root files join a typecheck (scripts/tsconfig.json lacks `allowImportingTsExtensions`; the script is currently untyped-ungated). T3 cost grows by 1 mechanical fix (add the flag — safe since scripts typecheck is `--noEmit`).
- Probe artifacts: `out.scripts-root.txt` also shows 8× TS6059 rootDir artifacts (validate.ts/inspect.ts import **backend src** into the scripts program — 1,420 files) — T3's include-widening design must account for the backend-src pull, as A9 noted.

---

## 2. New-test quality audit (17 newest files sampled)

Sampled (read in depth): `risk-rbac-gate`, `risk-load-more`, `risk-event-label-co-invalidation`, `settings-2fa-re-enroll`, `global-search`, `users-wallet-confirm`, `users-tier-partial-empty`, `pricing-console`, `admin-layout-alerts`, `session-activity-manager`, `storefront-r125-sweep`, `loyalty-convert-journey`, `copilot-persistence` (FE) + `admin-enrichment-final-text-cap`, `2fa-setup-password` (BE) + structure-checked `flash-sale-banner`, `referrals-search-race` (FE) = **17 files**.

### 2.1 What is GOOD (stronger than R125-A10 found)

- **Zero snapshot tests** in the entire FE suite (`toMatchSnapshot|Inline` — 0 hits). No snapshot misuse possible.
- **No tautologies found**: every `.toBeTruthy()` hit (e.g. `status-badge-v2.test.tsx:70,110`) is a guard before a deeper assertion; negative paths are a house style — `expect(fetchMock).not.toHaveBeenCalled()` appears in nearly every R125 suite (e.g. `risk-rbac-gate:94`, `settings-2fa-re-enroll:199-201`, `users-wallet-confirm:206,218`).
- **Fake-timer discipline is exemplary**: every `vi.useFakeTimers` file restores via a root `afterEach(() => vi.useRealTimers())` (verified in `flash-sale-banner` [14 use sites, 1 root restore — correct], `copy-button`, `shared-chrome`, `notification-bell-markread`, `custom-fetch-network`, `session-activity-manager`, `global-search`). **No fake-timer leaks.**
- **No state bleed**: fresh `QueryClient` per render, `window.history.replaceState` reset in afterEach (`risk-event-label:109`, `users-tier-partial-empty:99`), `localStorage` cleanup (`global-search:158`, `admin-layout-alerts:108`), hoisted-mutable-state reset in beforeEach (`settings-2fa-re-enroll:119-123` even documents the leak it prevents).
- **No over-broad regex rubbergreen** in the sampled units: assertions are exact Arabic strings or tight patterns with lookarounds (`storefront-r125-sweep.test.ts:71` `/(?<!group-)hover:text-primary(?![-\w])/`).
- The `invalidateQueries`-spy idiom (`risk-event-label:139-142`, `session-activity-manager:116-118`, `loyalty-convert-journey:357-368`) asserts **cache keys = behavior**, not mock internals; bodies are pinned exactly (`users-wallet-confirm:246-251` Idempotency-Key + trimmed note; `loyalty-convert-journey:176-178` UUID v4).

### 2.2 Findings (P1–P3, file:line evidence)

**P1-1 (execution readiness, blocks the lane's measurements — see §1.3):** shared `dist` a month stale ⇒ standalone BE/FE typechecks RED with 17 phantom errors at HEAD. The T1/T2 lane must run root `pnpm typecheck` first.

**P2-1 — money-path mock drift (the A8 invisible-drift class, now measured):** 6 suites pass today while asserting against product/order shapes the live API cannot produce — `product-price-honesty.test.tsx:183,195,211,223,264,283` (`price_from: boolean` vs real numeric/null; phantom `variants` prop), `flash-sales.test.tsx:35`, `seo-money-pages-r120.test.tsx:77` (missing `price_from`/`variants`), `cart.test.tsx:287`, `order-decrypt-failed.test.tsx:203,210`. These guard the money pages; a new live field or shape change in `Product`/cart items stays invisible until T2 lands (the fix list above IS the remediation — file this as the reason T2 is high-value, not blocker).

**P2-2 — live-e2e rubbergreen (last-line guard can false-pass):** `e2e/search-arabic.spec.ts:13` swallows the nav timeout (`.catch(() => {})`) and `:17-19` passes on a **disjunction** (`visible || any '/product/' link on the page`) — if search silently no-ops and the home grid stays on screen, the test still passes. `:22-33` ("garbage query renders the friendly empty state") never asserts the empty state at all — only `body` truthy + `html[dir=rtl]` (`:30-32`). The comment claims more than the assertions pin.

**P2-3 — real-sleep race orchestration reintroduced by R125 (documented retired flake pattern):** `referrals-search-race.test.tsx:127,135,147,161` (340 ms sleeps against a 300 ms debounce; 800 ms against a 700 ms delayed response — margins of 40/100 ms) and `topups-queue-search.test.tsx:112` (340 ms). `global-search.test.tsx:19-28` (R118-B6) explicitly documents migrating OFF this exact pattern because it was the "top flake candidate on a loaded 2-CPU runner" — yet R125 shipped two new suites using it. Migrate to the `advanceTimersByTime` + microtask-flush idiom.

**P2-4 — BE fire-and-forget sweep raced with a fixed 50 ms sleep:** `backend/src/lib/__tests__/account-link-consent.test.ts:319` sleeps a flat 50 ms for a fire-and-forget DELETE, then asserts `count==0` — a loaded box that misses the window fails the test spuriously (no retry/poll). Same class, smaller: `whatsapp-otp-daily-cap.test.ts:120` (20 ms), `session-liveness.test.ts:79` (5 ms, sound — only needs clock advance past 1 ms).

**P3-1 — dead responder by luck:** `global-search.test.tsx:162,318` — `routeSearch(() => [], false)` passes a `never[]`-returning responder where `Response` is expected; it works only because `searchOk=false` short-circuits before `respond()` is called. Flip the flag and the mock returns garbage.

**P3-2 — type derivation lies about shape:** `copilot-persistence.test.ts:27` — `type Conversation = Parameters<typeof stripTransientLoading>[0]` now resolves to the **array** type (function takes `Conversation[]`), cascading 7 errors through helpers (`:40,42,52,59,64,75,84`). Runtime behavior is correctly pinned (the round-trip fixed-point test at `:82-92` is good); the type extraction must be `Parameters<…>[0][number]`.

**P3-3 — annotation debt in newest suites** (all mechanical, folded into T2 list): `settings-2fa-re-enroll.test.tsx:99-102` (Promise/Response), `admin-layout-alerts.test.tsx:35` (hoisted `authState` missing `support` key), `session-activity-manager.test.tsx:125` (unguarded `[0]`), `socket-initializer-resync.test.tsx:70-72` (implicit-any).

**P3-4 — 600 ms no-poll settling sleeps** (runtime cost, safe direction): `admin-layout-alerts.test.tsx:286,313`, `dashboard-chart-scope-gate.test.tsx:147`, `admin-layout-pill-search-scope.test.tsx:203` — ~2.4 s of real sleeping per full run; cannot fail spuriously (they prove absence inside a settling window) but could be fake-timed or event-driven.

**P3-5 — month-stale fixed-date fixture:** `risk-load-more.test.tsx:64` (`created_at: "2026-09-08T10:00:00.000Z"`) — harmless today (asserts links, not relative time), but any future "time ago" assertion on these rows drifts. Prefer `new Date(Date.now() - …)` anchors (the house pattern, e.g. `wallet-money-gates.test.tsx:97`).

**Severity count: P1 ×1, P2 ×4, P3 ×5.** Overall: the R125 suites are the strongest batch audited so far — the P2s are drift/infrastructure, not assertion dishonesty (except the two live-e2e cases).

---

## 3. Coverage-gap map — money + auth focus

Method: enumerated all 155 router endpoints across 45 route files, diffed literal path + substring references against the whole BE test corpus (227 files), then hand-verified each candidate gap (template-literal references counted as covered). **The money core is exceptionally covered**: checkout atomicity/rollback/concurrency (`checkout.test.ts:54,133,183,209-296`), coupon redemption races + expiry-in-tx, golden economics matrix incl. worst-case stacks + property-based invariants (`economic-golden-matrix.test.ts:84-206`), refund reversal precision, referral welcome/race policy, topup approve/reject with the real service, price-snapshot immutability + stale-product checkout, idempotency (per-route, durable, cross-intent), admin 2FA setup/verify/lockout, admin login lockout incl. global per-username lock + uniform-401 anti-enumeration, 2FA login happy path incl. HttpOnly cookie + IP pinning (`admin-auth-lockout.test.ts:462-500`).

**Top-10 highest-risk untested behaviors** (ordered by risk; each with the file it belongs in):

| # | untested behavior | why it matters | target test file |
|---|---|---|---|
| 1 | Admin **WhatsApp session lifecycle** — `GET/POST /admin/diagnostics/whatsapp/sessions`, `/:id/start`, `/:id/pair-code`, `/:id/qr`, `DELETE /:id` | Operates the **live OTP gateway** — user login availability; an unguarded regression can orphan pairing sessions or kill OTP delivery | `backend/src/routes/admin/__tests__/diagnostics-whatsapp-sessions.test.ts` |
| 2 | `GET`+`PUT /api/admin/risk/rules` (rule list + enable/disable/threshold tuning) | Risk rules gate **topups** (money); neither the read shape nor the mutation path (validation, audit, cache invalidation) is pinned anywhere | `backend/src/routes/__tests__/admin-risk-rules.test.ts` |
| 3 | `POST /api/admin/risk/synth` — the `NODE_ENV === "production"` 403 guard | The only thing keeping **synthetic fraud events + critical alerts out of prod**; a refactor that drops the guard pollutes the risk feed and pages on-call | `backend/src/routes/__tests__/admin-risk-synth-prod-guard.test.ts` |
| 4 | `GET /api/admin/risk/dashboard` shape contract | FE risk suites (`risk-rbac-gate`, `risk-load-more`) **mock** its envelope (`by_level`/`unresolved`/`pipeline`); no BE test pins it — shape drift is invisible end-to-end | `backend/src/routes/__tests__/admin-risk-dashboard.test.ts` |
| 5 | `GET /api/admin/alerts/unread-count` (+ 500 envelope) | Polled every 5 min by the admin shell; FE badge tests mock it; the R124 "unlogged 500" fix (`alerts.ts:135-143`) has no route test | `backend/src/routes/__tests__/alerts-unread-count.test.ts` |
| 6 | Admin **tickets** `GET /tickets/:id`, `POST /:id/reply`, `PATCH /:id/status` behavior | Only incidental refs (pagination fixtures, copilot denylist); the reply path notifies **users** (support = post-purchase money trust) | `backend/src/routes/admin/__tests__/tickets-mutations.test.ts` |
| 7 | `POST /admin/diagnostics/telegram-test` | Sends real Telegram test messages; unguarded regression can spam the prod ops channel | `backend/src/routes/admin/__tests__/diagnostics-telegram-test.test.ts` |
| 8 | `GET /api/admin/admins/scopes` | Feeds the admin-creation RBAC UI (the subset-grantor in `admins-rbac-subset.test.ts` is tested; the scope taxonomy it reads is not) | `backend/src/routes/admin/__tests__/admins-scopes.test.ts` |
| 9 | `GET /admin/enrichment/list` | Publish/reject ARE tested (incl. the 16k cap); the review workflow's list/pagination/state-filter endpoint is not | `backend/src/routes/admin/__tests__/admin-enrichment-list.test.ts` |
| 10 | `GET /admin/forecast/products/:id` + `GET /admin/diagnostics/inventory-health` + `/sentry-debug` | Read-only finance/diagnostics surfaces (at-risk forecast IS tested); sentry-debug should be pinned to never leak config | `backend/src/routes/admin/__tests__/diagnostics-readonly.test.ts` |

(Note: `admins` CRUD itself IS covered — `admins-rbac-subset.test.ts` escalation guard + `admin-input-bounds.test.ts`; coupons incl. DELETE/archive — `coupons-referrals-audit.test.ts`; cart full matrix — `cart.test.ts`; wallet ledger — `user-money-history-pagination.test.ts`.)

---

## 4. E2E readiness — guest journeys NOT covered (≤6 additions)

Current 40-test guest suite covers: API contract smoke, auth-gate redirects (wallet/orders/loyalty), cart-renders + checkout-redirect, category chip nav, home grid, login provider surface, mobile-390 overflow, product-detail money honesty, arabic search (weakly — §2.2 P2-2), robots/sitemap/404-shell. **Not covered**, highest value first:

1. **Guest add-to-cart gate on the product page** — the money entry point. Today only the checkout-page redirect is gated. Sketch: `page.goto('/product/<live-slug>')` → click the CTA (`button:has-text('أضف إلى السلة'), button:has-text('اشترِ الآن')`) → expect `page.waitForURL(/login/)` **and** assert no successful cart POST: `page.on('response', r => { if (r.url().includes('/api/cart')) expect(r.status()).toBe(401); })`.
2. **Flash-sale journey** (no flash-sales spec exists at all): home banner → `a[href='/flash-sales']` → assert price text (`text=/د\.ل/`), a visible countdown (`[data-testid='countdown'], text=/ينتهي بعد/`), and `scrollWidth ≤ 1280`. Flash sales are a money surface with only unit coverage.
3. **PWA installability contract** (request-level, cheap): `GET /manifest.webmanifest` → 200, `name` truthy, icons include 192 + 512, `start_url: '/'`; optionally `page.evaluate(() => document.querySelector('link[rel=manifest]'))` non-null on home. Guards the install prompt + offline shell (unit-tested only).
4. **Product-404 journey**: `page.goto('/product/does-not-exist-xyz')` → honest not-found UI (Arabic empty state, `<meta name=robots content=noindex>` in head), no infinite skeleton, no 5xx. Generic 404 is covered; the product-slug branch is not.
5. **RTL/lang contract on every core page**: one loop test — for `/`, `/category/<slug>`, `/product/<slug>`, `/login`, `/status`: `expect(page.locator('html[dir="rtl"]')).toBeVisible(); expect(await page.getAttribute('html','lang')).toBe('ar')`. Currently dir is asserted only incidentally inside the garbage-search test.
6. **Product-detail API shape pin** (extends `api-contracts.spec.ts`): `GET /api/products/<live-slug>` → object (not array) with `price`, `slug`, `variants` array, `variant_count` — pins the R124 grid-projection contract live (the unit suites mock this shape).

Plus (fold into #2 above or a fix commit): **repair the two weak search assertions** per §2.2 P2-2 — assert the result navigates AND a netflix card is in a *results* container, and assert the actual empty-state string for the garbage query.

---

## 5. Flake inventory

| risk | file:line | pattern | assessment |
|---|---|---|---|
| **med-high** | `frontend/src/pages/admin/__tests__/referrals-search-race.test.tsx:127,135,147,161` | real 340/800 ms sleeps racing 300/700 ms debounce/delay | 40–100 ms margins; the documented retired flake pattern (global-search.test.tsx:19-28) reintroduced in R125 |
| **med** | `frontend/src/pages/admin/__tests__/topups-queue-search.test.tsx:112` | same 340 ms-vs-debounce class | migrate to fake timers |
| **med** | `backend/src/lib/__tests__/account-link-consent.test.ts:319` | flat 50 ms sleep for fire-and-forget DELETE, then hard count assert | no poll/retry — spuriously fails on a loaded box |
| low-med | `backend/src/services/__tests__/whatsapp-otp-daily-cap.test.ts:120` | 20 ms settle for fire-and-forget alert dedupe | same class, small window |
| low | `frontend/src/components/__tests__/app-dialog.test.tsx:192`; `dashboard-chart-race.test.tsx:251,296`; `admin-layout-alerts.test.tsx:286,313`; `dashboard-chart-scope-gate.test.tsx:147`; `admin-layout-pill-search-scope.test.tsx:203` | 120–600 ms real settling sleeps | can't fail spuriously (absence-in-window direction is safe); ~2–3 s runtime cost |
| low | `backend/src/lib/__tests__/cache-singleflight.test.ts:48,67,112`; `session-liveness.test.ts:79`; `refund-revocation.test.ts:95`; `whatsapp-otp-start-lock.test.ts:281` | 5–15 ms micro-settling sleeps | deliberate interleaving; acceptable |
| none | `Math.random` in BE tests (`admin-filters-pagination:92`, `orders-credentials-serialization:98,126,160`, `reencrypt-v1-credentials:101,112`, `pricing-coupon-legacy-bound:120`) | random **uniqueness** keys | assertions don't depend on values — harmless |
| none | `account-link-consent.test.ts:258`, `web-vitals-sampling.test.ts:92` | `Math.random` **pinned/mocked** | deterministic by design |
| none | date usage FE: `Date.now() ± offset` anchors (`flash-sale-banner:36,103-130`, `wallet-money-gates:97`, `flash-sales:100-138`) | relative anchors | immune to wall-clock drift |
| watch | `risk-load-more.test.tsx:64` fixed `2026-09-08` fixture; BE absolute-date fixtures in 8 files (`inspection-runner`, `neon-audit`, `redaction`, `pg-leader-lease`, `coupons-schema`, …) | fixed dates | harmless while no relative-time assertions ride them (see P3-5) |
| **zero** | fake-timer leaks | all 20+ `vi.useFakeTimers` files restore via root afterEach | verified per-file |

---

## 6. Verdict

- **Staged plan: GO.** T1 verified at HEAD (BE tests + FE e2e = **0 errors** under fresh types). T2 verified with **drift: 55 errors / 25 files** (not 49/22) — new checklist above is authoritative. T3 verified with 3 additions (`backup-db.ts:348` unbounded PUT fetch — the highest-ops-risk item, `inspect.ts:59` TS5097, backend-src pull in the program design).
- **One execution-blocking caveat (P1):** refresh shared dist (root `pnpm typecheck`) before measuring, or the lane inherits 17 phantom errors (8 BE + 9 FE).
- Test quality of the R125 batch: **high** — 1 P1 (infra), 4 P2 (drift + 2 live-e2e weak assertions + reintroduced sleep-races), 5 P3. No tautologies, no snapshots, no timer leaks, no state bleed.
- Money/auth coverage: broad and deep; the true gaps are admin-ops surfaces (whatsapp session lifecycle, risk rules/synth/dashboard, tickets mutations, diagnostics), listed with target files.

**SHIP-WORTHY** — with FIX-FIRST items for the next lane: (a) run `typecheck:libs` before T1/T2, (b) fix the 2 live-e2e search assertions (P2-2), (c) add `AbortSignal.timeout` to `backup-db.ts:348` alongside validate.ts:331,376.
