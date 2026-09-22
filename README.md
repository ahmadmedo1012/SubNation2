<div align="center">

# SubNation

**Arabic-first (RTL) digital-subscriptions marketplace for the Libyan market.**

Streaming, music, gaming and productivity subscriptions — bought with an in-app
wallet and delivered instantly with encrypted account credentials.

[![Live](https://img.shields.io/badge/live-subnation.ly-22c55e)](https://subnation.ly)
[![Stack](https://img.shields.io/badge/stack-React_19_·_Express_5_·_Postgres-3b82f6)](#tech-stack)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-339933)](#requirements)
[![pnpm](https://img.shields.io/badge/pnpm-%E2%89%A510-f69220)](#requirements)

</div>

---

## What is this?

SubNation is a production e-commerce platform where customers in Libya buy
digital subscriptions (Netflix, Spotify, PlayStation, Adobe, Microsoft 365, …).
It is **passwordless** for customers — sign in with **Google**, **Telegram**, or
**WhatsApp OTP** — top up an internal **wallet**, and receive subscription
credentials instantly after purchase. A full **admin panel** manages products,
inventory, orders, wallet top-ups, coupons, loyalty, referrals and support.

> 🌐 **Live:** <https://subnation.ly>

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
  (Redis-backed when provisioned; in-process fallback in the current no-Redis production), admin 2FA.

---

## Tech stack

| Layer            | Technology                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Frontend         | React 19, Vite, Tailwind CSS, wouter, TanStack Query (RTL, Arabic)                                                              |
| Backend          | Express 5, TypeScript, Socket.IO                                                                                                |
| Database         | PostgreSQL (Neon) via Drizzle ORM                                                                                               |
| Cache / realtime | Redis — **optional, not provisioned today** (in-process rate-limit/cache/idempotency fallbacks; PG-lease scheduler leader lock) |
| Auth             | Firebase Admin (Google), Telegram HMAC, WhatsApp OTP (OpenWA), JWT + httpOnly cookies                                           |
| Validation       | Zod (shared contracts)                                                                                                          |
| Observability    | Sentry, Prometheus (`prom-client`), Pino                                                                                        |
| Deploy           | Render (Docker, free): single web service + Neon — no worker, no Redis (optional tiers in `OPERATIONS_RUNBOOK.md`)              |

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

pnpm run db:push                # apply the Drizzle schema
pnpm run db:seed                # create the default admin + sample products

pnpm run dev                    # starts API + frontend, auto-picks free ports
```

Open the printed local URL. Ports are only _preferences_ — the runner moves to
the next free port automatically and wires the Vite `/api` proxy for you.

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

### Self-hosted: Oracle Cloud + Coolify (target topology)

The platform is hosting-agnostic (no Render/Vercel runtime coupling — r107
audit) and runs as the two Docker images above behind Coolify on an Oracle
Always Free ARM64 VM, with Neon staying external. Full guide + runbook:
`docs/deployment/COOLIFY_ORACLE_MIGRATION.md` and
`docs/deployment/MIGRATION_RUNBOOK.md`; target architecture:
`docs/architecture/PRODUCTION_ARCHITECTURE.md`.

### Render (current production)

Services: a **single free-tier web service** (`subnation`, serves API + SPA) + a
separate **openwa-gateway** web service (WhatsApp OTP relay, built from the
`ahmadmedo1012/openwa` repo) + Neon Postgres. No worker and no Redis are
provisioned — both are optional documented tiers (`OPERATIONS_RUNBOOK.md` §5,
`render.yaml` header). Deploys to production happen ONLY after green
CI — `.github/workflows/deploy.yml` triggers the Render deploy hook via
`workflow_run` gated on the CI conclusion (`autoDeploy: false` on the
service). Secrets live in the Render dashboard (`sync: false`).

The free tier **sleeps by design** (removed 2026-09-20 — see
`docs/free-tier-optimization-2026-09-20.md`): no keep-alive, no self-ping, no
external pingers. A cold start surfaces as the backend's early-bind 503
"starting" answer, which the frontend `customFetch` retries transparently
(3 attempts, 1.5/3/5 s backoff, 45 s budget). The archived
`ahmadmedo1012/keep-alive` repo documents its own retirement and pings
nothing.

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
| `REDIS_URL`                      | Redis connection (**optional** — unset in current production; rate-limit/cache/idempotency degrade to in-process + PG-lease fallbacks) |
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
