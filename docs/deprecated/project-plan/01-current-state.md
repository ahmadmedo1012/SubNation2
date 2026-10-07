> **DEPRECATED (2026-10-07, R122 docs reorg).** Moved from `docs/project-plan/01-current-state.md`; superseded/completed — kept for reference only, not current state.

# 01 — Current State (Wave 0 evidence, 2026-10-05)

> Wave-0 snapshot (2026-10-05) — superseded where contradicted by the merge (`966d70f`); see
> `docs/project-state/source-of-truth.md` (contradiction #7). WhatsApp OTP is paired & READY
> since 2026-10-05; the app-2 dockerimage deployment described below was deleted at the
> Wave-1 cutover.

## Repository

- Branch `main` at `ef3d0c3` = GitHub main (synced after Wave 0; local repo was 4 commits behind —
  R117 round by a parallel agent was reconciled; superseded local drift discarded, backup kept at
  `~/.cache/subnation-mission/local-backup/`).
- Remotes: `github` = HTTPS GitHub (PAT valid, stored credential); `origin` = dead VPS path
  (`/data/SubNation2` is not a repo) — do not use.
- Gates at `ef3d0c3` (this machine): lint 0 err/89 warn; typecheck all green; backend 1517 tests,
  frontend 751 tests — all pass individually; ~4 backend + ~3 frontend tests flake only under full
  parallel load (timing-sensitive scheduler/whatsapp-readiness/admin-layout tests) — deflake later
  (P3). Build exit 0 (entry 27.12 KB gz, PWA precache 10).
- CI: billing-disabled. `docker.yml` GHCR workflow never run. (`deploy.yml` Render hook was
  removed from the repo 2026-10-05, `62ee976` — preserved in git history only.)

## Production (verified live)

- VPS: Contabo `vmi3624162` x86_64, 4 vCPU / 7.8 GB RAM / 77 GB free disk, load ~0.9. SSH root works.
- Coolify v4.3.23 (+db/redis/realtime/sentinel/proxy) healthy. Two app containers:
  - SubNation: app id=2 uuid `wbgj7cszizukrlrblncq8by5`, image `ghcr.io/…/subnation2:coolify-latest`
    (created 2026-10-05 11:09 +02 from `f10bb9b`), PORT=3000, SINGLE_INSTANCE_MODE=true, healthy.
  - OpenWA: app uuid `6x3ekglvh7megkkhfsnyhm8h`, image `ghcr.io/…/openwa:sha-ba6a843`, port 2785,
    healthy. Internal only.
- Live: `https://subnation.ly/api/healthz` → `{"status":"ok"}`; `/api/healthz/summary` → `degraded`
  (pre-R117 code; Neon cold-resume flap fixed at `ef3d0c3`).
- Coolify deployment queue: rows 8–13 `finished` (Oct 2–4), row 22 `failed`, row 23 `queued` (stuck,
  created by `fix-coolify-deploy.sh` which also wrote fake rows directly into `coolify-db`).
- Env: from `/data/coolify/applications/wbgj7cszizukrlrblncq8by5/.env` — full contract in
  `docs/project-graph/11-environment-secrets.mmd`. No REDIS_URL (by design), no FIREBASE_*, no
  TELEGRAM_*, no SENTRY_*, no VITE_* (all build args empty).
- Business data (Neon, read-only probe): 45 live/59 total products, 6 avail/13 inventory units,
  topups 5 approved/3 pending/5 rejected, 7 orders (401.49 LYD), 17 users, `openwa_sessions` EMPTY,
  `system_settings` has auth.google/github/facebook/apple/telegram + pricing keys.

## Auth reality (live probes)

- `GET /api/auth/providers` → telegram only (enabled, bot SubNation_USERS_bot) + whatsapp_enabled.
- `POST /api/auth/firebase/session` → 503 "Firebase غير مهيأة" (backend Admin SDK not configured).
- `POST /api/auth/telegram` with garbage → `bad_signature` (verification layer live and configured).
- WhatsApp: gateway `/api/sessions` → `[]` at Wave 0 (no session ⇒ OTP path cannot deliver).
  **Superseded 2026-10-05**: session `subnation-otp` paired & READY since Wave 2
  (see `docs/project-state/external-integrations-final.md`).

## Known issue backlog entering Wave 1

1. Coolify build authority (P0 for mission) — Wave 1.
2. Stuck/failed fake deployment rows — Wave 1 cleanup.
3. WhatsApp OTP down (session pairing) — operator gate; everything else verifiable — Wave 2.
   **RESOLVED 2026-10-05**: session `subnation-otp` paired & READY.
4. Google login off (creds) — operator gate — Wave 5.
5. Store nearly unsellable (6 units, 3 under archived tests) — operator gate (restock/Embronic) — Wave 4/6 context.
6. Flaky-under-load tests — P3 — Wave 8/9.
7. DR/backup docs host references still Oracle — P3 — Wave 10.
8. TOTP not enrolled on sole admin — operator recommendation.
9. www→apex 301 at Traefik layer — operator recommendation (R117 §8), not in-app.
