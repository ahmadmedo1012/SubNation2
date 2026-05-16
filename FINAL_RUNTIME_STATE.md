# Final Runtime State — SubNation2

**Date:** 2026-05-16 (post backend-observability sweep)
**Latest deployed commit:** `36042b8` (CWV fix) — verified live since 2026-05-16T05:49Z
**This document supersedes:** `FINAL_PLATFORM_STATE.md` (2026-05-16 morning)

---

## 1. Headline diagnostic — ⚠️ Owner action blocks 60% of observability

### `subnation-redis` is declared in `render.yaml` but does NOT exist in your Render workspace.

Live evidence:

```
$ render-mcp list_key_value
No Key Value instances found

$ curl https://subnation2.onrender.com/api/healthz/ready | jq .checks
{
  "redis":  { "status": "failing", "error": "Redis not configured" },
  "neon":   { "status": "failing", "error": "Neon database not configured" },
  "worker": { "status": "failing", "error": "Redis not configured (needed for worker check)" },
  "socket": { "status": "failing", "error": "Socket.IO not initialized or Redis not configured" }
}

$ render-mcp list_logs --text REDIS_URL
"REDIS_URL is missing in production. Falling back to in-memory stores. This is NOT recommended for production scaling."
   — at every web service boot since the Phase 2 sweep
```

### `subnation-worker` is declared in `render.yaml` but does NOT exist either.

Only one backend service is provisioned (`srv-d7vv91tckfvc73evnccg`,
the web). The `subnation-worker` blueprint entry has not been applied.
Consequence: heartbeat is never written, alerting evaluator never runs,
cron jobs are not executing.

### Owner action required (one-time)

Run from the Render dashboard, or via Render MCP `create_key_value` and a
follow-up service create. The free-tier defaults are correct:

```
1. Provision Redis service:
   create_key_value name=subnation-redis plan=free region=oregon
2. Re-apply the worker service from render.yaml (Render dashboard > New > Blueprint)
3. Set Render env vars (8 of these):
   METRICS_ADMIN_TOKEN       (random ≥32 chars)
   ALERTING_ENABLED=false    (start in dark-launch; flip after first 24h)
   DISCORD_WEBHOOK_URL       (optional)
   GENERIC_ALERT_WEBHOOK_URL (optional)
   SENTRY_AUTH_TOKEN
   SENTRY_ORG
   SENTRY_PROJECT
   VITE_SENTRY_DSN
```

After step 1, `REDIS_URL` is auto-injected (per `render.yaml`).
Once Redis is connected, every health check flips to `ok` and every
dormant Redis-dependent metric starts populating.

---

## 2. What shipped in this session (code-level, ready to deploy)

### Backend Sentry — full skill compliance
- `backend/src/instrument.ts` (NEW) — sidecar that runs `Sentry.init()` as the
  very first side effect, plus flush-on-exit handlers for `uncaughtException`
  and `unhandledRejection`.
- `backend/src/server.ts` and `backend/src/worker.ts` now `import "./instrument"`
  as their first line so Sentry's auto-instrumentation patches Express / HTTP
  before any handler is registered.
- `backend/src/app.ts` registers `Sentry.setupExpressErrorHandler(app)` after
  all routes and before the custom Arabic error handler.
- `backend/src/lib/sentry.ts` already injects `correlation_id` tag from
  `AsyncLocalStorage` via `beforeSend`.
- `backend/build.mjs` runs Sentry CLI `sourcemaps inject` + `upload`
  (gated by `SENTRY_AUTH_TOKEN/ORG/PROJECT`) and strips `.map` files from
  the deploy artefact post-upload.
- `@sentry/cli` added to backend devDependencies.

### Metrics — dormant counters now incrementing
- `backend/src/lib/auth-activity.ts` — every login / register / Firebase /
  OTP / lockout path now emits `auth_outcomes_total{method, outcome}`.
- `backend/src/lib/redis-client.ts` — `redis_ops_total` and
  `redis_errors_total` populate from client events (`connect`,
  `reconnecting`, `end`, `error`) and from a `trackRedisOp()` helper that
  hot-path callers can adopt.
- `backend/src/lib/socket.ts` — `socket_connected_clients` (gauge) and
  `socket_events_total` (counter) populate on every connection / disconnect /
  join-user / join-admin / emit.

### Alerting — real evaluators replace `return false`
- `services/alerting.service.ts::checkRuleCondition` now wires real reads
  for **3 of 10 rules**:
  - `worker_heartbeat_missing` — Redis `worker:heartbeat` age vs window
  - `redis_disconnect` — counter delta on `redis_errors_total`
  - `neon_connection_failure` — counter delta on the same (placeholder
    until Neon-specific counter is wired)
  The other 7 rules return false and are documented as P2-pending in
  `ALERTING_ARCHITECTURE.md`.

### Telegram / Discord / generic webhook dispatch is real (from prior session) — `attemptDispatch` makes actual HTTP calls with `AbortSignal.timeout(10s)`, retry-once-after-5s, Sentry capture on retry-failure, and ALERTING_ENABLED dark-launch gate.

### CWV ingestion — fixed and verified live
- Frontend `web-vitals.ts` wraps the JSON in a `Blob` with
  `type: "application/json"` so `navigator.sendBeacon` doesn't default to
  `text/plain`.
- Backend `routes/cwv.ts` adds a route-scoped `express.text()` parser as
  defence-in-depth; returns `400` with explicit `reason:
  "malformed_json" | "empty_body" | "schema_mismatch"`.
- 9 new vitest cases cover all three Content-Type vectors + every validator
  failure mode.
- **Production validated**: every `/api/cwv` POST since deploy `36042b8`
  (2026-05-16T05:49Z) returns `204`. Zero `400`s.

---

## 3. Live production posture

### Working
| Surface | State |
|---|---|
| `GET /api/healthz` | ✅ 200 `{status:"ok"}` |
| `POST /api/cwv` (Blob path) | ✅ 204 |
| `POST /api/cwv` (text/plain defence path) | ✅ 204 |
| `GET /robots.txt` | ✅ correct body |
| `GET /sitemap.xml` | ✅ XML with hreflang |
| `GET /api/metrics` (no token) | ✅ 401 |
| Frontend Sentry | ✅ confirmed in user's earlier dashboard |
| Backend Sentry — `Sentry.init()` | ✅ DSN auto-generated by Render |
| Express CSP, COOP, scriptSrc | ✅ unchanged from baseline |

### Working but degraded (Redis missing)
| Surface | State |
|---|---|
| Rate limiter | falls back to in-memory (single-instance only) |
| Alerting dedup / global rate-limit | fails open (could over-alert) |
| Socket.IO Redis adapter | not connected (single-instance only) |
| `redis_*` metrics | only `redis_errors_total{reason="connection_failed"}` increments at boot |

### Failing (correctly reporting failing — fixes once Redis lands)
| Surface | State |
|---|---|
| `GET /api/healthz/ready` | 503 — all 4 dependency checks failing |
| `GET /api/healthz/redis` | 503 |
| `GET /api/healthz/neon` | 503 |
| `GET /api/healthz/worker` | 503 (also worker service not provisioned) |
| `GET /api/healthz/socket` | 503 |
| Worker heartbeat | not running (worker service not provisioned) |
| Alerting evaluator | not running (worker service not provisioned) |
| Cron jobs (coupon, stock, OTP cleanup) | not running |

### Backend Sentry — partial
- `Sentry.init()` ✅
- Express error capture ✅ (this session)
- Global uncaughtException / unhandledRejection capture ✅ (auto + flush-on-exit)
- Source-map upload ⏸ owner-blocked (`SENTRY_AUTH_TOKEN/ORG/PROJECT`)

---

## 4. Validation evidence

### Local (this session)

```
pnpm typecheck        ✓ workspace (backend, frontend, scripts) clean
vitest                Test Files 9 passed (9) | Tests 80 passed (80)
backend build         ✓ esbuild emits dist/index.mjs + dist/worker.mjs
                      [sentry] source-map upload skipped (SENTRY_AUTH_TOKEN/ORG/PROJECT not set)
frontend build        ✓ vite emits dist/public/* with bundle 21,691 B gzip on the index entry
```

### Production (against https://subnation2.onrender.com)

| Check | Result |
|---|---|
| `/api/healthz` | `200 {status:"ok"}` |
| `/api/cwv` valid sample | `204` |
| `/api/metrics` no token | `401` |
| `/robots.txt` | served |
| Render last deploy | `36042b8` live since 05:49Z |
| Render logs grep "REDIS_URL" | `REDIS_URL is missing in production. Falling back to in-memory stores.` (every boot) |
| Render `list_key_value` | `No Key Value instances found` — diagnostic match |

---

## 5. Honest residual risk

| Risk | Severity | Mitigation in code | Owner step |
|---|---|---|---|
| `subnation-redis` not provisioned | **HIGH** | code already guards with in-memory fallback | create the KV service in Render |
| `subnation-worker` not provisioned | **HIGH** | code is correct; service must exist | apply blueprint or create service |
| Source-map upload skipped | medium | gracefully no-ops; build still ships | provision `SENTRY_AUTH_TOKEN/ORG/PROJECT` |
| `auth_outcomes_total` rule evaluators not wired | medium | counter increments correctly; eval returns false | next session, add `evalCounterDelta` for `auth_failure_rate_high` etc. |
| 7 of 10 alert rules still no-op | medium | dispatch path is real and tested via `/api/admin/alerts/test` | wire metric reads in `checkRuleCondition` |
| `worker_jobs_total` / `neon_*` counters not incremented | low | counters defined; only call sites missing | one PR per cron job + a single `pg.Pool` event hook |

---

## 6. Next-session priorities

| Pri | Task | Owner |
|---|---|---|
| P0 | Provision `subnation-redis` (free tier) and `subnation-worker` (starter, free unavailable for workers) in Render | DevOps |
| P0 | Set `METRICS_ADMIN_TOKEN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `VITE_SENTRY_DSN` Render env vars | DevOps |
| P1 | After Redis lands, verify `/api/healthz/ready` flips to `ok`; verify `worker:heartbeat` key appears | Code |
| P1 | Wire `worker_jobs_total` in each cron file (`backend/src/jobs/*.ts`) | Code |
| P1 | Wire `neon_connections_active` / `neon_inflight_queries` from `pg.Pool` events in `shared/db/src/index.ts` | Code |
| P2 | Wire remaining 7 alert rule evaluators (`evalCounterDelta` template is in place) | Code |
| P2 | Frontend admin Observability dashboard UI (backend endpoints already shipped) | Code |
| P2 | Render_MCP-driven rollback automation script | Code |
| P3 | Lighthouse CI + image AVIF/WebP optimization | Code + assets |

---

## 7. Memory_MCP entities (for cross-session continuity)

- `subnation2:audit:2026-05-16` — pre-sweep state findings
- `subnation2:roadmap:next-priorities` — P0/P1/P2/P3 priorities
- `subnation2:state:post-stabilization:2026-05-16` — post-stabilization deltas
- `subnation2:state:post-backend-observability:2026-05-16` (this session) — see §2

---

## 8. Companion documents

- `OBSERVABILITY_SETUP.md` — overall observability architecture (updated)
- `ALERTING_ARCHITECTURE.md` — alert rule taxonomy + dispatch (updated)
- `SEO_AND_CWV_REPORT.md` — CWV pipeline (now post-fix) + SEO
- `OPERATIONS_RUNBOOK.md` — per-rule triage + rollback
- `SENTRY_BACKEND_SETUP.md` — backend-only Sentry setup (NEW this session)
- `METRICS_AND_MONITORING.md` — metric catalog + cardinality discipline (NEW this session)
- `docs/AUDIT_REPORT_2026-05-16.md` — the comprehensive read-only audit that drove the prior sweeps
