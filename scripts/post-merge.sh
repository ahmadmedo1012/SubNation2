#!/bin/bash
set -e
pnpm install --frozen-lockfile
# Schema changes flow exclusively through backend boot migrations
# (backend/src/migrate.ts, idempotent, Redis-lock-protected). `drizzle-kit
# push` was removed here — it could drift local schema away from that
# source of truth.
# pnpm --filter @workspace/db push
