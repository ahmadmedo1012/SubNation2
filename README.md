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
