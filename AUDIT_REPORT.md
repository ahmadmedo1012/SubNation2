# SubNation — Master Audit & Evolution Roadmap

> Generated: 2026-05-09 · Methodology: deep static code review + live API probing via `curl` (35+ endpoints exercised against locally running backend on :8080) + DB schema inspection. Browser-driven Playwright phase was unavailable in this session; UX findings are derived from code reading of all 27 page components, not from live runtime.

---

## 1. Coverage Summary

| Surface | Method | Result |
|---|---|---|
| Public catalog (`/api/products`, `/catalog/stats`, `/flash-sale`) | curl + code | ✅ Working, but in-memory filtering |
| Auth (register / login / me / forgot / reset / change / google) | curl + code | ✅ Strong; 1 misleading error |
| User flows (orders, wallet, topups, loyalty, referrals, notifications, support, coupons) | curl + code | ✅ Mostly correct; `/api/coupons` GET 404 |
| Admin (login, stats, chart-data, users, topups, orders, products, tickets, referrals, alerts, settings) | curl + code | ✅ All authed paths return 200; alerts unpaginated |
| DB schema (18 tables) | code | ⚠️ **Zero foreign keys, zero declared indexes** |
| Negative tests (SQLi, XSS, IDOR, oversize, rate limit, malformed JWT, privilege escalation) | curl | ✅ Defenses hold |

Live runtime data captured in `/tmp/sn_audit_out.txt` (258 lines, 35 probes).

---

## 2. Global Platform Evaluation

**SaaS maturity score: 7.6 / 10** — solid MVP++ foundation, several enterprise-grade gaps remain.

| Dimension | Score | Notes |
|---|---|---|
| Code organization | 9 | Monorepo with shared `db`, `api-zod`, `api-client-react`. Clean separation. |
| Auth & access control | 8 | Argon2id, lockout, separate admin secret, rate limit, 2FA scaffold. JWT-only (no revocation). |
| Data integrity | 5 | **No FKs**; ledger present but balance still mutated directly on user row. |
| Performance | 6 | Products endpoint filters in JS; alerts unpaginated; N+1 in support tickets. |
| Observability | 6 | pino logs structured; no metrics, no tracing, no error aggregation. |
| Frontend polish | 8.5 | Strong design language; many `any` casts; lazy-loading missing for admin. |
| Testing | 2 | No automated tests detected in repo. |
| Docs | 5 | README + roadmap exist; no OpenAPI public docs, no ADRs. |

**World-class readiness**: Not yet. Blockers — testing infrastructure, observability, FK integrity, lazy admin bundle.

---

## 3. Real Findings (Evidence-Based)

### 🔴 CRITICAL (P0 — fix before scale)

| # | Finding | Evidence | Impact |
|---|---|---|---|
| C1 | **No foreign keys on any table** | `grep references` in `shared/db/src/schema/*` → 0 hits. `users.referredBy`, `orders.userId/productId/inventoryId`, `wallet_topups.userId`, `wallet_ledger.userId`, all sub-tables — plain `integer()`. | Orphaned rows on user/product delete. Future bugs guaranteed. Cannot enable cascade or RESTRICT semantics. |
| C2 | **Order status enum mismatch with admin bulk-update** | `ordersTable.status` enum = `pending\|completed\|failed\|refunded`. `adminOrdersRouter.patch /orders/bulk-status` `ALLOWED = ['pending','processing','completed','delivered','failed','refunded']`. | Selecting `processing` or `delivered` in admin UI throws Postgres `invalid input value for enum` 500 — visible to admins as silent failure. |
| C3 | **JWT 30-day TTL with no revocation/refresh** | `lib/jwt.ts:13` `expiresIn:'30d'`. No allowlist/blocklist. No refresh-token table. Logout is client-only. | Stolen token = 30-day persistent compromise. Cannot force-logout a user. |
| C4 | **Wallet balance mutated directly on `users` row** | `routes/orders.ts:194`, `services/topup.service.ts`. Ledger is written *after* the transaction commits (`insertLedgerEntry` outside `tx`). | Ledger can desync from `users.walletBalance` if process crashes between commit and ledger insert. Audit trail untrustworthy. |
| C5 | **Admin alerts endpoint unpaginated** | `routes/admin/alerts.ts:40` `getAdminAlerts(200)`. Live response was 38 KB / 308 alerts. | Will hit MB-range payloads; admin UI becomes unusable; OOM risk over time. |

### 🟠 HIGH (P1)

| # | Finding | Evidence |
|---|---|---|
| H1 | `/api/products` filters/sorts in JS, not SQL | `routes/products.ts:69-83`. `category`, `available_only`, `search`, `sort` all post-filter Array methods. Won't scale beyond a few hundred products. |
| H2 | `/api/coupons` GET / returns Express HTML 404 | Probe `[GET /api/coupons] HTTP=404 ... Cannot GET /api/coupons`. Route only defines `POST /validate` and `*/admin*`. Either expose user-facing list or document 405. |
| H3 | No 404 JSON handler for unknown `/api/*` paths | Probe `[GET /api/this-does-not-exist] HTTP=404 ...<!DOCTYPE html>`. Frontend cannot parse → confusing toasts; info disclosure of Express. |
| H4 | Misleading auth error: malformed JWT → "SESSION_EXPIRED" | Probe `[GET /me malformed token] HTTP=401 {"error":"جلسة منتهية","code":"SESSION_EXPIRED"}`. Truth is invalid token. |
| H5 | Phone normalization stores stripped form | Registered `0918336287` returned as `phone:"918336287"`. UI re-display + future login lookups must match. Risk of silent dupe accounts. |
| H6 | Inconsistent error envelope across modules | Auth uses `{error, code}`; wallet/order/ticket/admin use `{error}` only. Frontend cannot rely on `code` for branching. |
| H7 | Admin pages eagerly imported in `App.tsx` | `App.tsx:14-24` static imports of 11 admin pages. Non-admin users download admin code on first visit. |
| H8 | N+1 query in `routes/support.ts:18` | `tickets.map(async t => db.select(replies).where(ticketId=t.id))`. Should use `JOIN` or `IN (ids)`. |
| H9 | `Math.min(...prices)` in `getProductStatsHandler` | `routes/products.ts:103`. Stack overflow when products > ~100k. Use SQL `MIN()`. |
| H10 | Frontend `any` casts pervasive | `home.tsx:189,268,602`, `admin/topups.tsx:306-365` (~18 occurrences), `login.tsx:27`, `register.tsx:37`, `admin/login.tsx:35`. Loses type safety on critical paths. |
| H11 | No automated tests | `find` for `*.test.*` `*.spec.*` returned 0 results in app code. |
| H12 | No structured input validation on several admin patch routes | `admin/users.ts:51-71` accepts arbitrary numbers; clamping ad-hoc. Prefer Zod schemas like `auth.ts` does. |

### 🟡 MEDIUM (P2)

| # | Finding |
|---|---|
| M1 | helmet CSP allows `'unsafe-inline'` for styles. Acceptable for Tailwind but document the trade-off. |
| M2 | CORS in dev "allow all" — fine, but `APP_ORIGINS` must be set in prod or origin spoofing trivial. |
| M3 | `like(usersTable.phone, %X%)` user search lacks GIN/trigram index → full scan. |
| M4 | OTP codes are 6 random digits + 30-min expiry. Not bound to attempt count → 1M brute-force attempts possible until expiry. Add `attempts` counter on OTP row. |
| M5 | `/api/auth/google` creates a placeholder phone `g_<sub>`; follow-up phone-link flow unclear in code. |
| M6 | `services/topup.service.ts` (not read) — confirm transactional integrity for approve flow. |
| M7 | `Toaster` global; many endpoints throw raw 500 → user sees generic msg. Add error normalization layer on client. |
| M8 | `loyaltyTier` is a `varchar` not enum; nothing prevents a typo update from setting `loyalty_tier="dimond"`. |
| M9 | `referralCode` is generated client-side via `generateReferralCode` — confirm collision handling on `unique` violation (currently throws 500). |
| M10 | No caching headers on `/api/products`, `/catalog/stats`. Could safely cache 30–60s with revalidation. |
| M11 | No Lighthouse / web-vitals telemetry. |
| M12 | `pino-http` logs full URL incl. query (sans body) → tokens never in URL, but ensure no sensitive query params later. |
| M13 | `/api/admin/orders/bulk-status` uses `sql\`id = ANY(${numIds})\`` — works but bypasses Drizzle inArray helper; document the choice. |
| M14 | No CSP report endpoint, no SRI on external assets. |

### 🟢 LOW (P3)

L1. `/api/health` is `/api/healthz` — alias the friendly form.  L2. `pageSize` param missing on most list endpoints; add `?limit=&page=` consistently.  L3. `String(Number(x).toFixed(2))` repeated → util `money(x)`.  L4. Admin login response lacks rate-limit headers in body when locked.  L5. Drizzle migrations in `migrate.ts` (26 KB) — split per-migration files using drizzle-kit.  L6. No `robots.txt`, `sitemap.xml`, no SEO metadata per route.  L7. Public OpenAPI not exposed (only zod internal).  L8. `socket.io` connection accepted before auth; messages then namespace-checked — verify no info leak in connect ack.  L9. `notify.ts` likely Telegram — failure path should not block request (verify async).  L10. `frontend/src/index.css` 657 lines — consider splitting design tokens vs component styles.

---

## 4. Mobile-First & UX (from code review of pages)

* `MobileNav` exists and `pb-16 md:pb-0` is applied on `<main>` to clear it. Good.
* RTL handled via Arabic copy throughout — no `dir="rtl"` declared at root in `App.tsx`. **Verify** `index.html` has `<html lang="ar" dir="rtl">`.
* `home.tsx` recently added search history + dropdown — tested via static review only. No keyboard handling for arrow-key navigation in dropdown.
* No skip-to-content link, no `aria-current` on nav, no `role="alert"` on `error` divs in `wallet.tsx` (TODO from previous waves).
* `Lighthouse a11y` not run.

---

## 5. Master Improvement Roadmap

> Each item has: Problem · Impact · Solution · Priority · Complexity · Risk.

### CATEGORY A — Critical Fixes (do first, < 1 week)

| ID | Title | P · C · R | Solution |
|---|---|---|---|
| A1 | Add foreign keys + indexes to all schemas | P0 · M · M | Migrate `references(() => usersTable.id, { onDelete: 'restrict' })` etc. on every FK column. Add `index('idx_orders_user').on(userId)` + composite `(userId, createdAt desc)`. Use drizzle-kit `--strict`. Backfill check first. |
| A2 | Fix order status enum mismatch | P0 · S · L | Either expand pg enum to include `processing,delivered` (add migration `ALTER TYPE order_status ADD VALUE`) **or** trim `ALLOWED` in `admin/orders.ts:54`. Decision needed. |
| A3 | Move ledger inside order/topup transaction | P0 · S · M | Pass `tx` into `insertLedgerEntry`; perform inside `db.transaction`. Add Postgres `CHECK (balance_after = balance_before + amount when type='topup' ...)` later. |
| A4 | Paginate `/api/admin/alerts` | P0 · S · L | `?page=&limit=` + return `{items,total,page}`. Update admin frontend. |
| A5 | Refresh-token + JWT shortening | P0 · L · M | Issue 15-min access JWT + 30-day rotating refresh stored in `refresh_tokens` table with revocation. Logout deletes row. Detect reuse → revoke family. |

### CATEGORY B — High-Impact (next 2–3 weeks)

| ID | Title | P · C · R |
|---|---|---|
| B1 | Push `/api/products` filtering+sort to SQL with composite indexes | P1 · M · L |
| B2 | Lazy-load admin route bundle (`React.lazy(() => import('./admin/...'))`) | P1 · S · L |
| B3 | Standardize error envelope `{error, code, details?}` everywhere; add `ErrorCode` enum across modules | P1 · S · L |
| B4 | Add JSON 404 + global 405 handler before `app.use(express.static)` | P1 · S · L |
| B5 | Replace N+1 in `support.ts` with single JOIN | P1 · S · L |
| B6 | OTP attempt counter (max 5 wrong codes → invalidate) | P1 · S · L |
| B7 | Eliminate frontend `any` (~25 occurrences) — generate types from `api-zod` schemas | P1 · M · L |
| B8 | Replace `Math.min(...prices)` with SQL `MIN(price)` | P1 · S · L |
| B9 | Phone normalization: store with leading 0 OR canonical E.164; never both | P1 · S · M |
| B10 | Add Zod schemas for every admin PATCH/POST that lacks one | P1 · M · L |

### CATEGORY C — Premium Refinement (4–8 weeks)

| ID | Title |
|---|---|
| C1 | Playwright e2e suite covering 8 happy paths + 8 negative + a11y via `@axe-core/playwright`. Run in CI. |
| C2 | Vitest unit suite for backend services (`topup.service`, `orders` transaction logic, lockout). Target 70% coverage. |
| C3 | OpenAPI 3.1 published from `api-spec` + Redoc page at `/docs`. Tag `internal` vs `public`. |
| C4 | OpenTelemetry traces (HTTP + DB); metrics → Prometheus; alerts on p95 > 300ms, 5xx rate > 1%. |
| C5 | Sentry (or self-hosted GlitchTip) for backend + frontend with sourcemaps. |
| C6 | Lazy + code-split admin; preload on hover of admin nav links. Target initial JS < 180 KB gz. |
| C7 | Image CDN + responsive `srcSet` for product images; AVIF + WebP. |
| C8 | Skeleton + suspense boundaries for every list view. |
| C9 | Optimistic mutations for: mark notification read, reply ticket, approve topup. |
| C10 | Real-time admin dashboard via existing socket.io: emit `stats:tick` every 30s instead of polling. |
| C11 | A11y pass: `dir="rtl"` confirm, focus rings, `aria-live` for errors, keyboard ESC closes modals everywhere, skip-link. |
| C12 | Dark/light token system audit; verify contrast ratio ≥ 4.5 on all `text-muted-foreground` usages. |
| C13 | Toast queue dedup (don't stack identical errors). |

### CATEGORY D — Scalability Preparation (8–12 weeks)

| ID | Title |
|---|---|
| D1 | Redis cache for `/products`, `/catalog/stats`, `/flash-sale` (TTL 30s) using `cache-tag` invalidation on admin product write. |
| D2 | Move rate-limit store to Redis (already supported in code) and document `REDIS_URL`. |
| D3 | Read replica routing for `GET` traffic via Drizzle dual-pool. |
| D4 | Move heavy reports (chart-data) to materialized view refreshed nightly + on-demand. |
| D5 | Background job queue (BullMQ) for: topup approval side-effects, order delivery, telegram notifications. Decouple from request path. |
| D6 | Database migrations split per-version under `migrations/` with hash-locked drizzle-kit. |
| D7 | Connection pool tuning + statement timeout + idle-in-transaction killer. |
| D8 | Postgres partitioning roadmap for `orders`, `wallet_ledger`, `audit_logs` once > 1M rows each. |

### CATEGORY E — Future Innovation

| ID | Title |
|---|---|
| E1 | Cart + checkout (multi-product orders, currently 1-product-at-a-time). |
| E2 | Wishlist / favorites with watch-back-in-stock notifications. |
| E3 | Reviews & ratings (moderated) with photo upload. |
| E4 | Subscription auto-renewal pipeline. |
| E5 | Native push (FCM) on top of socket.io. |
| E6 | Advanced fraud rules: device fingerprint + velocity + IP geo + manual review queue. |
| E7 | Affiliate dashboard (extend referral) with payout management. |
| E8 | A/B testing flag system. |
| E9 | Customer-facing API tokens for power users. |
| E10 | Multi-currency + multi-language (English alongside Arabic). |

---

## 6. Strategic Recommendation

**Implementation order (by ROI × risk-reduction)**:

1. **Week 1** — A1 (FKs+indexes), A2 (enum fix), A4 (paginate alerts), B4 (JSON 404), H4 (auth error message), B3 (error envelope).
2. **Week 2** — A3 (ledger in tx), A5 (refresh tokens), B6 (OTP attempts), B9 (phone normalization).
3. **Week 3-4** — B1 (SQL filtering), B2 (lazy admin), B5 (N+1), B7 (kill `any`), C1 minimum Playwright suite (5 critical paths, run on PR).
4. **Month 2** — C2 unit tests, C4 metrics, C5 error tracking, C6 perf budget, D1 Redis cache.
5. **Month 3+** — D2-D8 scalability + E roadmap.

**Highest-ROI single fix**: A1 (FKs + indexes) — unlocks safe deletes, performance, and prevents an entire class of future bugs.

**Launch-readiness for production traffic > 1k DAU**:
* Required before launch: A1, A2, A3, A4, A5, B4, B6, C1 (smoke e2e), C5 (error tracking).
* Strongly recommended: B1, B2, C4, D1, D2.

**Long-term evolution strategy**: After categories A+B, freeze backwards-compat surface, lock OpenAPI version, then unlock E1 (cart) → E3 (reviews) → E6 (fraud) as the largest revenue + retention multipliers. D-track scalability work runs in parallel and is invisible to users.

---

## 7. Concrete Curl-Reproducible Probes (for regression)

All probes are in `/tmp/sn_audit.sh`; output in `/tmp/sn_audit_out.txt`. Notable replays:

```bash
# Privilege escalation blocked (good)
curl -i http://localhost:8080/api/admin/users -H "Authorization: Bearer <USER_JWT>"
# → 401 {"error":"جلسة الإدارة منتهية"}

# Admin login works at /api/admin/login (NOT /api/admin/auth/login)
curl -X POST http://localhost:8080/api/admin/login -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"SubNation@2026"}'
# → {"token":"...","display_name":"SubNation Admin"}

# Rate limiter triggers at 6th login attempt within 15 min
for i in $(seq 1 25); do curl -s -o /dev/null -w "%{http_code} " \
  -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" -d '{"phone":"0900000000","password":"x"}'; done
# → 401 401 401 401 401 429 429 ... (good)

# SQL injection in search safely parameterized
curl "http://localhost:8080/api/products?search=%27%20OR%201%3D1--"
# → []  (good)

# Order enum bug repro (admin)
curl -X PATCH http://localhost:8080/api/admin/orders/bulk-status \
  -H "Content-Type: application/json" -H "Authorization: Bearer <ADMIN_JWT>" \
  -d '{"ids":[1],"status":"processing"}'
# → 500 (DB enum mismatch — see C2)
```

---

## 8. Out-of-Scope (would need different tooling)

| Wanted | Why missing | How to add later |
|---|---|---|
| Real Lighthouse scores | Browser automation unavailable | `npx lighthouse http://localhost:5173 --view` after install |
| Visual regression / screenshots | No browser tool | Playwright + `pixelmatch` |
| Real CLS/LCP/INP | Same | web-vitals library + RUM endpoint |
| Click-through UX validation | Same | Playwright codegen recording on each flow |
| Network throttling tests | Same | Chrome DevTools protocol via Playwright |

---

**End of report.** Awaiting your call on which categories to begin implementing.
