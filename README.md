# SubNation

Arabic RTL digital subscriptions marketplace for Libya. The workspace is now organized as a local-first pnpm monorepo:

- `frontend/` - Vite + React + Tailwind application
- `backend/` - Express API, auth, jobs, migrations, and static frontend serving after build
- `shared/` - OpenAPI spec, generated clients, zod contracts, and Drizzle database package
- `scripts/` - local orchestration, seed, and maintenance scripts
- `config/` - environment examples and local configuration notes

## Requirements

- Node.js 22+
- pnpm 10+
- PostgreSQL database

## Development Tools

The `ruflo/` directory contains the Ruflo multi-agent AI orchestration framework (optional development tooling). It is gitignored and not required for SubNation2 application development or deployment.

## Setup

```bash
pnpm install
cp config/env.example .env
```

Edit `.env` and set `DATABASE_URL` before running the API. Optional port values are only preferences; the local runner automatically moves to the next open port when one is busy.

## Local Development

```bash
npm run dev
```

This starts the API and frontend together, chooses available ports, and configures the Vite `/api` proxy to the selected API port. You can also use `pnpm run dev`.

## Database

```bash
npm run db:push
npm run db:seed
```

`db:push` applies the Drizzle schema. `db:seed` creates the default admin and sample products using values from `.env` or `config/.env.local`.

## Build And Start

```bash
npm run build
npm start
```

The build validates TypeScript, builds the API, and builds the frontend into `frontend/dist/public`. `npm start` serves the compiled API and the built frontend from one automatically selected port.

## Main API Routes

- `GET /api/healthz`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/products`
- `POST /api/orders`
- `GET /api/wallet`
- `GET /api/admin/stats`

Generated frontend hooks live in `shared/api-client-react`; backend validation schemas live in `shared/api-zod`.

## Configuration

All runtime configuration flows through a single `.env` file. Copy
`config/env.example` to `.env` and edit the values. See that file for the
full annotated reference — the most important keys are:

| Key                                   | Purpose                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------ |
| `DATABASE_URL`                        | Postgres connection string (required).                                   |
| `SESSION_SECRET`                      | JWT signing secret (required in production).                             |
| `PORT` / `API_PORT` / `FRONTEND_PORT` | Preferred ports; runner auto-falls back to the next free port.           |
| `APP_URL` / `APP_ORIGINS`             | Public origin and CORS allow-list.                                       |
| `BASE_PATH`                           | Sub-path the SPA is served under (e.g. `/app/`).                         |
| `VITE_API_URL`                        | Absolute backend origin — only needed for split (frontend-only) deploys. |

You should not need to edit code to change hosts, ports or domains.

## Deployment

The backend already serves the built frontend on the same origin, so the
simplest deployment is a single Node process.

### Render (Production)

The project is deployed to Render using Docker:

1. Build: `pnpm run build`
2. Deploy: Push to main branch (auto-deploys via render.yaml)
3. Environment variables are configured in render.yaml

The application runs at https://subnation.ly

### Docker (any VPS / self-hosted)

```bash
cp config/env.example .env   # edit values
docker build -t subnation2 .
docker run -p 8080:8080 --env-file .env subnation2
```

Point `DATABASE_URL` at an external database if you prefer.

### VPS / bare metal

```bash
pnpm install --frozen-lockfile
pnpm run build
pnpm start                   # listens on $PORT (default 8080)
```

Run behind nginx / Caddy / a cloud load balancer. Nothing else has to change.
