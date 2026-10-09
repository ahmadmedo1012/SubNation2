# R126-A5 — Frontend Performance Audit: Dist Forensics + Runtime Code Audit + Live Timing

**Repo:** SubNation2 @ `186b131` (HEAD, clean tree) · **Agent:** R126-A5 · **Date:** 2026-10-09
**Scope:** the whole `@workspace/subnation` frontend — built + dist-verified forensics (one no-DSN production build, `npx vite build --config vite.config.ts`, dist/ gitignored), runtime render/effect/state audit of the big surfaces, guest-level live timing on https://subnation.ly (3 runs/endpoint), and regression detection against R125-A5's recorded numbers.
**Method:** 1 build (mandate cap 2; the second was not needed — R125's DSN eager number 146,096 B gz carries the comparison). All sizes are gzip level-6 (`zlib.gzipSync` default — the same basis as the bundle-budget plugin and R125's tables) unless marked raw. Every claim carries a dist filename + byte count or a file:line. No source modified, no commits, no dev servers, no test suites.

---

## A. Baseline build (no-DSN) — gates and eager path

Build: `vite v7.3.2`, 2,633 modules transformed, 146→131 chunks after `experimentalMinChunkSize: 2048` merging, 8.53 s.

**Budget plugin verdict (build log, verbatim):**
```
[bundle-budget] index-DCk1GKVF.js: 32365 bytes (gzip)
[bundle-budget] eager path (6 files: index-DCk1GKVF.js=32365 + vendor-react-3l2p7574.js=58630
  + vendor-utils-PJZsc2dN.js=9744 + vendor-router-CsI1xlNO.js=2421 + vendor-query-DWJ-o1nI.js=10727
  + index-lRkZmEYX.css=31830): 145717 bytes (gzip)
```

- **Entry chunk: 32,365 B gz** (107,363 B raw) vs the 55 KiB entry gate (56,320 B, vite.config.ts:82) — 57.4% of gate, silent pass.
- **Eager path: 145,717 B gz** vs the 145 KiB warn line (148,480 B, vite.config.ts:155) — **PASS with 2,763 B (1.9%) headroom**, silent (no warn printed). Hard-fail gate 160 KiB untouched.
- R125 recorded 32,362 / 145,709 B gz (no-DSN). Δ = **+3 B / +8 B** — hash/identity noise. **No regression.** The headroom note is the actionable part: the eager path sits at 98.1% of its warn line; any ~3 KB gz addition to entry/vendors/CSS trips the warn (not a failure, but the next feature round should budget for it).
- Sentry: no DSN → `vendor-sentry` **not emitted at all**; `sentry-replay-D-qmTlPK.js` is a 411 B / 238 B gz stub, dynamic-only (the only reference is `import("./sentry-replay-D-qmTlPK.js")` inside the entry's ErrorBoundary catch). Matches the R125 guard design (vite.config.ts:432-435).

**Modulepreload graph (dist/public/index.html):** exactly 4 `<link rel="modulepreload">` — `vendor-react-3l2p7574.js`, `vendor-utils-PJZsc2dN.js`, `vendor-router-CsI1xlNO.js`, `vendor-query-DWJ-o1nI.js` (:124-127) + the module entry (:123) + 1 stylesheet (:128). The entry chunk's own static imports are exactly those 4 vendors (verified: `from"./vendor-*.js"` ×4, no other cross-chunk static import in `index-DCk1GKVF.js`) — **the eager set is minimal and fully accounted**. NotFound + ErrorBoundary (statically imported by App.tsx:1-2,23) are inlined into the entry chunk itself (verified: their distinctive strings «الصفحة غير موجودة» / "React render error" are in `index-DCk1GKVF.js`, not in any shared chunk).

**The R125 admin home-preload gate — HELD, dist + live verified.** dist index.html:4 opens with `<script>if(!location.pathname.startsWith("/admin")){…modulepreload home-CSGlirYp.js…}</script>` (the conditional-create gate, vite.config.ts:315-332). Live https://subnation.ly/ HTML contains the same gate (grep hit = 1) referencing `home-BYjapJsD.js` — **deployed**. Admin boots fetch zero storefront route bytes. **R126-L1 truth-up (same round, post-A11):** that inline gate was CSP-blocked by helmet (`script-src` without `'unsafe-inline'`) on 100% of boots — A11-F1 (P1): 2 live e2e failures + a fully inert preload. The gate is now EXTERNAL: `criticalPreloadInject` emits `assets/preload-gate-<contenthash>.js` (immutable `/assets/` cache, 377 B gz) referenced right after `<head>` as a blocking classic script whose `data-home-chunk` attribute carries the hashed home URL — same placement, predicate and conditional-create semantics; the built shell now ships ZERO src-less `<script>` (mechanically enforced at build time by the bundle-budget plugin).

**Dynamic import boundaries (dist-verified):** 50 route/component `import()` sites with depmaps in the entry (all 40 pages are `lazyWithRetry` — App.tsx:38-92), plus in-route boundaries: `vendor-charts-B2c-mIVm.js` ← only from `dashboard-BxChXwKR.js` and `system-CWQgBg4X.js` (the R125 ChartsLoader bridge); `CopilotPanel-lv1Lsn4z.js` ← only from `layout-DGpLF5IU.js`; `browser-iDJW9IsH.js` (qrcode, 25,783 B raw / 10,137 B gz) ← only from `settings-uTjsUjgV.js` (2FA QR); `vendor-firebase-DG6ky1FZ.js` ×3 and `vendor-socket-BxTbGR0_.js` ×1 ← from the entry, all inside interaction/probe-gated async functions (see §C.5). SW registration defers to `window.load` (dist `registerSW.js`).

---

## B. Dist forensics

### B.1 Per-route chunk map (entry `__vite__mapDeps` graph, gz = chunk + dep closure)

| Route chunk | files | graph gz | incremental after admin spine* |
|---|---|---|---|
| products-BP3vU5X8.js (65,754 raw / 17,868 gz) | 45 | 152,009 | ~20-25 KB |
| orders-7P7QY6WJ.js | 45 | 141,789 | ~10 KB |
| topups-Dfoa_1S-.js | 45 | 140,178 | ~10 KB |
| settings-uTjsUjgV.js | 42 | 139,245 | ~12 KB |
| users-CVVKvLSL.js | 39 | 137,951 | ~8 KB |
| system-CWQgBg4X.js | 36 | 136,999 | ~10 KB |
| pricing-C7HLEzsq.js | 37 | 136,635 | ~10 KB |
| dashboard-BxChXwKR.js | 35 | **134,924** | ~7 KB |
| …(13 more admin pages) | 30-36 | 128,390-133,977 | ~3-9 KB |
| product-JkMsOLLp.js (storefront) | 26 | 131,078 | |
| home-CSGlirYp.js (modulepreload-gated) | 28 | 112,140 | |
| admin login login-DAOMamn2.js | 15 | 102,317 | vendors already eager |

*The admin spine = the intersection every admin page shares: `vendor-react` 58,630 + `layout-DGpLF5IU` 9,372 (AdminLayout+GlobalSearch) + `index-DTMLXFjJ` 9,546 (sonner wrapper) + `vendor-query` 10,727 + `vendor-utils` 9,744 + `vendor-radix` 12,330 (dialogs) + `vendor-router` 2,421 + `admin-session` 945 + `idempotency` 883 + `errors` 2,717 + `TableSkeleton`/`EmptyState`/`status-badge`/`chart-theme`/`use-dirty-guard`/`fetch-error-card`/`users-BObzEa20` + ~15 shared lucide icon micro-chunks ≈ **117-125 KB gz**. First admin page pays spine + page; every subsequent admin nav costs only its page chunk (2-18 KB gz) + SW CacheFirst makes later visits ~zero-RTT.

- **No page chunk >100 KB gz** — biggest single page chunk is `products-BP3vU5X8.js` at 17.87 KB gz (the inline product editor + variants + inventory); biggest chunk of any kind is the lazy `vendor-charts` at 134,736 B gz.
- **vendor-charts is absent from every static graph** (dashboard's 35-file depmap contains no charts chunk; the only reference is the dynamic `import("./vendor-charts-B2c-mIVm.js")` inside dashboard/system) — the R125 ChartsLoader fix is structurally pinned at the dist level. Dashboard route = 134.9 KB gz static graph (R125 pre-fix measured 237.6 KB gz — **−102.7 KB gz off the admin landing paint, the R125 win holding exactly**).
- Micro-chunk census: 68 of 131 chunks are below 2 KB (post-merge) — shared lucide icons kept as separate chunks by the ranked-merge policy (vite.config.ts:838-850). The products graph alone pulls ~25 icon chunks (shield/gift/tag/zap/…) at 120-600 B gz each, ≈ 5-6 KB gz total. With h2 this is one multiplexed RTT burst, not serial — acceptable, but it is 33-45 requests per cold admin page on a no-CDN origin (see finding F5).

### B.2 Vendor split analysis (all sizes raw / gz)

| Chunk | raw | gz | eager? | who references it (dist-verified) |
|---|---|---|---|---|
| vendor-charts-B2c-mIVm.js | 514,746 | 134,736 | **lazy** | dynamic import() in dashboard + system only (R125 ✓) |
| vendor-react-3l2p7574.js | 185,868 | 58,630 | eager | modulepreload + entry static |
| vendor-firebase-DG6ky1FZ.js | 153,638 | 44,274 | **lazy** | 3 dynamic sites in entry — all inside `getFirebaseAuth`/`signInWithGoogle`/`setupFirebaseTokenRefresh` (src/lib/firebase.ts:26,53; firebase-auth.ts:26,154) |
| vendor-socket-BxTbGR0_.js | 42,518 | 13,319 | **lazy** | 1 dynamic site in entry (loader consumed by `use-socket-BGr2UEMK.js` / `SocketInitializer-BdY6Kt3f.js`, which contain no static socket import) |
| vendor-radix-0oDXErq5.js | 36,071 | 12,330 | lazy | admin pages + storefront dialogs |
| vendor-query-DWJ-o1nI.js | 36,484 | 10,727 | eager | modulepreload |
| vendor-utils-PJZsc2dN.js | 30,986 | 9,744 | eager | modulepreload |
| vendor-router-CsI1xlNO.js | 5,024 | 2,421 | eager | modulepreload |
| vendor-sentry | — | — | not emitted | DSN guard (no-DSN build) |
| sentry-replay-D-qmTlPK.js | 411 | 238 | dynamic-only | ErrorBoundary catch (stub under no-DSN; 40.58 KB gz recorder under DSN per R125) |

**Firebase is NOT eager and is deferred until auth interaction — verified end-to-end:** the dist entry's three `import("./vendor-firebase-…")` sites sit inside async helpers that are only called (a) when `isFirebaseAuthConfigured()` is true AND (b) on the Google-button click (`firebase-auth.ts:26`), on probe-verified Firebase-backed identities for the token refresher (auth.tsx:409-411 arms `firebaseIdentity` only after `/api/auth/probe` reports a Firebase-backed user; the refresher effect auth.tsx:485-525 installs 2 s after that verdict), or on `onIdTokenChanged` arming. Guests/WhatsApp/Telegram users never download the 44.27 KB gz chunk. **No further deferral is possible without breaking the refresh loop** — this is the correct steady state.

### B.3 CSS, fonts

- **CSS total: ONE purged Tailwind sheet** `index-lRkZmEYX.css` — 269,910 B raw / 31,830 B gz. cssCodeSplit produces nothing else (no per-page CSS exists — 1 css file among 153 assets). No oversized page CSS by construction. (Live deploy serves the byte-identical hash `index-lRkZmEYX.css`.)
- **Fonts: 6 `@font-face` (Readex Pro arabic+latin × 400/600/700), all `font-display: swap`** (verified in built CSS). Files: arabic woff2 9,799/10,463/10,287 B; latin woff2 14,403/15,075/14,971 B. **Subsetting is per-script** (fontTools cmaps: arabic-400 = 82 glyphs incl. basic Latin letters, no digits; latin-400 = 228 glyphs incl. digits, no Arabic). 4 preloads (arabic 400/600/700 + latin-400, index.html:129-132) exactly match the above-fold faces; latin-600/700 deliberately unpreloaded (vite.config.ts:229-241 rationale) and NOT precached… see next.
- **The no-`unicode-range` setup was empirically verified CORRECT in Chromium** (new this round): because the 6 same-family faces declare no `unicode-range`, the last-declared latin face wins shared glyphs and per-character fallback walks back to the arabic face for Arabic glyphs. Playwright/headless-Chromium canvas measurement against the exact shipped woff2 files: Arabic string width under the combined family = **1058 px = the arabic-400 face exactly** (latin-400 would render 1020, system fallback 1324.5); Latin+digits = 846/559 px = the latin-400 face exactly. → Both faces are used; the 4 preloads are all consumed above the fold. **No dead preload, no silent system-font fallback** (a risk worth clearing because @fontsource's subset css carries no unicode-range).
- **woff fallback weight:** 6 `.woff` files (94,140 B raw total) ship in dist as `src:` fallbacks; woff2-capable browsers never fetch them (not precached either — globPatterns is `assets/*.woff2` only, vite.config.ts:762). Deploy-image weight only. See F6.

### B.4 PWA precache vs first-visit needs

Precache manifest (from dist `sw.js`): **10 entries, 350.18 KiB raw** — `index.html` (11,574), `manifest.json` (2,231), `index-lRkZmEYX.css` (269,918), favicon.svg (163), 6 woff2 (74,498). Registration rides `window.load` (registerSW.js) → **install/activate happens after first paint by construction; the precache cannot delay FCP/LCP of the first visit** — it only competes for post-load bandwidth (images/catalog) on slow links, which is the documented offline-shell tradeoff (vite.config.ts:739-772). Navigations are SW cache-first (`createHandlerBoundToURL("index.html")` NavigationRoute in sw.js) → **repeat-visit shell is ~0 RTT**, which makes the live no-store HTML header (§D) a first-visit-only cost. No JS precached (globIgnores `**/*.js`), runtime rules intact (api-catalog SWR 60s/7d, images CacheFirst 200/30d, assets-js CacheFirst 160/30d). R125's "10 entries" unchanged — **no precache growth, no regression**.

### B.5 Image assets

- `public/products/`: 45 webp, 2,622-33,948 B each (541,496 B total; biggest: youtube-premium.webp 33.9 KB, cpanel.webp 31.1 KB) — all small, all `loading="lazy"` + `decoding="async"` in both consumers (storefront ProductCard.tsx:415-417 with first-4-eager/index-0-fetchpriority-high LCP policy; admin products.tsx per R125). **No unoptimized raster in the runtime path.**
- Non-runtime rasters: `pwa-screenshot-wide/narrow.png` 192,776/171,332 B (manifest install UI only — fetched by store/install surfaces, not the app), `opengraph.jpg` 39,597 B (unfurl-only, excluded from precache since R104), `subnation-logo.png` 28,096 B (crawler/JSON-LD only), pwa icons 5.3-50.7 KB. None precached. SVG hygiene: favicon.svg 163 B; all icons are tree-shaken lucide named imports.
- Live: `/products/youtube-premium.webp` → `cache-control: public, max-age=2592000, stale-while-revalidate=86400`, etag, `image/webp`. Note F7: filenames are unhashed while max-age is 30d — replacing catalog art serves stale bytes to returning visitors for up to 30d (browser) + SW images-v1 CacheFirst 30d.

---

## C. Runtime performance code audit (new depth)

### C.1 Big admin tables — render cost per row

Memo coverage at HEAD (all `React.memo` module-level rows + memoized flats + `useCallback` handlers):

| Page | rows | cap | memo boundary | per-row work |
|---|---|---|---|---|
| orders.tsx | `DesktopOrderRow` :234, `MobileOrderCard` :402 | 100/page ∞ (useInfiniteQuery) | ✓ | formatters cached (utils.ts:17-38), StatusBadge static map, no array ops per row |
| users.tsx | `DesktopUserRow` :211, `MobileUserCard` :262 | 100/page | ✓ + memoized flat :449 | cheap |
| products.tsx | `ProductCard` :267 | 200 server cap (:135) | ✓ + 7 stable callbacks | cheap |
| topups.tsx | `TopupCard` :168 | 100/page | ✓ (R125-F2 fix HELD: memoized flat :695, aggregates useMemo :834-842, handlers useCallback :864-917) | cheap |
| referrals.tsx | `ReferralRowItem` :133 | 100/page | ✓ | cheap |

Keystroke paths on orders/users/products/topups/referrals bail at the memo boundary (props = stable row refs from memoized arrays + primitives + stable callbacks) — the R124/R125 pattern is intact everywhere it was fixed. **The one unfixed page is tickets.tsx** (finding F2): `replyText` is page-level state (:142), the reply textarea is controlled (:719-720), and the ticket list is an inline non-memoized `.map` (:504-568) — every reply keystroke re-renders all loaded ticket cards (100/page accumulating, ~15-25 DOM nodes each). No search box exists on the page (no other keystroke driver), which is why this is P3, not the topups-class P2.

**Virtualization verdict (re-assessed, unchanged):** server caps 100/page accumulating + 200-cap products; realistic heavy session 300-500 rows. Memoized rows make per-keystroke cost = input only; polls re-render nothing (tracked props + structural sharing). Mount cost 100-250 ms at 500 rows, once. Not justified below ~1,000 accumulated rows; orders history is the first candidate if it ever gets there — do F4b (dual-layout gate) first, it halves DOM for free. Adding TanStack Virtual today would put bytes on every admin chunk for no measurable win.

### C.2 Effect waterfalls — none found

Automated scan for sequential top-level `await` pairs across `src/**` (non-test) found exactly 3, all inherently sequential (credential→getIdToken AuthProviders.tsx:155-156; idToken→session firebase-auth.ts:188-189; fetch→res.json support.tsx:221-222). The boot probes are already parallel (`Promise.allSettled([userProbe, adminProbe])`, auth.tsx:462). Dashboard stats + chart fetches ride separate queries/`fetchChart` with abort — no missed `Promise.all` exists.

### C.3 Zustand/context re-render traps — none

No zustand in the frontend (grep: zero imports). Context census: **cart** is split commands/state with `useCallback([])` + memoized values (cart.tsx:336-344) — an add-to-cart tap re-renders Navbar only, ProductCards ride the identity-stable commands context (cart.tsx:74-102); **auth** value is `useMemo`-ed on real identity fields (auth.tsx:527-554), changes only on login/logout/init-flip; **theme** memoized (theme.tsx:49). No broad-selector trap exists.

### C.4 Recharts post-R125

- **Zero residual eager recharts**: the only runtime references are the two `ChartsLoader` bridges (dashboard.tsx:79-85, system.tsx:51-58) — dist-verified dynamic boundary (§B.1). Type-only imports erase at compile time.
- Chart data transformation per render: `displayData = useMemo(aggregateData(chartData, granularity), …)` (dashboard.tsx:542, R125-F7 fix HELD); sparklines consume `chartData` directly (stable identity from query structural sharing — no re-reconciliation on unrelated re-renders); `TrendBadge` is a slice+reduce over ≤90 items (:337-343). Chart fetch is abort-guarded with stale-response guards (:468-531, R125-F1 fix HELD); period switches keep charts mounted with an `opacity-60` overlay (:945, :1083, R125-F8 fix HELD); `handleRefresh` is single-fire invalidateQueries (:549-556, R125-A1-4 fix HELD).
- Cost profile after the fix: first mount streams vendor-charts in parallel behind height-reserved shimmer fallbacks (ChartPanelFallback, `h-8` sparkline slots — no CLS); re-renders are data-identity-gated. Nothing left to fix here.

### C.5 SPA route-transition cost

All 40 routes are `lazyWithRetry` (App.tsx:38-92; admin 60-79; storefront 38-57; status 82) — **no eagerly-imported page exists** (NotFound is inlined in the entry at trivial size). Storefront warm-up on pointerenter/focusin for product/category/cart/checkout/wallet families (App.tsx:379-457), saveData-gated, admin links excluded. Admin→admin warm-up is still absent (R125-F10, open, F8 here — capped benefit). The route Suspense fallback picks a per-destination skeleton (ROUTE_SHAPES, App.tsx:105-146) — route swaps are content-fills. The admin guard re-mount is TanStack-cached (5-min staleTime, App.tsx:513-517) so admin hops don't re-probe.

### C.6 Startup path (cold-start waterfall, from dist + main.tsx)

Before first paint a cold storefront visit executes/downloads, in order:
1. `init.js` — 404 B blocking classic script (theme class from localStorage, 10 lines; dist public/init.js).
2. HTML head parse kicks off **in parallel**: entry `index-DCk1GKVF.js` (32.4 KB gz), 4 modulepreloaded vendors (81.5 KB gz), CSS (31.8 KB gz), 4 font preloads (44.9 KB woff2, already-compressed bytes), and the gate-injected home modulepreload (8.0 KB gz).
3. Entry evaluates: boot-error buffer installs synchronously (main.tsx:17), offline fallback div removed (:41), API bridge + token getter set (:47-57), boot head-start fires home chunk import + (home-path boots only) the catalog prefetch (App.tsx:302-365 — the products request is in flight while the auth probe runs).
4. React mounts → AuthGate splash → probe lands (`/api/auth/probe`, 10 s abort) → home route paints from the already-warm chunk + seeded query cache.
5. `window.load`: SW registers → precache 10 entries (350.18 KiB) post-paint. Idle: web-vitals + analytics + Toaster chunk (IdleToaster, App.tsx:935-945).

Total pre-paint wire ≈ **199 KB gz** (145.7 eager + 8 home + 44.9 fonts) over ~10 h2-multiplexed requests = shell RTT + transfer; two lazy hops max (route chunk → its deps). Sentry is absent (no-DSN) or idle-deferred (DSN); Firebase/socket/toasts/sonner/replay/qrcode/charts are all behind dynamic boundaries. **This is a clean waterfall — the only serialization left is the auth probe → gate, which the head-start already overlaps.**

---

## D. Live timing cross-check (guest GETs, 3 runs each, from this box)

| Endpoint | TTFB (runs → median) | total | size | enc | cache |
|---|---|---|---|---|---|
| `GET /` | 0.811 / 0.848 / 0.628 → **0.811 s** | 1.039 s | 11,574 B raw → 4,560 B br | br | no-store + etag |
| `GET /product/lifetime-cloud-storage` | 1.056 / 0.787 / 0.626 → **0.787 s** | 1.025 s | 11,384 B (per-route meta-injected shell) | br | no-store |
| `GET /api/products?fields=list` | 0.616 / 0.588 / 0.633 → **0.616 s** | 0.910 s | 17,445 B raw → 3,399 B br | br | `public, max-age=0, s-maxage=60, stale-while-revalidate=300` ✓ |
| `GET /assets/vendor-react-*.js` | 0.972 / 0.672 / 0.873 → **0.873 s** | 1.393 s | 185.9 KB raw | br | `public, max-age=31536000, immutable` ✓ |

Live correlation with dist: the live shell is 11,574 B raw — byte-identical size to my dist `index.html`; the live CSS and all 4 preloaded font hashes are **identical to my HEAD build** (`index-lRkZmEYX.css`, `readex-pro-*-De1vYjJZ/BZyEP9JP/Ct3R0tUO/DJUYAYkk`); JS entry hash differs (`index-BN-pn-rf.js` — the DSN-configured deploy, consistent with R125's 146,096 B gz DSN eager number). The admin home-preload gate and the R125 chunk architecture are **live-deployed**, not just built. Brotli is on for HTML, API, and assets; hashed assets are immutable 1y; the catalog edge-caches exactly as the SW runtime rule mirrors.

**The dominant live cost is origin RTT** (single VPS behind Coolify's proxy, no CDN): ~0.6-0.9 s TTFB per cold request from this vantage. On a first visit that's one multiplexed burst (§C.6); on repeat visits the SW serves shell (cache-first NavigationRoute), JS (assets-js CacheFirst) and images — so the residual network cost is the no-SW first visit and the API calls (0.6 s median catalog TTFB, mitigated by s-maxage=60 edge + SWR). Everything under the app's control (bytes, boundaries, caching policy, compression) is done; the remaining lever is infrastructure — see O1.

---

## E. Regression detection vs R125 (first-class deliverable)

| Metric | R125 recorded | HEAD (this build) | Δ verdict |
|---|---|---|---|
| Entry chunk gz | 32,362 B | 32,365 B | +3 B — noise, **no regression** |
| Eager path gz (no-DSN) | 145,709 B | 145,717 B | +8 B — noise; 2.8 KB under the 145 KiB warn line |
| Eager path gz (DSN) | 146,096 B | (not rebuilt — unchanged delta basis) | n/a, both under gate |
| vendor-charts lazy chunk | 514.75 KB raw / 134.74 KB gz | 514,746 B raw / 134,736 B gz | identical — **R125 fix held** |
| Dashboard static route graph | 237.6 KB gz (pre-fix audit build) | 134,924 B gz | **−102.7 KB gz — the R125 win holding** |
| Admin home-preload waste on /admin boots | 8.53 KB gz (F4) | 0 (gate verified dist + live) | **R125 fix held** |
| CopilotPanel dynamic chunk | 33.05 / 10.48 | 33,046 B raw / 10,487 B gz | identical |
| layout-*.js (admin chrome) | 27.12 KB raw / 8.74 gz (pre-impl) | 29,131 / 9,372 | +0.63 KB gz — R125 implementation lanes (per-route titles, a11y batch), expected feature growth, one-time shared cost |
| Admin route graphs | products 147.9 / orders 138.1 / topups 136.4 / users 134.1 / settings 135.0 KB gz | 152.0 / 141.8 / 140.2 / 138.0 / 139.2 | **+3.7-4.2 KB gz each** — R125's own implementation additions (aria-pressed chips, 2FA re-auth gate, has_unread_admin cue, memo fixes, skeletons). Growth accounting, not regression: eager path unchanged, per-page incremental ≈ unchanged |
| CSS | 31.99 KB gz | 31,830 B gz | −0.16 KB |
| PWA precache | 10 entries | 10 entries / 350.18 KiB | unchanged |
| sw assets-js cap | 160 entries | 160 (vite.config.ts:730) | held |
| topups memo (F2 fix) | fixed in R125 | HELD (§C.1) | held |
| dashboard abort/memo/mounted (F1/F7/F8 fixes) | fixed in R125 | HELD (§C.4) | held |
| R125 open P3s F5/F9/F10/F11 | open | **still open** (F1/F3/F4/F8 below) | unchanged, not regressed |

**Verdict: zero regressions at HEAD vs R125's recorded numbers.** The only growth is R125's documented feature work landing in lazy route chunks.

---

## F. Findings

### F1 — [P3] Entry chunk still hosts admin-only code (R125-F5 residual, verified at HEAD)
`index-DCk1GKVF.js` contains 28 admin-API string sites (`/api/admin/products` ×11, `/api/admin/pricing` ×5, `/api/admin/topups` ×3, `/api/admin/orders` ×3, `/api/admin/stats` ×2, users/login/logout/probe/session) — orval-generated admin fetchers + the admin probe/login plumbing ride the entry (source: `shared/api-client-react/src/generated/api.ts`, `src/lib/auth.tsx:437-460`, `src/lib/admin-session`). Every storefront visitor downloads ~1-2 KB gz of admin client code it never executes. Fix: orval per-tag split or moving the admin probe/`admin-session` import behind the admin-session dynamic chunk. Effort M, savings −1-2 KB gz × every storefront boot.

### F2 — [P3] tickets.tsx: reply keystrokes re-render the whole loaded list (the last non-memoized list page)
`tickets.tsx:142` page-level `replyText`, `:719-720` controlled textarea, `:504-568` inline card map, zero `React.memo` in the file; `visibleTickets` is memoized (`:210`) but the JSX isn't. Typing a reply re-renders up to 100 accumulated ticket cards (~15-25 DOM nodes each) per keystroke — same class as the R124/R125 fixes on 4 sibling pages; tickets never received the pattern (no search box = no other driver, hence P3 not P2). Fix: module-level `React.memo` TicketCard (primitive `isActive` prop) — the orders recipe, Effort S.

### F3 — [P3] Admin chrome re-renders every 5 s forever (R125-F9, still open)
`layout.tsx:949-958` — `setInterval(5000)` → `setSecondsAgo` once badge data lands; `AdminLayout` re-renders ~20 NavItems + topbar every 5 s (12×/min on every open admin tab; page content bails via stable `children`). NavItem (`:148`) is a plain function and would stay defeated by inline props (`:1195-1196`) even if memoized — the R125 sketch (extract the pill into its own component owning the interval) remains the right S-effort fix.

### F4 — [P3] products dirty-check stringify + orders/users dual-layout DOM duplication (R125-F11, still open)
`products.tsx:600` `JSON.stringify(form) !== JSON.stringify(formBaseline)` per render (KB-scale form fields, twice per render — µs-scale but free to fix); `orders.tsx:1532/:1637` and `users.tsx:1357/:1430` mount desktop `<table>` AND mobile card lists with one merely `display:none` — doubles row nodes for mount/memory/memo-compare at 100-500 accumulated rows. Fix: field-compare or useMemo (S); media-query-gate the hidden tree (S/M).

### F5 — [P3] 68 sub-2 KB micro-chunks: 33-45 requests per cold admin page
The ranked icon-merge policy (vite.config.ts:838-850) deliberately keeps shared lucide icons as 120-600 B gz chunks; the products route graph = 45 files. On h2 this is one multiplexed burst (~5-6 KB gz of icon bytes total), but each request carries per-request CPU/header cost and any HTTP/1.1 fallback (or a slow proxy) would serialize them on a no-CDN origin. Options: raise `experimentalMinChunkSize` (2048 → 4096) — the eager-sum gate protects against any accidental re-eagering — or accept as-is. Effort S, savings ~15-25 requests/page (byte-neutral).

### F6 — [P3] 94.1 KB of woff fallback fonts ship in the deployment, never fetched
6 `readex-pro-*.woff` files (12,368-18,824 B each) ride `dist/public/assets/` as `src:` format("woff") fallbacks; every woff2-capable browser (the CSP'd, h2, br-served audience) never requests them, and the precache globs only `*.woff2`. Pure Docker-image/deploy weight. Fix (optional): strip `*.woff` from the emitted assets or import only `@fontsource/readex-pro/arabic-*.css`-equivalent woff2-only faces. Effort S.

### F7 — [P3] Unhashed product art + 30-day max-age: stale-art window on replacement
`/products/*.webp` (unhashed names) served `max-age=2592000, stale-while-revalidate=86400` + SW images-v1 CacheFirst 30d. Replacing a catalog image leaves returning visitors on old art up to 30 days (SWR softens to ~1 day after expiry). Acceptable for effectively-immutable art; document as a known trade-off (the config comment says exactly this) or add a hash/v-query on replacement.

### F8 — [P3] No admin→admin warm-up, first session only (R125-F10, still open)
Sidebar NavItem links (`layout.tsx:169/:208`) carry no pointerenter/focusin warm-up; each first-session admin nav pays its page chunk cold (~3-18 KB gz incremental after the spine, one RTT). Capped benefit (staff-only, SW-cached after first visit) — do last, `saveData`-gated like App.tsx:424-425. Effort S/M.

### Not-findings (explicitly cleared, with method)
- **Font-face resolution under no-unicode-range** — empirically verified correct in Chromium (§B.3); all 4 preloads consumed above the fold.
- **Effect waterfalls** — none (§C.2). **Context/zustand traps** — none (§C.3). **Eager recharts residue** — none (§C.4). **Oversized page CSS / page chunks >100 KB gz** — none (§B.1/B.3). **Unoptimized raster in runtime path** — none (§B.5). **PWA precache bloating first paint** — no (post-load registration, §B.4).

**Counts: P0: 0 · P1: 0 · P2: 0 (code) · P3: 8 (F1-F8) · plus 1 P2-grade infrastructure opportunity (O1) owned outside the app bundle.**

---

## G. Prioritized optimization list (implementation lane, expected savings)

1. **O1 (infra, biggest live win): edge-cache the HTML shell + assets.** Origin TTFB medians 0.6-0.9 s (§D) are the residual latency on every no-SW first visit; the shell is `no-store` (correct for release-atomicity) but could take a short CDN `s-maxage` + `stale-while-revalidate` (the catalog API already proves the pattern: `s-maxage=60, swr=300`) with cache-busting on deploy via filename-hash references (already true — only `index.html` itself is unhashed). Expected: **−300-600 ms first-visit FCP/TTFB in-region**, −1 RTT per cold asset fetch. Zero app-code change.
2. **O2 (F1): de-admin the entry chunk.** Move admin probe/session plumbing + orval admin-tag fetchers out of `index-DCk1GKVF.js`. Expected: **−1-2 KB gz × every storefront visitor** (entry 32.4 → ~30.5 KB gz) and restores eager-path headroom (currently 1.9% under warn). Effort M (orval layout + one dynamic import).
3. **O3 (F2+F3): tickets TicketCard memo + pill-tick extraction.** Expected: removes 100-card re-renders per reply keystroke (~5-15 ms desktop, INP-relevant on low-end admin phones) and 12 full-chrome re-renders/min per open admin tab. Effort S+S, same PR class as R124's memo pass.
4. **O4 (F5): raise `experimentalMinChunkSize` 2048→4096.** Expected: **−15-25 requests per cold admin page** (byte-neutral), protected by the eager-sum gate. Effort S.
5. **O5 (F4): products dirty-check + dual-layout gating.** Expected: removes per-render double-stringify (µs) and halves orders/users DOM (mount/memory; the pre-virtualization step if lists ever grow past ~1,000 rows). Effort S/M.
6. **O6 (F6/F7/F8): woff strip, art-replacement runbook note, admin-nav warm-up.** Polish tier; each S.

---

## H. Verdict

**SHIP-WORTHY.** The R125 performance program held byte-for-byte at HEAD (eager path 145,717 B gz no-DSN, +8 B vs R125 — under the 145 KiB gate; charts/firebase/sentry/replay/socket/toaster/qrcode all behind verified dynamic boundaries; admin landing paint −102.7 KB gz vs the R125 audit build and live-deployed). No P0/P1/P2 code findings; the 8 open P3s are polish (the largest, F1, is ~1-2 KB of hygiene). The single biggest remaining lever is infrastructure (edge caching for the no-CDN origin), not application code.

— R126-A5, 2026-10-09. One build (no-DSN), dist-only artifacts; no source modified, no commits; this report + the worklog entry are the only writes.
