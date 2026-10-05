# R117-A4 — Live Production Smoke Check (subnation.ly)

- **Agent:** R117-A4 (read-only research; only this file created)
- **Date:** 2026-10-05 (~12:48–13:05 UTC, per live `Date:` headers)
- **Repo state audited against:** `main` @ `f10bb9b` ("fix(backend): remove www→non-www redirect to break Cloudflare loop (R116)")
- **Method:** unauthenticated `curl` against https://subnation.ly + https://www.subnation.ly (HTTP/2), read-only SELECTs against the live Neon DB via the pooled probe URL. No repo files modified; no authenticated endpoint probed; no OTP/message dispatched (the WhatsApp probe stopped at body validation).
- **Live topology observed (differs from task brief — see #6):** both hostnames are `A` records to **169.58.100.161** (PTR `vmi3624162.contaboserver.net` — **Contabo VPS, not Oracle**), TLS is a **Let's Encrypt** cert (`CN=subnation.ly`, issuer `CN=YR2`) terminated at origin, and **no Cloudflare proxy headers appear on any response** (no `cf-ray`, no `server: cloudflare`, no `cf-cache-status`). Cloudflare is in **DNS-only (grey-cloud)** mode — no CDN cache, no CF WAF/TLS in the live path.

---

## 1. Endpoint table

| # | Endpoint | Status | Verdict |
|---|----------|--------|---------|
| 1 | `https://subnation.ly/` | `200`, 1.03s, 9748B, `text/html` | ✅ OK |
| 2 | `https://www.subnation.ly/` | `200`, 1.30s, 9748B — **byte-identical** to apex | ⚠️ OK-but (no redirect — see #3) |
| 3 | `http://subnation.ly/` | `302 → https://subnation.ly/` (scheme-only) | ✅ OK |
| 4 | `http://www.subnation.ly/` | `302 → https://www.subnation.ly/` (scheme-only, keeps www) | ⚠️ OK-but (#3) |
| 5 | `/assets/index-C8RwVHQ8.js` (main) | `200`, `text/javascript`, `cache-control: public, max-age=31536000, immutable`, `content-encoding: br` (91,669B raw → 27,418B br) | ✅ OK |
| 6 | `/assets/index-DZbgfWn0.css` | `200`, immutable 1y, `br` | ✅ OK |
| 7 | `/assets/readex-pro-arabic-600-normal-BZyEP9JP.woff2` | `200`, `font/woff2`, immutable 1y (preloads for 400/600/700 ar + 400 latin all present in HTML) | ✅ OK |
| 8 | `/opengraph.jpg` | `200`, `image/jpeg`, 39,597B, max-age=3600 | ✅ OK (og:image absolute URL in HTML) |
| 9 | `/favicon.svg`, `/init.js`, `/manifest.json`, `/pwa-192x192.png` | all `200`, correct content-types | ✅ OK |
| 10 | `/products/lifetime-cloud-storage.webp` (catalog art) | `200`, `image/webp`, `max-age=2592000, stale-while-revalidate=86400` | ✅ OK |
| 11 | `/api/healthz` | `200` `{"status":"ok"}` (0.79s) | ✅ OK |
| 12 | `/api/healthz/live` | `200` `{"status":"ok"}`, `cache-control: public, max-age=5` | ✅ OK |
| 13 | `/api/healthz/summary` | `200` **`{"status":"degraded"}`** — persistent across ≥5 cold aggregates | 🔴 **#2 (P2)** |
| 14 | `/api/healthz/ready` | `401` `{"error":"غير مصرح","code":"UNAUTHORIZED"}` | ✅ OK (admin-gated by design, `health.ts:779`) |
| 15 | `/api/products?limit=5` | `200` JSON array, products with webp images + variants (0.9–2.5s) | ✅ OK (but see #1 stock) |
| 16 | `/api/products?limit=100` | `200`, 45 products, all 7 categories | ✅ OK content / 🔴 #1 stock |
| 17 | `/api/products/stats` | `200` `{"total_products":45,"available_products":0,"total_units":3,...}` | 🔴 **#1 (P1)** |
| 18 | `/api/products/flash-sale` | `200` `{"flash_sale":null}` | ✅ OK |
| 19 | `/api/products/categories` | **route does not exist** (not in `routes/products.ts`: `/`, `/stats`, `/flash-sale`, `/by-slug/:slug`, `/:id`, `/:id/recommendations`) | ✅ OK-by-design (categories are SPA-side constants + `category` field on each product) |
| 20 | `/api/auth/probe` | `200`, **`cache-control: no-store`** ✓ + ratelimit headers (`600-in-1min`) | ✅ OK |
| 21 | `/api/products/999999` | `404` `{"error":"المنتج غير موجود","code":"NOT_FOUND"}` | ✅ OK |
| 22 | `/api/products/by-slug/nonexistent-slug-xyz` | `404` same shape | ✅ OK |
| 23 | `/api/some-random` | `404` `{"error":"المسار غير موجود","code":"NOT_FOUND"}` — API not swallowed by SPA fallback | ✅ OK |
| 24 | `/api/auth/whatsapp/start` (empty body, no auth) | no `Origin` → `403 FORBIDDEN` (CSRF gate); with `Origin: https://subnation.ly` → `400 {"error":"رقم الهاتف مطلوب","code":"INVALID_DATA"}` | ✅ OK — passes `isWhatsAppGatewayConfigured()` ⇒ **gateway IS configured** (an unset base URL would 503 `gateway_disabled` first, `auth-whatsapp.ts:53-59`) |
| 25 | `/sitemap.xml` | `200`, 56 `<loc>` URLs, **all `https://subnation.ly`** (apex), `cache-control: public, max-age=60, stale-while-revalidate=300` | ✅ OK / ⚠️ #3 |
| 26 | `/robots.txt` | `200`, sane allow/deny list, `Sitemap: https://subnation.ly/sitemap.xml` | ✅ OK |
| 27 | `/some-random-page` | `200` `text/html` SPA shell (client-side 404) | ✅ OK |
| 28 | `/product/nonexistent-slug` | `200` SPA shell | ✅ OK |
| 29 | `/category/vpn` | `200` SPA shell | ✅ OK |
| 30 | `https://www.subnation.ly/api/healthz`, `/sitemap.xml` | `200` both; sitemap still emits apex URLs | ✅ OK (consistent apex canon) |
| 31 | OpenWA gateway (legacy `https://openwa-gateway-7aaa.onrender.com/healthz`) | `503` Render **"Service Suspended"** page | ⚠️ #7 (stale docs; live gateway is Coolify-internal `http://openwa:2785` per docs, unreachable externally by design) |

**Security headers, live vs helmet intent (`backend/src/app.ts:158-275`) — all match:**

| Header | Live value | Intent | Verdict |
|---|---|---|---|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | same (app.ts:249-260) | ✅ |
| `X-Content-Type-Options` | `nosniff` | `xContentTypeOptions: true` | ✅ |
| `X-Frame-Options` / CSP `frame-ancestors` | `SAMEORIGIN` / `'self'` | same | ✅ |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | same | ✅ |
| CSP | full directive set incl. `connect-src https://subnation.ly https://www.subnation.ly` | matches app.ts:159-247 | ✅ |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), usb=(), payment=(self), midi=(), accelerometer=()` | app.ts:149-155 | ✅ |
| COOP / CORP / OAC | `same-origin-allow-popups` / `same-origin` / `?1` | app.ts:264-271 | ✅ |
| API cache-control | probe `no-store` ✓; products `public, max-age=0, s-maxage=60, stale-while-revalidate=300` ✓; summary `max-age=15` ✓ | route-level intent | ✅ (one nit → #8) |

**Frontend HTML baseline (both hostnames, byte-identical):** `<html lang="ar" dir="rtl">` ✓ · title `SubNation — سوق الاشتراكات الرقمية` ✓ · absolute `og:image https://subnation.ly/opengraph.jpg` + width/height + `twitter:card` ✓ · 5 font preloads ✓ · `google-site-verification` empty placeholder (GSC token unset) · static no-JS Arabic fallback div ✓ · no error markers ✓.

---

## 2. Numbered findings

### 1. 🔴 P1 — Storefront has ZERO sellable stock: all 45 active products are `is_available=false`, checkout is impossible for every product
**Evidence:**
- `GET /api/products?limit=100` → 45 products, `available=0`, `in_stock=0` (computed over live response).
- `GET /api/products/stats` → `{"total_products":45,"available_products":0,"total_units":3,"lowest_price":59.8,"has_flash_sale":false}`.
- Read-only DB: `inventory` has exactly **3 unsold units**, and their owners are *archived test rows*, not the live catalog:
  `unsold_unit_owners=[{"id":19,"slug":"test-product-playwright","is_active":false,"is_archived":true,"unsold":1},{"id":23,"slug":"sim-r94","is_active":false,"is_archived":true,"unsold":2}]`.
- Sample active product: `{"slug":"lifetime-cloud-storage","cat":"software","avail":false,"stock":0}`.

**Impact:** the site browses fine but cannot sell anything — every product page shows out-of-stock and checkout has nothing checkable. This is an operations gap (inventory loading runbook: `docs/operations/FINAL_INVENTORY_LOADING.md`), not a code defect — but it is the single biggest live business-continuity issue. 7 lifetime orders exist in `orders`, so the pipeline worked when stock was present.

### 2. 🔴 P2 — Public health status is persistently YELLOW: `/api/healthz/summary` → `{"status":"degraded"}` on every cold aggregate
**Evidence:** 5 probes over ~15 min (each > `CACHE_TTL_MS=15s` apart, so each recomputed): all `200 {"status":"degraded"}`. Cold aggregate ≈1.5–2.1s, warm ≈0.78s; aggregate timeout default is 8s (`health.ts:38`) — so this is a *computed* degraded, not the R3 wedge or a timeout snapshot.

**Candidate causes (cannot be distinguished without admin `GET /api/healthz/ready`, which correctly 401s):**
- **(a) Neon latency > 500ms on the cold `SELECT 1`** — `checkNeonWith` marks `status: latencyMs > 500 ? "degraded" : "ok"` (`health.ts:259`). Cold aggregate math: ~1.5–2.1s total − ~0.78s connection overhead ≈ 0.7–1.3s of aggregate, of which neon is the only mandatory I/O in the single-tier shape. (Reference: probe-host→Neon `SELECT 1` = 215ms warm / 1326ms connect.)
- **(b) `checkRiskPipeline` degraded in the DESIGNED no-Redis shape** — if `RISK_PIPELINE_ENABLED=true` while `REDIS_URL` is unset (the R108 designed single-instance production shape), the check folds `"degraded"` (`health.ts:433-441` "redis unavailable — risk-config cache cannot serve"). This is the same designed-shape-must-read-OK class that FH-A5 P2-3 (redis) and R110-E (worker/socket) already fixed for the other checks — the risk check never got the equivalent treatment.

**Impact:** the public `/status` page shows a permanent yellow indicator during otherwise normal operation — exactly the symptom R110-E was meant to eliminate. **Next action for operator:** hit `/api/healthz/ready` as admin once and read `checks.neon.latencyMs` vs `checks.risk_pipeline`.

### 3. 🟠 P2 — Canonical-host enforcement is now completely absent: no www↔apex redirect exists at ANY layer, contradicting the premise of `f10bb9b`
**Evidence:**
- `https://www.subnation.ly/` → `200` (not 301/307/308); `https://subnation.ly/` → `200`; bodies **byte-identical** (9748B). Following `-L` from either hostname: `redirects=0`.
- `http://` → `https://` 302s preserve the hostname (apex→apex, www→www) — no consolidation there either.
- The `f10bb9b` commit message/comment claims the external proxy ("Cloudflare/Traefik") already issues **non-www→www 307**, so the in-app www→apex 301 could be deleted. Live evidence: **no 307 exists** — sibling audit `merge-deploy-docs.md` #10 already showed no such rule in `CLOUDFLARE_FINAL_CUTOVER.md`; this smoke test confirms it behaviorally. The Cloudflare "loop" could not even exist at the edge in the current topology because Cloudflare is **DNS-only** (no `cf-ray`/`server: cloudflare`/`cf-cache-status` on any response; origin LE cert).
- Meanwhile every canonical signal points at the apex: sitemap (all 56 `<loc>` = `https://subnation.ly`), robots (`Sitemap: https://subnation.ly/sitemap.xml`), static `og:image`, `DEFAULT_ORIGIN` (`frontend/src/lib/seo-builders.ts:12`), runtime `<link rel=canonical>` (MetaTags prefers `VITE_APP_ORIGIN`/apex over `window.location.origin`).

**Impact:** the redirect loop is *truly broken* (nothing redirects at all), but at the cost of two fully-parallel live origins serving identical content with no 301/307 and no no-JS canonical. Google can index `www.subnation.ly` duplicates; apex-issued host-only cookies also fork sessions between hostnames (`lib/cookie-options.ts` host-only `SameSite=lax`). Recommendation: pick the apex as canonical (all SEO surfaces already do) and add a single www→apex 301 **at Traefik/Coolify** (where both host rules already exist), then restore/document it.

### 4. 🟡 P3 — Static (no-JS) HTML ships no `<link rel="canonical">` — the www duplicate has zero canonical signal for non-JS crawlers
**Evidence:** fetched root HTML head (both hostnames) contains title/og/description/theme-color but no canonical link; `MetaTags.tsx:150` upserts `canonical` only at runtime. JS-running crawlers on www do get canonical→apex (good), but unfurlers/no-JS crawlers see two identical 200s with no consolidation hint. Cheap fix: bake `<link rel="canonical" href="https://subnation.ly/">` into the static baseline (it already bakes the absolute og:image for exactly this reason — see the 110-F comment in index.html).

### 5. 🟡 P3 — Cloudflare edge benefits are entirely unexploited (DNS-only mode): no CDN caching, no TLS/WAF at edge
**Evidence:** zero `cf-cache-status` headers on immutable 1y assets or `s-maxage=60` API routes; direct HTTP/2 to the Contabo origin with a Let's Encrypt cert; both hostnames resolve to the same IP. The architecture docs describe Cloudflare DNS/**TLS** + edge (and `app.ts:1040-1043` even sets `s-maxage=300` expecting a "Cloudflare in front"). If DNS-only is a deliberate migration-period choice it should be recorded; if not, orange-clouding the zone would activate asset caching, HTTP/3-to-edge, and free WAF. (Observed `alt-svc: h3=":443"` is origin-side.)

### 6. 🟡 P3 — Topology drift: live origin is a Contabo VPS, not the Oracle host the migration docs describe
**Evidence:** `A` records for both hostnames → `169.58.100.161`, PTR `vmi3624162.contaboserver.net`; task brief and `docs/deployment/ORACLE_FINAL_SETUP.md` / `COOLIFY_ORACLE_MIGRATION.md` say Coolify on Oracle. Either the fleet's briefing/docs are stale or the site moved again. Worth reconciling in `PRODUCTION_ARCHITECTURE.md`/`FINAL_PRODUCTION_TOPOLOGY.md` so DR/backup runbooks point at the real host.

### 7. 🟡 P3 — `docs/WHATSAPP_OPERATIONS.md` still routes operators to the suspended Render gateway
**Evidence:** `GET https://openwa-gateway-7aaa.onrender.com/healthz` (no auth) → `503` HTML "This service has been suspended by its owner." The doc (lines 12/64-66) and its Render dashboard links are the post-migration operator entry points for WhatsApp incidents, yet the live gateway runs Coolify-internal (`WHATSAPP_OTP_BASE_URL=http://openwa:2785` per `COOLIFY_FINAL_SETUP.md:114` — unreachable externally, by design, so not probeable from this audit; the backend itself confirms it is configured, see endpoint table #24). The ops doc needs a Coolify-era rewrite (new gateway address, admin panel path, wake-behavior differences — no more Render free-tier cold starts).

### 8. 🟢 P3 (nit) — `/api/healthz` sends no `Cache-Control` while `/live` and `/summary` do
**Evidence:** headers of `/api/healthz`: etag present, no cache-control; `/api/healthz/live` → `public, max-age=5`, `/api/healthz/summary` → `public, max-age=15`. Harmless (Docker/Coolify probes every 30s don't cache), but a one-line `no-store`/`max-age` on the base probe would make the family consistent.

---

## 3. What is healthy (verified-OK summary)

1. **Both hostnames serve** the SPA over HTTP/2 + TLS 1.3, ~1.0–1.3s cold full load of the 9.7KB shell; brotli on JS/CSS; immutable 1-year caching on all hashed assets; correct content-types everywhere.
2. **Arabic RTL baseline intact:** `lang="ar" dir="rtl"`, Arabic title/description, theme-color, static no-JS Arabic fallback.
3. **SEO assets absolute and resolving:** `og:image https://subnation.ly/opengraph.jpg` (200, image/jpeg 39.6KB), favicon, manifest, PWA icons.
4. **API surface:** healthz/live ok; ready properly admin-gated (401); products list/detail/by-slug/404 shapes all correct with Arabic error copy; auth probe `no-store` + ratelimit headers; API 404s are JSON, not the SPA shell.
5. **Security headers: helmet intent vs reality — zero gaps.** HSTS 2y+preload, nosniff, SAMEORIGIN + `frame-ancestors 'self'`, strict referrer policy, full CSP (incl. both production hosts in connect-src), Permissions-Policy, COOP/CORP.
6. **Catalog content is R117-correct in the DB:** exactly **45 active products**, **45/45 `.webp`** `image_url` (r102 conversion held), and all five previously-hidden categories live: `software 7, vpn 4, ai-tools 2, seo-tools 2, education 2` (+ `streaming 17, music 11`) — matches the public API category counts and the 7 sitemap category routes.
7. **Sitemap/robots:** 200s, all-apex URLs, sane cache headers, correct disallow set; no www/apex split-brain *inside* the sitemap.
8. **SPA fallback:** unknown paths and bad product slugs return the shell (200 HTML); `/api/*` correctly excluded.
9. **WhatsApp OTP channel:** gateway configured (start passes the config gate), CSRF gate blocks Origin-less POSTs, structured error taxonomy reachable without leaking state; live gateway correctly not exposed to the public internet.

---

## 4. Overall verdict

**Production is UP and structurally healthy — SPA, API, DB, SEO routes, and every intended security header verify clean, and the R117 catalog state (45 active products, all-webp images, 5 restored categories) is live — but the store currently cannot sell anything (0 of 45 products in stock), the public health summary is persistently "degraded", and hostname canonicalization is now entirely absent (www and apex both 200, no redirect at any layer, f10bb9b's "proxy 307s non-www→www" premise is false in production).**

| Severity | Count | Items |
|---|---|---|
| P0 | 0 | — |
| P1 | 1 | #1 zero sellable stock |
| P2 | 2 | #2 healthz/summary permanently degraded; #3 no canonical-host redirect |
| P3 | 5 | #4 no static canonical; #5 Cloudflare DNS-only (no edge cache/TLS/WAF); #6 Contabo vs Oracle topology drift; #7 WHATSAPP_OPERATIONS.md → suspended Render gateway; #8 healthz cache-control nit |
