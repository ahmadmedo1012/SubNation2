# R128-B2 — Performance retry + PWA/SW audit (tight scope)

- **Agent:** R128-B2 (perf + PWA lane, RETRY round — READ-ONLY on source; this report + one worklog append are the only writes)
- **Date:** 2026-10-10 · **Repo HEAD:** `7d469d5` (main, clean except this docs dir) · **Live:** https://subnation.ly — R127 deploy confirmed live by B1 (entry `index-DU6n5OLO.js`; re-confirmed this pass: live shell references the same asset family, HTML 11,592 B raw).
- **Question this retry answers:** did R127's boot-perf fixes (commit `a1426cb`: vendor-sentry deferred to first interaction, optimistic `/login`, card-image warming, DSN-parity budget gate) move live mobile LCP off the POOR 4.2–4.3 s baseline (R127-B4)? Plus: boot waterfall on `/`, SW lifecycle + cache truth, PWA install plumbing.
- **Baseline:** `docs/inspection-r127/B4-live-performance.md` §A table (read first; not re-reported). Its open items are only referenced where my measurements change them.

## Method + provenance (all numbers first-hand)

- **Lighthouse 13.5.0** (pinned, same version as R127-B4's basis), Chrome-for-Testing **153.0.8010.36 headless-shell** (`CHROME_PATH=…/chrome-headless-shell`), `--only-categories=performance --chrome-flags="--headless --disable-dev-shm-usage --no-sandbox --disable-gpu"`, default mobile preset (Moto G Power class, 4× CPU, slow-4G **simulated** 1,638 kbps / 150 ms RTT). JSON under `scripts/r128-b2/lh/`.
- **Provenance caveat (honest):** this retry was budgeted for 1 run/route, but this task's two earlier (timed-out) attempts in this same workspace had already completed 14 runs at 12:36–12:41 today against the same live deploy with the identical pinned toolchain (`run-lh.sh`, unchanged). I added a fresh confirmation run on `/` (13:08) + fresh curl timings. Result: **15 runs = 5 routes × 3**, all `runWarnings: []`. I report per-route **medians** with the full 3-run spread — strictly better than the 1-run minimum, zero extra traffic (~15 page loads + 3 curls total, measurement-only).
- **Box latency context:** 3× `curl -w` to `/` (2 s apart).

---

## Section 1 — Lighthouse mobile, 5 routes × 3 runs (vs R127-B4 baseline)

### Box latency — 3× curl to `/` (2026-10-10 13:0x, this vantage)

| # | dns | connect | tls | **ttfb** | total | size |
|---|---|---|---|---|---|---|
| 1 | 6.7 ms | 201 ms | 661 ms | **868 ms** | 1,059 ms | 11,592 B |
| 2 | 7.0 ms | 194 ms | 394 ms | **586 ms** | 766 ms | 11,592 B |
| 3 | 6.1 ms | 283 ms | 576 ms | **880 ms** | 1,143 ms | 11,592 B |

Median TTFB **868 ms** (0.59–0.88) — unchanged vs R127-B4's 0.63–0.84 (median 0.769): the no-CDN origin-RTT ceiling (R126-A5 O1) persists; nothing R127 shipped changed it (nor was it expected to).

### The results table (per-route median of 3; spread in parens; all ms, CLS unitless)

| Route | Perf score | FCP | **LCP** | TBT | CLS | SI | TTFB (audit) |
|---|---|---|---|---|---|---|---|
| `/` | **84** (83–89) | 2,125 (2,078–2,136) | **3,111** (2,990–3,128) | 272 (35–285) | 0.005 (0–0.025) | 4,558 (4,210–4,575) | 212 (199–218) |
| `/category/software` | **84** (82–88) | 2,233 (2,024–2,279) | **3,554** (3,276–3,583) | 54 (26–110) | 0.000 | 4,972 (4,159–6,324) | 230 (196–681) |
| `/product/lifetime-cloud-storage` | **86** (79–89) | 2,043 (2,035–2,208) | **3,310** (3,243–3,408) | 43 (36–44) | 0.000 (0–0.083) | 5,384 (3,988–9,238) | 396 (196–588) |
| `/login` | **84** (84–85) | 2,262 (2,244–2,318) | **3,444** (3,387–3,518) | **89** (32–111) | 0.036 (0.036–0.042) | 5,076 (5,018–5,292) | 237 (200–290) |
| `/flash-sales` | **90** (89–95) | 2,212 (1,793–2,218) | **2,518** (2,190–2,580) | 52 (0–91) | 0.081 | 4,414 (3,680–5,543) | 204 (197–303) |

### vs R127-B4 baseline (mobile, single-run basis there) — did the fixes move LCP?

| Route | R127-B4 LCP | **R128-B2 LCP (median)** | **Δ LCP** | R127-B4 score | R128-B2 score | R127-B4 TBT | R128-B2 TBT |
|---|---|---|---|---|---|---|---|
| `/` | 4,307 | **3,111** | **−1,196 ms (−28%)** | 74 | 84 (+10) | 330 | 272 |
| `/category` (baseline: `streaming`; this pass: `software`) | 4,229 | **3,554** | **−675 ms** | 79 | 84 (+5) | 138 | 54 |
| `/product/lifetime-cloud-storage` | 4,323 | **3,310** | **−1,013 ms (−23%)** | 81 | 86 (+5) | 53 | 43 |
| `/login` | 4,260 | **3,444** | **−816 ms (−19%)** | 66 | **84 (+18)** | **621** | **89 (−532)** |
| `/flash-sales` | (not measured) | 2,518 | n/a — new coverage | — | 90 | — | 52 |

**Verdict: YES — R127's fixes moved mobile LCP materially on every route (−0.7 to −1.2 s), lifting all five routes out of the POOR band (>4.0 s) into NEEDS-IMPROVEMENT (2.5–4.0 s); `/flash-sales` run-2 even touched GOOD (2,190 ms).** The two route-specific fixes landed exactly where aimed:

- **vendor-sentry deferral (D2): CONFIRMED in the lab.** `vendor-sentry-*.js` is fetched **0 times during load across all 15 runs** (baseline: fetched on every route, 111 KB br, the #1 unused-JS item). The `unused-javascript` finding has **vanished entirely** (no items in any run) and the 221 ms vendor-sentry long task at ~3.6 s is gone. Total transfer on `/` fell ~605 KB → ~492 KB. Remaining long tasks are all `vendor-react` (52–180 ms) + one `vendor-query` (246–247 ms on home).
- **Optimistic `/login` (D3): CONFIRMED on the standard (simulated) basis.** Score 66 → 84; TBT **621 → 89 ms** (the "poor"-boundary finding is closed); LCP element is still the rendered «المتابعة عبر Telegram» button (text render, no image). Note honestly: today's *observed* (vantage-dependent) LCPs run slower/noisier than B4's single observed runs on **every** route (home 2,499 → 2.7–4.6 s, product 2,963 → 2.6–6.6 s, login 2,825 → 3.4–3.6 s) — i.e. today's vantage is worse for raw traces overall, while the vantage-independent simulated model shows login −816 ms, home −1.2 s, product −1.0 s. The simulated deltas are the trustworthy signal; the login splash-gate removal shows up as the TBT collapse + score jump, not in the observed render-delay phase.
- **Card-image warming (D5): CONFIRMED as LCP-element flip.** The mobile LCP element on image routes is now **index-0 cards at `fetchpriority="high" loading="eager"`** (`lifetime-cloud-storage.webp` on home/product, `cpanel.webp` on category) — the baseline's "index 1 at auto" complaint is gone; image load time is 221–348 ms.
- **What did NOT move:** FCP (~2.0–2.3 s, ≈ baseline) — expected, entry-JS path unchanged; TTFB/origin RTT (868 ms median) — the held-open CDN lever.

**Variance caveat:** 3 runs/route, single vantage, simulated throttling — route medians are solid to ±~150 ms, but per-run spread on category/product SI is wide (e.g. product-m3 SI 9,238 vs 3,988; its observed TTFB was 993 ms — one slow origin hit skews single runs). No cross-route conclusion below 200 ms should be drawn from this table.

**Remaining gap to GOOD (<2.5 s):** on every route the LCP is still discovery/render-delay bound (see Section 2) — the SPA boot chain (entry JS → catalog API → React render) still serializes ~1.7–2.2 s before the winning element paints; the origin RTT (~0.6–0.9 s) is the other fixed share. The next structural levers remain the held-open CDN/edge-cache (O1) and server-rendered/prefetched critical content.

---

## Section 2 — Boot waterfall on `/` (Playwright, live)

**Method:** repo's playwright 1.63.0 chromium, mobile viewport 412×823 (DPR 1.3, isMobile+touch), CDP `Emulation.setCPUThrottlingRate 4×`, **live network unthrottled**, 3 passes; init-script `PerformanceObserver`s (longtask + largest-contentful-paint buffered) + `performance` API (navigation/resource/paint). Script + raw output: `scripts/r128-b2/waterfall2.mjs` / `waterfall-out.txt`.

### Timeline (pass 2 = representative; spread over 3 passes in [brackets])

| Event (ms from nav start) | pass 2 | spread |
|---|---|---|
| HTML TTFB / **done** | 599 / **601** | [599–617] / [601–644] |
| entry JS `index-DU6n5OLO.js` (33.7 KB) start → end | 658 → 1,251 | start ~[658–680] |
| `vendor-react-CHZ2RHBD.js` (58.1 KB) end | 1,445 | [1,445–1,483] |
| home chunk `home-BTnahYpP.js` (8.6 KB) start → end | 863 → 1,448 | [863–1,097] → [1,448–2,147] |
| DOMContentLoaded / **React root children** (mount) | 1,688 / 1,713 | [1,672–1,688] / [1,701–1,843] |
| **FCP** (paint API) | **2,052** | [2,008–2,172] |
| `ProductCard-DHFf9jIp.js` chunk (4.8 KB) start → end | 1,663 → 1,975 | ends [1,975–2,490] |
| catalog `/api/products?fields=list` start → end | 1,678 → 2,641 | ends [2,468–3,064] |
| `/api/auth/probe` (parallel) | ~2,070 → 2,642 | — |
| **first card image** (e.g. `lifetime-cloud-storage.webp`, 27.5 KB) start → end | **2,664 → 3,748** | start [2,473–3,075] |
| **LCP** (performance API) | **3,812** | [3,812–4,052] (pass-3 outlier 6,940, see below) |

- **LCP element:** `IMG.absolute inset-0 z-[2]…` with alt «Lifetime Cloud Storage — اشتراك برامج وتراخيص» (pass 2) / `cpanel.webp` card (passes 1+3) — always an **index-0 card image**, `fetchpriority="high"` (Lighthouse runs agree).
- **Image warming (R127 D5) is visibly live:** the card-image request starts **+23 ms after the catalog response resolves** (2,664 vs 2,641; +137/+200 ms in the other passes) — before React could have rendered a card from that data. The pre-warm `new Image()` on prefetch resolution is doing its job.
- **Long tasks >50 ms in first 5 s** (pass 1, worst pass): 57@1,496 · **231@1,553** · 62@2,398 · 96@2,796 · **207@3,584** · 75@3,796 · **648@4,049** · 50@4,715 · 57@4,817 · 78@4,975. Milder passes: 190@1,505 + 70@2,398 (pass 2) · 210@1,462 + 57@1,284 + 55@2,296 (pass 3). The biggest task (648 ms, pass 1) lands at 4,049 — exactly at that pass's LCP (4,052), i.e. the final card render/hydration burst is itself the last blocker. vendor-react eval remains the boot tax (LH bootup: 565–842 ms across runs).

**What still serializes boot:** the chain is now HTML (~0.6 s origin RTT) → parallel JS download + vendor-react eval (~1.5 s to React mount → FCP ~2.0 s, gated by main-thread eval, not network) → **catalog API, which can only start after entry-JS eval** (~1.7 s in) and costs a full origin RTT (~1.0 s) → **card image fetch, which can only start after the catalog resolves** (warming now fires it instantly, but the hop itself remains) → image download (~0.3–1.8 s, vantage-dependent) → LCP. Three round-trip-bound stages are inherently serial in the SPA design: TTFB, catalog, image; on this no-CDN origin each hop pays 0.6–0.9 s. Two second-order observations: (a) `ProductCard-*.js` is a *second serial chunk hop* (fetched only after `home-*.js` evaluates, 1,663 vs home-end 1,448) — but it finishes before the catalog does in every pass, so it is **not** on the LCP critical path today (it would become one if the catalog were ever faster than ~0.5 s); (b) pass 3 reproduced the **late-LCP-supercession anomaly** on a mobile trace (image bytes done at 4,295 but the final LCP entry at 6,940 — a late repaint ~2.6 s after the image loaded, echoing R127-B4's desktop observed-anomaly; font-swap text-metric reflow or fade-in repaint are the candidates; 1 of 3 passes, not modeled by LH simulate).

---

## Section 3 — SW lifecycle + cache truth (code + 3 live checks)

### The config (generateSW, `frontend/vite.config.ts:849–1008`) and what actually shipped (live `/sw.js`, 2,355 B, fetched this pass)

| Aspect | Code | Live/built truth |
|---|---|---|
| Mode / registration | `VitePWA({ registerType: "autoUpdate", manifest: false, … })` (:849–855) | generateSW; `/registerSW.js` (134 B, live) = `navigator.serviceWorker.register('/sw.js', { scope: '/' })` on `load` — minimal autoUpdate registrar, no prompt UI |
| Update flow | autoUpdate | built sw.js opens with **`self.skipWaiting()` + `clientsClaim()` + `cleanupOutdatedCaches()`** — silent immediate takeover: a deploy's new SW activates at next visit; no user-facing update banner (by design). Safe under hashed-asset policy |
| Precache (offline shell) | `globPatterns` = index.html, manifest.json, `assets/*.css`, `assets/*.woff2`; `globIgnores: ["**/*.js"]` (:976–1005); 384 KB size cap (:998) | precacheAndRoute = **9 entries** (index.html, manifest.json, 1 CSS, 6 woff2, favicon.svg) — **zero JS, zero images precached** (the deliberate diet); favicon via `includeAssets` (:862) |
| Navigation fallback | `navigateFallback: "index.html"`, denylist `/^\/api\//, /^\/assets\//` (:1006–1007) | `NavigationRoute(createHandlerBoundToURL("index.html"), { denylist:[/^\/api\//,/^\/assets\//] })` — **scope = every same-origin navigation** except api/assets, served from the precache (offline navigation works) |
| Runtime caching | 3 rules (:900–963) | live in sw.js: `api-catalog-v1` **SWR** (32 entries / 7 d — the 96-F7 offline-catalog fix), `images-v1` **CacheFirst** (200 / 30 d), `assets-js` **CacheFirst** (160 / 30 d — the 98-F7 HTTP-cache-eviction backstop). All three match config byte-for-intent |

### The 3 live checks (2026-10-10, this pass)

| Check | Result | Verdict |
|---|---|---|
| `GET /sw.js` | 200 `text/javascript`, **`cache-control: no-cache, no-store, must-revalidate`** (+ HSTS, COOP, CORP, nosniff) | ✅ **CORRECT** — the SW is always revalidated so deploys propagate (set at `backend/src/app.ts:1577–1584`: sw.js/registerSW.js/html/robots.txt join the no-store set). Live-verified |
| `GET /sw.js.map` | **200 `application/json` (6.4 KB), `cache-control: public, max-age=3600`** | ❌ **F1 LEAK STILL LIVE** (re-confirms R128-B1 item 10). The SW's source map is publicly fetchable and edge-cacheable |
| `GET /assets/` (directory) + `GET /assets/definitely-missing-b2.js` | **both 200 `text/html` (SPA shell, 11,418 B)** | ❌ **F2 SOFT-200 STILL LIVE** (re-confirms B1). Missing-asset monitors see fake 200s; a directory path serves the SPA |

**Exact config lines that fix each** (for the fix lane — one S commit, B1's own plan):

- **F1 (sw.js.map):** `frontend/vite.config.ts:579–602` `sourcemapGuardPlugin.closeBundle` sweeps **only** `dist/public/assets` (:585) — `sw.js.map` is emitted at the **dist root** (vite-plugin-pwa@1.3.0's top-level `sourcemap` option *defaults to the Vite build sourcemap*, which the Sentry deploy path enables). Two-line fix: set `sourcemap: false` in the `VitePWA({...})` block (:849–855) **and/or** extend the guard's sweep to the dist root (`readdirSync(distPublic).filter(f => f.endsWith(".map"))`). Cosmetic rider: the live sw.js carries a **doubled** `//# sourceMappingURL=sw.js.map` comment (workbox artifact) — disappears with the same fix.
- **F2 (/assets soft-200):** `backend/src/app.ts:1618` and `:1699` — both SPA-fallback guards test only `req.path.startsWith("/api")`, so `/assets/*` misses fall through to the per-route shell. Fix: add `|| req.path.startsWith("/assets")` to both guards + a plain 404 responder, with the pinning test B1 specified (`GET /assets/nope.js → 404 non-HTML`). Note the SW is *not* the leak path — its NavigationRoute already denies `/assets/` (vite.config.ts:1007); the server fallback is.
- **F4 context (offline-div reveal, B1 item 10):** live index.html:165 (`animation: sn-offline-reveal 0.4s ease 2.5s forwards`) unchanged — but in all 3 waterfall passes React removed the div at ~1.7 s (main.tsx:41), **before** the 2.5 s animation could flash it; the reveal only bites on boots slower than 2.5 s (real slow-3G). Re-confirmed open, unchanged priority.

---

## Section 4 — PWA install plumbing (NOT asset quality — A6 owns that)

### Manifest completeness (`frontend/public/manifest.json` = single source of truth per vite.config.ts:851–855; live `/manifest.json` 200 `application/json` 2,231 B, byte-identical head-to-head with repo)

| Field | Value | Status |
|---|---|---|
| name / short_name | «SubNation — سوق الاشتراكات الرقمية» / «SubNation» | ✅ |
| description | Arabic, 140 chars, keyword-forward | ✅ |
| id / start_url / scope | `/` / `/` / `/` (start_url 200 live, within scope) | ✅ |
| display / orientation | `standalone` / `portrait-primary` | ✅ |
| theme_color / background_color | `#dc1840` / `#0a0a0a` (matches live `meta theme-color` in shell) | ✅ |
| lang / dir | `ar` / `rtl` | ✅ |
| categories | shopping, entertainment | ✅ |
| icons | 96 / 192 / 512 `any` + **512 `maskable`** — all 4 entries | ✅ |
| screenshots | narrow 540×1080 + wide 1080×540, both with `form_factor` + Arabic `label` (richer than required) | ✅ |
| shortcuts | Arabic (المتجر / طلباتي / …) with 96px icons | ✅ |

**Icons declared-vs-actual (IHDR byte read, repo files + live download):**

| File | Declared | Actual (repo) | Actual (live) | Live cache header |
|---|---|---|---|---|
| pwa-96x96.png | 96×96 | 96×96 (5 KB) | — | — |
| pwa-192x192.png | 192×192 | 192×192 (13 KB) | — | — |
| pwa-512x512.png | 512×512 (+maskable) | 512×512 (50 KB) | **512×512 (200, `image/png`, byte-size match)** | `public, max-age=2592000, swr=86400` (app.ts:1593–1599 rule live ✓) |
| pwa-screenshot-narrow.png | 540×1080 | 540×1080 (167 KB) | — | — |
| pwa-screenshot-wide.png | 1080×540 | 1080×540 (188 KB) | — | — |

**Zero size-lies in the icon set** — every declared `sizes` string matches the file's true dimensions.

### Installability verdict

- **Lighthouse PWA/"installability" audit: not available in LH 12/13** (the PWA category was removed in LH 12; my 13.5.0 perf-only runs carry no installability audit). Criteria therefore verified directly, **all Chromium installability prerequisites pass (code-certain + live-probed):** fetchable parseable manifest at `/manifest.json` → 200 correct content-type; `start_url` within scope and 200; `display: standalone`; icons 192 + 512 + **maskable 512** with exact dimensions; **service worker with fetch handlers controlling start_url** (precacheAndRoute + NavigationRoute + 3 runtime rules, live-verified above); served over HTTPS. **Installable: YES.**
- **iOS meta tags (live shell, byte-verified):** `apple-mobile-web-app-capable: yes` · `apple-mobile-web-app-status-bar-style: black-translucent` · `apple-mobile-web-app-title: SubNation` · `apple-touch-icon → /pwa-192x192.png` · `<link rel="manifest">` + `theme-color #dc1840` — the full iOS homescreen set is present. ✅
- **Gaps (minor, P4):** (1) no `beforeinstallprompt`/custom install UI anywhere in `frontend/src` (grep = 0) — installs ride each browser's native chrome only; fine, but it means zero install-conversion surface; (2) **no automated installability/manifest e2e contract exists** (10 e2e specs, zero manifest/SW mentions — B5 §7's proposed "installability contract e2e" is still open). A 20-line spec pinning manifest fields + icon sizes + sw.js 200 would close it.

---

## Findings (P0–P4) — new this pass; B1 item 10's F1–F4 re-confirmed, not re-graded

| # | Grade | Finding | Fix |
|---|---|---|---|
| — | **P3 (open, B1-10)** | **F1 sw.js.map 200 leak + F2 /assets soft-200 re-confirmed live today** (probes above) | the exact config lines for both are in §3 — one S commit closes F1+F2 (B1's Commit 1 already queues them) |
| N1 | **P3** | **Late-LCP-supercession now caught on a mobile waterfall** (pass 3: img bytes done 4,295 ms → final LCP entry 6,940 ms; 1/3 passes) — extends R127-B4's desktop-only observed anomaly to mobile; candidates: font-swap text-metric reflow resizing cards, or a fade-in repaint. Not modeled by LH simulate (medians unaffected), but real-user LCP on slow links can be ~2 s worse than the lab number | trace-level follow-up (one CDP Trace + LayoutShift/FontInspector pass on `/`); if font-swap: `size-adjust`-tuned fallback metrics on the readex-pro faces would kill the reflow class |
| N2 | **P4** | `ProductCard-*.js` is a second serial chunk hop after `home-*.js` eval (not on today's LCP critical path — finishes before the catalog in 3/3 passes — but becomes one the day the catalog hop shrinks, e.g. under a future edge cache) | modulepreload ProductCard from the home shell, or merge it into home (it is 4.8 KB) |
| N3 | **P4** | Doubled `sourceMappingURL` comment on live sw.js (workbox artifact) | rides the F1 fix |
| N4 | **P4** | No install-prompt surface + no installability/manifest e2e contract (10 specs, 0 PWA mentions) | 20-line e2e spec pinning manifest fields/icon dims/sw.js-200 (B5 §7's own proposal) |

**P0: 0 · P1: 0 · P2: 0 · P3: 1 new (N1) + B1-10 family re-confirmed · P4: 3 new.**

## "Did R127's fixes work?" — verdict

**YES, all four, measured live:** (1) **vendor-sentry deferral** — 0 fetches during load in 15/15 LH runs (was: every route, 111 KB br, #1 unused-JS item; the finding no longer exists) and the 221 ms sentry long task is gone; `/` transfer ~605 KB → ~492 KB. (2) **Optimistic /login** — score 66→84, TBT 621→89 ms (the at-the-boundary POOR TBT is closed), simulated LCP −816 ms. (3) **Card-image warming + index-0 `fetchpriority=high`** — LCP element is now the index-0 high-priority card on every image route, and the image request starts +23 ms after catalog resolution (measured) instead of after React's card render. (4) **DSN-parity budget gate** — code-verified landed by B1 item 14 (not re-measured here). Net: **mobile LCP −0.7 to −1.2 s on every route; all five routes out of the POOR band into NEEDS-IMPROVEMENT; desktop-parity scores 79–95.** FCP and TTFB are unchanged (expected — entry path and origin RTT untouched). The remaining distance to GOOD (<2.5 s) is the known structural pair: no-CDN origin RTT on 3 serial hops (O1, held open) + SPA client-rendered discovery (Section 2).

## Verified-OK register (this pass)

1. `/sw.js` served 200 `text/javascript` + `no-cache, no-store, must-revalidate` (SW versioning correct) — live probe.
2. Built SW: `skipWaiting` + `clientsClaim` + `cleanupOutdatedCaches` + 9-entry precache diet (no JS/images) + NavigationRoute denylist exactly matching config — fetched sw.js read.
3. All 3 runtime cache rules (api-catalog SWR 7d, images CacheFirst 30d/200, assets-js CacheFirst 30d/160) present and matching `vite.config.ts:900–963`.
4. `/registerSW.js` 134 B, no-store, scope `/` registration — live.
5. `/manifest.json` 200 `application/json`, live byte-identical to `frontend/public/manifest.json`; every required field present incl. maskable 512 + rich screenshots + Arabic shortcuts.
6. Icon set honest: all declared sizes = actual IHDR dimensions (96/192/512, screenshots 540×1080/1080×540); live 512 download byte-size + dims match, `image/png`, 30d+SWR cache rule live.
7. iOS meta tag set complete in the live shell (capable/status-bar-style/title/apple-touch-icon/manifest/theme-color).
8. Chromium installability prerequisites: all pass (manifest + start_url + standalone + 192/512/maskable icons + SW with fetch handlers over HTTPS) — **installable: YES**.
9. R127 D5 warming + D3 optimistic login + D2 sentry deferral all live-verified (Section 1/2 evidence).

— R128-B2, 2026-10-10. Read-only on source; probes = ~15 LH page loads + 3 curls + ~12 header/body GETs (measurement-only, no mutations). Artifacts: `scripts/r128-b2/` (15 LH JSONs, waterfall script + output, live sw.js/manifest/registerSW/shell snapshots). This report + one worklog append are the only writes.
