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

- **Threshold:** no `worker:heartbeat` Redis key for 2 min.
- **Triage:**
  1. Render worker service status (`subnation-worker`). Free-tier worker
     can be evicted; redeploy.
  2. Inspect Render worker logs for `Failed to start worker` or
     `Redis client error`.

### #latency — `api_p95_latency_high`

- **Threshold:** p95 > 1500 ms over 5 min.
- **Triage:**
  1. Open `/api/metrics` (admin-gated): inspect
     `http_request_duration_seconds` by route.
  2. Check Neon slow queries via Neon MCP / dashboard.
  3. Render free-tier cold-starts can spike p95 — note instance churn in
     the alert window.

### #jobs — `worker_job_failures_high`

- **Threshold:** > 3 failed background jobs in 5 min.
- **Triage:** worker logs filtered by `category:"worker" outcome:"failed"`.

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

## 5. Scaling thresholds

| Resource     | Free / current               | Watch                                                    | Promote when                                                     |
| ------------ | ---------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------- |
| Render web   | starter                      | CPU > 70% sustained 30 min, memory > 400 MB, p95 > 1.5 s | move to `pro_max` and add a second instance                      |
| Render Redis | free, `allkeys-lru`          | maxmemory eviction events                                | move to `starter` (no eviction surprises for rate-limit / dedup) |
| Neon         | free                         | active connections > 50, `pg_stat_activity` shows queue  | scale plan                                                       |
| Sentry       | free 5K events/mo            | events > 4K/mo                                           | upgrade or sample harder                                         |
| Telegram bot | bot API rate limit (~30/sec) | global rate-limit > 25/min                               | already capped at 30/min in alerting service                     |

Every tier change must be recorded in
`observability-seo-cwv-maturity:tier-decisions` Memory_MCP entry per the
free-tier discipline rule (Property 20 of the spec).

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
$ curl https://subnation2.onrender.com/api/healthz
{"status":"ok"}

$ curl https://subnation2.onrender.com/api/healthz/ready
{"status":"ok","checks":{"redis":{...},"neon":{...},"worker":{...},"socket":{...}},"version":"abc1234","uptimeSec":12345}

$ curl https://subnation2.onrender.com/api/healthz/firebase
{"auth_enabled_flag":true,"project_id_env":"subnation-2571e","admin_app_initialized":true,...}
```

## 8. Smoke / synthetic test

```
# Synthetic alert end-to-end
curl -X POST -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{"rule":"api_5xx_rate_high"}' \
  https://subnation2.onrender.com/api/admin/alerts/test
# Expected: Telegram message in chat -1003878819089 within 60 s.

# CWV beacon
curl -X POST -H "Content-Type: application/json" \
  -d '{"name":"LCP","value":2400,"route":"/","viewportClass":"mobile","sessionId":"00000000-0000-4000-8000-000000000001","timestamp":1778900000000}' \
  https://subnation2.onrender.com/api/cwv
# Expected: 204
```
