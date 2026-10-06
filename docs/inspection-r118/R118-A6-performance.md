# R118-A6 — Performance Audit (DB · API · Frontend)

- **Scope**: backend/ + shared/db (query patterns, plans, cache, pool), frontend/ (bundle, runtime, payload), live production latency census.
- **HEAD**: `ef3d0c3` (main, clean tree). Live origin serving a **different (older) build** — live entry chunk is `index-DcWfE6PS.js` vs repo `index-BTNM_6lU.js`; live-measured bundle numbers below are from the repo build, live numbers from the census.
- **Measurement environment**: audit sandbox → https://subnation.ly (origin 169.58.100.161, Contabo VPS, HTTP/2, Let's Encrypt at origin, Cloudflare **DNS-only/grey** — no edge cache, no cf-ray). Neon Postgres 17 endpoint `ep-spring-term-avwgxrte-pooler.c-11.**us-east-1**.aws.neon.tech` (PgBouncer pooler endpoint), Redis connected (per R117 /ready). Timestamps: 2026-10-06 ~14:40–15:20 UTC.
- **Live-probe budget**: 17 bounded GET probes completed (1 diagnostic + 13 in a bounded census + 2 header checks + 1 raw-payload fetch), each `--max-time 12–20s`. One earlier unbounded census attempt was killed by my own 180s tool timeout with output lost; its completed-request count is indeterminate (0–23) — every probe was a lightweight GET. No further live probing after that batch.
- **DB access**: read-only (SELECT / EXPLAIN only; `EXPLAIN ANALYZE` confined to indexed point selects on tables ≤ 263 rows). Sandbox→Neon `SELECT 1` RTT measured **202 ms steady** (5 samples, 202/202/202/202/202), connect handshake 1,246 ms — the sandbox is farther from us-east-1 than the Contabo app is (R117 measured app→Neon ≈ 98 ms).

---

## 1. LIVE LATENCY CENSUS (GET, 2 hits back-to-back, Accept-Encoding: gzip/deflate/br)

**Sandbox→origin network floor ≈ 0.77 s** (measured on a 61-byte 404 and a 15-byte JSON — TTFB ≈ total everywhere, i.e. zero body-stream time; the floor is DNS+TCP+TLS+RTT from this sandbox). Deltas **above** the floor are the server's own cost.

| Endpoint | t1 (cold-ish) | t2 (warm) | Δ over floor | Size (wire) | Encoding |
|---|---|---|---|---|---|
| `GET /` (SPA HTML) | 0.767 s | 0.772 s | ≈ 0 | 4,067 B | **br** |
| `GET /api/healthz` | 0.890 s | — (single probe) | +0.12 | small | — |
| `GET /api/healthz/summary` | 0.986 s | **0.778 s** | +0.21 → ~0 | 15 B `{"status":"ok"}` | — |
| `GET /api/products` (catalog, 45 prods) | 0.816 s | **0.775 s** | +0.05 → ~0 | 6,676 B | **br** |
| `GET /api/products/60` (detail) | 1.082 s | **0.778 s** | **+0.31 → ~0** | 1,296 B | **br** |
| `GET /robots.txt` | 0.798 s | — | ~0 | 774 B | — |
| `GET /sitemap.xml` (56 locs) | 1.236 s | — | +0.46 | 21,638 B | — |
| `GET /api/products/999999` (404) | 0.864 s | — | +0.09 | 61 B | — |
| `GET /sw.js` | 0.801 s | — | ~0 | 2,292 B | — |
| `GET /assets/index-*.js` (entry) | *(not probed in bounded batch)* | — | — | R117-A4 measured 91,669 B raw → 27,418 B **br**, `immutable` 1 y | br |

**Readings**:
- Nothing exceeds 800 ms warm; warm API hits sit **at the network floor** — the in-process caches (catalog 30 s, detail 60 s, health aggregate 15 s) make repeat hits ~0 ms of server time.
- Cache-miss deltas match the **sequential-DB-stage × RTT** model: product detail miss = +310 ms ≈ 3 stages × ~100 ms app→Neon RTT; sitemap = +460 ms (build + DB reads on a 60 s cache).
- `/api/healthz/summary` returned **`{"status":"ok"}`** — the permanent "degraded" of R117 is gone in this window (DB awake during census; see F-3 for the cold-start path).
- Raw catalog JSON measured **79,077 B** (45 products / 263 variants) → 6,676 B brotli = **91.6 % reduction at origin**. Origin (not edge) does the compression; Cloudflare is DNS-only, so the `s-maxage=60` on `/api/products*` currently caches **nowhere** but the browser.
- Caveat: Neon was awake for the whole census (my own DB scripts had just queried it), so no cold-start sample is included; see F-3 for the measured cold-path components.

---

## 2. HOT-PATH QUERY PLAN TABLE (live Neon, 2026-10-06; tables: products 59 · product_variants 263 · inventory 13 · orders 7 · wallet_ledger 23 · admin_alerts 123 · cart_items 1 · notifications 12)

| # | Query (route → SQL shape) | Plan | Rows/cost | Exec time | Verdict |
|---|---|---|---|---|---|
| Q1 | Catalog list default (`products ⋈ stock_sub ⋈ order_sub`, LIMIT 500) | Seq Scan products + Seq Scan inventory + Seq Scan orders (GroupAggregate), merge joins | 34/3/1 rows, cost 29.07 | (plain) | OK at scale-now; aggregates scan full inventory/orders per **uncached** call — see F-7 note |
| Q2 | Catalog list `category=vpn` sort `price_asc` | Seq Scan + Sort(n=1) | cost 27.12 | (plain) | OK — `idx_products_active_category` exists and takes over as the table grows |
| Q3 | Catalog search `name ILIKE '%grammarly%'` | Seq Scan + filter `~~*` | cost 23.75 | (plain) | OK — `idx_products_name_trgm` (GIN) exists; planner legitimately prefers seq scan at 59 rows |
| Q4 | Product detail by slug | **Index Scan** `idx_products_slug_unique` | 1 row | **0.047 ms** | ✅ |
| Q5 | Detail stock count (inventory, deliverable) | Seq Scan (13 rows) | 1 row | 0.079 ms | OK — `idx_inventory_product_sold` takes over at scale |
| Q6 | Detail completed-order count | Seq Scan (7 rows) | 1 row | 0.049 ms | OK — `idx_orders_status` exists |
| Q7 | Variants batch for whole page (`IN (45 ids)`) | Seq Scan + Sort(169) | cost 15.73 | (plain) | OK — `idx_product_variants_product_active` exists |
| Q8 | Variant stock group-by (`IN (45 ids)`) | Seq Scan + Sort + GroupAggregate | 3 rows | (plain) | OK |
| Q9 | User orders list (user_id=3 ⋈ products, LIMIT 200) | Seq Scan orders + Index Scan products_pkey | 3 rows | **0.067 ms** | ✅ `idx_orders_user_created` present for scale |
| Q10 | Cart items (user_id=3) | **Index Scan** `idx_cart_items_user` + sort(0) | 0 rows | 0.977 ms (cold buffer) | ✅ |
| Q11 | Wallet ledger (user_id=16, LIMIT 100) | Seq Scan (23 rows) + quicksort | 8 rows | 0.042 ms | ✅ `idx_wallet_ledger_user_created` present for scale |
| Q12 | Admin orders list (3-table join, LIMIT 100 OFFSET 0) | Hash joins, seq scans | 7 rows | 0.153 ms | ✅ offset pagination on `idx_orders_created DESC` will engage at scale |
| Q13 | Admin alerts list (`ORDER BY created_at DESC LIMIT 100`) | **Seq Scan + top-N sort — NO usable index** | 123 rows | 0.085 ms | ⚠ F-4 |
| Q14 | Admin alerts `/new` (`is_read=false` … LIMIT 50) | **Seq Scan + heapsort — no index on is_read/created_at** | 103 rows | 0.084 ms | ⚠ F-4 |
| Q15 | Admin alerts unread-count | Seq Scan | 103 rows | 0.073 ms | ⚠ F-4 |
| Q16 | Sitemap products | Seq Scan + sort(45) | 45 rows | 0.089 ms | ✅ |
| Q17 | Admin orders 5-column LIKE search | **Seq Scan orders × users × products + filter** | 0/7 rows | 0.723 ms | ⚠ F-5 (grows linearly) |
| Q18 | Notifications (user_id=3 LIMIT 40) | **Index Scan** `idx_notifications_user` + sort | 2 rows | 0.984 ms (cold buffer) | ✅ |

**Bottom line**: every hot query is sub-millisecond at current volume; the DB engine is not the bottleneck. The two structural gaps (F-4 alerts sort, F-5 admin LIKE search) are cheap today and flagged with growth thresholds.

---

## 3. FINDINGS

### F-1 · Neon region (us-east-1) is an ocean away from the app origin (EU) — ~100 ms RTT tax on every sequential DB stage **[P2]**
- **Evidence**: DB host `ep-spring-term-avwgxrte-pooler.c-11.**us-east-1**.aws.neon.tech` (from /tmp/.dburl); origin PTR `vmi3624162.contaboserver.net` (Contabo, EU). R117 /ready measured neon ≈ 98 ms. Product detail cache-miss costs **3 sequential DB stages** (`routes/products.ts:573→591→611` — product+flash → stock+count → variants) ≈ +310 ms measured (census t1 1.082 s vs 0.775 s warm/floor). Catalog list = 2 stages. Sandbox→Neon `SELECT 1` = 202 ms × 5 samples.
- **Impact**: every cache-miss DB-touching request pays ~100 ms × (number of sequential stages). Detail view ≈ 300 ms pure network; catalog ≈ 200 ms. This is the single largest *systemic* latency component under the app's control.
- **Fix sketch**: (a) **Move Neon to eu-central-1** (data is tiny — 59 products / 263 variants; create a Frankfurt branch, copy, repoint `DATABASE_URL`) → RTT ~5–10 ms = 10–20× cut; (b) independent micro-fix: collapse detail `/:id` from 3 stages to **1** `Promise.all` (id is known upfront — stock, count, variants and the product row can all key off `:id`) → −200 ms even without the region move; `/by-slug` needs 2 stages (variants need the id).
- **Effort**: M (region move) / S (query collapse).

### F-2 · `cacheWrap` has no single-flight — concurrent misses each run the loader **[P2]**
- **Evidence**: `backend/src/lib/cache.ts:186-196` — `const cached = await cacheGet(key); if (miss) { const fresh = await loader(); await cacheSet(...) }`. No in-flight promise dedup (the code comments acknowledge it: "Stampede-resistant only at the level of a single process"). The single-flight pattern already exists in-repo: `routes/health.ts:31` (`let inflight: Promise<…> | null`).
- **Impact**: after every catalog TTL expiry (30 s) or `bumpCatalogCache()` generation bump (10 admin mutation sites), N concurrent requests each execute the full loader — catalog list = 4 queries (list, flash sale, variants, stock group-by). 50 concurrent users on a 0.25 CU Neon = a 200-query burst precisely at the moment of an admin edit. Latent today (near-zero traffic) but it is the #1 scaling cliff on the public path.
- **Fix sketch**: per-process `Map<string, Promise<unknown>>` of in-flight loads inside `cacheWrap` (set on miss, delete in `finally`, return the shared promise); optionally Redis `SET NX EX` for cross-instance later.
- **Effort**: S.

### F-3 · Neon cold-start path for the first real visitor after ≥5 min idle **[P2]**
- **Evidence**: keep-alive cron removed by design (`jobs/cron.ts:241-269` — free-tier quota rationale); opportunistic maintenance creates no timers (`lib/opportunistic.ts:38-39`); the R117 warmup probe (`routes/health.ts:254-263`) only absorbs the resume penalty **inside the health aggregate** — it does not warm the path for `/api/products`. Cloudflare is DNS-only (R117-A4; re-confirmed via headers this round — no `cf-ray`), so `Cache-Control: s-maxage=60` on catalog routes (`routes/products.ts:44`) caches nowhere but the browser. Pool `idleTimeoutMillis=30 s` (`shared/db/src/index.ts:57`) drops idle clients, so the first request also pays a fresh TLS connect to Neon (sandbox handshake measured 1,246 ms; from the app ≈ 2×RTT+TLS ≈ 300–500 ms).
- **Impact**: first storefront DB-touching request after an idle window: pool reconnect (~0.3–0.5 s) + Neon resume (0.5–2 s, per R117's 5/5 degraded aggregates) → a 1–2.5 s outlier for exactly one visitor per idle period, on top of F-1's RTT. Not measurable in this census (DB was kept awake by the audit itself) — flagged from component measurements + R117 live evidence.
- **Fix sketch** (operator decision): (a) **re-enable Cloudflare proxy (orange cloud)** for the zone/hostname — edge then serves `s-maxage=60` catalog + sitemap and immutable assets, absorbing most anonymous cold traffic at zero Neon cost (also closes R117-A4's "no edge cache" P3); (b) alternatively accept the outlier (React Query + retry already mask it); (c) a 4-min `SELECT 1` keep-alive would consume ~190 CU-h/month on 0.25 CU ≈ the entire Neon free allowance — **not recommended**. Note: whether the *live* process even carries the R117 warmup probe depends on the pending deploy (F-10) — HEAD does.
- **Effort**: S (DNS toggle) / M (if combined with origin-header audit).

### F-4 · `admin_alerts` has no index supporting its three read paths **[P3]**
- **Evidence**: only indexes are `admin_alerts_pkey` and `idx_admin_alerts_dedupe_key (dedupe_key, created_at)` (`shared/db/src/schema/admin_alerts.ts:24`); reads are `ORDER BY created_at DESC LIMIT/OFFSET` (`jobs/alertLogger.ts:207-214`), `is_read=false ORDER BY created_at DESC LIMIT 50` (`routes/admin/alerts.ts:92-110`) and unread-count (`alertLogger.ts:229-235`). Q13–Q15: seq scan + sort on all three (0.073–0.085 ms @ 123 rows).
- **Impact**: every open admin tab polls `/new` + `/unread-count`; cost grows linearly with table size. Bounded by the daily retention (unread auto-read at 14 d, read rows deleted at 30 d — `alertLogger.ts:276-281`), so this stays small **if** retention keeps running; a dark scheduler (the R101 class) would let it grow unchecked.
- **Fix sketch**: `CREATE INDEX idx_admin_alerts_created ON admin_alerts (created_at DESC);` or a partial `WHERE NOT is_read` covering index for `/new`. Trivial data volume; drizzle mirror emit required per repo invariant.
- **Effort**: S.

### F-5 · Admin orders 5-column LIKE search is a 3-table join scan **[P3]**
- **Evidence**: `routes/admin/orders.ts:152-166` — `LOWER(order_code) LIKE … OR LOWER(COALESCE(u.phone,…)) … u.email … u.display_name … p.name` over `orders ⋈ users ⋈ products`. Q17: seq scans on all three tables + filter (0.723 ms @ 7 orders / 18 users / 59 products).
- **Impact**: grows linearly with orders×users; at ~50 k orders expect ~0.5–1 s per palette search. Admin-only, debounced 300 ms (`frontend/src/pages/admin/orders.tsx:457-460`), so no user-facing risk today.
- **Fix sketch**: when orders pass ~10 k, split the search (search orders by `order_code` via its UNIQUE index / trgm; resolve user-identities and product names in a second keyed lookup) or push user/product identity columns onto a denormalized admin view. Do nothing now.
- **Effort**: M (defer).

### F-6 · Pool idle timeout (30 s) churns TLS handshakes against a far-away DB **[P3]**
- **Evidence**: `shared/db/src/index.ts:57` `idleTimeoutMillis = 30_000` (default; no `DB_IDLE_TIMEOUT_MS` pin found in deploy configs). Neon handshake measured 1,246 ms from this sandbox (2–3× that vs a cold path); the app's steady RTT is ~100 ms (F-1).
- **Impact**: on a low-traffic store, most requests >30 s apart open a **new** TLS connection to us-east-1 — an extra ~0.3–0.5 s on precisely the requests that are also paying F-1/F-3. Raising to ~4 min (under Neon's 5-min suspend) removes the churn for sub-4-minute gaps while suspended connections still die at 5 min and are replaced lazily by the pool's error handling.
- **Fix sketch**: set `DB_IDLE_TIMEOUT_MS=240000` in the service env; no code change (env is already read).
- **Effort**: S.

### F-7 · Catalog aggregate subqueries scan full `inventory`/`orders` per uncached list load — growth watch **[P3]**
- **Evidence**: `routes/products.ts:248-266` — `stock_sub` groups over **all** unsold deliverable inventory, `order_sub` groups over **all** completed orders, on every cache miss. Q1 plan confirms full seq scans (by design at 13/7 rows). `available_only` pushes `COALESCE(stock) > 0` into the join filter.
- **Impact**: fine at current scale and mostly shielded by the 30 s in-process cache; at ~100 k inventory rows each uncached load becomes a ~50–150 ms aggregate + the F-2 stampede multiplier. Not actionable now — record as the first thing to revisit when inventory crosses ~10 k rows (partial `idx_inventory_sold` already helps the `is_sold=false` leg).
- **Fix sketch** (then): maintained per-product stock counter column, or keep aggregate + add single-flight (F-2).
- **Effort**: M (defer).

### F-8 · Frontend: admin orders table re-renders every row per keystroke; filter chain unmemoized **[P3]**
- **Evidence**: `frontend/src/pages/admin/orders.tsx:632-633` — controlled `value={search}` `onChange setSearch` (local state, no debounce on the *render* path — only the network is debounced at :457-460); rows rendered inline at :1124 (mobile) and :1335 (desktop) up to 200 rows; `statusCounts`/`byStatus`/`byDate` recomputed every render (:480-493) with no `useMemo`.
- **Impact**: each keystroke re-renders up to ~400 row subtrees with inline handlers/className closures. Admin-only; noticeable jank only at 200 rows on low-end devices.
- **Fix sketch**: `useMemo` the filter chain on `[allOrders, statusFilter, dateRange]`; extract an `OrderRow` component wrapped in `memo` (or render one layout, not two). Wallet ledger entries (`wallet.tsx:454`) have the same inline-map shape on a smaller list (≤100) — same fix pattern.
- **Effort**: S/M.

### F-9 · Bulk status update awaits one notification insert per order **[P3]**
- **Evidence**: `routes/admin/orders.ts:607-622` — `for (const o of updatedOrders) { await notifyOrderStatusChanged(...); import(socket)... }` — N sequential single-row INSERTs (`src/notify.ts:30-33`) for an N-order batch (≤200 by the B2-F4 clamp). The refund loop at :450-489 is **deliberately** sequential (per-order atomic money op — correct, documented, and its notification is fire-and-forget).
- **Impact**: a 200-order bulk flip = 200 sequential ~100 ms RTT inserts ≈ 20 s admin request (worst case, far DB). Admin-only; no correctness issue.
- **Fix sketch**: batch the notification inserts (`INSERT ... VALUES (rows)` in one statement) and fire the socket emits after.
- **Effort**: S.

### F-10 · Live deploy is not HEAD — live measurements reflect an older build **[P3]**
- **Evidence**: live `index.html` entry script is `/assets/index-DcWfE6PS.js`; the repo build (R117-V2, HEAD) emits `index-BTNM_6lU.js`. Production is still running the pre-`f10bb9b…ef3d0c3` chain (consistent with R117's "production running pre-r104/r105 code, awaiting first boot" operational note).
- **Impact**: none for correctness of this audit's code findings (all cited at HEAD); live latency numbers include the older bundle's behavior. Any bundle-budget deltas after deploy should be re-baselined.
- **Fix sketch**: operator deploys the pending chain (already on main) and re-runs the two-line census.
- **Effort**: S (operator).

---

## 4. VERIFIED-OK (evidence-checked this round)

1. **No N+1 on hot paths** — catalog list batches variants + per-pool stock in exactly 2 queries for the whole page (`routes/products.ts:105-141`, called once at :311); cart read is 3 queries for N items + 30 s flash-sale cache (`routes/cart.ts:104-130`); user orders = one join, `limit ≤ 200` (`routes/orders.ts:91-103`); admin orders = one 3-table join, paginated (`admin/orders.ts:168-192`); stockWatcher uses one grouped COUNT (`jobs/stockWatcher.ts:43-48`); notifications list is a single indexed query (`routes/notifications.ts:17-25`).
2. **Cache invalidation is wired at every mutation site** — `bumpCatalogCache()` at `admin/products.ts:246,316,367`, `admin/product-variants.ts:214,322,366`, `admin/flash-sales.ts:209,338,379`, `admin/pricing-config.ts:65,196`; sitemap bumped alongside products (`admin/products.ts:246,316,367` via `bumpSitemapCache`). TTLs (30–60 s) bound any cross-process/Redis staleness; price authority stays at checkout (STALE_* rejections, documented `lib/catalog-cache.ts:14-26`).
3. **Memory LRU fallback is bounded** — 5,000 entries **and** 12 MB byte budget with LRU eviction (`lib/cache.ts:38-49, 93-105`); the unbounded `?search=` keyspace is excluded from caching entirely (`routes/products.ts:214-236`) — R111 B6-02 fix intact.
4. **healthz aggregate is single-flighted** — 15 s cache + shared in-flight promise + 8 s absolute timeout + R117 unmeasured warmup probe (`routes/health.ts:29-38, 241-263`); measured warm `summary` = 0.778 s ≈ network floor, status `ok`.
5. **Route-level lazy loading is complete** — every page incl. admin via `lazyWithRetry` (`frontend/src/App.tsx:38-79`), sole eager page import is `not-found` (:23); Toaster lazy-on-idle (:89-92).
6. **vendor-charts (403,540 B raw / 109,425 B gzip) never loads for storefront users** — `recharts` imported only by `pages/admin/dashboard.tsx:47` and `pages/admin/system.tsx` (both lazy); it is **not** in `index.html`'s `modulepreload` set (only react/icons/utils/router/query). The string in the entry chunk is Vite's dynamic-import chunk map.
7. **vendor-firebase (153,638 B / 44,168 B gzip) is runtime-lazy** — only `lib/firebase.ts` imports firebase, via `await import("firebase/app")` / `await import("firebase/auth")` (:26, :53); not modulepreloaded.
8. **Entry budget holds** — `index-BTNM_6lU.js` 89,361 B raw / **27,082 B gzip** ≤ 27.12 KB gate (R117-V2 printed 27,122 — same file, tiny tool-delta).
9. **Fonts are lean and all-used** — 3 weights (400/600/700) × (arabic+latin) woff2 = 74,864 B precached; all three weights used in the UI (778 `font-bold` / 113 `font-semibold` / 8 `font-normal`); `font-display: swap` baked in by @fontsource (`src/index.css:15-23`); woff1 fallbacks are not precached (sw.js manifest lists only the 6 woff2 + CSS + html + favicon = 357,696 B total, 75.7 % of which is the CSS at 270,562 B raw / 31,664 B gzip).
10. **Storefront images are optimized** — 45/45 webp, largest 34 KB (youtube-premium), **0 files > 60 KB**, `loading=lazy` for grid index ≥ 4 and eager for the first 4 (LCP), explicit width/height (no CLS), `decoding="async"` (`components/ProductCard.tsx:352-367`; `dist/public/products` = 616 KB total).
11. **ProductCard is memoized with a field-level custom comparator** (`components/ProductCard.tsx:523-538`) — the 45-item catalog grid does not re-render on unrelated state changes; cart state is split into commands/state contexts (`lib/cart.tsx:103-104`) to narrow re-render blast radius.
12. **Pool topology is sound** — runtime pool max 8 + dedicated advisory-lock pool max 2 (R117 fix, `shared/db/src/index.ts:122-126`) = 10 worst-case connections vs Neon's 100; `statement_timeout` 15 s + TCP keepalives; widest parallel fan-out in any request is 4 queries (`routes/products.ts:377`, `admin/stats.ts:47`); no `Promise.all` inside transactions (grep: none in checkout.service).
13. **Every list endpoint is bounded** — catalog hard `LIMIT 500` (`products.ts:296`); user orders ≤ 200 (`orders.ts:88-89`); admin orders ≤ 200 + offset (`admin/orders.ts:142-146`); alerts 50/200 + page + total (`admin/alerts.ts:30-41`); risk events limit+1 hasMore pattern (`admin/risk.ts:151-155`); wallet ledger ≤ 200 (`routes/wallet.ts:192-193`); notifications 40; auth-activity 100.
14. **Search LIKE-injection + trgm coverage** — `escapeLikeTerm` on every user LIKE (`products.ts:241`, `admin/orders.ts:151`); `idx_products_name_trgm` (GIN) exists for catalog ILIKE at scale (planner justly prefers seq scan at 59 rows).
15. **Opportunistic maintenance cannot add latency** — fire-and-forget + throttle + re-entry guard (`lib/opportunistic.ts:69-99`); triggering requests never await it.

---

**Findings by severity: P1: 0 · P2: 3 · P3: 7 (+15 VERIFIED-OK)**

*Audit surface: 52 backend route/service/lib files read or grepped; 18 live EXPLAIN plans; 17 bounded live GET probes; 95 build chunks + sw.js manifest analyzed. No repo files modified; scripts under /home/z/my-project/scripts/r118_a6_\*.*
