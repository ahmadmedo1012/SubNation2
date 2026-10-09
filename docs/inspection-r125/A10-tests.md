# R125-A10 — Test Quality + Coverage-Gap Audit (admin console + round risk areas)

**Repo:** SubNation2 @ `09857fc` (main, clean tree) · **Agent:** R125-A10 (read-only) · **Deliverable:** this file only.

**Scope:** test quality + coverage gaps for the 21 admin pages (`frontend/src/pages/admin/*.tsx`) + shared admin components (`components/admin/*`, `copilot/*`), the money-path storefront suites, `frontend/e2e/`, and the flake/hygiene surface of the FE suite. R125 A1–A6 reports (read in full) are the requirements list; R124-R1's "test honesty" verdict is the baseline — this audit finds the GAPS, not the culture.

**Method:** static-first. Full read of all 33 `pages/admin/__tests__` files' describe/it trees + targeted full reads (topups-approve-confirm, referrals-search-race, dashboard-chart-scope-gate, admin-layout-alerts, copilot-persistence, no-native-confirm, settings-security-facts-copy, socket-initializer-resync, e2e/cart-gate, playwright.config, vitest.config, src/test/setup.ts); assertion-density heuristics (expect-per-it counts for every admin file); greps for fake timers / real-timer sleeps / snapshot / Date usage / mock duplication; cross-referenced against A1–A6 findings and A4's §C data-contract table. No test runs (static evidence sufficed); no source files modified; no commits; production untouched.

**Premise check (honesty first):** the brief says "the orders memo test exists as the pattern" for the topups memoization pin — **no memoization/render-count test exists anywhere in the FE suite at HEAD** (repo-wide grep: zero render-count/Profiler/`React.memo` assertions; the closest artifact is a mock-setup comment at `products-error-bulk.test.tsx:128-131`). The R124-I5 memoization work on users/products/referrals and the R118-B2 orders pattern (`orders.tsx:230/:393/:647-654`) are **entirely unpinned**. The topups pin (C-10) must CREATE the pattern; a source-scan idiom (already accepted in this repo) is the S-effort version.

---

## A. Admin coverage map — 21 pages + shared components

Test counts = `it()` cases in the file(s). "Unpinned" = behaviors with NO test at HEAD (drawn from A1–A6 findings + this scan).

| # | Page (LOC) | Test file(s) | # | Pinned invariants (abridged) | Unpinned (gap) |
|---|---|---|---|---|---|
| 1 | **topups** (1,356) — money queue | topups-approve-confirm (4), topups-approve-all (5), topups-queue-search (3), topups-bulk-note (2), topups-dialogs-a11y (5) | 19 | single-approve confirm shows amount+phones+ref; per-click Idempotency-Key header; 409 envelope surfaced; approveAll styled-confirm + busy re-click guard + live progress + one summary toast; bulk note rides every row; client search matches phone+reference with honest count + partial-window hint; reject/bulk modals trap focus, ESC guarded in-flight | **bulk-approve contrast 2.57:1 (A6-B-3 P1)**; single-row approve 3.77:1 (A6-B-5); select-all aria-pressed + state-aware label (A1-6); **memoization — the entire F2 pattern (A5)**; «معلق» vocabulary ×3 (A1-8); tab-empty CTA (A1-13); footer «إجمالي معلق» |
| 2 | **orders** (1,649) | orders-bulk-status (7), orders-false-empty-pagination (9), orders-row-expansion-a11y (7) | 23 | bulk confirm + 207 partial Arabic reasons + finance-gated refund + keyboard menu; error≠empty, stale-refresh banner; load-more + full-page heuristic + «عرض N» + partial-empty honesty (never hard-empty over paged data); server search + deep-link prefill; credentials fetch-once/masked; selectors named + aria-pressed | footer partial-window «إجمالي» (A1-10); memoization (R118-B2 unpinned); «30 يوم»→«يوماً» + dead ternary 1366 (A1-11); raw-fetch migrations (A4-B-1) covered only incidentally |
| 3 | **users** (1,362) | users-wallet-confirm (12), users-loyalty-derived-tier (3) | 15 | wallet confirm w/ resulting-balance preview + cancel + idem key + note gates + overdraw + negative clamps + ESC-while-mutating; loyalty-only save skips money confirm; untouched-form honesty; tier read-only + backend 400 copy surfaced | «مسح الفلاتر» URL write-back (A1-1 **P2**); wallet-amount htmlFor/id (A1-2 **P2**); tier-empty over partial window (A1-7); wallet-mode segmented control aria-pressed; memoization; per-intent key retention on 409 (A4-B-10-3) |
| 4 | **products** (1,573) | products-error-bulk (13), products-seo-submit (5) | 18 | error≠empty + retry; bulk honest summaries (partial/total-fail/success); one-way-door archive confirms (single+bulk); #new deep link; server search after debounce; 200-cap honesty + clear-search a11y; SEO omit-on-untouched + explicit-null semantics | SEO **seed** (A4-B-2/A2-3 — write-only editor); Esc dirty-guard + dialog containment (A2-14); memoization; stats co-invalidation (A4-B-3) |
| 5 | **layout** (1,199) | admin-layout-alerts (8), admin-layout-pill-search-scope (5), admin-layout-nav-scope (4), global-search (3) | 20 | badges server-sourced, error=unknown-never-0, scope-gated polling (finance/support matrices); last-updated pill 3-state honesty; GlobalSearch scope-honest fan-out + stale-response drop + ?search= navigation; nav-scope↔API-permission parity (static) | **document.title never set (A6-B-1 P1)**; skip link (A6-B-7); hamburger/collapse names + expanded (A6-B-11); nav aria-current (A6-B-12); drawer focus trap (A1-9d); palette Radix trap/return/listbox groups/live count (A6-B-9); pill 5s tick isolation (A5-F9) |
| 6 | **dashboard** (1,106) | dashboard-chart-scope-gate (3) | 3 | chart payload finance-gated at fetch level; honest no-data ≠ scope-silence | **chart race — no abort/seq (A1-3/A5-F1 P2)**; handleRefresh double-fires stats (A1-4); admin-stats-update socket pin (A4-B-10-1); displayData useMemo (A5-F7); charts unmount-to-skeleton (A5-F8); period/granularity aria-pressed; TrendBadge SR direction; **everything render-level** — 3 tests for the default landing page |
| 7 | **pricing** (1,339) | pricing-console (8) | 8 | variant selection + variant_id; risk state w/ why-text + worst-case; no frozen constants (referral_cost from API); two-step recompute (dry-run zero-write, destructive confirm w/ counts, failed-dry-run honesty); config bounds 10–95 | auto-calc race guard (A2-11); referred-buyer Switch accessible name (A2-10a); fmt vs formatCurrency grouping (A2-10b) |
| 8 | **settings** (1,493) | settings-security-facts-copy (2 — **source-scan only**) | 2 | two copy strings pinned by file-content scan | **nearly everything** — 2FA re-enrollment dead end (A3-1 **P2**), provider toggles, integrations, tab-scope gating, password flows; no render suite exists (the test's own header admits it) |
| 9 | **system** (1,629) | system-scheduler-banner (3) | 3 | scheduler banner 3-mode contract (single/embedded/stale-heartbeat) | diagnostics error copy, observability loaders, metrics panels, RBAC deep-link honesty (A3-11), lazy charts (A5-F3), raw sentinel loader (A4-B-1) — 3 tests for the 2nd-biggest page |
| 10 | **alerts** (749) | alerts-load-more (4), alerts-delete-confirm (3) | 7 | accumulating load-more + hasMore + honest «عرض N من M» counts; optimistic mark-read rollback + failed-delete-read toast; single-delete confirm naming title+type, cancel=no request | **hover-only row actions invisible to focus (A6-B-2 P1)**; chips aria-pressed + 2 missing type filters; deleteAll inline نعم/لا (A3-6); 20s cadence rationale; read-row contrast/unread SR cue |
| 11 | **coupons** (731) | coupons-tz-roundtrip (6) | 6 | TZ roundtrip (local→UTC-Z, null); parity guards (100% block, 10k cap, clear-on-correct); draft preserved on dismiss | **no failed-load/error pin at all** (stale banner coupons.tsx:548 unpinned); delete = soft-archive label + no busy guard (A2-16); mobile unlabeled cells (A2-17); expiry sort (A2-22) |
| 12 | **referrals** (615) | referrals-error-state (4), referrals-finance-gate (3), referrals-search-race (2) | 9 | error≠empty + retry; credit finance-gate (disabled w/ reason, no request); debounce race (stale drop + AbortSignal) | 200-cap honesty + stats contradiction (A2-5 **P2**); `*50` literal (A2-7); statusLabel vocab + chip aria-pressed (A2-8); silent refresh + double-fetch (A2-12/13); memoization |
| 13 | **promotions** (579) | promotions-activate-confirm (3) | 3 | error toast ≠ fake-clean history; activate confirm states %, cancel=no PATCH | delete/pause verb+toast collision (A2-6 **P2**); 30-day client validation; English "Flash Sale" default; busy guards; silent refresh |
| 14 | **tickets** (714) | tickets-error-state (5) | 5 | error≠empty + 401 + retry; detail-failure toast; zero-rows honest empty | **has_unread_admin computed-but-never-rendered (A3-3 P2)**; no freshness mechanism (A3-7); filter-aware empty + CTA; reply/status flows; stats co-invalidation |
| 15 | **whatsapp** (519) | whatsapp-session-actions (4) | 4 | delete via styled confirm (cancel=no DELETE); pair-code copy feedback; docs deep-link degradation | pair-code staleness cue (A3-12); list-blanks-on-action (A3-4c); skeleton taxonomy; action-error proximity |
| 16 | **security** (378) | security-error-state (4) | 4 | stats/activities error≠empty + retry; action enum Arabic mapping | 100-cap honest count + race guard + CSV disclosure (A3-5); adminFetchJson-ification (A4-B-1) |
| 17 | **login** (308) | admin-login-cookie-session (5) | 5 | cookie-only bootstrap (probe, token-less 2FA body), honest cookie-failure, wrong-OTP Arabic error, double-Enter no-op | 2FA-back keeps stale tempToken (A1-12b); `required` browser-locale bubbles (A1-12a) |
| 18 | **risk** (425) | — (**ZERO render tests**; static-only: no-native-confirm, nav-scope parity) | 0 | nothing behavioral | **error banner + false EmptyState render together (A3-2 P2 — the B5-04 contract broken on a fraud queue)**; hasMore ignored (A4-B-6); chips aria-pressed; row-click affordance (A3-10); RBAC deep-link (A3-11) |
| 19 | **risk-event** (331) | — (**ZERO**) | 0 | nothing | label mutation feedback idiom; list/dashboard co-invalidation (A4-B-3); notes label; everything |
| 20 | **enrichment** (387) | — (**ZERO**) | 0 | nothing | **drafts 26+ invisible, cursor unused (A2-1 P2)**; **edit-publish no confirm (A2-2 P2)**; skeleton/error-retry; panel_url; dirty guard; toast idiom |
| 21 | **admins** (696) | — (**ZERO**; static nav-parity only) | 0 | nothing | last-admin guard UI (backend pinned, UI not); scopes grid + retry dead-end (A3-9); skeleton taxonomy (A3-4b) |

**Shared admin components (no `components/admin/__tests__` directory exists):**

| Component (LOC) | Tests | Pinned | Unpinned |
|---|---|---|---|
| copilot/CopilotPanel (1,676) | copilot-persistence (4, **pure-unit on exported sanitizers**) + copilot-copy (3, copy path only) | localStorage round-trip never persists `loading:true`; copy routes shared helper | entire render/UX surface (1,676 lines — the biggest admin file); history, streaming, focus |
| copilot/CopilotHistoryView (164) | — | — | everything |
| ProductVariantsDialog (760) | — | — | **7 unlabeled money fields (A2-4 P2)**; busy guards; its own error-retry (correct at HEAD, unpinned) |
| InventoryUploadDialog (551) | — | — | display-layer only per standing order; toast variant residual («تم الرفع» default-blue) |
| forecast/StockoutRiskPanel (359) | — | — | **inert `?highlight=` CTA (A2-9)**; aria-expanded |
| EmptyState (51) / TableSkeleton (49) | — (pinned indirectly via page suites) | empty-vs-error rendered by 8+ page tests | `role="status"` live regions (A6-B-8) |

**Headline:** 4 of 21 pages have ZERO render tests (risk, risk-event, enrichment, admins — 1,839 lines of admin surface guarded only by 2 static source-scans); settings is effectively untested (2 copy pins / 1,493 lines); dashboard and system carry 3 tests each against 1,100–1,600 lines. Cross-cutting guards that DO stand watch everywhere: `no-native-confirm.test.ts` (17 files), `status-tokens/status-badge-v2`, `a4-f1-nesting-sweep`, socket-resync, idempotency lib.

---

## B. Weak-assertion scan (admin + money-path storefront)

**The suite is strong.** Repo-wide: **zero snapshot tests**; zero smoke-mount-only admin tests (assertion density ≥2 `expect`/`it` in every admin file — measured, see Method); negative paths are the norm (error≠empty suites exist on 8 pages; idempotency 409-retention, fail-open/fail-closed, boundary values 10,000/10,000.01/0.01 are pinned on storefront money paths). The weakness is concentrated, not systemic:

1. **Source-scan stopgaps standing in for render suites** (documented as stopgaps by their own headers — honest, but they are the weakest links): `settings-security-facts-copy.test.ts` (2 string pins / 1,493-line page); `no-native-confirm.test.ts` (regex over file text); `admin-layout-nav-scope.test.tsx` (grep parity tables, never renders). **Class: accident-of-coverage — fine as intent, must not outlive Wave 2.**
2. **`copilot-persistence.test.ts`** — pure-unit on two exported helpers; the 1,676-line component's render behavior has no pin (persistence sanitizers are the only seam). Adjacent `copilot-copy.test.tsx` covers only the clipboard path. **Test-the-helper-not-the-UI class.**
3. **`dashboard-chart-scope-gate.test.tsx`** — 3 tests, fetch-gating only; no dashboard data-rendering pin exists (chart race, refresh double-fire, KPI honesty all unpinned).
4. **`promotions-activate-confirm.test.tsx`** — 3 tests; the page's other money-adjacent actions (delete, create, toggle) have no pins.
5. **`topups-bulk-note.test.tsx`** — 2 happy-path tests only (no failure branch for the note loop).
6. **`coupons` has no failed-load pin at all** — the stale-refresh banner (coupons.tsx:548) and the fetch-error card are unpainted; every sibling page has an error-state suite.
7. **`cart-gate.spec.ts:20-27` (e2e)** — the one true evaporating assertion in the repo: `const canBuy = await buy.isVisible().catch(() => false); if (canBuy) {…}` — if the buy-button selector drifts, the cart assertions **silently skip** and the test stays green. Should be a hard `await expect(buy).toBeVisible()` (the selector regex `/إضافة إلى السلة|اشترِ|الشراء|سلة/` is itself drift-prone — 4 alternatives).
8. **Translated-string coupling — intent vs accident.** Pervasive `getByText("تمت الموافقة")` / exact Arabic toast titles / honest-count wording are **intent-pins**: the Arabic copy IS the product contract (A1/A2 verified copy with codepoint-level rigor) and each pin's header says so. This is deliberate and good. The accident-class is where copy is used as a *selector* rather than a *contract*: `findByPlaceholderText("بحث برقم المُحيل أو المُحال...")` (referrals-search-race:109, topups-queue-search, users-loyalty-derived-tier) couples lookup to a placeholder that A2-2/A6-B-13 want to change (aria-label additions) — prefer `findByRole("searchbox"/"textbox", {name})` in new pins. Same for the e2e regex above.
9. **Mock depth is at the module boundary, not the mock-testing level** — e.g. `topups-approve-confirm.test.tsx:132-152` asserts the real UI's argument construction (id, admin_note, Idempotency-Key header) through a boundary mock: the honest pattern. No "assert the mock was mocked" tests found.

---

## C. Regression-pin plan for R125 Wave 2 (the implementers' checklist)

Rule: every Wave-2 fix lands with its pin in the same commit. `EXTEND` = add cases to the named existing file (its fixtures/mocks are ready); `NEW` = new file under `frontend/src/pages/admin/__tests__/` (or the noted dir) using the cited in-repo pattern. Effort estimate for the PIN (not the fix).

### C-1. Tier 1 — money paths + a11y P1s + data-layer P2s + perf pins (the brief's priority list)

| # | Source finding | Fix (Wave 2) | Pin | One-line assertion | Effort |
|---|---|---|---|---|---|
| 1 | A6-B-3 [P1] | topups bulk-approve `variant="outline"` (topups.tsx:1013) | **EXTEND** `topups-approve-all.test.tsx` | the bulk-approve button renders the outline variant (no default primary-gradient class beneath emerald text) | S |
| 2 | A6-B-5 [P2] | topups single-row approve emerald-700 (topups.tsx:1310) | **EXTEND** `topups-approve-confirm.test.tsx` | the row «موافقة» surface carries `emerald-700`, not `-600` | S |
| 3 | A6-B-1 [P1] | `document.title` per route in AdminLayout | **NEW** `admin-document-title.test.tsx` | rendering each admin route sets `document.title` to its `PAGE_TITLES` value (+ suffix) and restores the storefront title on unmount | S |
| 4 | A6-B-2 [P1] | alerts row actions `group-focus-within:opacity-100` (alerts.tsx:682) | **EXTEND** `alerts-delete-confirm.test.tsx` | focusing a row's action button makes the action cluster visible (container gains opacity-100 under focus-within) | S |
| 5 | A4-B-3 [P2] | stats co-invalidation ×4 (tickets/users/products/risk-event onSuccess) | **NEW** `stats-co-invalidation.test.tsx` | each of the 4 mutation handlers ALSO invalidates `["/api/admin/stats"]` (risk-event also the risk list+dashboard keys) — pattern: alerts.tsx:233-236 + resync-test key-spy idiom | M |
| 6 | A4-B-10-1 | pin the PRIMARY `admin-stats-update` socket path | **EXTEND** `components/__tests__/socket-initializer-resync.test.tsx` | `socket.on("admin-stats-update")` handler invalidates exactly the 4 admin families once per event (mirror the existing RESYNC describe, SocketInitializer.tsx:79-92) | S |
| 7 | A4-B-2 / A2-3 [P2] | SEO payload end-to-end (projection + orval + seed) | **EXTEND** `products-seo-submit.test.tsx` **and** BE `routes/admin/__tests__/admin-product-seo-fields.test.ts` | FE: `startEdit` seeds the row's real seo values into the editor; BE: GET /admin/products projection carries `seo_title`/`seo_description` for a product that has them | S/M |
| 8 | A4-B-6 | risk `hasMore` load-more | **NEW** `risk-load-more.test.tsx` | hasMore=true offers تحميل المزيد, page 2 appends in place, short page hides it (alerts-load-more idiom) | S |
| 9 | A1-3 / A5-F1 [P2] | dashboard chart abort/seq (GlobalSearch recipe) | **NEW** `dashboard-chart-race.test.tsx` | a delayed 7d response landing after a 90d one is dropped — chips and rendered series agree; the aborted fetch's finally doesn't fake-idle (referrals-search-race/global-search:177 idiom) | M |
| 10 | A5-F2 [P2] | topups memoization (memoized flat + React.memo cards + hoisted aggregates) | **NEW** `topups-memoization.test.tsx` | source-scan: module-level `React.memo` row card + `useMemo` flat with the identity-trap comment (the orders/users/products idiom) — **no memo pin exists in the repo yet; this establishes the pattern**, optional follow-up Profiler commit-count test reusable for the other 4 pages | S (scan) / M (Profiler) |
| 11 | A1-1 [P2] | users «مسح الفلاتر» URL write-back | **NEW** `users-filters-url.test.tsx` | the empty-state clear CTA syncs the URL (`?tier=` gone; sortBy reset) — home-filters-url.test.tsx is the storefront pattern | S |
| 12 | A1-2 [P2] | wallet-amount htmlFor/id (users.tsx:1068/1089) | **EXTEND** `users-wallet-confirm.test.tsx` | clicking the «تعديل المحفظة» label focuses the amount input (htmlFor↔id pair) | S |
| 13 | A1-4 | dashboard refresh single-fire (drop `refetch()`) | **EXTEND** the new `dashboard-chart-race.test.tsx` (one file, same fixtures) | one refresh click sends exactly ONE /admin/stats request (the R124-I5 orders rationale, now pinned where orders never was) | S |
| 14 | A2-2 [P2] | enrichment edit-path confirm parity | **NEW** `enrichment-publish-confirm.test.tsx` | «تطبيق التعديل» opens the SAME confirm naming product+field; cancel fires no publish POST (promotions-activate-confirm idiom) | S |

**Tier 1 = 14 pins: 7 NEW / 7 EXTEND.**

### C-2. Tier 2 — a11y P2s + A2/A3 P2s + the A4 test gaps

| # | Source | Fix | Pin | Assertion | Effort |
|---|---|---|---|---|---|
| 15 | A1-9a-c / A6-B-7/11/12 | admin shell semantics (skip link, h1 demotion, hamburger+collapse names, nav aria-current) | **NEW** `admin-layout-shell-a11y.test.tsx` | skip-link is the first tabbable element targeting `#main-content`; one h1 per page; hamburger carries aria-label+aria-expanded; active nav link `aria-current="page"` | M |
| 16 | A6-B-8 | live regions in TableSkeleton/EmptyState/FetchErrorCard | **NEW** `admin-list-live-regions.test.tsx` (component-level) | TableSkeleton + EmptyState expose `role="status"` (+ sr-only «جارٍ التحميل…»), FetchErrorCard `role="alert"` — one file nets every list page | S |
| 17 | A6-B-10 / A1-6 | aria-pressed residuals | **EXTEND** ×3: `topups-approve-all` (select-all named + state-aware label), `users-wallet-confirm` (wallet-mode control exposes state), + a small `dashboard-chips-a11y` case in the new dashboard file (period/granularity `aria-pressed` + `role="group"`) | each button exposes `aria-pressed` matching its visual active state (orders-row-expansion:238 idiom) | S×3 |
| 18 | A6-B-9 | GlobalSearch palette on Radix + focus return + listbox groups + live count | **EXTEND** `global-search.test.tsx` | Esc returns focus to the trigger; section wrappers are `role="group"`; a sr-only live line announces result counts | M |
| 19 | A2-1 [P2] | enrichment cursor load-more (or honest hint) | **NEW** `enrichment-load-more.test.tsx` | next_cursor drives load-more appending drafts 26+; header pending_count reconciles with loaded rows («عرض أول 25 من N» if hint-only) | M |
| 20 | A2-4 [P2] | ProductVariantsDialog 7 money-field labels | **NEW** `product-variants-dialog-labels.test.tsx` | every field's label click focuses its input (the products.tsx recipe, now in a test) | S |
| 21 | A2-5 [P2] | referrals 200-cap honesty | **NEW** `referrals-cap-honesty.test.tsx` | a 200-row list renders «عرض N (الأحدث أولاً)» beside the full-table stat cards (products-error-bulk:397 idiom) | S |
| 22 | A2-6 [P2] | promotions delete-verb split | **EXTEND** `promotions-activate-confirm.test.tsx` | delete confirm reads «حذف نهائي» + toast «تم حذف العرض»; pause keeps «إيقاف»/«تم الإيقاف» | S |
| 23 | A3-1 [P2] | 2FA re-enrollment flow | **NEW** `settings-2fa-re-enroll.test.tsx` | an enrolled admin sees «مفعّلة» + rotate path with a current-password field; POST carries `current_password`; the old no-body 400 is unreachable | M |
| 24 | A3-2 [P2] | risk error+empty gate + retry | **NEW** `risk-error-state.test.tsx` | a failed load renders the error card and NEVER the EmptyState; retry recovers (tickets-error-state idiom) — doubles as the page's first render suite | S |
| 25 | A3-3 [P2] | tickets render `has_unread_admin` | **EXTEND** `tickets-error-state.test.tsx` | a row with `has_unread_admin` renders the awaiting-response cue; an open ticket without it does not | S |
| 26 | A4-B-10-2 | infinite-key shape pin | **NEW** `admin-query-key-shapes.test.ts` | the 4 hand-built infinite keys keep the URL-first prefix + `"load-more"` element (socket prefix-matching contract — a refactor that drops it goes red) | S |
| 27 | A4-B-10-3 | users per-intent key retention | **EXTEND** `users-wallet-confirm.test.tsx` | a 409 IDEMPOTENCY_IN_FLIGHT rejection KEEPS the intent key (retry reuses it); definitive success clears it (storefront 99-M1 pattern, checkout-idempotency-keys:243) | S |

**Tier 2 = 13 pins: 8 NEW / 5 EXTEND.**

### C-3. Tier 3 — ride-along pins for the S-effort batches (one cheap pin per batch/fix as it lands)

| # | Source | Fix | Pin | Assertion | Effort |
|---|---|---|---|---|---|
| 28 | A1-8 + A1-11 + A3-9 | the copy/consistency commit (معلق→قيد الانتظار, يوم→يوماً, لا مستخدمين, تعذر→تعذّر, dead code) | **NEW** `admin-copy-pins.test.ts` (source-scan; settings-security-facts-copy idiom) | the swept strings: no «معلق» in topups.tsx, no `* 50` literal in referrals.tsx, no identical-ternary in orders.tsx, «يوماً» present | S |
| 29 | A1-10 | orders footer partial-sum honesty | **EXTEND** `orders-false-empty-pagination.test.tsx` | over an accumulated window the footer reads «مجموع المعروض», «إجمالي» only on a known total | S |
| 30 | A1-7 | users tier partial-empty | **NEW** `users-tier-partial-empty.test.tsx` | a 0-match tier while hasNextPage keeps load-more + incompleteness hint — never the hard empty (orders R115 pattern, orders-false-empty:214) | S |
| 31 | A1-13 | topups tab-empty CTA | **EXTEND** `topups-queue-search.test.tsx` | a status-tab empty state offers «عرض الكل» that switches to the all-tab | S |
| 32 | A1-12b | login 2FA-back clears tempToken | **EXTEND** `admin-login-cookie-session.test.tsx` | «العودة لتسجيل الدخول» resets the 2FA flow state | S |
| 33 | A2-10 | pricing Switch name + fmt grouping | **EXTEND** `pricing-console.test.tsx` | the referred-buyer Switch has an accessible name (getByRole("switch", {name})); ≥1000-LYD values render grouped | S |
| 34 | A2-11 | pricing recompute race guard | **NEW** `pricing-recompute-race.test.tsx` | a stale in-flight result never overwrites a newer one (referrals-search-race idiom) | S |
| 35 | A2-16 | coupons delete label + busy guard | **NEW** `coupons-delete-guard.test.tsx` | the action reads the archive-honest label; a double-click fires exactly one DELETE (no stacked error-on-success toast) | S |
| 36 | A2-12/13 | silent refresh + no double-fetch | **EXTEND** `referrals-error-state` / coupons / promotions tests | a refresh keeps rendered rows (no skeleton swap); mount fires exactly one list GET | S |
| 37 | A2-8 | referrals statusLabel + chips | **EXTEND** `referrals-error-state.test.tsx` | chips/badges derive from `statusLabel` («قيد الانتظار»); chips carry aria-pressed | S |
| 38 | A2-9 | StockoutRiskPanel deep-link | **NEW** `stockout-risk-highlight.test.tsx` | «فتح في المنتجات» navigates with a consumed highlight/search param (not an inert link); row expander carries aria-expanded | S |
| 39 | A2-21 | promotions 30-day check + Arabic default title | **EXTEND** `promotions-activate-confirm.test.tsx` | a 60-day create is blocked client-side with no POST; an empty title never surfaces "Flash Sale" | S |
| 40 | A2-22 | coupons expiry sort | **NEW** `coupons-expiry-sort.test.tsx` | rows order soonest-expiry-first within the loaded window | S |
| 41 | A3-5 | security timeline honesty + race guard | **NEW** `security-timeline-honesty.test.tsx` | «أحدث 100 حدث» disclosure renders; a stale filter response is dropped; CSV copy discloses the window | S/M |
| 42 | A3-6 | alerts deleteAll→useConfirm + chip semantics + 2 type filters | **EXTEND** `alerts-delete-confirm.test.tsx` | deleteAll rides the shared confirm naming the count; chips expose aria-pressed; system/forecast types filterable | S |
| 43 | A3-7 | tickets socket invalidation | **EXTEND** `components/__tests__/socket-initializer-resync.test.tsx` | the new tickets event invalidates the tickets key exactly once | S |
| 44 | A3-11 | risk/system RBAC deep-link cards | **NEW** `risk-system-rbac-gate.test.tsx` | a scope-less admin sees the honest-reason card and fires NO query (referrals-finance-gate idiom) | S |
| 45 | A3-12 | whatsapp pair-code staleness | **EXTEND** `whatsapp-session-actions.test.tsx` | the code block shows the expiry cue after the TTL; action errors surface near the action | S |
| 46 | A5-F3 | lazy chart panels (dashboard+system) | **NEW** tiny source-scan (or extend `route-chunk-warmup.test.ts` idiom) | dashboard.tsx/system.tsx import the lazy chart wrapper — no static recharts import (build-graph proof is the A5 report's) | S |
| 47 | A5-F8 | charts stay mounted across period switch | **EXTEND** `dashboard-chart-race.test.tsx` | a period chip click does not unmount the chart container (no skeleton swap) | S |
| 48 | A6-B-4 + B-6 | the two contrast sweeps (raw -400 hues; text-primary→text-primary-text) | **EXTEND** `components/__tests__/status-tokens.test.tsx` (source-scan) | the swept sites carry token/`text-primary-text` classes — the storefront sweep's pin pattern extended to admin files | S |

**Tier 3 = 21 pins: 9 NEW / 12 EXTEND.** **No pin needed** (pure deletions/comments guarded by tsc+lint+review): A2-20 dead casts, A1-11 dead-code deletions, A4-B-9 stale comment, A4-B-11 docblock, A5-F6 doc numbers, A6-B-14 logical-property sweep (behavior-identical; optional source-scan counting physical utilities → 0).

---

## D. E2E realism (frontend/e2e/, guest-only by design — playwright.config.ts contract)

**Covered today (10 specs, all opt-in via E2E_ENABLED, CI = workflow_dispatch only):** home shell + no-console-errors; category browse + back-nav; product detail price/stock at 1280px; Arabic search normalization + empty state; cart-gate + checkout redirect; auth-gates on all money pages (redirect, never 5xx); login provider surface; mobile-390 overflow + 44px CTA; SEO shells (robots/sitemap/404); API contracts (4 public GETs). This is an honest guest read-only smoke suite — retries:2, 30s timeout, trace retain-on-failure. Good hygiene.

**Not covered (and why):** the actual money journey (login → topup → buy → receipt) and every admin flow are auth-gated — e2e CANNOT cover them without credentials; per the brief these are **manual-checklist items** (see below). Guest-coverable gaps: cart statefulness beyond one soft branch (B-7 above), price parity DOM↔API, URL/state round-trips.

**Top-3 NEW e2e cases (guest-only, highest value):**
1. **Guest cart statefulness round-trip** — home → product → add-to-cart (hard assertion, replacing cart-gate.spec.ts:21-27's `if (canBuy)` soft skip) → /cart renders the line + qty stepper arithmetic → **reload persists** (session storage) → /checkout redirect → back-nav keeps items → cart badge/count honest. This is the storefront's money-adjacent plumbing end-to-end; today a selector drift silently skips it.
2. **Price parity DOM ↔ API** — for 3 sampled slugs: the PDP's rendered price + strike equal `/api/products` payload values for the same product/variant (desktop-chromium + mobile-390 projects). Catches projection/formatting drift on the money surface (the `fmt` vs `formatCurrency` split A2-10 found in admin is the same class of risk on the storefront).
3. **Search → PDP → back with state intact** — search «نتفليكس» → click result → PDP → browser-back → query + results restored; garbage query → empty state whose clear CTA restores the grid. Extends search-arabic.spec from "renders" to the URL/back-button contract (unit-pinned at global-search.test:211; the e2e pins the real browser history behavior).

Honorable mentions: PWA offline shell (SW serves the shell with `context.setOffline()`); flash-sale banner countdown + expiry sweep (needs a controllable fixture — lower value). **Admin manual-checklist items (cannot e2e):** login+2FA incl. rate-limit copy; topup approve/reject happy+sad on a staging topup; product editor round-trip incl. SEO override + variants; GlobalSearch palette keyboard walk; RBAC spot-checks (finance-only vs support-only admin); CopilotPanel first-use; settings save + 2FA rotate.

---

## E. Flake risks (the CI-flakiness inventory)

| # | Pattern | Sites | Risk & note |
|---|---|---|---|
| 1 | **Real-timer debounce-margin sleeps** (340ms sleep vs 300ms debounce = 40ms margin) | topups-queue-search:112, products-error-bulk:384, referrals-search-race:115/135/147/161 | On a hiccuping CI node the debounce may not have fired when asserted → **vacuous pass** (silent coverage loss) or a miss on the ≥1 assertions. Fix: wait on an observable (findBy on the request-asserted UI) or bump to 2× debounce. |
| 2 | **Fixed-window negative assertions** (sleep 600ms then assert a fetch never fired) | admin-layout-alerts:286/313, dashboard-chart-scope-gate:147, admin-layout-pill-search-scope:195 | Inherent to "never polls" pins; wall-clock floor makes them mostly safe, but each costs 0.6s and a slow render before the window can false-green. Acceptable — keep, but prefer asserting on the query's `isFetched`/enabled state where possible. |
| 3 | **Real-timer race choreography** (setTimeout-delayed mock responses, 400–800ms) | referrals-search-race:111-137, global-search:183, app-dialog:192 (120ms) | Deliberate and documented (they need real AbortSignal semantics); the 800ms wait over a 700ms delay is a 100ms margin — same class as #1. |
| 4 | **Extended waitFor timeouts as symptoms** (default RTL waitFor = 1s on heavy page renders) | product-legacy-shape:99 (3s), product-r117-contracts:142 (3s), orders-false-empty:290 (2s), app-dialog:175 (1s) | Evidence the 1s default is already tight on CI for the heavy product/orders graphs — new dashboard/system pins (Tier 1 #9/#13) should pass explicit `timeout: 3000` from day one. |
| 5 | **Fixture time computed at module scope** (`new Date(Date.now() + 6h)` before per-test `setSystemTime`) | flash-sale-banner.test.tsx:36 | 6h headroom makes it safe today; the pattern (relative-to-real-clock fixture + later freeze) is the one to watch when copying. |
| 6 | Fake-timer usage | 18 files (flash-sale-banner ×14 sites, topup-waiting-modal, idle-toaster, deferred-socket, copy-button, route-change-focus, …) | **Disciplined**: `vi.setSystemTime` freezes the date-sensitive ones (format-relative-time:31, flash-sale-banner:217); `fireEvent` (never `userEvent`) alongside fake timers — no deadlock class found. |
| 7 | TZ-dependence | coupons-tz-roundtrip | Designed TZ-agnostic (roundtrip assertion) — CI TZ variance is the TESTED condition, not a flake. |

**Count: ~13 wall-clock-dependent sites in 9 admin files + 2 storefront files; zero fake-timer misuse.** The suite's flake exposure is concentrated in the debounce/race tests (E-1/E-3) — all authored deliberately with rationale comments; the cheap hardening is replacing fixed sleeps with observable-condition waits as those files are touched by Tier-1/3 pins.

---

## F. Test hygiene

- **FE setup: clean.** One 51-line `src/test/setup.ts` (jest-dom + cleanup + randomUUID guard) with a documented keep-it-small rule; vitest config deliberately split from vite.config.ts with the rationale in-file. No setup duplication.
- **Mock factories: scattered (the real debt).** 25/33 admin test files hand-roll `resLike`, 18 duplicate the `vi.mock("@workspace/api-client-react")` module-surface mock (26 more in storefront `pages/__tests__`); no shared `__tests__/helpers` module exists. Every individual mock is honest and self-documented (module-surface comments), but ~30 near-identical `resLike`/`renderPage`/`routeFetch` copies = the Wave-2 pins would each re-pay ~40-60 lines of boilerplate. **Recommendation: extract ONE `pages/admin/__tests__/helpers.ts` (resLike + renderPage + routeFetch + auth-state factory) with the FIRST Tier-1 pin; don't retrofit the existing 33 files.**
- **Fixture realism: strong.** Arabic strings are correct MSA and consistent (A1 verified codepoints programmatically; fixtures carry real statuses, LYD amounts, `REF-`-shaped references, `09xx` phones); `dir="ltr"` islands respected. The one fixture smell is E-5 (relative-to-real-clock fixture times).
- **BE runs (the 10-min-timeout chunking R124 used):** backend = 223 test files (routes 83 incl. admin 15, services 54, lib 47, jobs 29, root 7, middlewares 2). R124 ran 3 manual chunks after the tool timeout. **Better split:** `vitest run --shard=1/3` / `--shard=2/3` / `--shard=3/3` (purpose-built, even by duration with `--coverage` off, no config change) or the natural per-directory split `src/routes` (~8 min) / `src/services`+`src/jobs` (~7 min) / `src/lib`+rest (~5 min) — both beat ad-hoc chunk lists and give stable CI matrix cells. A full `projects:` config (one per top dir) only pays off if the suites diverge in environment needs (they don't — all node+pglite).
- **E2e hygiene: good** — explicit guest-only contract in the config header, opt-in gating, manual-dispatch CI job, retries+trace budgeted.

---

## G. Priority counts

| Area | Count |
|---|---|
| Admin pages with ZERO render tests | **4** (risk, risk-event, enrichment, admins — 1,839 LOC) |
| Shared admin components with zero tests | **4** (+ CopilotPanel render-surface, InventoryUploadDialog, StockoutRiskPanel, CopilotHistoryView; EmptyState/TableSkeleton indirectly only) |
| Effectively-untested big pages (≤3 tests / >1,000 LOC) | **3** (dashboard 3/1,106; system 3/1,629; settings 2 copy-scans / 1,493) |
| Weak-assertion items named (B) | 9 (1 evaporating e2e assertion; 3 source-scan stopgaps; rest = scope-narrow files) |
| Snapshot tests | 0 · Smoke-mount-only tests: 0 |
| Wave-2 pins specified (C) | **48 total: Tier1 14 (7 new/7 extend) · Tier2 13 (8/5) · Tier3 21 (9/12) → 24 NEW files / 24 EXTENDS** |
| Findings needing NO pin (deletions/docs) | ~8 (listed at end of C-3) |
| Flake-risk sites (E) | ~13 in 11 files (0 fake-timer misuse) |
| E2e gaps → proposals | 3 new specs + 7 admin manual-checklist items |

## H. Suggested order (for the Wave-2 implementer)

1. **Extract `__tests__/helpers.ts` with pin #1** (topups bulk-approve contrast) — boilerplate paid once, every later pin cheaper.
2. **Money+P1 cluster (pins 1-6)** — topups contrast ×2, document.title, alerts focus, stats co-invalidation + socket pin. All S/M, all in the brief's priority list.
3. **Zero-page scaffolds double as fix-verifiers (pins 24, 8, 19, 14)** — risk-error-state is BOTH the A3-2 fix's pin and the page's first suite; same for risk-load-more, enrichment ×2.
4. **Data-layer + perf cluster (pins 7, 9-11, 13, 26-27)** — SEO payload end-to-end, chart race + refresh single-fire (one file), topups memo source-scan, key-shape + per-intent retention.
5. **The a11y sweeps (15-18, 17×3, 48)** — shell semantics, live regions, aria-pressed residuals, palette, contrast source-scans; one lane per A6's own fix order.
6. **Tier-3 ride-alongs land WITH their fixes** — one cheap pin per consistency-commit batch (28 is the umbrella for the copy commit).
7. **E2e trio (D)** — cart statefulness first (it also fixes the one evaporating assertion); price parity + search round-trip after.
8. **Hygiene tail**: BE `--shard` in CI matrix; debounce-wait hardening opportunistically as Tier-1/3 pins touch those files.

— R125-A10, 2026-10-09. Read-only: no source files modified, no test runs, no commits, no production probes. Only this report + one worklog entry created.
