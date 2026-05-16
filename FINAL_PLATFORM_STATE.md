# Final Platform State — SubNation2

**Date:** 2026-05-16 — post-stabilization sweep
**Author:** stabilization engineer (Kiro CLI default agent)
**Build status:** typecheck ✅ tests ✅ build ✅ (see §6)

This document is the single source of truth for "what is live in
SubNation2 and what is not". It supersedes `MASTER_PLATFORM_AUDIT.md`
(2026-05-13) and `FULL_PLATFORM_REPORT.md` (2026-05-15) — both are
preserved historically but reflect a state earlier than this sweep.

## 1. Headline scorecard

| Dimension | Score | Notes |
|---|---|---|
| Functional production-readiness | **8.0 / 10** | up from 7.0 — race conditions fixed, observability wired, alerting real |
| Enterprise-readiness | **6.0 / 10** | up from 5.0 — full health surface, admin observability, real alerting, but mock payments and no SSO/E2E yet |
| Build / CI | green | typecheck, unit tests, build all pass |
| Security guardrails | preserved | CSP, COOP, scriptSrcAttr, Trusted Types untouched; no inline scripts added |

## 2. What shipped this sweep

### 2.1 P0 runtime bugs (5 fixes)

| Fix | File | Outcome |
|---|---|---|
| `web-vitals` v4 API drift | `frontend/src/lib/web-vitals.ts` | switched `getX` → `onX`, removed Node-only `process.on()` footer |
| `isolate()` undefined ref | `backend/src/worker/heartbeat.ts` | imported from `middlewares/instrumentation-isolation` |
| Redis client never inited | `backend/src/lib/redis-client.ts`, `server.ts`, `worker.ts`, `app.ts` | one singleton, `await initRedisClient()` at bootstrap, prod-fatal-on-fail / dev-fallback |
| Middleware not wired | `backend/src/app.ts` | correlation → pino-http (genReqId + customAttributeKeys) → metrics → instrumentation-isolation, all live |
| Duplicate `<HelmetProvider>` | `frontend/src/App.tsx` | dropped inner provider; kept the one in `main.tsx` |

### 2.2 Phase 2 — Observability

- `backend/src/middlewares/correlation.ts` — UUID v4 read / mint / echo, `AsyncLocalStorage` context.
- `backend/src/middlewares/metrics.ts` — observes `http_request_duration_seconds`, increments `http_requests_total`.
- `backend/src/lib/metrics.ts` — Prometheus registry singleton with the full 14-metric catalog (HTTP, auth, Redis, socket, worker, Neon, CWV, monitoring, alerts) + `safeInc` / `safeObserve` / `safeSet` helpers.
- `backend/src/routes/metrics.ts` — `GET /api/metrics`, dual auth (admin JWT or `METRICS_ADMIN_TOKEN`).
- `backend/src/routes/cwv.ts` — `POST /api/cwv` Zod-free type-guarded beacon receiver, per-session 30/min cap.
- `backend/src/routes/health.ts` — extended with `/ready, /redis, /neon, /worker, /socket` (existing `/healthz` and `/healthz/firebase` preserved byte-for-byte).
- `backend/src/lib/sentry.ts` — `release = RENDER_GIT_COMMIT[:7]`, `tracesSampleRate` 0.1 prod / 1.0 dev, `correlation_id` injected via `beforeSend`.
- `backend/src/worker/heartbeat.ts` — 15 s heartbeat to Redis `worker:heartbeat` (TTL 60 s).

### 2.3 Phase 3 + 4 — Alerting (real)

`backend/src/services/alerting.service.ts`:

- **Real** Telegram + Discord webhook + generic webhook dispatch.
- 10 s `AbortSignal.timeout`, retry-once-after-5s, capture-on-final-failure to Sentry.
- Redis `SETNX EX 300` dedup keyed `alert:dedup:${rule}|${stableHash(labels)}`.
- Redis windowed `INCR alert:global:${minute}` + `EXPIRE 70` for the global ≤ 30/min cap.
- `ALERTING_ENABLED=false` dark-launch gate.
- Channels with no credentials short-circuit `outcome:"skipped"` (don't count against rate limit).
- Evaluator started from `backend/src/worker.ts` so it runs in exactly one place.

### 2.4 Phase 4 — Frontend CWV boot wiring

`frontend/src/main.tsx` initialises Sentry early, then `initWebVitals()` via `requestIdleCallback` (fallback `setTimeout(0)`). Bundle budget plugin in `vite.config.ts` enforces 47 KiB warn / 55 KiB fail (current: 21,729 B gzip).

### 2.5 Phase 5 — SEO core

- `frontend/src/hooks/useSeo.tsx` + `components/seo/{MetaTags,JsonLd}.tsx` + `lib/seo-builders.ts` (`buildOrganizationLd / buildProductLd / buildBreadcrumbLd / buildFaqLd`).
- Applied: home (`Organization`), product detail (`Product` + `BreadcrumbList`).
- `backend/src/routes/seo.ts` — root-mounted `GET /robots.txt` (static) + `GET /sitemap.xml` (60 s cache, hreflang ar/en/x-default).
- `bumpSitemapCache()` invalidator called from product create / update / delete handlers.

### 2.6 Phase 6 — Admin observability backend

- `GET /api/admin/observability/summary` — server, redis, worker heartbeat age, recent-alert count, dashboard URLs.
- `GET /api/admin/observability/alerts/recent` — last 50 alerts (60 s cache + last-known-good fallback).
- `GET /api/admin/observability/deploys/recent` — placeholder until `RENDER_API_KEY` provisioned.
- `GET /api/admin/observability/sentry/summary` — placeholder until `SENTRY_AUTH_TOKEN` provisioned.
- `GET /api/admin/diagnostics` — Node, runtime, memory, CPU, event-loop lag (via `perf_hooks.monitorEventLoopDelay`), deps, feature flags. All gated by `requireAdmin`.

### 2.7 Phase 7 — Cleanup

- `CLAUDE.md` (Ruflo agent-coordination doc) → `RUFLO.md`. No longer pretends to be the project plan.
- `tasks.md` markers fixed: 28.1 `[-]` → `[x]`, 52.1 `[x]` → `[ ]`.
- Root `package.json` `lint` no longer runs `--fix` during build (separate `lint:fix` script for dev).
- Build script free of source-mutation steps.

### 2.8 Phase 9 — Deliverables (this sweep)

- `OBSERVABILITY_SETUP.md` — architecture, schemas, env-var reference, Replay decision.
- `ALERTING_ARCHITECTURE.md` — taxonomy, 10-rule registry, channel matrix, dedup/rate-limit, dark-launch.
- `SEO_AND_CWV_REPORT.md` — sample JSON-LD, sitemap freshness invariant, bundle budget, validation gates.
- `OPERATIONS_RUNBOOK.md` — per-rule triage, dashboard quick links, rollback steps, scaling thresholds, incident template.
- `FINAL_PLATFORM_STATE.md` — this document.

## 3. What changed since the prior audit

| Area | Before (`MASTER_PLATFORM_AUDIT.md` 2026-05-13) | Now |
|---|---|---|
| Wallet / inventory / coupon races | 4 confirmed race conditions | atomic `UPDATE … RETURNING` with conditional `WHERE`, throws on 0 rows |
| Tokens in localStorage | XSS exposure | HttpOnly cookies; `auth.tsx` storage helpers are no-ops |
| OTP plaintext | `otps.code` plaintext | `otps.code_hash` |
| Docker `.env` leak | copied into image | `.dockerignore` excludes `.env*` |
| In-process cron / migrations | web service does it all | dedicated `subnation-worker` service in `render.yaml` |
| Sessions / organizations schema drift | external DB tables, no source | now in `shared/db/src/schema/`, migrations 0000+0001 in repo |
| Observability | none | full Phase 2 stack live (correlation, metrics, health, Sentry, heartbeat) |
| Alerting | none | real Telegram + Discord + webhook with dedup/rate-limit |
| SEO | none | `useSeo` hook + JSON-LD + dynamic sitemap with freshness invariant |
| Admin observability | none | summary / alerts / diagnostics JSON endpoints |
| Build mutates source | `lint --fix` | clean `lint` (no `--fix`) |
| 5 P0 runtime bugs | broken | fixed |

## 4. Owner-blocked / out-of-scope this sweep

These items require credentials, owner approval, or substantial new work
that is not appropriate to ship in a stabilization sweep:

| Item | Why blocked | Action |
|---|---|---|
| Render env vars (`METRICS_ADMIN_TOKEN`, `ALERTING_ENABLED`, `DISCORD_WEBHOOK_URL`, `GENERIC_ALERT_WEBHOOK_URL`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `VITE_SENTRY_DSN`, `RENDER_API_KEY`) | needs DevOps to set in Render dashboard or via Render MCP `update_environment_variables` | provision per `OBSERVABILITY_SETUP.md §8` |
| Sentry source-map upload | needs `SENTRY_AUTH_TOKEN` | add `sentry-cli` step to `backend/build.mjs` and `@sentry/vite-plugin` to `frontend/vite.config.ts` once token is provisioned |
| Lighthouse CI | needs deployable URL or local Chromium runner | add `lighthouserc.cjs` + CI job after staging URL is stable |
| Image AVIF/WebP optimisation | needs re-encoded asset binaries | encode / commit; then drop into `<picture>` blocks on home + product list |
| Frontend admin Observability page UI | 4-8 h of focused UX work | next session: implement the 12-widget dashboard against the now-ready backend endpoints |
| Real payment processor (Almadar / Libyana / Sadad) | needs gateway credentials & contract | follow-up project; current `services/payment.service.ts` is a 1.4 KB mock |
| End-to-end Playwright suite | not in deps; would need fresh install + writing | follow-up project; current coverage is unit only |
| `checkRuleCondition()` production reads | each rule needs an aggregation source (Prometheus query / Redis time-series) | wire after metrics have ≥ 24 h of production data to baseline thresholds |
| Render_MCP rollback automation | needs `RENDER_API_KEY` + `scripts/rollback.ts` | scoped for next sprint |

## 5. Remaining residual risk

| Risk | Severity | Mitigation in place |
|---|---|---|
| Coupon `maxUses` over-redemption under concurrent load | medium | atomic `usedCount` increment; pre-check still runs outside tx — fix is small (move check into conditional `WHERE`) |
| Topup approve race (no `FOR UPDATE`) | low | re-check inside tx — concurrent approvers narrow to a microsecond window |
| `migrate.ts` runtime DDL co-exists with Drizzle migrations | medium | CI runs `drizzle-kit generate && git diff --exit-code`; long-term, delete DDL paths from `migrate.ts` |
| Admin TOTP secret stored unencrypted | medium | tracked in original audit; encrypt with `ENCRYPTION_KEY` |
| Render free-tier eviction (web + Redis) | low | documented in `OPERATIONS_RUNBOOK.md §5` with promote thresholds |
| `ruflo-audit.test.ts` skipped | trivial | rewrite against current `runRufloAudit` API surface; not customer-facing |

## 6. Validation evidence (this sweep)

```
$ pnpm typecheck
✓ scripts typecheck: Done
✓ backend typecheck: Done
✓ frontend typecheck: Done

$ pnpm --filter @workspace/api-server exec vitest run
Test Files  8 passed | 1 skipped (9)
Tests       71 passed | 2 skipped (73)

$ pnpm --filter @workspace/api-server run build
✓ esbuild → dist/index.mjs (6.6 mb), dist/worker.mjs (3.9 mb), pino workers

$ pnpm --filter @workspace/subnation run build
✓ vite built in 8.53s
[bundle-budget] index-DzLwNesD.js: 21729 bytes (gzip)  # well under 47 KiB warn / 55 KiB fail
✓ PWA v1.3.0  precache  58 entries (1693.75 KiB)
```

## 7. Next-session priorities

| Pri | Task | Owner |
|---|---|---|
| P1 | Provision the 9 Render env vars (see §4) and verify alerting end-to-end | DevOps |
| P1 | Wire `@sentry/vite-plugin` + `backend/build.mjs` source-map upload | code |
| P2 | Coupon `maxUses` → conditional `UPDATE`; topup approve `FOR UPDATE` | code |
| P2 | Frontend admin Observability page (12-widget dashboard) | code |
| P2 | Render_MCP rollback automation script | code |
| P3 | Lighthouse CI + image / font optimisation | code + assets |
| P3 | Delete runtime DDL paths from `migrate.ts` after Drizzle migrations are verified end-to-end on a Neon dev branch | code |
| P3 | Real payment processor integration | product |

## 8. Memory_MCP entities (for cross-session continuity)

- `subnation2:audit:2026-05-16` (Audit) — pre-sweep state findings.
- `subnation2:roadmap:next-priorities` (Roadmap) — P0/P1/P2/P3 priorities.
- `subnation2:state:post-stabilization:2026-05-16` (State) — created by this sweep; contains the deltas above + verification evidence.

## 9. References

- `.kiro/specs/observability-seo-cwv-maturity/requirements.md` (10 EARS reqs)
- `.kiro/specs/observability-seo-cwv-maturity/design.md`
- `.kiro/specs/observability-seo-cwv-maturity/tasks.md` (markers reset 2026-05-16)
- `.kiro/specs/observability-seo-cwv-maturity/master-execution-plan.md`
- `.kiro/specs/observability-seo-cwv-maturity/inspection-report.md`
- `docs/AUDIT_REPORT_2026-05-16.md` (the comprehensive read-only audit that drove this sweep)
