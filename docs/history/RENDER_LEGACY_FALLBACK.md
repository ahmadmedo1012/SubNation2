> **ARCHIVED (2026-10-07, R122 docs reorg).** Moved from `docs/deployment/RENDER_LEGACY_FALLBACK.md`; dated historical record — content unchanged, not current state (see ../README.md for the current index).

# Render Legacy Fallback (§24 — the emergency-only truth)

> **(R119-B5 note)** `render.yaml` was DELETED from the repo on 2026-10-05
> (`62ee976`) — the references to it below are recoverable from **git
> history only**. This doc stays as a historical emergency reference; the
> live rollback path is `FINAL_ROLLBACK_RUNBOOK.md`.

> The Render account is NOT the production target. It is the retired legacy
> stack, kept (suspended) as a paper fallback only. Production (live since
> the 2026-10 cutover) = Cloudflare (DNS-only, grey) → self-hosted VM
> (observed host R117: Contabo) → Coolify → `subnation` + `openwa` → Neon —
> `docs/architecture/FINAL_PRODUCTION_TOPOLOGY.md`.
> Rollback choreography: `FINAL_ROLLBACK_RUNBOOK.md`.

## 1. Status: LEGACY emergency fallback ONLY

- The r108+ architecture (`SINGLE_INSTANCE_MODE`, no Redis dependency, the
  cold-start fast path, the V1-M20 money fix) was built FOR the Oracle/Coolify
  target. Render runs it acceptably — same Dockerfile, same Neon — but it is
  not maintained as the primary and gets no operational love.
- `render.yaml` is FROZEN (r110 header): a legacy blueprint, NOT a living
  deployment definition. `Apply Blueprint` after the cutover would resurrect
  the retired Render/Vercel split (it still bakes
  `subnation2.onrender.com` into `VITE_API_BASE_URL`/`VITE_SOCKET_URL`/
  `VITE_API_URL` — the exact split the single-origin contract removed). Do
  not re-apply it against live infrastructure.

## 2. The current Render truth (r106/r111 records)

- The account's **8 services exhausted the shared free 750 h/month pool** and
  were **auto-suspended mid-September 2026** — `suspenders: ['billing']`
  (r106 record: suspended since 2026-09-16T16:32Z; the last live deploy runs
  2026-09-11 code). `subnation2.onrender.com` and
  `openwa-gateway.onrender.com` are both down (503) with it.
- This is a **billing suspension, not a user suspension**: the resume API
  returns `400 "only services suspended by a user can be resumed"`, and deploy
  returns `400 "cannot deploy suspended service"`. No button and no API can
  lift it before the monthly free-hours reset (October 1st UTC) or a paid
  tier. The 6 unused sibling services (Smart-Order, SmartBot, POS, Smart-Menu,
  zu-connect, lyosint) drain the same pool.
- Consequence for rollback planning (`FINAL_ROLLBACK_RUNBOOK.md` §3): **the
  DNS rollback target does not currently exist** — pointing `subnation.ly`
  back at Render would serve 503s. The fallback is live only while Render is
  un-suspended AND still deployed.

## 3. What deploying there again looks like (if ever needed)

The blueprint is `render.yaml` (checked in, frozen):

- ONE web service `subnation` (env: docker, this repo's Dockerfile, health
  check `/api/healthz`, `autoDeploy: false` — deploys are CI-gated) — plus the
  **separate** `openwa-gateway` web service built from the openwa repo
  (`srv-da6piju7bikc739anbtg` → `openwa-gateway-7aaa.onrender.com`), which
  carries its own `OPENWA_API_KEY` + `PERSISTENCE_URL` (same Neon). Both point
  at the same external Neon `DATABASE_URL` — no data fork has ever existed.
- **Redis: NOT attached, by design.** The historical attachment was removed
  from the blueprint in the 2026-09-20 audit (so `Apply Blueprint` can never
  create an unused Redis). Verified compose/env truth: `docker-compose.yml`
  has no Redis service and `deploy/env.compose.example` sets no `REDIS_URL` —
  the app runs fine without it when `SINGLE_INSTANCE_MODE=true` (rate limits,
  caches and idempotency all fall back in-process; the PG-lease machinery is
  never exercised in this mode). A Redis would only ever return with a
  multi-replica future.
- The WhatsApp single-gateway rule (`FINAL_ROLLBACK_RUNBOOK.md` §0) applies to
  any Render↔Oracle switch in BOTH directions: exactly one gateway live.

## 4. THE DO-NOT-COPY-BACK RULE

The old pre-r108 scheduler behavior — the PG-lease heartbeat (25 s refresh
against Neon, 24/7) — is **the Neon-killer (B6-01)**: it kept Neon compute
awake ~720 h/month against the then-applicable ~192 h free allowance (Neon
Free is 100 CU-h/project/month today — `NEON_IDLE_ECONOMICS.md` §1) and
accounted for 92.4%
of all UPDATEs on the live DB. The fix **ships in code**
(`SINGLE_INSTANCE_MODE`, r108) — there is no Render-side configuration that
reproduces it safely.

Therefore:

1. NEVER copy the old scheduler behavior (lease cadence tuning, keep-alive
   pings, self-pings, warm-up loops) back into any deployment — Render,
   Oracle, or otherwise. The 2026-09-20 purge removed them everywhere.
2. **Any Render re-deploy MUST use current `main`** — never the old builds.
   What is live on Render today is 2026-09-11 pre-r104 code (SubNation2
   `e7de0f1`, openwa `99b73fb` per the r106 record): it predates V1-M20 (the
   topup FK 500), `SINGLE_INSTANCE_MODE`, and every r108–r112 fix. If the
   October renewal auto-resumes it, the lease heartbeat starts burning Neon
   immediately — same-day either deploy current `main` to Render or re-suspend
   it; better, complete the Oracle cutover before it matters.

## 5. Recommendation

- **Keep Render as a cold fallback only if the account is already paid.** A
  paid instance type removes the 750 h pool problem and makes the §2
  suspension moot; a free-tier fallback is an illusion — it suspends exactly
  when a month runs long.
- **The October free hours are better spent on nothing: leave it suspended.**
  Resuming burns the shared pool against the 6 unused sibling services and
  boots the old pre-r108 build (§4). The self-hosted VM (live host: Contabo)
  is the production path.
- **Decommission Render when the Oracle cutover has been stable for 2 weeks**:
  the DNS old-origin records can go after the ≥1-week soak
  (`CLOUDFLARE_FINAL_CUTOVER.md` §6); then delete the services + Vercel
  project per `MIGRATION_RUNBOOK.md` Phase 6 and revoke leftover platform
  tokens. After deletion this document and `render.yaml` remain as history —
  the fallback no longer exists, by decision.

## 6. Cross-references

- `FINAL_ROLLBACK_RUNBOOK.md` §3 — the DNS rollback target exists only while
  Render still serves the old stack (un-suspended + deployed).
- `MIGRATION_RUNBOOK.md` Phase 0/6 — the Render URLs as the recorded rollback
  path and the deletion checklist.
- `docs/free-tier-optimization-2026-09-20.md` — the suspension evidence
  (`suspenders: ['billing']`, API 400s).
- `docs/architecture/PRODUCTION_ARCHITECTURE.md` §6 — the history this
  replaced.
