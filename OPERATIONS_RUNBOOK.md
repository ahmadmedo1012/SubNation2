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
| Internal admin observability    | `/admin/system` (API: `/api/admin/observability/*`; admin JWT required) | summary, alerts, deploys (Sentry links env-gated — see §11) |

CLI helpers via Render MCP / Neon MCP (Render MCP = LEGACY, pre-cutover; on
the live stack use `docker logs` / the Coolify UI —
`docs/operations/CONTABO_COOLIFY_OPERATIONS.md` §4; the r107-era guide now
lives at `docs/deprecated/COOLIFY_ORACLE_MIGRATION.md` §11):

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
- **Mitigation:** rollback via §4 (Coolify redeploy-previous /
  git-revert+push). Full choreography:
  `docs/deployment/FINAL_ROLLBACK_RUNBOOK.md` +
  `docs/operations/CONTABO_COOLIFY_OPERATIONS.md` §7.

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

> **2026-09-20 final audit — DORMANT (no evaluator); still true at R122.**
> This rule returns
> false by design: it needs a Sentry-events signal the backend cannot read
> for free (`alerting.service.ts` — by design). **Frontend Sentry itself is
> LIVE since R121-B (2026-10-07)** — triage via the Sentry dashboard (§11);
> only the *rule evaluator* is dormant.

- **Threshold:** > 10 frontend events / min.
- **Triage:** open Sentry, group by browser / route — usually a regression
  on a specific lazy chunk. Check that the `release` tag matches the latest
  deploy commit SHA (else source-map upload missed).

### #redis — `redis_disconnect`

- **Threshold:** ≥ 1 disconnect event in 60 s.
- **Triage:**
  1. `GET /api/healthz/redis` — current latency + failure counter.
  2. The target topology runs with `REDIS_URL` **unset** (in-process
     rate-limit/cache/idempotency fallbacks — §5). If this alert fires at
     all, someone attached a Redis: check the Coolify env table for
     `REDIS_URL`, decide whether to keep or unset it, and re-verify via
     `/api/healthz/redis`.
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

## 3. Reading logs (live stack: Docker/Coolify + Neon)

> **LEGACY (pre-cutover):** the Render access below is a historical record,
> not a rollback path (the account is billing-suspended). On the live
> stack: `docker logs subnation` / Coolify's log pane —
> `docs/operations/CONTABO_COOLIFY_OPERATIONS.md` §4 (the r107-era guide
> now lives at `docs/deprecated/COOLIFY_ORACLE_MIGRATION.md` §11). (The Neon
> parts stay valid on either stack.)

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

## 4. Deploy & rollback — the Coolify flow (live stack)

> **R122 (2026-10-07):** this section now leads with the LIVE push-to-deploy
> chain. The Render-era procedure below it is LEGACY history (Render is
> billing-suspended; not a rollback path since the 2026-10 cutover). Full
> choreography of record: `docs/deployment/FINAL_ROLLBACK_RUNBOOK.md`
> (read its §0 WhatsApp single-gateway rule + §4 Neon compatibility truth
> first) and `docs/operations/CONTABO_COOLIFY_OPERATIONS.md` §7.

**Deploy path (every push):** GitHub `main` → Coolify push-to-deploy webhook
(HMAC-verified) → git-source dockerfile build → healthcheck-gated
(`/api/healthz`) rolling update. The repo is public and Actions runs green
on every push (R119+). Rollback paths on this stack, in order of preference:

1. **Deploy the previous commit (no code change):** Coolify → SubNation
   resource → point the deployment at the last-known-good SHA + set the
   matching `GIT_SHA` build arg → Deploy (panels are named by function —
   commit / redeploy-an-older-deploy; `docs/deployment/COOLIFY_FINAL_SETUP.md` §7).
   RTO ≈ one build (2–4 min).
2. **`git revert` + push:** revert the bad commit(s) on `main` and push —
   the webhook deploys the revert like any other commit. Preferred when
   history should stay linear and the revert is small.
3. **Pre-rollback gates (either path):** CI green on the target SHA; the
   migration-compatibility diff — `git diff <live-sha> <target-sha> --
   backend/src/migrate.ts shared/db/src/schema/` — empty diff = inside
   the safe window (FINAL_ROLLBACK_RUNBOOK §4); record the SHA pair.
4. **Verify:** `GET /api/healthz` → `{"status":"ok"}`; the deployed-SHA
   gate — healthz does **not** expose the SHA, so confirm the live
   `GIT_SHA` in the Coolify dashboard / container env equals the target
   (`docs/project-state/source-of-truth.md`); one login + one catalog
   page.
5. **Notify:** `POST /api/admin/alerts/test rule=worker_heartbeat_missing`
   fires a Telegram message on the ops channel (§12).
6. **Record:** incident note under
   `.kiro/specs/observability-seo-cwv-maturity:rollback-events`
   (a Memory_MCP entity, not a file path) with `commitSha`, `regression`,
   `rollbackOutcome`, `durationSec`.

Neon NEVER rolls back — data problems go to `docs/DISASTER_RECOVERY.md`,
not to a redeploy.

### LEGACY — Render rollback (pre-migration, dead path — kept as history)

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
`docs/deprecated/COOLIFY_ORACLE_MIGRATION.md` §9, the accuracy reference
for this list — the r107 guide moved to `docs/deprecated/` by the R122 docs
reorg; content unchanged): synthetic in-process leadership — **no leader election, no
PG-lease refresher, ZERO periodic Neon coordination queries**, so idle
Neon autosuspend is preserved. The old "PG-lease refresh 25 s
recurring-while-awake" and "crons under the leader lock" rows described
the pre-R108 embedded-election shape and are gone: while the process is
up, the complete recurring inventory is — **daily retention crons
00:00-05:00 UTC (~25 min/day) running unconditionally in the web
process** (NOT under a leader lock); the **60 s alerting evaluator**
(in-process counters only — no DB, no outbound; rides the WEB process in
every topology per the R146 note in docs/operations/FINAL_MONITORING.md —
the worker never starts it, and `DISABLE_WEB_SCHEDULERS=true` does not
stop it); the **Redis worker
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
> - **Canonical URL:** `https://subnation.ly` — `www → apex` **301** has been
>   LIVE at the Traefik file-provider layer since R121 (2026-10-07):
>   `/data/coolify/proxy/dynamic/www-redirect.yml`, priority 1000, path+query
>   preserved; apex serves 200. **R122 verification note:** the R121 record
>   (and the §13 text below before this pass) said **308**, but consistent
>   live probes on 2026-10-07 23:30Z (HTTP/2 + HTTP/1.1, bare root + path +
>   query, full header inspection — no intermediate hops) return **HTTP/2
>   301**. The redirect WORKS exactly as intended; only the status-code digit
>   in the record was wrong. **R124 update (2026-10-09):** the digit is
>   Traefik-regen-dependent — live probes returned **308 before the R124
>   redeploy and 301 after it** (verified stable ×3, commit `09857fc`);
>   both records were real observations. Record both states with
>   timestamps, never a bare digit. Rollback/verify:
>   `docs/operations/WWW_TO_APEX_301.md` (§4/§5). The dead v2-syntax `subnation.yml` that
>   poisoned the whole dynamic dir was archived to `dynamic-archive/`
>   (§13).
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
> project is gone, single origin only — `docs/deprecated/MIGRATION_RUNBOOK.md`
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
   only (source-map upload) — set + live as Coolify build args since R121-B
   (2026-10-07, §11); in the Render/Vercel era above they were unset.
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

## 11. Sentry — release pipeline & error tracking (LIVE since R121-B, 2026-10-07)

**Both sides are live.** Org `subnation` (**EU / de region**) with two
projects: `javascript-react` (frontend) and `subnation-backend` (backend).
End-to-end verified 2026-10-07 under release `e1de0e6` (progress log
R121-B).

**Coolify env (the wiring of record):**

| Var | Where | Role |
|---|---|---|
| `VITE_SENTRY_DSN` | SubNation **build arg** | ships the SDK + DSN into the SPA bundle (`Dockerfile` ARG) |
| `SENTRY_DSN` | SubNation **runtime** | backend SDK init |
| `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` + `SENTRY_PROJECT` | SubNation **build args** | source-map upload — frontend vite plugin + backend `backend/build.mjs` |

**Release identity = `GIT_SHA` (7-char short).** The vite plugin's release
is pinned to `VITE_RELEASE_SHA` (fallbacks `GIT_SHA` / `SOURCE_COMMIT`) —
commit `8530dfa`; the plugin default (`name@version`) orphaned the maps
from the runtime events. The backend gate (`backend/build.mjs`) runs
`sentry-cli sourcemaps inject + upload --release=<short-SHA>` and then
**deletes the `.map` files from the artefact** (Sentry retains the maps and
resolves stack traces server-side). Both upload paths run only when the
token trio is present at build time.

**The `e1de0e6` lesson (empty-`GIT_SHA` gate bypass):** Coolify passes
`GIT_SHA` declared-but-**EMPTY** on some paths; the old `??` fallback kept
`""` and slipped `--release=""` past the gate, failing the upload. Both
release computations now use `||` with a `SOURCE_COMMIT` fallback (commit
`e1de0e6`). If a build log ever shows an upload for an empty release, it is
this bug class — not a token problem.

**Verify a deploy's telemetry (the R121-B checklist):**

1. Build log: both bundles' source-map upload reports green under the new
   release (= the deployed SHA short).
2. `GET /api/admin/diagnostics/sentry-debug` (admin JWT) →
   `dsnConfigured:true` + `release:<short-SHA>`.
3. Frontend, real browser console: `__sentryStatus()` →
   `initialized:true, release:<short-SHA>` (the "Sentry not configured"
   console warning is gone when wired).
4. Controlled event: `sentry-debug?mode=throw` reaches the
   `subnation-backend` project (verify the issue via the Sentry API/UI,
   then delete it — clean state).

**Alert-rule note:** `#fe-sentry` (§2) stays DORMANT by design — the rule
evaluator needs a Sentry-events signal the backend cannot read for free.
Frontend Sentry itself is LIVE; triage via the Sentry dashboard
(`SENTRY_DASHBOARD_URL` env-gates the admin-panel deep link).

**Operator recommendation (open, not blocking):** the current
`SENTRY_AUTH_TOKEN` is **full-scope**. Swap it for an **`org:ci`-scoped
token** (org-level CI token — releases only; creation is UI-only on
Sentry SaaS) when convenient. `org:ci` cannot read DSNs or create
projects, which is the right shape for a build-arg token.

## 12. Telegram ops channel — alerts + topup approvals (LIVE since R121, 2026-10-07)

Notifications (low stock, orders, alerts) and **topup approval cards** are
delivered to the operator chat. The wiring of record (Coolify env):

- `TELEGRAM_BOT_TOKEN` — the **login bot reused** for ops (its login config
  lives in `system_settings:auth.telegram`; the ops channel reuses the same
  bot via env).
- `TELEGRAM_WEBHOOK_SECRET` — must match the `setWebhook` `secret_token`;
  enforced with a constant-time compare on every callback
  (`backend/src/routes/telegram-webhook.ts`).
- `TELEGRAM_CHAT_ID` + `TELEGRAM_ADMIN_IDS` — the destination chat + the
  accounts allowed to press the approval buttons (bootstrap: send `/start`
  to the bot — it replies with the numeric IDs; see `config/env.example`
  Telegram section).

**History:** deliveries had been **403-ing since R98** — the webhook was
registered without the secret. R121 re-registered it WITH the secret; the
403s stopped.

**Verify / diagnose:** `POST /api/admin/diagnostics/telegram-test` (admin
JWT) → expected `{"configured":true,"delivered":true,"attempts":1}`
(structured failure reasons — bad token, chat_not_found, network timeout —
come back `delivered:false` with an explanation, still HTTP 200). The §8
synthetic alert test exercises the same delivery path.

**Alert dedupe + restarts (accepted design, documented R128):** two
dedupes exist. The **admin-alerts drawer dedupe is restart-safe** — a
DB-level keyed lookup under an advisory xact lock with a 24 h window
(`backend/src/jobs/alertLogger.ts:130-161`), fixed since Round-5. The
**alerting evaluator's 5-minute side-channel dedupe** lives in a bounded
in-process map when `REDIS_URL` is unset (the deployed shape —
`backend/src/services/alerting.service.ts:846-848`, FIFO-evicted
`:210-228`), so a restart mid-incident — exactly when deploys happen —
drops the claims and can re-page Telegram **once per active rule, bounded
≤10 rules**. Accepted: the drawer dedupe is unaffected, the re-page cap is
small, and a false-quiet alert channel is the worse failure. If the re-page
ever hurts in practice, the persist option is a last-dispatched-timestamp
per rule key in `system_settings` (no live check needed — code-certain).

**Approval buttons:** the topup callback parser is strict by design —
`/^topup_(app|rej):(\d+)$/` + `Number()` validation (verified by the R121-E
Mimosa scan: no command-injection path). Only `TELEGRAM_ADMIN_IDS`
accounts can press them.

## 13. Edge canonicalization — www→apex permanent single-hop (LIVE since R121)

- **What is live:** `/data/coolify/proxy/dynamic/www-redirect.yml` — a
  standalone Traefik file-provider router at **priority 1000**; every
  `https://www.subnation.ly/<path>?<query>` → a single-hop **permanent
  redirect (301 or 308)** → the apex (path + query preserved); the apex
  serves 200 untouched. R127-L4 (B12-N1): the specific status digit is
  Traefik-regen-dependent and has flipped on every regen so far — R121
  308 → R122 probe 301 → R124 pre-redeploy 308 → post-redeploy 301 →
  R127-B12 probe 308 — so no doc pins a bare digit anymore. The
  OBSERVABLE contract to verify is: exactly ONE hop, method-preserving,
  permanent (301/308), `location` = the apex with path + query intact.
- **The poisoning lesson:** the dead v2-syntax `subnation.yml` (plus 4
  backup variants) errored on every watcher callback and **blocked the
  whole dynamic directory**. They were quarantined to
  `/data/coolify/proxy/dynamic-archive/`. Rule: **never leave a broken
  file in `dynamic/`** — a single syntax error silences every other
  dynamic router.
- **Verify (2 minutes):**
  ```bash
  curl -sI https://www.subnation.ly/ | head -n 5
  #    expect: HTTP/2 301 or 308 + location: https://subnation.ly/
  curl -sIL -o /dev/null -w '%{num_redirects} %{url_effective}\n' https://www.subnation.ly/
  #    expect: 1  https://subnation.ly/
  curl -s https://subnation.ly/api/healthz   # expect: {"status":"ok"}
  ```
- **All-routers sanity check (on the VM):** confirm all 12 Traefik routers
  are enabled — Coolify UI → Server → Proxy, or the Traefik API
  (`/api/http/routers`) via the proxy container — every router `Status:
  enabled`, including `subnation-www-redirect` (priority 1000).
- **Design + rollback record:** `docs/operations/WWW_TO_APEX_301.md`. Rollback
  = remove the file; apex is unaffected.
- **R130 — the apex's own http→https hop is now permanent (301):** the app's
  Coolify label middleware (`redirect-to-https`, `redirectscheme.scheme=https`
  without `permanent`) answered **302** since the cutover — the last edge
  polish item. `/data/coolify/proxy/dynamic/apex-https-redirect.yml` (same
  pattern: file-provider router, priority 1000, Host(`subnation.ly`) on the
  http entrypoint only, own `redirectScheme.permanent=true` middleware +
  self-contained noop service) now answers **301** with path + query
  preserved. Live-verified 2026-10-10: `http://subnation.ly/<path>?x=1` → 301
  → https (1 hop), www pair + https apex + healthz unchanged. The internal
  ACME challenge router keeps its max priority, so certificate renewal is
  unaffected. **Rollback = delete the file** (Traefik watches the directory
  and live-reloads).

## 14. Pending operator actions (living list — R122 base, additions through R134)

- **GSC verification token** — `VITE_GSC_VERIFICATION` is still unset (the
  `Dockerfile` ARG exists at the build). Paste-and-go: operator pastes the
  Google Search Console HTML-tag token into the Coolify build args →
  redeploy. Nothing else needed (the build bakes the meta tag).
  **R144:** full step-by-step + the DNS-TXT alternative now live at
  `docs/deployment/GSC_VERIFICATION_R144.md` (§16).
- **Sentry token de-scoping** — swap the full-scope `SENTRY_AUTH_TOKEN`
  build arg for an `org:ci`-scoped token (§11 recommendation).
- **Stock + TOTP** (unverified since R118): the open items in
  `docs/operations/OPERATOR_ACTIONS_R118.md` — status header refreshed
  R122.
- **R123 addition — http→https apex redirect: ✅ RESOLVED R130** (was
  "TEMPORARY — the digit drifts with Traefik regens"). The Coolify-label
  middleware kept `permanent: false` and every probe confirmed 302; instead
  of the UI flag flip, the edge now answers **301** via the standalone
  `/data/coolify/proxy/dynamic/apex-https-redirect.yml` file router (§13,
  R130 record) — live-verified 2026-10-10. No operator action remains; the
  UI-flag path in OPERATOR_ACTIONS_R118 #11 is the documented alternative.
- **R123 addition — copilot_actions / copilot_action_items retention
  policy is UNDECIDED** (currently unbounded; the only audit-grade tables
  without a window — jsonb before/after snapshots grow monotonically with
  copilot usage). The decision (180 d aligned with audit_logs / longer /
  keep-unbounded) + reference prune SQL: OPERATOR_ACTIONS_R118 #12. The
  risk-retention job (R123-E5) deliberately does NOT touch these tables
  until the policy is chosen.
- **R124 — delete the live «تجربة» test flash sale** (admin → promotions;
  `docs/history/inspection-r124/A1` §ops — the site-wide banner renders the
  literal word «تجربة» + «خصم 20%» on every storefront page; delete or
  rename the promotion row, no code change).
- **R124 — post-deploy replay canary check**: `window.__sentryTest('replay-canary')`
  in a production tab → confirm the event arrives in Sentry (org
  `subnation`, project `javascript-react` — §11) with a replay or a
  10%-roll session recorded (`frontend/src/instrument.ts:264-271`;
  `docs/history/inspection-r124/R1` #8).
- **R130 — GitHub push/CI auth: ✅ RESOLVED 2026-10-10** (was "dead on every
  machine"): the operator supplied fresh credentials; they live in the
  local git credential store (`~/.git-credentials`, 0600) with the
  `credential.helper=store` set on this clone — the `github` remote URL
  stays CLEAN (the R127-B11-F2/F4 no-tokens-in-URLs discipline). Flow that
  landed R130: push to `github/main` → CI + Coolify webhook fire; the
  repo variable `E2E_BASE_URL=https://subnation.ly` is now SET (the weekly
  e2e heartbeat is armed — R128's B5-3 closes); `workflow_dispatch` runs
  the full intended workflow (e2e + CVE + everything). If pushes start
  failing with 401 again, refresh the credential store entry
  (`git credential reject` + one interactive push) — do NOT embed tokens
  in remote URLs.
- **R130 — CI gitleaks scan-scope (documented, no action)**: push runs
  scan only the pushed commit; schedule/dispatch scan full history — the
  3 historical Firebase-key patches are commit-scoped allowlisted in
  `.gitleaks.toml` (HEAD masked; the mechanism verified against a canary
  secret). See the A9-F1 corrected record + the CHANGELOG R130 entry.
- **R132 — SEO snapshot drift (awareness, then a choice)**: the operator's
  R132 curation pass re-keyed 4 product slugs directly in the live DB; the
  JSON snapshot (`docs/SEO_PRODUCTS.json`) now differs on 41/41 seeded
  rows (R132 L4-F1 measured; DB is the newer truth). No action is needed
  for the site — but before any bulk SEO edit via the importer, re-export
  the live rows into the JSON or your edits will fight the DB
  (keep-unless-force means the DB wins by default). The importer itself
  warns about this now (its header, R134 A7-F3).

## 15. Backups & restore drills (pointer)

Nightly **on the VM host** (host cron, not Coolify, not Neon):
`scripts/backup-cron.sh` at **03:15 UTC daily**, gzip dumps to
`/var/backups/subnation/`, keep 14, exit code propagated so cron flags
failures; optional off-VM copy via `BACKUP_PRESIGNED_PUT_URL` (S3-compatible
presigned PUT). Neon's own point-in-time history is only ~6 h on the free
plan — the nightly dump is the primary recovery path.

**Full inventory + scenarios:** `docs/DISASTER_RECOVERY.md`. **Restore
procedure + drill ledger:** `docs/deployment/FINAL_RESTORE_DRILL.md` — two
PASS drills on record (2026-09-25 R112; 2026-10-01 R115 — the R115
pre-cutover drill, with the verified artifact
`subnation_preR115_20261001T024634Z.sql.gz`). Re-run a drill after any
backup-script change.

## 16. External uptime watchdog and the R144 remediation docs

**The watchdog (LIVE on merge — `.github/workflows/uptime-monitor.yml`,
R144-D1).** Closes R143 L17-5: every in-process watcher dies with the
container, so a dead/hung container used to produce silence for up to a
week. GitHub Actions now probes production **from outside the VM** every
~5 minutes (`schedule: */5` + manual `workflow_dispatch`):

- Probes: `https://subnation.ly/` (200 after redirects — DNS + TLS +
  Traefik + container), `/api/healthz` (200 + `"ok"` — the zero-DB
  readiness handler, FINAL_MONITORING §5-compliant; a boot 503 correctly
  reads as DOWN), and TLS cert expiry (**< 14 days = failure** — Traefik's
  ACME renewal normally keeps ~60+).
- Any probe failure → the run goes **red** (the Actions history is the
  outage record, one sample per 5 minutes) and pages Telegram; a
  success right after a failed **scheduled** run pages one
  **🟢 RECOVERY** notice (manual dispatch runs never enter that
  comparison — no false recoveries from drills).
- Alert copy mirrors `backend/src/services/alerting.service.ts`
  `formatTelegramMessage` (severity emoji + rule + summary + "Fired at:" +
  "Runbook:" footer) with the Arabic ops phrasing of
  `backend/src/telegram.ts`; delivery follows the same contract (HTTP 200
  **and** `body.ok` — 200-with-`ok:false` is a failed page).

**Setup (one time):** repo Settings → Secrets and variables → Actions →
add `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` — the SAME values as the
Coolify env of record (§12). Then run the delivery drill: Actions →
"Uptime Monitor (external watchdog)" → **Run workflow** → tick
**test_alert** → expect a 🔧 test message in the ops chat within a minute
and a green run (this mirrors §8's synthetic alert test for the external
lane). Without the secrets the watchdog still runs and still goes red on
outages — each failing run logs one clear "ALERTING NOT CONFIGURED" line;
only the Telegram page is missing.

**When it pages:** the probe failure lines name the dead layer (000 = no
answer at all → VM/edge; healthz 503 = boot/migrations in progress → watch,
don't panic for ~150 s; healthz dead + home 200 = container-gone-but-edge-
up). Triage: §4 (deploy/rollback) + `docs/operations/FINAL_MONITORING.md`
§3 (the symptom table). Cadence honesty: GitHub cron is UTC and may delay
runs a few minutes; scheduled workflows auto-disable after 60 days of repo
inactivity — after any long quiet stretch, check the Actions tab.

**The two R144 remediation runbooks** (operator/panel work — the repo ships
no Traefik or firewall config, so these are VM-side by definition):

- `docs/deployment/EXPOSURE_REMEDIATION_R144.md` — close Traefik **:8080**
  (unauthenticated dashboard + API, L17-1) and Reverb **:6001** (Coolify's
  realtime, no app consumer) on the Contabo host; includes the
  verification protocol (both ports must fail from outside while 80/443
  keep answering) and the never-lock-out-management warnings for the
  22/80/443 firewall backstop.
- `docs/deployment/GSC_VERIFICATION_R144.md` — the one owner action that
  finishes Google Search Console (§14's oldest pending item): paste the
  GSC HTML-tag token into the `VITE_GSC_VERIFICATION` build arg, redeploy,
  verify externally, click Verify. No repo change needed.

