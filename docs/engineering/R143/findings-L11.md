# L11 — Performance, PWA & loading behavior audit (R143)

Lane R143-L11 · HEAD 528ef39 · tree clean. Read-only investigation + one local
production build (`corepack pnpm --filter @workspace/subnation run build`, writes dist/
only) + read-only guest probes of the live site (curl headers/sizes, two headless
Chromium cold-load traces at 390×844, one SW-warm trace). Zero modifications to
repo sources; production untouched (no writes; one deliberately-empty POST to
/api/cwv that the schema validator rejected with 400 — same code path any browser
hits on boot).

## R142 fix verification

**B-2/M-1 (bundle-budget gates scan comment-stripped HTML): VERIFIED.**
- `frontend/vite.config.ts:52-56` `findBundleEntry` and `:64-76` `collectEagerFiles`
  both run `html.replace(/<!--[\s\S]*?-->/g, "")` before the entry regex and the
  eager-link scan; wired at `:126` (entry lookup) and `:172` (eager set). The
  R120-B5 home-chunk skip stays in the plugin (gate policy, `:184-186`).
- Pinned by `frontend/src/lib/__tests__/bundle-budget-gate.test.ts` (7 tests:
  built-head fixture, decoy-comment fixture, fully-swallowed R141 shape →
  undefined, real source template never matches; eager-set decoy links ignored).
  Re-ran at HEAD: **7/7 green (21ms)**.
- Local HEAD build re-measured through the fixed gate:
  `[bundle-budget] index-BLdfWcGi.js: 34061 bytes (gzip)` ·
  `eager path (6 files …): 145959 bytes (gzip)` — both scans measured the real
  entry/links of the built shell (no-DSN local shape).

**M-2 (ci.yml boot smoke step): VERIFIED** — with one honest scope note.
- `.github/workflows/ci.yml:529-558` "Boot smoke — the built shell must be
  bootable" runs inside the `build` job (line 479), which fires on every code
  push (`needs.filter.outputs.code == 'true'`, line 486-489) after
  `pnpm --filter @workspace/api-server run build` produces the artifact. It
  strips HTML comments, then hard-fails unless the module entry
  `index-*.js` script, a `rel="stylesheet"` CSS link, and the
  `/registerSW.js` script all live OUTSIDE comments (the shell-head-anchors
  semantics).
- Replayed the exact CI node snippet against the local HEAD dist →
  `[boot-smoke] OK`. The R141 dead-shell class (comment-swallowed payloads) is
  now caught at push time on the BUILT artifact, not only by the source-template
  unit test.
- Scope note (recorded as L11-3): the landed smoke is deliberately
  browser-free/static (deterministic per the in-step comment). It certifies tag
  presence, not JS execution — runtime boot regressions that keep the tags alive
  (broken hydration, a JS exception at module eval, a CSP-blocked *external*
  script) still pass push CI and surface only via the Monday-04:17 e2e heartbeat.

---

## Bundle & critical-path measurements (the evidence base)

Local build at HEAD (no-DSN shape): 139 JS chunks, 2,155,191 B raw / 596,351 B
gz total; entry `index-BLdfWcGi.js` 116.0 KB raw / 34.06 KB gz; CSS
`index-DJId2VOP.css` 254,110 B raw / 30,376 B gz (6 @font-face blocks = 1,386 B,
37 media queries, 5 `@layer`s); 6 woff2 = 74.9 KB (4 preloaded = 44.9 KB);
preload-gate 571 B; init.js 404 B; registerSW.js 134 B; SW precache 10 entries /
342.58 KB. **Zero `.map` files in dist.**

Live production (read-only curls, gz transfer sizes): entry
`index-5v7iE5dj.js` **35,433 B** (119,569 B raw) · vendor-react 58,787 ·
vendor-utils 9,948 · vendor-query 10,916 · vendor-router 2,605 · CSS 30,376 →
**eager path 148,065 B gz**. (The task brief's "~120 KB gz entry" is the RAW
size; the gz entry is 35.4 KB.) Heaviest lazy deps, all confirmed off the eager
path in live traces: vendor-charts 514.7 KB raw/134.7 KB gz (admin
dashboard/system only), vendor-firebase 153.6/44.3 (loaded only on sign-in
click — `AuthProviders.tsx:26` dynamic `import("firebase/auth")`;
`lib/firebase.ts` imports types only), sentry-replay 41.9 KB gz (post-load,
after LCP in trace), socket.io 42.5 KB raw (admin-only mount,
`app-shell.tsx:59-72`).

Live cold-load traces (headless Chromium, 390×844, serviceWorkers blocked):
- **Home**: TTFB 657 ms → HTML 7.5 KB gz → entry+4 vendors+CSS+4 fonts all
  parallel (729→1566) → FCP 1888-2084 → LCP 2820-3576 (text hero, fonts
  preloaded) → CLS 0.004 → **zero console errors**, 45 cards, first-4 images
  `loading=eager`, first-2 `fetchpriority=high` (verified in DOM). Head-start
  works exactly as designed: home chunk warmed at 902-1071 ms, `/api/products`
  in flight at 1511 ms (module-eval), probe at 1584 — one request, never two.
- **PDP deep-link** (WhatsApp pattern): TTFB 818 → entry end 1476 → probe
  2134→2523 → **product route chunk discovered only at 2668** (after React
  mounts + probe resolves) → by-slug API 3287→4378 → recommendations
  4438→4861 → LCP 4892 (product image), CLS 0, zero console errors. The
  head-start warmed the HOME chunk at 1071 — unused on this route.
- **SW-warm revisit**: TTFB 3 ms, FCP 388 ms, LCP 1280 ms, 47/47 assets from
  SW cache, catalog/stats/flash-sale served SWR-instant. SW install + active +
  controlled verified; `sw.js`/`registerSW.js`/`/` all `no-cache, no-store` →
  update check on every navigation; autoUpdate (skipWaiting+clientsClaim) +
  controllerchange reload toast (`main.tsx:112-137`).

API payloads (live, gz): `products?fields=list` 45 rows / 3,271 B (description
included — ProductCard renders it at ≥sm; usage_terms + variants tree
correctly dropped, A2-F3); catalog/stats 103 B; auth/probe 23 B; flash-sale
19 B; by-slug ~1,569 B. List endpoint is a single query with two grouped
subquery joins + one follow-up variants query (`catalog.service.ts:423-514`) —
**no N+1**. 30 s in-process cache + strong ETag + `compression()` + s-maxage.

---

## Findings

### L11-1 · P2 · Deep-link boots (the dominant WhatsApp PDP traffic) get no route-chunk/data head-start — home chunk is warmed instead

- **Evidence:** live PDP cold trace: product route chunk fetch *starts* at
  2668 ms — after entry eval (1476) → `/api/auth/probe` (2134→2523) → React
  mount + route resolution; `/api/products/by-slug/…` then fires at 3287 and
  the LCP image lands at 4892 ms. Meanwhile the head-start warmed the
  **home** chunk at 1071 ms (`boot-head-start.ts:122` warms `@/pages/home`
  for *every* non-admin boot; `preload-gate.js` modulepreloads the home chunk
  for every non-admin boot, `dist/public/assets/preload-gate-UNflcRlC.js`) —
  9.6 KB gz fetched + parsed and never used on this route. The repo's own
  docs name WhatsApp product deep-links "the dominant storefront traffic"
  (`boot-head-start.ts:48-54`); hover/focus warm-up (`route-chunk-warmup.ts`)
  can't help a cold deep-link (no pointer events before mount).
- **Root cause:** the R96-F3/R111-F4-F3 boot head-start is deliberately
  home-only; the route family the boot path will actually mount (product,
  category) was never given the same leg-(a)/(b) treatment.
- **Proposed fix:** in `boot-head-start.ts`, derive the boot path's route
  family (reuse `routeWarmupFamilyForPath`) and warm THAT chunk specifier for
  non-home, non-admin boots (keep the home warm only for `/`); optionally add
  leg (b) for `/product/:slug` boots — prefetch `/api/products/by-slug/:slug`
  under home's query key + warm `image_url` (the exact R127-L10 first-4
  pattern). The preload-gate `data-home-chunk` attribute can carry the
  matched family's chunk URL (build-time, hash-correct).
- **Test requirement:** extend the boot-head-start regression suite — the
  path→family predicate pinned both ways (deep-link boots warm product,
  never admin; home boots unchanged); the by-slug prefetch key must equal
  the PDP's `useGetProductBySlug` key (the A2-F3 key-parity class).
- **Risk:** low — same catch-guarded, failure-tolerant shape as the existing
  legs; the only new hazard is warming the wrong family (pinned by test) or
  double-fetching by-slug (prevented by TanStack key dedupe, same as home).

### L11-2 · P3 · Eager-path budget headroom is effectively exhausted — 415 B under the 145 KiB warn line in the production shape

- **Evidence:** live eager path measured **148,065 B gz** (entry 35,433 +
  vendor-react 58,787 + vendor-utils 9,948 + vendor-query 10,916 +
  vendor-router 2,605 + CSS 30,376) vs the warn threshold 148,480 B (145 KiB)
  → **415 B (0.28%) headroom**; hard-fail at 163,840 B (160 KiB) has 15.8 KiB
  room. R127-L10 (B4 D1) documented 438 B headroom at f53a886 — the line has
  since moved ~23 B against the budget with zero gate visibility (CI's DSN
  parity substitution now closes that visibility gap, `vite.config.ts:237-311`,
  but the number itself is still 0.3% from warning).
- **Root cause:** every round since R120 has fed the eager path (icons fix
  R122 bought 8 KB, but Sentry DSN growth, entry growth ate it back); the
  thresholds were calibrated at R120 and never re-decided.
- **Proposed fix:** a recorded decision, not a panic trim: either (a) trim
  ~1-2 KB from the entry (candidates: `seo-builders` string tables, the
  inlined category map shared with lazy chunks — `minChunkSize` 2048 inlines
  it into entry AND 5 lazy chunks), or (b) consciously move the warn line to
  150 KiB with the headroom rationale written in `vite.config.ts` next to the
  constants. Next React/TanStack minor bump decides this anyway — better to
  decide first.
- **Test requirement:** none new — the gate + budget-dsn-parity suite already
  measure; a threshold change updates the constants and their comments only.
- **Risk:** none (warn-level today); the risk is *inaction* — an unrelated
  dependency bump silently converts every future CI build into a warn that
  gets ignored.

### L11-3 · P3 · M-2 residual: the push-time boot smoke is static — JS-level boot regressions still pass push CI (weekly-only detection)

- **Evidence:** the landed smoke (`ci.yml:529-558`) asserts *tag presence
  outside comments* in the built HTML. It catches the R141 dead-shell class
  and (via the budget gate's file-existence checks, `vite.config.ts:197-203`)
  a missing entry chunk. It does NOT execute the shell: a boot that dies at
  module-eval (a bad import, a runtime exception in `main.tsx`'s top-level
  code, an API-bridge misconfiguration) renders the «يتطلب الموقع تشغيل
  JavaScript» fallback forever and still ships green. The only runtime boot
  guards are `home.spec.ts`/`seo.spec.ts` in the dispatch/weekly-only e2e job
  (`ci.yml:577`) — the exact detection ceiling M-2 originally flagged (≤7
  days).
- **Root cause:** the R142 fix deliberately chose browser-free determinism
  (documented in the step comment) — a defensible scope cut, but the runtime
  half of M-2's exposure remains open.
- **Proposed fix:** one push-time step in the build job after the smoke:
  `vite preview` (or `npx serve dist/public`) + `E2E_ENABLED=1 npx playwright
  test home.spec.ts --project=chromium` with `E2E_BASE_URL=http://localhost:4173`
  — guest-only, no secrets, ~2 min, catches "JS never boots" at push. The
  Playwright browser install can ride the existing e2e job's install step
  pattern.
- **Test requirement:** the step IS the test; pin that it fails when pointed
  at a shell with a commented-out entry (the r140 fixture) before trusting it.
- **Risk:** CI minutes (~2-3 min/push, repo is public → free) and a
  preview-server port flake (mitigate: strictPort + retry once).

### L11-4 · P4 · PDP recommendations fetch is strictly serial after by-slug (id-keyed endpoint)

- **Evidence:** live PDP trace: by-slug 3287→4378, recommendations
  4438→4861 — the second request cannot start until the first resolves
  because the endpoint is `/api/products/:id/recommendations`
  (`products.ts:228`) and the id only exists in the by-slug payload. One full
  RTT (~250-400 ms on Libyan mobile) of pure serialization for below-the-fold
  content.
- **Root cause:** the recommendation route is id-keyed only; no by-slug
  variant and no payload inlining.
- **Proposed fix (smallest):** include the recommendation rows inside the
  by-slug detail response (they are already computed from the same
  category/price data, 60 s-cached, tiny), OR add
  `/api/products/by-slug/:slug/recommendations` so the frontend can fire both
  in parallel. Frontend change is 3 lines either way.
- **Test requirement:** openapi parity (orval) if the response shape changes;
  one pglite test for the inlined/parallel arm.
- **Risk:** spec churn (the N-1/N-3 deferral class — coordinate with the
  contracts lane); below-fold content, so purely a latency polish.

### L11-5 · P4 · No metric-compatible font fallback — `font-display: swap` against a raw `sans-serif` stack leaves a swap-reflow residual on bandwidth-bound first visits

- **Evidence:** `src/index.css:239` `--app-font-sans: "Readex Pro", "Inter",
  sans-serif`; all 6 @fontsource faces ship `font-display: swap` with **no**
  `size-adjust`/`ascent-override` fallback face. Measured CLS on good
  conditions: 0.004 (home), 0 (PDP) — the 4 critical faces are preloaded in
  head, so swap usually completes before first paint. But the documented
  environment is bandwidth-bound Libyan mobile (the 6 s no-JS reveal exists
  precisely because ~370 KB raw JS can land after 2.5 s); on such links the
  preloads contend with the entry graph and Arabic text reflows at swap time
  (Readex Pro's metrics differ from system Arabic fallbacks).
- **Root cause:** preloading was the chosen mitigation (R-140-b); the
  metric-adjusted-fallback technique was never applied.
- **Proposed fix:** one `@font-face { font-family: "Readex Pro Fallback";
  src: local(Arial/system); size-adjust: ~93-96%; ascent-override: … }` tuned
  once against Readex Pro's published metrics, slotted into `--app-font-sans`
  before `sans-serif`. ~10 lines of CSS, zero JS.
- **Test requirement:** none meaningful in jsdom; verify visually + CLS trace
  on a throttled profile.
- **Risk:** near-zero; a badly tuned fallback is still better than raw
  sans-serif (it only affects the pre-swap frame).

### L11-6 · P4 · `caniuse-lite` browsers data is 8 months stale — every build prints the Browserslist warning

- **Evidence:** local HEAD build stderr: `Browserslist: browsers data
  (caniuse-lite) is 8 months old. Please run: npx update-browserslist-db@latest`.
  The production `target` is the Vite default ("modules"-based, driven by this
  data) — stale data silently skews which syntax gets transpiled vs shipped
  native (the 5.3 KB gz `index-DTMLXFjJ.js` toaster chunk and the CSS both
  depend on it).
- **Root cause:** `caniuse-lite` rides a transitive dep and nothing bumps it.
- **Proposed fix:** a controlled `pnpm --filter @workspace/subnation exec
  browserslist@latest --update-db` (or an explicit `caniuse-lite` resolution)
  in a single dedicated commit, then re-run the budget gate — the byte delta
  is the review artifact.
- **Test requirement:** budget gate numbers before/after in the PR body
  (entry + eager sum).
- **Risk:** output-charset/target drift — bounded by the budget gate and the
  120 boot-critical tests.

### L11-7 · INFO · Catalog `s-maxage=60` edge-cache headers are inert in the deployed stack (no CDN cache rule honors them)

- **Evidence:** live `curl -D` on `/api/products?fields=list` returns
  `cache-control: public, max-age=0, s-maxage=60, stale-while-revalidate=300`
  and **no `cf-cache-status`** — Cloudflare proxies but does not cache JSON.
  Every cold first-visit catalog request travels to the single VPS origin
  (~250-300 ms server time warm-TLS; ~2.7 s on an in-process-cache miss).
  Mitigations already in place: 30 s in-process cache, strong ETag (304s),
  compression, SW SWR for controlled sessions.
- **Root cause:** the s-maxage design (route-level, R124) was built for an
  edge rule that was never configured — an operator decision, not a code
  defect (and the R142 I-3 fix deliberately keeps *search* uncacheable at the
  edge).
- **Proposed action (operator-gated):** a Cloudflare cache rule matching
  `/api/products*` + `/api/flash-sale` + `/api/catalog/stats` honoring
  `s-maxage` — the headers are already correct and the search-shape
  `no-store` override protects the unbounded key space. Zero code change.
- **Risk:** stale-by-60 s catalog at the edge (already the designed bound);
  `Vary: Origin` present. Do not cache any other /api family.

### Verified clean (no finding — evidence recorded)

- **Code splitting:** all 45+ pages lazy via `lazyWithRetry`
  (`page-registry.ts:16-63`); admin console fully split (AdminScopeGate +
  19 per-page chunks; admin products 69 KB raw/18.9 KB gz, settings
  40.5 KB, CopilotPanel 34.8 KB — all route-lazy, none in the entry);
  recharts in vendor-charts loads only on admin dashboard/system (absent
  from both live storefront traces); qrcode lives in a settings-only chunk;
  Sentry SDK + replay load post-load (post-LCP in trace); socket.io mounts
  admin-only (`app-shell.tsx:59-72`); Toaster idle-mounted.
- **Entry graph:** entry statically imports exactly the 4 modulepreloaded
  vendors; every other chunk is behind a dynamic `import()` (verified in the
  built entry's import list).
- **No material duplication across chunks:** sonner toaster is one shared
  9.5 KB gz chunk consumed by ~20 pages; ProductCard is one shared chunk;
  the only duplication is the small `lib/categories.ts` constant map inlined
  into entry + 5 lazy chunks — the documented `minChunkSize` 2048 trade
  (vite.config.ts:1198-1206), ≤ ~1 KB per chunk.
- **Images:** all 45 catalog assets are webp 450×450 (re-measured live:
  4.3-31 KB each, 30 d cache + SWR 86400); ProductCard ships
  width/height=450 (CLS 0), eager first-4, `fetchpriority=high` first-2,
  lazy+low priority rest, decode async; PDP hero eager+high with dims;
  boot warms the first-4 card images at prefetch resolve (R127-L10);
  no srcset fabricated for a single-rendition catalog (measured, R-140-a).
- **React perf:** ProductCard `memo`'d (`ProductCard.tsx:808`); cart context
  split commands/state with memoized values (`cart.tsx:290-612`); auth/theme
  contexts memoized; home uses `useDeferredValue` for the search stream,
  `keepPreviousData` for filter changes, 300 ms-debounced search commit,
  memoized `latestOrders` slice; admin product cards are module-level memo;
  45-row grids need no virtualization (admin lists paginate at 200 —
  desktop operator surface).
- **Query hygiene:** defaults staleTime 60 s / gcTime 5 min / retry only on
  TypeError+5xx / no refetch on focus or reconnect
  (`query-client.ts:12-39`); home products 3 min, stats 10 min; head-start
  prefetch dedupes against home's own useQuery (one request, traced); SWR
  invalidations are event-driven (socket resync), not interval storms; all
  polling is bounded + visibility-gated (NotificationBell 60 s paused when
  hidden, flash-sale 60 s/600 s adaptive, admin 60-300 s,
  `refetchIntervalInBackground: false` everywhere).
- **Memory:** SW caches bounded (32/200/160 entries; 7/30/30 d) +
  `cleanupOutdatedCaches`; boot error buffer capped at 32
  (`boot-sentry.ts:73`); all long-session listeners cleaned up
  (SessionActivityManager, NotificationBell, SocketInitializer teardown
  verified line-by-line); `warmedRouteChunks` bounded by the 5-family table.
- **PWA:** manifest complete and RTL-correct (name/short_name/desc, `dir:
  rtl`, `lang: ar`, id/scope/start_url `/`, standalone, maskable+any icons
  96/192/512, narrow+wide screenshots, 3 Arabic shortcuts — all 7 icon/screenshot
  files verified live 200); offline navigation → precached shell with
  `/api`+`/assets` denylist; offline JS gap is the documented R98-08a
  CacheFirst design (first offline visit after one online session works);
  SW update flow airtight (sw.js no-cache → autoUpdate → skipWaiting +
  clientsClaim → visible controllerchange reload toast; stale-chunk 404s
  recovered by lazyWithRetry's one-reload-per-pathname). iOS: standalone +
  apple-touch-icon 180×180 + `apple-mobile-web-app-capable` +
  black-translucent status bar + `viewport-fit=cover` with real
  `env(safe-area-inset-*)` reservations in Navbar/CSS. No
  `beforeinstallprompt` usage — install relies on browser UI (a deliberate
  minimalism; an in-app hint would be polish).
- **CWV:** live home CLS 0.004 / PDP 0; LCP candidates = hero text (home,
  preloaded fonts) and PDP image (eager+high+dims); skeletons are
  shape-matched; stats chips skeleton'd (R111-F1). CWV self-collected to
  `/api/cwv` (sendBeacon, batch ≤ 10, Prometheus histograms with bounded
  cardinality — no unbounded server memory).
- **Build config:** sourcemaps off (or hidden+Sentry-upload-then-delete with
  token); zero `.map` in dist; esbuild default minify; single CSS file
  (254 KB raw / 30.4 KB gz is the full Tailwind-4 design system — 5 layers,
  no dead-weight found); `compression()` + strong ETags on the backend;
  hashed assets 1 y immutable, shell/sw/registerSW no-store, product images
  30 d+SWR — all verified live.

## Not checked

Real-device Libyan network profiles (traces ran from this sandbox — RTT
~650 ms inflates absolute times; structure and ordering are the evidence);
iOS Safari real-device PWA install (relied on manifest/meta audit + safe-area
CSS); admin-console runtime perf (requires auth — chunk-level analysis only);
PostgreSQL query plans (EXPLAIN) behind the catalog loaders; the e2e suite
execution against a live stack (weekly CI heartbeat owns it).
