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
- 🔒 Hardened security — Helmet/CSP, CORS allow-list, CSRF checks, multi-tier Redis rate-limiting, admin 2FA.

---

## Tech stack

| Layer            | Technology                                                                            |
| ---------------- | ------------------------------------------------------------------------------------- |
| Frontend         | React 19, Vite, Tailwind CSS, wouter, TanStack Query (RTL, Arabic)                    |
| Backend          | Express 5, TypeScript, Socket.IO                                                      |
| Database         | PostgreSQL (Neon) via Drizzle ORM                                                     |
| Cache / realtime | Redis (rate-limit, leader-lock, socket adapter)                                       |
| Auth             | Firebase Admin (Google), Telegram HMAC, WhatsApp OTP (OpenWA), JWT + httpOnly cookies |
| Validation       | Zod (shared contracts)                                                                |
| Observability    | Sentry, Prometheus (`prom-client`), Pino                                              |
| Deploy           | Render (Docker): web + worker + Redis                                                 |

It is a **pnpm monorepo**:

```
frontend/   Vite + React + Tailwind SPA (Arabic RTL)
backend/    Express API, auth, jobs, migrations; serves the built frontend
shared/     db (Drizzle schema) · api-zod (validation) · api-client-react (hooks) · api-spec (OpenAPI)
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

### Render (production)

Deployed via Docker from `render.yaml` (web + worker + Redis). Push to `main`
to auto-deploy; secrets are set in the Render dashboard (`sync: false`).

---

## Configuration

All runtime config flows through a single `.env` file — copy `config/env.example`
and edit. You should never need to change code to switch host, port, or domain.
Most important keys:

| Key                              | Purpose                                                                      |
| -------------------------------- | ---------------------------------------------------------------------------- |
| `DATABASE_URL`                   | Postgres connection string (**required**)                                    |
| `SESSION_SECRET`                 | JWT signing secret (**required in prod**, ≥ 32 chars)                        |
| `ENCRYPTION_KEY`                 | AES-256-GCM key (64 hex chars) for inventory credentials                     |
| `REDIS_URL`                      | Redis connection (required in prod; in-memory fallback in dev)               |
| `APP_URL` / `APP_ORIGINS`        | Public origin and CORS allow-list                                            |
| `FIREBASE_*` / `VITE_FIREBASE_*` | Enable Google Sign-In                                                        |
| `TELEGRAM_BOT_TOKEN`             | Operational notifications (Telegram **login** is configured in the admin UI) |
| `WHATSAPP_OTP_*`                 | OpenWA gateway for WhatsApp OTP                                              |

See `config/env.example` for the full annotated reference.

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

| Document                                                   | What it covers                                                                                                       |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **[`PROJECT_OVERVIEW.md`](./PROJECT_OVERVIEW.md)**         | 📌 Full project reference — architecture, features, defects, and add/remove/improve recommendations. **Start here.** |
| [`PLATFORM.md`](./PLATFORM.md)                             | Authoritative platform state, production-readiness scoring, and roadmap                                              |
| [`OPERATIONS_RUNBOOK.md`](./OPERATIONS_RUNBOOK.md)         | On-call playbook: alert triage, dashboards, rollback, scaling                                                        |
| [`docs/DISASTER_RECOVERY.md`](./docs/DISASTER_RECOVERY.md) | Backup/restore and incident recovery                                                                                 |
| [`docs/API.md`](./docs/API.md)                             | API reference                                                                                                        |

---

## Notes

- The `ruflo/` directory (optional multi-agent dev tooling) is gitignored and is
  **not** required to build, run, or deploy SubNation.
