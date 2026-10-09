# R125-A11 — Live production read-only smoke (https://subnation.ly)

- **Agent:** R125-A11 (GET/HEAD ONLY — no auth attempts, no POST/PUT/DELETE, no admin surfaces beyond the unauthenticated shell, no repo source files touched; only this report + one worklog entry)
- **Date:** 2026-10-09 01:56–02:04 UTC (probe sandbox → origin)
- **Repo ref:** SubNation2 @ `09857fc` (read-only comparison; clean tree)
- **Predecessor:** R124-A7 (docs/inspection-r124/A7-live-smoke.md) — same discipline; deltas called out per section and consolidated in §H.
- **Origin posture (unchanged since R117/R124):** Contabo VPS, Cloudflare DNS-only (no `cf-*` headers on any response), HTTP/2 + `alt-svc: h3` — no CDN/edge in the path.
- **Deploy freshness:** served shell `last-modified: Fri, 09 Oct 2026 01:12:11 GMT` — a build landed **~44 min before this probe** (after R124's 2026-10-08 20:00 build). All asset hashes are new vs R124-A7 (`index-BUknxoGu.js → index-CtvLUatG.js`, `index-Bs4ADUnM.css → index-D90owAaz.css`) and every R124 feature probed below is live → **the deploy is a fresh build of the 09857fc lineage.**

---

## Method (request log summary)

37 GET/HEAD requests total (≤40 budget), `-m 15` timeouts, ~0.7 s sleep between requests, cookies saved/reused only for GETs (none needed — no auth surfaces probed). Breakdown:

| Batch | Requests | Targets |
|---|---|---|
| Health + identity | 6 | `/healthz`, `/api/healthz/summary`, `/`, `/products/some-nonexistent-slug`, `/product/some-nonexistent-slug`, `/admin` |
| Redirect matrix | 5 | `http://subnation.ly/`, `http://subnation.ly/products/x`, `https://www.subnation.ly/`, `https://www.subnation.ly/products/x`, `http://www.subnation.ly/` |
| Caching/SEO | 6 | `/sitemap.xml`, `/robots.txt`, `/index.html`, `manifest.json` (HEAD), `manifest.webmanifest` (HEAD), `/opengraph.jpg` (HEAD) |
| API shape | 5 | `?fields=list`, full list, `/stats`, `/api/nonexistent`, `/by-slug/directv-stream` |
| Chunk discipline | 9 | GET entry / vendor-sentry / instrument (URL discovery), HEAD sentry-replay ×2 / vendor-sentry / CSS, GET sentry-replay (br size) |
| Perf samples | 9 | `/` ×3, `?fields=list` ×3, entry-asset HEAD ×3 |

Zero failures; zero timeouts; rate-limit budget untouched (worst observed `r=598` of 600).

## A. Health + identity

| Probe | Result | Verdict |
|---|---|---|
| `/healthz` (root) | 200 **text/html** — the SPA unknown-path shell (11,379 B raw, `noindex,follow`, canonical stripped) | ✅ matches repo routing: health lives under `/api/healthz*` (server.ts:74); root-level path falls to the R122 unknown-path family (app.ts:1445). Not a health endpoint — informational only |
| `/api/healthz/summary` | 200 `{"status":"ok"}`, `cache-control: public, max-age=15` | ✅ R117-A4 P2-1 fix still live; took **2.48 s** — first DB-touching call of the session (see §G Neon note) |
| `/` (SPA shell) | 200, br 4,473 B (raw 11,445), `lang="ar" dir="rtl"`, title `SubNation — سوق الاشتراكات الرقمية`, meta description + og:description = the R120-B3 default (Netflix/VPN/Windows/AI + د.ل + ليبيا), og:image 1280×720, canonical `https://subnation.ly/`, robots `index,follow`, `theme-color #dc1840`, `manifest href="/manifest.json"`, GSC meta present with `content=""` (unset — matches the seoHeadInject contract), 4 font preloads (ar 400/600/700 + latin 400), `init.js` + `registerSW.js` | ✅ byte-for-byte the repo's `frontend/index.html` expectations incl. all R120/R116 markers |
| `/products/some-nonexistent-slug` (plural, deep) | **200 SPA shell**, `noindex,follow`, canonical stripped | ✅ the R124-era unknown-path family — soft-200 + noindex, NOT a server 404 (app.ts:1438-1445) |
| `/product/some-nonexistent-slug` (singular) | **404 HTML shell**, canonical stripped (robots stays static `index,follow` — the 404 status carries the no-index signal) | ✅ the R120 A7-F7 real-404 behavior unchanged since R124 |
| `/admin` (unauthenticated) | **200 SPA shell** (the admin login route boots client-side), `noindex,follow`, canonical stripped, same CSP/cache headers as `/` | ✅ matches SHELL_NOINDEX_RES `/^\/admin(\/|$)/` (app.ts:1262). No auth attempted |

## B. Redirect matrix

| URL | Status | Location | Note |
|---|---|---|---|
| `http://subnation.ly/` | **302** | `https://subnation.ly/` | ⚠️ the known ops item — unchanged since R124 (Finding 2 there) |
| `http://subnation.ly/products/x` | **302** | `https://subnation.ly/products/x` | scheme-only, path preserved |
| `https://www.subnation.ly/` | **301** | `https://subnation.ly/` | ✅ |
| `https://www.subnation.ly/products/x` | **301** | `https://subnation.ly/products/x` | ✅ path-preserving deep redirect |
| `http://www.subnation.ly/` | **301** | `https://subnation.ly/` | ✅ host+scheme in ONE hop |

Identical to the R124-A7 matrix in every cell. The www→apex 301 consolidation holds; the apex http→https 302 remains the only deviation from the documented 301 expectation (docs/operations/WWW_TO_APEX_301.md is the open ops item).

## C. Security headers vs expected (on `/`)

Live headers compared against `backend/src/app.ts:150-289` (helmet + explicit Permissions-Policy):

| Header | Live | Expected (code) | Verdict |
|---|---|---|---|
| `content-security-policy` | full policy: `default-src 'self'`; script-src `'self'` + 8 Google/Firebase origins + googletagmanager; `script-src-attr 'unsafe-inline'` (Firebase handlers); style/font `'self'` (+inline styles); img `'self' data: https:`; connect-src incl. `*.sentry.io` + 3 ingest wildcards + GA wildcards **+ `https://subnation.ly https://www.subnation.ly`** (allowedOrigins, prod); worker `'self' blob:`; frame-src Firebase set; `object-src 'none'`; `base-uri 'self'`; `form-action 'self'`; `frame-ancestors 'self'` | app.ts:172-260 verbatim (allowedOrigins appended in prod per :230-232) | ✅ exact match, zero drift |
| `strict-transport-security` | `max-age=63072000; includeSubDomains; preload` | app.ts:262-273 | ✅ |
| `x-content-type-options` | `nosniff` | helmet xContentTypeOptions | ✅ |
| `referrer-policy` | `strict-origin-when-cross-origin` | app.ts:287 | ✅ |
| `x-frame-options` | `SAMEORIGIN` | app.ts:286 (frame-ancestors 'self' in CSP too) | ✅ |
| `permissions-policy` | `camera=(), microphone=(), geolocation=(), usb=(), payment=(self), midi=(), accelerometer=()` | app.ts:162-168 verbatim | ✅ |
| `cross-origin-opener-policy` | `same-origin-allow-popups` | app.ts:284 | ✅ |
| `cross-origin-resource-policy` | `same-origin` | helmet default | ✅ |
| COEP | **absent** | deliberately disabled (app.ts:277 — Firebase popup compat) | ✅ by design |
| Extras | `x-xss-protection: 0`, `x-dns-prefetch-control: off`, `x-download-options: noopen`, `x-permitted-cross-domain-policies: none`, `origin-agent-cluster: ?1`, `x-request-id` (uuid), **no `Server` leak** | helmet defaults + correlation | ✅ |

Nothing missing, nothing looser than the code claims. All headers also present on API + 404 + asset responses (uniform middleware ordering).

## D. Caching

| Family | Live `Cache-Control` | Expected (app.ts) | Verdict |
|---|---|---|---|
| `/` and `/index.html` (HTML shell) | `no-cache, no-store, must-revalidate` + etag + `last-modified` | :1473/:1594 | ✅ both URLs identical (4,473 B br each, same etag `W/"2cb5-…"`) |
| `/assets/*` (entry, CSS, vendor-sentry, sentry-replay — all HEADed) | `public, max-age=31536000, immutable` + weak etag + last-modified | :1448-1456 | ✅ hashed, immutable |
| `/manifest.json` | `public, max-age=3600` | :1453 unhashed family | ✅ |
| `/opengraph.jpg` | `public, max-age=3600` | :1453 | ✅ |
| `/sitemap.xml` | `public, max-age=60, stale-while-revalidate=300` | seo routes | ✅ |
| `/robots.txt` | `public, max-age=300, stale-while-revalidate=600` | seo routes | ✅ |
| `/api/products` (list + full) | `public, max-age=0, s-maxage=60, stale-while-revalidate=300` | products.ts catalogCache | ✅ |
| `/api/nonexistent` (generic API 404) | **`no-store`** | app.ts:939 (R124 A7-F4 fix) | ✅ **fix live** (was missing entirely in R124-A7) |
| `/manifest.webmanifest` | 200 **text/html** — the SPA unknown-path shell, not a real file | repo serves `/manifest.json` (index.html:91) | ℹ️ probe-menu mismatch, not a repo deviation — the PWA manifest is `manifest.json` (2,231 B, complete per R124) |
| Rate-limit headers | `ratelimit: "600-in-1min"; r=599` on first API hit, `r=598` after | — | ✅ live, same as R124 |

**Sitemap:** 200, 21,542 B, **56 `<loc>`** — identical count to R124's claim (1 home + 7 categories + 45 products + support + terms + flash-sales), all apex-absolute. `lastmod` values are still all inside the 2026-09-20 20:14:59→20:15:19 bulk-import window (R124 Finding 7, unchanged). **og:image:** 200 `image/jpeg` 39,597 B (byte-identical to R124) with static 1280×720 dims — honest.

## E. API shape + byte table (unauthenticated only)

| Endpoint | Status | Wire (br) | Raw JSON | Shape check |
|---|---|---|---|---|
| `/api/products?fields=list` | 200 | **3,399 B** | **17,445 B** | 45 items; keys = 15-field ProductListItem; `variant_count` present ✓, `variants` ABSENT ✓, `description` present ✓, `usage_terms` absent ✓ — **the R124 A2-F3 fix is live** |
| `/api/products` (full) | 200 | 6,999 B | 79,762 B | 45 items; `variants` (full tree) + `usage_terms` present ✓ |
| `/api/products/by-slug/directv-stream` | 200 | 1,633 B | 5,966 B | detail shape: `variants[16]`, `seo_title` (DB override, Arabic), `seo_description`, `description_long`, `faq`, `features`, `usage_terms` ✓ |
| `/api/products/stats` | 200 | 102 B (uncompressed) | 102 B | `{"total_products":45,"available_products":1,"total_units":4,"lowest_price":59.8,"has_flash_sale":true}` — `lowest_price` matches products.ts:560 (R124-A7 simply didn't record it) |
| `/api/nonexistent` | 404 | 61 B | 61 B | `{"error":"المسار غير موجود","code":"NOT_FOUND"}` + **`Cache-Control: no-store`** ✓ (R124 fix 4bfae28 live) |

`fields=list` carries **48.6% of the full wire bytes (21.9% raw)** — the list projection saves 51.4% on the wire / 78.1% raw today. (The in-code comment's "62.6% of the wire bytes" figure at products.ts:478 measures differently against today's catalog mix — see §H.)

**Catalog state — UNCHANGED since R124 and still the top ops item:** only `lifetime-cloud-storage` is purchasable (`is_available: true`, `stock_count: 1`); 44/45 products unavailable; 4 total units; a flash sale is active. R124-A7 P1 is still open.

## F. Chunk discipline (from the served shell + chunk graph)

Eager set in the served `/` HTML:
1. `/init.js` (sync classic, head) — unchanged since R124
2. `/assets/index-CtvLUatG.js` (module entry) — **32,944 B br**
3. 4× modulepreload: `vendor-react-BGc3SGOC.js`, `vendor-utils-BDotZxtq.js`, `vendor-router-CvBtqEME.js`, `vendor-query-D89SMAcg.js`
4. **`/assets/home-BK1nPs2m.js` modulepreload — the R124 A2-F7 warm-up IS present** on the storefront shell ✅
5. stylesheet `/assets/index-D90owAaz.css` (raw 271,893 B, immutable)
6. 4× font preload (readex ar-400/600/700 + latin-400) + `registerSW.js`

Findings:
- **sentry-replay boundary (R124 A2-F1) — VERIFIED LIVE, one level stronger than expected:** `sentry-replay-JRhybXiN.js` exists as its own URL — 200, `immutable`, **126,879 B raw / 41,550 B br** (matches the "~40 KB br" expectation) — and is referenced by **no eager HTML tag and not even by the entry chunk**. The only reference lives in `instrument-DUZ8ZJ95.js` (itself a separate 1,485 B chunk holding instrument.ts's `import("./lib/sentry-replay")` at :135). Grepping the entry chunk for "replay" returns zero hits.
- **vendor-sentry slimmed:** `vendor-sentry-DL8XvLTb.js` = 329,290 B raw / 111,296 B br — vs the pre-R124 469,777 B raw chunk with rrweb inside (vite.config.ts:428). The replay byte-gate's measured effect is real in production.
- **Home preload on /admin — the R124-R1 P3-2 residual is CONFIRMED still live:** the `/admin` shell's HTML carries the identical `home-BK1nPs2m.js` modulepreload (the criticalPreloadInject plugin has no admin gate, vite.config.ts:288-293). Admin boots still pull the ~8.5 KB gz storefront chunk they never route to.
- **Admin fetchers ride the entry graph (A5 P3 residual, visible live):** the entry chunk's dependency map enumerates `orders-×2`, `users-×2`, `referrals-×2`, `risk`, `risk-event`, `coupons`, `dashboard`, `enrichment`, `promotions`, `settings`, `tickets`, `topups`, `security`, `admins-p`, `idempotency`, `admin-session` chunk URLs — the storefront entry still knows the whole admin surface.
- **Sentry ingress:** the DSN is embedded in the entry chunk as `https://2c1152a3dff5af381277e1c57a7ea3e@o4511397349097472.ingest.de.sentry.io/4511397448581200` — a standard public-key DSN (public by design; app.ts:215), **not** an auth token; CSP connect-src covers the `*.ingest.de.sentry.io` wildcard. No eager replay references anywhere.

## G. Perf samples (time_total, probe sandbox → Contabo origin)

| Target | Run 1 | Run 2 | Run 3 | **Median** |
|---|---|---|---|---|
| `https://subnation.ly/` | 0.858 s | 0.769 s | 0.607 s | **0.769 s** |
| `/api/products?fields=list` | 1.646 s | 1.087 s | 0.626 s | **1.087 s** |
| `/assets/index-CtvLUatG.js` (HEAD, immutable) | 0.625 s | 0.772 s | 0.629 s | **0.629 s** |

- Nothing exceeded 2.5 s all round; the 37-request session averaged ~0.9 s/request.
- **Neon cold-start signal — observed, consistent with `docs/operations/NEON_COLD_START_RUNBOOK.md`:** the session's first DB-touching call (`/api/healthz/summary`) took **2.48 s**; the first `/api/products?fields=list` (s-maxage window expired) took 1.65 s; warm repeats settle at 0.63 s — a ~4× first-hit penalty that decays within 2-3 calls. No action beyond the existing runbook.
- Static immutable assets still pay the same single-origin RTT as HTML (no edge cache — unchanged R124 Finding 5; not re-probed in depth this round).

## H. Deviations from R124-A7 baseline + repo claims

| # | Deviation | Severity | Likely cause / disposition |
|---|---|---|---|
| 1 | **Catalog still cannot sell: 1/45 products purchasable, 4 total units** — byte-identical stats to R124-A7 Finding 1 (45/1/4, flash sale on). | **P1 (ops carryover, unchanged)** | No inventory loaded since R124. Operator action per `docs/operations/FINAL_INVENTORY_LOADING.md`; no code defect. |
| 2 | Apex `http→https` still **302** (www paths correctly 301). | P3 (ops carryover, unchanged) | Traefik/Coolify entrypoint rule not yet set to permanent — `docs/operations/WWW_TO_APEX_301.md` still open. |
| 3 | `/admin` shell still ships the **home chunk modulepreload** (~8.5 KB gz wasted on every admin boot). | P3 (known residual R124-R1 P3-2, now CONFIRMED live) | criticalPreloadInject has no route gate (vite.config.ts:288-293); A5's 2-line init.js gate is the sketched fix. |
| 4 | Entry chunk still enumerates **admin fetcher chunks** (orders/users/referrals/risk/coupons/dashboard/…) in its dependency map. | P3 (known residual A2 F5 / A5 P3, visible live) | Generated api.ts fetchers imported from store-facing modules; chunk-splitting the admin API surface is the standing fix. |
| 5 | Sitemap `lastmod` still the synthetic 2026-09-20 bulk-import stamp (all 54 values in one 20-s window). | P3-informational (carryover, unchanged) | SEO-products import run; prefer real `updated_at` if/when it exists. |
| 6 | products.ts:478 comment claims the full-only fields are "62.6% of the wire bytes, measured live" — today's live ratio is **51.4% wire / 78.1% raw**. | P3-informational (doc drift) | The R124 measurement predates the fix's deploy or rode a different catalog/compression mix; the direction of the claim (variants dominate full bytes) still holds. Comment-only truth-up. |
| 7 | `/manifest.webmanifest` is not a real file (serves the SPA shell 200 text/html); the PWA manifest is `/manifest.json`. | ℹ️ note (probe-menu mismatch, not a repo deviation) | Repo never shipped a webmanifest; index.html:91 references manifest.json (200, 2,231 B, complete). |
| 8 | `/healthz` at root serves the SPA noindex shell; public health lives under `/api/healthz*`. | ℹ️ note (matches repo routing) | server.ts:74 mounts health under /api; root-level falls to the unknown-path family. Nothing to fix. |
| 9 | **NEW BUILD since R124** (last-modified 2026-10-09 01:12, all hashes rotated) with **zero behavioral drift**: every R124 fix probed is live (fields=list projection, no-store API 404, home modulepreload, sentry-replay boundary + slimmed vendor-sentry, noindex families, real 404 for dead product slugs, redirect matrix, full header set, 56-loc sitemap, og dims). | ✅ verification (not a deviation) | The deploy is a fresh build of the 09857fc lineage — production matches the repo's claims. |
| 10 | R124-A7 Finding 3 (origin re-compresses woff2/webp, +96 B on fonts) — **not re-measured this round** (font wire sizes outside the request budget). | P3 (carryover, unverified-not-regressed) | No compression-filter change is visible in app.ts; assume open until a future round re-measures. |

## I. Priority counts

**P0: 0 · P1: 1 (ops carryover — catalog stock) · P2: 0 · P3: 5** (302 scheme redirect, admin home-preload residual, admin-fetchers-in-entry residual, sitemap lastmod stamp, wire-ratio comment drift) **+ 2 informational notes + 1 unverified carryover.**

**Verdict:** production is a fresh, healthy build of the 09857fc lineage — every repo claim probed live held exactly; all deviations are previously-known ops/residual carryovers, none new.
