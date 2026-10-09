# R127-B4 — Live Performance Measurement (fresh post-R126 deploy)

- **Agent:** R127-B4 (live-performance auditor, READ-ONLY — this report + one worklog append are the only writes)
- **Date:** 2026-10-09 · **Repo HEAD:** `f53a886` (clean except this docs dir) · **Live target:** https://subnation.ly
- **Production identity proof:** live shell references `/assets/preload-gate-UNflcRlC.js` — the content-addressed external preload gate emitted only by the R126 CSP-fix commit range and byte-verified at `f53a886` by R126-R1 (sha256(source)[:8] = `UNflcRlC`). Live CSS `index-BQKsKwhD.css` (269,475 B raw) and all 4 preloaded woff2 hashes match the HEAD dist family. **Production runs exactly this tree.**

## Method + sample counts (all numbers first-hand)

- **Lighthouse 13.5.0** (`npx -y lighthouse`), Chrome-for-Testing 153.0.8010.36 headless-shell, `--only-categories=performance`, JSON output, **8 runs = 4 routes × 2 presets** (`/`, `/login`, `/product/lifetime-cloud-storage`, `/category/streaming`; default mobile emulation + `--preset=desktop`). Mobile preset = simulated slow-4G (1,638 kbps / 150 ms RTT) + 4× CPU; desktop = 40 ms RTT / 10,240 kbps, 1× CPU. Flags: `--headless --disable-dev-shm-usage --no-sandbox --disable-gpu` (64 MB /dev/shm crashed the tab without it).
- 2 preliminary runs were **discarded** (one NO_FCP on regular headless Chrome, one post-metrics TARGET_CRASHED on the FullPageScreenshot artifact before the dev-shm fix) — **all 8 recorded runs have `runWarnings: []` and no runtimeError.**
- Routes chosen from ground truth: `GET /api/products?fields=list` → 45 products, **exactly 1 with `is_available: true`** → `lifetime-cloud-storage` (id 62); category = `streaming` (largest, 17 products).
- **Asset hygiene:** 1 HTML fetch + 15 asset HEADs + 15 GETs (br) + 8 identity downloads (for gzip-level-6 recompression on the budget plugin's exact basis).
- **Server timing:** 5× `curl -w` samples each on `/`, `/api/healthz`, `/api/products` (2 s sleep between samples — no load testing, no k6/ab/wrk).
- Total production traffic: ~8 Lighthouse page loads + ~40 curl requests. Measurement-only.

---

## A. The 8-run results table (Lighthouse simulated metrics — the standard lab basis)

| Route | Preset | **Perf score** | FCP | LCP | TBT | CLS | Speed Index | TTI |
|---|---|---|---|---|---|---|---|---|
| `/` | mobile | **74** | 2,115 ms | **4,307 ms** | 330 ms | 0.000 | 4,158 ms | 4,307 ms |
| `/` | desktop | **93** | 738 ms | 1,212 ms | 5 ms | 0.014 | 2,044 ms | 1,212 ms |
| `/login` | mobile | **66** | 2,032 ms | **4,260 ms** | **621 ms** | 0.039 | 4,484 ms | 4,260 ms |
| `/login` | desktop | **92** | 1,132 ms | 1,177 ms | 0 ms | 0.014 | 1,946 ms | 1,177 ms |
| `/product/lifetime-cloud-storage` | mobile | **81** | 1,943 ms | **4,323 ms** | 53 ms | 0.051 | 4,363 ms | 4,323 ms |
| `/product/lifetime-cloud-storage` | desktop | **91** | 830 ms | 1,312 ms | 0 ms | 0.009 | 2,302 ms | 1,312 ms |
| `/category/streaming` | mobile | **79** | 1,999 ms | **4,229 ms** | 138 ms | 0.000 | 4,940 ms | 4,229 ms |
| `/category/streaming` | desktop | **92** | 781 ms | 1,288 ms | 0 ms | 0.008 | 2,090 ms | 1,288 ms |

**Core-Web-Vitals grading of the lab numbers:**

- **Mobile LCP is POOR (>4.0 s) on all 4 routes** (4,229–4,323 ms). Desktop LCP is GOOD (1.18–1.31 s). Mobile FCP is "needs improvement" (1.9–2.1 s) everywhere.
- **TBT:** login-mobile **621 ms sits exactly at the "poor" 600 ms boundary**; home-mobile 330 ms (moderate); product/category mobile ≤138 ms (good); desktop 0–5 ms.
- **CLS is excellent everywhere** (max 0.051, all ≪ 0.1) — layout stability is a non-issue live.
- TTI: in LH 13.5 `interactive` reported **equal to LCP on all 8 runs** (no post-LCP long-task tail) — recorded as-is.

**Observed (unthrottled trace) values, same 8 runs** (`audits.metrics.details.items[0].observed*`) — the "as-loaded from this vantage" truth:

| Route | mobile: FCP / LCP / SI | desktop: FCP / LCP / SI |
|---|---|---|
| `/` | 1,786 / 2,499 / 2,310 ms | 2,153 / **4,297** / 2,900 ms |
| `/login` | 1,804 / 2,825 / 2,443 ms | 1,856 / 1,856 / 2,393 ms |
| `/product/...` | 1,892 / 2,963 / 2,483 ms | 2,111 / **4,947** / 3,218 ms |
| `/category/...` | 2,177 / **4,361** / 2,822 ms | 2,208 / **4,447** / 2,951 ms |

Anomaly worth one follow-up (NEW, confidence 5 on values / 2 on cause): on 3 of 4 desktop runs the **observed** LCP (4.3–4.9 s) is far *worse* than the simulated one (1.2–1.3 s) and worse than mobile observed — the LCP entry on desktop is superseded by a late repaint of the winning element (candidates: font-swap text-metric reflow resizing cards, or a fade-in repaint) after the page is otherwise visually complete (observed Speed Index 2.9–3.2 s < observed LCP). The simulate model does not reproduce this late-supercession, so desktop simulated LCP flatters reality. Needs a trace-level look before acting.

## B. LCP element + phase breakdown (per run, from `lcp-breakdown-insight` — observed-trace phases, ms)

| Run | LCP element (live selector/label) | TTFB | Load delay | Load time | Render delay |
|---|---|---|---|---|---|
| home-mobile | card img `cPanel — اشتراك برامج وتراخيص` (`img.absolute`, `fetchpriority="auto"` — index 1!) | 617 | **1,537** | 278 | 67 |
| home-desktop | card img `Lifetime Cloud Storage…` (`fetchpriority="high"`, index 0) | 777 | **3,066** | 307 | 146 |
| login-mobile | **`button.w-full` «المتابعة عبر Telegram»** (text/button — no image) | 605 | — | — | **2,220** |
| login-desktop | logo text `span.font-bold` "SubNation" | 678 | — | — | 1,178 |
| product-mobile | main product img (`fetchpriority="high"`, product.tsx:1185 ✓) | 643 | **2,065** | 222 | 34 |
| product-desktop | main product img (same) | 851 | **3,739** | 284 | 74 |
| category-mobile | card img `Hallmark Movies Now…` (`fetchpriority="auto"`) | 788 | **3,236** | 284 | 54 |
| category-desktop | card img `Shudder…` (`fetchpriority="auto"`) | 791 | **3,349** | 212 | 95 |

Reading: on every image-LCP route the dominant phase is **resourceLoadDelay = late discovery** (1.5–3.7 s): the card image only enters the DOM after entry-JS eval → catalog API → React render, so its fetch starts ~2.2 s in (home-mobile trace: doc ends 620 ms → entry `index-BInNtHLA.js` 652→1,262 ms → `/api/products?fields=list` 1,500→2,062 ms (parallel with `/api/auth/probe` 1,514→1,915 ms) → LCP img request 2,214→2,432 ms). The image *fetch itself* is cheap (212–307 ms); discovery is the cost. On login the LCP is a **rendered button**, so the entire 2.2 s is render delay (JS boot + auth probe + form mount). The `fetchpriority` policy in `frontend/src/components/ProductCard.tsx:415-416` — `loading={index < 4 ? "eager" : "lazy"}` / `fetchPriority={index === 0 ? "high" : index < 4 ? "auto" : "low"}` — is live and correct on index 0 and on the product page (product.tsx:1185), **but the actual mobile home/category LCP element was index 1 at `fetchpriority="auto"`**, so the "single biggest LCP lever" comment above those lines is only half-live.

## C. Top opportunities + flagged diagnostics (per run, from LH 13.5 insights)

| Run | Top opportunities (est savings) | Flagged diagnostics |
|---|---|---|
| home-mobile | **unused-javascript −450 ms (−74 KiB)** · server-response-time −101 ms | render-blocking (CSS −80 ms) · main-thread 2,841 ms · **image-delivery −95 KiB** · network-dependency-tree · cache-insight (init.js) |
| home-desktop | server-response-time −157 ms · unused-javascript −40 ms (−77 KiB) | **image-delivery −206 KiB** · render-blocking (−20 ms) · network-dependency-tree |
| login-mobile | **unused-javascript −540 ms (−76 KiB)** · server-response-time −98 ms | render-blocking (−150 ms) · main-thread 2,534 ms · network-dependency-tree · cache-insight |
| login-desktop | server-response-time −102 ms | render-blocking (−30 ms) · network-dependency-tree |
| product-mobile | **unused-javascript −450 ms (−76 KiB)** · server-response-time −119 ms | render-blocking (−150 ms) · **image-delivery −79 KiB** · network-dependency-tree |
| product-desktop | server-response-time −327 ms · unused-javascript −40 ms | image-delivery −39 KiB · render-blocking (−40 ms) |
| category-mobile | **unused-javascript −450 ms (−76 KiB)** · server-response-time −158 ms | render-blocking (−30 ms) · main-thread 2,715 ms · **image-delivery −107 KiB** · network-dependency-tree |
| category-desktop | server-response-time −152 ms · unused-javascript −80 ms (−79 KiB) | **image-delivery −119 KiB** · render-blocking (−20 ms) |

Attribution of the #1 opportunity (from `unused-javascript` items + `bootup-time` + `long-tasks`):

- **`/assets/vendor-sentry-N4mnyIUo.js` is 100% of the unused-JS finding on every route: 76.0 KiB of 108.7 KiB (70%) unused at load.** It is fetched during the load window on all 8 runs (biggest single byte item on every route — 18% of home's 605 KiB total), executes 174 ms + a **221 ms long task at ~3.6 s** on home (vendor-react itself: 783 ms eval, 133/106 ms tasks), and even on `/login` (59 ms eval) it contends during the LCP render phase.
- Render-blocking is structurally minor: the CSS (`index-BQKsKwhD.css`, 29.3 KiB br) plus 3 tiny classic scripts (`preload-gate` 571 B, `init.js` 404 B, `registerSW.js` 134 B — the latter two at 0 ms).
- DOM size is healthy everywhere (107–1,904 elements, depth ≤15); third-party footprint = one Sentry ingest envelope (281–379 B).

## D. Budget comparison — repo budget vs LIVE bytes (gzip level-6 recomputed from identity downloads, the plugin's exact basis)

Gates (`frontend/vite.config.ts:107-108, 179-180`, quoted verbatim):
```ts
const GZIP_LIMIT_ERROR = 56320; // 55 KiB
const GZIP_LIMIT_WARN = 47120; // ~46 KiB
...
const EAGER_GZIP_LIMIT_ERROR = 160 * 1024; // 160 KiB hard fail
const EAGER_GZIP_LIMIT_WARN = 145 * 1024; // 145 KiB warning threshold
```

Live eager files (identity GET → local `gzip -6`), vs R126-A5's no-DSN dist build:

| File | A5 no-DSN dist (B gz) | **LIVE (B gz)** | Δ |
|---|---|---|---|
| index-BInNtHLA.js (entry) | 32,365 | **34,102** | +1,737 |
| vendor-react-W5_JElyf.js | 58,630 | 58,722 | +92 |
| vendor-utils-UqmqIGM4.js | 9,744 | 9,904 | +160 |
| vendor-router-CqB5eSZf.js | 2,421 | 2,623 | +202 |
| vendor-query-C0JBlHeN.js | 10,727 | 10,928 | +201 |
| index-BQKsKwhD.css | 31,830 | 31,763 | −67 |
| **Eager path total** | 145,717 | **148,042** | **+2,325** |

| Gate | Threshold | Live value | Verdict |
|---|---|---|---|
| Entry chunk — warn / fail | 47,120 / 56,320 B | 34,102 B | **PASS** (60.5% of fail line) |
| **Eager path — WARN** | **148,480 B** | **148,042 B** | **PASS by 438 B (0.3%) — NEAR-VIOLATION** |
| Eager path — hard fail | 163,840 B | 148,042 B | PASS (15.8 KiB headroom) |
| (context) + home chunk on `/` boots | excluded from gate by design (vite.config.ts:152 rationale) | +8,106 → 156,148 B | under fail, **over the warn line** for home first visits |
| (context) + idle vendor-sentry | not in gate (idle boundary) | +110,972 → 259,014 B | first-visit JS+CSS reality |

**No hard budget violation — but the production eager path is 438 B from tripping the 145 KiB warn, and the CI gate cannot see it:** CI builds without a DSN (A5's basis: 145,717 B), while the deployed DSN build is 148,042 B — the gate under-reports production by 2,325 B, and the DSN-mode number has grown +1,946 B since R125's recorded 146,096 B without any gate ever seeing it. Any ~0.5 KB addition to entry/vendors/CSS trips the warn in production while CI stays silent. The repo budget contains **no runtime-metric thresholds at all** (PERFORMANCE.md is bytes-only) — FCP/LCP/TBT/CLS are unguarded by any gate (coverage gap, NEW).

## E. Asset hygiene — live header audit (HEAD + GET per asset, 2026-10-09)

Home HTML asset census (4 scripts + 1 CSS + 4 modulepreloads + 4 font preloads; `data-home-chunk` gate attr → `home-DnDOfLXF.js`):

| Asset | raw B | br transfer B | cache-control (live) | encoding |
|---|---|---|---|---|
| `/` (HTML shell) | 11,484 | 4,498 | `no-cache, no-store, must-revalidate` | br |
| `/assets/index-BInNtHLA.js` (entry) | 113,198 | 33,449 | `public, max-age=31536000, immutable` | br |
| `/assets/vendor-react-W5_JElyf.js` | 186,253 | 59,238 | immutable 1y | br |
| `/assets/vendor-utils-UqmqIGM4.js` | 31,368 | 9,935 | immutable 1y | br |
| `/assets/vendor-router-CqB5eSZf.js` | 5,406 | 2,630 | immutable 1y | br |
| `/assets/vendor-query-C0JBlHeN.js` | 36,866 | 11,370 | immutable 1y | br |
| `/assets/index-BQKsKwhD.css` | 269,475 | 29,256 | immutable 1y | br |
| `/assets/preload-gate-UNflcRlC.js` | 571 | 571 | immutable 1y | identity (below compress threshold) |
| `/assets/home-DnDOfLXF.js` | 27,017 | 8,487 | immutable 1y | br |
| `/assets/vendor-sentry-N4mnyIUo.js` | 329,034 | **111,295** | immutable 1y | br |
| `/assets/readex-pro-arabic-400/600/700.woff2` | 9,776 / 10,440 / 10,264 | — | immutable 1y | woff2 (no re-encode, correct) |
| `/assets/readex-pro-latin-400.woff2` | 14,384 | — | immutable 1y | woff2 |
| `/init.js` | 404 | 404 | **`public, max-age=3600` (1 h)** | identity |
| `/registerSW.js` | 134 | 134 | `no-cache, no-store, must-revalidate` | identity |
| `/api/products?fields=list` | 17,496 | 3,337 | `public, max-age=0, s-maxage=60, stale-while-revalidate=300` | br |

- **R126 claim VERIFIED live:** every `/assets/*` file serves `cache-control: public, max-age=31536000, immutable` (verified on GET, 10/10 files) and `content-encoding: br` on all JS/CSS (10/10) — the immutable-1y + brotli rule is fully live. HTML/API no-store and the catalog `s-maxage=60/swr=300` edge policy also match the code-level claims exactly.
- NEW (minor): `/init.js` — a **blocking** head script present on every route — carries only `max-age=3600`; LH `cache-insight` flagged it on all 8 runs (wasted ~426–446 B/load on hourly revalidation). One-liner fix: long max-age + etag, or hash the filename into `/assets/`.
- `registerSW.js` no-store is the deliberate SW-versioning pattern (fine). Strong ETag + `Vary: Origin, Accept-Encoding` present on all assets.

## F. Server timing — 5× curl samples per endpoint (2 s apart, TTFB = time_starttransfer)

| Endpoint | 5 samples (s) | median | min–max | Origin think-time (after ~0.39–0.56 s probe→origin floor: connect 0.19–0.28 s, TLS 0.39–0.56 s) |
|---|---|---|---|---|
| `GET /` | 0.775 · 0.628 · 0.769 · 0.838 · 0.832 | **0.769** | 0.63–0.84 | ~0.21–0.35 s |
| `GET /api/healthz` | 0.611 · 0.587 · 0.768 · 0.591 · 0.625 | **0.611** | 0.59–0.77 | ~0.05–0.25 s (constant handler → near-network floor) |
| `GET /api/products` | 1.517 · 0.810 · 0.792 · 0.607 · 0.791 | **0.791** | 0.61–1.52 | ~0.2–0.95 s (first sample 1.52 s = edge `s-maxage=60` miss → origin + Neon) |

Consistent with R126-A6's 3-run medians (catalog 667 ms, healthz 648 ms from the same class of vantage) — **no regression**; the no-CDN origin-RTT ceiling (0.6–0.9 s per cold request) is unchanged. This ceiling is the KNOWN infra lever (R126-A5 O1, held open) — referenced, not re-reported.

---

## G. Top-5 highest-impact fix directives (evidence → file:line → expected gain)

**D1 — [NEW, P2-grade process] Close the budget's DSN blindness before the next feature round trips the 145 KiB warn.**
Evidence: live eager path = **148,042 B gz** vs the 148,480 B warn line (`vite.config.ts:180` `const EAGER_GZIP_LIMIT_WARN = 145 * 1024; // 145 KiB warning threshold`) — **438 B of headroom** — while CI's gate basis is the no-DSN build (R126-A5: 145,717 B). The deployed DSN build is +2,325 B over that basis (entry alone +1,737 B: 32,365 → 34,102 B gz) and has grown +1,946 B since R125's recorded DSN number (146,096 B) with no gate observing it. → Fix: run the CI budget build with a placeholder `VITE_SENTRY_DSN` (or add the measured DSN delta as a documented gate offset), so the gate sees production reality; pair with the known in-repo trim lever (A5-F1/O2, de-admin the entry, −1–2 KB). Expected gain: the warn line becomes trustworthy again; prevents a silent CI-pass/production-warn split. Effort S. Confidence **5**.

**D2 — [NEW quantification of a by-design cost] Keep the 111 KB vendor-sentry chunk out of the first-visit load window for the 90% of visitors who are not session-replay-sampled.**
Evidence: `vendor-sentry-N4mnyIUo.js` = 329,034 B raw / **111,295 B br**, fetched on **every** route incl. `/login` (biggest byte item on all 8 runs; 18% of home's 605 KiB); LH `unused-javascript`: 76.0 of 108.7 KiB (70%) unused at load — the **#1 opportunity on all 4 mobile routes (est −450 to −540 ms)**; observed eval 174 ms + a **221 ms long task at ~3.6 s** on home, i.e., landing during the LCP/image phase. The load is by design (`boot-sentry.ts:20` "The actual @sentry/react chunk loads on requestIdleCallback") and the error buffer already preserves pre-load events (`boot-sentry.ts` §1–2) — but live, rIC fires *during* the load window on mid-tier mobile, not after it. → Fix: for non-sampled sessions, attach the dynamic `import("../instrument")` on the later of `load` event / first `pointerdown` (keep the sticky-10% session winners and the first-error path as-is). Expected gain: −111 KB br out of the first-visit load window on ~90% of visitors, removes the 221 ms long task from the LCP phase; LH-simulated est −450–540 ms mobile LCP/TBT. Effort S/M. Confidence 4 (cost measured; exact gain model-dependent).

**D3 — [NEW] Fix the login route's mobile POOR TBT/LCP: the auth probe gates all content paint and its cost assumption is stale.**
Evidence: login-mobile is the worst run of the fleet (**score 66, TBT 621 ms = at the "poor" boundary, LCP 4,260 ms**); the LCP element is the rendered «المتابعة عبر Telegram» button with **elementRenderDelay 2,220 ms** — the entire LCP is JS-boot + probe + form-mount. Gate: `frontend/src/App.tsx:1049` `if (initializing) {` returns the splash/blank div for every route until the probe settles; the docclaim at `frontend/src/lib/auth.tsx:34` "Always becomes `false` within ~50-300 ms of mount (one same-origin /api/auth/me round-trip)" is contradicted live — the probe costs a full origin RTT (~0.6–0.9 s from this vantage; observed probe request 1,514→1,915 ms on home). Login also gets no boot head-start (home-only by design, `App.tsx:324` `if (!isHomeBootPath(bootPath, routerBase)) return;`). → Fix: render the static guest login form optimistically while the probe runs (it contains no session-dependent content), and redirect already-authed users post-probe; the splash stays only for routes that truly need identity. Expected gain: login LCP render-delay phase collapses (−1.5–2.5 s mobile LCP; FCP→LCP gap disappears), login score 66 → ~80s. Effort M. Confidence 4 (diagnosis measured; gain estimate).

**D4 — [NEW] Serve product art at display-relevant sizes — 450×450 webp is ~80% wasted bytes on DPR-1 desktops.**
Evidence: `image-delivery-insight`: home-desktop est **−206 KiB**, category-desktop −119 KiB, product-desktop −39 KiB, home-mobile −95 KiB; first item: `cpanel.webp` 31,074 B rendered at **197×197** on desktop = 25,129 B wasted (81%); same class for every card image (all `/products/*.webp` are a single 450×450 variant, A5-B5 "all small" was true per-file but not per-display). Caveat stated honestly: on mobile (DPR 2.625) 450px is roughly correct — LH's mobile estimate overstates; the desktop DPR-1 savings are real. → Fix: emit a ~300px variant (+ srcset/sizes on the two card consumers + product page main img) or resize the pipeline to 300×300 with a 2×=600 for hi-DPI. Expected gain: −40–50% image bytes on desktop first visits (≈ −200 KiB on home-desktop), lower total-byte-weight and image-phase contention; byte-neutral on mobile. Effort S/M (pipeline + 3 consumers). Confidence 4 desktop / 2 mobile.

**D5 — [NEW, cheapest] Warm the first-4 card images when the boot catalog prefetch resolves, and let the actual LCP card carry `fetchpriority="high"`.**
Evidence (home-mobile observed trace): doc ends 620 ms → entry eval 652–1,262 ms → catalog JSON 2,062 ms → **LCP img request only starts 2,214 ms** (React render adds the delay) → paint 2,499 ms; LCP phase `resourceLoadDelay` 1,537–3,739 ms dominates every image-LCP run; the winning mobile LCP element was **index 1 at `fetchpriority="auto"`** because `ProductCard.tsx:416` grants `high` only to `index === 0`. → Fix: in the head-start (`frontend/src/App.tsx:339` `.prefetchQuery({` — the `fields=list` payload already carries `image_url` per row), on resolution run `for (const p of list.slice(0,4)) new Image().src = p.image_url` so image bytes land while React mounts; optionally extend `fetchPriority="high"` to `index < 2` on mobile layouts. Expected gain: −150–250 ms observed LCP (one render-hop removed from the image's critical path; more on high-RTT links where the saved serial hop is throttled). Effort S (<10 lines). Confidence 3.

**Explicitly NOT re-reported (held open in R126 A5/A6, unchanged by my measurements):** A5-F1 admin code in entry, F2 tickets memo, F3 admin 5 s pill interval, F4 dual-layout DOM, F5 micro-chunks, F6 woff fallbacks, F7 unhashed art names, F8 admin warm-up, O1 CDN/edge-cache (the biggest single live lever — my §F timings confirm the 0.6–0.9 s origin-RTT ceiling persists); A6-F1 toNumber ledger, F2 stats fold, F3 price index, F4/F5 sequential awaits, F6 cart overfetch, F7/F8 scale-watches, F9 ledger trim. Nothing I measured contradicts any of them.

## H. Verdict

Live performance is **good on desktop (91–93) and marginal on mobile (66–81)**, with zero layout-shift problems, verified immutable-1y + brotli asset discipline, and server timings unchanged vs R126-A6. The five NEW items above are all addressable in-app; the two structural ceilings (no-CDN origin RTT, SPA client-rendered LCP) are known and held open. **One near-violation to act on now: the production eager path sits 438 B under the 145 KiB warn line while CI's gate measures a 2.3 KB-lighter no-DSN build (D1).**

— R127-B4, 2026-10-09. Artifacts: `/tmp/r127-b4/*.json` (8 LH reports), `summary.txt`, `identity/*`. Read-only; no commits; this report + one worklog append are the only writes.
