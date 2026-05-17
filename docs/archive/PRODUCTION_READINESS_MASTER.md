# SubNation — Production Readiness Master Report

**Generated:** 2026-05-16  
**Audit scope:** entire repo (51,186 LOC TS/TSX), Render service `srv-d7vv91tckfvc73evnccg`, Neon Postgres, Redis Cloud singleton, Firebase project `subnation-2571e`, Sentry org+project at o4511397349097472.  
**Live state at audit time:** commit `45633f2` ready to deploy; previous live `296a4e0`. Production canonical: `https://subnation.ly`.

This is the **single** living production-readiness document. All earlier topical reports (`ALERTING_ARCHITECTURE.md`, `METRICS_AND_MONITORING.md`, `REDIS_OPERATIONS.md`, `REDIS_SETUP.md`, `CACHE_STRATEGY.md`, `SEO_AND_CWV_REPORT.md`, `SENTRY_BACKEND_SETUP.md`) have been **archived to `.kiro/specs/observability-seo-cwv-maturity/inspection-data/`** with their content folded into this report and the surviving architecture docs (`OBSERVABILITY_SETUP.md`, `DOMAIN_RUNTIME_ARCHITECTURE.md`, `RTL_LAYOUT_ARCHITECTURE.md`, `REDIS_RUNTIME_ARCHITECTURE.md`).

---

## 0. Executive snapshot

| Dimension | Score | Evidence |
|---|---|---|
| Functional production-readiness | **8.5 / 10** | Custom domain, Firebase auth on canonical, Redis live, observability wired, alerting real, CWV pipeline working, /admin/system observability center live |
| Security guardrails | **7 / 10** | Helmet CSP correct for Firebase + reCAPTCHA, HSTS preload, argon2id, admin TOTP, lockout, rate-limit-redis. Gaps below in Phase 1. |
| Backup & recovery | **3 / 10** | Only Neon free-tier 7-day branch history; no app-driven snapshot, no tested restore. |
| Performance | **7 / 10** | Bundle 21.7 KB gzip on index, lazy admin chunks, compression on, response-time p95 typically <300 ms. DB pool max=5 is tight for admin concurrency. |
| Mobile UX | **8 / 10** | RTL locked at boot, mobile-first grids, PWA precache 60 entries, sticky bottom nav, autocomplete=one-time-code on OTP input. |
| Admin reliability | **8 / 10** | /admin/system has 10 panels with live metrics + sparklines, scheduler banner correctly reflects embedded mode, alerts/diagnostics/observability all consume real data. |
| Test coverage | **3 / 10** | 80 tests across 9 files; none touch the auth router (1100+ LOC). High blast radius in untested auth code paths. |

**The platform is launchable today.** The work below is hardening, not blockers — except the items flagged 🔴 in Phase 1 (CSRF gap on auth, duplicate /sessions handler) which should land before opening signup to outside traffic.

---

## 1. Architecture inventory (what exists right now, audited byte-for-byte)

### 1.1 Backend runtime
- **Express 5** + **pino-http** (with correlation-id propagation) + **Sentry Node** sidecar at `backend/src/instrument.ts`.
- **Redis singleton** at `backend/src/lib/redis-client.ts`: 30 s ping watchdog, fail-closed in production (`process.exit(1)` on connection failure), in-memory fallback in dev. Used by rate-limit-redis, alerting service, scheduler-coordinator leader lock, worker:heartbeat, Socket.IO Redis adapter.
- **DB pool** at `shared/db/src/index.ts`: `pg@8.20.0` with `max=5, idleTimeoutMillis=10000, connectionTimeoutMillis=30000` (just-tuned during the Neon outage). SSL `rejectUnauthorized: true`. Honors `?channel_binding=require` on URL.
- **Web schedulers** (`backend/src/lib/web-scheduler.ts`): heartbeat (15 s) + alerting evaluator (60 s) + couponWatcher + stockWatcher + otpCleanup + cron, **all running embedded in the web process** under a Redis leader lock. No dedicated worker service.
- **22 Drizzle schema tables**: `users, sessions, otps, login_attempts, auth_activity, user_auth_identities, organizations, admin_users, admin_alerts, audit_logs, products, inventory, orders, wallet_topups, wallet_ledger, coupons, flash_sales, support_tickets, ticket_replies, referral_events, notifications`.
- **Auth flows**: 3 paths — password (argon2id, optional disable via `ALLOW_PASSWORD_REGISTRATION=false`), Firebase (Google popup + Phone OTP via reCAPTCHA), Telegram bot widget. JWT-based, `httpOnly + sameSite=strict + secure` cookies, 30-day user / 8-hour admin lifetimes.
- **Admin auth**: argon2id + lockout + optional TOTP 2FA (`otplib`).
- **Rate limiting**: `apiLimiter` 300 req/min/IP, `authLimiter` 10 req/15 min/IP (skipSuccessfulRequests=true), plus per-phone OTP limiters in OTP routes. Backed by `rate-limit-redis` with `rl:` prefix.
- **CSP**: Firebase + reCAPTCHA origins allowlisted, no Trusted Types directive (intentional — Firebase SDK creates internal policies), COOP `same-origin-allow-popups`, COEP disabled, HSTS preload.

### 1.2 Frontend
- **Vite + React** SPA, lazy-loaded admin chunks (manualChunks splits `vendor-react`, `vendor-query`, `vendor-utils`, `vendor-firebase`, `vendor-sentry`, `vendor-recharts`, etc.).
- **Sentry React** with replay enabled (text masking on), reactErrorHandler on createRoot, ErrorBoundary forwards to Sentry with React component stack.
- **Web vitals** beacon (`onLCP/onFCP/onINP/onCLS/onTTFB` from `web-vitals@4`) → POST `/api/cwv` as Blob `application/json` (defensive `text/plain` parser on backend).
- **Document direction** locked at boot via `lib/direction.ts` — single mutator, no flicker.
- **PWA** with workbox, 60 precache entries, masked-text Replay.
- **Bundle budget** plugin enforces 47 KB gzip soft warn on index entry; current 21.7 KB.

### 1.3 Infra
- **Render** web service (`subnation` slug, starter plan, Docker, Oregon region) at `subnation.ly` apex + `www.subnation.ly` (301 → apex via app middleware as defence; Render edge handles primarily).
- **Neon Postgres** US-West-2 (free → upgraded after compute-hour exhaustion incident).
- **Redis Cloud** (managed) — used as `rate-limit-redis` store, alerting dedup, scheduler leader lock, worker heartbeat, Socket.IO adapter.
- **Firebase** project `subnation-2571e`: Google Sign-In + Phone OTP enabled, SMS region policy now allows Libya.
- **Sentry** org id `4511397349097472`, project id `4511397448581200`, EU ingest. Frontend DSN public; backend DSN auto-generated by Render (`generateValue: true`).
- **CI/CD**: GitHub Actions `.github/workflows/ci.yml` (gitleaks → lint → typecheck → migration drift → vitest → build) + `deploy.yml` (POST Render deploy hook).

### 1.4 Observability surface (already live)
- `/api/healthz` — base liveness
- `/api/healthz/ready` — aggregate {redis, neon, worker, socket}
- `/api/healthz/{redis,neon,worker,socket,firebase}` — per-service
- `/api/metrics` — Prometheus exposition (admin-gated)
- `/api/admin/diagnostics` — node, memory, CPU, event-loop p50/p95/p99, deps, feature flags
- `/api/admin/observability/{summary,metrics,scheduler,alerts/recent,sentry/summary,deploys/recent}`
- `/api/admin/alerts/*` — alerts CRUD
- `/admin/system` — 10-panel observability center

### 1.5 Doc map (post-cleanup)
- `README.md` — project overview, dev setup, deploy summary
- `PRODUCTION_READINESS_MASTER.md` (this file) — single master report
- `FINAL_RUNTIME_STATE.md` — single living state-of-the-platform doc
- `OPERATIONS_RUNBOOK.md` — on-call playbook
- `OBSERVABILITY_SETUP.md` — architecture (correlation, Pino, Sentry, metrics, health, env vars, alerting registry, channel matrix)
- `DOMAIN_RUNTIME_ARCHITECTURE.md` — request lifecycle, cookies, Firebase, Socket.IO
- `RTL_LAYOUT_ARCHITECTURE.md` — direction tenets, single-mutator API
- `REDIS_RUNTIME_ARCHITECTURE.md` — runtime topology, who uses Redis, failure modes, operational triage, sizing, what-to-cache
- `SECRET_ROTATION_RUNBOOK.md` — rotation steps for committed-then-purged secrets
- `docs/API.md`, `docs/COMPLIANCE.md`, `docs/DISASTER_RECOVERY.md`, `docs/NEON_MCP_SETUP.md`

---

## Phase 1 — Security Hardening

### Objectives
Eliminate the 4 confirmed defects in the auth surface, harden argon2 parameters to OWASP-2024, and add the missing audit log surface for admin write actions.

### Current status
Most of the surface is healthy. CSP, helmet, rate limiting, lockout, TOTP, argon2id are all in place. Defects are localised to specific lines.

### Detected problems (all confirmed by reading source)

| # | Severity | Defect | Location | Evidence |
|---|---|---|---|---|
| 1 | 🔴 high | **CSRF middleware skips `/api/auth/*` entirely.** Login, register, change-password, toggle-password-login, forgot-password, reset-password all bypass origin/referer validation — only the IP rate limiter (10/15 min on `authLimiter`) protects them. | `backend/src/app.ts:332` (`skipPaths = ["/api/auth", "/api/webhook", "/api/cwv", "/health"]`) | The skip blanket-matches `/api/auth/*`. A malicious cross-origin POST from a phishing page can submit credentials and receive the `Set-Cookie: auth_token=...` response if the user is tricked into typing real creds. CSRF token isn't the only mitigation but combined with sameSite=strict cookies the residual risk is moderate, not zero. |
| 2 | 🟠 medium | **Duplicate `router.get("/sessions")` handler** in `auth.ts` (lines 1030 and 1084). Express uses the FIRST registration; the second is dead code AND `sessionsTable` reads return rows that are never inserted. | `backend/src/routes/auth.ts:1030, 1084` | Confirmed via grep. The second `/sessions` reads from real `sessionsTable`; the first returns a synthetic `[{id:"current"}]` from `usersTable.lastAuthAt`. The DELETE at line 1098 deletes from `sessionsTable` — also a no-op since the table is never written. |
| 3 | 🟠 medium | **`sessionsTable` is read + deleted but never inserted.** The auth flow is JWT-only. The schema, the read endpoint, and the delete endpoint all reference rows that nothing creates. | `shared/db/src/schema/sessions.ts` + `routes/auth.ts:1084-1108` | Grep for `sessionsTable.values\|sessionsTable.insert\|insert.*sessions` returns zero hits in `routes/auth.ts`. |
| 4 | 🟡 low | **argon2 defaults** — `argon2.hash(password, { type: argon2.argon2id })` does not pin `memoryCost` or `timeCost`. Default is 19 MB / 2 iterations. OWASP 2024 minimum is 19 MiB / 2 / 1 — we're at the floor. | `backend/src/lib/crypto.ts:5` | Re-hash on verify (`needsRehash`) is correctly wired so a parameter bump self-migrates over a few logins. |
| 5 | 🟡 low | **JWT_SECRET fallback to `process.env.JWT_SECRET`** — historical compat from before the `SESSION_SECRET` rename. If both are unset the throw works, but if `JWT_SECRET` is set in some env config it shadows `SESSION_SECRET` silently. | `backend/src/lib/jwt.ts:3` | Single fallback line. Production env uses `SESSION_SECRET`; the fallback is a nuisance, not a bug. |
| 6 | 🟡 low | **No audit log writes from admin write actions** — `auditLogsTable` schema exists (`shared/db/src/schema/audit_logs.ts`) but no admin route inserts into it. Admin CRUD on products / orders / users / topups is unaudited. | grep `auditLogsTable.values\|insert.*audit_logs` → 0 hits in `routes/admin/**` | Schema has `actorId, actorType, action, targetType, targetId, metadata, ip, userAgent` — perfect for an admin audit trail. Missing helper + call sites. |
| 7 | 🟡 low | **Frontend Sentry DSN is hard-coded** as a fallback in `frontend/src/instrument.ts:25`. While Sentry DSNs are technically public-by-design, having it inline in the source means anyone reading the bundle knows where errors flow. Acceptable for now (Sentry rate-limits ingest from the project itself), but should be env-only at scale. | `frontend/src/instrument.ts:25` | `VITE_SENTRY_DSN` env var is consulted first; fallback is the live DSN. |

### Risks if left
- **#1 CSRF gap** is the only one that materially raises attack surface. Combined with sameSite=strict cookies and no third-party login redirect path that needs the skip, the practical risk is moderate, but it's the single highest-leverage fix in the report.
- #2 / #3 are correctness debt — the second `/sessions` handler returns objects with `id: "session-uuid"` shape that the frontend probably doesn't use anyway, but a future feature that lists user devices will silently get [].
- #4 is forward-looking; current load doesn't justify a CPU hit from heavier argon2 on the free Render plan.

### Implementation plan (in execution order, each independent of the next)

| # | Task | Files | Migration? | Env? | Affects live sessions/auth? | Complexity | Safety |
|---|---|---|---|---|---|---|---|
| 1.1 | Tighten CSRF skip list to `/api/auth/firebase/session` + `/api/auth/firebase/refresh` (Firebase popups send no Origin header in same-origin redirect flows) + `/api/webhook` + `/api/cwv` + `/health`. Login / register / password / sessions all back inside CSRF check. | `backend/src/app.ts:332` | no | no | no (sameSite=strict cookies remain valid; only rejects cross-origin POSTs missing valid Origin) | low | safe immediately — production sends Origin header for all in-app POSTs |
| 1.2 | Drop the first `router.get("/sessions")` (the synthetic one at line 1030). Keep the real one at line 1084 that reads from `sessionsTable`. | `backend/src/routes/auth.ts` | no | no | UI calls `/api/auth/sessions` and gets `[]` instead of `[{current}]` until session-write is wired (1.3) | low | safe immediately, but pair with 1.3 for working device-list UI |
| 1.3 | Wire INSERT into `sessionsTable` on login (+register +Firebase session creation). Generate session id via `crypto.randomUUID()`, write `{id, userId, userAgent, ipAddress, expiresAt = now + 30d}`. On logout DELETE by session id (cookie carries it). | `backend/src/routes/auth.ts` (login, register, Firebase session, logout, logout-all-devices) | **yes** — none, schema already exists | no | yes — JWT remains source of truth; sessions table becomes parallel device-list view. Existing JWTs keep working since the table is additive | medium | safe with feature-flag (`SESSIONS_DEVICE_LIST_ENABLED`); rollback = remove insert calls |
| 1.4 | Pin argon2 parameters: `{ type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 }` (OWASP 2024 recommendation) in `crypto.ts`. The existing `needsRehash` path auto-migrates passwords on next successful login. | `backend/src/lib/crypto.ts` | no | no | no | low | safe immediately; first login per user incurs ~50 ms extra hash time once |
| 1.5 | Drop the `process.env.JWT_SECRET` fallback. Require `SESSION_SECRET` only. Add a startup assertion that `SESSION_SECRET.length >= 32`. | `backend/src/lib/jwt.ts` | no | no | no | low | safe immediately — production already uses SESSION_SECRET |
| 1.6 | Add admin-action audit log helper `writeAuditLog(req, action, targetType, targetId, metadata?)` and call it from every admin POST/PUT/DELETE in `routes/admin/**`. Insert into `auditLogsTable`. | new `backend/src/lib/audit.ts` + edits across `routes/admin/{products,users,topups,orders,coupons,settings,security}.ts` | no — schema exists | no | no | medium | safe (additive); roll back by removing helper calls |
| 1.7 | Move Sentry DSN to env-only. Drop fallback. Update `instrument.ts` to throw at boot in production if `VITE_SENTRY_DSN` is unset (warn in dev). | `frontend/src/instrument.ts` | no | requires `VITE_SENTRY_DSN` set on Render (already is, per render.yaml line at end of file) | no | low | safe — env is already provisioned |

### Database migrations required
- **None.** All schema changes for Phase 1 are in tables that already exist (`sessions`, `audit_logs`).

### Environment changes required
- **None for the fixes themselves.** Drop in 1.7 requires the existing `VITE_SENTRY_DSN` env to be present (it is).

### Production risks
- 1.1 (CSRF tightening) could reject in-app POSTs from a misconfigured mobile browser that doesn't send Origin. Mitigation: keep Referer fallback (already present in `app.ts:344`).
- 1.3 (session writes) could double the DB writes per login if every login inserts a row. With current DB pool max=5 and ~10 logins/min, negligible. At scale, add an index-only delete-on-expiry sweep.

### Rollback
- 1.1: revert one line (skip-list).
- 1.2 / 1.3: revert the commit; existing JWTs keep working.
- 1.4: passwords keep validating with old hashes via `verifyPassword`'s built-in `needsRehash`.

### Dependencies
- 1.2 → 1.3 (logical pair).
- 1.6 is independent.
- All others independent.

### Safe-immediately vs high-risk
| Task | Safe immediately? |
|---|---|
| 1.1 CSRF tighten | ✅ |
| 1.2 drop dup handler | ✅ |
| 1.3 wire session inserts | ⚠ feature-flag recommended |
| 1.4 argon2 params | ✅ |
| 1.5 drop JWT_SECRET fallback | ✅ |
| 1.6 audit log helper | ✅ |
| 1.7 Sentry DSN env-only | ✅ |

---

## Phase 2 — Backup & Recovery

### Objectives
Establish a tested, automatable Postgres backup procedure independent of Neon's free-tier 7-day branch retention. Document a restore drill.

### Current status
- **Neon** (currently on free tier per audit timestamp; user upgraded compute hours during the outage incident): default 7-day branch history. Point-in-time-restore within that window via `Branches → Restore`.
- **Render** disk: not relevant (stateless service).
- **Redis**: not used as a system of record. State is rate-limit windows, alerting dedup, leader lock, heartbeat, Socket.IO pub/sub. Loss = transient blip.
- **No app-driven snapshots, no exported dumps, no tested restore.**

### Detected problems
1. 🟠 No off-site backup. If the Neon project is deleted (accidentally or by malicious access via leaked NEON_API_KEY before rotation completes), data is gone.
2. 🟡 The `docs/DISASTER_RECOVERY.md` (2.7 KB) is a stub — no concrete commands, no tested RTO/RPO.
3. 🟡 No backup retention policy — even if a snapshot script exists, where does it write?
4. 🟡 Schema migrations are reversible by Drizzle in principle but no `down()` migrations are committed (Drizzle doesn't auto-generate them). Manual recovery from a bad migration requires a restore.

### Risks if left
- A `DROP TABLE` accident, a corrupted migration, or a Neon project mishap with no snapshot is catastrophic and not recoverable beyond Neon's 7-day window.
- Free tier branch retention is configurable but defaults are restrictive.

### Implementation plan

| # | Task | Files | Migration? | Env? | Affects live sessions/auth/cache/admin? | Complexity | Safety |
|---|---|---|---|---|---|---|---|
| 2.1 | Add `scripts/backup-db.ts` — a TS script that `pg_dump`s `DATABASE_URL` to a gzipped file, uploads to a target (S3 / Backblaze B2 / Cloudflare R2 — pick one based on cost). Test from local first. | new `scripts/backup-db.ts`, edit `scripts/package.json` | no | requires `BACKUP_BUCKET_URL`, `BACKUP_AWS_ACCESS_KEY_ID`, `BACKUP_AWS_SECRET_ACCESS_KEY` | no | medium | safe — read-only on DB |
| 2.2 | Schedule it: a Render **Cron Job** (separate service, $0/mo on free tier for cron jobs ≤ 15 min) running `pnpm tsx scripts/backup-db.ts` daily at 03:00 UTC. Render dashboard creates the cron job. | `render.yaml` (add cron service block) | no | same as 2.1 | no — runs on a separate service | low | safe |
| 2.3 | Implement retention rotation: keep daily backups for 14 days, weekly for 12 weeks, monthly for 12 months. Built into the script. | `scripts/backup-db.ts` | no | no | no | low | safe |
| 2.4 | Replace `docs/DISASTER_RECOVERY.md` stub with a real runbook: exact restore command for each scenario (single table corruption / full DB loss / migration rollback), tested RTO targets, contact info. | `docs/DISASTER_RECOVERY.md` | no | no | no | low | safe |
| 2.5 | Quarterly restore drill: spin up a new Neon branch, run the latest backup against it, run a smoke test (`SELECT count(*) FROM users`, `SELECT count(*) FROM products`). Document in `OPERATIONS_RUNBOOK.md` §Restore Drill. | `OPERATIONS_RUNBOOK.md` | no | no | no | low | safe |
| 2.6 | Add `scripts/migration-rollback-helper.ts` — given a migration filename, generate the down-migration SQL by inspecting the up-migration file (Drizzle doesn't auto-generate this; we hand-roll for the few migrations we have). | new `scripts/migration-rollback-helper.ts` | no | no | no | medium | safe — read-only |

### Migrations required
- None.

### Env changes
- 2.1 requires backup-bucket credentials. Use a Backblaze B2 bucket with App Key scoped to that bucket only — write+list, no delete on the lifecycle-managed objects (keep delete behind a separate ops key).

### Production risks
- A failed cron job is silent unless we wire alerting. **2.7 (alert on backup failure)** — add a `backup_outcome_total{outcome}` counter, alerting rule fires on `outcome="failure"` for 2 consecutive runs. Already covered by the existing alerting pipeline; just register the rule.

### Rollback
- The backup pipeline doesn't touch live state. Rolling back = remove the cron service.

### Dependencies
- 2.1 → 2.2 → 2.3 (sequential).
- 2.4 / 2.5 / 2.6 independent.

### Safe-immediately vs high-risk
- All Phase 2 tasks are read-only on production. Safe immediately.

---

## Phase 3 — Performance Optimization

### Objectives
Lift DB pool ceiling, add an HTTP cache for the catalogue read paths (currently every `/api/products` hit goes to Neon), shave 20–40 ms off the public homepage's TTFB, and bound bundle growth.

### Current status
- **Bundle**: index entry 21,685 B gzip; budget 47 KB warn. Healthy.
- **DB pool**: `max=5` — **tight**. With 10 concurrent admin operations the pool queues. On free tier the Postgres compute can handle more.
- **No HTTP cache**: `/api/products`, `/api/categories`, `/api/flash-sale` all hit Neon every request. Public catalog pages get re-rendered with fresh data on every navigation.
- **Compression**: enabled via `compression()` middleware (gzip, default level 6). Could move to brotli in front of CDN.
- **Lazy admin chunks**: working — admin code never enters customer bundles.
- **PWA precache**: 60 entries, Workbox runtime caching for products. Mobile cold-start fast.
- **CWV pipeline**: live, ingesting; we don't yet expose p75 LCP / FCP / INP / CLS in the dashboard panels (only sample counts).

### Detected problems

| # | Severity | Problem | Evidence |
|---|---|---|---|
| 1 | 🟠 | DB pool max=5 limits admin concurrency. The /admin/orders page lists+counts+filters in parallel queries; under burst the pool serialises. | `shared/db/src/index.ts:30` |
| 2 | 🟠 | No HTTP cache layer for read-heavy public endpoints. Every `/api/products` is a fresh Neon round-trip. | grep for `cacheControl\|s-maxage\|stale-while-revalidate` in `routes/products.ts` → 0 hits |
| 3 | 🟡 | `recharts` is loaded into the admin bundle eagerly even on routes that don't render charts. Admin sidebar paint waits for the lazy chunk. | `vite.config.ts manualChunks` puts recharts in `vendor-recharts` but the admin layout chunk imports it |
| 4 | 🟡 | No explicit `Cache-Control` on static assets via the SPA fallthrough. Render's edge applies its own defaults. | `app.ts` static-serve block |
| 5 | 🟡 | The public catalog page issues separate fetches for products, flash-sale, and category stats. Could be one batched endpoint. | `frontend/src/pages/home.tsx` (3 useQuery calls) |
| 6 | 🟢 | CWV percentiles not surfaced on `/admin/system`. Backend has the `cwv_sample_value` histogram; UI shows only sample counts. | `backend/src/lib/metrics-snapshot.ts` cwv field is `samples` only |

### Risks if left
- DB pool starvation under modest concurrency — admins hit "خطأ في الخادم" intermittently during stat-heavy operations.
- Without HTTP cache, traffic doubling = DB queries doubling (linear). We're far from that ceiling but it bites at first viral moment.

### Implementation plan

| # | Task | Files | Migration? | Env? | Affects live? | Complexity | Safety |
|---|---|---|---|---|---|---|---|
| 3.1 | Bump `DB_POOL_MAX` to 15 in `render.yaml` and on the live Render env. Neon free tier supports up to 10 connections; with the upgrade to Launch (post-incident) we have 100 concurrent. 15 is a safe ceiling that leaves headroom for the embedded scheduler's connections. | `render.yaml` + live env | no | yes — `DB_POOL_MAX=15` | no — pool is additive | low | safe — pool grows on demand only |
| 3.2 | Add HTTP `Cache-Control` to `/api/products`, `/api/flash-sale`, `/api/catalog/stats`: `public, s-maxage=60, stale-while-revalidate=300`. Render's edge will cache, browsers will revalidate. | `backend/src/routes/{products,catalog}.ts` | no | no | no | low | safe — additive header |
| 3.3 | Add Redis-backed cache for `getActiveFlashSale()` — TTL 60 s. The existing `trackRedisOp` wrapper logs hits/misses to `redis_ops_total`. | `backend/src/jobs/couponWatcher.ts` (or a new `lib/cache/flash-sale.ts`) | no | no | no | medium | safe — `null` falls through to DB |
| 3.4 | Lazy-load `recharts` in admin: import dynamic `() => import("recharts")` inside the system page instead of top-level. Index admin chunk shrinks. | `frontend/src/pages/admin/{system,dashboard}.tsx` | no | no | no | low | safe |
| 3.5 | Bound the `topRoutes` aggregation in `metrics-snapshot.ts` to last-10-min counters via a sliding window. Currently it's all-time since boot, which doesn't reflect "what's hot now". | `backend/src/lib/metrics-snapshot.ts` | no | no | no | medium | safe — display change only |
| 3.6 | Surface CWV p75 in `/admin/system`. Add `cwv.p75 = { lcp, fcp, inp, cls, ttfb }` to the snapshot via histogram-quantile estimation (we already have the helper from Phase observability). | `backend/src/lib/metrics-snapshot.ts` + `frontend/src/pages/admin/system.tsx` | no | no | no | low | safe |
| 3.7 | Edge `Cache-Control: public, max-age=31536000, immutable` on hashed Vite assets (`/assets/*-[hash].js|css|woff|woff2`). | `backend/src/app.ts` static block | no | no | no | low | safe — hashed file names guarantee correctness |

### Migrations required
- None.

### Env changes
- `DB_POOL_MAX=15` on Render (live env) — safe live edit.

### Production risks
- 3.2 (cache headers) could surface slightly stale flash-sale countdowns. With `stale-while-revalidate=300` the worst case is a 5-min-stale countdown, acceptable.
- 3.3 (Redis cache) on cache miss falls through to DB — same as today. On Redis outage, fail-closed via the existing redis-client behavior (production fail closed) — but the cache wrapper should NOT fail closed; it should fall through to DB. Test this.

### Rollback
- 3.1: bump pool back to 5.
- 3.2 / 3.7: drop the header.
- 3.3: bypass the cache wrapper.
- 3.4: revert the dynamic import.
- 3.5: revert the snapshot calc.
- 3.6: drop the field from the response.

### Dependencies
- 3.1 ↔ 3.3 (high pool max + cache combine well; either alone helps).
- 3.6 depends on the existing histogram quantile helper (already shipped).
- Others independent.

### Safe-immediately vs high-risk
| Task | Safe immediately? |
|---|---|
| 3.1 pool=15 | ✅ |
| 3.2 cache headers | ✅ |
| 3.3 Redis flash-sale cache | ⚠ test fall-through |
| 3.4 lazy recharts | ✅ |
| 3.5 sliding-window topRoutes | ✅ |
| 3.6 CWV p75 | ✅ |
| 3.7 immutable assets | ✅ |

---

## Phase 4 — Final UX Polish

### Objectives
Mobile-first review of the customer-facing surface. RTL is already locked at boot; remaining work is loading states, error states, empty states, focus management, and a couple of layout regressions on iOS Safari.

### Current status
- **RTL**: `lib/direction.ts` is the single mutator, mounted boot-time + once at App root. No flicker.
- **PWA**: manifest, service worker, offline shell.
- **Skeleton shimmers**: present in dashboard, admin pages.
- **Toast system**: `@/hooks/use-toast` + Sonner mounted at App root.
- **Mobile nav**: bottom navigation present on mobile only.
- **OTP input**: `inputMode=numeric` + `autoComplete=one-time-code` (just shipped in commit `549a2f3`).
- **Phone field**: `dir=ltr` on the input itself (intentional — phone numbers read LTR even in RTL pages).

### Detected problems
1. 🟡 **Mobile bottom-nav active state** doesn't reflect deep-linked routes (e.g. `/profile/edit` doesn't highlight the profile tab). Confirmed via grep on `MobileNav.tsx`.
2. 🟡 **Login / register form errors** show as Arabic toasts only; if toast container is offscreen on mobile (keyboard up), the user doesn't know the form failed. Should mirror the error inline below the field.
3. 🟡 **Empty states** in admin lists (no products, no orders) show a small icon + "لا توجد بيانات بعد" but no CTA to the create flow.
4. 🟡 **Focus rings** on dark theme are barely visible on `bg-card` surfaces. Tab navigation accessibility audit fails.
5. 🟢 **`/login` page on iOS Safari**: the safe-area-inset-bottom isn't applied to the bottom of the auth form, so on notched iPhones the submit button is partially hidden behind the home indicator.
6. 🟢 **Service worker update prompt**: when a new version is deployed, the existing SW serves the old shell until next reload. No "Update available" toast.

### Risks if left
- None of these are launch blockers. Each is a moderate UX paper-cut.

### Implementation plan

| # | Task | Files | Migration? | Env? | Affects live? | Complexity | Safety |
|---|---|---|---|---|---|---|---|
| 4.1 | Mobile-nav active-state matcher: strip the route after the second `/` so `/profile/edit` activates the `/profile` tab. | `frontend/src/components/MobileNav.tsx` | no | no | no | low | safe |
| 4.2 | Inline form errors below the offending field on `/login` and `/register`. Keep the toast for non-field errors (network, server). | `frontend/src/pages/{login,register}.tsx` | no | no | no | low | safe |
| 4.3 | Empty-state CTAs: "لا توجد منتجات" → primary button "إضافة منتج جديد" linking to product create modal. Same for orders / users / coupons. | `frontend/src/pages/admin/{products,orders,users,coupons}.tsx` | no | no | no | low | safe |
| 4.4 | Tailwind `focus-visible:` ring polish: add `ring-2 ring-primary/60 ring-offset-1 ring-offset-background` to `Button`, `Input`, `Link` components. | `frontend/src/components/ui/{button,input,link}.tsx` | no | no | no | low | safe |
| 4.5 | Add `pb-[env(safe-area-inset-bottom)]` to `/login` + `/register` form containers. | `frontend/src/pages/{login,register}.tsx` | no | no | no | low | safe |
| 4.6 | Service-worker update prompt: subscribe to `workbox-window`'s `waiting` event in `main.tsx`, show a toast "تحديث جديد متاح — اضغط للتطبيق" with a button that calls `messageSkipWaiting()`. | `frontend/src/main.tsx` (workbox-window already a dep) | no | no | no | medium | safe |
| 4.7 | Lighthouse mobile audit on the live site after 4.1–4.6, target ≥ 90 on Performance / Accessibility / Best Practices / SEO. Document the score in `FINAL_RUNTIME_STATE.md`. | none (audit only) | no | no | no | low | safe |

### Migrations / env / live-affect
- **None.** Pure frontend polish.

### Production risks
- 4.6 service-worker update flow: a buggy `skipWaiting` could leave a session inconsistent. Mitigation: only show the toast 5 s after `waiting` fires (debounce) so a rapid refresh doesn't trigger it.

### Rollback
- Per-task revert. No state.

### Dependencies
- All independent.

### Safe-immediately
- All Phase 4 tasks are safe immediately.

---

## Phase 5 — Public Launch Readiness

### Objectives
Final pre-launch checklist: legal pages reachability, privacy policy, terms, `/manifest.json` correctness, OG image presence, analytics, status page, error budget definition, on-call rotation.

### Current status
- ✅ Sitemap, robots.txt
- ✅ Canonical URL on all pages
- ✅ JSON-LD on home + product pages (`Organization`, `Product`, `BreadcrumbList`)
- ✅ Sentry capturing
- ✅ /admin/system observability
- ✅ Alerting evaluator + dispatch
- ✅ HSTS preload eligible
- ⚠️ No `/legal/privacy`, `/legal/terms` page render check
- ⚠️ No public status page
- ⚠️ No analytics (Plausible / GA4) — current observability is internal-only
- ⚠️ No error-budget / SLO definition — alerting fires on absolute thresholds, not budgets
- ⚠️ No `humans.txt` (low priority)

### Detected problems
1. 🟡 **Legal pages**: routes exist (`/terms`, `/privacy`) per `App.tsx` but content has not been audit-reviewed for Libyan e-commerce compliance + Arabic RTL pass.
2. 🟡 **OG image**: `frontend/public/og-image.png` referenced in MetaTags but if the file is missing or stale, social shares look broken. Verify presence + dimensions (1200×630).
3. 🟡 **Status page**: no public-facing health page. `subnation.ly/status` could just be a thin SPA route that fetches `/api/healthz/ready` and renders a friendly message.
4. 🟡 **Analytics**: no funnel tracking. Without GA4 / Plausible, you can't tell whether users abandon at OTP send vs OTP confirm vs first purchase.
5. 🟡 **Error budget / SLO**: alerts fire on instantaneous thresholds (e.g. `auth_failure_rate_high`). At launch, an error-budget approach (e.g. allow X 5xx responses per 1000 requests over 30 days) is more durable.
6. 🟡 **Domain forwarding**: `subnation2.onrender.com` (legacy Render subdomain) — verify it 301s to canonical or returns 404. Currently the app middleware was removed in commit `4075488`; Render edge handles it.
7. 🟡 **On-call rotation**: no documented who-to-page-when. With Telegram alerts the channel is single-recipient.

### Implementation plan

| # | Task | Files | Migration? | Env? | Affects live? | Complexity | Safety |
|---|---|---|---|---|---|---|---|
| 5.1 | Audit `/terms` and `/privacy` page content for Libyan e-commerce compliance (consumer rights, refund window, data retention statement, OTP/SMS consent text matching Firebase's required disclosure). Get a legal review. | `frontend/src/pages/{terms,privacy}.tsx` | no | no | no | medium | safe |
| 5.2 | Verify `og-image.png` exists at `frontend/public/og-image.png`, is 1200×630, and is referenced in `MetaTags.tsx`. | static asset | no | no | no | low | safe |
| 5.3 | Public status page at `/status` — thin SPA route that polls `/api/healthz/ready` every 30 s, renders a 4-row table (Web / DB / Redis / Worker) with green/yellow/red dots and last-checked timestamp. No auth required. | new `frontend/src/pages/status.tsx`, route in `App.tsx` | no | no | no | low | safe |
| 5.4 | Wire Plausible analytics (privacy-friendly, no cookie banner needed) — add the script tag to `index.html` with the site's domain. Track 4 custom events: `signup_start`, `signup_complete`, `order_created`, `order_completed`. | `frontend/index.html`, hooks in `pages/{register,login,checkout}.tsx` | no | no | no | low | safe |
| 5.5 | Define SLOs in `OPERATIONS_RUNBOOK.md`: availability ≥ 99.5% / month, p95 API latency < 500 ms, error rate < 0.5% per 1000 requests. Translate one alerting rule from absolute → budget-based as a pilot. | `OPERATIONS_RUNBOOK.md`, `backend/src/services/alerting.service.ts` | no | no | no | medium | safe |
| 5.6 | Verify `subnation2.onrender.com` traffic: `curl -I` should show 404 or a Render default. If still returning 200 from our app, add a host-allowlist guard. | manual verification | no | no | no | low | safe |
| 5.7 | Document on-call rotation in `OPERATIONS_RUNBOOK.md`: primary contact (Telegram), secondary (email), escalation tree. Add Discord webhook as channel #2 for redundancy. | `OPERATIONS_RUNBOOK.md`, `DISCORD_WEBHOOK_URL` env | no | yes — `DISCORD_WEBHOOK_URL` (optional) | no | low | safe |
| 5.8 | Final smoke-test script: `scripts/launch-smoke-test.ts` — runs through register → login → password reset → Firebase OTP → admin login → admin product create → public homepage → checkout. Run it nightly via Render Cron. | new `scripts/launch-smoke-test.ts` | no | requires `SMOKE_TEST_PHONE` (Firebase test number), `SMOKE_TEST_PASSWORD` | no | medium | safe |

### Migrations / env / live-affect
- **None for migrations.**
- 5.4 / 5.7 / 5.8 require optional env vars; all `sync: false` in render.yaml so they're owner-set.

### Production risks
- 5.4 (Plausible): script tag adds one external request per page load. Plausible has a strict CSP-friendly script (no eval). Add `https://plausible.io` to CSP `script-src` and `connect-src`.
- 5.6: if a check finds traffic still hitting `subnation2.onrender.com`, that's pre-existing — fix in app.ts redirect middleware (already removed in 4075488).

### Rollback
- All Phase 5 tasks are additive. Per-task revert.

### Dependencies
- 5.4 → CSP allowlist update (small in `app.ts`).
- 5.5 → existing alerting helper.
- Others independent.

### Safe-immediately
- All Phase 5 tasks are safe immediately.

---

## Cross-cutting register

### Dead code / duplicated systems detected (all confirmed by grep)

| # | Item | Action |
|---|---|---|
| D1 | `router.get("/sessions")` duplicated at `auth.ts:1030, 1084` | Phase 1.2 |
| D2 | `sessionsTable` schema + endpoints with no INSERT call site | Phase 1.3 |
| D3 | `process.env.JWT_SECRET` fallback in `lib/jwt.ts` | Phase 1.5 |
| D4 | `auditLogsTable` schema unused | Phase 1.6 |
| D5 | Frontend Sentry hard-coded DSN fallback | Phase 1.7 |
| D6 | 7 superseded topical reports (alerting, metrics, redis × 3, cache, sentry, seo) | Already archived (this commit) |

### Obsolete configs detected
- `render.yaml` previously had `https://subnation2.onrender.com` in `APP_ORIGINS` — fixed in commit `4075488`.
- `frontend/src/instrument.ts` previously had legacy onrender host in trace-propagation regex — fixed.
- `.gitignore` had `/.env` rule commented out — fixed in commit `a719f7b`.

### Legacy domain leftovers detected
- None in source. The two remaining in `.git/COMMIT_EDITMSG` and historical commits are immutable git history.

### Weak env handling detected
- `JWT_SECRET` fallback (Phase 1.5).
- `ALLOW_PASSWORD_REGISTRATION` defaults to enabled — fine, but should default to disabled at launch with explicit opt-in for password auth (phone-only is the safer launch mode).

### Missing monitoring coverage
- **CWV percentiles** not surfaced (Phase 3.6).
- **Auth provider breakdown** in `auth_outcomes_total` is method × outcome — adding a `provider` (firebase|password|google|telegram) label would let dashboards split provider funnels. Cardinality stays bounded.

### Missing alerting
- **Backup-failure** alert (Phase 2.7).
- **DB pool exhaustion**: alert when `neon_connections_active / DB_POOL_MAX > 0.8` for 5 min.
- **Worker heartbeat stale > 180 s** in dedicated mode (currently embedded mode tolerates this since the same process serves traffic).

### Missing caching opportunities
- `/api/products` (Phase 3.2 + 3.3).
- `/api/categories` if it exists.
- `/api/auth/providers` — already low-traffic but called on every page load; could cache for 5 min.
- Static assets `Cache-Control: immutable` (Phase 3.7).

### Performance bottlenecks
- DB pool max=5 (Phase 3.1).
- Eager recharts in admin (Phase 3.4).
- All-time top-route aggregation (Phase 3.5).

### Hydration / rendering problems
- None remaining. The `<html dir>` flicker bug was fixed in commit `3a62b81` via `lib/direction.ts`.

### Memory leak risks
- The Prometheus registry's per-route HTTP metrics have `route, method, status` labels. With Express 5's route patterns (`:id`, `:slug`), cardinality is bounded. ✅
- Client-side rolling buffer in `/admin/system` (`samplesRef`) is capped at 120 entries (~12 KB). ✅
- Pino transport: no file-rotation needed (Render handles log persistence). ✅
- Long-lived intervals: heartbeat (15 s), alerting evaluator (60 s), Redis ping watchdog (30 s) — all `unref()`'d so they don't block process exit. ✅

### WebSocket risks
- Socket.IO adapter is Redis-backed (good for horizontal scale).
- No max-connection limit on the namespace — at scale, add `transports: ["websocket"]` only and a `connectTimeout`.
- No auth on Socket.IO — verified via grep on `lib/socket.ts`. **🟠 Medium risk**: any client can connect anonymously. If we ever broadcast user-scoped data over sockets (we currently don't beyond admin notifications), that's a leak.

### Rate-limit gaps
- `/api/cwv` is in CSRF skip list but has no rate limiter. A flood of synthetic CWV beacons could fill the Prometheus histogram. Add `cwvLimiter` (60 req/min/IP).
- `/api/admin/login` is in `/api/auth/*` so it gets `authLimiter` (10/15min/IP) — good. But once logged in, no per-admin throttle on dangerous actions (bulk delete). Not a high risk given TOTP gate.

### Privilege escalation risks
- `requireRole(["admin"])` exists but most admin routes use `requireAdmin` (any admin role passes). Differentiated roles (super_admin / support / readonly) are not enforced beyond a single check.
- 🟠 Medium: a `support` role admin can call `POST /api/admin/products` (create). Lock down via `requireRole(["super_admin"])` per route.

### Firebase / Auth weaknesses
- Phone auth requires Firebase Console SMS region allow-list (now configured for Libya, post-incident).
- No App Check (anti-abuse for Phone Auth) — Firebase recommends it but requires a paid plan.
- No rate limit on `signInWithPhoneNumber` from a single Firebase ID token (Firebase handles this server-side, but a multi-account abuser can rotate IDs).

---

## Execution order recommendation

The phases are independent, but a sane order:

1. **Phase 1 §1.1, §1.2, §1.4, §1.5** (4 small fixes, ~1 commit) — hardens auth before launch traffic.
2. **Phase 5 §5.6** (verify legacy domain) — 5-minute curl check.
3. **Phase 3 §3.1, §3.2** (pool + cache headers) — bigger headroom.
4. **Phase 4 §4.1–§4.6** (UX polish) — pre-launch sweep.
5. **Phase 2 §2.1–§2.5** (backup + DR runbook) — must land before public launch.
6. **Phase 1 §1.3, §1.6, §1.7** (session writes, audit log, DSN env) — slightly more invasive.
7. **Phase 5 §5.1–§5.8** (legal + analytics + smoke test).
8. **Phase 3 §3.3–§3.7** (deeper perf optimisations).

---

## Final state target

After all 5 phases land:

```
✓ CSRF gate covers all auth POSTs
✓ argon2id at OWASP-2024 parameters
✓ Sessions table actively maintained, device-list works
✓ Audit log on every admin write action
✓ Daily off-site DB backup with 14-day daily / 12-week weekly / 12-month monthly retention
✓ Tested restore drill (quarterly)
✓ DB pool 15, edge cache headers on read paths, Redis cache for flash-sale
✓ Lazy recharts, sliding-window top routes, CWV p75 in admin/system
✓ Mobile UX polish (empty states, inline form errors, focus rings, safe-area insets)
✓ Public /status page
✓ Plausible analytics on the 4 conversion events
✓ SLOs defined; one alerting rule converted to error-budget
✓ Nightly smoke test exercising the auth + checkout funnel
```

This is the launch-ready state.
