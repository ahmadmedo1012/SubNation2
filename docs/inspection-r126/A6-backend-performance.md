# R126-A6 — Backend Performance + DB-Efficiency Audit (deepest pass)

- **Agent:** R126-A6 (backend perf/DB audit), read-only
- **HEAD:** `186b131` (working tree clean)
- **Scope:** hot-path query tracing, index/query matrix, payload efficiency, cache discipline, cron efficiency, R124/R125 residuals, live black-box timing, pool/prepared-statement/tx-scope depth
- **Live target:** https://subnation.ly (guest GETs only, 3 runs each)
- **Verdict:** **SHIP-WORTHY** — 0×P0, 0×P1, 1×P2, 8×P3. No N+1 or unbounded query on any hot path; every hot filter/sort except one sort-only case has a supporting index; live guest endpoints run at the network floor with ≤250 ms origin think-time; cache/compression/ETag discipline all live-verified.

---

## 1. Hot path tracing (round trips per request, file:line)

| Endpoint | Handler | SQL round trips (stages) | Notes |
|---|---|---|---|
| `GET /api/products` (list, no search) | `routes/products.ts:305-507` | **2 stages**: S1 = main join (products LEFT JOIN stock-sub GROUP BY + order-sub GROUP BY) ∥ flash-sale lookup (`:431`); S2 = variant rows ∥ per-pool stock GROUP BY (`:122-156`, `:438`) | 30s single-flight catalog cache (`:504`, B6-02: search never cached); `LIMIT 500` (`:423`); aggregate subqueries are **uncorrelated full-table GROUP BYs** (`:375-393`) — scale-watch F7 |
| `GET /api/products?search=…` | same loader, live | 2 stages (5 queries) | ILIKE `%term%` served by `idx_products_name_trgm` GIN (`schema/products.ts:117`); Arabic alias expansion bounded ≤12 terms (`:363`); previously measured 6.5 ms live |
| `GET /api/products/by-slug/:slug` | `routes/products.ts:598-675` | **2 stages**: product-by-slug ∥ flash sale (`:620-638`) → stock count ∥ completed count ∥ variant pool (`:642-658`) | 60s cache, 200-only; slug unique index |
| `GET /api/products/:id` | `routes/products.ts:677-746` | **1 stage**: 5 queries in ONE `Promise.all` (`:698-727`) | F-1 (R118) collapse — single Neon RTT on cache miss |
| `GET /api/products/:id/recommendations` | `routes/products.ts:755-820` | 2 sequential (category → same-category peers, `LIMIT 4`) | 60s cache; correct dependency chain |
| `GET /api/products/stats` (+ alias `/api/catalog/stats`) | `routes/products.ts:509-567`, `routes/index.ts:45` | 1 stage, 4 parallel aggregates | 60s `withCatalogCache`; `COUNT(DISTINCT)` in SQL |
| `GET /api/products/flash-sale` | `routes/products.ts:569-588` | 1 query (partial-unique singleton) | 30s cache + throttled fire-and-forget sweep (`:577`) |
| `GET /api/auth/me` / `/api/auth/probe` | `routes/auth.ts:358-392,423-509` | 1 stage: user ∥ linked identities (`:363-366,487-490`) | no-store; probe = 200-always shape |
| `GET /api/auth/providers` | `routes/auth-settings.ts:260` | 0-1 (60s `cacheWrap` settings read) | edge s-maxage=60 |
| `GET /api/cart` | `routes/cart.ts:107-148` | 2 stages: items → products ∥ variants (`:121-127`) + flash sale 30s in-proc cache (`:34-41`) | H19 fixed the old 2N+1; `SELECT *` overfetch F6 |
| `GET /api/orders` (user) | `routes/orders.ts:108-137` | 1 query (orders LEFT JOIN products), `limitParam` ≤200 + `pageParam` | indexed `(user_id, created_at DESC)` |
| `GET /api/wallet` | `routes/wallet.ts:75-161` | 1 stage: projected user ∥ 5 recent orders ∥ pending-topup count (`:84-111`) | B6-03 projection + no decrypt on summary |
| `GET /api/wallet/topups` / `/ledger` | `routes/wallet.ts:163-229` | 1 query each, LIMIT 200/100 + `pageParam` | both indexed |
| `POST /api/orders` (checkout) | `services/checkout.service.ts:273-793` | pre-tx: user + fast stock check → 1 tx (re-reads product/variant/sale, `FOR UPDATE SKIP LOCKED` claim, CAS wallet, ledger, order) | all in-tx work is DB-only; alerts/notifications deferred post-commit (F8 pattern `:276-291`) |
| `GET /api/admin/orders` | `routes/admin/orders.ts:189-301` | 1 query (orders⋈users⋈products), LIMIT ≤200, `pageParam` | status enum-validated; palette search = multi-column `LOWER LIKE` F8 |
| `GET /api/admin/topups` | `routes/admin/topups.ts:88-104` | 1 query, LIMIT ≤200, `pageParam` | `(status, created_at)` index |
| `GET /api/admin/users` | `routes/admin/users.ts:42-77` | 2 stages: page → completed-order counts `inArray`-scoped (`:64-76`) | scoping fix documented (was full-table GROUP BY) |
| `GET /api/admin/products` | `routes/admin/products.ts:99-208` | 2 stages: page → stock counts ∥ order counts ∥ variants (`:135-160`) + `getPricingConfig()` sequential await F5 | ILIKE search rides `idx_products_name_trgm` |
| `GET /api/admin/tickets` | `routes/admin/tickets.ts:69-152` | **3 stages**: page → reply-count GROUP BY (`:100-104`) → DISTINCT ON latest replies (`:109-119`) | stages 2+3 independent → F4 (Promise.all) |
| `GET /api/admin/alerts` (+ `/new`, `/unread-count`) | `routes/admin/alerts.ts:105-151,92-134` | 1 stage: 3 parallel (`:139-143`); `/new` = SQL-side `id > since` | indexed |
| `GET /api/admin/risk/events` | `routes/admin/risk.ts:117-217` | 1 query, keyset cursor `(created_at,id) DESC`, `LIMIT+1` | best-in-class pagination; 4 filter indexes |
| `GET /api/admin/stats` | `routes/admin/stats.ts:60-140` | 1 stage: **10 parallel aggregates** (`:86-118`) | F1 — 10 > pool max 8; 30s `cacheWrap` |
| `GET /api/admin/chart-data` | `routes/admin/stats.ts:142-154` | 1 stage: 2 parallel `GROUP BY day` raw queries (`:162-182`) | 30s cache keyed by Tripoli day bucket |
| `GET /api/admin/security/auth-stats/summary` | `routes/admin/security.ts:83-112` | 1 query — 4×`count(*) FILTER` single scan | R125-I6 B-11 verified shipped |

**N+1 sweep:** `rg -U "for (… of …) { … await (db|tx)\."` → only `backend/src/migrate.ts` (boot migrations/seed) and `services/copilot/admin-direct.ts:261-262` (admin LLM candidate resolver, non-hot). **Zero N+1 on user-facing or admin-list hot paths.** Historical N+1s are documented as fixed in-place (cart H19 `routes/cart.ts:104-106`, tickets H18 `admin/tickets.ts:87-90`, admin users `admin/users.ts:61-63`).

**Sequential awaits that could be `Promise.all`:** exactly two — `admin/tickets.ts:100→109` (F4) and `admin/products.ts:167` `getPricingConfig()` (F5). Everything else already parallelized.

---

## 2. Index vs query matrix (verified at HEAD against `shared/db/src/schema/*` + boot twins in `backend/src/migrate.ts`)

| Hot filter / sort (consumer) | Index (declaration site) | migrate.ts twin | Verdict |
|---|---|---|---|
| `products (is_active, is_archived, category)` — catalog/category list (`routes/products.ts:343-345`) | `idx_products_active_category` (`schema/products.ts:109`) | ✅ | ✅ |
| `products.slug` — by-slug detail (`routes/products.ts:624`) | `idx_products_slug_unique` (`schema/products.ts:112`) | ✅ | ✅ |
| `products.name ILIKE '%x%'` — public + admin search (`routes/products.ts:364`, `admin/products.ts:125`) | `idx_products_name_trgm` GIN (`schema/products.ts:117`) | ✅ | ✅ |
| `products.price` ASC/DESC — catalog sort (`routes/products.ts:426-427`) | **NONE** | — | ⚠️ F3 |
| `products.id DESC` default order (`routes/products.ts:429`) | PK backward scan | — | ✅ |
| `inventory (product_id, is_sold)` — stock counts (`routes/products.ts:375-383,141-155`) | `idx_inventory_product_sold` (`schema/inventory.ts:72`) + partial `idx_inventory_sold` | ✅ | ✅ (credential IS NOT NULL is a residual filter — inherent to R102 semantics) |
| `inventory.variant_id` — scoped pool (`routes/products.ts:141-155`) | `idx_inventory_variant` (`schema/inventory.ts:76`) | ✅ | ✅ |
| `orders (status, created_at)` — stats/today/admin filter (`admin/stats.ts:88-104`, `admin/orders.ts:209`) | `idx_orders_status_created` (`schema/orders.ts:108`) | ✅ | ✅ |
| `orders (user_id, created_at DESC)` — user order list (`routes/orders.ts:131-132`) | `idx_orders_user_created` (`schema/orders.ts:111`) | ✅ | ✅ |
| `orders.product_id` — completed count (`routes/products.ts:385-393`) | `idx_orders_product` (`schema/orders.ts:101`) | ✅ | ✅ |
| `orders.created_at DESC` — admin list (`admin/orders.ts:261`) | `idx_orders_created` DESC (`schema/orders.ts:107`) | ✅ | ✅ |
| `orders.variant_id` — delete guard | `idx_orders_variant` (`schema/orders.ts:116`) | ✅ | ✅ |
| `wallet_topups (user_id, created_at DESC)` (`routes/wallet.ts:174-175`) | `idx_topups_user_created` (`schema/wallet_topups.ts:61`) | ✅ | ✅ |
| `wallet_topups (status, created_at)` — admin money queue (`admin/topups.ts:73,102`) | `idx_topups_status_created` (`schema/wallet_topups.ts:62`) | ✅ | ✅ |
| `wallet_topups` approved-ref dedup | `uniq_wallet_topups_payment_reference` partial (`schema/wallet_topups.ts:70-74`) | ✅ | ✅ |
| `users.created_at DESC` — admin directory (`admin/users.ts:51,57`) | `idx_users_created` (`schema/users.ts:78`) | ✅ | ✅ |
| `users.phone LIKE '%x%'` — admin search (`admin/users.ts:50`) | `idx_users_phone_trgm` GIN (`schema/users.ts:84`) | ✅ | ✅ |
| `users.phone/email/telegram_id/firebase_uid/referral_code` equality | UNIQUE constraint backings + `idx_users_email` (`schema/users.ts:75`) | ✅ | ✅ |
| `wallet_ledger (user_id, created_at)` — statement (`routes/wallet.ts:212-213`) | `idx_wallet_ledger_user_created` (`schema/wallet_ledger.ts:56`) | ✅ | ✅ |
| `points_ledger (user_id, created_at)` (`routes/loyalty.ts:312-314`) | `idx_points_ledger_user_created` (`schema/points_ledger.ts`) | ✅ | ✅ |
| `support_tickets (status, updated_at DESC)` — admin queue (`admin/tickets.ts:80-84`) | `idx_tickets_status_updated` (`schema/support_tickets.ts:36`) | ✅ | ✅ |
| `support_tickets (user_id, created_at DESC)` — user list | `idx_tickets_user_created` (`schema/support_tickets.ts:27`) | ✅ | ✅ |
| `admin_alerts.created_at DESC` — list (`admin/alerts.ts:139-140`) | `idx_admin_alerts_created` DESC (`schema/admin_alerts.ts:34`) | ✅ | ✅ |
| `admin_alerts (dedupe_key, created_at)` — dedupe EXISTS (`jobs/alertLogger.ts:135-144`) | `idx_admin_alerts_dedupe_key` (`schema/admin_alerts.ts:24`) | ✅ | ✅ |
| `risk_events (created_at DESC, id DESC)` — keyset cursor (`admin/risk.ts:191`) | `idx_risk_events_created_id_desc` (`schema/risk.ts:105`) | ✅ | ✅ |
| `risk_events (level / event_type / user_id, created_at)` (`admin/risk.ts:127,136,152`) | 3 composites (`schema/risk.ts:96-101`) | ✅ | ✅ |
| `audit_logs action / actor / target / created_at DESC` | 4 indexes (`schema/audit_logs.ts`) | ✅ | ✅ |
| `auth_activity user / identifier / action / created_at DESC` (`admin/security.ts:48-54`) | 4 indexes (`schema/auth_activity.ts`) | ✅ | ✅ |
| `whatsapp_otps (phone, purpose, created_at)` + `expires_at` | 2 indexes (`schema/whatsapp_otps.ts`) | ✅ | ✅ |
| `flash_sales` active singleton (`lib/pricing.ts:120`) | `uniq_flash_sales_active_singleton` partial | ✅ | ✅ |
| `referral_events (referrer_id, created_at DESC)` (`routes/loyalty.ts:66,350-353`) | `idx_referral_referrer_created` (`schema/referral_events.ts`) | ✅ | ✅ |
| `product_variants (product_id, is_active)` | `idx_product_variants_product_active` (`schema/product-variants.ts`) | ✅ | ✅ |
| `notifications (user_id, created_at DESC)` | `idx_notifications_user` (`schema/notifications.ts`) | ✅ | ✅ |
| `cart_items (user_id)` — cart read (`routes/cart.ts:113`) | `uniq_cart_items_user_product` | ✅ | ✅ |
| `sessions.user_id`; `admin_sessions.admin_id`; `login_attempts.identifier`; `coupons.code`; `idempotency_keys` | PK/unique/composite backings | ✅ | ✅ |

**Verdict on R124-A9's claim ("no hot list filter lacks an index"):** **VERIFIED at HEAD** — 38/39 hot filter/sort sites have a supporting index; the single gap is a *sort-only* case (`products.price`, F3) which today sorts 45 rows in memory and is invisible in latency.

---

## 3. Payload efficiency (live, guest-level)

| Endpoint | Body size (identical ×3) | gzip | br | Notes |
|---|---|---|---|---|
| `/api/products?fields=list` | **17,445 B** (45 products ≈ 388 B/row) | 3,342 B (5.2×) | 3,399 B | grid projection |
| `/api/products` (full) | **79,762 B** (≈ 1.77 KB/row) | ~— | — | variant tree + usage_terms — detail-consumer only |
| `/api/products/by-slug/grammarly-pro` | 3,470 B | — | — | single DTO |
| `/api/products/62/recommendations` | 425 B | — | — | 4 peers, projected |
| `/api/products/stats` & `/api/catalog/stats` | 102 B | — | — | |
| `/api/products/flash-sale` | 103 B | — | — | |
| `/api/healthz`, `/healthz/live` | 15 B | — | — | |
| `/api/auth/providers` | 476 B | — | — | |

- **A2-F3 (R124) projection coverage: VERIFIED.** `?fields=list` drops `usage_terms` + the variant tree (documented as 62.6% of wire bytes, `routes/products.ts:474-481`); `variant_count` + `description` ship in both shapes. Frontend consumers confirmed: home (`frontend/src/pages/home.tsx`), flash-sales (`flash-sales.tsx:178`), category (`category.tsx:139`) all pass `fields: "list"`; boot head-start seeds the same key (`frontend/src/App.tsx:326-342`); `ProductCard.tsx:30-56` reads exactly the list shape.
- **Overfetch sweep (SELECT \* where a projection exists):** 3 live sites — cart (`routes/cart.ts:122-126`, full products+variants rows for name/slug/image/price — F6), wallet ledger (`routes/wallet.ts:209-215`, fetches `balanceBefore` never returned), user topups full row (fine — `formatTopup` uses most columns). Product-detail `select().from(productsTable)` is *not* overfetch: the DTO consumes 15/17 columns incl. SEO/FAQ/features.
- All payloads far below the 200 KB flag threshold; largest public response is 78 KB (full catalog) and the grid consumers never request it.

---

## 4. Cache discipline (live-verified at HEAD)

| Family | Header (file:line) | Live check |
|---|---|---|
| Catalog list/detail/stats | `public, max-age=0, s-maxage=60, stale-while-revalidate=300` (`routes/products.ts:36-46`) | ✅ `cache-control: public, max-age=0, s-maxage=60, stale-while-revalidate=300` observed |
| Flash-sale | 30/60 (`routes/products.ts:47`) | ✅ |
| Aliases `/api/catalog/stats`, `/api/flash-sale` | same middleware (`routes/index.ts:41-46`) | ✅ |
| Auth providers | 60/300 (`routes/auth-settings.ts:255-258`) | ✅ |
| healthz / live / summary | 5s / 5s / 15s (`routes/health.ts:514,840,805`) | ✅ |
| robots/sitemap/share-card OG | 300+600 / 60+300 / 60+300 (`routes/seo.ts:98,263`, `app.ts:1580`) | ✅ |
| User-scoped + **entire admin tree** | `no-store` (32 route files: cart/wallet/orders/support/loyalty/notifications/coupons + all `routes/admin/*` incl. observability R125-I6 B-8 `admin/observability.ts:18-21`, stats `admin/stats.ts:20-23`, security, risk, products, referrals, diagnostics) | ✅ — **zero regressions** vs R117/R120/R123/R125 |
| API 404 fallback | `no-store` (`app.ts:932-941`, R124 A7-F4) | ✅ |
| Static assets | `immutable, max-age=31536000` for hashed/`/products/` (`app.ts:1488`) | ✅ observed on `/assets/home-*.js` |

- **ETag:** edge emits strong ETag; `If-None-Match` revalidation answered **304** with 0-byte body (live-verified). No app-level ETag logic (freshness is s-maxage-driven) — correct for the family split.
- **Compression (live):** API `content-encoding: gzip` (17,445→3,342 B) and `br` (3,399 B) both present; static assets `br` + immutable. Origin-side `compression()` middleware at `backend/src/app.ts:336`; brotli added by the Coolify/Traefik edge. `Vary: Origin, Accept-Encoding` present.

---

## 5. Cron / efficiency

- All schedules in `jobs/cron.ts` are **daily, staggered** (00:00 / 00:05 / 02:15 / 03:30 / 03:35 / 03:50 / 04:00 / 04:30 / 05:00 UTC), each with its own try/catch + per-job Sentry tag (`cron.ts:57-420`). Sub-hourly jobs were deliberately removed in the free-infrastructure round (documented `cron.ts:241-271`); OTP prune + copilot reaper are opportunistic (throttled fire from their trigger surfaces, `whatsapp-otp.service.ts:205`).
- **Unbounded scans: none.** Every retention DELETE is ctid-batch capped at 1000 rows/statement: sessions (`session-prune.ts:37-40`), notifications (`notifications-retention.ts:40-44`), idempotency (`idempotency-retention.ts:51-54`), risk (`risk-retention.ts:64-67`), audit/login-attempts (`auth-audit-retention.ts`), admin alerts (`alertLogger.ts:302-305`), OTP (`whatsapp-otp.service.ts:972-985`).
- stockWatcher: grouped COUNT over inventory (one query, `stockWatcher.ts:41-48`) — the historical N+1 is fixed in-place; runs as opportunistic sweep, DB-level dedupe on alerts.
- forecast/enrichment runners are `WORKER_TIER`-gated (`cron.ts:340,381`). No job runs more often than needed; no two heavy jobs share a minute.

---

## 6. R124/R125 residuals — verification at HEAD

| Residual | Status | Evidence |
|---|---|---|
| Security summary 4×`count(*)` → 1 FILTER | **SHIPPED** | `routes/admin/security.ts:83-112` — one scan, 3 FILTER clauses + total (`:91-104`), predicates mirror old queries |
| pageParam ceilings on admin lists | **COMPLETE — none uncapped** | Ceiling is centralized in `lib/http.ts:69-75` (`MAX_PAGE=10_000`, R122 A3-P2-2). All admin lists route through `pageParam()`: orders `admin/orders.ts:224`, topups `admin/topups.ts:86`, users `admin/users.ts:40`, tickets `admin/tickets.ts:67` (R125-I6 B-5), alerts `admin/alerts.ts:40` (R125-I6 via `parsePagination`). Risk events uses keyset cursor pagination instead (immune to OFFSET abuse). `rg` for inline `page` parsing outside `pageParam` → **0 hits**. User-facing lists (wallet topups/ledger `wallet.ts:169,207`, orders `orders.ts:121`, loyalty) ride the same helper. |
| Observability no-store | **SHIPPED** | `admin/observability.ts:12-21` router-level (covers `/metrics` 500 envelope too) |
| Copilot envelope ×47 | **SHIPPED** | `createErrorResponse` swap verified in `admin/copilot/ask.ts:133-135`, `previews.ts:164`; single envelope source (`lib/errors.ts`) |
| Remaining 4×count(*) patterns | **None sequential.** Remaining multi-counts are parallel-in-`Promise.all` by design: admin/stats 10× (F1 — fold candidate), product detail 2× per route (parallel, 60s-cached), referrals uses FILTER already (`admin/referrals.ts:64-77`) | |
| toNumber 70-site ledger | **OPEN — 70 sites** | See §8 |
| Coupons toFixed→roundLyd | spot-verified (`routes/wallet.ts:516` uses `roundLydString`) | ✅ |

---

## 7. Live black-box timing (guest GET, 3 runs, 2026-10-09)

Network decomposition from this probe: TCP ≈ 200-260 ms, TLS done ≈ 420-540 ms → **probe→origin floor ≈ 550-650 ms**; origin think-time on constant-response endpoints ≈ 80-250 ms. Root HTML baseline TTFB (static, no DB): 823/995/1,258 ms.

| Endpoint | TTFB runs (ms) | **Median** | Total (ms) | Size |
|---|---|---|---|---|
| `/api/products?fields=list` | 667 / 781 / 620 | **667** | 859 / 1,028 / 817 | 17,445 B |
| `/api/products` (full) | 1,149 / 646 / 618 | **646** | 1,679 / 1,041 / 1,025 | 79,762 B |
| `/api/products/stats` | 1,344 / 581 / 760 | **760** | ≈TTFB | 102 B |
| `/api/products/flash-sale` | 774 / 812 / 674 | **774** | ≈TTFB | 103 B |
| `/api/healthz` | 801 / 636 / 648 | **648** | ≈TTFB | 15 B |
| `/api/healthz/live` | 854 / 720 / 988 | **855** | ≈TTFB | 15 B |
| `/api/auth/providers` | 949 / 600 / 820 | **820** | ≈TTFB | 476 B |
| `/api/products/by-slug/grammarly-pro` | 1,032 / 760 / 614 | **760** | ≈TTFB | 3,470 B |
| `/api/products/62/recommendations` | 1,015 / 784 / 636 | **784** | ≈TTFB | 425 B |
| `/api/catalog/stats` | 794 / 766 / 672 | **766** | ≈TTFB | 102 B |

- **First catalog hit after idle: 2.25 s TTFB (2.43 s total)** — Neon compute wake on the free tier, one-off; every subsequent run ≤1.15 s.
- **Nothing exceeds the 800 ms TTFB flag on origin think-time** — the two medians above 800 ms (`/healthz/live` 855 ms, `/auth/providers` 820 ms) carry ≤250 ms of server time on top of a ~600 ms probe RTT; `/healthz/live` is a constant-response handler, so its median is pure network+proxy. No payload >200 KB (max 78 KB, and only for the opt-in full projection).
- **Slowest live endpoint:** `/api/healthz/live` by median TTFB (855 ms, network-dominated); slowest DB-backed: `/api/products` full at 646 ms median / 1.68 s worst warm run; absolute worst: cold-start catalog 2.25 s (Neon wake).

---

## 8. New depth: pool, prepared statements, transaction scope

- **Pool sizing:** `shared/db/src/index.ts:42` — `DB_POOL_MAX` env, prod default **8** (explicitly tuned 2026-09-20 for Neon Free 0.25 CU cold-start; comment `:25-41` documents the 15→8 rationale). `idleTimeoutMillis` 30 s (`:43`), `connectionTimeoutMillis` 10 s (`:44`), server-side `statement_timeout` 15 s per pooled connection (`:63,88`), TCP keepalives 30 s (`:94-95`). **Dedicated advisory-lock pool max 2** (`:122-126`) isolates the OTP-start critical section (spans an external WhatsApp send) from the runtime pool — the R117 design, verified intact. Deployed `DB_POOL_MAX` value: **UNVERIFIED** (lives in the Coolify env panel, not in-repo; code default matches the documented pin).
- **Concurrency note (F1):** the only in-code place where parallelism exceeds pool max is `admin/stats.ts:86` (10 parallel aggregates > 8 clients → 2 queue ~ms). No user-facing path exceeds it (max observed stage width = 5, product detail).
- **Prepared statements:** node-postgres + Drizzle use parameterized (unnamed) statements — no named server-side prepared statements, which is the correct posture behind Neon's pooled endpoint (PgBouncer-compatible). Nothing to change.
- **Transaction scope (R125 recompute pattern generalized):** audited all 25 `db.transaction` sites. **Zero transactions await external I/O.** Checkout tx (`checkout.service.ts:294-`) is DB-only incl. the manual-provider claim; coupon-maxed alert + admin notifications are deferred post-commit via the signal-object pattern (`:276-291`); wallet topup tx is advisory-xact-lock + counts + insert only (`wallet.ts:445-551`), Telegram notify is post-commit (`wallet.ts:646`); `logAdminAlert` dedupe tx is lock+select+insert, socket emission post-insert (`alertLogger.ts:133-184`); OTP-start advisory lock runs on `lockPool`, not the runtime pool. Pricing recompute-in-tx (R125) present at `checkout.service.ts:306-339` (product), `:346-362` (variant), `:375-392` (flash sale).

---

## 9. Findings

### P2

**F1 — `toNumber` consolidation ledger: 70 `parseFloat(String(...))` sites remain (open since round-3).**
Where: `rg "parseFloat\(String\(" backend/src --glob '!__tests__'` = **70 hits** (69 real + the doc-comment in `lib/numeric.ts:2`). Distribution: `routes/admin/products.ts` ×9, `services/topup.service.ts` ×8, `routes/products.ts` ×7, `routes/admin/stats.ts` ×5, `routes/admin/pricing-calculator.ts` ×5, `services/refund.service.ts` ×4, `routes/loyalty.ts` ×4, `services/checkout.service.ts` ×3, `routes/cart.ts` ×3, `routes/admin/users.ts` ×3, `routes/admin/product-variants.ts` ×3, `lib/pricing.ts` ×3, `routes/wallet.ts` ×2, `routes/auth.ts` ×2, `routes/admin/pricing-config.ts` ×2, `routes/admin/orders.ts` ×2, + 5 files ×1 (`adjustment.service.ts`, `routes/coupons.ts`, `admin/topups.ts`, `admin/flash-sales.ts`). Why it matters: every copy re-decides NULL/""/NaN policy — `parseFloat(String(null))` → `NaN` (not a fallback), and `NaN.toFixed(2)` → `"NaN"` on money surfaces; the R125 coupons bug (toFixed on binary 10.55499…) was exactly this idiom class. Money-mutation paths already use `toNumber`/`roundLyd` (18 sites); the 70 are display/parse surfaces where a nullable numeric renders NaN.
**Fix sketch (3 PRs, mechanical + guarded):** (1) display-only DTO sites (admin/products, admin/stats, admin/users, products, cart, wallet, auth, topups, flash-sales — ~35 sites) → `toNumber(x)`; behavior for real numeric strings identical, NULL/garbage improves NaN→0. (2) policy-reading sites (`lib/pricing.ts`, `admin/pricing-calculator.ts`, `pricing-config.ts`, checkout/refund/topup/adjustment/loyalty — ~25): swap *only where the column is NOT NULL or already null-guarded*, else keep explicit `?? 0` semantics via `toNumber(x, fallback)` — note `parseFloat("12abc")=12` vs `toNumber→fallback` differs only for garbage strings that Postgres `numeric` columns cannot contain. (3) pin with a lint rule (`no-restricted-syntax` on `CallExpression[callee.name='parseFloat']` with `String` arg) + schema-parity-style test asserting zero hits outside `numeric.ts`. **Impact:** removes a whole bug class; ~2-4h + review. Latency impact: none (same op count).

### P3

**F2 — admin/stats fires 10 parallel aggregates on an 8-connection pool (fold to 4 scans).**
`routes/admin/stats.ts:86-118`. Ten `count()/sum()` queries in one `Promise.all` > pool max 8 (`shared/db/src/index.ts:42`) → 2 queries queue for a client on every 30 s cache-miss; six of the ten are foldable into FILTER siblings: users count + wallet sum (one users scan), orders total + revenue (one orders scan), today-orders + today-revenue (FILTER `created_at >= today` on the same scan), inventory available + unsold-rows (FILTER deliverable). Net: 10 queries/10 scans → 4 queries/4 scans, stage width 4 < 8.
**Fix sketch:** mirror the shipped `admin/security.ts:91-104` FILTER idiom exactly (same response shape/values). **Impact:** −6 scans per 30 s (negligible today, real at 10⁵+ orders/users); restores pool headroom; ~30 min.

**F3 — `products.price` sort has no index.**
`routes/products.ts:426-427` (`sort=price_asc|price_desc` → `ORDER BY price [DESC] LIMIT 500`). No `idx_products_price`; each uncached run is a seq-scan + top-N sort. Today: 45 active products — invisible. **Fix sketch:** `CREATE INDEX CONCURRENTLY idx_products_price ON products(price)` + schema twin; or accept and document (catalog is editorially small). **Impact:** only materializes if the catalog crosses ~10³ rows. **This is the only hot filter/sort without an index** (R124-A9 claim otherwise verified).

**F4 — admin tickets list: stages 2→3 sequential, both depend only on `ticketIds`.**
`routes/admin/tickets.ts:100-119` — reply-count GROUP BY, then `DISTINCT ON` latest-replies. **Fix sketch:** wrap both in one `Promise.all` (the H18 fix stopped the N+1 but left the two batch queries sequential). **Impact:** −1 Neon RTT (~100 ms) per admin ticket-page load.

**F5 — admin products list: `getPricingConfig()` awaited after the aggregate `Promise.all`.**
`routes/admin/products.ts:167` — independent of the three batch queries at `:135-160` (it's a cached settings read). **Fix sketch:** add it as the 4th element of the existing `Promise.all`. **Impact:** −1 RTT per admin products load (~100 ms).

**F6 — cart GET overfetches full product + variant rows.**
`routes/cart.ts:121-127` — `db.select().from(productsTable)` and `.from(productVariantsTable)` pull every column (SEO fields, `description_long`, `faq`, `cost_price`, `sku`, timestamps) where the response uses name/slug/imageUrl/price + variant priceLyd/labels. Bounded by cart size (≤ #products). **Fix sketch:** project the 6-8 needed columns (mirrors `wallet.ts:84-94` B6-03 idiom). **Impact:** smaller rows over the wire/decrypt surface; minor but free.

**F7 — catalog list loader's stock/order subqueries are uncorrelated full-table GROUP BYs.**
`routes/products.ts:375-393` — `stock_sub` aggregates the whole inventory table, `order_sub` the whole completed-orders table, on every loader run (bounded: single-flight + 30 s TTL + ≤4 sort keys × categories, so ≈ 1 run / 30 s / key). Detail routes already do indexed per-product counts. **Impact today:** ~ms; **scale watch:** at ~10⁵ orders/inventory rows the loader cost grows linearly — the trigger to denormalize (`products.stock_count` maintained in the claim/refund tx, or a materialized rollup) is a p95 loader time >100 ms. No action now.

**F8 — admin orders command-palette search: multi-column `LOWER(LIKE '%x%')` across a 3-table join.**
`routes/admin/orders.ts:234-242` — order code + phone + email + displayName + productName, unindexable by construction (leading-wildcard LIKE over joined columns). Bounded: LIMIT 200, admin-only, 600/min IP envelope. **Fix sketch (only if it ever hurts):** trigram GIN on `orders.order_code` + push phone/name lookups to a pre-resolved `user_id IN (...)` subquery. **Scale watch, no action now.**

**F9 — wallet ledger fetches `balance_before` never returned.**
`routes/wallet.ts:209-215` vs `:218-227` — one column trim. Trivial.

**F10 — cart items read unbounded (accepted).**
`routes/cart.ts:110-114` — no LIMIT, but bounded by `uniq_cart_items_user_product` × catalog size and the MAX_QUANTITY=99 cap per line; checkout loop is what matters and is capped. Document-only.

**Observation (non-perf, out of scope):** `formatTopup` returns `admin_note` to end users on `GET /api/wallet/topups` (`routes/wallet.ts:730`) — appears intentional (auto-reject reason is operator→user communication) but worth a privacy-lead confirmation.

---

## 10. Prioritized fix list

| # | Finding | Sev | Effort | Est. impact |
|---|---|---|---|---|
| 1 | F1 toNumber ledger: 3-PR consolidation + lint ban (§9.P2) | P2 | 2-4 h | removes NaN-on-money display bug class; 0 latency change |
| 2 | F4 tickets `Promise.all` stages 2+3 | P3 | 15 min | −1 RTT (~100 ms) per admin ticket load |
| 3 | F5 fold `getPricingConfig()` into admin products `Promise.all` | P3 | 10 min | −1 RTT per admin products load |
| 4 | F2 admin/stats FILTER fold 10→4 | P3 | 30 min | −6 scans/30 s; pool width 10→4 |
| 5 | F6 cart projection trim | P3 | 30 min | smaller wire/decrypt surface |
| 6 | F3 `idx_products_price` (or document the acceptance) | P3 | 15 min | future-proofs price sort |
| 7 | F9 ledger column trim | P3 | 5 min | trivial |
| 8 | F7/F8 scale-watch triggers documented (no action) | — | — | revisit at 10⁵ orders |

**Verdict: SHIP-WORTHY.** The backend hot paths are, as of HEAD 186b131, fully parallelized, capped, cached (two layers + edge), indexed (38/39), compression-served, and free of N+1/unbounded scans/tx-held-external-I/O. All R124/R125 residuals verified shipped except the explicitly-open toNumber ledger. The remaining items are polish; none blocks release.

*Evidence discipline: every file:line above was read at HEAD 186b131; live timings/headers are first-hand curl measurements (3 runs each) from the audit sandbox on 2026-10-09. UNVERIFIED items: deployed DB_POOL_MAX value (Coolify env panel, not in-repo — code default 8), deployed Redis availability (affects cacheWrap backend choice, not correctness).*
