# Metrics &amp; Monitoring

End-to-end reference for the Prometheus-style metrics emitted by the
SubNation backend.

## 1. Endpoint

`GET /api/metrics` — Prometheus exposition format. Auth required (admin
JWT cookie/bearer **OR** `Authorization: Bearer ${METRICS_ADMIN_TOKEN}`,
constant-time-compared). Response body is `await registry.metrics()`.

Default Node.js process metrics (memory, CPU, GC, event-loop lag) are
emitted automatically by `prom-client::collectDefaultMetrics()`.

## 2. Metric catalog

| Metric | Type | Labels | Where emitted |
|---|---|---|---|
| `http_requests_total` | counter | `route, method, status` | `middlewares/metrics.ts` on `res.finish` |
| `http_request_duration_seconds` | histogram | `route, method, status` | same |
| `auth_outcomes_total` | counter | `method, outcome` | `lib/auth-activity.ts` (chokepoint for every login/register/logout/Firebase/OTP) |
| `redis_ops_total` | counter | `op, status` | client events + `trackRedisOp()` wrapper |
| `redis_errors_total` | counter | `reason` | client error / disconnect / reconnect events |
| `socket_connected_clients` | gauge | — | `lib/socket.ts` connect / disconnect |
| `socket_events_total` | counter | `event, direction` | `lib/socket.ts` connect / join-user / join-admin / `emitToUser` / `emitToAdmins` |
| `worker_jobs_total` | counter | `job, status` | (P2-pending — instrument each cron in `backend/src/jobs/*.ts`) |
| `neon_connections_active` | gauge | — | (P2-pending — wire from `pg.Pool` in `shared/db/src/index.ts`) |
| `neon_inflight_queries` | gauge | — | (P2-pending) |
| `cwv_samples_total` | counter | `name, route, viewport` | `routes/cwv.ts` on every accepted beacon |
| `cwv_sample_value` | histogram | `name, route, viewport` | same |
| `monitoring_errors_total` | counter | `component` | every `safeInc/safeObserve/safeSet` catch path |
| `alerts_dispatched_total` | counter | `rule, severity, channel, outcome` | `services/alerting.service.ts` |

## 3. Cardinality discipline

- `route` label is the **Express route pattern** (e.g. `/products/:id`),
  never the resolved URL. Unmatched routes collapse to `"unknown"`.
- `method` is lower-cased.
- `status` is the response status code as a string.
- `event` (Socket.IO) is the event name; we don't include user IDs.

Total expected unique label combinations across the whole catalog stays
under ~500 — well within Prometheus practice for a free-tier scrape.

## 4. Active vs P2-pending instrumentation

Counters that **already increment in production** as of this session:

- `http_requests_total` / `http_request_duration_seconds` — every HTTP request
- `auth_outcomes_total` — every auth path that calls `logAuthActivity`
- `redis_ops_total` / `redis_errors_total` — connect / reconnect / disconnect /
  command failures (more ops covered as call sites adopt `trackRedisOp()`)
- `socket_connected_clients` / `socket_events_total` — every Socket.IO connect /
  disconnect / join-user / join-admin / emit
- `cwv_samples_total` / `cwv_sample_value` — every accepted CWV beacon
- `alerts_dispatched_total` — every alert dispatch outcome
- `monitoring_errors_total` — every metric emission failure (instrumentation isolation)

P2-pending — counter exists but **no call site emits to it yet**:

- `worker_jobs_total` — cron job entry/exit needs explicit `safeInc` calls in
  `backend/src/jobs/*.ts`.
- `neon_connections_active` / `neon_inflight_queries` — needs `pg.Pool`
  event hooks in `shared/db/src/index.ts`.

These dormant counters stay at zero on `/api/metrics` until their call
sites are wired. The `auth_outcomes_total` instrumentation pattern (single
chokepoint) is the recommended template for the worker-jobs work.

## 5. Production verification

```bash
# 1. /api/metrics requires admin auth
curl -i https://subnation2.onrender.com/api/metrics
# → HTTP 401

# 2. With METRICS_ADMIN_TOKEN
curl -H "Authorization: Bearer $METRICS_ADMIN_TOKEN" \
  https://subnation2.onrender.com/api/metrics | head -40
# → text/plain Prometheus exposition; first lines include
#   # HELP http_requests_total Total number of HTTP requests
#   # TYPE http_requests_total counter
#   http_requests_total{route="/api/healthz",method="get",status="200"} 1234
```

## 6. Required Render env vars

| Var | Status | Purpose |
|---|---|---|
| `METRICS_ADMIN_TOKEN` | ❌ not set | static auth for `/api/metrics` (opaque random string ≥ 32 chars) |
| `METRICS_ENABLED` | optional | feature flag for future ramp |

Once `METRICS_ADMIN_TOKEN` is set, your Prometheus / Grafana scraper can
authenticate with `Authorization: Bearer …`. Until then, only an admin JWT
unlocks the endpoint.

## 7. Cross-references

- `OBSERVABILITY_SETUP.md` — overall observability architecture
- `ALERTING_ARCHITECTURE.md` — how the metrics feed into alert rules
- `SENTRY_BACKEND_SETUP.md` — error correlation via `correlation_id` tag
