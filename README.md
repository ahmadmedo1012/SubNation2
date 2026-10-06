<div align="center">

# SubNation

**Arabic-first (RTL) digital-subscriptions marketplace for the Libyan market.**

Streaming, music, gaming and productivity subscriptions — bought with an in-app
wallet and delivered instantly with encrypted account credentials.

[![Status](https://img.shields.io/badge/status-production_live-22c55e)](./docs/project-state/source-of-truth.md)
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

> ✅ **Status (R118 truth pass, 2026-10-06): production is LIVE at
> <https://subnation.ly>** — self-hosted Docker on Coolify (Contabo VPS) since
> the 2026-10 cutover, with Neon Postgres staying external. Deployment chain:
> GitHub main → Coolify (git-source dockerfile build, push-to-deploy webhook) →
> Traefik → `subnation.ly`. Vercel/Render are fully retired (frozen-era docs
> below are historical). Current truth:
> [`docs/project-state/source-of-truth.md`](./docs/project-state/source-of-truth.md);
> architecture of record:
> [`docs/architecture/FINAL_PRODUCTION_TOPOLOGY.md`](./docs/architecture/FINAL_PRODUCTION_TOPOLOGY.md);
> current-state summary: [Deployment status](#deployment-status-2026-10) below.

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
| Deploy           | Docker (single image) on a self-hosted VM + Coolify — **live at `subnation.ly` since 2026-10** (host: Contabo VM); Neon stays external (see [status](#deployment-status-2026-10)). Render/Vercel are retired legacy |

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
> `docs/deep-audit-2026-09-06.md`). The dev server
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
`--arm64` optionally cross-builds the ARM64 image via QEMU — the original
Oracle A1 target was ARM64; the live host since 2026-10 is a Contabo VM).

### Self-hosted: Docker + Coolify (production since 2026-10)

The platform is hosting-agnostic (no Render/Vercel runtime coupling — r107
audit) and runs as the two Docker images above behind Coolify on a
self-hosted VM (live host since 2026-10: Contabo; the original r107 target
was Oracle Always Free ARM64), with Neon staying external. R108 makes the
single-container shape first-class: `SINGLE_INSTANCE_MODE=true` runs the
schedulers ungated in-process with ZERO periodic Neon coordination queries
(idle autosuspend preserved) — see `deploy/env.compose.example`. Validate
your env file before deploying:
`pnpm --filter @workspace/scripts run validate:env -- --file .env --strict`.
Migration-era guides (historical): `docs/deployment/COOLIFY_ORACLE_MIGRATION.md`,
`docs/deployment/MIGRATION_RUNBOOK.md`, and
`docs/deployment/FINAL_MIGRATION_READINESS.md`; architecture of record:
`docs/architecture/PRODUCTION_ARCHITECTURE.md` and
`docs/architecture/FINAL_PRODUCTION_TOPOLOGY.md`.

### Deployment status (2026-10)

- **Production is LIVE** at `https://subnation.ly` — self-hosted Docker +
  Coolify on a Contabo VM + Neon Postgres, serving since the 2026-10-01/02
  cutover; Coolify builds this repo from Git on every deploy via the
  push-to-deploy webhook (the R109-era "docker build still pending" caveat
  is long resolved). Dated release record: `docs/deployment/FINAL_SIGNOFF.md`;
  post-cutover audits: `docs/inspection-r117/` and `docs/inspection-r118/`.
  The pre-cutover Render/Vercel stack is retired legacy — Render
  billing-suspended since ~2026-09-11, and the Render deploy-hook workflow
  (`deploy.yml`) plus the frozen `render.yaml`/`vercel.json` blueprints were
  removed from the repo entirely on 2026-10-05 (rollback reference preserved
  in git history). The dated records
  `docs/free-tier-optimization-2026-09-20.md`,
  `docs/final-audit-2026-09-20.md` and
  `docs/deployment/RENDER_LEGACY_FALLBACK.md` are preserved as historical
  audit evidence of the migration era.
- **Repo state (as of R118):** backend 1697 tests / 188 files green,
  frontend 770 / 111, lint / typecheck clean, build within budget
  (R117-era for comparison: backend 1517/165). See `docs/inspection-r118/`.
  GitHub Actions CI remains red for **billing reasons only** —
  private-repo minutes are exhausted; jobs die in seconds without a
  runner.
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
| `ENCRYPTION_KEY_PREV`            | Optional decrypt-only rotation fallback for `ENCRYPTION_KEY` — set only during rotation, drop after the re-encrypt job drains the old blobs (see `config/env.example`) |
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
| **[`OPERATIONS_RUNBOOK.md`](./OPERATIONS_RUNBOOK.md)**     | 📌 **Start here** — on-call playbook: alert triage, dashboards, rollback, resource budget, env knobs            |
| **[`docs/README.md`](./docs/README.md)**                   | 📚 **Docs index** — CURRENT / STALE / ARCHIVED status for every doc (R118)                                      |
| [`PROJECT_OVERVIEW.md`](./PROJECT_OVERVIEW.md)             | Historical archive — 2026-08-25 architecture/feature snapshot (Arabic)                                          |
| [`PLATFORM.md`](./PLATFORM.md)                             | Historical snapshot 2026-09-02 (current state: docs index + runbook)                                            |
| [`docs/DISASTER_RECOVERY.md`](./docs/DISASTER_RECOVERY.md) | Backup/restore and incident recovery                                                                            |
| [`docs/API.md`](./docs/API.md)                             | API reference                                                                                                   |

---

## Notes

- The `ruflo/` directory (optional multi-agent dev tooling) is gitignored and is
  **not** required to build, run, or deploy SubNation.
