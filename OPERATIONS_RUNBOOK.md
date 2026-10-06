# Operations Runbook

> **Migration COMPLETE (2026-10; corrected R118, 2026-10-06):** production
> is Coolify on a self-hosted VM (observed live host R117: a Contabo VPS) +
> Neon Postgres — topology of record:
> `docs/architecture/FINAL_PRODUCTION_TOPOLOGY.md`. Everything Render/Vercel
> below is a LEGACY historical record, NOT a usable rollback path (Render is
> billing-suspended; the Vercel mirror is dead) — the current rollback is
> `docs/deployment/FINAL_ROLLBACK_RUNBOOK.md` (Coolify redeploy / image pin).

This runbook is the on-call companion. Each alert rule includes a triage
section anchored to its `runbookSection` value in `ALERT_RULES`.

## 1. Dashboards

| Surface                         | URL                                                         | What it shows                                  |
| ------------------------------- | ----------------------------------------------------------- | ---------------------------------------------- |
| Render (LEGACY — dead: billing-suspended since 2026-09-11) | `https://dashboard.render.com/web/srv-d7vv91tckfvc73evnccg` | deploys, logs, CPU/memory metrics, env vars (pre-cutover record) |
| Coolify/VM (PRODUCTION — live stack)   | `http://<VM>/coolify` or `:8000` → project                  | containers, logs, redeploys                    |
| Sentry                          | `https://sentry.io/...` (set `SENTRY_DASHBOARD_URL`)        | unresolved issues, traces, performance         |
| Neon                            | `https://console.neon.tech/...` (set `NEON_DASHBOARD_URL`)  | slow queries, indexes, connections             |
| Internal admin observability    | `/admin/system` (API: `/api/admin/observability/*`; admin JWT required) | summary, alerts, deploys, sentry placeholder   |

CLI helpers via Render MCP / Neon MCP (Render MCP = LEGACY, pre-cutover; on
the live stack use `docker logs` / the Coolify UI —
`docs/deployment/COOLIFY_ORACLE_MIGRATION.md` §11):

```
# last hour of web service logs
list_logs resource=srv-d7vv91tckfvc73evnccg startTime=-1h

# Neon slow queries
explain ANALYZE SELECT …  (via query_render_postgres or psql)
```

The four dashboard deep links in the admin observability panel
(`/admin/system`) and alert footers are env-gated: `SENTRY_DASHBOARD_URL`, `RENDER_DASHBOARD_URL`, `NEON_DASHBOARD_URL`,
`ALERTING_RUNBOOK_URL`. Unset = the panel hides
the link — see `config/env.example` (observability section) for the annotated
rows.

## 2. Per-rule triage

### #api-5xx — `api_5xx_rate_high`

- **Threshold:** 5xx rate > 5% over 5 min.
- **Triage:**
  1. Check Sentry: filter `event.tags.correlation_id` matching the most
     recent 5xx response in Render logs (`/api/healthz/ready` body for
     correlation id — admin JWT required — or look at `correlation_id` Pino
     field).
  2. If a single endpoint dominates: rollback (§4) or hotfix.
  3. If Redis or Neon failing checks fired simultaneously, treat as a
     dependency outage (`#redis` or `#neon`).
- **Mitigation:** rollback to last-known-good deploy via Render dashboard
  (LEGACY, pre-migration — §4). Post-migration: Coolify redeploy previous /
  compose image pin — `docs/deployment/COOLIFY_ORACLE_MIGRATION.md` §12.

### #auth-failure — `auth_failure_rate_high`

- **Threshold:** auth failure rate > 20% over 5 min.
- **Triage:**
  1. Check `auth_outcomes_total{outcome="failure"}` per `method`.
  2. Spike on `firebase` only → see `#firebase-verify`.
  3. Spike on `password` → check `login_attempts` table for IP/phone
     skew (potential brute force; lockout system should already be
     compensating).

### #firebase-verify — `firebase_verifyidtoken_failures`

- **Threshold:** > 5 verifyIdToken failures in 5 min.
- **Triage:**
  1. `GET /api/healthz/firebase` — confirm `service_account_parse_ok=true`
     and `service_account_project_matches_env=true`.
  2. Check the service env (`FIREBASE_SERVICE_ACCOUNT_JSON` parseability,
     `FIREBASE_PROJECT_ID` matches the JSON `project_id`) — on the live
     stack that is the Coolify env / compose `.env` (Render dashboard env:
     LEGACY, pre-cutover).
  3. Recent service-account rotation? Re-paste the JSON, redeploy.

### #fe-sentry — `frontend_sentry_error_rate_high`

> **2026-09-20 final audit — DORMANT (no evaluator).** This rule returns
> false by design: it needs a Sentry-events signal the backend cannot read
> for free. Triage Sentry's own dashboards directly; treat this rule as
> deferred until a signal source is wired.

- **Threshold:** > 10 frontend events / min.
- **Triage:** open Sentry, group by browser / route — usually a regression
  on a specific lazy chunk. Check that the `release` tag matches the latest
  deploy commit SHA (else source-map upload missed).

### #redis — `redis_disconnect`

- **Threshold:** ≥ 1 disconnect event in 60 s.
- **Triage:**
  1. `GET /api/healthz/redis` — current latency + failure counter.
  2. Render Redis service status. Free tier evicts under memory
     pressure — see scaling thresholds (§5).
  3. If transient (< 30 s) and self-recovering, alert is informational.

### #neon — `neon_connection_failure`

- **Threshold:** ≥ 1 connection failure in 60 s.
- **Triage:**
  1. `GET /api/healthz/neon` and `GET /api/admin/diagnostics`.
  2. Neon console: is the project paused? Free-tier cold-starts can
     produce a transient connection failure on first request.
  3. Confirm `DATABASE_URL` env is current (after a Neon project rotation,
     redeploy needed).

### #worker — `worker_heartbeat_missing`

> **2026-09-20 final audit — dormant in the current deployment.** The
> heartbeat is written to Redis only (`worker/heartbeat.ts`), and NO Redis
> service is provisioned (the deployed contract is `SINGLE_INSTANCE_MODE=true`
> synthetic in-process leadership — §5 below; heartbeat is inert without
> Redis).
> The rule evaluator fails safe (`return false` when `getRedisClient()` is
> null), so it can never fire in the current shape — this is intentional,
> not a defect. It becomes live again the moment a Redis is attached.

- **Threshold:** no `worker:heartbeat` Redis key for 2 min.
- **Triage:**
  1. The WEB process owns the heartbeat under the scheduler leader lock
     (`lib/web-scheduler.ts` + PG lease — the dedicated `subnation-worker`
     service was REMOVED in the 2026-09-20 free-infrastructure round and
     must not be re-created from the blueprint). Check the web service
     health + `/api/healthz` first; a sleeping free-tier instance is
     expected to pause the heartbeat with everything else.
  2. Inspect web service logs for `Failed to start` or scheduler
     demotion messages (`[scheduler] lost leadership`).
  3. If a Redis was later attached: `redis_errors_total` should stay 0;
     a disconnect storm re-elects the leader via the PG lease.

### #latency — `api_p95_latency_high`

- **Threshold:** p95 > 1500 ms over 5 min.
- **Triage:**
  1. Open `/api/metrics` (admin-gated): inspect
     `http_request_duration_seconds` by route.
  2. Check Neon slow queries via Neon MCP / dashboard.
  3. Render free-tier cold-starts can spike p95 — note instance churn in
     the alert window.

### #jobs — `worker_job_failures_high`

> **2026-09-20 final audit — DORMANT (no evaluator).** Returns false by
> design: needs a job-outcome counter that is not emitted yet (the worker
> tier was removed in the free-infrastructure round). Deferred, not
> broken.

- **Threshold:** > 3 failed background jobs in 5 min.
- **Triage:** web service logs filtered by `category:"worker" outcome:"failed"`
  (the web process owns the scheduler jobs under the leader lock).

### #lockouts — `abnormal_lockouts`

- **Threshold:** ≥ 10 lockouts in 5 min (per IP or globally).
- **Triage:** `auth_activity` and `login_attempts` tables — group by
  `ipAddress`. Coordinated brute force → consider Cloudflare/WAF.

## 3. Reading Render &amp; Neon logs

> **LEGACY (pre-cutover):** the Render access below is a historical record,
> not a rollback path (the account is billing-suspended). On the live
> stack: `docker logs subnation` / Coolify's log pane —
> `docs/deployment/COOLIFY_ORACLE_MIGRATION.md` §11. (The Neon parts
> stay valid on either stack.)

### Render logs (last hour, web service)

Render MCP:

```
list_logs resource=srv-d7vv91tckfvc73evnccg \
  startTime=2026-05-16T03:00:00Z direction=backward limit=100
```

Filter by `correlation_id` text once you have one from Sentry / response
header. All log lines contain `correlation_id` since Phase 2.

### Neon slow queries

Neon MCP `query_render_postgres` (read-only):

```sql
SELECT pid, usename, application_name,
       NOW() - query_start AS duration, query
FROM pg_stat_activity
WHERE state = 'active' AND NOW() - query_start > INTERVAL '500ms'
ORDER BY duration DESC;
```

## 4. Deploy rollback — LEGACY (Render, pre-migration)

> Post-migration app rollback = Coolify redeploy previous / compose image
> pin — `docs/deployment/COOLIFY_ORACLE_MIGRATION.md` §12.

1. **Identify last-known-good deploy:**
   - Render MCP `list_deploys serviceId=srv-d7vv91tckfvc73evnccg limit=10`.
   - Pick the latest `live` / `succeeded` deploy that pre-dates the regression.
2. **Trigger rollback:**
   - Render dashboard → service → Deploys → "Rollback" on the chosen deploy.
   - Render MCP equivalent — ABANDONED with the Render retirement
     (2026-10-05): `RENDER_API_KEY` will never be wired into the admin
     observability backend.
3. **Verify:**
   - `GET /api/healthz/ready` (admin JWT required) returns `{status:"ok"}`
     within 30 s.
   - `GET /api/admin/diagnostics` shows the rolled-back commit SHA.
4. **Notify:**
   - Telegram message via `POST /api/admin/alerts/test rule=worker_heartbeat_missing`
     (until Phase 7 task 44 wires automatic post-rollback notification).
5. **Record:**
   - Add a note under
     `.kiro/specs/observability-seo-cwv-maturity:rollback-events`
     in Memory_MCP with `commitSha`, `regression`, `rollbackOutcome`,
     `durationSec`.

## 5. Production resource budget (self-hosted VM + Coolify + Neon)

> **R118 correction (2026-10-06):** production is ONE deployment — Coolify on
> a self-hosted VM (observed live host R117: a Contabo VPS) running the
> `subnation` (API + SPA) and `openwa` containers, with Neon Postgres
> (free tier) external. The single source of truth for topology + capacity
> is `docs/architecture/FINAL_PRODUCTION_TOPOLOGY.md` (esp. §8 "Scaling
> truth"). Current budget posture:
>
> | Pool       | Live shape                                                 | Watch                                                   |
> | ---------- | ----------------------------------------------------------- | ------------------------------------------------------- |
> | VM compute | one always-on self-hosted VM (operator's Contabo plan)      | container CPU/RAM via the Coolify UI / `docker stats`    |
> | Neon       | free tier — 0.25 CU with autosuspend (the r108 economics)   | connection storms; app pools = main 8 + OTP lockPool 2   |
> | Bandwidth  | per the host plan                                           | provider panel                                           |
> | Builds     | Coolify builds this repo from Git on every deploy           | build duration per deploy (no shared minutes pool)       |
>
> The Render free-tier pools below (750 h / 5 GB / 500 min) are the
> **pre-cutover historical record** — that stack no longer serves traffic.
> The stack-neutral contracts further down — the anti-pattern list ("NEVER
> reintroduce") and the timer inventory ("Remaining recurring activity") —
> still apply verbatim: they are what keeps Neon autosuspend intact on the
> live stack.

### LEGACY — Render free-tier economics (R104 record, pre-cutover)

> **R104 (2026-09-21) — historical record of the Render free-tier
> economics** (kept for the pre-cutover story; superseded for live ops by
> the budget block above). Pre-cutover topology: **Render free web
> (subnation, Docker: API + SPA) + Render free web (openwa-gateway,
> separate repo) + Neon Postgres (external) + Vercel (parallel
> frontend)**. No worker. No Redis. **No Northflank** (the 2026-09-21
> experiment was rolled back — commit f582254).

### The allocation (verified against render.com docs + pricing, 2026-09-21)

| Budget pool            | Monthly allowance | Shared across         | Consumed only when                      |
| ---------------------- | ----------------- | --------------------- | --------------------------------------- |
| Free instance hours    | **750 h**         | ALL free web services | a service is RUNNING (sleeping = free)  |
| Outbound bandwidth     | **5 GB**          | workspace             | bytes leave Render (API + SPA + images) |
| Build pipeline minutes | **500 min**       | workspace             | a build runs (both services)            |

Failure modes: hours exhausted → all free services suspended until next
month; bandwidth exhausted (no payment method) → free services suspended;
build minutes exhausted → new builds disabled (running services stay up).
Render may ALSO suspend a free service that generates uncommonly high
service-initiated outbound volume (DB/API calls count).

### Engineering targets (comfortably inside, not on the edge)

| Target                         | Ceiling | Design budget       | Margin   |
| ------------------------------ | ------- | ------------------- | -------- |
| Instance hours (both services) | 750 h   | **≤ 500 h (67%)**   | ~250 h   |
| Outbound bandwidth             | 5 GB    | **≤ 3 GB (60%)**    | ~2 GB    |
| Build minutes                  | 500 min | **≤ 350 min (70%)** | ~150 min |

Expected normal usage: subnation awake ~1-4 h/day (30-120 h/mo — every
wake serves real traffic then idles out 15 min later), openwa-gateway
awake only during OTP activity + operator dashboards (well under 30
h/mo). Every budget line holds ≥ 2× headroom over a realistic month.

### What wakes what (the event-driven contract)

| Wake source                           | Wakes                                   | Legitimacy                                        |
| ------------------------------------- | --------------------------------------- | ------------------------------------------------- |
| Storefront page view (Vercel/Render)  | subnation → Neon                        | real user traffic                                 |
| Admin panel session                   | subnation                               | operator traffic                                  |
| OTP login attempt                     | subnation → openwa → WhatsApp servers   | real user traffic                                 |
| Operator dashboard tab (openwa /dash) | openwa                                  | operator traffic (poll is visibility-gated, R104) |
| Deploy (manual, CI-gated)             | subnation / openwa                      | operator action                                   |
| /robots.txt on a spun-down service    | nothing (Render answers before the app) | platform                                          |

### STILL LIVE — NEVER reintroduce (the anti-pattern list; stack-neutral)

Self-pings, keep-alive pingers, uptime pingers, scheduled GitHub-Action
wakeups, `refetchInterval`-in-background polling, always-on storefront
sockets, `reconnectionAttempts: Infinity`, timer-driven "preventive"
maintenance, scheduled builds. Each of these was found and removed
(2026-09-20 round + R104); every one of them keeps a sleep-capable resource
awake 24/7 (on Render it burned instance hours — one forgotten tab ≈ 730
h/mo; on the live stack it would keep Neon's autosuspended compute awake and
burn the CU allowance instead).

### Remaining recurring activity (the complete timer inventory)

R108 shape — **`SINGLE_INSTANCE_MODE=true`** (the deployed default; see
`docs/deployment/COOLIFY_ORACLE_MIGRATION.md` §9, the accuracy reference
for this list): synthetic in-process leadership — **no leader election, no
PG-lease refresher, ZERO periodic Neon coordination queries**, so idle
Neon autosuspend is preserved. The old "PG-lease refresh 25 s
recurring-while-awake" and "crons under the leader lock" rows described
the pre-R108 embedded-election shape and are gone: while the process is
up, the complete recurring inventory is — **daily retention crons
00:00-05:00 UTC (~25 min/day) running unconditionally in the web
process** (NOT under a leader lock); the **60 s alerting evaluator**
(in-process counters only — no DB, no outbound); the **Redis worker
heartbeat** (only when a Redis client exists — skipped entirely when
`REDIS_URL` is unset); and the **boot one-shot chain** once per process
start (+7 s deferral). NOTHING sub-hourly touches the database. The
timers removed in the 2026-09-20 free-infrastructure round (hourly OTP
prune, hourly copilot-previews reaper, 10-min keep-alive self-pings,
watcher intervals) stay removed: that work runs as throttled opportunistic
sweeps fired by real traffic (`lib/opportunistic.ts`) plus the boot
one-shots — zero artificial wake-ups (on the pre-cutover Render stack that
kept sleeping services free; on the live stack it is what keeps Neon
autosuspended). The multi-instance election path (PG-lease refresh
while awake; `SCHEDULER_LEASE_REFRESH_MS` / `SCHEDULER_LEASE_TTL_SEC`)
remains intact but INERT while the flag is set — unset
`SINGLE_INSTANCE_MODE` to restore it.

### Inspection & alarm thresholds (LEGACY — Render dashboard, pre-cutover)

| Check                     | Where                                      | Investigate when                                       |
| ------------------------- | ------------------------------------------ | ------------------------------------------------------ |
| Instance hours this month | Render Dashboard → Billing → Monthly Usage | > 300 h by mid-month (projected > 600 h)               |
| Bandwidth this month      | same                                       | > 1.5 GB by mid-month (projected > 3 GB)               |
| Build minutes this month  | same                                       | > 175 min by mid-month (projected > 350)               |
| Wake frequency            | logs: `Server listening` per day           | > ~40 cold boots/day sustained (usage grew — reassess) |
| First-byte after wake     | logs: boot gate open → first 200           | > 25 s (check migration fast-path is hitting)          |
| Neon compute hours        | Neon console                               | unexpectedly high (check lease refresh + query load)   |

## 6. Incident template

```
INCIDENT <id>
Detected: <timestamp> via <alert rule>
Acknowledged: <timestamp> by <name>
Resolved: <timestamp>

# Impact
- Customer-facing: <yes/no>
- Routes affected: <list>
- Estimated requests affected: <count>

# Timeline
- HH:MM  alert fires (<rule>, severity=<sev>)
- HH:MM  on-call ack
- HH:MM  hypothesis: <…>
- HH:MM  mitigation: <…>
- HH:MM  resolved

# Root cause
<short explanation>

# Mitigations applied
- <…>

# Follow-up actions
- [ ] add metric / alert / runbook entry
- [ ] code/test fix (with PR link)
- [ ] post-mortem doc

# Memory_MCP
Append observation to `:incidents` entity.
```

## 7. Health endpoint quick reference

```
$ curl https://subnation.ly/api/healthz
{"status":"ok"}

# /ready is admin-gated (requireAdmin) — a bare curl gets 401
$ curl -H "Authorization: Bearer $ADMIN_JWT" https://subnation.ly/api/healthz/ready
{"status":"ok","checks":{"redis":{...},"neon":{...},"worker":{...},"socket":{...}},"version":"abc1234","uptimeSec":12345}

# /firebase is admin-gated too (requireAdmin) — a bare curl gets 401
$ curl -H "Authorization: Bearer $ADMIN_JWT" https://subnation.ly/api/healthz/firebase
{"auth_enabled_flag":true,"project_id_env":"subnation-2571e","admin_app_initialized":true,...}
```

## 8. Smoke / synthetic test

```
# Synthetic alert end-to-end
curl -X POST -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{"rule":"api_5xx_rate_high"}' \
  https://subnation.ly/api/admin/alerts/test
# Expected: Telegram message in chat -1003878819089 within 60 s.

# CWV beacon
curl -X POST -H "Content-Type: application/json" \
  -d '{"name":"LCP","value":2400,"route":"/","viewportClass":"mobile","sessionId":"00000000-0000-4000-8000-000000000001","timestamp":1778900000000}' \
  https://subnation.ly/api/cwv
# Expected: 204
```

## 9. Single-origin architecture (post-cutover) — «معمارية الأصل الواحد»

> **R118 correction (2026-10-06):** production is ONE deployment — Coolify on
> a self-hosted VM: the `subnation` container (API + SPA, same origin) + the
> `openwa` container + Neon Postgres. There is no Vercel and no Render in
> the live path (the Vercel mirror 404s; Render is billing-suspended).
>
> - **Canonical URL:** `https://subnation.ly` — apex and `www` both serve
>   200; there is no redirect at any layer today. The recommended
>   `www → apex` 301 is an open operator action at the Traefik layer —
>   `docs/deployment/CLOUDFLARE_FINAL_CUTOVER.md` §8.
> - **DNS:** the Cloudflare zone is **DNS-only (grey cloud)** — no proxy, no
>   edge TLS/WAF in the live path; TLS terminates at the VM (Traefik /
>   Let's Encrypt). Do NOT "re-fix" the zone to proxied without deciding.
> - **SEO checks reduce to the origin:**
>   ```
>   curl -sI https://subnation.ly/robots.txt      | head -1   # 200 text/plain
>   curl -sI https://subnation.ly/sitemap.xml     | head -1   # 200 application/xml
>   ```
>   The backend generates both dynamically (`backend/src/routes/seo.ts`);
>   they are not build artifacts (R97 J-4). The Vercel-rewrite concern below
>   is moot — no Vercel exists anymore.
>
> The dual-deployment record below is the R97-era history, kept as LEGACY.

### LEGACY — dual-deployment record (Render primary + Vercel secondary, R97)

> **Pre-cutover architecture (Render primary + Vercel secondary).**
> Superseded by the single-origin block above (cutover 2026-10: the Vercel
> project is gone, single origin only — `docs/deployment/MIGRATION_RUNBOOK.md`
> Phase 6).

97-F6 (R97 J-4): two live deployments ran in parallel from this same repo
(until the 2026-10 cutover). This section was the source of truth for which
one was canonical and what on-call had to keep green.

|          | PRIMARY (canonical)                                                        | SECONDARY (parallel/preview)                                                                                |
| -------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| URL      | `https://subnation.ly`                                                     | `https://subnation-seven.vercel.app`                                                                        |
| Pipeline | Cloudflare proxy → Render (`subnation2.onrender.com`)                      | Vercel build from the same repo                                                                             |
| Serves   | Backend Docker image: API + built frontend static (`frontend/dist/public`) | Static frontend build; `/api/*`, `/robots.txt`, `/sitemap.xml` proxied to Render via `vercel.json` rewrites |
| DNS      | `subnation.ly` / `www` on Cloudflare (proxied, Always-Use-HTTPS)           | `*.vercel.app`                                                                                              |

**Confirmed by live evidence (R97-A1 — historical; today the zone is
DNS-only and the origin is Coolify on the VM):** `subnation.ly` responses
carried
`server: cloudflare` + `x-render-origin-server: Render` headers and the
backend's helmet CSP — the domain was NOT served by Vercel.

**Operational rules (historical record of the R97-era dual stack):**

1. **Keep both deployments green.** A red Render deploy is a production
   incident (rollback §4). A red Vercel deploy is a preview regression —
   fix before the next release, but it does not page on-call.
2. **robots.txt / sitemap.xml must work on BOTH.** The backend generates
   them dynamically (`backend/src/routes/seo.ts`); they are not build
   artifacts. On Render they are served directly; on Vercel,
   `vercel.json` rewrites `/robots.txt` and `/sitemap.xml` to the Render
   origin so crawlers get real files (never SPA HTML — R97 J-4). Verify
   both after any routing/SEO change:
   ```
   curl -sI https://subnation.ly/robots.txt      | head -1   # 200 text/plain
   curl -sI https://subnation.ly/sitemap.xml     | head -1   # 200 application/xml
   curl -sI https://subnation-seven.vercel.app/robots.txt | head -1
   ```
   Missing `/assets/*` files (e.g. any `.js.map`) must 404 on Vercel, not
   soft-404 with SPA HTML (R97 J-7).
3. **`VITE_*` env differences per platform.** Render sets build env on the
   web service (via `render.yaml` / dashboard); Vercel sets them in the
   project's Environment Variables. Keys that MUST match on both:
   `VITE_SENTRY_DSN`, `VITE_GSC_VERIFICATION`, `VITE_API_BASE_URL` /
   `VITE_SOCKET_URL` (empty on Render same-origin; on Vercel point at the
   Render origin or rely on the `/api` proxy), `VITE_GA_TRACKING_ID`.
   `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT` are build-time
   only (source-map upload) — currently unset on both.
   Note (97-F6): a build without `VITE_SENTRY_DSN` now ships NO Sentry
   vendor chunk at all — the DSN-less SDK used to cost ~151 KB brotli on
   the boot path. Setting the DSN on either platform re-enables it
   automatically; no code change needed.
4. **Decision pointer (owner).** The dual pipeline is accepted for now as
   belt-and-suspenders, but it is a divergence risk (different chunk
   hashes per platform) and the Vercel API path adds a proxy hop
   (~0.72 s vs ~0.29 s p50 to `/api/products`, R97-A1 §3.5). When the
   owner decides to consolidate: either promote Vercel (custom domain →
   Vercel, demote Render to API-only) or demote Vercel (delete the
   project / keep as branch previews only). Until then: treat
   `subnation.ly` as the canonical URL in sitemap, canonical tags, GSC,
   and any external links. Do not advertise the `*.vercel.app` URL.

**خلاصة عربية (سجل تاريخي — R97، ما قبل الترحيل):** النطاق القانوني
`subnation.ly` كان يُقدَّم من Cloudflare → Render (الأساسي — صورة Docker
الواحدة تقدّم API والواجهة معًا)، ونشر Vercel موازٍ للمعاينة من المستودع
نفسه. **بعد الترحيل (2026-10):** نشر أحادي الأصل — Coolify على الخادم
الذاتي (Contabo)، والنطاق عبر DNS-only، ولا وجود لـ Vercel أو Render في
مسار الإنتاج؛ `subnation.ly` يبقى الرابط القانوني في كل مكان.

## 10. WhatsApp OTP — operator knob

`WHATSAPP_OTP_SETTLE_MS` (default 45 000 ms, clamped 0–300 000) tunes the
round-96 settle gate: how long a freshly-paired
OpenWA session must wait after linking before it may dispatch OTPs (pair-code
key propagation takes 10–30 s; a QR device-list rebuild can take longer).
Full annotated reference: `config/env.example` (WhatsApp OTP section).
