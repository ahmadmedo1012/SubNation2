#!/usr/bin/env bash
# Remove local build/cache artifacts inside the repo (does not touch global pnpm store).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "== Disk (top-level) =="
du -sh . node_modules .git frontend backend shared 2>/dev/null || true

rm -rf \
  frontend/dist \
  frontend/node_modules/.vite \
  backend/dist \
  shared/db/dist \
  shared/api-zod/dist \
  shared/api-client-react/dist \
  scripts/dist \
  coverage \
  .turbo

find . -name "*.tsbuildinfo" -not -path "./node_modules/*" -delete 2>/dev/null || true

echo "== Done. Re-run: pnpm install && pnpm run build =="
