# Observability Setup

This document describes the SubNation2 observability stack as it ships in
production. Last updated 2026-05-16. Audience: platform & SRE.

## 1. Architecture

```
                ┌─────────────────────────────┐
   user ───►    │  Render web (subnation2)    │
                │  ┌───────────────────────┐  │
                │  │  Express 5 pipeline   │  │
                │  │ correlation → pino-   │  │
                │  │ http (genReqId from   │  │
                │  │ ALS) → metrics →      │  │
                │  │ instrumentation-      │  │
                │  │ isolation             │  │
                │  └───────────────────────┘  │
                │            │                │
                │   /api/metrics (Prom)       │
                │   /api/healthz/{,ready,     │
                │      redis,neon,worker,     │
                │      socket,firebase}       │
                │   /api/admin/observability/*│
                │   /api/admin/diagnostics    │
                │   /robots.txt /sitemap.xml  │
                └────┬─────────────┬──────────┘
                     │             │
            ┌────────▼──┐    ┌─────▼──────┐    ┌──────────────────┐
            │ Sentry    │    │ Render     │    │ Telegram bot +   │
            │ (errors + │    │ logs +     │    │ Discord webhook  │
            │  traces + │    │ metrics    │    │ + generic webhook│
            │ replay-   │    │ (host)     │    │ (alerting svc)   │
            │ disabled) │    │            │    │                  │
            └───────────┘    └────────────┘    └──────────────────┘

                ┌─────────────────────────────┐
                │  Render worker (subnation-  │
                │   worker)                   │
                │   • startHeartbeat()        │
                │     → Redis worker:heartbeat│
                │     every 15s, TTL 60s      │
                │   • alertingService.start() │
                │     → 60 s evaluator loop   │
                │   • cron jobs               │
                └─────────────────────────────┘
```

## 2. Correlation_ID flow

1. Inbound request hits `correlationMiddleware` (`backend/src/middlewares/correlation.ts`).
2. The middleware reads `x-request-id`, validates UUID v4, mints a fresh one
   on miss, echoes it back on the response, and runs the rest of the request
   inside an `AsyncLocalStorage` context.
3. `pino-http` is configured with `genReqId: () => getCorrelationId() ?? randomUUID()`
   and `customAttributeKeys: { reqId: "correlation_id" }`, so every Pino log
   line carries `correlation_id`.
4. `backend/src/lib/sentry.ts` `beforeSend` reads the same correlation id
   from the AsyncLocalStorage and attaches it as `event.tags.correlation_id`.
5. Frontend Sentry events propagate request id automatically when emitted
   from a request initiated with the `x-request-id` header (future hook —
   currently optional; fallback is the per-event Sentry id).

## 3. Pino structured-log schema

`backend/src/lib/logger.ts` binds `service` (`web` | `worker`) and `version`
(`RENDER_GIT_COMMIT[:7]`) at process start. Per-request lines additionally
emit:

| Field                                       | Type                                                          | Source                              |
| ------------------------------------------- | ------------------------------------------------------------- | ----------------------------------- |
| `level`                                     | enum (`info`, `warn`, `error`, `fatal`, `debug`, `trace`)     | pino                                |
| `time`                                      | epoch ms                                                      | pino                                |
| `msg`                                       | string                                                        | call site                           |
| `correlation_id`                            | UUID v4                                                       | `pino-http customAttributeKeys`     |
| `req.method` / `req.url` / `res.statusCode` | string / int                                                  | `pino-http`                         |
| `category`                                  | `auth` / `worker` / `alerting` / `monitoring` / `cwv` / `seo` | child loggers (`authLogger()` etc.) |

Redaction (extends previous policy):

```
req.headers.authorization, req.headers.cookie, res.headers["set-cookie"],
password*, *token*, *secret*, otp, card_number, cvv,
sender_account, ssn, national_id
```

## 4. Sentry

Per the official **`sentry-react-sdk`** skill
(https://github.com/getsentry/sentry-for-ai/blob/main/skills/sentry-react-sdk/SKILL.md),
`Sentry.init()` lives in a dedicated sidecar `frontend/src/instrument.ts`
and is the **very first import** of `frontend/src/main.tsx`. React 19 errors
are captured via `reactErrorHandler()` registered on all three `createRoot`
options (`onUncaughtError`, `onCaughtError`, `onRecoverableError`). The
custom `<ErrorBoundary>` forwards its caught errors to Sentry too, with the
React component stack as additional context.

| Setting                    | Backend (`@sentry/node`)                                                           | Frontend (`@sentry/react`)                                                                 |
| -------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| DSN                        | `SENTRY_DSN` (auto-generated by Render)                                            | `VITE_SENTRY_DSN` (with hardcoded fallback in `instrument.ts` — DSNs are public-by-design) |
| Release                    | `RENDER_GIT_COMMIT[:7]`                                                            | `VITE_APP_VERSION` or `VITE_RELEASE_SHA[:7]` (or `MODE`)                                   |
| `tracesSampleRate`         | 0.1 prod / 1.0 dev                                                                 | 0.1 prod / 1.0 dev                                                                         |
| `tracePropagationTargets`  | n/a                                                                                | `localhost`, `127.0.0.1`, `*.subnation.ly`, `*.subnation2.onrender.com` (legacy), `VITE_APP_ORIGIN` |
| `replaysSessionSampleRate` | n/a                                                                                | 0.1 prod / 0 dev                                                                           |
| `replaysOnErrorSampleRate` | n/a                                                                                | 1.0                                                                                        |
| `enableLogs`               | n/a                                                                                | true (use `Sentry.logger.*`)                                                               |
| `sendDefaultPii`           | default                                                                            | **true** (per skill — IP + headers)                                                        |
| `beforeSend`               | strips cookies + auth header; filters `/health` URLs; injects `correlation_id` tag | default                                                                                    |

### Source-map upload

Frontend: `@sentry/vite-plugin` is in `frontend/vite.config.ts` and active
**only when `SENTRY_AUTH_TOKEN` is set** (so local builds and unprovisioned
CI builds skip it cleanly). `build.sourcemap = "hidden"` produces maps that
are uploaded by the plugin but never linked from the production bundle, so
end users cannot fetch them.

Backend: `backend/build.mjs` already emits `dist/*.mjs.map`. Add a
`@sentry/cli` upload step to the pipeline once the auth token lands.

### Bundle impact

Sentry SDK weighs ~270 KB raw (`vendor-sentry-*.js`). The chunk is split
out via `manualChunks` in `vite.config.ts` so the main `index-*.js` entry
stays at ~21,690 B gzip, well under the 47 KiB warn / 55 KiB fail bundle
budget. Sentry still loads on the critical path via Vite's
`<link rel="modulepreload">`.

## 5. `/api/metrics` schema

Prometheus exposition. Counter / Histogram / Gauge:

| Metric                          | Type                   | Labels                             |
| ------------------------------- | ---------------------- | ---------------------------------- |
| `http_requests_total`           | counter                | `route, method, status`            |
| `http_request_duration_seconds` | histogram (11 buckets) | `route, method, status`            |
| `auth_outcomes_total`           | counter                | `method, outcome`                  |
| `redis_ops_total`               | counter                | `op, status`                       |
| `redis_errors_total`            | counter                | `reason`                           |
| `socket_connected_clients`      | gauge                  | —                                  |
| `socket_events_total`           | counter                | `event, direction`                 |
| `worker_jobs_total`             | counter                | `job, status`                      |
| `neon_connections_active`       | gauge                  | —                                  |
| `neon_inflight_queries`         | gauge                  | —                                  |
| `cwv_samples_total`             | counter                | `name, route, viewport`            |
| `cwv_sample_value`              | histogram              | `name, route, viewport`            |
| `monitoring_errors_total`       | counter                | `component`                        |
| `alerts_dispatched_total`       | counter                | `rule, severity, channel, outcome` |

Also: default Node.js process metrics (memory, CPU, event-loop lag,
gc duration, …) via `prom-client.collectDefaultMetrics()`.

### Auth gate

`/api/metrics` accepts either:

- a valid admin JWT (cookie `admin_token` or `Authorization: Bearer <jwt>`), or
- `Authorization: Bearer ${METRICS_ADMIN_TOKEN}` compared in constant time.

Anything else → 401 within 1 s with no body leakage.

## 6. Health endpoints

| Endpoint                    | Status                                                              |
| --------------------------- | ------------------------------------------------------------------- |
| `GET /api/healthz`          | liveness (always 200 with `status: "ok"`) — preserved byte-for-byte |
| `GET /api/healthz/ready`    | aggregate readiness (Redis + Neon + worker + Socket)                |
| `GET /api/healthz/firebase` | Firebase Admin diagnostics (existing)                               |
| `GET /api/healthz/redis`    | per-check Redis ping with degraded/failing thresholds               |
| `GET /api/healthz/neon`     | per-check `SELECT 1`                                                |
| `GET /api/healthz/worker`   | reads `worker:heartbeat` from Redis                                 |
| `GET /api/healthz/socket`   | adapter reachability via Redis ping                                 |

Thresholds (from `design.md §3.1.7`):

| Check                | Degraded           | Failing            |
| -------------------- | ------------------ | ------------------ |
| Redis ping           | > 200 ms           | 3 failures in 30 s |
| Neon `SELECT 1`      | > 500 ms           | 2 failures in 30 s |
| Worker heartbeat age | > 60 s             | > 180 s            |
| Socket adapter       | unreachable > 30 s | > 90 s             |

`status: "ok"` and `status: "degraded"` return HTTP 200; `status: "failing"`
returns 503. Failure counters are stored in Redis keys `health:fail:{check}`
with 60 s TTL.

## 7. Worker heartbeat

`backend/src/worker/heartbeat.ts` writes the Redis key `worker:heartbeat`
every 15 s with payload `{ ts: epoch_ms, version: "abc1234" }` and TTL 60 s.
SIGTERM cleanly cancels the interval. The write is wrapped in
`isolate("worker-heartbeat", …)` so a transient Redis hiccup increments
`monitoring_errors_total{component:"worker-heartbeat"}` instead of crashing
the worker.

## 8. Environment variables (observability surface only)

| Var                             | Required                       | Purpose                                       |
| ------------------------------- | ------------------------------ | --------------------------------------------- |
| `SENTRY_DSN`                    | yes (auto-generated by Render) | backend Sentry                                |
| `SENTRY_AUTH_TOKEN`             | recommended                    | source-map upload                             |
| `SENTRY_ORG` / `SENTRY_PROJECT` | with `SENTRY_AUTH_TOKEN`       | source-map upload                             |
| `SENTRY_DASHBOARD_URL`          | optional                       | shown by `/api/admin/observability/summary`   |
| `VITE_SENTRY_DSN`               | yes                            | frontend Sentry                               |
| `VITE_RELEASE_SHA`              | optional                       | frontend release tag                          |
| `METRICS_ADMIN_TOKEN`           | recommended                    | static auth for `/api/metrics`                |
| `METRICS_ENABLED`               | optional                       | flag for future ramp                          |
| `NEW_HEALTH_CHECKS_ENABLED`     | optional                       | flag for future ramp                          |
| `RENDER_DASHBOARD_URL`          | optional                       | dashboard widget link                         |
| `NEON_DASHBOARD_URL`            | optional                       | dashboard widget link                         |
| `REDIS_URL`                     | yes (Render-injected)          | rate-limit, alerting dedup, Socket.IO adapter |
| `RENDER_GIT_COMMIT`             | injected by Render             | release / version tag                         |
| `RENDER_SERVICE_NAME`           | injected by Render             | discriminates web vs worker logs              |

## 9. Admin observability JSON API

| Endpoint                                      | Purpose                                                                                                                          |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/admin/observability/summary`        | server, redis, worker heartbeat age, recent alerts count, dashboard URLs                                                         |
| `GET /api/admin/observability/alerts/recent`  | last 50 admin alerts (60 s in-memory cache + last-known-good fallback)                                                           |
| `GET /api/admin/observability/deploys/recent` | placeholder — wires to Render_MCP `list_deploys` once `RENDER_API_KEY` is provisioned                                            |
| `GET /api/admin/observability/sentry/summary` | placeholder — wires to Sentry issues API once `SENTRY_AUTH_TOKEN` is provisioned                                                 |
| `GET /api/admin/diagnostics`                  | Node version, uptime, RSS, heap, event-loop lag (`perf_hooks.monitorEventLoopDelay`), Redis/Socket statuses, feature-flag values |

All routes are gated by `requireAdmin`; non-admins receive 401/403 within
1 s with no telemetry payload.

## 10. Session Replay decision

**Enabled** (per the official Sentry React skill). Configuration:

- `Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true })`.
- `replaysSessionSampleRate: 0.1` in production, `0` in development.
- `replaysOnErrorSampleRate: 1.0` — every error session is recorded.
- CSP additions in `backend/src/app.ts`:
  - `worker-src 'self' blob:` (Replay's recorder runs in a Web Worker
    created from a blob: URL).
  - `connect-src` includes `https://*.sentry.io`,
    `https://*.ingest.sentry.io`, `https://*.ingest.de.sentry.io`,
    `https://*.ingest.us.sentry.io` for ingest delivery.
- Trusted Types remain unset (Firebase compatibility); Replay's policy is
  not blocked.

If a future CSP audit flags new violations, set
`replaysSessionSampleRate: 0` and `replaysOnErrorSampleRate: 0` in
`frontend/src/instrument.ts` to disable.

## 11. Verification

A built-in test surface lives at `/__sentry-test` (`frontend/src/components/SentryTest.tsx`):

- Throw a test error — captured by `reactErrorHandler()`, appears under
  Issues within seconds.
- Capture an info message — uses `Sentry.captureMessage`.
- Send a structured log line — uses `Sentry.logger.info`, appears under
  Logs.

Curl-equivalent for backend Sentry (synthetic 500 once the test endpoint
in `master-execution-plan.md` task 20.1 is wired):

```bash
curl -H "x-test-token: $TEST_TOKEN" \
  https://subnation.ly/api/_test/error-synthetic
```
