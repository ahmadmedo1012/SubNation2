# SUBNATION — Final Deep Audit & Cleanup Report

**التاريخ:** 2026-09-20 (post-midnight UTC) · **المرحلة:** Final Deep Audit + Cleanup + Production Readiness
**المنهجية:** افحص → صنّف → أصلح → اختبر → أعد الفحص → ابنِ → قرّر. فحص الكود نفسه، لا تقارير الجولات السابقة.

---

## Current State

```text
Architecture: Cloudflare → subnation.ly → Vercel (frontend, LIVE) → /api/* rewrite → Render Free backend (billing-suspended) → Neon PostgreSQL. OpenWA on Render Free. No worker, no Redis, no paid anything, zero artificial traffic.
Frontend:     SPA on Vercel — up-to-date bundle (customFetch cold-start retry verified in the deployed asset), 487 tests, PWA, RTL, 45 local product images.
Backend:      Render Free (asleep by design; billing-suspended until resolved). Early-bind gate + honest 503 "starting"; boot 30–33s (Neon wake + migrations = the safety gate).
Database:     Neon — healthy: 40 tables, 45 active retail products, 14 archived, 263 active variants, 0 pricing violations, 0 orphans, live integrity re-verified this round.
WhatsApp:     OpenWA code hardened (key separation shipped). ⚠ openwa_sessions table has 0 rows — the current pairing is ephemeral (Render disk); a QR re-pair after service resume will persist.
Catalog:      45 retail products reconciled against live data: source crawl 56 − 11 excluded (10 RESELLER + 1 automation) = 45 ✓. 0 missing prices/images/SEO/descriptions/variants/duplicates. FAQ column optional and uncurated (by design).
Pricing:      ONE source of truth (lib/pricing-config.ts, ×20 rule) at every write path; frontend computes nothing; 0 violations live.
```

## Fixed

1. **migrate.ts legacy-provider backfill** — referenced `github_id`/`facebook_id` (columns Stage C deliberately dropped): level-50 "Data migration failed" on EVERY cold start + the exception aborted the loop so telegram's backfill never ran. Now catalog-probed per column with per-provider try/catch. Boot log verified clean.
2. **render.yaml** — removed `subnation-redis` + `fromService REDIS_URL`: production never provisioned Redis (PG-lease fallback is the live path); Apply Blueprint can no longer create an unused service. Code-level fallback untouched.
3. **openwa credentials key separation** — `OPENWA_CREDENTIALS_KEY` (encryption) split from `OPENWA_API_KEY` (request auth); unset = byte-identical legacy derivation (proven); transparent re-key on first read; wrong-key leaves the blob untouched (recovery path); WA-02 tombstone respected; scrypt derivation memoized (was ~50–100 ms CPU per debounced save). 5 new tests, dist rebuilt, pushed.
4. **forecast-gate.test.ts midnight flake** — seeded order dates (`Date.now()−24d−1h`) shrank the 14-day window to 13/14 (avg 0.9286) whenever the suite ran 00:00–01:00 UTC. Orders now pinned to 12:00 UTC of the intended ISO day. Deterministic.
5. **OPERATIONS_RUNBOOK.md** — worker triage rewritten for the worker-less deployment (web process owns heartbeat under the PG-lease leader lock); scaling table now reflects free-tier reality (web sleeps, Redis not provisioned); `frontend_sentry_error_rate_high` + `worker_job_failures_high` marked DORMANT explicitly (no evaluator, by design).
6. **Docs truth fixes** — alerting comment pointed at non-existent OBSERVABILITY_SETUP.md/ALERTING_ARCHITECTURE.md (now → runbook); catalog report gained the verified reconciliation note (56−11=45; the "51" was a transcription slip).

## Remaining

- **Render billing suspension** — the only gate to production. API refuses resume/deploy for billing-suspended services; needs dashboard action or cycle renewal. Deploy commands ready (POST /v1/services/…/deploys for both services).
- **WhatsApp re-pair once** after Render resume (session not in DB — see Current State). Pairing UI + persistence flow verified in code; the operator's number is +218910089975.
- **CI on GitHub Actions** — private-repo minutes exhausted (jobs die in 3–4 s with no runner). Local full verification is the documented substitute.
- **Optional**: point Cloudflare DNS at Vercel to show the storefront before Render resolves (frontend is already live and current on subnation-seven.vercel.app).
- **Deferred by design**: FAQ curation (optional column), 2 duplicate indexes (risk_rules.name, users.referral_code — negligible on low-write tables; a schema change is not justified this round), dormant alert rules awaiting free signal sources.

## Risks

- **openwa_sessions = 0 rows**: until the operator re-pairs after resume, WhatsApp OTP depends on a fresh QR scan. Everything else (site, catalog, Google/Telegram login, wallet, orders) is independent of it by design.
- **Render deploys 2026-09-11 code** (pre free-tier round). The optimized code is in main and verified, but it goes live only with the post-resume manual deploy. Until then the sleeping behavior on the (suspended) old code is moot.
- **GitHub CI false-red**: any future push shows a red X (no runner). Do not treat it as code failure — the local suite is the gate of record until Actions minutes return.

## Verification

```text
Backend tests:      119 files · 1080 passed | 5 todo (incl. money/idempotency/CSRF families)
Frontend tests:     67 files · 487 passed
OpenWA tests:       70/70 (65 + 5 new key-separation)
Typecheck:          libs ✓ backend ✓ frontend ✓ — 0 errors
Lint:               0 errors; 12 warnings all pre-existing (no-explicit-any on old lines)
Build:              frontend ✓ (PWA, 45/45 images in dist) · backend esbuild ✓ · openwa tsc+dist ✓
Security:           provider-secrecy scan on the LIVE Vercel bundle (7 assets): 0 hits for
                    cost/sku/supplier/Embronic/markup/internal_cost; live products DTO clean;
                    catalog-security + checkout-variants suites green
Catalog integrity:  45 active / 14 archived / 263 variants / 0 dup / 0 missing / 0 orphan refs
Pricing integrity:  0 violations of ×20 on live data; single engine on all write paths
Cold-start (live):  15/16→16/16 checks — port gate 503 {starting} + Arabic marker + POST
                    retry (same Idempotency-Key) side-effect-free + business 503/401/403 NOT
                    retried + clean SIGTERM + boot log free of level-50 (migration fix proven)
Deployment truth:   GitHub main = 4d2dbf1 (this round) · Vercel = current bundle · Render =
                    2026-09-11 build, suspended, deploy pending operator billing action
```

## Next Phase

> **Embronic API + provider adapter + real-time catalog synchronization + real fulfillment + purchase settlement** — not started, per directive. Pre-conditions met: clean architecture, single pricing engine, variant-scoped inventory model, provider secrecy guaranteed, catalog reconciled.

---

**FINAL PRINCIPLE — verified:** لا إعادة بناء، لا خدمات جديدة، لا Keep-Alive (صفر)، لا Embronic API. المشروع الآن: أبسط، أنظف، أسرع، أكثر اتساقًا وأمانًا، أقل استهلاكًا.
