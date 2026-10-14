# Lane L16 findings — R143 (Architecture, maintainability & simplification)

Audit: R143-L16 @ `528ef39` (read-only; zero modifications, zero commits, zero
production calls). Scope: the 1,000-line size invariant & decomposition
contracts, duplication hunt (fetch families, error idioms, schemas, formatters,
near-twin components), dead code, overcomplexity, coupling/cycles, abstraction
debt, error-handling consistency, shared/ underuse, scripts hygiene.

Method: `wc -l` census over backend/src + frontend/src + shared (top-30 below);
growth-trend diffs at `08fa05c` (r136) → `a7fba31` (r137) → `3ba4ef1` (r140) →
`528ef39` (R142); targeted re-run of 4 decomposition pin suites (32/32 green);
rg-based duplication/dead-code/coupling scans (madge/knip/depcheck NOT installed
— manual import-graph probes at lib level instead); line-level reads of
custom-fetch.ts, admin-session.ts, loyalty.tsx, support.tsx, coupon-quote.ts,
utils.ts, migrate.ts, alerting.service.ts. Cross-refs: R142 findings-ledger,
lane O (docs truth), lane L6 (backend APIs — its L6-1/L6-2/L6-5 overlap my
fetch-family counts and are cross-referenced, not re-litigated).

---

## Top-30 largest files

(wc -l @ 528ef39; ⚠ = above the 1,000-line ceiling; 📌 = ceiling pinned by a
passing source-scan test; 🔓 = no pin; tests marked where applicable)

| # | Lines | File | State |
|---|-------|------|-------|
| 1 | 4,378 | backend/src/migrate.ts | ⚠ no pin (35 exported stages, one 1,925-line fn) |
| 2 | 1,078 | backend/src/services/alerting.service.ts | ⚠ no pin (720-line class) |
| 3 | 1,025 | backend/src/middlewares/__tests__/idempotency.test.ts | test file |
| 4 | 1,024 | backend/src/lib/spa-shell.ts | ⚠ crossed 1,000 IN R142 (986→1,024), no pin |
| 5 | 1,011 | backend/src/routes/admin/auth.ts | ⚠ crossed 1,000 IN R142 (994→1,011), no pin |
| 6 | 1,004 | backend/src/__tests__/openapi-response-contracts.test.ts | test file |
| 7 | 993 | backend/src/routes/admin/products.ts | 🔓 99% of ceiling |
| 8 | 961 | backend/src/services/checkout.service.ts | 🔓 |
| 9 | 918 | frontend/src/pages/checkout.tsx | 📌 <1000 (854 at r136 → +64 since) |
| 10 | 896 | backend/src/routes/admin/risk.ts | 🔓 |
| 11 | 883 | backend/src/services/__tests__/openwa-settle-gate.test.ts | test file |
| 12 | 883 | backend/src/routes/auth.ts | 🔓 |
| 13 | 876 | frontend/src/components/layout/Navbar.tsx | 🔓 +107 since r136, unpinned |
| 14 | 876 | backend/src/services/whatsapp-otp.service.ts | 🔓 |
| 15 | 850 | backend/src/routes/__tests__/admin-auth-lockout.test.ts | test file |
| 16 | 837 | frontend/src/pages/wallet.tsx | 📌 <1000 (773→837 since r136) |
| 17 | 835 | frontend/src/components/ProductCard.tsx | 🔓 |
| 18 | 826 | frontend/src/pages/admin/users.tsx | 📌 <1000 |
| 19 | 826 | backend/src/__tests__/spa-shell-rewrite.test.ts | test file |
| 20 | 823 | frontend/src/pages/admin/topups.tsx | 📌 <1000 |
| 21 | 806 | backend/src/routes/__tests__/wallet-topups.test.ts | test file |
| 22 | 805 | frontend/src/components/WhatsAppPhoneSignIn.tsx | 🔓 |
| 23 | 803 | frontend/src/components/admin/copilot/CopilotPanel.tsx | 🔓 |
| 24 | 795 | frontend/src/pages/product.tsx | 📌 <1000 |
| 25 | 769 | backend/src/services/catalog.service.ts | 🔓 |
| 26 | 768 | frontend/src/pages/order-detail.tsx | 🔓 unpinned page |
| 27 | 764 | backend/src/lib/boot-migrations.ts | 🔓 |
| 28 | 763 | frontend/src/pages/admin/orders.tsx | 📌 <1000 |
| 29 | 748 | frontend/src/components/layout/NotificationBell.tsx | 🔓 |
| 30 | 747 | frontend/src/pages/admin/products.tsx | 📌 <1000 |

## Size invariant verdict

**Breached on the backend, healthy-but-pressured on the frontend.**
4 source files exceed 1,000 lines (`migrate.ts` 4,378 · `alerting.service.ts`
1,078 · `spa-shell.ts` 1,024 · `admin/auth.ts` 1,011) + 2 test files. Two of
them (`spa-shell.ts` +43, `admin/auth.ts` +17) crossed the line **during R142
itself** — the K-1/K-2 shell fixes and TOTP hardening landed on already-980ish
files. The enforcement regime is one-sided: the frontend carries **27
decomposition pin suites** (25× `toBeLessThan(1000)`, home <700,
product-variants <500; re-verified green here: checkout/home/wallet/product,
32/32 tests), while the **backend carries zero file-size pins** — nothing can
fail CI when a backend file crosses the ceiling. The r136/r137 claim "no
source file above 1,000 lines" was frontend-scoped in practice; migrate.ts has
been 4.3K+ since before it. Frontend pressure: `checkout.tsx` 918 (92% of its
pin, +64 lines since decomposition), `wallet.tsx` 837, `Navbar.tsx` 876 with no
pin at all.

---

### L16-1 · P2 · The 1,000-line invariant has no backend enforcement — two files crossed during R142 unnoticed

- **Evidence (occurrence counts):** 4 backend source files >1,000 lines (top-30
  table); `git show` line history — `spa-shell.ts` 981 (r137) → 986 (r140) →
  1,024 (R142, +43: K-1 clamp + K-2 og arms, `git diff 3ba4ef1..528ef39 --
  backend/src/lib/spa-shell.ts` = +46/−8); `admin/auth.ts` 994 → 994 → 1,011
  (+17: TOTP hardening `528ef39`). rg over backend `**/*.test.ts` for
  `toBeLessThan(1000)`: 0 file-size pins (the one hit,
  redis-client-resilience.test.ts, pins an entry count). Frontend: 27 pin
  suites, all structurally present; 4 spot-run → green.
- **Root cause:** r136/r137 decomposition + its source-scan contracts were a
  frontend campaign; backend files sat at 980–993 with no tripwire, and R142's
  own fixes pushed two of them over.
- **Proposed fix:** one repo-wide source-scan gate in the backend suite (the
  r137 idiom): every `backend/src/**` non-test `.ts` < 1,000 lines, with an
  explicit, commented allowlist for `migrate.ts` (until L16-2) — or immediate
  per-file ceilings for `spa-shell.ts` (e.g. <1,100 after a small extract of
  the share/og rewrite arms) and `admin/auth.ts` (<1,050 after extracting the
  TOTP/lockout helpers that r142 grew).
- **Test requirement:** the gate itself is the test; run `pnpm --filter
  @workspace/api-server exec vitest run` to confirm green at the current tree
  (allowlist) and red when a file is padded past 1,000.
- **Risk:** low — test-only, no behavior change; the only cost is deciding the
  migrate.ts exemption explicitly.

### L16-2 · P2 · migrate.ts: 4,378 lines, one 1,925-line function — ⚠ flagged as a DANGEROUS refactor, not a quick win

- **Evidence:** `runMigrations()` spans backend/src/migrate.ts:2454–4378
  (~1,925 lines; 20 `if (` blocks inside); 35 exported stage functions above
  it; the fingerprint fast-path, force-reconcile, skip-state, and the full
  ordered chain all live in this one body. R142 ledger F-1: "runMigrations
  body never executed by any test — DEFER-ATTEMPT (chain test if small)".
- **Root cause:** the idempotent boot reconciler accreted ~30 stages as
  appended function + one call in the chain; nothing ever split the file
  because every stage is boot-critical and untested end-to-end.
- **Proposed fix (staged, strictly after F-1 lands):** (1) land the
  client.exec chain-apply test F-1 deferred; (2) move stages to
  `backend/src/migrate/stages/*.ts` (each already an exported, self-contained
  function — pure file moves, zero logic edits); (3) leave `runMigrations` as
  the ordered chain + fingerprint logic, target <600 lines; (4) pin with the
  L16-1 gate minus exemption.
- **Test requirement:** F-1's chain test + the existing per-stage suites +
  `migrate-v1m15.test.ts` + boot smoke; money suite untouched (no logic
  change).
- **Risk:** HIGH — this is the Neon-never-rolls-back boot path; a move-only
  refactor is safe in principle, but doing it before the body has ANY test
  coverage is how a truncated schema ships. Do not bundle with anything else;
  separate PR, separate round.

### L16-3 · P2 · Fetch-family fragmentation: 43 raw `fetch()` sites vs 2 wrappers; the hand-rolled admin idiom (raw fetch + isAdminUnauthorized + `.json().catch(() => null)`) repeated at 9 sites with no timeout

- **Evidence (occurrence counts):**
  - `customFetch` (shared/api-client-react/src/custom-fetch.ts, 671 lines): the
    gold standard — 20 s budget, boot-gate retry, 401 observers, safe envelope
    parse (ApiError).
  - `adminFetch`/`adminFetchJson` (frontend/src/lib/admin-session.ts:237/264):
    32 call sites across 21 files — good adoption, carries the 20 s D-3
    contract + admin 401 sentinel.
  - Raw `await fetch(`: **43 sites across 26 files** (rg census, non-test).
    ~9 ride react-query's unmount `signal` (loyalty.tsx:88/125,
    orders.tsx:223, notifications.tsx:104, NotificationBell.tsx:203,
    admin/system.tsx:91/116 …) — abort-on-unmount but **no timeout**; the
    other ~34 (support.tsx:92/135/202/235, profile.tsx:162/212,
    admin/users.tsx:427, admin/orders.tsx:134/377, admin/products.tsx:530/585,
    admin/promotions.tsx:214, admin/login.tsx:65/151, notifications mark/read
    ×3, WhatsAppPhoneSignIn ×2, SessionManager ×2, telegram-callback:151,
    onboarding:65, coupon-quote.ts:104, auth.tsx logout ×2, firebase-auth ×2,
    healthz, web-vitals beacon, boot-head-start, routes.tsx, admin-session
    itself) have **neither timeout nor abort**.
  - The 3-part hand-rolled idiom `await fetch(...)` → `isAdminUnauthorized(r,
    url)` → `(await r.json().catch(() => null)) as {error?, code?}` appears at
    **9 call sites in 6 admin files** (admin/orders.tsx ×2, products.tsx ×2,
    promotions/system/users/settings) — exactly what adminFetchJson already
    does, minus the timeout.
  - Cross-ref lane L6: L6-1 (R142 C-1's support half never landed — verified
    here: support.tsx unchanged since `3ba4ef1`, create/reply still
    `const d = await res.json();` unguarded at lines 211/237), L6-2 (D-3
    enumerated admin sites remain), L6-5 (user-side family). The R142
    IMPL-wave-report.md:19 row "PDP coupon + support → generated client +
    guarded parse" is only half-true in the tree: product.tsx:447 does ride
    the generated `validateCouponApi`, support does not.
- **Root cause:** per-round, per-page opportunistic fixes (G-1, C-1, D-3)
  without an adoption gate; every new feature that needs "just one POST"
  reaches for raw fetch because nothing fails when it does.
- **Proposed fix (highest real payoff in this lane):** (1) swap the 9
  hand-rolled admin sites to `adminFetchJson` (mechanical: same status/parse
  semantics, gains the 20 s bound + AdminSessionExpiredError); (2) swap the
  user-facing mutation family (support/profile/notifications/
  WhatsAppPhoneSignIn/SessionManager/telegram-callback/onboarding +
  coupon-quote) to customFetch (generated clients exist for most endpoints);
  (3) add a source-scan test pinning the raw-fetch allowlist to ~5 deliberate
  sites (web-vitals beacon, healthz poll, SSE copilot ask, logout
  fire-and-forget, boot-head-start) so the family cannot regrow.
- **Test requirement:** per-page render suites already exist for every one of
  these handlers (support, notifications, admin users/products/orders …);
  plus a new source-scan test `no-uncovered-raw-fetch.test.ts` asserting the
  allowlist. Full frontend suite (`pnpm --filter @workspace/subnation run
  test:run`).
- **Risk:** low–medium per site: adds timeouts (a previously-hanging request
  now fails honestly — that's the point), and 401s land in the global handler
  instead of per-page toasts (behavior already established by the 32
  adminFetch sites). Money paths (coupon-quote pre-flight) keep their
  fail-open contract — verify `checkout-coupon-fastfail` still green.

### L16-4 · P3 · `isSessionExpiredError` copy-pasted 6×; two idioms express one concept

- **Evidence:** byte-identical definition
  `(err as { status?: unknown } | null | undefined)?.status === 401` in
  alerts-inbox-meta.ts:68, topups-queue-meta.ts:19, chart-errors.ts:10,
  security-meta.ts:15, tickets-meta.ts:71, referrals-meta.ts:32 (**6
  definitions**); plus `instanceof AdminSessionExpiredError` quiet-catch at
  **32 sites across 12+ files** (rg census). Two different mechanisms
  (duck-typed `.status === 401` vs class sentinel) for "session expired —
  stay quiet".
- **Root cause:** r137 extracts were forbidden from importing page state, so
  each meta module re-declared the predicate locally rather than importing
  from lib/admin-session (which was allowed — it's React-free).
- **Proposed fix:** export one `isSessionExpiredError(err)` from
  lib/admin-session.ts covering both shapes (`err instanceof
  AdminSessionExpiredError || duckType401(err)`), import it in the 6 modules,
  keep the name so the decomposition tests' content pins
  (`"export function isSessionExpiredError("`) keep passing — they pin the
  string, which would now live once, so the 6 pins need a one-line update to
  point at the import instead.
- **Test requirement:** existing decomposition suites for the 6 domains +
  admin-session unit tests; add one unit test for the merged predicate (both
  arms).
- **Risk:** low — pure predicate consolidation; the duck-typed arm must keep
  accepting `adminFetchJson`'s `Error & {status}` (it does — that's what the
  6 copies were written for).

### L16-5 · P3 · Error-display census: 7 idioms; 37 hand-rolled message extractors bypass the Arabic leak-guard

- **Evidence (occurrence counts, non-test):** "show error to user" exists as
  (1) destructive toast — 88 calls / 29 files (21 of them the generic
  `title: "خطأ"` shape); (2) inline persistent state — 91 `setXError(` sites;
  (3) `FetchErrorCard` — 36 sites; (4) session-expired quiet-catch — 32 sites;
  (5) `ErrorBoundary` crash screen; (6) `AuthErrorBanner` (auth pages);
  (7) `OrderErrorBanner` (checkout money path, persistent by design).
  Idioms 1–3 are legitimately different (transient vs query-load vs
  money-persistent — each documented); the actual defect is in the message
  layer: `getErrorMessage()` (lib/errors, the 96-F7 Arabic-collapse guard) is
  used at **77 sites**, but **37 sites in 12 files** hand-roll
  `err instanceof Error ? err.message : "fallback…"` (support.tsx:218/245,
  profile, AuthProviders, TelegramLoginButton, admin products/promotions/
  admins/coupons/pricing/whatsapp, InventoryUploadDialog, CopilotPanel) —
  these leak raw English (`SyntaxError: Unexpected token` from an unguarded
  `r.json()`, `TypeError: Failed to fetch`) into Arabic toasts.
- **Root cause:** same as L16-3 — the helper exists, adoption was never gated.
- **Proposed fix:** mechanical swap of the 37 sites to
  `getErrorMessage(err) || "<existing Arabic fallback>"`; optionally extend a
  source-scan test to ban `instanceof Error ? err.message` outside
  lib/errors.ts.
- **Test requirement:** existing per-page suites; snapshot-ish assertions on
  Arabic fallbacks already exist in several (r111-F2 Q1 family).
- **Risk:** low — strictly narrows displayed text toward Arabic fallbacks.

### L16-6 · P3 · Two component→page import inversions; the settings domain is split across two trees

- **Evidence:** `frontend/src/components/admin/AdminScopeGate.tsx:3` —
  `import { AdminLayout } from "../../pages/admin/layout"` (a shared scope
  gate component depends upward on a page; AdminLayout's other 10 importers
  are all pages, so the direction is otherwise clean).
  `frontend/src/components/admin/settings-page/AuthProvidersList.tsx:1` —
  `import { ProviderCard … } from "@/pages/admin/settings/provider-card"`.
  The settings domain lives in BOTH `pages/admin/settings/` (3 tab extracts)
  and `components/admin/settings-page/` (10 extracts) — the r137 test itself
  documents the "-page suffix avoids colliding with the
  pages/admin/settings/* tab files" (admin-settings-decomposition-r137.test.ts
  header), i.e. the split is a historical collision workaround, not a design.
- **Root cause:** R126-L9 predated the r137 convention; the r137 wave routed
  around the existing files instead of moving them.
- **Proposed fix:** move `provider-card.tsx`, `account-tab.tsx`,
  `two-factor-setup.tsx` into `components/admin/settings-page/` (drop the
  collision suffix need), update the one import + the path references in the
  settings decomposition test; leave AdminScopeGate→AdminLayout as-is unless
  AdminLayout itself is ever extracted (moving AdminLayout to
  components/admin/layout/ would touch 10 pages + the layout pin — do it only
  alongside a real layout change).
- **Test requirement:** admin-settings decomposition suite (update the pinned
  specifier list), settings render suites (2fa re-enroll, provider-card error
  span).
- **Risk:** low — move-only; the pinned import lists make drift visible.

### L16-7 · P3 · Ceiling pressure: Navbar.tsx 876 unpinned (+107 since r136); order-detail 768 / profile 696 / cart 601 / category 514 have no pins; checkout.tsx at 92% of its ceiling

- **Evidence:** Navbar.tsx 769 (r136) → 876 (r140, +107) — the largest
  component in the repo, contains the drawer categories/trap-tab/accessory
  constants + 14 hooks in one file, zero extracts, zero pin. Unpinned pages
  >500 lines: order-detail.tsx 768, profile.tsx 696, cart.tsx 601,
  category.tsx 514 (census vs the 27 decomposition suites' coverage list).
  checkout.tsx 854 → 918 (+64 since its r136 decomposition; 3–4 more rounds
  at this rate breaches the pin), wallet.tsx 773 → 837.
- **Root cause:** pins were written only for the files that were decomposed;
  the r140 UX round grew never-decomposed surfaces (Navbar) untouched by any
  contract.
- **Proposed fix:** extend the r137 pin idiom — cheap one-file source-scan
  tests `<1000` for order-detail/profile/cart/category (and `<1,000` for
  Navbar) so growth becomes a visible decision; decompose Navbar (drawer
  family → `components/layout/navbar/`) the next time it is touched for
  feature work.
- **Test requirement:** the pins themselves; no behavior change.
- **Risk:** negligible — test-only.

### L16-8 · P4 · Duplicated money-format canon and Arabic-date pin across frontend/backend

- **Evidence:** the "en-US grouping + « د.ل»" canon is implemented twice —
  `frontend/src/lib/utils.ts:22 formatCurrency` and
  `backend/src/lib/money.ts:52 LYD_DISPLAY_FORMATTER/formatLyd` (topup.service
  + spa-shell consumers) — deliberately mirrored, and the mirror is already
  parity-pinned (share-card-bot-split.test.ts B8-D3: "web formatCurrency
  parity"). The `ar-LY-u-nu-latn` Latin-digits pin exists only in the
  frontend (utils.ts:79); backend Arabic date sites use bare `ar-LY`
  (telegram.ts:284, 654) — the exact 96-F7 class, though server Node ships
  full ICU so the Arabic-Indic fallback is theoretical there.
- **Proposed fix:** when shared/ is next touched for a real reason, hoist
  `formatLyd` + `AR_DATE_LOCALE` into `shared/` (a tiny
  `shared/format/src`); not worth a dedicated round — the parity tests make
  drift loud already.
- **Test requirement:** B8-D3 parity tests keep passing unchanged.
- **Risk:** low, but the payoff is equally low — INFO-grade unless other
  shared/format needs emerge.

### L16-9 · P4 · Money-cache invalidation pair repeated in 6 files; 66 invalidateQueries call sites

- **Evidence:** the `invalidateQueries(getGetMeQueryKey())` +
  `invalidateQueries(getGetWalletQueryKey())` (+ loyalty keys) block is
  repeated in socket-resync.ts, use-socket.ts, product.tsx, checkout.tsx,
  loyalty.tsx, wallet.tsx (6 files); 66 total invalidateQueries sites.
- **Proposed fix:** one `invalidateMoneyCaches(queryClient)` helper beside the
  query-client config. Payoff is small (each block is 2–4 lines, and the
  loyalty twin needs extra keys) — do it opportunistically.
- **Test requirement:** the loyalty/referrals shared-cache pin
  (loyalty-referrals-shared-cache.test.tsx) is the contract to keep green.
- **Risk:** low.

### L16-10 · P4 · Residue census: unregistered script, over-wide exports, retired-platform env reads

- **Evidence:** `scripts/inspect.ts` (604 lines, the MCP inspection entry
  point) is referenced by no package.json script and no CI workflow — only by
  R142 coverage docs; runnable only via its shebang. `export` keywords wider
  than consumers in lib modules (`directionFor`, `readChartColors`,
  `installUserUnauthorizedHandler`, `SENTRY_DSN_SET`, `escapeHtmlAttr`,
  `indexOfOutsideComments`, `ADMIN_SESSION_EXPIRED_MESSAGE` …) — all used
  internally, none dead, just exported without external consumers. Backend
  still reads `VERCEL_FRONTEND_ORIGIN` (lib/origins.ts:14/40) and
  `RENDER_INSTANCE_ID` (boot-migrations.ts:87, sentry.ts:227) — both
  platforms retired per .hermes.md; the reads are documented-compat
  fallbacks, harmless.
- **Proposed fix:** register `inspect` in scripts/package.json (`"inspect":
  "tsx ../scripts/inspect.ts"`) or add one doc line pointing at the shebang
  usage; drop the dead `export` keywords opportunistically; leave the env
  reads (removing them changes operator docs for zero gain).
- **Risk:** negligible.

### L16-11 · P4/INFO · shared/ underuse is marginal, not structural — and the residual is already a recorded decision

- **Evidence:** generated contracts are broadly consumed: 13 admin pages +
  storefront pages import `@workspace/api-client-react`; 6 backend route
  files import `@workspace/api-zod`; shared/db is the Drizzle source of truth.
  Type-name overlap census: 13 names declared in both frontend and backend —
  inspected the top candidates: `AppliedCoupon` (backend lib/pricing.ts vs
  frontend CouponCard.tsx) is same-name-DIFFERENT-shape (DB row vs wire
  shape), as are `AlertType`, `AtRiskRow`, `RiskState` — coincidence of
  naming, not copy-paste. The genuine wire-shape duplicates (notifications
  dual-shape N-5, pricing bare-object N-3) are exactly the R142 DEFER
  decisions (spec-churn/regen risk) — re-flagging them here would be noise.
- **Verdict:** no action beyond the recorded deferrals.

### Explicit non-findings (checked, clean — recorded so nobody re-audits blind)

- **Frontend formatting helpers:** centralized in lib/utils.ts (currency,
  count/plurals, dates, relative time); zero hardcoded `د.ل` concatenations
  outside prose; `copyToClipboard` reused by 5 call sites + CopyButton.
- **Backend error emission:** fully centralized — 385 `createErrorResponse()`
  calls, **0** raw `{error: "…"}` envelopes without a code.
- **Unreferenced components:** none (every component file under
  frontend/src/components is imported by a non-test file).
- **Orphaned CSS:** spot-check of the first 60 custom classes in index.css —
  all referenced.
- **Dormant feature flags:** none found (VITE_/process.env census all live;
  Firebase gated by presence with documented fallback).
- **Circular deps:** manual import-graph probe around the lib core
  (auth ↔ firebase-auth/socket/user-session/cart) — no 2-cycles; backend:
  lane L6's cycle scan over all non-test backend files reports clean. (madge
  not installed; probes were targeted, not exhaustive — the L16-6 inversions
  are the only direction violations found.)
- **Props drilling:** deliberate, pinned architecture — decomposition tests
  enforce "extracts take values + callbacks only" and "no extract re-declares
  page state". Introducing contexts to "fix" drilling would fight the
  contracts; not debt.
- **State-that-should-be-server-state:** the one candidate
  (admin/orders credentialsCache) is the deliberate D-2 retry-affordance
  design, pinned by tests.
- **Decomposition contracts:** 27 suites present; 4 spot-run (32/32 green) —
  the r136/r137 pins hold at HEAD.

---

### Prioritized consolidation shortlist (payoff × risk)

1. **L16-3** raw-fetch/adminFetchJson consolidation + adoption gate — the
   single highest-value simplification (removes ~34 unbounded requests AND
   the C-1/D-3 truth gap in one sweep).
2. **L16-1** backend size gate — 30 lines of test, closes the seam two files
   already fell through during R142.
3. **L16-5** getErrorMessage adoption (37 sites) — rides the same
   per-page-edit pass as L16-3.
4. **L16-4** isSessionExpiredError ×6 → 1 — small, self-contained, real.
5. **L16-7** ceiling pins for the 5 unpinned >500-line surfaces — cheap
   tripwires while the codebase is honest.

**Danger-flagged (do not batch):** L16-2 migrate.ts split — only after R142
F-1's chain test exists; boot-critical, Neon never rolls back.
