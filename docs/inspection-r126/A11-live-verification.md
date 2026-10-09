# R126-A11 — Live Production Deep Verification (guest-level)

**Agent:** R126-A11 · **Date:** 2026-10-09 (UTC) · **Repo:** HEAD `186b131` · **Target:** `https://subnation.ly` (live)
**Scope enforced:** guest GETs + page navigations only — no logins, no OTP, no account creation, no mutations, ≤3 requests per timing endpoint, repo read-only.
**Origin:** DNS-only Cloudflare (no `cf-ray` on any response) → Contabo VM `vmi3624102.contaboserver.net` (`169.58.100.161`, apex + www) → Traefik → Express (helmet) + Neon. No CDN proxy layer.

---

## 1. Guest E2E suite vs live — **38 / 40 passed** (2 failed, deterministic)

`cd frontend && E2E_ENABLED=1 E2E_BASE_URL=https://subnation.ly npx playwright test --reporter=line` — 3.3 min, 10 spec files × 2 projects (desktop-chromium, mobile-390), config retries=2 exhausted on both failures.

| spec file | tests | desktop-chromium | mobile-390 |
|---|---|---|---|
| api-contracts.spec.ts | 4 | ✅ 4/4 | ✅ 4/4 |
| auth-gates.spec.ts | 3 | ✅ 3/3 | ✅ 3/3 |
| cart-gate.spec.ts | 1 | ✅ | ✅ |
| category.spec.ts | 1 | ✅ | ✅ |
| **home.spec.ts** | 1 | ❌ | ❌ |
| login-page.spec.ts | 1 | ✅ | ✅ |
| mobile-390.spec.ts | 3 | ✅ 3/3 | ✅ 3/3 |
| product-detail.spec.ts | 1 | ✅ | ✅ |
| search-arabic.spec.ts | 2 | ✅ 2/2 | ✅ 2/2 |
| seo.spec.ts | 3 | ✅ 3/3 | ✅ 3/3 |

**Failure (both projects, identical, 2 retries each — NOT environmental):**

```
home.spec.ts:17 — expect(errors).toHaveLength(0)
Received: ["Executing inline script violates the following Content Security
Policy directive 'script-src 'self' https://apis.google.com … googletagmanager.com'.
Either the 'unsafe-inline' keyword, a hash
('sha256-+YCzmCYTg6oS+BtGA+p9l1aYJ5QJpVCc7k1MoRhjTbw='), or a nonce is required."]
```

The product grid itself rendered (the `toBeVisible` assertion passed; only the console-error contract failed). Root cause chain in §8, issue **A11-F1 (P1)**. This is the first live e2e run against the post-`186b131` build (image `last-modified: Fri, 09 Oct 2026 05:36:21 GMT`): R125's 40/40 predates the deploy of its own admin-preload-gate fix.

---

## 2. Perf timings — TTFB medians (3 runs each, curl, from this sandbox)

Runs at ~08:51Z, immediately after the 3.3-min e2e suite → **all warm** (no Neon cold-start outliers; nothing exceeded 1.26 s). Run encodings: r1 identity / r2 gzip / r3 br.

| endpoint | r1 | r2 | r3 | **median TTFB** | size id / gz / br | cache-control |
|---|---|---|---|---|---|---|
| `/` | 0.824 | 0.812 | 0.674 | **0.812 s** | 11574 / 4623 / 4560 B | `no-cache, no-store, must-revalidate` |
| `/products` | 0.713 | 0.806 | 0.597 | **0.713 s** ⚠ 301 | 158 B redirect | — |
| `/products/` (real 200) | 0.612 | 0.808 | 0.762 | **0.762 s** | 11508 / 4613 / 4558 B | `no-cache, no-store, must-revalidate` |
| `/product/netflix-premium` | 1.019 | 0.630 | 0.871 | **0.871 s** | 11461 / 4639 / 4583 B | `no-cache, no-store, must-revalidate` |
| `/category/streaming` | 0.873 | 0.651 | 0.657 | **0.657 s** | 11574 / 4657 / 4588 B | `no-cache, no-store, must-revalidate` |
| `/api/healthz` | 0.811 | 0.799 | 0.822 | **0.811 s** | 15 B | `public, max-age=5` |
| `/api/auth/providers` | 1.257 | 0.948 | 0.741 | **0.948 s** | 473 B (uncompressed, <1 KB) | `public, max-age=0, s-maxage=60, stale-while-revalidate=300` |
| `/api/products?search=نتفليكس` | 1.228 | 1.012 | 0.891 | **1.012 s** | 1401 / 628 / 611 B | `public, max-age=0, s-maxage=60, stale-while-revalidate=300` |

**Decomposition** (single diagnostic request to a static asset): `dns 8 ms + tcp 254 ms + tls 295 ms ≈ 560 ms` fixed handshake from this sandbox → origin think-time ≈ **100–450 ms** across endpoints. A warm-connection browser probe measured home TTFB **201 ms**, DCL 1.58 s, network-idle +2.27 s (390 px mobile viewport). The sandbox↔Contabo RTT (~260 ms) dominates the curl numbers; users near the origin will see proportionally less.

**Compression:** gzip and br both live on every text surface (HTML, CSS, JS, JSON, XML). `/api/products` (catalog) verified separately: `cache-control: public, max-age=0, s-maxage=60, stale-while-revalidate=300`, br-encoded, plus live rate-limit headers (`ratelimit-policy: "600-in-1min"`). Search is the slowest median (1.0 s) — by design (B6-02: `?search=` is never in-process cached; live ILIKE). Cold-vs-warm within each triple: no monotonic first-run penalty → in-process caches (30 s catalog TTL) and Neon were already warm from the e2e suite.

---

## 3. SEO truth (live)

### robots.txt — ✅ correct
200, `text/plain`, `public, max-age=300, stale-while-revalidate=600`. Advertises `Sitemap: https://subnation.ly/sitemap.xml`. Disallows: `/login /register /forgot-password /onboarding /auth/ /cart /checkout /wallet /orders /loyalty /referrals /profile /admin /status /api/`. Allows `/`, `/product/`, `/category/`, `/support`, `/terms`. `Crawl-delay: 1`.

### sitemap.xml — ✅ valid, 56 URLs
`application/xml`, `public, max-age=60, swr=300`. Parsed as **valid XML** (minidom). 56 URLs = 1 home + 7 categories + 45 products + `/support` + `/terms` + `/flash-sales` (matches the 45-row live catalog exactly). `hreflang` via `xhtml:link` on every URL: `ar` + `x-default` (112 alternates total). **lastmod:** every URL stamped `2026-09-20T20:14:59–20:15:19Z` (a 20-second bulk-import window, ~19 days old) — no future dates, but it does not track real per-product updates (carryover of R125 P3, issue A11-F5). `/products` (catalog page) is not listed (only home is; acceptable since home *is* the catalog grid — noted under A11-F6).

### SPA shell rewriter (R122 system) — ✅ **product meta ships in RAW HTML**
view-source of `/product/netflix-premium` (fetched with plain curl, no JS):

```html
<title data-rh="true">Netflix — اشتراك أصلي بالدينار الليبي | SubNation</title>
<link data-rh="true" rel="canonical" href="https://subnation.ly/product/netflix-premium" />
<meta data-rh="true" name="description" content="اشتراك Netflix بمحتوى غير محدود بجودة 4K — باقات من شهر إلى سنة كاملة بأسعار منافسة." />
<meta data-rh="true" property="og:title" content="Netflix — اشتراك أصلي بالدينار الليبي | SubNation" />
<meta data-rh="true" property="og:description" content="اشتراك Netflix بمحتوى غير محدود بجودة 4K — باقات من شهر إلى سنة كاملة بأسعار منافسة." />
<meta data-rh="true" name="robots" content="index,follow" />
```

**Title uniqueness spot-check (3 products, raw HTML):** `Netflix — اشتراك أصلي بالدينار الليبي | SubNation` · `Spotify Premium — …` · `Disney+ — …` — all unique, all product-specific ✓.
**Canonical exactness:** `/` → `https://subnation.ly/`; `/category/streaming` → self; product → self — all apex, absolute, correct ✓. Trailing-slash variants (`/product/netflix-premium/`, `/category/streaming/`) serve 200 with canonical pointing at the **no-slash** URL ✓ (proper dedup).
**OG/Twitter on product page:** og:title, og:description (product-specific ✓), og:image = generic `https://subnation.ly/opengraph.jpg` 1280×720 (issue A11-F3), og:type `website`, `twitter:card summary_large_image`. No `og:url` tag.
**Unfurler share-card route — ✅ works:** with `User-Agent: WhatsApp/2.23.20.0`, `/product/netflix-premium` returns a dedicated card with `og:image: https://subnation.ly/products/netflix.webp` (per-product art) — WhatsApp/Facebook/Telegram shares get real product cards.
**hreflang in page HTML:** absent (sitemap-only mechanism on this single-locale site) — consistency note, no action needed.
**404/soft-404 SEO:** unknown paths (`/this-page-does-not-exist-xyz`, mixed-case `/Product/Netflix-Premium`, `/CATEGORY/STREAMING`) → 200 shell stamped `noindex,follow`, **no canonical** ✓; **dead product slug `/product/does-not-exist-xyz` → real HTTP 404** ✓ (excellent — no soft-404 crawl space on product URLs); `/api/products/999999` → HTTP 404 JSON `{"error":"المنتج غير موجود","code":"NOT_FOUND"}` ✓.

---

## 4. Redirect map (live, 16 probes)

| probe | result | assessment |
|---|---|---|
| `http://subnation.ly/` | **302** → `https://subnation.ly/` | ⚠ known-open ops item, reconfirmed (A11-F7). Response carries only `Location/Date/Content-Length` (no helmet/CSP/x-request-id) → **terminates at the Traefik entrypoint, never reaches Express**. Path preserved (`/api/healthz` → `…/api/healthz`). |
| `http://www.subnation.ly/` | 301 → `https://subnation.ly/` | ✓ |
| `https://www.subnation.ly/` | **301** → apex ✓ | ✓ re-verified; also edge-level (same bare-header shape). SAN covers www on the cert. |
| `https://subnation.ly/products` | **301 → `/products/`** | ⚠ A11-F2: `express.static` directory redirect — `public/products/` (the image dir) exists in `dist`, so static middleware 301s the no-slash catalog URL. Direct/external hits pay +1 RTT (~0.6–0.8 s from far regions); `http://…/products` = 302+301 double hop. No internal links and no sitemap entry use it. |
| `/product/netflix-premium/` | 200 (no redirect), canonical → no-slash | ✓ |
| `/category/streaming/`, `/login/` | 200 direct | ✓ (no slash-normalization wars; canonical consolidates) |
| `/index.html` | 200, `index,follow`, canonical `https://subnation.ly/` | P3: consolidates, but a 301 to `/` would be cleaner (A11-F6) |
| `/INDEX.HTML` | 200 `noindex,follow` (fell through to SPA shell) | ✓ |
| mixed-case `/Product/Netflix-Premium`, `/CATEGORY/STREAMING` | 200 `noindex,follow`, no canonical | ✓ no duplicate-content leak |
| `/not-a-real-page` | 200 shell `noindex,follow` + SPA Arabic 404 UI | ✓ |
| `/product/dead-slug` | **HTTP 404** | ✓ |
| `/api/no-such-endpoint` | 404 JSON `{"error":"المسار غير موجود","code":"NOT_FOUND"}`, `nosniff` | ✓ |
| `/api/products/999999` | 404 JSON (Arabic) | ✓ |
| `/admin` (unauth GET) | 200 `noindex,follow` shell (client login) | ✓ |
| `/api/admin`, `/api/admin/session` (unauth) | **401** JSON | ✓ |
| `/wallet /orders /loyalty` (e2e auth-gates) | <500 + client redirect to `/login` | ✓ |

---

## 5. Headers matrix

Security headers (CSP, HSTS `max-age=63072000; includeSubDomains; preload`, COOP `same-origin-allow-popups`, CORP `same-origin`, XCTO `nosniff`, XFO `SAMEORIGIN`, `referrer-policy: strict-origin-when-cross-origin`, permissions-policy, origin-agent-cluster, x-dns-prefetch-control, x-download-options, x-permitted-cross-domain-policies) are present and **identical on every surface family** — HTML shell, product page, `/api/healthz`, CSS/JS/manifest/sw/images. No `server` header, no `set-cookie` anywhere on the guest surface ✓.

| family | cache-control (live) | verdict |
|---|---|---|
| HTML shell (/, /products/, product, category, 404s) | `no-cache, no-store, must-revalidate` | ✓ required for the per-route shell rewrites |
| `/assets/*` (hashed) | `public, max-age=31536000, immutable` | ✓ |
| `sw.js`, `registerSW.js`, `*.html`, `robots.txt` | `no-cache, no-store, must-revalidate` | ✓ SW-update correctness |
| product art `/products/*.webp`, `pwa-*.png`, `workbox-*.js` | `public, max-age=2592000, stale-while-revalidate=86400` | ✓ matches SW CacheFirst window |
| `manifest.json`, `init.js`, `favicon.svg` | `public, max-age=3600` | ✓ |
| `/api/products` (catalog) | `public, max-age=0, s-maxage=60, stale-while-revalidate=300` | ✓ the 60 s catalog family |
| `/api/auth/providers`, search | `public, max-age=0, s-maxage=60, stale-while-revalidate=300` | ✓ (public provider list, not a secret surface) |
| `/api/healthz` | `public, max-age=5` | ✓ |
| CSP `script-src` | `'self' + Google/Firebase/recaptcha hosts`, **no `unsafe-inline`** | ⚠ collides with the R125 inline gate script (A11-F1); `style-src 'unsafe-inline'`, `script-src-attr 'unsafe-inline'`, `object-src 'none'`, `frame-ancestors 'self'` |

Anomaly: **`/products/netflix.webp` is served gzip-encoded** — `identity 4300 B` vs `gzip 4325 B` (+25 B, pure CPU waste; the compression middleware doesn't filter already-compressed types) — A11-F4 (P3).

---

## 6. PWA live — ✅ healthy

- **manifest.json:** 200, valid JSON. `lang: "ar"`, **`dir: "rtl"`** ✓, `display: standalone`, `start_url "/"`, `scope "/"`, `id "/"`, theme `#dc1840`, background `#0a0a0a`; icons 96/192/512 `any` + 512 `maskable`; 2 screenshots (narrow 540×1080 + wide 1080×540) with Arabic labels; 2 Arabic shortcuts. `orientation: portrait-primary`.
- **Registration:** `<script id="vite-plugin-pwa:register-sw" src="/registerSW.js">` present in served HTML; `registerSW.js` registers `/sw.js` on window load ✓.
- **SW (2.3 KB workbox):** `precacheAndRoute` — 10 entries (index.html, manifest, CSS, 6 Readex Pro woff2, favicon.svg); `NavigationRoute → index.html` with denylist `/api/`, `/assets/` (offline shell for all navigations); **SWR** `/api/(products|flash-sale)` (60-entry… 32-entry LRU, 7 d); **CacheFirst** images (200 entries, 30 d) and same-origin JS.
- **Live registration probe (Chromium, mobile viewport):** SW active, scope `https://subnation.ly/`, `workbox-precache-v2-…` with 10 entries, controller = true.
- **Repeat-visit TTFB (SW-served):** visit 1 (no SW): TTFB 201 ms, transfer 4860 B; **visit 2: TTFB 2 ms, transferSize 0, decodedBodySize 11574 → served from Cache Storage** ✓; product-page navigation under SW: TTFB 59 ms. DCL drops 1584 → 485 ms.

---

## 7. Consistency + cert/TLS

- **Rendered DOM:** `<html lang="ar" dir="rtl">` ✓ both raw shell and hydrated DOM; `content-language` header absent (fine — `lang=ar` carries it).
- **Arabic fonts:** Readex Pro self-hosted, 6 woff2 subsets (3 Arabic + 3 Latin weights 400/600/700) `rel=preload` in shell; live CSS has **6× `font-display: swap`** ✓. Title/MetaTags upsert per-theme at runtime (`theme-color #dc1840` in raw + rendered).
- **Icons:** favicon.svg link ✓, apple-touch-icon `/pwa-192x192.png` ✓, manifest ✓.
- **404 page Arabic copy ✓:** heading `الصفحة غير موجودة`, body «يبدو أن هذه الصفحة لا وجود لها أو ربما تم نقلها. تأكد من الرابط أو عد إلى الرئيسية.» + `العودة للرئيسية` / `رجوع` buttons + quick links (المتجر، المحفظة، طلباتي، الدعم); robots `noindex,follow` ✓.
- **Offline fallback:** SW NavigationRoute serves the precached shell; the no-JS static fallback div («يتطلب الموقع تشغيل JavaScript») ships in the shell. (Offlining a page out of scope, per mandate.)
- **Cert/TLS:** Let's Encrypt (`CN=subnation.ly`, issuer `YR2`), SANs `subnation.ly` + `www.subnation.ly`; **valid Oct 2 2026 → Dec 31 2026** (83 d remaining). **TLS 1.3** (TLS_AES_128_GCM_SHA256), chain verifies (rc 0). **HTTP/2** live; **HTTP/3 live** (`alt-svc h3=":443"; ma=2592000`; curl `--http3-only` → `http_version=3`, TTFB 575 ms). **OCSP stapling: no response sent** — informational; LE is sunsetting OCSP in favor of CRLs. No AAAA record (IPv6 absent — informational).

---

## 8. Issues (all with fix sketches)

| # | severity | finding | evidence | fix sketch |
|---|---|---|---|---|
| **A11-F1** | **P1** | **CSP blocks the R125 admin-gate inline modulepreload script.** `vite.config.ts:325` emits `<script>if(!location.pathname.startsWith("/admin")){…modulepreload home-BYjapJsD.js…}</script>` as the first head tag; helmet's `script-src` (app.ts:172) has no `unsafe-inline`/nonce/hash → the script is **blocked on 100% of storefront boots**. Consequences: (a) 2/40 live e2e failures (the "no console errors" contract); (b) console CSP error on every guest visit incl. SW-served navigations; (c) the R125 fix is fully inert — **nobody** gets the home-chunk preload now (a small perf regression vs the pre-R125 unconditional `<link>`, which worked). Deployed in the 186b131 image (`last-modified 2026-10-09 05:36`); R125's 40/40 ran against the older build. | Playwright error + raw HTML line 4 + hash verified: sha256 of the live script = `+YCzmCYTg6oS+BtGA+p9l1aYJ5QJpVCc7k1MoRhjTbw=` (byte-exact match with the CSP-reported hash). | Restore the static `<link rel="modulepreload">` (CSP-clean) and move the admin gate into `init.js` (external, `'self'`, runs before parser reaches later head links): `if (location.pathname.startsWith("/admin")) document.querySelector("link[rel=modulepreload][href*='/home-']")?.remove()` — exactly R125-A5's original sketch. Do **not** hash-pin in helmet: the hash changes with every `home-*.js` content-hash rebuild and would silently re-break. Effort S. |
| A11-F2 | P3 | `/products` → 301 → `/products/` extra hop: `express.static` sees the physical `dist/products/` (product-art dir) and directory-redirects the catalog URL. | `curl /products` → `location: /products/`; timing row §2. | `express.static(frontendDist, { redirect: false, … })` (app.ts:1460) — miss falls through to the SPA fallback which 200s the route directly; also consider listing `/products` in the sitemap once hopless. Effort S. |
| A11-F3 | P3 | Product shell `og:image` stays generic `/opengraph.jpg` for indexers/no-JS agents (unfurlers are covered by the dedicated share-card route — verified with WhatsApp UA). | §3 raw-HTML snippet. | Extend `applySpaShellMeta` with an `og:image` rewrite (and `og:image:width/height`) from `row.imageUrl` absolutized against `appOrigin()`; only rewrites the existing tag, same safety pattern as title/description. Effort S. |
| A11-F4 | P3 | Compression middleware gzip-encodes WebP art (4300 → 4325 B; wasted CPU on every image hit). | §5 anomaly. | Add a `content-type` filter (skip `image/*`, `application/zip`, video) to the compression middleware options. Effort XS. |
| A11-F5 | P3 (carryover R125) | Sitemap `lastmod` is a bulk-import stamp (all 56 URLs within a 20-second window on 2026-09-20); does not reflect per-product updates since. | §3. | Emit per-product `updatedAt` in `routes/seo.ts` sitemap generation instead of the import-time constant. Effort S. |
| A11-F6 | P3 | `/index.html` serves 200 (canonical `/` consolidates) — a 301 to `/` would be cleaner; `/products` absent from sitemap (nothing links it). | §4. | Static-route special-case 301 `/index.html → /`; revisit sitemap inclusion together with A11-F2. Effort XS. |
| A11-F7 | P3 (carryover, ops) | `http→https` is **302** (Traefik entrypoint; response is bare — no helmet headers → terminates before Express). SEO-consensus prefers 301. | §4 first row. | Traefik/Coolify entrypoint redirect middleware `permanent: true` (ops lane; same bucket as GSC token + «تجربة» flash-sale cleanup). |
| — | info | No OCSP stapling (LE → CRL direction); no IPv6 (no AAAA); Cloudflare DNS-only (no CDN — origin RTT bounds far-user TTFB); `og:type=website` on product pages; hreflang sitemap-only. | §7. | No action required this round; IPv6 + (optional) Cloudflare proxy are ops-lane enhancements. |

**Positives verified live (no action):** dead product slugs → real HTTP 404 (no soft-404 space) · unknown/mixed-case paths → `noindex,follow` no-canonical shells · trailing-slash variants consolidated by exact canonicals · per-product raw-HTML title/description/OG (R122 system live) · unfurler share-card route with per-product art · rate-limit headers on catalog API (`600-in-1min`) · `no-store` shell + immutable hashed assets + no-cache SW/robots · zero cookies on the guest surface · full security-header set on every family · SW repeat-visit TTFB 2 ms · manifest RTL-valid · TLS 1.3 + h2 + h3, cert valid to Dec 31 2026 covering www · Arabic 404/offline copy · auth gates redirect to login with zero 5xx.

---

## 9. Verdict

**ISSUES-FOUND** — core guest storefront is functionally healthy (38/40; money-page honesty, search, cart-gate, auth-gates, SEO shells all pass), but the post-R125 deploy introduced one deterministic P1 (CSP-blocked inline preload gate: 2 e2e failures + console error on every boot + dead optimization) with a one-file, S-effort fix. Everything else is P3 polish or ops carryover. No P0. 

**Top 3 live issues:** (1) A11-F1 CSP vs inline gate script; (2) A11-F2 `/products` 301 double-hop; (3) A11-F5/A11-F3 SEO freshness+share polish (stale sitemap lastmod; generic product og:image for non-unfurlers).
