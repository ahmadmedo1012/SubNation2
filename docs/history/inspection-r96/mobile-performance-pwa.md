> **ARCHIVED (2026-10-07, R122 docs reorg).** Moved from `docs/inspection-r96/mobile-performance-pwa.md`; dated historical record — content unchanged, not current state (see ../README.md for the current index).

# R96-A3 — Mobile Performance, Bundle & PWA Audit (deepest pass)

- **Task ID:** R96-A3 (Round 96 — mobile focus)
- **Agent:** diagnostic specialist (RESEARCH ONLY — no source files modified; one fresh build executed)
- **Date:** 2026-09-10
- **Scope:** frontend/ (Vite + React 19 + TS + Tailwind + wouter + TanStack Query + Radix + recharts + lucide + sonner + Sentry + vite-plugin-pwa/workbox), deployed on Vercel; API proxied `subnation.ly/api/* → subnation2.onrender.com`.
- **Method:** fresh production build (`npx vite build`; pnpm not on PATH in sandbox, deps pre-installed), per-chunk raw + `gzip -9` measurement of `dist/public/assets`, static analysis of the full boot path, generated `sw.js` + `registerSW.js` inspection, **live production probes** against `https://subnation.ly` (headers, transfer sizes, `/api/products` payload), plus review of prior-round work (r3/4/8 + r92/93/94 docs) to isolate what _remains_.

---

## 1. Build evidence (fresh build, 2026-09-10)

```
vite v7? (workspace catalog) · build: 11.51s · dist/public = 13MB (9.38MB of that = sourcemaps)
PWA v1.3.0 · generateSW · precache 14 entries (424.62 KiB advertised)
[bundle-budget] index-DENcVcvo.js: 21482 bytes (gzip)   ← plugin's (broken) measurement
```

### 1.1 Chunk table — raw / gzip(-9) bytes, grouped by load phase

**EAGER (entry + `<link rel="modulepreload">` in dist index.html + CSS):**

| Chunk                                              |   Raw B |     Gzip B | Notes                                                |
| -------------------------------------------------- | ------: | ---------: | ---------------------------------------------------- |
| `index-DENcVcvo.js` (entry)                        | 110,719 | **32,738** | App shell, Navbar, NotFound, shared UI (all inline)  |
| `vendor-react-3l2p7574.js`                         | 185,868 |     58,343 | react + react-dom + scheduler (React 19 prod)        |
| `vendor-icons-D81VXjUv.js`                         |  32,496 |     10,682 | lucide-react, tree-shaken (~129 icons)               |
| `vendor-utils-PJZsc2dN.js`                         |  30,986 |      9,645 | clsx + tailwind-merge + cva + radix-slot             |
| `vendor-router-B4JciV8b.js`                        |   5,024 |      2,471 | wouter + regexparam                                  |
| `vendor-query-CdLgOk98.js`                         |  36,452 |     10,714 | TanStack Query                                       |
| `index-2_jCgVKj.css`                               | 247,095 |     28,974 | single CSS bundle (Tailwind + all fonts' @font-face) |
| fonts preloaded (`arabic-400` + `latin-400` woff2) |  24,160 |          — | injected per-build by `fontPreloadInject()`          |

**Eager critical-path total ≈ 124.6 KB JS gz + 29.0 KB CSS gz + 24.2 KB fonts ≈ 178 KB transfer** (before brotli, which Vercel also applies). Verified live on production (`index-DJO46LN0.js` transferred 33,040 B gzip ≈ local build).

**DEFERRED (load during session, off the critical path):**

| Chunk                          |   Raw B |      Gzip B | Trigger                                                   |
| ------------------------------ | ------: | ----------: | --------------------------------------------------------- |
| `vendor-sentry-CZFMmwmu.js`    | 469,406 | **155,424** | `requestIdleCallback` after boot (boot-sentry)            |
| `home-BUqO9zx-.js`             |  22,888 |       6,682 | lazy route — **only after auth probe resolves** (see F-1) |
| `vendor-socket-DsENSA6R.js`    |  42,478 |      13,194 | +3.5 s after mount (DeferredSocketInitializer)            |
| `vendor-firebase-DG6ky1FZ.js`  | 153,638 |      44,091 | login-action only (dynamic `import("firebase/auth")`)     |
| `browser-iDJW9IsH.js` (qrcode) |  25,783 |      10,018 | admin TOTP setup only                                     |

**ADMIN-ONLY (never downloaded by storefront visitors):**

| Chunk                                                                           |        Raw B |      Gzip B |
| ------------------------------------------------------------------------------- | -----------: | ----------: |
| `vendor-charts-aHp5your.js` (recharts + d3)                                     |      403,540 | **109,128** |
| `layout-Bpus9WHG.js` (admin layout/nav)                                         |       54,289 |      15,475 |
| `products/settings/system/topups/users/orders-jkiv7pRV/dashboard/…` (20 chunks) | 10–43 K each | 3–13 K each |

**Storefront lazy routes:** `category` 20.0K/6.0K, `product` 28.5K/8.0K, `checkout` 14.1K/4.7K, `cart` 7.8K/2.6K, `orders` 10.5K/3.2K, `login` 4.3K/1.8K, `register` 3.8K/1.6K, `wallet` 37.5K/10.1K, `support` 22.8K/6.9K, `terms` 9.1K/3.2K, `loyalty` 12.8K/4.0K, `referrals` 11.2K/3.8K, `profile` 14.4K/4.7K, `flash-sales` 7.5K/2.7K, `order-detail` 13.5K/3.8K, `status` 3.9K/1.7K, `onboarding` 5.2K/2.1K, `auth-callback` 1.9K/1.0K, `telegram-callback` 3.4K/1.6K, `not-found` (in entry), `MobileNav` 2.2K/1.1K, `Footer` 1.8K/0.8K, `FlashSaleBanner` 4.1K/1.7K, `NotificationBell` 9.4K/3.4K.

### 1.2 Threshold scan (task's criteria)

- **Chunks > 200 KB raw:** `vendor-sentry` (469 K), `vendor-charts` (404 K) — both _off_ the storefront critical path. ✔ no eager offender.
- **Chunks > 80 KB gzip:** `vendor-sentry` (155.4 K), `vendor-charts` (109.1 K) — same as above.
- **recharts in storefront entry?** **No.** `vendor-charts` is statically imported only by admin `dashboard-*.js` and `system-*.js`; the entry references it solely inside `__vite__mapDeps` (dynamic map). ✔
- **lucide-react whole lib?** **No.** 32.5 K raw for ~129 icons (full lib ≈ 1 MB+). Tree-shaking works; the 10.7 K gz is eager because Navbar/ProductCard statically import icons (P3-9).
- **Radix + TanStack in entry?** TanStack yes (10.7 K gz, legit — QueryClientProvider in App). Radix **no** — de-eagered in r4 (slot routed to vendor-utils); `vendor-radix` (12.4 K gz) loads only with lazy routes (login/wallet/support/…). ✔
- **Sentry SDK in entry?** **No** — `instrument.ts` is dynamically imported on idle via `lib/boot-sentry.ts` (error buffering so nothing is lost). vendor-sentry (155.8 K gz) still downloads on every session post-idle → **F-6**.
- **Entry bundle gzip:** **32.7 KB** (Vite-reported 33.09 KB; independent `gzip -9` = 32,738 B; prod transfer measured 33,040 B). Budget gate limit 55 KiB — passing, but the gate itself undercounts (F-8).

---

## 2. Route code-splitting — VERIFIED CLEAN (no P0)

`App.tsx` + `main.tsx`: **all 31 pages** route through `lazyWithRetry()` (React.lazy + stale-chunk auto-reload recovery — the #1 post-deploy failure mode is already handled). Only `Navbar` + `NotFound` are static (bundled into the entry chunk itself). Chrome components (Footer, MobileNav, FlashSaleBanner, NotificationBell, SocketInitializer) are individually lazy. Admin is double-isolated: lazy pages **plus** their own `ErrorBoundary` + session guard (`AdminProtectedRoutes`), so admin code (charts, 900-1500-line pages) can never land on a storefront wire. `cssCodeSplit: true` set; in practice one CSS bundle because all styles flow through `index.css` (29 K gz — fine).

**Verdict: no P0. Splitting architecture is best-in-class for this stack.**

---

## 3. Images (LCP) — CLS-safe today; P1 risk when enrichment lands

`ProductCard.tsx` (storefront grid):

- `width={400} height={400}` attrs + `aspect-square` container → **CLS-reserved** ✔; `decoding="async"` ✔.
- `loading={index < 4 ? "eager" : "lazy"}` — correct (lazy on the LCP image is a known 400-800 ms LCP regression; avoided) ✔.
- `fetchPriority={0:"high" / 1-3:"auto" / ≥4:"low"}` — a proper priority ladder ✔.
- Descriptive Arabic `alt` with category context ✔. `onError` swaps to category-icon fallback (no broken-image glyph) ✔.
- **No `srcset`/`sizes`** — no responsive variants exist upstream (see F-2).
- Home hero = text + CSS gradients (no hero `<img>`) → LCP element is `h1` text (fonts) + first cards. Product page main image: `width/height 800`, `fetchPriority="high"` ✔; recommendations + recent-orders thumbs `loading="lazy"` ✔.

**Live reality check (production, 2026-09-10):** `/api/products` returns **18 products, 0 with `image_url`** (matches worklog round-5: enrichment pipeline not yet activated). Today's LCP = text + SVG fallbacks + fonts (both preloaded). The entire image pipeline is _dormant-but-ready_: `preconnect https://image2url.com` (no-cors — correctly fixed in r94 A7 F-1), `images-v1` CacheFirst SW rule, priority ladder. **When images arrive, F-2 becomes the #1 mobile cost.**

---

## 4. Fonts — clean

- `@fontsource/readex-pro` imported per-subset+weight: `arabic-400/600/700` + `latin-400/600/700` = **6 woff2 = 74.9 KB total** in `/assets/` (arabic 30.5 K, latin 44.4 K). `font-display: swap` baked into each @font-face ✔ (fallback text paints instantly; zero FOIT).
- **Preloaded:** only `arabic-400` (9.8 K) + `latin-400` (14.4 K) — the LCP faces; 600/700 stream lazily via CSS on actual use. Preload hrefs are hash-correct per build (custom plugin) ✔.
- No Google Fonts network dependency; same-origin immutable 1y caching ✔.
- Minor: fontsource also emits `.woff` fallbacks (94.1 K) that modern browsers never fetch — dead deploy weight only (P3-11).

---

## 5. Critical path / boot waterfall — the main remaining LCP lever

Sequence on a cold mobile visit:

```
1. index.html  (no-cache, TTFB via Vercel edge)
   ├── init.js            (404 B, sync in <head> — theme class; negligible)   [P3-6]
   ├── entry JS + 5 vendor modulepreloads + CSS + 2 font preloads  (~178 KB gz)
2. entry executes → AuthProvider fires /api/auth/probe
   └── AuthGate BLOCKS THE ENTIRE ROUTE TREE (splash after 250 ms threshold)
3. probe resolves — measured live: 210–520 ms warm, 420–650 ms cold
   (NOT same-origin fast: Vercel edge → Render backend proxy hop + DB session lookup)
4. ONLY NOW the lazy HomePage import() starts → home chunk (6.7 KB gz) round-trip
5. home mounts → useListProducts + catalogStats + (flash-sale via banner) fire
   (products is public and could have been fetched during step 2-3)
6. /api/products returns (live: ~0.3–0.7 s) → grid paints → LCP
```

**Steps 3→4→5 are fully serial.** On 3G/4G mobile that's ~3 extra RTTs (~0.6–1.2 s) added to LCP that parallelization would remove. → **F-1 (P1)**.

Mitigating factors already present: probe pre-seeds the `/me` query cache (no duplicate request), splash is CLS-neutral with 250 ms threshold, `refetchOnWindowFocus/Reconnect: false`, staleTime 60 s.

---

## 6. PWA audit

### 6.1 manifest.json (public/, single source of truth — `manifest:false` in VitePWA ✔)

- `name` (Arabic) / `short_name` ✔ · `lang:"ar"` + `dir:"rtl"` ✔ · `display:"standalone"` + `orientation:"portrait-primary"` ✔ · `start_url:"/"` + `scope:"/"` ✔.
- Icons: 96 + 192 + 512 (`any`) **+ 512 `maskable`** ✔; files exist in `public/` ✔; `apple-touch-icon` → `pwa-192x192.png` (13.4 K) ✔; all meta (`apple-mobile-web-app-*`, `mobile-web-app-capable`) ✔.
- `theme_color #e11d48` matches index.html meta & runtime upserts ✔; `background_color #0a0a0a` matches `--background` ✔.
- Shortcuts: المتجر (`/`) + طلباتي (`/orders`) with icons ✔.
- Gaps: **no `id` field** (PWA identity — Chrome derives from start_url today, breaks if start_url ever changes); **`screenshots: []`** (no rich install sheet on Android) → P3-1.

### 6.2 Workbox (generateSW, verified in dist sw.js)

- `skipWaiting()` + `clientsClaim()` + `cleanupOutdatedCaches()` — autoUpdate ✔.
- **Precache diet** (r3 §1.1): allowlist = index.html, favicon, logo, opengraph.jpg, manifest.json, `assets/*.css`, `assets/*.woff2`; `globIgnores: ["**/*.js"]`; `maximumFileSizeToCacheInBytes: 256 K`. Dist sw.js precache manifest confirmed: 14 entries, **no JS** ✔. Two entries duplicated (favicon.svg, subnation-logo.png appear twice — `includeAssets` + `globPatterns` overlap) → P3-2.
- **runtimeCaching (verified baked into sw.js):**
  - `api-catalog-v1`: GET `/api/products|flash-sale` → **StaleWhileRevalidate**, maxEntries 32, **maxAgeSeconds 60** (mirrors backend `s-maxage=60`).
  - `images-v1`: `destination === "image"` → **CacheFirst 30 days**, 200 entries (image2url originals treated as immutable).
- `navigateFallback: "index.html"` with denylist `/api/`, `/assets/` ✔ (no API shadowing, no asset double-caching).
- SW registration: injected `<script id="vite-plugin-pwa:register-sw" src="/registerSW.js">` → registers on `window.load` (non-blocking) ✔. No second hand-rolled register (init.js comment confirms de-dup) ✔.
- **Update flow:** autoUpdate — new SW silently takes over; **no user prompt, no `onActivated → reload`**. Open tab keeps old chunks until next full navigation; `lazyWithRetry` masks stale-chunk 404s with a one-shot reload (good safety net). → F-7 (P2, UX polish).
- **Offline behavior:** shell + CSS + fonts + (≤60 s old) catalog served from cache → **stale product list works** ✔. Beyond 60 s offline: catalog cache expired → SWR fails → home renders its honest `WifiOff` error card with retry ✔; `/api/auth/probe` fails → guest view (acceptable). `init.js` + `registerSW.js` are referenced by precached index.html but **not themselves precached** (404 offline; harmless) → P3-3. No dedicated offline page → covered by F-7 fix.

### 6.3 Vercel headers — verified LIVE on subnation.ly

- `/assets/*` → `Cache-Control: public, max-age=31536000, immutable` ✔ (measured on prod entry chunk).
- Everything else (HTML, sw.js, manifest, init.js) → `no-cache, must-revalidate` + nosniff/DENY/strict-referrer/permissions-policy ✔ (sw.js MUST be revalidated — correct).
- Rewrites: `/api/* → render` + SPA fallback ✔. Brotli on API + assets verified (`content-encoding: br`, /api/products 7,981 B raw → 2,193 B br).

---

## 7. API payload weight (mobile data)

- `/api/products` (storefront list): **live = 7,981 B raw / 2,167 B gzip for 18 products** — negligible today. Fields: id, slug, name, description (avg 75 chars), image_url, price, category, stock_count, is_available, sale_price, discount_percent, order_count, **usage_terms (avg 30 chars — only needed on the product page; mild over-fetch)**.
- **No pagination on the storefront list** — SQL `LIMIT 500` hard ceiling; grid renders everything. Fine at n=19; at n=200+ this is both payload (≈80 K raw) and DOM cost. → P3-5.
- Home extra calls: `/api/catalog/stats` (105 B), `/api/flash-sale` (19 B), `orders?limit=4` (authed only — r3 fix ✔). Guest home = 3 GETs total. Reasonable.
- Admin lists paginate (`page`/`limit`, default 20-50) ✔.

---

## 8. INP / JS-weight risks on mobile

- **F-3 (P2, still open from r94 F-4):** `CartProvider` exposes ONE wide, **non-memoized inline context value** (`value={{ items, itemCount, totalLYD, addItem, … }}` — new identity every render). Every add-to-cart → state change → **every `useCart()` consumer re-renders** — including every `ProductCard` (React.memo cannot block context-driven re-renders). 18 cards × ~30 DOM nodes re-rendered per tap on the money-critical button. On low-end Android this is measurable INP + dropped tap feedback frames.
- Socket re-renders: scoped ✔ — events invalidate only orders/topups/wallet query keys; **no product-grid invalidation** → no full-page re-renders. Socket chunk deferred 3.5 s + lazy ✔. **But guests also download socket.io (13.2 K gz + 2.8 K chunk) for nothing** — `DeferredSocketInitializer` isn't token-gated, `useSocket(undefined)` no-ops → F-5 (P2).
- recharts: admin-only (dashboard/system) — mobile admins rare; acceptable. ✔
- Big lists: home grid uses `content-visibility: auto` (`cv-card`, cards ≥4) + `contain-intrinsic-size` ✔; **category.tsx grid lacks `cv-card`** → P3-4. No virtualization anywhere (moot at 19 products; revisit at 100+).
- Animations: global `prefers-reduced-motion` kill-switch ✔ (4 media blocks, incl. infinite loops pinned to 1 iteration). NavigationProgress = transform-only scaleX ✔. AppSplashScreen = opacity pulse, zero deps, 250 ms threshold ✔. Remaining GPU costs: **MobileNav `backdrop-blur-3xl` (64 px) fixed always-on bar** → F-4 (P2) and **home hero `blur-3xl` `blob-drift` infinite animations** → F-4b (P2/P3).

---

## 9. Third-party timing

- **Firebase:** fully dynamic (`await import("firebase/app")` / `("firebase/auth")` inside functions; top-level imports are type-only). `vendor-firebase` (44.1 K gz) downloads **only when a login method is clicked** ✔. dns-prefetch for `apis.google.com` + `firebaseapp.com` present, preconnect deliberately withheld (delayed-action origin) ✔.
- **reCAPTCHA:** **not used anywhere in the frontend** (only CSP allowlist entries for future use + a stale comment in index.html). The `dns-prefetch www.google.com/www.gstatic.com` hints are dead weight (2 cheap DNS lookups) → P3-7.
- **GA4:** env-gated, loaded on the same idle tick as web-vitals, `script.async`, beacon transport ✔.
- **Sentry:** off critical path (idle + buffered errors) ✔ — but see F-6 for the every-session bandwidth tradeoff.

---

## 10. FINDINGS (severity-ranked)

### 🔴 P0 — none

Entry = 32.7 K gz (< 300 K), full route splitting, SW valid/registered/precache-dieted. The P0 class of failures does not exist in this codebase anymore.

---

### 🟠 P1 — 2

**F-1 · AuthGate serial waterfall delays LCP on mobile** _(biggest remaining LCP lever)_

- **Evidence:** `App.tsx` `AuthGate` renders splash until `/api/auth/probe` resolves; the entire router (and therefore the `HomePage` lazy `import()`) sits **inside** the gate. Home chunk (6.7 K gz) is not preloaded in dist index.html (`rg home-BUqO9zx dist/index.html` → 0 hits). Probe measured 210–650 ms live (Vercel→Render proxy, not the "same-origin 50-300 ms" the comment assumes). `/api/products` is public and unauthenticated but only fires after the gate + chunk + mount.
- **Mobile impact:** 3 serial round-trips (probe → home chunk → products) before any product paints ≈ **+0.6–1.2 s LCP on 3G/4G**; splash shows (>250 ms threshold) on most mobile loads.
- **Fix (pick 1+2):** (1) render the router immediately and gate only auth-dependent chrome (Navbar user chip, MobileNav) — logout-flicker is the documented tradeoff but it costs ~0; or keep the gate but (2) fire `import("@/pages/home")` + a head-start `fetch("/api/products")` (seed the query cache) in parallel with the probe from `main.tsx`. Either removes 1–2 RTTs from LCP with no UX regression.

**F-2 · Product images = un-resized originals from image2url.com (dormant → will dominate mobile cost when enrichment lands)**

- **Evidence:** 0/18 products have images today (live API), but the pipeline (enrichment spec 012) is designed to fill `image_url` with image2url.com URLs. `ProductCard` hints `width=400` but the browser downloads the **original file** — vite.config's own comment budgets "**~0.8–3 MB per product-grid page view**". No `srcset`/`sizes`, no resize proxy anywhere (image2url has no variant support per that same comment).
- **Mobile impact:** when images arrive: multi-MB cellular data per grid view; LCP image likely 300 K–1 MB+ originals; 30-day CacheFirst SW rule softens _revisits_ only.
- **Fix:** front the images with a resizing CDN/proxy that emits variants (e.g. wsrv.nl `?w=` — no vendor lock, or Cloudflare Images / image2url's own resize params if any) and add `srcset="… 320w, … 480w, … 800w" sizes="(min-width:1024px) 240px, 45vw"` to ProductCard + product page. Keep the existing eager-first-4 + fetchpriority ladder. ~70–90% byte cut on mobile.

---

### 🟡 P2 — 7

**F-3 · Cart context re-renders the whole product grid on every add-to-cart (INP)** — still open from r94 F-4.

- Evidence: `cart.tsx:144-146` — inline non-memoized `value={{items, itemCount, totalLYD, addItem…}}`; single wide context; `ProductCard` consumes `useCart()`. `React.memo` comparator (ProductCard.tsx:398) can't stop context propagation.
- Impact: every cart tap re-renders N cards (N=18 today, up to 500 at scale) + Navbar; visible as tap-response jank on low-end Android.
- Fix: split contexts (state vs commands) + `useMemo` the command object (stable identity — commands are already `useCallback`s); cards then re-render only when `items` actually changes identity _and_ they read it (they don't need `items` at all). One-file change.

**F-4 · `backdrop-blur-3xl` (64px) on the always-mounted fixed MobileNav**

- Evidence: `MobileNav.tsx:48` — `bg-card/92 backdrop-blur-3xl`, rendered on every logged-in mobile page, over constantly-scrolling content.
- Impact: 64 px backdrop-filter forces per-frame GPU re-rasterization under the bar on low-end Android (the exact market per AppSplashScreen's own comment); the 92%-opaque background makes the blur barely visible — it's cost without visual payoff.
- Fix: `bg-card` solid (or `/97` + `backdrop-blur-md` at most). One class change.

**F-4b · Home hero animated `blur-3xl` blobs (GPU)**

- Evidence: `home.tsx:404-405` — two `blur-3xl` circles with `blob-drift` 9 s/13 s infinite + `will-change: transform` (index.css:828-834).
- Impact: continuous compositor work + big blurred-layer rasterization on the most-visited page for guests; disables only under prefers-reduced-motion.
- Fix: pre-render the blur into a static PNG/WebP and animate `transform` only (still cheap), or cap at `blur-xl` + one blob, or pause animation when hero is off-screen (IntersectionObserver).

**F-5 · Guests download the socket.io stack for nothing**

- Evidence: `App.tsx` mounts `DeferredSocketInitializer` unconditionally (after gate); chunk graph: `SocketInitializer` (2.8 K) + `vendor-socket` (13.2 K gz) load at +3.5 s for anonymous visitors; `useSocket(undefined)` no-ops; `useGetMe` disabled.
- Impact: 16 K gz wasted cellular data + engine.io parse/TBT on the majority (guest) traffic.
- Fix: `if (!token) return null` inside `DeferredSocketInitializer` (it already sits under `AuthProvider`), or mount conditionally in `App`.

**F-6 · Sentry downloads 155.4 K gz on every session (deferred, but unconditional)**

- Evidence: `boot-sentry.ts` schedules `import("../instrument")` on idle for 100% of loads; vendor-sentry is the largest chunk in the app (469 K raw / 155.4 K gz incl. Replay + BrowserTracing). tracesSampleRate 10%, replaySession 10%, replayOnError 100%.
- Impact: after the ~178 K critical path settles, mobile users still pull another ~156 K (≈ another full critical path) for observability; on metered connections this is real money, and Replay's rrweb recording adds main-thread cost during the session.
- Fix (options, all preserving error coverage): (a) init on idle only when `navigator.connection.saveData !== true` / `effectiveType` ≥ 3G for the _SDK_, keep the tiny error-buffer shim always; (b) disable Replay on mobile viewports (largest single win — Replay is ~half the chunk); (c) accepted-tradeoff documentation if ops insists. Also note `sendDefaultPii: true` + `enableLogs` ship extra weight/traffic — sample logs in prod.

**F-7 · SW update flow: silent takeover, no refresh prompt; offline > 60 s = error card**

- Evidence: sw.js = `skipWaiting + clientsClaim` (autoUpdate), registerSW.js is the stock 3-liner; no `onUpdateFound`/`onActivated` → reload or toast. `api-catalog-v1` `maxAgeSeconds: 60` expires offline entries.
- Impact: user on an open tab during a deploy keeps old UI until a full navigation (lazyWithRetry rescues broken navigations with one reload — decent net). Offline user past 60 s gets the WifiOff error page instead of a last-known catalog.
- Fix: (a) raise catalog `maxAgeSeconds` to e.g. 7 days (SWR still refreshes whenever online — staleness bound is the _response_ age, not cache TTL; or switch to `NetworkFirst` with `networkTimeoutSeconds: 3`); (b) add `clientsClaim`-activated `postMessage` → sonner toast "تحديث جديد — إعادة تحميل" with a reload action (or auto `location.reload()` when the tab is hidden).

**F-8 · Hidden sourcemaps (9.38 MB) are deployed publicly**

- Evidence: `sourcemap: "hidden"` + Sentry plugin gated on `SENTRY_AUTH_TOKEN`, but `sourcemaps.deleteSourcemapsAfterUpload` is not configured → `.map` files remain in `dist/public` (9,376,625 B across 71 maps) and ship to Vercel. Not referenced by bundles, but fetchable by URL (`/assets/index-*.js.map`).
- Impact: full TypeScript sources exposed to anyone who guesses the URL (security hygiene); 9.4 MB of dead deploy weight; slows deploys.
- Fix: `sentryVitePlugin({ sourcemaps: { deleteSourcemapsAfterUpload: true } })`, plus a build-time guard that fails if `*.map` exists in `dist/public` without the token.

---

### ⚪ P3 — 11

- **P3-1 · manifest gaps:** no `id` field (identity instability if start_url changes); `screenshots: []` → no rich install sheet on Android.
- **P3-2 · Precache manifest duplicates:** `favicon.svg` + `subnation-logo.png` each appear twice (includeAssets ∩ globPatterns) — 14 advertised entries, 12 unique.
- **P3-3 · `init.js`/`registerSW.js` not precached** though referenced by the precached `index.html` (offline 404s; theme-boot no-op offline).
- **P3-4 · `category.tsx` grid lacks `cv-card`** (content-visibility) that home has — DOM render cost at catalog scale.
- **P3-5 · No pagination on storefront `/api/products`** (LIMIT 500) + `usage_terms` over-fetched in list payload — future mobile-data ceiling.
- **P3-6 · `init.js` is a synchronous classic script in `<head>`** (404 B, one localStorage read — real cost ≈ 0; could be inlined as a 2-line snippet or `defer`).
- **P3-7 · Dead dns-prefetch hints** (`www.google.com`, `www.gstatic.com`) for a reCAPTCHA that isn't used; keep `apis.google.com`/`firebaseapp.com` (lazy Firebase does hit them).
- **P3-8 · Bundle-budget plugin undercounts gzip 35%:** streaming `gzip.on("data")` + `pipeline()` resolves on `finish` — misses the final flushed chunk. Reported 21,482 B vs actual 33,090 B for the same file (reproduced). The 55 K gate currently passes either way, but it is not measuring what it claims and could mask a regression up to ~16 K. Fix: `zlib.gzipSync(readFileSync(f)).length`.
- **P3-9 · `vendor-icons` (10.7 K gz, ~129 icons) eager** via Navbar/static icon imports — could drop below-fold icons to lazy chunks (small win).
- **P3-10 · `next-themes` bundled in the entry solely for Sonner theming** (custom ThemeProvider exists) — few KB + a redundant dependency.
- **P3-11 · Deploy hygiene:** `.woff` fallbacks (94 K) shipped but never fetched by modern browsers; `caniuse-lite` 7 months stale (build warning).

---

## 11. Confirmed strengths (do NOT re-audit as gaps)

Route splitting of all 31 pages + admin double-isolation; recharts/firebase/socket/sentry all off the critical path; entry 32.7 K gz under a (broken-but-passing) 55 K budget; precache diet (no JS, 256 K cap, allowlist); SWR catalog + CacheFirst images runtime rules; navigateFallback denylist; SW registers on load; fonts self-hosted, subsetted, swapped, LCP weights preloaded per-build; preconnect no-cors fix (r94 A7 F-1); FlashSaleBanner CLS reservation + polling stops when hidden; ProductCard CLS-safe + priority ladder + memo; skeleton geometry matches real cards (route-shape map); socket deferred 3.5 s with query-scoped invalidations; GA4 + web-vitals deferred to idle with CWV RUM beacon (mobile/desktop classed, `/api/cwv`); global prefers-reduced-motion kill-switch; content-visibility on home grid; lazyWithRetry stale-chunk recovery; Vercel immutable /assets + no-cache HTML/SW verified live; brotli everywhere; /api/products payload 2.2 K gz today.

## 12. Recommended next actions (ordered by mobile ROI)

1. **F-1** — parallelize home-chunk prefetch + products fetch with the auth probe (or un-gate the router). Cheapest big LCP win.
2. **F-3** — cart context split + memoized value. Cheapest big INP win.
3. **F-4/F-4b** — remove backdrop-blur-3xl from MobileNav; de-animate/de-blur hero blobs. Cheapest GPU win on low-end Android.
4. **F-5** — token-gate the socket initializer (guests stop paying 16 K gz).
5. **F-2** — design the image variant pipeline _before_ enrichment activates image_url (srcset + resize proxy); otherwise the P1 materializes silently.
6. **F-7** — catalog cache TTL 60 s → 7 d + update toast; offline story completes.
7. **F-8/P3-8** — sourcemap deletion + budget-plugin measurement fix (guardrail integrity).
8. **F-6** — decide the Sentry/Replay mobile tradeoff (document or gate on saveData/viewport).
