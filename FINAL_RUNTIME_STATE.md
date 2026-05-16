# Final Runtime State — SubNation2

**Last updated:** 2026-05-16 (post-cleanup)
**Production canonical:** `https://subnation.ly`
**Latest deployed commit:** `0952a13` (`feat(domain): migrate primary canonical to https://subnation.ly`) — confirmed `live` since 2026-05-16T09:35Z

This document is the **single living source of truth** for the platform's
runtime state. Older state docs (`FINAL_PLATFORM_STATE.md`,
`MASTER_PLATFORM_AUDIT.md`, `FULL_PLATFORM_REPORT.md`,
`docs/AUDIT_REPORT_2026-05-16.md`) have been deleted as superseded — git
history retains them if needed.

---

## 1. Headline scorecard

| Dimension | Score | Notes |
|---|---|---|
| Functional production-readiness | **8.5 / 10** | Custom domain, Redis live, observability wired, alerting real, CWV pipeline working |
| Enterprise-readiness | **6.5 / 10** | No SSO/RBAC depth, mock payments, no E2E tests, but the operational tier is in good shape |
| Build / CI | green | typecheck, unit tests, build all pass |
| Security guardrails | preserved | CSP, COOP, scriptSrcAttr, Trusted Types untouched; no inline scripts; HSTS preload |

---

## 2. Production surface (verified live against `https://subnation.ly`)

| Surface | Status |
|---|---|
| `https://subnation.ly/` | ✅ 200 |
| `https://subnation.ly/api/healthz` | ✅ 200 `{"status":"ok"}` |
| `https://subnation.ly/api/healthz/ready` | ✅ 200 — redis 62 ms, neon 66 ms, worker 62 ms, socket 63 ms |
| `https://subnation.ly/sitemap.xml` | ✅ XML with hreflang, all `<loc>` use canonical |
| `https://subnation.ly/robots.txt` | ✅ canonical sitemap reference |
| `https://www.subnation.ly/*` | ✅ 301 → `https://subnation.ly/*` (Render edge) |
| `https://subnation2.onrender.com/*` (legacy) | ✅ 301 → `https://subnation.ly/*` (app middleware), Cache-Control 24 h |
| `https://subnation2.onrender.com/api/healthz` | ✅ 200 (probe-safe — middleware skips redirect) |
| `POST /api/cwv` (Blob/text/plain/octet-stream) | ✅ 204 |
| `GET /api/metrics` (no token) | ✅ 401 (admin-gated) |
| Frontend Sentry | ✅ confirmed working |
| Backend Sentry init + Express error handler + uncaughtException flush | ✅ wired |
| TLS — Google Trust Services, valid May 16 → Aug 14 2026, on both apex and www | ✅ |
| HSTS preload | ✅ `max-age=31536000; includeSubDomains; preload` |

---

## 3. Active runtime systems

| System | State | Where |
|---|---|---|
| Redis | live, Redis Cloud, ~63 ms ping | `lib/redis-client.ts` singleton |
| Socket.IO Redis adapter | active | `lib/socket.ts` |
| rate-limit-redis | using Redis (was in-memory fallback before) | `app.ts` apiLimiter / authLimiter / otpLimiters |
| Web schedulers (heartbeat, alerting evaluator, cron) | running in web tier under Redis leader lock | `lib/web-scheduler.ts`, `lib/scheduler-coordinator.ts` |
| `worker:heartbeat` | written every 15 s | `worker/heartbeat.ts` |
| Alerting evaluator | running every 60 s; 6 of 10 rules have real evaluators | `services/alerting.service.ts` |
| Alerting dispatch | real Telegram + Discord + generic webhook with AbortSignal.timeout(10s) + retry-once-after-5s + Sentry capture | same |
| Alerting dedup | Redis `SET NX EX 300` keyed `alert:dedup:<rule>|<labelHash>` | same |
| Alerting global rate-limit | Redis windowed `INCR alert:global:<minute>` + EXPIRE 70 (≤30/min) | same |
| Cron jobs | couponWatcher, stockWatcher, otpCleanup, cron — running in web tier | `jobs/*` |
| CWV ingestion | Blob with `application/json` Content-Type from frontend; Express `text/plain` parser as defence | `frontend/src/lib/web-vitals.ts` + `backend/src/routes/cwv.ts` |
| Backend Sentry | `instrument.ts` sidecar imported first; `setupExpressErrorHandler(app)` wired; flush-on-exit handlers | `instrument.ts`, `app.ts` |
| Frontend Sentry | `instrument.ts` first import; `reactErrorHandler()` on `createRoot`; replay enabled with masking | `frontend/src/instrument.ts` |
| Document direction | locked once at boot via `lib/direction.ts`; helmet no longer manages `<html dir>` | `lib/direction.ts`, `main.tsx`, `App.tsx` |
| Canonical-host redirect | 301 from legacy onrender + www to apex; skips `/api/healthz/*` | `backend/src/app.ts` |
| Metrics actively populated | `http_requests_total`, `http_request_duration_seconds`, `auth_outcomes_total`, `redis_*`, `socket_*`, `cwv_*`, `alerts_dispatched_total`, `monitoring_errors_total`, `redis_ping_latency_seconds`, `redis_degraded_mode_total` | `lib/metrics.ts` + call sites |

---

## 4. Owner-action items still outstanding

| Item | Why | What |
|---|---|---|
| Firebase Console → Authorized domains | Google Sign-In popup auth fails with `auth/unauthorized-domain` on `subnation.ly` until both apex + www are added there | https://console.firebase.google.com/project/subnation-2571e/authentication/settings → Authorized domains → add `subnation.ly` + `www.subnation.ly` (keep onrender during transition) |
| `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` + `SENTRY_PROJECT` env on Render | Source-map upload skipped; backend stack traces show transformed filenames | Set the three env vars; next deploy auto-uploads |
| `METRICS_ADMIN_TOKEN` env on Render | Currently `/api/metrics` is reachable only via admin JWT; setting this makes it scrapable by Prometheus/Grafana | `openssl rand -hex 32` → set as env |
| `DISCORD_WEBHOOK_URL`, `GENERIC_ALERT_WEBHOOK_URL` (optional) | Alerting service already supports them but they're unset, so dispatch path skips them | Set if/when you want secondary alert channels |
| Stage-2 CORS cleanup (~30 days from migration) | Once analytics confirm zero traffic on legacy onrender, remove it from `APP_ORIGINS` | Render MCP `update_environment_variables APP_ORIGINS=https://subnation.ly,https://www.subnation.ly` |
| Worker tier provisioning (optional, ~$7/mo) | If you grow beyond a single web instance, schedulers should move to a dedicated worker so multi-instance never races | Render dashboard → New → Blueprint → applies `subnation-worker` from `render.yaml` → set `DISABLE_WEB_SCHEDULERS=true` on web |

---

## 5. Surviving documentation map

Living docs (kept at workspace root; one purpose each):

| Doc | Purpose |
|---|---|
| `README.md` | Project overview, dev setup, deployment summary |
| `FINAL_RUNTIME_STATE.md` (this file) | Single living state-of-the-platform doc |
| `OPERATIONS_RUNBOOK.md` | On-call playbook: per-rule triage, dashboards, rollback, scaling thresholds |
| `OBSERVABILITY_SETUP.md` | Architecture: correlation, Pino schema, Sentry, metrics, health, env vars, Replay decision |
| `ALERTING_ARCHITECTURE.md` | Taxonomy, 10-rule registry, channel matrix, dedup/rate-limit, dark-launch, escalation |
| `METRICS_AND_MONITORING.md` | 14-metric catalog, cardinality discipline, active vs P2-pending matrix |
| `SENTRY_BACKEND_SETUP.md` | Backend-only Sentry: instrument.ts sidecar, source-map upload gate, env vars |
| `REDIS_SETUP.md` | Operator setup: provider options, env vars, verification recipes |
| `REDIS_RUNTIME_ARCHITECTURE.md` | Runtime topology, who uses Redis, failure modes, sizing |
| `REDIS_OPERATIONS.md` | On-call playbook for Redis: per-symptom triage, scaling, forbidden ops |
| `CACHE_STRATEGY.md` | What to cache, what NOT to, TTL discipline, stampede protection, key naming |
| `SEO_AND_CWV_REPORT.md` | Technical SEO inventory, sample JSON-LD, CWV pipeline, bundle budget |
| `SEO_DOMAIN_MIGRATION.md` | Canonical signals, 301 strategy, hreflang, Google Search Console site-move |
| `DOMAIN_RUNTIME_ARCHITECTURE.md` | Request lifecycle on subnation.ly, cookies, Firebase, Socket.IO, Sentry |
| `DOMAIN_MIGRATION_REPORT.md` | What changed, what's owner-action, stage-2 cleanup plan |
| `RTL_LAYOUT_ARCHITECTURE.md` | Tenets, boot order, single-mutator API, allowed overrides, forbidden patterns |
| `MOBILE_NAVIGATION_STABILITY.md` | Why bottom nav was inverting, Android Chrome smoke tests |
| `UI_DIRECTION_FIX_REPORT.md` | Root cause + fix for the post-migration RTL flicker |
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
  `pagespeed-report.md`, `bundle-baseline.json`,
  `_raw-render-list-logs.json`, `_raw-render-get-metrics.json`,
  `context7-citations.json`, etc.)

Deleted as superseded by this doc + the topical docs:

- `MASTER_PLATFORM_AUDIT.md`
- `FULL_PLATFORM_REPORT.md`
- `FINAL_PLATFORM_STATE.md`
- `docs/AUDIT_REPORT_2026-05-16.md`

---

## 6. Validation evidence (post-cleanup)

```
$ pnpm typecheck         ✓ all 4 workspace packages clean
$ pnpm exec vitest run   Test Files 9 passed (9) | Tests 80 passed (80)
$ pnpm run build         ✓ backend dist + frontend dist emit
                         [bundle-budget] index-*.js: 21,696 B gzip — under 47 KiB warn
                         PWA precache 60 entries (1962.55 KiB)

$ curl -s https://subnation.ly/api/healthz/ready | jq .status
"ok"

$ curl -sI https://subnation2.onrender.com/login | head -2
HTTP/2 301
location: https://subnation.ly/login

$ curl -sI https://www.subnation.ly/products | head -2
HTTP/2 301
location: https://subnation.ly/products
```

---

## 7. Memory MCP entities

For cross-session continuity, the memory knowledge graph holds:

- `subnation2:audit:2026-05-16` (Audit) — pre-sweep state findings
- `subnation2:roadmap:next-priorities` (Roadmap) — P0/P1/P2/P3 priorities
- `subnation2:state:post-stabilization:2026-05-16` (State) — post-stabilization deltas

Use `memory.search_nodes("subnation2")` to recall.

---

## 8. Known residual risks

| Risk | Severity | Mitigation in place |
|---|---|---|
| Coupon `maxUses` over-redemption under high concurrency | medium | atomic increment via `sql\`usedCount + 1\``; pre-check still outside tx — fix is small |
| Topup approve race (no `FOR UPDATE`) | low | re-check inside tx; concurrent approvers narrow to microsecond window |
| `backend/src/migrate.ts` runtime DDL co-exists with Drizzle migrations | medium | CI runs `drizzle-kit generate && git diff --exit-code` so drift is caught |
| Admin TOTP secret stored unencrypted | medium | tracked from original audit |
| Render free-tier eviction | low | documented in `OPERATIONS_RUNBOOK.md §5` with tier promotion thresholds |
| Worker-job-failures-high / api-5xx-rate-high / api-p95-latency-high / frontend-sentry-error-rate-high alert evaluators are no-op | low | dispatch path proven via test endpoint; rule reads pending production-volume baselines |
| Stage-2 CORS cleanup (drop legacy onrender from APP_ORIGINS) | low | scheduled ~30 d from migration; redirect middleware stays indefinitely |
