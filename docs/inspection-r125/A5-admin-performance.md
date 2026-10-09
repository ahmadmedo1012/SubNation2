# R125-A5 — Admin Console Performance Audit

**Repo:** SubNation2 @ `09857fc` (main, clean tree) · **Agent:** R125-A5 (read-only audit) · **Date:** 2026-10-09
**Scope:** all 21 admin pages (`frontend/src/pages/admin/*`, incl. layout.tsx + login.tsx) + admin chrome (layout badges/poll, GlobalSearch, CopilotPanel) — render performance, bundle composition, polling cost, perceived speed.
**Method:** static analysis at HEAD (full reads of layout/dashboard/orders/users/products/topups/referrals + targeted reads + greps of every other page), PLUS one local production build (`pnpm build`, no DSN, dist/ gitignored) for real chunk composition. No code modified, no tests run, no production mutation; zero probes needed (static + build evidence sufficed). Predecessors: R124-A2 (storefront perf, live-measured — method borrowed), R124-A6 §B #4 (keystroke memoization memo), R124-R1 P3-2.

---

## A. Verified-held (R124 fixes confirmed at HEAD with code evidence)

1. **Keystroke memoization extended to users/products/referrals — HELD.**
   - `users.tsx:194` `DesktopUserRow` + `:254` `MobileUserCard` module-level `React.memo`; `:449` `users` flat() **memoized** (the comment cites the fresh-identity trap); `:459-486` `totalWallet`/`totalSpend`/`sorted` all `useMemo`; `:497-511` `openEdit` `useCallback([])`. Keystroke path verified end-to-end: controlled input (`:777`) → page re-render → `sorted` identity stable (deps `[users, tierFilter, sortBy]`, no `search`) → row props identical (`user` refs from memoized array, `idx` primitive, `onEdit` stable) → all rows bail at the memo boundary.
   - `products.tsx:266` `ProductCard` `React.memo`; `:808-816` `filtered`/`lowStockCount` `useMemo`; **seven** stable callbacks `:635-800` (`invalidate`, `archiveProduct`, `startEdit`, `openInventory`, `openVariants`, `stockEditDone`, `toggleSelect`); call site `:1523-1539` passes zero inline arrows (the `:1531-1533` comment documents why).
   - `referrals.tsx:126` `ReferralRowItem` `React.memo`; `:401` `list` memoized (`?? []` identity trap fixed); `:333` `handleCredit` `useCallback`.
   - Baseline intact on orders: `orders.tsx:230/:393` memo rows, `:651` memoized `allOrders`, `:684-759` full useMemo chain, `:942-953` `useCallback` toggles.
2. **A6 F11 (orders bulk double-refetch) — HELD.** `orders.tsx:856-865`: the explicit `refetch()` is gone; single base-key `invalidateQueries`.
3. **A6 F12 (CopilotPanel lazy) — HELD, build-verified.** `layout.tsx:19-21` `lazyWithRetry`; mounted in `Suspense fallback={null}` at `:1194-1196`. Built graph proof: `layout-BoIdKNLS.js` contains `import("./CopilotPanel-DfVE4vj9.js")` — a real dynamic boundary; panel rides its own 33.05 KB raw / 10.48 KB gz chunk (fetched once on first admin mount, SW-cached after).
4. **A6 F14a (topups client-side search) — present** (`topups.tsx:993` controlled, `:614-630` `useMemo` derived list) — but see F2: the page never received the row-memoization half of the pattern, and even its useMemo is defeated (non-memoized `.flat()` at `:500`).
5. **Polling/tab-hidden discipline — HELD, 100% coverage.** Every `refetchInterval` in admin carries `refetchIntervalInBackground: false` (layout.tsx:723-724, 756-757; dashboard.tsx:289-290, 315-316; orders.tsx:641-642; users.tsx:442-443; products.tsx:621-622; topups.tsx:496-497; alerts.tsx:228-229; risk.tsx:102-107; system.tsx:450-451, 461-462, 472-473, 490-491, 517-518, 528-529; pricing.tsx:509). The raw `setInterval` alert-toast poll (layout.tsx:884-929) skips hidden tabs (`:892` `visibilityState === "hidden"` early-return) and catches up on visible (`:916-918`).
6. **R124-A2 F2 (SW JS-cache cap) — HELD.** vite.config.ts:691 `assets-js maxEntries: 160` (was 40; the 146-chunk build no longer LRU-thrashes).
7. **Startup gating — HELD.** Admin boots skip the storefront head-start entirely (App.tsx:310-312) and route warm-up skips `/admin` links (App.tsx:447-449) — correct: warming 40-56-chunk admin pages from storefront chrome would be waste.
8. **Dialog mount discipline — HELD.** All admin dialogs ride the Radix-Portal `AppDialog` (app-dialog.tsx:111-201) whose portal content mounts only when `open` — no mounted-but-hidden heavy dialogs; forms inside dialogs re-render the parent page per keystroke but memoized rows bail (users.tsx:971 `open={!!editingUser}`, products.tsx:1546/1562 conditional dialog mounts).
9. **Images — HELD.** Admin product grid loads the same small webp set the storefront uses (`/products/*.webp`, 4-31 KB each per R124-A2 live measurement) with `loading="lazy"` + `decoding="async"` (products.tsx:313-319; GlobalSearch layout.tsx:582-588). No full-size originals in play — no srcset needed at these sizes.
10. **Money formatters cached.** `formatCurrency` rides a module-level `Intl.NumberFormat` (utils.ts:17-25); `formatCount` a cached `PluralRules` + `NumberFormat` (:32-38). Only `formatDate` (`:72-80`) constructs per call — engine-cached, and per-row only on row re-render (memoized).

---

## B. Findings

### F1 — [P2] Dashboard chart fetch race still open (KNOWN-OPEN #1, verified unfixed)
**Location:** dashboard.tsx:322-363 (`fetchChart`), :365-367 (effect deps `[adminToken, chartDays]`).
**Mechanism:** plain `fetch` with no `AbortController` and no sequence token. Period chips (`:740-752`) fire `onChangeDays` → `setChartDays` → effect refetches. Two rapid flips (7d → 90d) put two fetches in flight with no ordering: a slow 7d response resolving after the 90d one calls `setChartData(7d series)` while the chips read 90d — the money chart silently shows the wrong period; the stale `.finally` also clears `chartLoading` early (skeleton flap). The in-repo fix pattern exists and is proven: GlobalSearch (layout.tsx:325-391 — controller per keystroke, `abort()` in cleanup, `aborted` guard on every state write) and referrals (`fetchSeqRef`, referrals.tsx:140-221).
**Impact:** wrong-period revenue/discount display under a network race (rare on fast links, realistic on 3G/mobile-admin); user-visible loading flicker on chip churn. Data-integrity-adjacent (finance series), which is why P2 not P3.
**Fix:** abort-or-token in `fetchChart` (mirror the GlobalSearch recipe verbatim); optionally keep previous data while the new fetch is in flight instead of the skeleton (see F8). **Effort S.**

### F2 — [P2] topups.tsx (the money queue) missed the memoization pass entirely
**Location:** topups.tsx:500 (`allTopups` non-memoized `.flat()`), :635-643 (inline per-render aggregates), :1186-1330 (inline card map, no `React.memo` anywhere in the file), :993 (controlled search).
**Mechanism (precise):** (a) `const allTopups = (topupsPages?.pages ?? []).flat()` mints a fresh array identity every render — exactly the trap orders.tsx:647-654 and users.tsx:446-449 fixed with memoized flats (both cite it in comments); (b) therefore the `useMemo` at :614-630 (`deps [allTopups, statusFilter, debouncedSearch]`) recomputes on **every** render, so the derived list re-mints too; (c) `pendingTopups`/`allPendingSelected`/`selectedPendingCount`/`statusCounts` (:635-643) are computed inline per render over the full accumulated set; (d) the cards themselves are inline JSX in the `map` closure with fresh handlers per render — no memo boundary exists. Net: every keystroke in the search box (and every `processingId`/`selectedIds` flip) re-renders **all** loaded topup cards. The queue accumulates 100/page (topups.tsx:105) with no cap on load-more.
**Impact:** at 3 loaded pages (300 cards ≈ real money-queue depth on an active day), each keystroke re-renders 300 multi-section cards (~30-60 DOM nodes each) ≈ 10k+ nodes reconciled — measurable jank on mobile admin (INP-relevant), ~5-15 ms/keystroke desktop. This is the exact class R124 fixed on three sibling pages; topups was absent from A6 F4's list (it gained a *search* in R124 without the *render* pattern).
**Fix:** mirror the orders pattern — memoize the flat (`useMemo([topupsPages])`), hoist a module-level `React.memo` TopupCard with primitive props (`isSelected`, `isProcessing`) + `useCallback` handlers, move the :635-643 aggregates into the existing `useMemo`. **Effort M.**

### F3 — [P2] Admin first paint gates on the 109.5 KB gz recharts vendor (dashboard = default landing page)
**Location:** dashboard.tsx:39-51 (static recharts import), system.tsx:42 (same).
**Mechanism (measured at HEAD build):** `dashboard-CRP_eiZq.js` statically imports `vendor-charts-aHp5your.js` (verified in the built artifact's import statement) — 403.54 KB raw / **109.48 KB gz**. The route's `Suspense` fallback (RouteSkeleton) stays until the whole static import graph of the dashboard chunk (36 files, 237.6 KB gz total graph; ≈138 KB gz incremental after the login page's already-loaded vendors) downloads AND evaluates. 79% of that incremental is vendor-charts. Every admin login lands on this page; system.tsx is identical (37 files / 239.8 KB gz). After the first visit the SW serves it CacheFirst, but the ~400 KB raw parse/compile still runs on every cold tab.
**Impact:** first admin paint pays ~0.5-1.5 s on 4G cold + 100-300 ms parse on desktop, for charts that render below the KPI tiles and recent-orders stream (which need no recharts). The single largest admin-perceived-speed lever measured in this audit.
**Fix sketch:** a tiny shared lazy wrapper (`components/admin/charts.tsx` exporting the three chart cards via `React.lazy(() => import("./charts-impl"))`), consumed by dashboard + system — KPI tiles + recent orders + urgent banner paint on the dashboard chunk alone while vendor-charts streams in parallel. **Effort M.**

### F4 — [P3] Admin boots still pay the unconditional home-chunk modulepreload (R124-R1 P3-2, verified open; KNOWN-OPEN #3)
**Location:** vite.config.ts:288-293 (`criticalPreloadInject` home rule); built `index.html` confirms `<link rel="modulepreload" href="/assets/home-B0cMP0Y_.js">`.
**Mechanism/quantified:** the injected link is unconditional — every `/admin/*` boot fetches (and per spec parses) `home-B0cMP0Y_.js` = 28.84 KB raw / **8.53 KB gz** that admin sessions never execute. Admin boots otherwise correctly skip the head-start (App.tsx:310-312), so this link is the *only* storefront waste on the admin path. After the first visit the SW serves it from cache (network cost → 0), so the real cost is first-admin-visit-on-a-fresh-browser, staff-only traffic.
**Cheap fix:** `init.js` (index.html:120) is a blocking classic script that executes BEFORE the parser reaches the injected head links — add ~2 lines there: `if (location.pathname.startsWith("/admin")) document.querySelector('link[rel="modulepreload"][href*="/home-"]')?.remove()` (guard for the build-time hash via the attribute selector). Storefront boots are untouched. **Effort S.**

### F5 — [P3] Entry chunk still carries admin-only generated fetchers (R124-A2 F5 residual, verified)
**Location:** built entry `index-D7RaWqbq.js` contains `/api/admin/topups` (+`/approve`), `/api/admin/products` ×2, `/api/admin/stats`, `/api/admin/pricing` ×2 URL/key-builder strings (grep in dist; source: `shared/api-client-react/src/generated/api.ts` hosted in the entry).
**Mechanism:** no orval per-tag split — every storefront visitor downloads admin API client code (~1-2 KB gz). Hygiene more than bytes. **Effort M** (orval codegen layout). Unchanged from R124's assessment.

### F6 — [P3] "Entry 27 KB gz" claim is stale — now 32.36 KB gz
**Location:** R124-A6 §A ("Route loading … entry 27 KB gz"); vite.config.ts:852's own comment documents 30,881 B gz post-R122; HEAD build measures **32,362 B gz** (107.39 KB raw).
**Mechanism:** R122's lucide de-chunking inlined eager icons into the entry (documented), plus the admin-fetcher residue (F5). Not a gate breach — the eager path is 145,879 B gz, under the 145 KiB warn line (budget plugin output). Action: update the number in future docs/claims (this report's chunk table is the new baseline); the honest long-term shrink is F5. **Effort S** (doc) / M (F5).

### F7 — [P3] Dashboard derived chart data recomputed per render — charts re-render on unrelated state changes
**Location:** dashboard.tsx:391 `const displayData = aggregateData(chartData, granularity);` (no `useMemo`).
**Mechanism:** every dashboard re-render (300 s stats poll that changed data, any state flip) mints a fresh `displayData` array → recharts sees a new `data` identity → full reconciliation of all three charts (AreaChart + 2 BarCharts) + three Sparkline LineCharts **even when `chartData` is unchanged**. `aggregateData` also calls `toLocaleDateString` per bucket (up to 90 buckets) per recompute. `METRIC_CARDS` (`:428-531`) rebuilds per render too (cheap: 6 objects) and `fetchChart` is re-created per render (harmless — it's called, not a dep).
**Impact:** ~10-30 ms per poll-refresh on desktop, 50-150 ms low-end — every 5 minutes the tab is visible, plus on granularity chips. Not user-visible on desktop; measurable INP on old Android.
**Fix:** `const displayData = useMemo(() => aggregateData(chartData, granularity), [chartData, granularity]);` **Effort S.**

### F8 — [P3] Charts unmount to skeleton on every period switch
**Location:** dashboard.tsx:342 (`setChartLoading(true)` in `fetchChart`) → :765-767, :861-863, :952-954 (skeleton replaces mounted charts).
**Mechanism:** each period chip click flips `chartLoading` → all three chart components unmount (skeleton) → remount when data lands — a full recharts re-init (~100-300 ms low-end) + visual flash, instead of an in-place data update (recharts handles identity-stable updates cheaply). Granularity chips avoid this (no loading flip) and update in place — proof the remount is unnecessary. Compounds with F1 (a chip race produces mount→unmount→mount churn).
**Fix:** keep the charts mounted; dim/overlay while fetching (`opacity-60` + a corner spinner), or only skeleton the very first load (`chartData.length === 0`). **Effort S.**

### F9 — [P3] Admin chrome re-renders every 5 s forever (the "last updated" pill tick)
**Location:** layout.tsx:812-821 (`setInterval(… , 5000)` → `setSecondsAgo`), NavItem at :146-219 (plain function, not memoized), per-render inline props `:1016` (`CONTEXT_ACTIONS[location] ?? []` — fresh `[]`) and `:1017` (`onNavigate={() => setMobileOpen(false)}`).
**Mechanism:** the pill ticks every 5 s once any badge data has landed → `AdminLayout` re-renders (~20 NavItems + topbar + sidebar). Page content bails out (same `children` element reference), so the cost is chrome-only (~40-80 elements, <1 ms/tick) — but it runs 12×/min on every open admin tab, and the inline props would defeat `React.memo` on NavItem even if it were added.
**Fix:** extract the pill into its own component owning the interval (the parent stops re-rendering); then `onNavigate`/`contextActions` stabilization is moot. **Effort S.**

### F10 — [P3] No warm-up for admin→admin navigation (first session only)
**Location:** App.tsx:447-449 (route warm-up deliberately skips `/admin`); layout.tsx nav `Link`s (`:169`, `:208`) carry no warm-up either.
**Mechanism:** correct to skip from *storefront* chrome, but an authenticated admin session also gets nothing: each sidebar nav on a fresh session pays a cold burst at the tap — measured fanouts: orders 45 files/138.1 KB gz graph, products 45/147.9, topups 45/136.4, settings 42/135.0, coupons 37/129.6 (≈30-48 KB gz incremental each after shared chunks land). First session only; SW CacheFirst (160 entries) makes subsequent navigations ~zero-RTT.
**Fix sketch:** pointerenter/focusin warm-up on the sidebar `NavItem` links, firing the same `lazyWithRetry` specifier the route uses, `saveData`-gated like App.tsx:424-425 — an admin-session-only mirror of the storefront recipe. **Effort S/M.** Honest note: benefit is capped (staff traffic, one session) — do after F1-F3.

### F11 — [P3] products.tsx per-render `JSON.stringify` dirty check + dual-layout DOM duplication
**Location:** products.tsx:598 (`editorDirty = showForm && JSON.stringify(form) !== JSON.stringify(formBaseline)`); orders.tsx:1516-1626 + users.tsx:1262-1339 (desktop `<table>` `hidden md:block` AND mobile card list `md:hidden` — **both always in the DOM**, one merely display:none).
**Mechanism:** (a) every products-page render (each search keystroke, each 60 s poll) serializes the full form twice (name/description/usage_terms can run KBs) ≈ 10-50 µs, up to ~0.5 ms worst case — trivial but free to fix (compare fields or useMemo on `[form, formBaseline, showForm]`). (b) The dual-layout mount doubles the row-node count on the big list pages (200 orders = 200 `<tr>` subtrees + 200 mobile cards); memoization makes *re-renders* fine, but initial mount, DOM memory, and the memo-bail comparison cost scale ×2. Only orders/users do this (topups/tickets are single-layout; products is card-grid only).
**Fix:** (a) S; (b) gate the hidden tree on a `useMediaQuery("(min-width: 768px)")` render (drops ~half the nodes) — worthwhile only when lists grow; virtualization verdict below covers the threshold. **Effort S / M.**

### Virtualization verdict (requested, honest threshold-based)
**Not justified at current or near-term scales.** Server caps: products 200 (products.tsx:134, no pagination); orders/users/topups/tickets 100/page accumulating via load-more (orders.tsx:119, users.tsx:101, topups.tsx:105, tickets.tsx:80). A realistic heavy session holds 100-500 rows; with the (now nearly uniform) memoized rows, per-keystroke cost is the input only, and polls re-render nothing (structural sharing + tracked query props — see F12 note). A 200-card mount is a one-time ~30-80 ms; 500 rows ≈ 100-250 ms once. **Revisit when:** a single page routinely renders >1,000 accumulated rows (orders history is the likely first candidate) — then row-virtualize (TanStack Virtual) the desktop table AND collapse the dual-layout duplication (F11b) first, which halves the DOM for free. Adding a virtualization dependency today would cost bytes on every admin chunk for no measurable win — the honest call is to fix F2's missing memo boundaries (the actual regression risk) instead.

### Polling-cost note (verified, no finding)
Census: products 60 s; system 60 s ×3 + 90 s ×2 + 15 s (metrics — system.tsx:517, the live CWV/event-loop triage panel, justified); risk 30 s; alerts 20 s (inbox, socket-push primary — the 20 s is a fallback cadence; layout badge 300 s); dashboard/orders/users/topups/layout 300 s (socket-push primary, polls are dropout fallback); tickets/coupons/promotions/admins/security/whatsapp/enrichment none. All `refetchIntervalInBackground: false` — a hidden admin tab issues **zero** query polls. Cross-ref: dashboard's manual `handleRefresh` (:374-379) does `refetch()` + `invalidateQueries` on the same key = the double-request class A6 F11 fixed on orders — found independently by R125-A1 (their finding; not double-counted here). When a poll returns unchanged data, TanStack structural sharing preserves object identities and the tracked-props observer triggers **no component re-render** (products.tsx destructures only `data/isLoading/isError/error/refetch` — a background refetch flips none of them): the residual 60 s products cost is one HTTP request + JSON.parse (~2-5 ms for 200 rows), twice a minute, visible tab only. **KNOWN-OPEN #2 answer: with R124's memoization in place, the idle 60 s poll re-renders nothing — the grid container does not re-render, memoized cards are never even compared, and the only cost is network + parse.** The pre-R124 claim ("re-renders the grid twice a minute") no longer holds.

---

## C. Chunk composition (measured, HEAD build 2026-10-09, no DSN)

Eager path (every boot incl. admin): **145,879 B gz** across 6 files — under the 145 KiB warn gate (vite.config.ts budget plugin).

| Chunk | Raw | Gz | Role |
|---|---|---|---|
| index-D7RaWqbq.js (entry) | 107.39 KB | **32.36** | incl. admin fetchers (F5), eager icons |
| vendor-react | 185.87 | 58.63 | modulepreloaded |
| vendor-query | 36.48 | 10.73 | modulepreloaded |
| vendor-utils | 30.99 | 9.74 | modulepreloaded |
| vendor-router | 5.02 | 2.42 | modulepreloaded |
| index-*.css | — | 31.99 | one Tailwind-purged sheet, storefront+admin |
| home (modulepreload, wasted on admin — F4) | 28.84 | 8.53 | |
| **vendor-charts** (lazy: dashboard+system only) | 403.54 | **109.48** | F3 |
| vendor-firebase (lazy) | 153.64 | 44.27 | login popup only |
| vendor-socket (lazy) | 42.52 | 13.32 | wallet/order-detail/admin deferred |
| vendor-radix (lazy) | 36.07 | 12.33 | dialogs (admin pages) |
| **layout-BoIdKNLS.js** (shared admin chrome, every admin page) | 27.12 | **8.74** | AdminLayout + GlobalSearch |
| CopilotPanel (dynamic from layout ✔) | 33.05 | 10.48 | own chunk, first admin mount |
| sonner wrapper (index-DTMLXFjJ) | 33.42 | 9.55 | lazy Toaster |
| login (admin) | 5.59 | 2.43 | |
| dashboard | 24.32 | 7.06 | statically drags vendor-charts (F3) |
| system | 35.62 | 9.98 | same |
| products | 65.54 | 17.84 | biggest admin page chunk |
| orders (admin) | 31.71 | 9.56 | |
| users | 25.23 | 7.94 | |
| topups | 23.66 | 7.80 | |
| settings | 36.82 | 10.59 | |
| pricing | 29.95 | 8.10 | |
| alerts | 15.21 | 5.12 | |
| tickets | 14.57 | 4.98 | |
| coupons | 14.65 | 4.80 | |
| admins | 13.87 | 4.44 | |
| promotions | 13.25 | 4.53 | |
| whatsapp | 10.77 | 3.78 | |
| security | 9.30 | 3.07 | |
| risk | 9.78 | 3.44 | |
| enrichment | 7.88 | 3.09 | |
| risk-event | 7.57 | 2.80 | |

Route fanout (entry `__vite__mapDeps` graph): dashboard 36 files / 237.6 KB gz · system 37 / 239.8 · products 45 / 147.9 · orders 45 / 138.1 · topups 45 / 136.4 · users 39 / 134.1 · settings 42 / 135.0 · coupons 37 / 129.6 · admin login 15 / ~100 (vendors already eager). Heavy-dep scan: **no date-fns, no xlsx, no virtualization lib, lucide named-imports only** — page chunks are their own JSX + icons, sane. Startup waterfall (cold admin): HTML → eager set (+wasted home preload) → admin-login chunk (2.4 gz incremental) → POST login → dashboard graph (~138 KB gz incremental, 79% vendor-charts) — depth 2 lazy hops, no avoidable serial waterfall.

---

## D. Priority counts

**P0: 0 · P1: 0 · P2: 3 (F1, F2, F3) · P3: 8 (F4, F5, F6, F7, F8, F9, F10, F11)**

## E. Suggested fix order

1. **F1** dashboard chart abort/sequence-token — S, in-repo recipe (layout.tsx GlobalSearch), closes the only correctness-adjacent race.
2. **F3** lazy chart panels (dashboard + system) — M, −109 KB gz off every admin first paint (the measured big win).
3. **F2** topups memoization mirror (memoized flat + React.memo cards + hoisted aggregates) — M, the last unfixed big-list page, and the money queue.
4. **F4 + F6** init.js admin gate for the home modulepreload + entry-number truth update — S, one commit.
5. **F7 + F8** dashboard `useMemo(displayData)` + keep charts mounted across period switches — S, same file as F1/F3 (one PR).
6. **F9** isolate the 5 s pill tick into its own component — S.
7. **F10** admin-nav warm-up (admin-session-only, saveData-gated) — S/M, capped benefit, do last.
8. **F11** stringify dirty-check + dual-layout gate — S; revisit virtualization only past ~1,000 accumulated rows (orders first).

— R125-A5, 2026-10-09. No code modified; one local build (dist/ is gitignored); only this report + worklog entry written.
