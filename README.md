<div align="center">

# SubNation

**Arabic-first (RTL) digital-subscriptions marketplace for the Libyan market.**

Streaming, music, gaming and productivity subscriptions — bought with an in-app
wallet and delivered instantly with encrypted account credentials.

[![Status](https://img.shields.io/badge/status-cutover_pending-f59e0b)](./docs/deployment/FINAL_MIGRATION_READINESS.md)
[![Stack](https://img.shields.io/badge/stack-React_19_·_Express_5_·_Postgres-3b82f6)](#tech-stack)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-339933)](#requirements)
[![pnpm](https://img.shields.io/badge/pnpm-%E2%89%A510-f69220)](#requirements)

</div>

---

## What is this?

SubNation is a production-grade e-commerce platform where customers in Libya buy
digital subscriptions (Netflix, Spotify, PlayStation, Adobe, Microsoft 365, …).
It is **passwordless** for customers — sign in with **Google**, **Telegram**, or
**WhatsApp OTP** — top up an internal **wallet**, and receive subscription
credentials instantly after purchase. A full **admin panel** manages products,
inventory, orders, wallet top-ups, coupons, loyalty, referrals and support.

> 🚧 **Status (2026-09-23): production is offline.** The Render free tier has
> been billing-suspended since ~2026-09-11 (`subnation.ly` answers 503; the
> Render API rejects deploys for billing-suspended services). The project is
> mid-migration to self-hosted Docker on Oracle Cloud (Coolify, ARM64) —
> cutover pending. Details: [Deployment status](#deployment-status-2026-09-23)
> below and
> [`docs/deployment/FINAL_MIGRATION_READINESS.md`](./docs/deployment/FINAL_MIGRATION_READINESS.md).

---

## Highlights

- 🔐 **3 passwordless auth methods** — Google (Firebase), Telegram (widget + Mini App), WhatsApp OTP.
- 💳 **Internal wallet** with an append-only ledger and atomic, race-safe purchases.
- 📦 **Instant delivery** of inventory credentials, encrypted at rest (AES-256-GCM).
- 🎟️ Coupons, flash sales, loyalty tiers, and a referral program.
- 🛠️ **Rich admin panel** — products, orders, users, top-ups, pricing, security, alerts, observability.
- 🌍 **Arabic RTL** UI with a unified dark/light theme.
- 📈 Production-grade **observability** — Sentry, Prometheus metrics, structured logs, public `/status`.
- 🔒 Hardened security — Helmet/CSP, CORS allow-list, CSRF checks, multi-tier rate-limiting
  (Redis-backed when provisioned; in-process fallbacks in the no-Redis target topology), admin 2FA.

---

## Tech stack

| Layer            | Technology                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Frontend         | React 19, Vite, Tailwind CSS, wouter, TanStack Query (RTL, Arabic)                                                              |
| Backend          | Express 5, TypeScript, Socket.IO                                                                                                |
| Database         | PostgreSQL (Neon) via Drizzle ORM                                                                                               |
| Cache / realtime | Redis — **optional, not provisioned** (in-process rate-limit/cache/idempotency fallbacks; the single-instance scheduler mode needs no leader lock) |
| Auth             | Firebase Admin (Google), Telegram HMAC, WhatsApp OTP (OpenWA), JWT + httpOnly cookies                                           |
| Validation       | Zod (shared contracts)                                                                                                          |
| Observability    | Sentry, Prometheus (`prom-client`), Pino                                                                                        |
| Deploy           | Docker (single image) on Oracle Cloud A1 (ARM64) + Coolify — migration in progress, cutover pending; Neon stays external. Render free tier suspended since 2026-09-11 (see [status](#deployment-status-2026-09-23)) |

It is a **pnpm monorepo**:

```
frontend/   Vite + React + Tailwind SPA (Arabic RTL)
backend/    Express API, auth, jobs, migrations; serves the built frontend
shared/     db (Drizzle schema) · api-zod (validation) · api-client-react (hooks) · api-spec (OpenAPI) · error-codes (سجل رموز الأخطاء المشترك بين الطرفين)
scripts/    local orchestration, seed, maintenance
config/     env.example (fully annotated reference)
```

---

## Requirements

- Node.js **22+**
- pnpm **10+**
- A PostgreSQL database

---

## Quick start

```bash
pnpm install
cp config/env.example .env      # then edit DATABASE_URL (and SESSION_SECRET for prod)
pnpm run dev                    # boot migrations create/update the schema automatically
pnpm run db:seed                # create the default admin + sample products
```

Open the printed local URL. Ports are only _preferences_ — the runner moves to
the next free port automatically and wires the Vite `/api` proxy for you.

> **Schema note:** there is no `db:push` step. Schema changes flow exclusively
> through the idempotent boot migrations (`backend/src/migrate.ts`) which the
> dev server runs automatically on every cold start. The `drizzle-kit push`
> script is intentionally not part of the workflow — it generates SQL this
> schema rejects and can drop tables that exist only in production (see
> `scripts/post-merge.sh` and `docs/deep-audit-2026-09-06.md`). The dev server
> must be running (or have completed boot) before `pnpm run db:seed`, which is
> idempotent and safe to re-run.

### Local PostgreSQL (any OS with Docker)

```bash
docker run -d --name subnation-pg \
  -e POSTGRES_USER=subnation -e POSTGRES_PASSWORD=<your-local-password> \
  -e POSTGRES_DB=subnation \
  -p 127.0.0.1:5432:5432 \
  -v subnation-pg-data:/var/lib/postgresql/data \
  postgres:16-alpine

# .env
DATABASE_URL=postgresql://subnation:<your-local-password>@127.0.0.1:5432/subnation
```

Redis is optional and unset in development — rate limiting, caching and the
scheduler fall back to the in-process / Postgres-lease paths automatically.

---

## Build & run (production)

```bash
pnpm run build                  # typecheck + build API + build frontend
pnpm start                      # serves the API and the built SPA on one port ($PORT, default 8080)
```

The backend serves the built frontend from the **same origin**, so the simplest
deployment is a single Node process.

### Docker

```bash
cp config/env.example .env      # edit values
docker build -t subnation .
docker run -p 8080:8080 --env-file .env subnation
```

**Full stack with the WhatsApp gateway** (self-hosted / local — r107):

```bash
cp deploy/env.compose.example .env          # fill the required secrets
git clone https://github.com/ahmadmedo1012/openwa ../openwa
docker compose up -d --build                # subnation :3000 + openwa :3001 (localhost-bound)
```

Single-origin contract: leave `VITE_API_BASE_URL` / `VITE_SOCKET_URL` /
`VITE_API_URL` empty — the backend serves the SPA, the browser uses relative
`/api` paths and same-origin WebSockets. Verify a deployment with
`./scripts/docker-verify.sh` (build + health gate + graceful-drain proof;
`--arm64` cross-builds the Oracle Ampere target via QEMU).

### Self-hosted: Oracle Cloud + Coolify (target — migration in progress)

The platform is hosting-agnostic (no Render/Vercel runtime coupling — r107
audit) and runs as the two Docker images above behind Coolify on an Oracle
Always Free ARM64 VM, with Neon staying external. R108 makes the
single-container shape first-class: `SINGLE_INSTANCE_MODE=true` runs the
schedulers ungated in-process with ZERO periodic Neon coordination queries
(idle autosuspend preserved) — see `deploy/env.compose.example`. Validate
your env file before deploying:
`pnpm --filter @workspace/scripts run validate:env -- --file .env --strict`.
Full guide + runbook: `docs/deployment/COOLIFY_ORACLE_MIGRATION.md` and
`docs/deployment/MIGRATION_RUNBOOK.md`; readiness state:
`docs/deployment/FINAL_MIGRATION_READINESS.md`; target architecture:
`docs/architecture/PRODUCTION_ARCHITECTURE.md`.

### Deployment status (2026-09-23)

- **Production is offline.** All eight services on the Render free-tier
  account (including `subnation` and the openwa gateway) have been
  billing-suspended since ~2026-09-11: `subnation.ly` answers 503 and the
  Render API rejects both resumes and deploys for billing-suspended services.
  The last live deploy runs 2026-09-11 code. The dated records
  `docs/free-tier-optimization-2026-09-20.md` and
  `docs/final-audit-2026-09-20.md` capture the suspension and the operator's
  options (a billing action in the Render dashboard, or the free-hours
  reset). The `deploy.yml` Render hook stays kill-switched behind the
  `RENDER_DEPLOY_ENABLED` repo variable.
- **The active path is the self-hosted migration** to Oracle Cloud Always
  Free (ARM64) + Coolify described above — cutover pending; nothing in the
  code requires Render or Vercel (r107 hosting-coupling audit).
- **Repo state:** the full suite was green at the R109 audit base `6ab63bc`
  (backend 1264/1264, frontend 573/573, openwa 80/80, lint/typecheck clean).
  GitHub Actions CI is red for **billing reasons only** — private-repo
  minutes are exhausted; jobs die in seconds without a runner.
- **Docker builds are unblocked** (commit `bb4418e`, 2026-09-22): R109 found
  two P0s that made the image unbuildable — the root `prepare: husky`
  script failing the `--prod` runtime-stage install, and the arm64/musl
  build-toolchain natives excluded from the lockfile. Both are fixed and
  verified statically plus by an exact-stage replay in the sandbox; an
  actual `docker build` on a Docker host is still pending
  (`./scripts/docker-verify.sh`, extended in r110).
- **Nightly backups are automated as of r110** — `scripts/backup-cron.sh`
  (host-cron wrapper around `pnpm run db:backup`); see the "Automated
  backups" section of `docs/DISASTER_RECOVERY.md`.

---

## Configuration

All runtime config flows through a single `.env` file — copy `config/env.example`
and edit. You should never need to change code to switch host, port, or domain.
Most important keys:

| Key                              | Purpose                                                                                                                                |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                   | Postgres connection string (**required**)                                                                                              |
| `SESSION_SECRET`                 | JWT signing secret (**required in prod**, ≥ 32 chars)                                                                                  |
| `ENCRYPTION_KEY`                 | AES-256-GCM key (64 hex chars) for inventory credentials                                                                               |
| `REDIS_URL`                      | Redis connection (**optional** — unset in the target topology; rate-limit/cache/idempotency degrade to in-process fallbacks; the single-instance scheduler mode needs no lease) |
| `APP_URL` / `APP_ORIGINS`        | Public origin and CORS allow-list                                                                                                      |
| `FIREBASE_*` / `VITE_FIREBASE_*` | Enable Google Sign-In                                                                                                                  |
| `TELEGRAM_BOT_TOKEN`             | Operational notifications (Telegram **login** is configured in the admin UI)                                                           |
| `WHATSAPP_OTP_*`                 | OpenWA gateway for WhatsApp OTP                                                                                                        |

See `config/env.example` for the full annotated reference.

For pairing and removing the WhatsApp OTP session, see
[`docs/WHATSAPP_OPERATIONS.md`](./docs/WHATSAPP_OPERATIONS.md).

---

## Main API routes

```
GET  /api/healthz                  POST /api/orders
POST /api/auth/firebase/session    GET  /api/wallet
POST /api/auth/telegram            GET  /api/products
POST /api/auth/whatsapp/start      GET  /api/admin/stats
POST /api/auth/whatsapp/verify     GET  /api/auth/me
```

Generated frontend hooks live in `shared/api-client-react`; request validation
schemas live in `shared/api-zod`.

---

## Documentation

| Document                                                   | What it covers                                                                                                  |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **[`OPERATIONS_RUNBOOK.md`](./OPERATIONS_RUNBOOK.md)**     | 📌 **Start here** — on-call playbook: alert triage, dashboards, rollback, scaling, free-tier posture, env knobs |
| [`PROJECT_OVERVIEW.md`](./PROJECT_OVERVIEW.md)             | Historical archive — 2026-08-25 architecture/feature snapshot (predates the free-tier + no-Redis rounds)        |
| [`PLATFORM.md`](./PLATFORM.md)                             | 2026-09-02 platform snapshot (superseded by the runbook for current state)                                      |
| [`docs/DISASTER_RECOVERY.md`](./docs/DISASTER_RECOVERY.md) | Backup/restore and incident recovery                                                                            |
| [`docs/API.md`](./docs/API.md)                             | API reference                                                                                                   |

---

## Notes

- The `ruflo/` directory (optional multi-agent dev tooling) is gitignored and is
  **not** required to build, run, or deploy SubNation.
