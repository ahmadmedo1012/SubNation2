# R124-A7 — Live production read-only smoke (https://subnation.ly)

- **Agent:** R124-A7 (READ-ONLY live-smoke; GET requests only — no login, no form submits, no admin routes, no OTP/WhatsApp triggers; only this report file + worklog entry written)
- **Date:** 2026-10-08 20:38–20:42 UTC (probe sandbox → origin)
- **Repo ref:** SubNation2 @ c736d13 (read-only comparison)
- **Origin observed (unchanged since R117):** Contabo VPS (169.58.100.161, Let's Encrypt at origin), Cloudflare DNS-only (no cf-ray on any response) → **no CDN/edge in the path**
- **Deploy freshness:** served shell `last-modified: Thu, 08 Oct 2026 20:00:37 GMT` — a build landed ~38 min before this probe

---

## 1. Redirect matrix

| URL | Status | Location | Hops to 200 | Note |
|---|---|---|---|---|
| `http://subnation.ly` | **302** | `https://subnation.ly/` | 1 | scheme-only, path preserved (`/category/vpn` → `https://subnation.ly/category/vpn`) |
| `https://subnation.ly` | 200 | — | 0 | HTTP/2 (+HTTP/3 via alt-svc, verified) |
| `http://www.subnation.ly` | **301** | `https://subnation.ly/` | 1 | host+scheme in ONE hop — ideal |
| `https://www.subnation.ly` | **301** | `https://subnation.ly/` | 1 | path preserved (`/product/netflix` → `https://subnation.ly/product/netflix`) |
| `https://www.subnation.ly/sitemap.xml` | 301 | `https://subnation.ly/sitemap.xml` | — | SEO consolidation intact |

**www→apex 301 EXISTS at the proxy now** — R117-A4 P2-2 (no canonical-host enforcement anywhere) is **RESOLVED live**. The only deviation from the expected matrix is the apex **http→https using 302 instead of 301** (see Finding 2).

## 2. Homepage weight

| Resource | Files | Raw bytes | Transferred (br/gzip) |
|---|---|---|---|
| HTML (`/`) | 1 | 11,380 | **4,453** (br) |
| JS in head (entry + 4 vendors + init.js + registerSW.js) | 7 | 369,796 | ~116,261 |
| CSS | 1 | 273,293 | 29,404 (br) |
| Fonts (preloaded woff2) | 4 | 44,864 | 44,960 (gzip — **inflated +96 B**, see Finding 3) |
| **Critical-path total** | 13 | **699,333** | **~195 KB compressed** |
| Homepage route lazy chunks (home, ProductCard, FlashSaleBanner, Footer, MobileNav, NotificationBell, SocketInitializer) | 7 | ~67,196 | ~23,539 |

- Entry chunk raw 109,365 B → 32,545 B br; vendor-react 186,253 → 59,237; CSS 273,293 → 29,404.
- Negotiation: `br` preferred when offered; `gzip` served when gzip-only (verified). No compression on tiny files (init.js 404 B, robots 774 B — fine).
- ~40 per-route lazy chunks enumerated in the entry manifest (code-split per route — admin/checkout pages never load on the storefront).

## 3. Critical path (head order, as served)

1. `init.js` — **synchronous classic script** (404 B, render-blocking, negligible; `defer` candidate)
2. `type="module"` entry `/assets/index-BUknxoGu.js` (deferred by nature)
3. 4× `modulepreload` (vendor-react/utils/router/query)
4. 1× stylesheet `index-Bs4ADUnM.css` (render-blocking, 29 KB br)
5. 4× font `<link rel="preload" as="font" crossorigin>` (readex-pro ar-400/600/700 + latin-400; CSS references 6 — latin-600/700 not preloaded, correct prioritization)
6. `registerSW.js` (injected by vite-plugin-pwa)

**Hero without JS:** no catalog/hero content — only the inline-styled Arabic no-JS message «يتطلب الموقع تشغيل JavaScript» (2.5 s delayed reveal, system fonts, OS light/dark aware). Catalog is client-rendered only; crawlers get per-route SEO shells instead (§5). Design decision, not a regression.

## 4. Caching correctness

| Family | Live `Cache-Control` | Verdict |
|---|---|---|
| `/assets/*` (hashed) | `public, max-age=31536000, immutable` + weak etag | ✅ matches app.ts:1441-1446 |
| Unhashed public (favicon/init/manifest/og.jpg/logo) | `public, max-age=3600` | ✅ app.ts:1453 |
| `/products/*.webp` art | `public, max-age=2592000, stale-while-revalidate=86400` | ✅ app.ts:1480 |
| HTML shell | `no-cache, no-store, must-revalidate` + etag + last-modified | ✅ deliberate deploy freshness |
| `sw.js`, `registerSW.js` | `no-store` | ✅ correct for SW updates |
| `/api/products` | `public, max-age=0, s-maxage=60, stale-while-revalidate=300` | ✅ |
| `/api/products/by-slug/:bad` 404 | `s-maxage=60` (cached 404, anti-DoS by design app.ts:1107) | ✅ |
| `/api/products/stats` | `s-maxage=60` | ✅ |
| `/sitemap.xml` / `/robots.txt` | `60+SWR300` / `300+SWR600` | ✅ |
| `/api/nonexistent` (generic API 404) | **none** | ⚠️ Finding 4 |

## 5. SEO surfaces

- **sitemap.xml** 200, **56 URLs, all `https://subnation.ly`** (1 home + 7 categories + 45 products + support + terms + flash-sales); `max-age=60,SWR=300`. 54 lastmods, all inside one 20-second window `2026-09-20T20:14:59.099Z → 20:15:19.151Z` (~450 ms apart — a bulk import stamp, not per-item content recency; Finding 7). support/terms carry no lastmod (static pages — fine).
- **robots.txt** 200: sane allow/disallow set (login/register/cart/checkout/wallet/orders/admin/api disallowed), `Crawl-delay: 1`, `Sitemap: https://subnation.ly/sitemap.xml` (apex — consistent).
- **og:image** `https://subnation.ly/opengraph.jpg` → 200 `image/jpeg` 39,597 B; static `og:image:width/height` = **1280×720 = the real file size** (R120-B3 fix live).
- **favicon.svg** 200 `image/svg+xml`; **manifest.json** 200 complete (Arabic name/description, `dir: rtl`, icons 96/192/512 + maskable, 2 screenshots, 2 shortcuts — all referenced assets probed 200 `image/png`); **apple-touch-icon** → `pwa-192x192.png` 200 `image/png`.
- **Canonical signals:** static `<link rel="canonical" href="https://subnation.ly/">` on the homepage; `/category/vpn` serves an SEO-enriched shell (canonical `https://subnation.ly/category/vpn`, Arabic title «اشتراكات VPN في ليبيا — ExpressVPN و CyberGhost و IPVanish»); unknown top-level routes get `noindex,follow` + canonical stripped; dead product slugs get **real 404**.

## 6. Error UX

| URL | Status | Body | Verdict |
|---|---|---|---|
| `/nonexistent-page` | 200 (SPA shell) | `robots: noindex,follow`, canonical stripped | ✅ soft-200 by design (SPA must boot to render the 404 UI) + noindex guard vs soft-404 crawl space (app.ts:1431-1436) |
| `/product/nonexistent-slug` | **404** (HTML shell) | SPA shell, canonical stripped | ✅ real 404 for dead slugs (app.ts:1388-1390) — R120-era fix live |
| `/api/nonexistent` | 404 JSON | `{"error":"المسار غير موجود","code":"NOT_FOUND"}` | ✅ API not swallowed by SPA |
| `/api/products/by-slug/nonexistent` | 404 JSON | `{"error":"المنتج غير موجود","code":"NOT_FOUND"}` + `s-maxage=60` | ✅ Arabic, product-specific, cached |

## 7. Timing (TTFB ×3, from probe sandbox → Contabo origin)

| Target | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| `https://subnation.ly/` | 0.802 s | 0.592 s | 0.594 s |
| `/api/products?limit=1` | 1.714 s | 0.850 s | 0.790 s (run 1 = s-maxage expired + DB roundtrip) |
| `/assets/index-Bs4ADUnM.css` (immutable) | 0.600 s | 0.765 s | 0.778 s |
| `https://www.subnation.ly/` (301) | 0.786 s | 0.754 s | 0.580 s |

Full totals: HTML 0.77–1.03 s; nothing exceeded 2.3 s all round. Static immutable assets pay the same origin RTT as HTML (no edge cache — Finding 5).

## 8. Protocol / security UX-adjacent

- **HTTP/2** ✅ (all h2 responses); **HTTP/3 VERIFIED WORKING** — `curl --http3-only` → `200 ver=3`, advertised via `alt-svc: h3=":443"; ma=2592000`.
- **HSTS** `max-age=63072000; includeSubDomains; preload` ✅.
- **CSP present** (full policy: `script-src 'self'` + Google origins, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'self'`) + nosniff, XFO SAMEORIGIN, COOP, CORP, Referrer-Policy, Permissions-Policy, `x-request-id` correlation. No `Server` header leak.
- API rate-limit headers live: `ratelimit: "600-in-1min"; r=599; t=60` on `/api/products`.

## 9. Assets sanity — ALL PASS

Every HTML-referenced asset returned **200 with correct content-type**: 7 JS (`text/javascript`), 1 CSS (`text/css`), 4 woff2 (`font/woff2`), favicon.svg, manifest.json, apple-touch-icon png, init.js, registerSW.js, sw.js; plus og:image (`image/jpeg`), a product image straight from the `/api/products` response (`/products/lifetime-cloud-storage.webp` → 200 `image/webp`), netflix.webp, pwa-96/192/512, both PWA screenshots, subnation-logo.png. Zero 404s/mis-typed assets on the entire storefront surface probed.

## 10. Trailing-slash & case (informational)

- `/category/vpn` and `/category/vpn/` → both 200, identical etag (`2c7a-…`); same for `/support` vs `/support/`. No normalization redirect; runtime canonical points at the no-slash form — mitigated duplicate surface (Finding 6).
- `/CATEGORY/VPN` → 200 **noindex unknown-route shell** (case-sensitive router falls to the noindex family — sane).

## 11. Served HTML vs repo expectations (@ c736d13)

- Served HTML is **structurally identical** to `frontend/index.html` modulo expected build-time injections: Vite hashed entry + 4 modulepreloads + stylesheet + 4 font preloads + `registerSW.js` (vite-plugin-pwa) + `seoHeadInject`'s empty `google-site-verification` meta. Every static comment/section matches byte-for-byte.
- The stale `frontend/dist/` (R117-V2 build) differs from served only by the **R120-B3 source changes now in the repo** (og dims 1200×630→1280×720, new default description, new og:description, vendor-icons chunk consolidated away) → **the live deploy is a fresh build of the current repo source. Nothing served that the repo doesn't expect; nothing expected missing.**
- `init.js` served is **byte-identical** to `frontend/public/init.js` (404 B).
- All live SPA-shell behaviors (product-slug real 404, unknown-route `noindex,follow`, category parity SEO shells, JSON API 404) match `backend/src/app.ts:930-1436` and its tests (`spa-shell-rewrite`, `spa-shell-category-parity`, `spa-shell-comment-guard`) at c736d13.

---

## Findings

**1. [P1 — carryover ops, user-visible] Only 1 of 45 products is purchasable; exactly 1 unit of stock live.**
Evidence: `GET /api/products/stats` → `{"total_products":45,"available_products":1,"total_units":4,"has_flash_sale":true}`; catalog sweep: only `lifetime-cloud-storage` `is_available=true, stock_count=1` (4 total units include archived-test inventory per R117). A real user browsing today sees 44/45 products unavailable — the store is still effectively browse-only (R117-A4 P1 only marginally improved: 0→1 sellable).
Fix: operator runs `docs/operations/FINAL_INVENTORY_LOADING.md` to load sellable stock. Effort: **ops hours (no code)**.

**2. [P3] Apex http→https redirect is 302, not 301.**
Evidence: `http://subnation.ly` → `HTTP/1.1 302 Found, Location: https://subnation.ly/` (deep paths too), while `http://www.subnation.ly` correctly 301s host+scheme in one hop. 302 is not cached by browsers/crawlers — every plain-http hit re-pays the roundtrip; also the matrix's documented expectation is 301.
Fix: set the scheme redirect to permanent in the Traefik/Coolify entrypoint rule for the apex (mirror the www rule). Effort: **minutes (proxy config)**.

**3. [P3] Origin re-compresses already-compressed binaries (woff2/webp/png/jpg) — fonts transfer larger than raw.**
Evidence: the 4 preloaded fonts: gzip-transferred 44,960 B vs 44,864 B raw (**net +96 B**, plus wasted CPU per response); `pwa-192x192.png` +25 B over raw; screenshots ~0.1% "gain". Brotli/gzip on woff2 and webp can never help meaningfully.
Fix: exclude `font/woff2`, `image/webp`, `image/png`, `image/jpeg` (or `/\.(woff2|webp|png|jpe?g)$/`) from the compression filter (express `compression({filter})` or the Traefik middleware). Effort: **small, one config touch + redeploy**.

**4. [P3] Generic API 404 has no `Cache-Control` while the by-slug 404 carries `s-maxage=60`.**
Evidence: `/api/nonexistent` → 404 with empty cache-control; `/api/products/by-slug/…` → 404 with `public, max-age=0, s-maxage=60, SWR=300`. Same family-inconsistency class as R117's `/healthz` nit (since fixed there).
Fix: one `res.set('Cache-Control', …)` on the API-404 fallback (app.ts:~932). Effort: **trivial**.

**5. [P3 — operator decision] No edge/CDN caching in the path: every asset (incl. 1-year-immutable ones) pays full origin RTT.**
Evidence: immutable CSS TTFB 0.60–0.78 s; all responses lack `cf-*` headers (Cloudflare DNS-only; origin Contabo). The `s-maxage=60`/SWR hints on APIs and sitemap are honored only by the origin's own single-flight cache, never an edge. With the www 301 now enforced at the proxy and the in-app redirect gone (the two causes of the R116 Cloudflare loop), enabling the Cloudflare proxy (orange cloud) is now materially safer and would cut ~100–300 ms per cold asset for far users.
Fix: operator evaluates re-enabling CF proxy for static paths (`/assets/*`, `/products/*`) at minimum. Effort: **config + careful staged rollout (documented risk history)**.

**6. [P3-informational] No trailing-slash normalization.**
Evidence: `/category/vpn/` and `/support/` serve 200 with the same etag as the canonical no-slash form. Runtime canonical + per-route shells mitigate duplicate-content risk; crawlers see the no-slash canonical.
Fix (optional): 301 slash-stripping rule at the proxy. Effort: **minutes, low priority**.

**7. [P3-informational] Sitemap `lastmod` is a synthetic bulk-import stamp.**
Evidence: all 54 lastmod values fall inside one 20-second window (2026-09-20T20:14:59.099Z→20:15:19.151Z, ~450 ms apart) — the SEO-products import run, not per-item content recency. Harmless today, but it tells crawlers "everything changed" in one burst.
Fix: none required; if product `updated_at` is real, prefer it. Effort: **informational**.

**8. [P3-informational] `init.js` is a synchronous classic script in `<head>`; no-JS baseline is message-only (no hero/catalog content).**
Evidence: head order §3; no-JS body = «يتطلب الموقع تشغيل JavaScript» fallback only. 404 B blocking is negligible; `defer` is safe if init ordering allows. Catalog-invisible-without-JS is the accepted SPA tradeoff, mitigated for crawlers by per-route SEO shells + noindex/404 guards.
Fix: optional `defer` on init.js. Effort: **trivial, cosmetic**.

## Verified-OK (no action)

- **www→apex 301 enforced at proxy, path-preserving, single hop** — R117-A4 P2-2 RESOLVED live.
- `/api/healthz/summary` → `{"status":"ok"}` — R117-A4 P2-1 (permanently degraded) RESOLVED.
- Real 404 for dead product slugs + `noindex,follow` shells for unknown routes + SEO-enriched category shells — R120/R122-era fixes live and matching repo code/tests.
- Complete security-header set (HSTS preload, full CSP, COOP/CORP, XFO, nosniff, Permissions-Policy) with zero gaps vs helmet intent.
- HTTP/2 + HTTP/3 both verified serving; `alt-svc` correct.
- Brotli on all text assets (HTML 61% reduction, entry JS 70%, CSS 89%); correct negotiation.
- Cache-control matrix exactly matches app.ts policy per route family; `sw.js`/`registerSW.js` correctly `no-store`.
- Sitemap 56 URLs / robots directives all-apex consistent; og:image dimensions honest (1280×720); PWA manifest complete and every referenced icon/screenshot 200.
- Served HTML == repo source @ c736d13 built expectations (fresh deploy, nothing extra/missing); `init.js` byte-identical.
- API error UX: Arabic JSON 404s, API never swallowed by SPA fallback, rate-limit headers present.

## Verdict

The production site is serving a **fresh, healthy build of the current repo**: every storefront asset loads, redirects now consolidate to the apex with one-hop 301s (www), the SEO surface is coherent and all-apex, error UX matches the code's documented design, and protocol/security headers are complete with working HTTP/3. The remaining gaps are polish (302 scheme redirect, binary re-compression, one missing 404 cache header) plus one operator action that dwarfs them: **the catalog still cannot sell — 44 of 45 products have no stock.**

**Priority counts: P0: 0 · P1: 1 · P2: 0 · P3: 7** (2 informational)
