# SubNation2 — Comprehensive Audit & Execution Roadmap

**Date:** 2026-05-16
**Scope:** Reconciliation of every roadmap, audit, plan, and TODO document in the workspace against the actual filesystem and source code state.
**Method:** Code-level verification (read-only). Each claim below cites the file, line range, or grep evidence that backs it.
**Excluded from scope:** `ruflo/`, `.claude*/`, `.swarm/`, `.claude-flow/`, `node_modules/` (dev tooling, gitignored, not part of the SubNation2 application).

---

## 1. Documents Reviewed

| Document                                                              | Role                                                       | Verdict                                                                                                                                                                                       |
| --------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`                                                           | Project overview, deployment, key env vars                 | **Keep** — accurate, current.                                                                                                                                                                 |
| `.kiro/specs/observability-seo-cwv-maturity/requirements.md`          | 10 EARS requirements                                       | **Keep** — canonical.                                                                                                                                                                         |
| `.kiro/specs/observability-seo-cwv-maturity/design.md`                | Technical design                                           | **Keep** — canonical.                                                                                                                                                                         |
| `.kiro/specs/observability-seo-cwv-maturity/tasks.md`                 | 54 ordered tasks across 8 phases                           | **Keep, but markers are stale** — see §6.                                                                                                                                                     |
| `.kiro/specs/observability-seo-cwv-maturity/master-execution-plan.md` | Phase ordering, validation gates, rollbacks                | **Keep** — canonical.                                                                                                                                                                         |
| `.kiro/specs/observability-seo-cwv-maturity/inspection-report.md`     | Phase 1 real-state findings                                | **Keep** — based on real Render_MCP captures.                                                                                                                                                 |
| `.kiro/specs/observability-seo-cwv-maturity/inspection-data/*.json`   | Render audit fixtures, bundle baseline, Context7 citations | **Keep** — real evidence.                                                                                                                                                                     |
| `MASTER_PLATFORM_AUDIT.md` (root, 45 KB, 2026-05-13)                  | Pre-initiative deep audit, score 6.5/10                    | **Merge into a single STATE_OF_THE_PLATFORM.md.** Many findings are now resolved (see §3); some are still valid. Do not delete — it is the only place the original critical-issue list lives. |
| `FULL_PLATFORM_REPORT.md` (root, 33 KB, 2026-05-15)                   | "Comprehensive audit", score 7.5/10                        | **Demote** — contains false-positive claims (e.g. labels alerting "FULLY OPERATIONAL" while the dispatcher is a stub returning `true`). Should be merged or rewritten.                        |
| `CLAUDE.md` (root, 7 KB)                                              | "Ruflo — Claude Code Configuration"                        | **Move out of root** — this is the Ruflo agent-coordination doc, not the SubNation2 plan. It confuses contributors. Rename to `RUFLO.md` or move to `ruflo/`.                                 |
| `web-check-report.md` / `pagespeed_report.md`                         | External scan dumps from 2026-05-12                        | **Archive under `.kiro/specs/.../inspection-data/`** — they are baseline data, not plans.                                                                                                     |
| `docs/API.md`                                                         | Route reference                                            | **Keep** — but expand once Phase 5/6 routes (`/api/cwv`, `/api/metrics`, `/robots.txt`, `/sitemap.xml`, `/api/admin/observability`, `/api/admin/diagnostics`) ship.                           |
| `docs/COMPLIANCE.md`                                                  | Data retention, RBAC                                       | **Keep** — terse but accurate.                                                                                                                                                                |
| `docs/DISASTER_RECOVERY.md`                                           | RTO/RPO + recovery scenarios                               | **Keep**.                                                                                                                                                                                     |
| `docs/NEON_MCP_SETUP.md`                                              | Local Neon MCP wiring                                      | **Keep**.                                                                                                                                                                                     |
| `config/README.md`, `config/env.example`                              | Env reference                                              | **Keep**.                                                                                                                                                                                     |

There is **no** `ROADMAP.md`, `PLAN.md`, `TODO.md`, or `BACKLOG.md` at any level. The `.kiro` spec is the canonical roadmap.

---

## 2. Executive Summary

The repository is mid-flight in a large observability/SEO/CWV maturity initiative. **Phase 1 (Inspection) is genuinely complete and well-executed.** Phases 2–7 are partially scaffolded but most of the new code is **dormant** — the modules exist on disk but are never imported, called, or wired into the request pipeline. Phase 8 (final docs) has not started despite `tasks.md` falsely marking task 52.1 as `[x]`.

There are **five live runtime bugs** in the new code that will break things the moment they are wired up (see §5, P0 list). These bugs are not visible today only because the code is unused.

The original `MASTER_PLATFORM_AUDIT.md` (2026-05-13) raised a series of P0 issues (Docker `.env` leak, localStorage tokens, OTP plaintext, wallet/inventory/coupon race conditions, in-process cron, schema drift). The good news: **most of those have been genuinely fixed.** Verification details in §3.

The bad news that `FULL_PLATFORM_REPORT.md` (2026-05-15) hides: **alerting is a placeholder that always returns success without making a single HTTP call**, **frontend Sentry and Web Vitals are imported nowhere**, and **the deprecated `web-vitals` API used in `frontend/src/lib/web-vitals.ts` will fail to resolve at module load** under v4 of the package.

**Production-readiness today:** ~7.0 / 10 (auth, payments-as-mock-only, basic observability gaps).
**Enterprise-readiness today:** ~5.0 / 10 (no SSO, no RBAC depth, mock payments, no E2E tests, dormant alerting).

---

## 3. Verified Fixes Since `MASTER_PLATFORM_AUDIT.md` (2026-05-13)

These are real, code-level confirmations. The audit's most-pressing items have been addressed.

| Issue from MASTER_PLATFORM_AUDIT                              | Status       | Evidence                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docker image copies `.env` into runtime                       | ✅ Fixed     | `.dockerignore` lines 17–18 exclude `.env*`; `Dockerfile` only does generic `COPY . .` at build stage and a curated copy of build artefacts at runtime.                                                                                                             |
| User & admin JWTs in `localStorage`                           | ✅ Fixed     | `frontend/src/lib/auth.tsx` lines 22–28: `readStoredToken` returns `null`; `writeStoredToken` is a no-op. Comment confirms HttpOnly cookies.                                                                                                                        |
| OTP stored plaintext (`otps.code`)                            | ✅ Fixed     | `shared/db/src/schema/otps.ts` line 7: column is `code_hash`, not `code`.                                                                                                                                                                                           |
| In-process cron / migrations / sockets in web service         | ✅ Fixed     | `render.yaml` declares a separate `subnation-worker` service. `backend/src/worker.ts` is the worker entry. `backend/src/server.ts` no longer imports `couponWatcher`/`stockWatcher`/`otpCleanup`/`cron`.                                                            |
| Inventory claim race                                          | ✅ Fixed     | `backend/src/routes/orders.ts` lines 200–207: `tx.update(inventoryTable).set({isSold:true}).where(and(eq(id), eq(isSold,false))).returning()` is atomic.                                                                                                            |
| Wallet lost-update                                            | ✅ Fixed     | `backend/src/routes/orders.ts` lines 209–222: conditional `where(and(eq(id), eq(walletBalance, currentBalance)))` with `RETURNING`; throws `CONCURRENCY_ERROR` on zero rows.                                                                                        |
| Coupon `usedCount` race                                       | ✅ Mitigated | `backend/src/routes/orders.ts` line 226: uses `sql\`${couponsTable.usedCount} + 1\``. **Note:** `maxUses` is still pre-checked outside the atomic update — over-redemption is still possible if many concurrent requests pass the pre-check. P2 follow-up (see §7). |
| Topup approve race                                            | ✅ Mitigated | `backend/src/services/topup.service.ts` lines 71–80: re-checks status inside the transaction. **Note:** still no `FOR UPDATE` row lock on the topup row, so theoretically two transactions can pass the re-check simultaneously. P2 follow-up.                      |
| Source/live schema drift (`sessions`, `organizations` tables) | ✅ Fixed     | Both tables now in `shared/db/src/schema/`. Drizzle migrations `0000_volatile_mimic.sql` + `0001_true_amphibian.sql` + meta snapshots created. CI workflow runs `drizzle-kit generate && git diff --exit-code` on every push.                                       |

---

## 4. Phase-by-Phase Implementation State (Roadmap vs Reality)

For each phase, the canonical status is what is on disk — not what `tasks.md` claims.

### Phase 1 — Inspection (Read-only) — ✅ **COMPLETE**

| Artefact                                           | On Disk? | Notes                                                                       |
| -------------------------------------------------- | -------- | --------------------------------------------------------------------------- |
| `backend/src/lib/inspection-runner.ts`             | ✅ 19 KB | `runInspection({dryRun})`, retry policy, MCP invocation recorder.           |
| `scripts/inspect.ts`                               | ✅ 20 KB | Read-only allowlist enforced.                                               |
| `backend/src/lib/audits/render-audit.ts`           | ✅ 17 KB | + tests.                                                                    |
| `backend/src/lib/audits/neon-audit.ts`             | ✅ 28 KB | + tests.                                                                    |
| `backend/src/lib/audits/ruflo-audit.ts`            | ✅ 17 KB | + tests.                                                                    |
| `backend/src/lib/audits/context7-audit.ts`         | ✅ 26 KB | + tests.                                                                    |
| `inspection-report.md`, `master-execution-plan.md` | ✅       | High-quality, real Render_MCP fixtures.                                     |
| `inspection-data/*.json`                           | ✅       | Bundle baseline (14 243 B gzip), Render audit fixtures, Context7 citations. |

### Phase 2 — Observability & Monitoring — ⚠️ **CODE WRITTEN, NOT WIRED**

| Task                                                                                  | File                                                           | On Disk?                 | Wired?    | Notes                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------ | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 9.x Correlation middleware                                                            | `backend/src/lib/correlation.ts`, `middlewares/correlation.ts` | ✅ `correlation.ts` only | ❌        | `middlewares/correlation.ts` does not exist; `app.ts` does not import correlation. **Verified by grep:** zero matches for `correlationMiddleware` in backend/src outside the lib file.                                                                                                                                                                          |
| 10.x Pino structured logger                                                           | `backend/src/lib/logger.ts`                                    | ✅ extended              | ✅        | `service`/`version` bound; secret/token wildcards added; helpers (`authLogger`, `workerLogger`, etc.).                                                                                                                                                                                                                                                          |
| 11.x Prom metrics registry                                                            | `backend/src/lib/metrics.ts`                                   | ✅ 11 KB                 | ❌        | Full counter/histogram/gauge catalog. **`middlewares/metrics.ts` does not exist.**                                                                                                                                                                                                                                                                              |
| 12.x Instrumentation isolation                                                        | `backend/src/middlewares/instrumentation-isolation.ts`         | ✅                       | ❌        | **Not registered in `app.ts`.**                                                                                                                                                                                                                                                                                                                                 |
| 13.x `/api/metrics` route                                                             | `backend/src/routes/metrics.ts`                                | ❌ MISSING               | —         | Route file does not exist.                                                                                                                                                                                                                                                                                                                                      |
| 14.x Extended health (`/redis`, `/neon`, `/worker`, `/socket`, `/ready`)              | `backend/src/routes/health.ts`                                 | ✅                       | ⚠️        | Routes mounted, but they call `getRedisClient()` from `lib/redis-client.ts`, and **`initRedisClient()` is never called from `app.ts` or `server.ts`** → `getRedisClient()` always returns `null` → every extended health check returns 503 "Redis not configured". The pre-existing Redis client in `app.ts` is a different instance, not exposed to health.ts. |
| 15.x Backend Sentry                                                                   | `backend/src/lib/sentry.ts`                                    | ⚠️ old version           | n/a       | Still the pre-Phase-2 file: no `correlation_id` `beforeSend` tag, no Sentry CLI source-map upload step in `backend/build.mjs`. Phase 2 task 15 not done.                                                                                                                                                                                                        |
| 16.x Frontend Sentry                                                                  | `frontend/src/lib/sentry.ts`                                   | ✅                       | ❌        | `initFrontendSentry` defined but **never called from `frontend/src/main.tsx`** (verified by grep: 2 matches, both inside the lib file itself). `@sentry/vite-plugin` not in `vite.config.ts`.                                                                                                                                                                   |
| 17.x Worker heartbeat                                                                 | `backend/src/worker/heartbeat.ts`                              | ✅                       | ⚠️ broken | `await isolate("worker-heartbeat", writeFn)()` — but **`isolate` is not imported.** First heartbeat write throws `ReferenceError: isolate is not defined`.                                                                                                                                                                                                      |
| 18.x Wire middleware in app                                                           | `backend/src/app.ts`                                           | n/a                      | ❌        | `app.ts` lines 1–14 imports list does **not** include correlation, metrics, or instrumentation-isolation.                                                                                                                                                                                                                                                       |
| 19.x Provision Render env vars (`SENTRY_*`, `METRICS_*`, `NEW_HEALTH_CHECKS_ENABLED`) | Render dashboard                                               | ❌                       | —         | `render.yaml` only defines `SENTRY_DSN` (auto-generated). Owner-setup blocker.                                                                                                                                                                                                                                                                                  |

### Phase 3 — Alerting — ⚠️ **STUB (no real dispatch)**

| Component                                                                       | On Disk? | Status                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/src/services/alerting.service.ts`                                      | ✅ 15 KB | **All channel methods are placeholders.** `attemptDispatch()` returns `true` unconditionally (line 386). `isDeduped()` returns `false` (line 411). `isRateLimited()` returns `false` (line 419). `checkRuleCondition()` returns `false` (line 250). |
| Evaluator loop                                                                  | n/a      | **Never started.** `alertingService.start()` is not called from `app.ts` or `worker.ts`.                                                                                                                                                            |
| `routes/admin/alerts.ts` POST `/test`                                           | ✅       | Returns synthesised `{delivery: {telegram:{ok:true}, discord:{ok:true}, webhook:{ok:true}}}` **regardless of actual delivery** (line 45).                                                                                                           |
| Real Telegram/Discord/webhook HTTP calls                                        | ❌       | None implemented.                                                                                                                                                                                                                                   |
| `DISCORD_WEBHOOK_URL`, `GENERIC_ALERT_WEBHOOK_URL`, `ALERTING_ENABLED` env vars | ❌       | Not in `render.yaml`. Owner-setup blocker.                                                                                                                                                                                                          |

> **Risk:** `FULL_PLATFORM_REPORT.md` calls Telegram alerting "FULLY OPERATIONAL". The legacy business-event Telegram webhook (`backend/src/telegram.ts`) is real and works, but the new operational alerting system is not.

### Phase 4 — Performance & CWV — ⚠️ **BROKEN AT MODULE LOAD**

| Task                                              | File                                           | Status        | Notes                                                                                                                                                                                              |
| ------------------------------------------------- | ---------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 26.1 Install `web-vitals` v4                      | `frontend/package.json` line 60                | ✅ `^4.2.4`   |                                                                                                                                                                                                    |
| 26.2 CWV client                                   | `frontend/src/lib/web-vitals.ts`               | ❌ **broken** | Imports `getCLS, getFCP, getINP, getLCP, getTTFB` (lines 1) — these are the **v3 names**. Web-vitals v4 exports `onCLS, onFCP, onINP, onLCP, onTTFB`. Module will fail to resolve at first import. |
| 26.2 / module footer                              | `frontend/src/lib/web-vitals.ts` lines 314–322 | ❌            | Uses `process?.on?.('uncaughtException', …)` — **`process` is undefined in browsers.** Dead code; will throw under strict ESM if anything actually calls it.                                       |
| 26.3 Beacon dispatch                              | same file                                      | ✅ logic      | `navigator.sendBeacon` + `fetch keepalive` fallback + 2 retries + 60 s buffer + visibility/beforeunload flush. Sound design.                                                                       |
| 27.x `/api/cwv` backend                           | `backend/src/routes/cwv.ts`                    | ❌ MISSING    | Beacon target endpoint does not exist; samples will all 404.                                                                                                                                       |
| 28.1 Bundle budget plugin                         | `frontend/vite.config.ts` lines 12–60          | ✅            | Enforces 47 KiB warn / 55 KiB fail at build close. (`tasks.md` marks 28.1 as `[-]` — incorrect, code is shipped.)                                                                                  |
| 31.1 `lighthouserc.cjs`                           | repo root                                      | ❌ MISSING    | No Lighthouse CI config; CI has no perf gate.                                                                                                                                                      |
| 29.1/2 Image optimisation, 30.1 Font optimisation | frontend pages                                 | ❌ MISSING    | No `fetchpriority="high"`, AVIF/WebP `<picture>`, `loading="lazy"`, or `font-display: swap` audit applied.                                                                                         |
| 32.x CSP audit re-run                             | n/a                                            | ❌            | Not executed; baseline only exists in `:csp-baseline` Memory_MCP entry.                                                                                                                            |
| `initWebVitals` call from frontend boot           | `frontend/src/main.tsx`                        | ❌            | Not imported. **Verified by grep:** 2 `initWebVitals` matches, both inside the lib file.                                                                                                           |

### Phase 5 — SEO Enhancement — ❌ **NOT STARTED**

Verified by glob/grep:

| Required artefact                                                      | On disk?             |
| ---------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------- |
| `frontend/src/hooks/useSeo.ts`                                         | ❌                   |
| `frontend/src/components/seo/MetaTags.tsx`                             | ❌                   |
| `frontend/src/components/seo/JsonLd.tsx`                               | ❌                   |
| Schema.org generators (Organization, Product, BreadcrumbList, FAQPage) | ❌                   |
| `backend/src/routes/seo.ts` (`/robots.txt`, `/sitemap.xml`)            | ❌                   |
| `react-helmet-async` mounted                                           | ⚠️ **mounted twice** | once in `frontend/src/main.tsx` line 16 and again in `frontend/src/App.tsx` line 247 — redundant. |

`react-helmet-async@^3.0.0` is installed (`frontend/package.json` line 58) but unused beyond the empty `<HelmetProvider>` wrappers.

### Phase 6 — Operational Maturity — ❌ **NOT STARTED**

| Required artefact                            | On disk?             |
| -------------------------------------------- | -------------------- |
| `backend/src/routes/admin/observability.ts`  | ❌                   |
| `backend/src/routes/admin/diagnostics.ts`    | ❌                   |
| `frontend/src/pages/admin/Observability.tsx` | ❌                   |
| `perf_hooks.monitorEventLoopDelay` boot      | ❌ not in `index.ts` |

The existing `/api/admin/alerts` (legacy business-event admin alerts) is unrelated.

### Phase 7 — Continuous Validation — ⚠️ **PARTIAL**

| Required                                                               | Status                                          |
| ---------------------------------------------------------------------- | ----------------------------------------------- |
| `scripts/validate.ts`                                                  | ✅ 24 KB                                        |
| `scripts/inspect.ts`                                                   | ✅ 20 KB                                        |
| `package.json` `validate:cwv` + `validate:suite` scripts               | ✅                                              |
| Gitleaks in CI                                                         | ✅ `.github/workflows/ci.yml` job `secret-scan` |
| Drizzle migration diff in CI                                           | ✅ same file, step "Migration check"            |
| `validate:suite` invoked in CI                                         | ❌                                              |
| `validate:cwv` (Lighthouse CI) invoked in CI                           | ❌ — `lighthouserc.cjs` missing                 |
| Render_MCP rollback playbook (auto-rollback within 60 s of regression) | ❌ design only                                  |

### Phase 8 — Final Deliverables — ❌ **NOT STARTED**

| Required at workspace root      | On disk?                                                              |
| ------------------------------- | --------------------------------------------------------------------- |
| `OBSERVABILITY_SETUP.md`        | ❌                                                                    |
| `ALERTING_ARCHITECTURE.md`      | ❌                                                                    |
| `SEO_AND_PERFORMANCE_REPORT.md` | ❌                                                                    |
| `CORE_WEB_VITALS_REPORT.md`     | ❌                                                                    |
| `MONITORING_RUNBOOK.md`         | ❌ — but `tasks.md` line 803 marks 52.1 as `[x]`, which is **false**. |

---

## 5. Cross-Cutting Issues

### 5.1 Stale / inconsistent `tasks.md` markers

| Task                                 | Marked | Reality                                                                             |
| ------------------------------------ | ------ | ----------------------------------------------------------------------------------- |
| 28.1 (Bundle budget plugin)          | `[-]`  | Implemented in `frontend/vite.config.ts` lines 12–60.                               |
| 52.1 (`MONITORING_RUNBOOK.md`)       | `[x]`  | File does not exist.                                                                |
| 33.1 (Lighthouse CI)                 | `[~]`  | No `lighthouserc.cjs`, no CI step.                                                  |
| 41.x (Admin observability dashboard) | `[~]`  | Page file does not exist.                                                           |
| 18.x (Wire middleware in `app.ts`)   | `[~]`  | App.ts does not import any of the new middleware.                                   |
| 21.x / 22.x (Alerting)               | `[~]`  | All dispatch/dedup/rate-limit logic is `return true` / `return false` placeholders. |

Recommendation: walk `tasks.md` once and reset every overstated marker; update `master-execution-plan.md` change log.

### 5.2 Duplicate / confusing root documentation

| File                                         | Issue                                                                                               | Recommended action                                                                                                                                  |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MASTER_PLATFORM_AUDIT.md`                   | 2026-05-13, pessimistic 6.5/10 — many findings now stale                                            | Merge into a single `docs/STATE_OF_THE_PLATFORM.md` or fold into the Phase 8 deliverables. Preserve the original-issue list as historical evidence. |
| `FULL_PLATFORM_REPORT.md`                    | 2026-05-15, optimistic 7.5/10 — contains false-positive claims (alerting "FULLY OPERATIONAL", etc.) | Demote / rewrite.                                                                                                                                   |
| `CLAUDE.md`                                  | Ruflo agent-coordination doc, not project plan                                                      | Move out of root; rename to `RUFLO.md`.                                                                                                             |
| `web-check-report.md`, `pagespeed_report.md` | Scan dumps from 2026-05-12                                                                          | Move to `.kiro/specs/observability-seo-cwv-maturity/inspection-data/` and reference from `inspection-report.md`.                                    |

### 5.3 Schema source-of-truth ambiguity

`backend/src/migrate.ts` (33 KB of runtime DDL) still co-exists with the new Drizzle migrations under `shared/db/drizzle/`. Both will execute (`Dockerfile` `CMD` runs `pnpm start` which calls `runMigrations`). This is the single biggest hidden risk for production schema regressions. Either delete `migrate.ts` runtime DDL once Drizzle migrations have been verified end-to-end, or keep `migrate.ts` strictly for _data_ repair and remove all `CREATE TABLE / CREATE INDEX` paths from it.

### 5.4 Build script mutates source

`package.json` line 12: `"lint": "eslint ... --fix"` and `"build": "pnpm run lint && pnpm run typecheck && ..."` — i.e. **production builds auto-edit committed source**. Replace with a `lint:check` (no `--fix`) variant for the build pipeline.

### 5.5 Test coverage

| Layer                                               | Tests                                                   |
| --------------------------------------------------- | ------------------------------------------------------- |
| Backend lib audit/inspection helpers                | 7 vitest files (good — these were written for Phase 1). |
| Backend domain logic (auth, orders, wallet, topups) | **None** beyond `crypto.test.ts`.                       |
| Frontend components/hooks                           | **None.**                                               |
| End-to-end (Playwright)                             | **None.** Playwright is not in `frontend/package.json`. |

The existing tests are excellent for the inspection runner but offer effectively zero coverage of the business-critical paths the original audit was worried about.

---

## 6. Owner-Setup Required (cannot be code-only)

These items require credentials/decisions outside the repo and block several P0/P1 tasks.

| Item                                                                                                                                                                                                                                                                                                                | Reason                                                   | Owner         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------- |
| Render env vars (merge mode via Render_MCP `update_environment_variables`): `METRICS_ADMIN_TOKEN`, `ALERTING_ENABLED=false`, `DISCORD_WEBHOOK_URL`, `GENERIC_ALERT_WEBHOOK_URL`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `VITE_SENTRY_DSN`, `NEW_HEALTH_CHECKS_ENABLED=false`, `METRICS_ENABLED=false` | Phase 2/3 dark-launch                                    | DevOps        |
| Verify `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID=-1003878819089` are still live and not rotated                                                                                                                                                                                                                    | Phase 3 validation gate                                  | DevOps        |
| Decide tier strategy (stay free vs upgrade Render web/Redis/Neon)                                                                                                                                                                                                                                                   | Property 20 free-tier discipline; alerting under load    | Product owner |
| Decide Session Replay enable/disable post-CSP audit                                                                                                                                                                                                                                                                 | Phase 4 task 32                                          | Security      |
| Real payment processor integration (Almadar / Libyana / Sadad)                                                                                                                                                                                                                                                      | Currently `services/payment.service.ts` is a 1.4 KB mock | Product owner |
| Sentry source-map upload — `SENTRY_AUTH_TOKEN` provisioned                                                                                                                                                                                                                                                          | Phase 2 task 15.2                                        | DevOps        |

---

## 7. Prioritised Execution Roadmap

Ordering reflects dependencies (P0 unblocks P1, P1 unblocks P2/P3) and reversibility (lower-blast-radius changes first within each tier).

### 🔴 CRITICAL (P0) — Fix runtime bugs in already-shipped code

These must land before any new feature in Phase 2–5, because they will fault as soon as the surrounding code is wired up.

| #   | Task                                                                                                                                                                                                                                                                                                                                                                                          | File                                                                             | Effort |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------ |
| C1  | **Fix `web-vitals` v4 API drift.** Change `import { getCLS, getFCP, getINP, getLCP, getTTFB }` → `import { onCLS, onFCP, onINP, onLCP, onTTFB }`; replace each `getX(cb)` with `onX(cb)`. Remove the `process?.on?.(...)` browser-incompatible footer.                                                                                                                                        | `frontend/src/lib/web-vitals.ts`                                                 | 15 min |
| C2  | **Import `isolate`** in `worker/heartbeat.ts` — currently `await isolate(...)()` references an undefined symbol. Either `import { isolate } from "../middlewares/instrumentation-isolation"` or inline the try/catch.                                                                                                                                                                         | `backend/src/worker/heartbeat.ts`                                                | 5 min  |
| C3  | **Initialize the new Redis client.** Call `initRedisClient()` once at backend boot (in `index.ts` or `server.ts`) so `getRedisClient()` stops returning `null`. Otherwise every `/api/healthz/{ready,redis,neon,worker,socket}` will 503. Reconcile with the existing client in `app.ts` (probably make `app.ts` import the singleton from `lib/redis-client.ts` rather than create its own). | `backend/src/lib/redis-client.ts`, `backend/src/app.ts`, `backend/src/server.ts` | 1–2 h  |
| C4  | **Wire correlation + metrics + isolation middleware** in `app.ts` (ordering: `correlation → metrics → isolation → existing pipeline`). Without this, all the Phase 2 lib files are dead weight.                                                                                                                                                                                               | `backend/src/app.ts`                                                             | 1 h    |
| C5  | **Remove duplicate `<HelmetProvider>`.** Currently mounted in both `main.tsx` and `App.tsx`. Pick one (recommend keeping it in `main.tsx` and dropping it from `App.tsx`).                                                                                                                                                                                                                    | `frontend/src/App.tsx` line 247                                                  | 5 min  |

### 🟠 HIGH (P1) — Deliver promised observability + activate alerting

| #   | Task                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Files                                            | Effort   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | -------- |
| H1  | **Create `backend/src/routes/metrics.ts`** with the dual auth gate (admin JWT or `Authorization: Bearer ${METRICS_ADMIN_TOKEN}` via `crypto.timingSafeEqual`); content-type `text/plain; version=0.0.4`; body from `await registry.metrics()`. Mount in `routes/index.ts`.                                                                                                                                                                           | new file + `routes/index.ts`                     | 2 h      |
| H2  | **Create `backend/src/routes/cwv.ts`** with the `CWVSampleSchema` Zod validator + `apiLimiter` + per-session 30/min cap; observe `cwv_sample_value`; emit `category:"cwv"` Pino line; respond `204`. Mount before SPA fallback.                                                                                                                                                                                                                      | new file + `routes/index.ts`                     | 2 h      |
| H3  | **Wire `initFrontendSentry()` and `initWebVitals()`** in `frontend/src/main.tsx`. Read `VITE_SENTRY_DSN` and `VITE_RELEASE_SHA` (or fall back to `import.meta.env.MODE`).                                                                                                                                                                                                                                                                            | `frontend/src/main.tsx`                          | 30 min   |
| H4  | **Implement REAL alerting dispatch.** Replace placeholders in `alerting.service.ts`: (a) `attemptDispatch` for Telegram → POST to `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage` with 10 s timeout + retry-once-after-5 s; (b) `attemptDispatch` for Discord webhook + generic webhook; (c) `isDeduped` via Redis `SETNX alert:dedup:{hash} EX 300`; (d) `isRateLimited` via Redis windowed `INCR alert:global:{minute} EXPIRE 70`. | `backend/src/services/alerting.service.ts`       | 4–6 h    |
| H5  | **Start the alerting evaluator from the worker process** (not the web app — to avoid duplicate evaluation under multi-instance). Add `alertingService.start()` to `backend/src/worker.ts` after `startHeartbeat`.                                                                                                                                                                                                                                    | `backend/src/worker.ts`                          | 15 min   |
| H6  | **Backend Sentry hardening.** Add `correlation_id` `beforeSend` tag from `AsyncLocalStorage`; add Sentry CLI source-map upload step in `backend/build.mjs` gated by `SENTRY_AUTH_TOKEN`; delete `.map` files from runtime artefact post-upload.                                                                                                                                                                                                      | `backend/src/lib/sentry.ts`, `backend/build.mjs` | 2 h      |
| H7  | **Frontend Sentry source-maps.** Add `@sentry/vite-plugin` to `frontend/vite.config.ts` env-gated by `VITE_SENTRY_AUTH_TOKEN` (`silent: true` when absent); strip `.map` files from `dist/public` after upload.                                                                                                                                                                                                                                      | `frontend/vite.config.ts`                        | 30 min   |
| H8  | **Phase 5 SEO scaffolding (entire phase).** `frontend/src/hooks/useSeo.ts` + `components/seo/{MetaTags,JsonLd}.tsx` + `buildOrganizationLd / buildProductLd / buildBreadcrumbLd / buildFaqLd`; apply on home / product list / product detail / FAQ; `backend/src/routes/seo.ts` for dynamic `/robots.txt` and `/sitemap.xml` with hreflang; product-create/update/delete cache invalidator.                                                          | many new files                                   | 1–2 days |

### 🟡 MEDIUM (P2) — Phase 6 dashboard, Phase 4 perf polish, Phase 7 hardening

| #   | Task                                                                                                                                                                                                                                                                                                                                                                                     | Files                                                          | Effort |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------ | --------------------------------------------------------- | ---------------------------- | ----- |
| M1  | **Phase 6 admin observability backend.** `backend/src/routes/admin/observability.ts` (summary, alerts/recent, deploys/recent via Render_MCP, sentry/summary; 60 s cache; `lastKnownGoodAt`); `backend/src/routes/admin/diagnostics.ts` (Node/Express version, uptime, RSS, heap, event-loop lag, dependency status); start `perf_hooks.monitorEventLoopDelay` in `backend/src/index.ts`. | new files + `index.ts`                                         | 1 day  |
| M2  | **Phase 6 admin observability frontend.** `frontend/src/pages/admin/Observability.tsx` with the 12-widget catalog (TanStack Query already installed); per-widget `loading                                                                                                                                                                                                                | data                                                           | error  | stale`; one-click links to Render/Sentry/Neon dashboards. | new file + admin route mount | 1 day |
| M3  | **Phase 4 Lighthouse CI.** Create `lighthouserc.cjs` targeting home / product list / top-product detail / FAQ on mobile (Moto G Power) + desktop, 3 runs/route, asserting Performance ≥ 90 mobile / ≥ 98 desktop, SEO = 100. Add `validate:cwv` job to `.github/workflows/ci.yml`.                                                                                                       | new + CI                                                       | 4 h    |
| M4  | **Image / font optimisation.** `fetchpriority="high"` + AVIF/WebP `<picture>` + explicit `width`/`height` on the LCP image of home + product list; `loading="lazy"` on below-the-fold images; remove duplicate font preloads, apply `font-display: swap`.                                                                                                                                | `frontend/src/pages/{home,product}.tsx`, `frontend/index.html` | 4 h    |
| M5  | **Coupon `maxUses` over-redemption fix.** Move the `usedCount < maxUses` check inside the atomic update with a conditional `WHERE` clause: `UPDATE coupons SET used_count = used_count + 1 WHERE id = ? AND (max_uses IS NULL OR used_count < max_uses) RETURNING *`; reject the order if zero rows updated.                                                                             | `backend/src/routes/orders.ts`                                 | 30 min |
| M6  | **Topup approve row-lock.** Wrap the topup `SELECT` inside the transaction with `FOR UPDATE` so two simultaneous approvers cannot both pass the re-check.                                                                                                                                                                                                                                | `backend/src/services/topup.service.ts`                        | 30 min |
| M7  | **Resolve schema source-of-truth.** Decide: keep `backend/src/migrate.ts` for _data repair only_ (delete every `CREATE TABLE / INDEX` path), or delete it entirely now that Drizzle migrations exist. Add a CI assertion that no new files appear under `shared/db/drizzle/` outside controlled migrations.                                                                              | `backend/src/migrate.ts`                                       | 4–8 h  |
| M8  | **Build script cleanup.** Replace root `package.json` `"lint": "eslint ... --fix"` with two scripts: `lint:check` (no `--fix`, used by build & CI) and `lint:fix` (used manually).                                                                                                                                                                                                       | `package.json`                                                 | 5 min  |
| M9  | **Wire `validate:suite` into CI** as a separate post-deploy job (gated to staging, not main, to avoid running a 15-min suite per PR).                                                                                                                                                                                                                                                    | `.github/workflows/ci.yml`                                     | 2 h    |
| M10 | **Render_MCP rollback playbook.** Implement `scripts/rollback.ts` that calls Render_MCP `list_deploys` → identifies last successful → triggers redeploy + Telegram notification within 60 s.                                                                                                                                                                                             | new `scripts/rollback.ts`                                      | 4 h    |

### 🟢 LOW (P3) — Phase 8 docs + cleanup

These are cheap once P0/P1/P2 land, because the docs reference real artefacts.

| #   | Task                                                                                                                                                                        | Effort |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| L1  | Write `OBSERVABILITY_SETUP.md`                                                                                                                                              | 4 h    |
| L2  | Write `ALERTING_ARCHITECTURE.md`                                                                                                                                            | 3 h    |
| L3  | Write `SEO_AND_PERFORMANCE_REPORT.md`                                                                                                                                       | 3 h    |
| L4  | Write `CORE_WEB_VITALS_REPORT.md`                                                                                                                                           | 3 h    |
| L5  | Write `MONITORING_RUNBOOK.md`                                                                                                                                               | 4 h    |
| L6  | Reset stale `tasks.md` markers; update `master-execution-plan.md` change log                                                                                                | 30 min |
| L7  | Reconcile `MASTER_PLATFORM_AUDIT.md` + `FULL_PLATFORM_REPORT.md` into a single `docs/STATE_OF_THE_PLATFORM.md`; archive scan dumps under `.kiro/specs/.../inspection-data/` | 2 h    |
| L8  | Move root `CLAUDE.md` (Ruflo coord) out of project root                                                                                                                     | 5 min  |

---

## 8. Cleanups, Merges, Removals

| Action              | File / Path                                                                                                  | Reason                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| **Move**            | `CLAUDE.md` (root) → `ruflo/CLAUDE.local.md` or rename to `RUFLO.md`                                         | It is Ruflo agent-coordination, not the SubNation2 project plan. Misleads contributors. |
| **Merge**           | `MASTER_PLATFORM_AUDIT.md` + `FULL_PLATFORM_REPORT.md` → single living `docs/STATE_OF_THE_PLATFORM.md`       | Two competing audits with conflicting verdicts.                                         |
| **Archive**         | `web-check-report.md`, `pagespeed_report.md` → `.kiro/specs/observability-seo-cwv-maturity/inspection-data/` | They are baseline scan dumps, not plans.                                                |
| **Delete**          | `frontend/src/App.tsx` `<HelmetProvider>` wrapper at line 247                                                | Already provided by `main.tsx`.                                                         |
| **Decide & remove** | `backend/src/migrate.ts` runtime DDL paths                                                                   | Drizzle migrations are now the source-of-truth.                                         |
| **Replace**         | Root `package.json` build script `lint --fix`                                                                | Build should not auto-mutate source.                                                    |
| **Fix**             | `tasks.md` status markers (52.1 `[x]`→`[ ]`, 28.1 `[-]`→`[x]`, etc.)                                         | Truthful state matters for resumption after compaction.                                 |

---

## 9. Validation Gates Before Each Phase Re-Closes

After implementing a tier, re-run the relevant gate; do not advance until green.

- **After P0 (C1–C5):** `pnpm run build && pnpm --filter @workspace/api-server exec vitest run` — must pass. Boot the worker locally and confirm `worker:heartbeat` is written to Redis with no `ReferenceError`. Hit `/api/healthz/redis` and confirm `200 ok` (not `503 not configured`).
- **After P1 (H1–H8):** Synthetic 500 via a test-only route appears in Sentry with source-mapped frame; matching `correlation_id` across response header / Pino line / Sentry tag. `POST /api/admin/alerts/test` delivers a real Telegram message within 60 s; second invocation within 5 min is suppressed with `category:"alerting" outcome:"deduped"` log line.
- **After P2 (M1–M10):** `npm run validate:cwv` median-of-3 reports mobile ≥ 90, desktop ≥ 98 on home / product list / product detail / FAQ. JSON-LD payloads pass schema.org / Rich Results Test. Admin dashboard renders all 12 widgets within 5 s; non-admin gets 401/403 within 1 s with no telemetry leakage.
- **After P3 (L1–L8):** All five root deliverable docs exist and contain at least one Mermaid/ASCII architecture diagram, no broken internal links, and reference real metric / env-var / route / MCP names used in the implementation.

---

## 10. Memory_MCP Continuity

Findings persisted to the memory knowledge graph for cross-session continuity:

- Entity `subnation2:audit:2026-05-16` (type Audit, 14 observations) — verified state per phase, remaining tech debt, P0 runtime bugs, owner-setup-blocked items.
- Entity `subnation2:roadmap:next-priorities` (type Roadmap, 8 observations) — full P0/P1/P2/P3 ordered priorities + cleanup + owner-setup-required items.

Use `memory.search_nodes("subnation2:audit")` to recover this audit context in a future session.

---

_Generated by Kiro CLI default agent on 2026-05-16. All claims in §3, §4, and §5 are backed by direct code reads or grep evidence in this repository at HEAD on branch `main` (working tree includes uncommitted Phase 1/2 scaffolding per `git status`). No source files were mutated by this audit._
