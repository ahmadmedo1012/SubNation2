# Final Runtime State — SubNation2

**Last updated:** 2026-05-16 (post-cleanup)
**Production canonical:** `https://subnation.ly`
**State:** pre-launch hardening — no legacy compatibility, single canonical domain, all observability and runtime systems live.

This document is the **single living source of truth** for the platform's
runtime state.

---

## 1. Headline scorecard

| Dimension | Score | Notes |
|---|---|---|
| Functional production-readiness | **8.5 / 10** | Custom domain, Firebase auth on canonical, Redis live, observability wired, alerting real, CWV pipeline working, document direction stable |
| Enterprise-readiness | **6.5 / 10** | No SSO/RBAC depth, mock payments, no E2E tests, but the operational tier is in good shape |
| Build / CI | green | typecheck, unit tests, build all pass |
| Security guardrails | preserved | CSP, COOP, scriptSrcAttr, Trusted Types untouched; no inline scripts; HSTS preload |

---

## 2. Production surface (`https://subnation.ly`)

| Surface | Status |
|---|---|
| `https://subnation.ly/` | ✅ 200 |
| `https://subnation.ly/api/healthz` | ✅ 200 `{"status":"ok"}` |
| `https://subnation.ly/api/healthz/ready` | ✅ 200 — redis ~63 ms, neon ~66 ms, worker ~62 ms, socket ~63 ms |
| `https://subnation.ly/sitemap.xml` | ✅ XML with hreflang, all `<loc>` use canonical |
| `https://subnation.ly/robots.txt` | ✅ canonical sitemap reference |
| `https://www.subnation.ly/*` | ✅ 301 → `https://subnation.ly/*` (Render edge; app middleware as defence) |
| `POST /api/cwv` (any of `application/json` / `text/plain` / `application/octet-stream`) | ✅ 204 |
| `GET /api/metrics` (no token) | ✅ 401 (admin-gated) |
| Frontend Sentry | ✅ confirmed working, replay enabled with text masking |
| Backend Sentry init + Express error handler + uncaughtException flush | ✅ wired |
| Firebase Google Sign-In on `subnation.ly` | ✅ confirmed working (Firebase Console authorized domains updated) |
| TLS — Google Trust Services on apex AND www | ✅ valid |
| HSTS preload | ✅ `max-age=31536000; includeSubDomains; preload` |
| Document direction | ✅ locked at boot; no flicker on route transitions |

---

## 3. Active runtime systems

| System | State | Where |
|---|---|---|
| Redis | live, Redis Cloud, ~63 ms ping | `lib/redis-client.ts` singleton |
| Socket.IO Redis adapter | active | `lib/socket.ts` |
| rate-limit-redis | using Redis | `app.ts` apiLimiter / authLimiter / otpLimiters |
| Web schedulers (heartbeat, alerting evaluator, cron) | running in web tier under Redis leader lock | `lib/web-scheduler.ts`, `lib/scheduler-coordinator.ts` |
| `worker:heartbeat` | written every 15 s | `worker/heartbeat.ts` |
| Alerting evaluator | running every 60 s; 6 of 10 rules have real evaluators | `services/alerting.service.ts` |
| Alerting dispatch | real Telegram + Discord + generic webhook with `AbortSignal.timeout(10s)` + retry-once-after-5s + Sentry capture | same |
| Alerting dedup | Redis `SET NX EX 300` keyed `alert:dedup:<rule>|<labelHash>` | same |
| Alerting global rate-limit | Redis windowed `INCR alert:global:<minute>` + EXPIRE 70 (≤30/min) | same |
| Cron jobs | couponWatcher, stockWatcher, otpCleanup, cron — running in web tier | `jobs/*` |
| CWV ingestion | Blob with `application/json` Content-Type from frontend; Express `text/plain` parser as defence | `frontend/src/lib/web-vitals.ts` + `backend/src/routes/cwv.ts` |
| Backend Sentry | `instrument.ts` sidecar imported first; `setupExpressErrorHandler(app)` wired; flush-on-exit handlers | `instrument.ts`, `app.ts` |
| Frontend Sentry | `instrument.ts` first import; `reactErrorHandler()` on `createRoot`; replay enabled with text masking | `frontend/src/instrument.ts` |
| Document direction | locked once at boot via `lib/direction.ts`; helmet does NOT manage `<html dir>` | `lib/direction.ts`, `main.tsx`, `App.tsx` |
| Canonical-host redirect | `www.subnation.ly` → apex; skips `/api/healthz/*` | `backend/src/app.ts` |
| Metrics actively populated | `http_requests_total`, `http_request_duration_seconds`, `auth_outcomes_total`, `redis_*`, `socket_*`, `cwv_*`, `alerts_dispatched_total`, `monitoring_errors_total`, `redis_ping_latency_seconds`, `redis_degraded_mode_total` | `lib/metrics.ts` + call sites |

---

## 4. Owner-action items

| Item | Status | Action |
|---|---|---|
| Firebase Console → Authorized domains for `subnation.ly` + `www.subnation.ly` | ✅ DONE | confirmed by user |
| `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` + `SENTRY_PROJECT` env on Render | ⏸ optional | provision when source-line-accurate stack traces are needed |
| `METRICS_ADMIN_TOKEN` env on Render | ⏸ optional | required only when external Prometheus/Grafana scrapes the endpoint |
| `DISCORD_WEBHOOK_URL`, `GENERIC_ALERT_WEBHOOK_URL` (optional) | ⏸ optional | set only if secondary alert channels are wanted |
| Worker tier provisioning | ⏸ optional | when scaling beyond 1 web instance, promote to dedicated worker (Render starter) and set `DISABLE_WEB_SCHEDULERS=true` on web |

---

## 5. Documentation map

Living docs at workspace root, one purpose each:

| Doc | Purpose |
|---|---|
| `README.md` | Project overview, dev setup, deploy summary |
| `FINAL_RUNTIME_STATE.md` (this file) | Single living state-of-the-platform doc |
| `OPERATIONS_RUNBOOK.md` | On-call playbook: per-rule triage, dashboards, rollback, scaling thresholds |
| `OBSERVABILITY_SETUP.md` | Architecture: correlation, Pino schema, Sentry, metrics, health, env vars |
| `ALERTING_ARCHITECTURE.md` | Taxonomy, 10-rule registry, channel matrix, dedup/rate-limit, dark-launch |
| `METRICS_AND_MONITORING.md` | 14-metric catalog, cardinality discipline, active vs P2-pending matrix |
| `SENTRY_BACKEND_SETUP.md` | Backend-only Sentry: instrument.ts sidecar, source-map upload gate, env vars |
| `REDIS_SETUP.md` | Operator setup: provider options, env vars, verification recipes |
| `REDIS_RUNTIME_ARCHITECTURE.md` | Runtime topology, who uses Redis, failure modes, sizing |
| `REDIS_OPERATIONS.md` | Per-symptom triage, rotation procedure, scaling thresholds, forbidden ops |
| `CACHE_STRATEGY.md` | What to cache, what NOT to, TTL discipline, stampede protection |
| `SEO_AND_CWV_REPORT.md` | Technical SEO inventory, sample JSON-LD, CWV pipeline, bundle budget |
| `DOMAIN_RUNTIME_ARCHITECTURE.md` | Request lifecycle on `subnation.ly`, cookies, Firebase, Socket.IO, Sentry |
| `RTL_LAYOUT_ARCHITECTURE.md` | Tenets, boot order, single-mutator API for `<html dir>`, allowed overrides |
| `RUFLO.md` | Ruflo dev-tooling notes (separate from project) |
| `docs/API.md` | Public API surface |
| `docs/COMPLIANCE.md` | Data retention + RBAC tiers |
| `docs/DISASTER_RECOVERY.md` | RTO/RPO + recovery scenarios |
| `docs/NEON_MCP_SETUP.md` | Neon MCP local wiring |

Historical artefacts (in `.kiro/specs/observability-seo-cwv-maturity/`):

- `inspection-report.md` — Phase 1 read-only audit
- `master-execution-plan.md` — Phase 2-8 task list with rollback procedures
- `requirements.md`, `design.md`, `tasks.md` — the canonical spec
- `inspection-data/` — raw scan dumps (`web-check-report.md`,
  `pagespeed-report.md`, `bundle-baseline.json`, etc.)

---

## 6. Validation evidence

```
$ pnpm typecheck         ✓ all 4 workspace packages clean
$ pnpm exec vitest run   Test Files 9 passed (9) | Tests 80 passed (80)
$ pnpm run build         ✓ backend dist + frontend dist emit
                         [bundle-budget] index-*.js: 21,696 B gzip — under 47 KiB warn
                         PWA precache 59 entries

$ curl -s https://subnation.ly/api/healthz/ready | jq .status
"ok"

$ curl -sI https://www.subnation.ly/products | head -2
HTTP/2 301
location: https://subnation.ly/products
```

---

## 7. Known residual risks

| Risk | Severity | Mitigation in place |
|---|---|---|
| Coupon `maxUses` over-redemption under high concurrency | medium | atomic increment via `sql\`usedCount + 1\``; pre-check still outside tx — small fix when needed |
| Topup approve race (no `FOR UPDATE`) | low | re-check inside tx; concurrent approvers narrow to a microsecond window |
| `backend/src/migrate.ts` runtime DDL co-exists with Drizzle migrations | medium | CI runs `drizzle-kit generate && git diff --exit-code` so drift is caught |
| Admin TOTP secret stored unencrypted | medium | tracked from original audit |
| Render free-tier eviction | low | documented in `OPERATIONS_RUNBOOK.md §5` with tier-promotion thresholds |
| 4 of 10 alert rules still no-op (`api_5xx_rate_high`, `api_p95_latency_high`, `worker_job_failures_high`, `frontend_sentry_error_rate_high`) | low | dispatch path proven via test endpoint; rule reads pending production-volume baselines |
