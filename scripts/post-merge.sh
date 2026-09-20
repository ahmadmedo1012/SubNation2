#!/bin/bash
set -e
pnpm install --frozen-lockfile
# Schema changes flow exclusively through backend boot migrations
# (backend/src/migrate.ts, idempotent). The boot runner coordinates
# concurrent instances with a Redis NX lock when Redis is provisioned;
# in the current no-Redis production it runs lock-free on the single
# web instance (safe by idempotence — see backend/src/lib/boot-migrations.ts).
# Scheduler leadership (heartbeat/alerting/crons), not migrations, uses
# the PG leader lease (backend/src/lib/pg-leader-lease.ts).
# `drizzle-kit
# push` was removed here — it could drift local schema away from that
# source of truth.
# pnpm --filter @workspace/db push
