# Operations Runbook

This runbook is the on-call companion. Each alert rule includes a triage
section anchored to its `runbookSection` value in `ALERT_RULES`.

## 1. Dashboards

| Surface                      | URL                                                         | What it shows                                |
| ---------------------------- | ----------------------------------------------------------- | -------------------------------------------- |
| Render                       | `https://dashboard.render.com/web/srv-d7vv91tckfvc73evnccg` | deploys, logs, CPU/memory metrics, env vars  |
| Sentry                       | `https://sentry.io/...` (set `SENTRY_DASHBOARD_URL`)        | unresolved issues, traces, performance       |
| Neon                         | `https://console.neon.tech/...` (set `NEON_DASHBOARD_URL`)  | slow queries, indexes, connections           |
| Internal admin observability | `/admin/observability` (admin JWT required)                 | summary, alerts, deploys, sentry placeholder |

CLI helpers via Render MCP / Neon MCP:

```
# last hour of web service logs
list_logs resource=srv-d7vv91tckfvc73evnccg startTime=-1h

# Neon slow queries
explain ANALYZE SELECT …  (via query_render_postgres or psql)
```

The four dashboard deep links in `/admin/observability` and alert footers are
env-gated: `SENTRY_DASHBOARD_URL`, `RENDER_DASHBOARD_URL`, `NEON_DASHBOARD_URL`,
`ALERTING_RUNBOOK_URL` (render.yaml `sync: false`). Unset = the panel hides
the link — see `config/env.example` (observability section) for the annotated
rows.

## 2. Per-rule triage

### #api-5xx — `api_5xx_rate_high`

- **Threshold:** 5xx rate > 5% over 5 min.
- **Triage:**
  1. Check Sentry: filter `event.tags.correlation_id` matching the most
     recent 5xx response in Render logs (`/api/healthz/ready` body for
     correlation id, or look at `correlation_id` Pino field).
  2. If a single endpoint dominates: rollback (§4) or hotfix.
  3. If Redis or Neon failing checks fired simultaneously, treat as a
     dependency outage (`#redis` or `#neon`).
- **Mitigation:** rollback to last-known-good deploy via Render dashboard.

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
  2. Check Render env: `FIREBASE_SERVICE_ACCOUNT_JSON` parseability,
     `FIREBASE_PROJECT_ID` matches the JSON `project_id`.
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
> service is provisioned (the app runs on the PG-lease scheduler fallback).
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

## 4. Deploy rollback

1. **Identify last-known-good deploy:**
   - Render MCP `list_deploys serviceId=srv-d7vv91tckfvc73evnccg limit=10`.
   - Pick the latest `live` / `succeeded` deploy that pre-dates the regression.
2. **Trigger rollback:**
   - Render dashboard → service → Deploys → "Rollback" on the chosen deploy.
   - Render MCP equivalent forthcoming once `RENDER_API_KEY` is wired into
     the admin observability backend.
3. **Verify:**
   - `GET /api/healthz/ready` returns `{status:"ok"}` within 30 s.
   - `GET /api/admin/diagnostics` shows the rolled-back commit SHA.
4. **Notify:**
   - Telegram message via `POST /api/admin/alerts/test rule=worker_heartbeat_missing`
     (until Phase 7 task 44 wires automatic post-rollback notification).
5. **Record:**
   - Add a note under
     `.kiro/specs/observability-seo-cwv-maturity:rollback-events`
     in Memory_MCP with `commitSha`, `regression`, `rollbackOutcome`,
     `durationSec`.

## 5. Free-tier posture & resource budget

> **R104 (2026-09-21) — the current-state authority for Render free-tier
> economics.** Supersedes the budget rows in
> `docs/free-tier-optimization-2026-09-20.md`. Production topology:
> **Render free web (subnation, Docker: API + SPA) + Render free web
> (openwa-gateway, separate repo) + Neon Postgres (external) + Vercel
> (parallel frontend)**. No worker. No Redis. **No Northflank** (the
> 2026-09-21 experiment was rolled back — commit f582254).

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

### NEVER reintroduce (the anti-pattern list)

Self-pings, keep-alive pingers, uptime pingers, scheduled GitHub-Action
wakeups, `refetchInterval`-in-background polling, always-on storefront
sockets, `reconnectionAttempts: Infinity`, timer-driven "preventive"
maintenance, scheduled builds. Each of these was found and removed
(2026-09-20 round + R104); every one of them converts a sleep-capable
service into a 24/7 instance-hour burner (one forgotten tab ≈ 730 h/mo).

### Remaining recurring activity (the complete timer inventory)

While AWAKE (zero cost while sleeping — see AG1 inventory for file:line):
PG-lease refresh 25 s (1 query — R104 AG1-1; R107 made the cadence
env-tunable: SCHEDULER_LEASE_REFRESH_MS / SCHEDULER_LEASE_TTL_SEC, defaults
25 s/60 s), alerting evaluator 60 s (in-process
counters only), boot one-shots once per leadership (+7 s deferral),
daily crons 00:00-05:00 UTC under the leader lock. NOTHING runs while
the service sleeps; nothing sends outbound while idle. NOTE for the
always-on (Oracle/Coolify) topology: the refresher then runs 24/7 — see
docs/deployment/COOLIFY_ORACLE_MIGRATION.md §9 for the Neon-awake trade.

### Inspection & alarm thresholds

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

$ curl https://subnation.ly/api/healthz/ready
{"status":"ok","checks":{"redis":{...},"neon":{...},"worker":{...},"socket":{...}},"version":"abc1234","uptimeSec":12345}

$ curl https://subnation.ly/api/healthz/firebase
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

## 9. Dual-Deployment Architecture — «معمارية النشر المزدوج»

97-F6 (R97 J-4): two live deployments run in parallel from this same repo.
This section is the source of truth for which one is canonical and what
on-call must keep green.

|          | PRIMARY (canonical)                                                        | SECONDARY (parallel/preview)                                                                                |
| -------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| URL      | `https://subnation.ly`                                                     | `https://subnation-seven.vercel.app`                                                                        |
| Pipeline | Cloudflare proxy → Render (`subnation2.onrender.com`)                      | Vercel build from the same repo                                                                             |
| Serves   | Backend Docker image: API + built frontend static (`frontend/dist/public`) | Static frontend build; `/api/*`, `/robots.txt`, `/sitemap.xml` proxied to Render via `vercel.json` rewrites |
| DNS      | `subnation.ly` / `www` on Cloudflare (proxied, Always-Use-HTTPS)           | `*.vercel.app`                                                                                              |

**Confirmed by live evidence (R97-A1):** `subnation.ly` responses carry
`server: cloudflare` + `x-render-origin-server: Render` headers and the
backend's helmet CSP — the domain is NOT served by Vercel.

**Operational rules:**

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

**خلاصة عربية:** النطاق القانوني `subnation.ly` يُقدَّم من Cloudflare → Render
(الأساسي — صورة Docker الواحدة تقدّم API والواجهة معًا)، ونشر Vercel موازٍ
للمعاينة من المستودع نفسه. يجب بقاء النشرين أخضرين، وrobots/sitemap يعملان على
كليهما (عبر rewrite إلى Render على Vercel)، ومتغيرات `VITE_*` متطابقة بين
المنصتين، والقرار النهائي بدمج أو إزالة نشر Vercel يعود للمالك — حتى ذلك
الحين يُعامَل `subnation.ly` كالرابط القانوني في كل مكان.

## 10. WhatsApp OTP — operator knob

`WHATSAPP_OTP_SETTLE_MS` (default 45 000 ms, clamped 0–300 000; `render.yaml`
`sync: false`) tunes the round-96 settle gate: how long a freshly-paired
OpenWA session must wait after linking before it may dispatch OTPs (pair-code
key propagation takes 10–30 s; a QR device-list rebuild can take longer).
Full annotated reference: `config/env.example` (WhatsApp OTP section).
