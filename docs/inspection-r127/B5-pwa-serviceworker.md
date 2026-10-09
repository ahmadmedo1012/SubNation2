# R127-B5 — PWA / Service-Worker / Offline Deep Audit

- **Agent:** R127-B5 (read-only auditor — no commits, no production mutation)
- **Tree audited:** `f53a886` (= origin/main = production https://subnation.ly, deployed 2026-10-09 ~14:17 GMT per `sw.js` `last-modified`)
- **Scope:** vite-plugin-pwa config, generated SW + registerSW, update flow after today's deploy, offline truth per route, no-JS fallback (R98-F7 lineage), manifest/install surfaces — plus read-only live probes.
- **Method:** static reads (`frontend/vite.config.ts`, `frontend/public/manifest.json`, `frontend/src/main.tsx`, `frontend/src/lib/lazy-with-retry.ts`, `frontend/index.html`, `frontend/dist/public/{sw.js,registerSW.js,index.html}`, `backend/src/app.ts`) + history sweep (R96/R98/R116/R117/R124/R125/R126 docs) + live GET/HEAD probes (URLs listed in §3). No SW was installed, no browser state mutated, GET/HEAD only.

---

## 0. Executive summary

**Update-flow verdict: SAFE — no version-skew window.** The SW stack (autoUpdate: `skipWaiting` + `clientsClaim` + `cleanupOutdatedCaches` + the workbox-internal stale-precache-entry purge, all verified byte-present in the **live** `sw.js`/workbox bundle) atomically swaps the shell; JS chunks are never precached and are content-hashed per release, so "new shell + old chunks" cannot be served from the SW. The only skew is an *old open document* requesting *dead* chunk URLs after the takeover — recovered by `lazyWithRetry`'s single reload (still effective even though dead `/assets/*.js` URLs soft-200 the SPA shell, because module MIME enforcement produces the same error signature). The takeover is user-visible: the Arabic "تحديث جديد متاح" reload toast is verifiably in the live entry chunk.

**Precache manifest count: 10 entries** (live `sw.js`, fetched 2026-10-09 14:39 GMT): `index.html`, `manifest.json`, 1 CSS, 6 woff2, `favicon.svg` — shell-only, zero JS, matches `vite.config.ts` exactly.

**Findings: 0 P0 · 0 P1 · 0 P2 · 4 P3** (F1 public root sourcemaps, F2 `/assets/*` soft-200 fallback, F3 `/sw.js` navigation captured by shell, F4 offline-div flash on slow first paint). All P3, all with fixes. The heavy PWA lifting is genuinely done and live — nothing in this audit blocks anything.

---

## 1. Config audit (what the tree says)

### 1.1 `frontend/vite.config.ts` — VitePWA block (lines 764-924)

| Aspect | Value | Verdict |
|---|---|---|
| `registerType` | `"autoUpdate"` (line 765) | skipWaiting+clientsClaim baked into generated sw.js (verified live) |
| `manifest` | `false` (line 770) — `public/manifest.json` is single source of truth | correct (no dual-webmanifest conflict) |
| `includeAssets` | `["favicon.svg"]` (line 777) | no glob overlap (R96-P3-2 fixed) |
| Precache (`globPatterns`, lines 891-904) | `index.html`, `manifest.json`, `assets/*.css`, `assets/*.woff2` — **shell only, no route chunks, no JS, no images** | diet intact (R3 §1.1 → R104 lineage) |
| `globIgnores` | `["**/*.js"]` (line 920) | JS never precached — release-atomic shell |
| `maximumFileSizeToCacheInBytes` | `384 * 1024` (line 913) | CSS 269,475 B admitted; every vendor chunk (≥1 MB) excluded |
| `navigateFallback` | `"index.html"` (line 921) | SPA offline shell |
| `navigateFallbackDenylist` | `/^\/api\//, /^\/assets\//` (line 922) | no API shadowing, no asset double-caching (see F3 for the residual) |
| Runtime rule 1 | `/api/(products|flash-sale)` → **StaleWhileRevalidate** `api-catalog-v1`, 32 entries / **7 d** (lines 815-836; 60s→7d was R96-F-7a) | offline catalog = last-known good |
| Runtime rule 2 | `destination === "image"` → **CacheFirst** `images-v1`, 200 / 30 d (lines 837-850) | biggest revisit byte win |
| Runtime rule 3 | same-origin `*.js` → **CacheFirst** `assets-js`, **160** / 30 d (lines 851-878; 40→160 was R124-A2-F2) | survives HTTP-cache eviction (R98-F7 rationale) |

### 1.2 Generated artifacts (`frontend/dist/public/`)

- `registerSW.js` (134 B): stock 3-liner — `if('serviceWorker' in navigator) {window.addEventListener('load', () => {navigator.serviceWorker.register('/sw.js', { scope: '/' })})}` — registration deferred to `window.load` (non-blocking, post-paint). Injected as `<script id="vite-plugin-pwa:register-sw" src="/registerSW.js">` last-in-head.
- `sw.js` (2,293 B local / 2,355 B live): `skipWaiting()` → `clientsClaim()` → `precacheAndRoute([…10 entries…])` → `cleanupOutdatedCaches()` → NavigationRoute (denylist) → 3 runtime routes. Identical structure local vs live (only the `index.html` precache revision differs + two `sourceMappingURL=sw.js.map` comments live — see F1).

### 1.3 Registration + update UX (`frontend/src/main.tsx`)

- `main.tsx:99-124` — the R96-F-7b update-honesty listener: `controllerchange` → (first-install suppressed via `sawController`) → **one** Arabic toast «تحديث جديد متاح / صدر تحديث للتطبيق — أعد التحميل للحصول على أحدث نسخة.» with a 10 s duration and an «إعادة التحميل» action calling `window.location.reload()`. Verified present in the **live** entry chunk (`https://subnation.ly/assets/index-BInNtHLA.js` — grep hits for `controllerchange` and the toast title).
- `main.tsx:41` — `document.getElementById("static-offline")?.remove();` — synchronous removal of the no-JS fallback at module evaluation (before the 2.5 s CSS reveal can fire).

### 1.4 Recovery net (`frontend/src/lib/lazy-with-retry.ts`)

All 40 routes are `lazyWithRetry` (R126-A5 §C.3). Matcher (lines 45-52) covers Vite Chrome/Firefox/Safari + Webpack variants; **one** reload per pathname per session (sessionStorage `sn:chunk-reload:<path>`, lines 79-89), then bubbles to ErrorBoundary.

### 1.5 Preload gate (R126's boot change — the update-critical delta)

`vite.config.ts:278-332`: the gate is now an **external content-addressed** classic script (`assets/preload-gate-<sha256[:8]>.js`, emitted line 383-387), injected first-in-head with `data-home-chunk`. Failure mode is benign: it only appends `<link rel="modulepreload">` hints inside a try/catch («a preload hint must never break (or console-noise) the boot»), so a failed/absent gate cannot block boot — the `type="module"` entry proceeds regardless.

---

## 2. Update-flow trace after today's deploy (the exact question)

Returning visitor holds yesterday's SW (R125-era: same workbox 7.4.1, same `workbox-precache-v2-https://subnation.ly` cache name, old `index.html` revision + old CSS entry, autoUpdate). Step by step:

1. **Detection.** Browser revalidates `/sw.js` (`cache-control: no-cache, no-store, must-revalidate` — live-verified header) → byte-diff (new precache manifest: new `index.html` revision `75dca1d2…`, new CSS/entry refs) → new SW installs.
2. **Install.** New SW precaches its 10 entries (~350 KiB) while the **old SW still controls** — every navigation in this window is served from the **old** precache (old shell + old inline/preload references) → internally consistent old release. No mixed shell is servable at any point: the shell is a single precached document and all chunk URLs are content-hashed per release.
3. **Activation.** `skipWaiting()` → immediate. `PrecacheController.activate()` (verified in the live workbox bundle: `activate(t){…const t=await self.caches.open(this.strategy.cacheName),e=await t.keys(),s=new Set(this.$.values()),n=[];for(const i of e)s.has(i.url)||(await t.delete(i),n.push(i.url))…}`) **purges every old precache entry from the same-named cache**; the separate `cleanupOutdatedCaches()` removes deprecated-name caches. Stale precache eviction is fully ON.
4. **Takeover.** `clientsClaim()` → open tabs' fetches now route through the new SW → `controllerchange` fires → the main.tsx toast offers a reload (user-visible; ignore = keep old UI until next full navigation, by design).
5. **The only skew window** — an old *document* (pre-takeover shell still running its old JS) doing a client-side navigation to a not-yet-runtime-cached old chunk URL: request → `assets-js` CacheFirst MISS → network → **200 text/html** (the SPA fallback for missing `/assets/*` — see F2) → browser refuses to execute a module with `text/html` MIME → "Failed to fetch dynamically imported module" → `lazyWithRetry` fires **one reload** → reload is a navigation → new SW's NavigationRoute serves the **new** precached shell → new entry/gate/chunks (immutable, fresh URLs). **Recovered in one reload — the soft-200 does not defeat the matcher** (MIME enforcement guarantees the same error signature).
6. **Reload edge (offline):** if the user accepts the reload while offline *before* any online visit to the new release, the new shell's new chunk URLs miss `assets-js` → module fetch fails → the static no-JS div reveals «يتطلب الموقع تشغيل JavaScript» (honest, self-contained). First *online* load then warms the new release.

**Verdict: SAFE.** No new-shell+old-chunks or old-shell+new-chunks document is constructible; the one real skew (old doc → dead URL) is covered by the existing one-reload recovery, and takeover is toast-visible.

*Documentation note (not a finding):* the local sandbox `dist/` entry chunk (`index-vaXosIzP.js`, home `CUBquM7i`) differs from the live Docker build's (`index-BInNtHLA.js`, home `DnDOfLXF`) — env-var/sourcemap baking (`sourcemap: "hidden"` under `SENTRY_AUTH_TOKEN`, vite.config.ts:978) changes the graph. Each build is internally coherent (live `sw.js` precache revision `75dca1d2…` is computed from the live `index.html`; all live-referenced chunks verified 200). Future auditors comparing local dist hashes to live should expect this.

---

## 3. Live verification (read-only; all fetched 2026-10-09 ~14:39 GMT)

| URL | Result |
|---|---|
| `https://subnation.ly/` | 200; `cache-control: no-cache, no-store, must-revalidate`; NEW shell confirmed: `preload-gate-UNflcRlC.js` external tag first-in-head, `index-BInNtHLA.js` entry, `registerSW.js`, static-offline div + reveal style present |
| `https://subnation.ly/sw.js` | 200; `no-cache, no-store, must-revalidate`; `last-modified: Fri, 09 Oct 2026 14:17:55 GMT` (= today's deploy); body = new build (new `index.html` precache revision `75dca1d2d8198eb61007ef757ae9c41d`); `skipWaiting`/`clientsClaim`/`cleanupOutdatedCaches`/NavigationRoute-denylist/3 runtime rules all byte-present |
| Precache count (live sw.js) | **10 entries**: `index.html`, `manifest.json`, `assets/index-BQKsKwhD.css`, 6 × readex-pro woff2, `favicon.svg` — zero JS |
| `https://subnation.ly/manifest.json` | 200, `application/json`, 2,231 B, `max-age=3600`; **byte-identical to `frontend/public/manifest.json`** (diff clean) |
| Icons | `/pwa-96x96.png` 200 (5,272 B) · `/pwa-192x192.png` 200 (13,457 B) · `/pwa-512x512.png` 200 (50,707 B) · `/pwa-screenshot-narrow.png` 200 (171,332 B) · `/pwa-screenshot-wide.png` 200 (192,776 B) · `/favicon.svg` 200 (163 B) · `/opengraph.jpg` 200 (39,597 B) |
| `https://subnation.ly/registerSW.js` | 200, `no-cache, no-store, must-revalidate`, stock 3-liner (byte-identical to dist) |
| `https://subnation.ly/assets/preload-gate-UNflcRlC.js` | 200, `public, max-age=31536000, immutable`, 571 B, **byte-identical to local dist** (content-addressed ✓) |
| `https://subnation.ly/assets/index-BInNtHLA.js` | 200, immutable, 113,198 B; contains `controllerchange` + «تحديث جديد متاح» (update toast live) |
| Live shell chunk refs | `index-BInNtHLA.js`, `home-DnDOfLXF.js`, 4 × `vendor-*.js`, `index-BQKsKwhD.css`, 4 woff2 — **each HEAD-checked 200** |
| `https://subnation.ly/workbox-5a76e2bc.js` | 200, `max-age=2592000, stale-while-revalidate=86400`, 22,401 B (name stable per workbox version → importScripts hits warm HTTP cache on update) |
| Probes | `/assets/index-BInNtHLA.js.map` → 200 **text/html** 11,418 B (SPA fallback, not a map) · `/assets/definitely-missing-xyz123.js` → 200 **text/html** 11,418 B (F2) · `/sw.js.map` → 200 **application/json** 6,484 B (F1) · `/workbox-5a76e2bc.js.map` → 200 **application/json** 217,501 B (F1) · `/registerSW.js.map`, `/manifest.webmanifest` → SPA HTML |

---

## 4. Offline truth (returning visitor, SW installed, post-today's-update)

| Surface | What the user sees offline | Why |
|---|---|---|
| `/` (home) | **Full home page** — shell from precache, entry/home chunks from `assets-js` CacheFirst, catalog from `api-catalog-v1` SWR (7 d TTL), images from `images-v1` | Live-proven in R126-A9 (45 cards at 390 px); config unchanged since |
| `/category/x` (visited online before) | Works: shell via NavigationRoute + route chunk via `assets-js` + catalog SWR | `navigateFallback` covers all non-`/api/`, non-`/assets/` navigations |
| `/product/y` (visited before) | Works (R126-A9 live-verified) | same ladder |
| Any route **never visited** on this release | Shell boots → route-chunk import fails offline → `lazyWithRetry` reloads once → still failing → Arabic ErrorBoundary («حدث خطأ») with retry | Honest degradation; not a white screen |
| JS never arrives at all (evicted `assets-js`, fresh release offline) | **Static no-JS div** «يتطلب الموقع تشغيل JavaScript» after 2.5 s | R98-F7 lineage, self-contained inline styles, follows OS light/dark |
| `/wallet` (guest, offline) | Redirect to `/login` | R126-A9 live-verified |

**R98-F7 no-JS fallback coherence with current boot: still coherent.** It is inline-styled + `<style>`-scoped (no dependency on the CSS chunk or any JS), removed synchronously at `main.tsx:41` long before the 2.5 s reveal, `dir="rtl" role="status"`, neutral copy (R116-S1), and it survives the R126 external-gate change untouched (a failed gate script cannot block the reveal path — the gate only *adds* preload hints). Only wrinkle: the 2.5 s reveal can briefly flash on very slow **online** first paints (F4).

---

## 5. iOS / Android install surfaces

**Manifest (live, byte-identical to `public/manifest.json`):** `name` + Arabic `short_name`/`description` ✓ · `id: "/"` (R96-P3-1 fixed) · `start_url "/"` + `scope "/"` · `display: standalone` · `orientation: portrait-primary` · `background_color #0a0a0a` + `theme_color #dc1840` (matches live `<meta name="theme-color" content="#dc1840">`) · **`lang: "ar"` + `dir: "rtl"`** ✓ · `categories` ✓ · icons 96/192/512 `any` + 512 `maskable` — all URLs 200 ✓ · 2 `screenshots` (narrow 540×1080 + wide 1080×540, Arabic labels — rich install sheet) ✓ · 2 Arabic `shortcuts` (المتجر → `/`, طلباتي → `/orders`, each with 96 px icon) ✓.

**Shell meta (live-verified):** `<link rel="manifest" href="/manifest.json">` ✓ · `apple-touch-icon → /pwa-192x192.png` (200) ✓ · `apple-mobile-web-app-capable=yes` · `apple-mobile-web-app-status-bar-style=black-translucent` · `apple-mobile-web-app-title=SubNation` · `mobile-web-app-capable=yes` ✓.

Installability is complete on both platforms. The one open install-surface defect is inherited: **R126-A13-F11 (P2)** — `viewport-fit=cover` with zero `env(safe-area-inset-*)` rules → notch/home-indicator overlap in standalone (see §7, not re-reported).

---

## 6. Findings (P0-P3)

**P0: none. P1: none. P2: none. P3: 4.**

---

### B5-F1 · P3 · Public sourcemaps leak at dist root (`sw.js.map` + `workbox-*.js.map`) — the sourcemap guard only sweeps `assets/`

**Confidence: 5** (live-fetched, root cause pinned in config).

Live evidence: `https://subnation.ly/sw.js.map` → 200 `application/json` 6,484 B (`cache-control: public, max-age=3600`), and `https://subnation.ly/workbox-5a76e2bc.js.map` → 200 `application/json` **217,501 B**. The live `sw.js` even carries `//# sourceMappingURL=sw.js.map` (twice — a workbox artifact). Both maps embed `sourcesContent` with the Docker build layout, e.g. `"sources":["../../tmp/2bd2fef410db68169182e69f712a97ee/sw.js"],"sourcesContent":["import {registerRoute as workbox_routing_registerRoute} from '/app/node_modules/.pnpm/workbox-routing@7.4.1/node_modules/workbox-routing/registerRoute.mjs';…`.

Root cause — the guard's sweep directory is `assets/` only, `frontend/vite.config.ts:503`:
```ts
const assetsDir = path.resolve(import.meta.dirname, "dist/public/assets");
```
and the Sentry deletion glob is assets-only too, `frontend/vite.config.ts:958`:
```ts
sourcemaps: { filesToDeleteAfterUpload: "assets/*.map" },
```
while the token'd build sets `sourcemap: "hidden"` (line 978), under which vite-plugin-pwa/workbox-build emits the root-level maps — the local no-token build correctly emits none (verified: 0 `*.map` in local dist). The guard's own intent, `vite.config.ts:976-977`:
```
// maps are generated at all — a publicly fetchable .map at
// /assets/<chunk>.js.map must never ship.
```
is met for `/assets/*` (live `/assets/index-BInNtHLA.js.map` → SPA HTML, i.e. deleted ✓) but the root-level SW artifacts bypass it.

Impact: no app TS source is exposed (the SW is generated code + the workbox runtime; both already public bytes via `sw.js`/`workbox-*.js`) — this is ~224 KB of public deploy weight + container-path/workbox-version disclosure + a hygiene regression against the R96-F-8 principle. Not a regression from today's deploy (leaks since the Docker+Sentry pipeline existed); first noticed by this audit.

**Fix (S, one hunk):** in `sourcemapGuardPlugin.closeBundle`, after the assets sweep, also sweep the dist root:
```ts
const rootDir = path.resolve(import.meta.dirname, "dist/public");
for (const f of readdirSync(rootDir)) {
  if (f.endsWith(".map")) rmSync(path.join(rootDir, f));
}
```
(keep the same token/no-token warn/fail split). Alternatively/also disable SW maps at the source (vite-plugin-pwa passes esbuild `sourcemap: false` for the SW bundle) — but the guard sweep is the belt-and-suspenders this project prefers.

---

### B5-F2 · P3 · Missing `/assets/*` files soft-200 the SPA shell (no 404 signal; `assets-js` caches the HTML)

**Confidence: 5** (live-proven twice).

`https://subnation.ly/assets/definitely-missing-xyz123.js` → **200 `text/html; charset=utf-8`, 11,418 B** (the SPA shell, `no-store`). The fallback excludes only `/api`, `backend/src/app.ts:1640`:
```ts
if ((req.method !== "GET" && req.method !== "HEAD") || req.path.startsWith("/api")) {
```
(`express.static` at app.ts:1491-1497 calls `next()` on misses, falling through to this handler.) Note the design comment at app.ts:1484 — "200 stays — the SPA must boot to render the 404 UI" — is right for *routes*, but `/assets/*` is not a route.

Impact: (a) post-deploy dead chunk URLs return HTML — module MIME enforcement still yields the lazyWithRetry error signature, so **recovery is intact** (this is why it's P3, not P2); (b) the `assets-js` CacheFirst rule (`cacheableResponse: statuses [0,200]` — live sw.js) will cache the 11.4 KB HTML body under the dead `.js` URL, wasting LRU slots; (c) missing-asset incidents are invisible to 404-based monitoring/Sentry; (d) an unbounded soft-404 crawl space under `/assets/` (robots.txt does not disallow it).

**Fix (S):** add `/assets` to the fallback exclusion so misses 404 — mirroring the SW's own denylist (vite.config.ts:922 `/^\/assets\//`):
```ts
if ((req.method !== "GET" && req.method !== "HEAD") ||
    req.path.startsWith("/api") || req.path.startsWith("/assets")) {
```
(+ pinning test: `GET /assets/nope.js` → 404, content-type not html).

---

### B5-F3 · P3 · Direct navigation to `/sw.js` (or `registerSW.js`, `manifest.json`, `init.js`, `workbox-*.js`) serves the SPA shell instead of the resource

**Confidence: 4** (config-verified workbox semantics; not browser-reproduced — would require installing the SW, which this read-only pass did not do).

The NavigationRoute denylist covers only the API and assets, `frontend/vite.config.ts:921-922`:
```ts
navigateFallback: "index.html",
navigateFallbackDenylist: [/^\/api\//, /^\/assets\//],
```
A top-level browser navigation to `/sw.js` (request mode `navigate`, not in denylist) is intercepted and answered with the precached `index.html` — a user opening the SW URL in a tab sees the storefront, not the script (curl/devtools shows the real file because there's no controlled SW context). Same for the other root static files. Zero update-flow impact (SW script/importScripts fetches bypass the page's fetch handler); this is a dev/diagnosability wart, and it's been the shape since R96.

**Fix (S):** extend the denylist:
```ts
navigateFallbackDenylist: [
  /^\/api\//,
  /^\/assets\//,
  /^\/(?:sw\.js|registerSW\.js|workbox-[^/]+\.js|manifest\.json|init\.js)$/,
],
```

---

### B5-F4 · P3 · The no-JS offline div can flash on slow *online* first paints (2.5 s reveal vs. deferred entry evaluation)

**Confidence: 3** (arithmetic + code path; not reproduced on a throttled live session).

The reveal is a pure CSS timer, `frontend/index.html` (built shell line 177):
```css
animation: sn-offline-reveal 0.4s ease 2.5s forwards;
```
while removal happens only when the entry module evaluates, `frontend/src/main.tsx:41`:
```ts
document.getElementById("static-offline")?.remove();
```
On a first visit (no SW yet) over a slow Libyan mobile link, the entry (`index-BInNtHLA.js`, 113 KB raw) + 4 modulepreloaded vendors (~260 KB raw) can land after 2.5 s → the div fades in («يتطلب الموقع تشغيل JavaScript») and is then yanked out when JS arrives. The comment's claim — "only a boot whose JS truly never arrives lets the reveal fire" (index.html:143-145) — is not strictly true under bandwidth-bound boots. Self-healing, cosmetic, live since R98 with no complaint on record.

**Fix (S):** raise the reveal delay to ~6 s (`animation-delay`), or make the reveal conditional (e.g. also require `navigator.onLine === false` via a tiny inline check, keeping the no-JS guarantee since it would still run without any external file). Either way, keep it inline/self-contained per R98-F7.

---

## 7. Known-held-open PWA items (from history — NOT re-reported, pointer only)

| Item | Pointer (one line) |
|---|---|
| `registerSW.js` + `init.js` not precached (offline 404s, harmless: registration no-op offline / theme-boot skip) | R96-A3 P3-3 — still true today (precache has neither; 10 entries) |
| `.woff` fallback faces ride `dist/` as deploy-image weight (never fetched by woff2-capable browsers, not precached) | R126-A5 F6 |
| `viewport-fit=cover` with zero `env(safe-area-inset-*)` rules → notch/home-indicator overlap in installed standalone (the one open **P2** on the install surface) | R126-A13 F11 |
| Update toast is opt-in (user may ignore; next full navigation picks the new release anyway) | R96 F-7b design decision, `main.tsx:90-98` comment |
| PWA installability contract e2e (`GET /manifest.json` + icons 192/512 + `start_url`) suggested, not yet implemented | R126-A10 recommendation #3 |
| Orders/wallet filter state not in URL — habitual PWA pull-to-refresh gesture loses tab/filter state | R126-A9 P3 (PWA-gesture-adjacent) |

Closed-and-verified-today (do not reopen): manifest `id` + `screenshots` (R96-P3-1 — live manifest has `id:"/"` + 2 screenshots); precache duplicates (R96-P3-2 — 10 unique entries); catalog 60 s offline TTL (R96-F-7a — 7 d SWR live); silent takeover (R96-F-7b — toast live in entry); JS-less offline white screen (R98-F7 — div live in shell, removed at boot); CacheFirst JS cap 40 (R124-A2-F2 — 160 live).

---

## 8. Next actions (owner: implementer lane, none blocking)

1. **F1** — extend `sourcemapGuardPlugin` sweep to the dist root (one hunk; kills `/sw.js.map` + `/workbox-*.js.map` at the next deploy).
2. **F2** — 404 the `/assets` fallback path + a pinning test.
3. **F3** — denylist the SW/root-static navigations.
4. **F4** — raise/gate the offline-div reveal delay.
5. Optional hardening (from R126-A10-#3, still open): a cheap live installability contract test per deploy.
