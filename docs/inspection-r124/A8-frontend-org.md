# R124-A8 — Frontend code organization, dead code & duplication audit

**Repo:** SubNation2 @ `c736d13` · **Scope:** `frontend/src/**` (124 non-test source files, 128 test files, 76,456 total LOC incl. e2e), `frontend/e2e`, `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `tsconfig.json`, `package.json`.
**Mode:** READ-ONLY audit (ponytail discipline: deletion beats addition, smallest complete change). Every "zero importers" claim below was verified by grep across the WHOLE repo (frontend + backend/src + shared + e2e + configs), including test files.

**Headline:** This frontend is in unusually good shape for a 191-file React app — zero console.log, zero debugger, zero ts-ignore, zero barrels, zero commented-out code, 128/128 tests colocated in `__tests__` with `.test.` suffix, money/date formatting centralized in `lib/utils.ts` (130 `formatCurrency` call sites). The remaining debt is concentrated in three places: **8 provably-dead exports**, **two JSX patterns copy-pasted 25× and 8×**, and **five oversized page monoliths**.

---

## Findings

### 1. [P2] Dead exports — 8 names, 6 files, ~65 LOC deletable (verified zero importers repo-wide)

Detection: scripted named-export extraction + whole-repo usage scan (incl. `__tests__`, e2e, backend), then manual grep confirmation of each candidate.

| Location | Dead export | Notes |
|---|---|---|
| `src/lib/firebase-auth.ts:114,139,147` | `exchangeCurrentFirebaseUser`, `refreshCurrentFirebaseSession`, `resetFirebaseAuth` | ~25 LOC. (Sibling `refreshFirebaseSession` at :126 is ALIVE — called at :217; do not delete.) |
| `src/lib/boot-sentry.ts:106-124,~218` | `enqueueSentryOp` + the whole queue mechanism (`SentryOp` type, `opQueue`, the drain loop at :218-219) | ~20 LOC. `enqueueSentryOp` is the ONLY pusher to `opQueue` and has zero callers → the queue can never fill → the drain loop is dead weight too. Its doc comment promises a deferral pattern nothing uses. |
| `src/lib/healthz.ts:73` | `hasCriticalFailure` | ~12 LOC incl. doc comment. |
| `src/lib/errors.ts:227` | `isErrorCode` | 6 LOC ("Helper function to check…" — never wired). |
| `src/lib/direction.ts:35` | `DEFAULT_DIR` | 1 LOC (twin `DEFAULT_LANG` is alive). |
| `src/components/ui/status-badge.tsx:144` | `type TicketStatus` | 1 LOC. (`TICKET_STATUSES` at :143 is ALIVE — test-covered in status-badge-v2.test.tsx:107 + documented follow-up consumer.) |

**Fix:** delete the exports (and the boot-sentry queue mechanism) in one commit. **Impact:** −65 LOC of misleading API surface; `firebase-auth.ts` shrinks to exactly what the auth bridge uses. **Risk:** zero — no importer exists anywhere, including tests.
*Not dead (verified, exported-for-tests with dedicated test files): `shapeForRoute`, `RouteAnnouncer`, `isHomeBootPath`, `isRetryableQueryError` (App.tsx), `NAV_SECTIONS`, `MAX_LINE_QUANTITY`, `isFirebaseBackedUser`, the `__reset*ForTests` family.*

### 2. [P2] Fetch-error card JSX duplicated ~25× across 19 files — top extraction candidate (~460 LOC net reduction)

The same "API outage card" — icon tile `w-1x h-1x mx-auto mb-x rounded-2xl bg-status-error/8 border border-status-error/22 flex items-center justify-center` + `WifiOff` icon + bold title + muted subtitle + retry `Button` — is hand-rolled at:

- **Storefront (14 sites / 10 files):** `orders.tsx:378`, `product.tsx:800`, `order-detail.tsx:220`, `wallet.tsx:473,1157,1874`, `profile.tsx:232`, `referrals.tsx:255`, `loyalty.tsx:466,835`, `support.tsx:762`, `flash-sales.tsx:268`, `home.tsx:1170`
- **Admin (11 sites / 11 files):** `admin/tickets.tsx:450`, `admin/security.tsx:313`, `admin/topups.tsx:1089`, `admin/dashboard.tsx:1041`, `admin/promotions.tsx:433`, `admin/referrals.tsx:439`, `admin/admins.tsx:185`, `admin/orders.tsx:1422`, `admin/products.tsx:1177`, `admin/users.tsx:1086`, `admin/alerts.tsx:583`

Each block is 18–22 JSX lines; the variants differ only in icon-tile size (w-12/w-14/w-16), title text, and button sizing. Several carry near-identical explanatory comments ("Distinct from the empty state: an API outage previously rendered…").
**Fix:** one `<FetchErrorCard title onRetry size?>` in `components/ui/` (sibling of the existing admin `EmptyState`, which solved this exact problem for empty states in round 93-C7). **Impact:** ~25 × 20 ≈ 500 LOC → ~35 LOC shared ⇒ **~460 LOC net**, plus one place to fix a11y/spacing/44px-tap-target issues next time.

### 3. [P2] Load-more button block duplicated 8× across 6 files (~110 LOC net reduction)

Identical 14–16-line block (Button + `Loader2`/`RefreshCw` spin + `جارٍ التحميل…` / `ChevronDown` + `تحميل المزيد`, wired to `fetchNextPage`): `admin/tickets.tsx:536`, `admin/topups.tsx:1270`, `admin/orders.tsx:1455` **and** `:1632` (twice in one file), `admin/users.tsx:1301`, `admin/alerts.tsx:742`, storefront `orders.tsx:434` and `:607`.
**Fix:** `<LoadMoreButton busy onClick/>` (8 lines). **Impact:** ~128 LOC → ~15 ⇒ **~110 LOC net**; kills the drift already visible (three different spin icons for the same affordance).

### 4. [P2] `dashboard.tsx` formats dates with bare `"ar-LY"` ×5 — violates the repo's own documented 96-F7 Latin-digits pin

`src/pages/admin/dashboard.tsx:137,139` (chart week/month keys) and `:771,872,966` (chart tooltips) call `toLocaleDateString("ar-LY", …)`. `lib/utils.ts:61-70` documents this exact class as forbidden: engines without ar-LY locale data fall back to root `ar`, whose CLDR default numbering is Arabic-Indic (٠١٢…) — silently breaking the site-wide Latin-digits convention on older Safari/WebView. Every other formatter pins `"ar-LY-u-nu-latn"` (utils.ts, `StockoutRiskPanel.tsx:108`, `settings.tsx:712`); dashboard is the only bare-locale outlier.
**Fix:** one local `const fmtChartDate = (d, opts) => d.toLocaleDateString("ar-LY-u-nu-latn", opts)` or reuse `formatDateShort`; 5 call sites. **Impact:** closes the last 96-F7-class hole; chart digits stop being engine-dependent.

### 5. [P3] Hook filename convention broken by 2 of 11 hooks

`src/hooks/` is kebab-case ×9 (`use-admin-headers.ts`, `use-confirm.tsx`, …) but `useKeyboardShortcuts.ts` and `useSeo.tsx` are camelCase. Everything else is consistent: pages kebab-case, components PascalCase, `components/ui/*` kebab (shadcn convention), tests `<name>.test.tsx` in `__tests__/`, e2e `<name>.spec.ts`.
**Fix:** `git mv` to `use-keyboard-shortcuts.ts` / `use-seo.tsx` + update ~11 import specifiers. **Impact:** pure consistency; a new engineer's "which convention?" question has one answer per directory.

### 6. [P3] Typecheck gate excludes all 128 test files — asymmetric with backend

`tsconfig.json:4` `exclude: […, "**/*.test.ts", "**/*.test.tsx", "src/test/**"]`, and `typecheck` (package.json:10) runs only that tsconfig. Vitest transpiles without type-checking ⇒ **~26k LOC of test code (over half the frontend by file count) has no type gate** — a wrong mock shape only fails when the touched path executes. Backend `tsconfig.json` includes its tests (`"include": ["src"]`), so this is a frontend-only choice with no documenting comment.
**Fix:** smallest complete change — remove the three test-excluding entries from `exclude` and add `"types": ["node", "vite/client", "vitest/globals"]` (globals are on). Run once; fix whatever surfaces. **Impact:** mock drift caught at `pnpm typecheck` instead of mid-round.

### 7. [P3] 38 non-test files exceed 400 lines; five monoliths warrant a split

Full list (top 15): `pages/product.tsx` 2116 · `pages/wallet.tsx` 1981 · `components/admin/copilot/CopilotPanel.tsx` 1676 · `pages/admin/orders.tsx` 1654 · `pages/admin/system.tsx` 1629 · `pages/checkout.tsx` 1554 · `pages/admin/settings.tsx` 1472 · `pages/admin/products.tsx` 1455 · `pages/admin/pricing.tsx` 1335 · `pages/admin/users.tsx` 1329 · `pages/admin/topups.tsx` 1296 · `pages/home.tsx` 1284 · `pages/admin/layout.tsx` 1186 · `pages/admin/dashboard.tsx` 1114 · `App.tsx` 959. (Also >400: loyalty 922, support 903, alerts 769, ProductVariantsDialog 760, WhatsAppPhoneSignIn 731, coupons 729, tickets 728, admins 694, NotificationBell 657, ProductCard 642, order-detail 632, orders 631, profile 597, admin/referrals 570, auth.tsx 563, promotions 559, InventoryUploadDialog 551, referrals 541, whatsapp 511, route-skeleton 430, cart 426, risk 425, category 418, TopupWaitingModal 407.)

Top-5 one-line judgments:
1. **`product.tsx` 2116 — should split.** The page component itself is one ~1,200-line function (:277–1485); the module already contains 7 private components (`CopyField`, `CouponField`, `CtaBlock`, `VariantSelector`, `RecommendationsSection`, …) and a 70-line buy-intent-key helper block (:148–218) that belong in `components/product/` + `lib/`.
2. **`wallet.tsx` 1981 — should split.** Same shape: `WalletStatementCard`, `TransferCodePanel`, `InstructionsPanel`, `LedgerEntryRow`, `StepDot`, preference-storage helpers — a `components/wallet/` folder is mechanical.
3. **`CopilotPanel.tsx` 1676 — should split.** History view is already extracted (`CopilotHistoryView`); the panel still mixes streaming, tool-renderers and markdown handling.
4. **`admin/orders.tsx` 1654 — should split.** Bulk-status bar, row expansion drawer and filters are independently testable units.
5. **`admin/system.tsx` 1629 — acceptable.** Mostly declarative metrics/health tiles; low branch density, splits would be arbitrary seams.

`App.tsx` 959 — **acceptable**: it is app-shell wiring (lazy route table, skeleton shapes, boot head-start, gates), all one concern; splitting adds indirection. `admin/layout.tsx` 1186 carries the global-search + copilot mount — borderline, acceptable.

### 8. [P3] e2e is guest-only by design; 4 admin pages have no dedicated component test either

e2e coverage map (10 spec files, `E2E_ENABLED`-gated, chromium + Pixel-7 projects): API contracts (healthz/products/stats/providers), auth gates on money pages, cart→checkout guest gate, category chip nav + back, home shell + console-error assertion, login provider surface, mobile-390 overflow + 44px tap targets, product-detail price/stock honesty, Arabic search normalization, SEO shells (robots/sitemap/404 noindex). **Zero authenticated flows by documented contract (playwright.config.ts header) — no admin/wallet/topup/orders-history e2e.** Component-level: 22/22 storefront pages and 17/21 admin pages have dedicated `__tests__` files; **`admins.tsx`, `enrichment.tsx`, `risk.tsx`, `risk-event.tsx` have none** (only indirect coverage via admin-layout tests).
**Fix (smallest):** one regression test each for the 4 uncovered admin pages (their shared EmptyState/TableSkeleton/confirm patterns are already mock-idiomatic), before any e2e expansion. e2e expansion for admin needs an auth fixture strategy — a separate decision, not this audit's call.

### 9. [P3] Type-safety near-misses: 1 real `any`, 4 non-null assertions, 0 suppression comments

- `pages/profile.tsx:67` `useState<any[]>([])` for linked providers — the ONLY real `any` in src (grep `: any` / `as any` / `any[]` / `Array<any>` = 0 elsewhere; 0 in tests).
- Non-null assertions (4, non-test): `lib/analytics.ts:69` `window.dataLayer!.push` (guarded above — acceptable), `pages/admin/dashboard.tsx:517` `stats!.pending_topups`, `pages/admin/products.tsx:1239` `e.currentTarget.parentElement!.classList`, and the cluster case `pages/product.tsx:729` `productAny?.faq … productAny!.faq!.length` (×4 assertions on the legacy-numeric product payload — this is where external-data assertions cluster).
- `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck`: **0** in src and e2e.
**Fix:** type `linkedProviders` from the providers response; replace `stats!` with the null-guard the sibling tiles already use; `product.tsx:729` collapses to one optional chain. **Impact:** cosmetic-to-real; `profile.tsx` is the only one that can hide a runtime shape surprise.

### 10. [P3] Sub-threshold duplications (noted, not actioned — ponytail)

- `fmtFactor` defined twice verbatim (`ProductVariantsDialog.tsx:70`, `admin/pricing.tsx:228`); `fmtUsd`/`fmt` money helpers ×2. Below the ≥3 bar; fold into finding 2's shared module only if it lands.
- 404-detection cast `isError && (error as { status?: number })?.status === 404` ×2 (`product.tsx:361`, `order-detail.tsx:174`) — a `isNotFoundQueryError(e)` util would fit `lib/errors.ts` next to the dead `isErrorCode` (finding 1) as its replacement.
- Arabic category labels live in both `utils.ts:141 categoryLabel` (incl. retired cats) and `lib/categories.ts CATEGORY_META[*].label` — 2 sites, intentionally different scopes (landing metadata vs chip label); leave.
- 4 local `TableSkeleton()` wrappers (`admin/referrals:74`, `orders:136`, `coupons:58`, `users:161`) are thin per-page cell configs over the shared `components/admin/TableSkeleton` — the documented 93-C7 design, not duplication.

### 11. [P3] Structure coherence — verdict: predictable, keep as-is

The rules a new engineer can infer in a day: `pages/` = one file per route (kebab), `pages/admin/` mirrors the admin URL space; `components/` = reusable React units (PascalCase), `components/ui/` = design system (kebab, shadcn), `components/admin/` = shared admin primitives + heavy dialogs + copilot/forecast panels (all verified used: EmptyState ×11 pages, TableSkeleton ×6, CopyButton ×9), `components/layout|seo/` = chrome/meta; `hooks/` = `use-*`; `lib/` = cross-cutting non-UI (contexts `auth/cart/theme` correctly `.tsx`, the rest plain `.ts`), `lib/admin/` = admin-only helpers. Entry files at src root (`App/main/instrument`) standard. No `pages/`-exported component is consumed by another route. **Zero `index.ts` barrels** — imports are all direct file paths, so no re-export indirection exists to clean. `vite.config.ts` (build, plugins, bundle budget) vs `vitest.config.ts` (minimal) split is deliberate and documented — good hygiene.

### 12. [P3] Hygiene sweeps — all clean (evidence)

`console.log` in non-test src: **0** (18 `console.warn/error` across 11 files, all diagnostic, no debug spam) · `debugger`: **0** · `@ts-ignore`: **0** · commented-out code blocks: **0** (the 3 grep hits are prose comments; `{/*…*/}` JSX comments are documentation) · `statusColor` retired function: 0 live references (17 comment mentions only) · `dist/` git-ignored · package.json scripts minimal and used (`dev/build/serve/typecheck/test/test:run/test:e2e/test:ui`).

---

## Quick wins — pure deletions/renames, zero behavior risk

1. **Delete the 8 dead exports** (finding 1) — one commit, −65 LOC, no importer anywhere.
2. **Rename the 2 camelCase hooks** to `use-keyboard-shortcuts.ts` / `use-seo.tsx` (+ ~11 import lines) (finding 5).
3. **Type the one `any[]`** in `profile.tsx:67` (finding 9).
4. **Replace `isErrorCode`'s slot in `lib/errors.ts` with `isNotFoundQueryError`** while fixing finding 1 — net-zero API surface growth while deduplicating the 404 casts (finding 10).
5. **Extract `FetchErrorCard` + `LoadMoreButton`** (findings 2–3) — mechanical, covered by existing per-page tests, **~570 LOC net reduction**, and the two components are the last missing shared-state primitives (EmptyState/TableSkeleton already exist for the other two states).

## Priority counts

**P0: 0 · P1: 0 · P2: 4 · P3: 8**

## Estimated deletable LOC

- Dead code (finding 1): **~65 LOC now.**
- Duplication extraction (findings 2+3): **~570 LOC net** at full adoption.
- Combined ceiling: **~635 LOC (~8% of non-test frontend src)** — before any file splits (finding 7), which are reorganizations, not deletions.

*Not checked: bundle-size impact of the proposed extractions (trivial — both are tree-shaken shared components); the 4 admin-page tests in finding 8 were proposed, not written (read-only mandate). No behavior changes proposed to inventory/catalog/restock or WhatsApp pairing surfaces — none of the findings touch them.*
