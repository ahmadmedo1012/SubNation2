# R124-A2 — Frontend Performance Deep Audit

**Repo:** SubNation2 @ `c736d13` · **Agent:** R124-A2 (read-only audit) · **Date:** 2026-10-08
**Method:** static source analysis (frontend/, shared/api-client-react, backend list route read-only) + live measurement of https://subnation.ly (served build dated 2026-10-08 20:00 UTC — fresh). All byte counts below are **measured wire bytes** (brotli where noted; woff2 is uncompressed on the wire). No code was modified.

---

## 0. Live bundle math (cold guest → home visit, measured 2026-10-08)

| Resource | Wire (br) | Raw | Evidence |
|---|---|---|---|
| HTML | 11,380 B | — | `curl https://subnation.ly/` |
| index.css | 29,404 B | 273,293 B | `/assets/index-Bs4ADUnM.css` |
| entry JS `index-BUknxoGu.js` | 32,545 B | 109,365 B | module-entry script |
| vendor-react | 59,237 B | 186,253 B | modulepreload |
| vendor-query | 11,374 B | 36,866 B | modulepreload |
| vendor-utils | 9,936 B | 31,368 B | modulepreload |
| vendor-router | 2,631 B | 5,406 B | modulepreload |
| **Eager JS+CSS subtotal** | **145,127 B** | — | just under the 145 KiB warn gate (vite.config.ts:131-132) |
| Fonts, 4 preloaded woff2 | 44,964 B | — | arabic 400/600/700 + latin 400 |
| Fonts, on-demand woff2 | 30,000 B | — | latin-600 15,052 + latin-700 14,948 |
| init.js (theme boot) | 404 B | — | blocking, tiny |
| Home route: home chunk + 25 new deps (26 files) | ~28,800 B | — | 9,084 B home + 17 icon micro-chunks (511-855 B each) + shared bits |
| `/api/products` | 6,663 B | 84,548 B | full 45-product catalog |
| vendor-sentry (idle, ~2 s after load) | **154,659 B** | 469,788 B | **larger than the entire eager path** |
| SW install (precache: html+css+6 fonts) | ~75 KB | — | after first paint |
| First 4 product images (eager) | ~60 KB | — | 4.3–31 KB webp each |
| **Cold-visit total ≈** | **~500 KB br** | ~1.5 MB | |

Lazy-only heavy chunks (verified NOT in eager graph, by grep of live entry/vendor bytes): vendor-charts 105,513 B br (admin dashboard/system), vendor-firebase 45,754 B (login-page dynamic import), vendor-radix 12,685 B (lazy pages), vendor-socket (wallet/order-detail, dynamic), sonner wrapper 791 B (idle Toaster).

Build inventory: **146 chunk files**; per-navigation chunk fan-out measured from the entry's `__vite__mapDeps` table — admin products 56, admin orders 54, admin users 52, wallet 33, home 30 (26 new), product 27, cart 13, checkout 17.

---

## 1. Findings

### F1 — [P2] Sentry Session Replay ships 151 KB brotli to **every** visitor
**Evidence:** live `/assets/vendor-sentry-BKCWxtCv.js` = **154,659 B br / 469,788 B raw** (rrweb recorder markers present in the bytes). The chunk exists ⇒ `VITE_SENTRY_DSN` is set in the production build (the `sentryDsnGuardPlugin`, vite.config.ts:322-355, removes it entirely when unset). `scheduleSentryBoot()` (main.tsx:18, boot-sentry.ts) idle-loads it ~2 s after load for every visitor — off the LCP path, but it is **47% of all JS a guest downloads** and lands exactly when product images are still streaming on 3G. Config: `replayIntegration` at instrument.ts:80-86, rates at :92-95 (`replaysSessionSampleRate 0.1`, `replaysOnErrorSampleRate 1.0`), plus `browserTracingIntegration` and `enableLogs`.
**Fix (smallest complete change):** remove `Sentry.replayIntegration({...})` from the `integrations` array (instrument.ts:80-86) and drop the two `replays*SampleRate` lines — core + tracing + captureException are what the error pipeline actually consumes; tree-shaking removes the rrweb recorder/canvas-snapshot code from the chunk. If error-session replays are a hard product requirement, the alternative is lazy-attaching the integration on the first buffered error (loses pre-error frames) — an M-effort variant.
**Gain:** ≈ **−90-100 KB br per visitor** (replay is typically 60-65% of the bundle; measured chunk 154.7 KB br → expected ~55-60 KB br). Largest single byte lever left in the app.
**Effort:** S (5 lines) — but a product decision (10% session replays + 100% error replays are lost).

### F2 — [P2] Service-worker JS cache cap (40 entries) is miscalibrated vs the 146-chunk build → LRU thrash on any multi-page session
**Evidence:** vite.config.ts:472-489 — `assets-js` CacheFirst `maxEntries: 40, maxAgeSeconds: 30d`; live `sw.js` confirms `maxEntries:40`. The live build emits **146 chunks** and one navigation loads 13-56 of them (measured fan-out above). A single home→product→cart session puts ~50+ chunks in the cache — already over the cap — so the LRU evicts entries a back-navigation will immediately re-fetch (the R98-08a offline-resilience goal is silently defeated for every session longer than 2 pages).
**Fix:** `maxEntries: 40 → 160` (one line; images already use 200 at :464). 146 chunks × avg ~1.5 KB br ≈ 220 KB worst-case footprint — well within a sane SW quota budget.
**Gain:** eliminates ~20-30 KB br of re-downloads per back-nav after any 2-3-page session; preserves the offline-JS guarantee R98-08a was built for.
**Effort:** S.

### F3 — [P2] Catalog list payload carries full variant trees — 63% of the wire bytes the grid never renders
**Evidence (measured on live `/api/products`):** 84,548 B raw / 6,663 B gz for 45 products. `variants` alone = **52,935 B (62.6%)**; `description` + `usage_terms` add 18,935 B more; the minimal shape the home grid needs (id/slug/name/image/price/flags/count) = 12,678 B. Backend attaches full variant objects at backend/src/routes/products.ts:292-301 (DTO) and :473-482 (list mapper); the list has **no pagination and a `limit(500)` ceiling** (:418) — at 200 products this becomes ~375 KB raw per catalog view. Consumers: home.tsx:262-285 (no `limit` param), category.tsx:149, flash-sales.tsx:173.
ProductCard uses `variants` only for a min-price reduce (:249-250) and a count badge (:293-294, :493-499) — and `price` already equals MIN(variants.price) by the import invariant documented at products.ts:444-448, so the grid can render from `price` + a count integer.
**Fix (ponytail):** add `variant_count: variants.length` to the list DTO and omit `variants` (and optionally `description`/`usage_terms`) from LIST responses when `?fields=list` is present (detail/by-slug routes keep the full shape); point home/category/flash at the list shape. The 30 s in-process catalog cache (products.ts:306-308) keeps server cost flat.
**Gain:** **−5.3 KB gz (−79%)** per catalog view + ~72 KB less JSON.parse on the main thread of every low-end phone that opens the store; future-proofs the 500-product ceiling.
**Effort:** M (backend DTO + orval regen + 3 page consumers + contract tests).

### F4 — [P2] No likely-next-route prefetch — every storefront navigation pays a cold chunk burst
**Evidence:** the only warm-up in the app is the boot head-start, home-route-only (App.tsx:302-356; `rg prefetch src` finds nothing else). A product-card tap starts: 1 product chunk + 26 dep chunks (measured) + `/api/products/by-slug/:slug` — all after the tap. Origin is a single Contabo VPS with **no CDN** (R117-A4: Cloudflare DNS-only) ⇒ every chunk is a full-RTT-liable origin fetch.
**Fix:** on `pointerenter`/`focus` of a product card's `Link`, fire the same dynamic-import warm-up pattern the head-start uses (`void import("@/pages/product").catch(()=>{})`) — the module map makes the subsequent route mount zero-RTT. Same one-liner for cart on first add-to-cart if desired.
**Gain:** ~150-400 ms perceived navigation latency on 3G/4G (one RTT + chunk burst moved off the critical tap).
**Effort:** S.

### F5 — [P3] Admin-only orval client code rides the ENTRY chunk
**Evidence:** live entry bytes contain admin fetchers + key builders that no eager file uses: `uu=e=>["/api/admin/topups"]`, `as=e=>\`/api/admin/topups/${e}/approve\`` (mutation fetcher with header-merge boilerplate), plus admin/products ×4, admin/orders, admin/users, admin/stats, admin/pricing/* URL builders — 14 key builders total, 7 of them admin. Mechanism confirmed: the lazy admin chunk imports these from the entry (`admins-CyYbUG2E.js` starts `import{a as M,B as W,ai as U,ad as X}from"./index-BUknxoGu.js"`) — the shared `shared/api-client-react/src/generated/api.ts` (315 KB source) has no `manualChunks` rule (vite.config.ts:590-679), so Rollup made the entry its host chunk.
**Fix:** the honest ponytail is an orval per-tag split (separate generated modules for admin vs user endpoints), or a thin local module exporting the 5 eagerly-needed key-builder one-liners so no eager file imports the generated module... (Navbar's `useGetMe` still keeps `generated/api.ts` eager, so only the orval split fully fixes it).
**Gain:** ~1-2 KB br off every cold storefront visit + keeps admin mutation code out of the public entry (hygiene as much as bytes).
**Effort:** M (orval codegen layout).

### F6 — [P3] ~70 per-icon micro-chunks inflate request counts on every lazy route
**Evidence:** live dep table lists ~70 icon-only chunks (`bell-`, `info-`, `star-`, `clock-`, …) at **511-855 B br each** (measured); home navigation fetches 26 new files averaging ~1.1 KB br; admin navigations fetch 43-56 files. This is the flip side of the R122 icon de-chunking (vite.config.ts:618-632) — correct call for the eager path (−8 KB gz), but the long tail now pays per-request header overhead (~300-500 B × N) and h2 stream scheduling.
**Fix:** `build.rollupOptions.output.minChunkSize: 15_000` (Vite 7.3.2 / Rollup ≥4.24 — verified installed version) merges micro-chunks into their consumers without re-eagering icons. The existing eager-path budget gate (vite.config.ts:90-148) will catch any regression.
**Gain:** −20-40 requests per navigation; ~5-10 KB header overhead saved; simpler dep graphs.
**Effort:** S.

### F7 — [P3] Home chunk is not `modulepreload`ed in HTML — its fetch starts only after entry execution
**Evidence:** live index.html preloads only the 4 vendor chunks; the home chunk (`home-DuaSQvsU.js`, 9,084 B br) is requested only when `startBootHeadStart`'s module-eval `import()` fires (App.tsx:314-318) — i.e. after the 32.5 KB br entry downloads AND parses (~150-300 ms on 4G).
**Fix:** extend the `fontPreloadInject` pattern (vite.config.ts:226-263 — same build-end bundle scan) to also emit `<link rel="modulepreload" href="/assets/home-*.js">`. Net-new bytes: zero — deep-link boots already warm the home chunk (head-start leg (a), App.tsx:314-318).
**Gain:** home chunk available ~1 RTT + entry-parse earlier on cold home boots (the money page).
**Effort:** S.

### F8 — [P3] ProductCard memo comparator omits `variants` → stale "يبدأ من" price / count badge
**Evidence:** ProductCard.tsx:626-641 compares 13 fields — not `variants` — while the card derives the min-variant price (:249-250) and the variant-count badge (:293-294, :493-499) from `product.variants`. A background refetch (staleTime 3 min; keepPreviousData) that changes only a variant's price/availability re-renders nothing — the card shows the old price until some compared field changes. Perf-motivated comparator introduced a staleness edge on a money display.
**Fix:** add `prev.product.variants === next.product.variants ||` (identity) or a cheap summary compare (length + min price + min sale price) to the comparator.
**Gain:** correctness (honest price display); perf-neutral.
**Effort:** S.

### F9 — [P3] Direct `/flash-sales` visits download the full 45-product catalog
**Evidence:** flash-sales.tsx:173 `useListProducts({})` — the same `{}` query key as home (deduped when arriving from home, cached by the shared SW rule), but a cold direct visit (WhatsApp-shared link) pays the whole 84.5 KB payload to render only the flash-sale subset.
**Fix:** none needed while the catalog is 45 products (payload small); revisit together with F3's list projection (the same `?fields=list` shape shrinks this view too).
**Gain:** folds into F3.
**Effort:** — (deferred).

### F10 — [P3] No CI performance budget beyond eager-bytes; `@lhci/cli` installed but unconfigured
**Evidence:** root package.json:31 has `"@lhci/cli": "0.15.1"`; no `lighthouserc*` exists anywhere in the repo (`rg lhci` → only the devDep). The only build-time perf gates are the bundle-budget entry + eager-sum checks (vite.config.ts:26-151); runtime CWV is covered by RUM (web-vitals.ts → `/api/cwv`, full sampling) but nothing blocks a regression at CI time.
**Fix:** either add a minimal `lighthouserc.json` (assertions: LCP < 2.5 s, TBT < 300 ms against the production URL, desktop+mobile emulated) to CI, or drop the dead devDep.
**Gain:** regression visibility for the latency work this repo keeps banking.
**Effort:** S (drop) / M (wire up honestly).

---

## 2. Verified-OK (already optimized — do not re-audit)

1. **Route-level code splitting: 100%.** All 40 pages via `lazyWithRetry` (App.tsx:38-92); only NotFound + Navbar eager (both justified: 404 fallback + above-fold chrome). Chrome/Footer/MobileNav/NotificationBell/Toaster all lazy (App.tsx:26-34, 90-92; Navbar.tsx:14-16).
2. **lucide-react:** named per-icon imports only (no barrel / `import *` — 30+ files checked); R122 already de-chunked the eager icon payload (−8 KB gz, vite.config.ts:618-632).
3. **recharts:** admin-only (dashboard.tsx:51, system.tsx:42) → vendor-charts 105.5 KB br, lazy-only (verified absent from entry/vendor bytes).
4. **firebase:** fully dynamic (`lib/firebase.ts:26,53`, `firebase-auth.ts:26,150,182`), env-gated, and the background refresher arms only for Firebase-backed identities (auth.tsx:409, `isFirebaseBackedUser`) — WhatsApp/Telegram users and guests never fetch the 45.8 KB br chunk.
5. **socket.io-client:** dynamic in `connectSocket` (socket.ts:105); page-scoped (wallet/order-detail) or admin-only + 3.5 s deferred (App.tsx:807-829).
6. **Sentry boot:** error buffer installed synchronously, SDK idle-loaded — no boot-window error loss, no critical-path cost (the *bytes* are F1, not the timing).
7. **Fonts:** self-hosted @fontsource, 6 per-subset woff2 (75 KB total), `font-display: swap`, unicode-range subsets, exactly the 4 LCP faces preloaded with correct `crossorigin` (vite.config.ts:226-263; live HTML verified); `.woff` fallbacks deployed but not precached (only pre-2016 browsers fetch them).
8. **Images:** all catalog art webp 4-31 KB same-origin; first 4 cards eager + card-0 `fetchpriority="high"` (ProductCard.tsx:393-408), rest `loading="lazy"` + `decoding="async"`; product hero `width/height 800` + `fetchPriority="high"` (product.tsx:1082-1085); every lazy image sits in a fixed-dimension box (`w-14 h-14`, `aspect-square`, `aspect-[4/3]`) — CLS guarded. No srcset needed at these sizes.
9. **API patterns:** boot probes parallel + 200-always + 10 s abort (auth.tsx:378-464); home head-start parallelizes probe/chunk/data and is home-gated (App.tsx:302-356); coupon pre-flight dedups by distinct price (checkout.tsx:344-366); checkout re-quote parallel per distinct product (checkout.tsx:604); admin session guard cached 5 min (App.tsx:415-448); home orders `limit=4` (home.tsx:355); admin search/orders use server-side pagination; no sequential-await waterfalls found in any storefront loader.
10. **Client caching:** TanStack defaults tuned (60 s stale / 5 min GC, retry only network+5xx, focus/reconnect refetch off — App.tsx:202-229); keepPreviousData on catalog filters; per-family staleTimes (products 3 min, stats 10 min); SW: catalog SWR 7 d + images CacheFirst 30 d + JS CacheFirst.
11. **Re-render hygiene:** cart context split commands/state with provider-lifetime-stable commands (cart.tsx:74-104); ProductCard memo + comparator; memo'd admin rows (admin/orders.tsx:216,379; wallet.tsx:359); ThemeProvider value memoized; ambient blob animations paused off-screen via IntersectionObserver (home.tsx:332-342, use-on-screen.ts).
12. **Startup path:** init.js is a 404 B theme flash-guard; splash screen is CSS-only with a 250 ms anti-flash threshold (App.tsx:936-957); web-vitals + GA deferred to idle (main.tsx:74-88); nothing blocks first paint except the (small, immutable, brotli'd) eager set.
13. **Transport:** brotli on all text assets, `immutable` 1 y on /assets, `s-maxage=60 + SWR` on catalog API, HTTP/2 (+ h3 alt-svc) — all verified live.

---

## 3. Ranked fixes (biggest win first)

| # | Fix | Gain | Effort |
|---|---|---|---|
| 1 | F1 drop/lazy Sentry replay | **−90-100 KB br / visitor** | S-M |
| 2 | F3 list projection (variants off the grid payload) | −5.3 KB gz + 72 KB parse / catalog view | M |
| 3 | F4 hover/touch route prefetch | −150-400 ms perceived nav | S |
| 4 | F2 SW `assets-js` maxEntries 40→160 | kills repeat-visit re-fetches | S |
| 5 | F6 `minChunkSize` for icon micro-chunks | −20-40 requests / nav | S |
| 6 | F7 home-chunk modulepreload | −100-300 ms cold boot | S |
| 7 | F5 orval admin/user split | −1-2 KB br + hygiene | M |
| 8 | F8 memo comparator + variants | correctness | S |
| 9 | F10 lhci budget or drop | regression visibility | S/M |

**Bottom line:** the eager path is already elite (145 KB br JS+CSS for a full RTL e-commerce SPA, gated in CI). The remaining fat is *post-paint universal weight* (Sentry replay — 47% of all JS) and *interaction/revisit economics* (no prefetch, SW cache thrash, over-fat catalog payload). Items 1+3+4 are three small diffs worth ~100 KB br and ~0.5 s of perceived latency per visitor.

— R124-A2, 2026-10-08. No code modified; only this report + worklog written.
