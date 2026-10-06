#!/usr/bin/env bash
# =============================================================================
# SubNation — backup pre-flight (R112 §17)
# =============================================================================
# Runs BEFORE relying on the nightly backup (before DNS cutover, and after
# any host change). Validates everything the backup needs that can be
# checked cheaply and WITHOUT performing the backup itself:
#
#   1. pg_dump available on PATH (+ version vs server is checked at run time
#      by backup-db.ts — a major-version mismatch aborts with exit 1 and the
#      wrapper logs it)
#   2. DATABASE_URL available (from env or the env file) — shape only,
#      NEVER printed
#   3. backup write directory exists/writable + disk space headroom
#      (a compressed dump is tiny, but a full disk at 03:00 silently kills
#      cron; we want a LOUD failure now)
#   4. retention config sane (BACKUP_KEEP ≥ 1)
#   5. optional off-VM target: BACKUP_PRESIGNED_PUT_URL shape (https, host
#      present — value never printed)
#
# Usage (on the production VM — originally the Oracle VM; live host since
# 2026-10 = a Contabo VM, per the R117 live probe — root or the app user):
#   ./scripts/backup-preflight.sh [ENV_FILE]
#     ENV_FILE defaults to ./.env next to the repo root (same lookup order
#     as backup-cron.sh)
#
# Exit codes: 0 = preflight clear · 1 = blocker · 64 = usage error
# =============================================================================
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${1:-${ENV_FILE:-}}"
FAILURES=0
ok()   { printf '\033[1;32m   PASS: %s\033[0m\n' "$1"; }
bad()  { printf '\033[1;31m   FAIL: %s\033[0m\n' "$1"; FAILURES=$((FAILURES+1)); }
info() { printf '\033[1;36m   INFO: %s\033[0m\n' "$1"; }

if [ -z "$ENV_FILE" ] && [ -f "$ROOT_DIR/.env" ]; then ENV_FILE="$ROOT_DIR/.env"; fi

# ── 1. binaries ─────────────────────────────────────────────────────────────
printf '\n== binaries ==\n'
if command -v pg_dump >/dev/null 2>&1; then
  ok "pg_dump on PATH: $(pg_dump --version 2>/dev/null || echo present)"
else
  bad "pg_dump NOT on PATH — apt install postgresql-client (N.B. Neon runs PostgreSQL 17: install postgresql-client-17 or newer, or the dump aborts with a version mismatch)"
fi
if command -v pnpm >/dev/null 2>&1; then
  ok "pnpm on PATH: $(pnpm --version)"
else
  bad "pnpm NOT on PATH (cron's minimal PATH needs a PATH= line — see docs/DISASTER_RECOVERY.md)"
fi
command -v gzip >/dev/null 2>&1 && ok "gzip on PATH" || bad "gzip NOT on PATH"

# ── 2. DATABASE_URL presence + shape (value NEVER printed) ──────────────────
printf '\n== database ==\n'
if [ -n "$ENV_FILE" ] && [ -f "$ENV_FILE" ]; then
  info "loading env file (values never printed): $ENV_FILE"
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|\#*) continue ;; esac
    case "$line" in
      DATABASE_URL=*) export DATABASE_URL="${line#DATABASE_URL=}" ;;
      BACKUP_DIR=*)   export BACKUP_DIR="${line#BACKUP_DIR=}" ;;
      BACKUP_KEEP=*)  export BACKUP_KEEP="${line#BACKUP_KEEP=}" ;;
      BACKUP_PRESIGNED_PUT_URL=*) export BACKUP_PRESIGNED_PUT_URL="${line#BACKUP_PRESIGNED_PUT_URL=}" ;;
    esac
  done <"$ENV_FILE"
else
  info "no env file argument (using the current environment)"
fi

if [ -n "${DATABASE_URL:-}" ]; then
  case "$DATABASE_URL" in
    postgres://*|postgresql://*)
      case "$DATABASE_URL" in
        *sslmode=require*|*sslmode=verify-full*) ok "DATABASE_URL present, postgres scheme, sslmode enforced" ;;
        *) bad "DATABASE_URL present but WITHOUT sslmode=require (Neon rejects or downgrades TLS)" ;;
      esac
      ;;
    *) bad "DATABASE_URL is not a postgres:// / postgresql:// URL (shape only checked, value never printed)" ;;
  esac
else
  bad "DATABASE_URL not set (env or $ENV_FILE)"
fi

# ── 3. write directory + disk headroom ───────────────────────────────────────
printf '\n== storage ==\n'
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"
if mkdir -p "$BACKUP_DIR" 2>/dev/null && [ -w "$BACKUP_DIR" ]; then
  ok "backup dir writable: $BACKUP_DIR"
else
  bad "backup dir NOT writable: $BACKUP_DIR"
fi
if command -v df >/dev/null 2>&1; then
  AVAIL_MB=$(df -Pm "$BACKUP_DIR" 2>/dev/null | awk 'NR==2{print $4}' || echo 0)
  if [ "${AVAIL_MB:-0}" -ge 500 ]; then
    ok "disk headroom: ${AVAIL_MB} MB free on the backup volume (≥500 MB)"
  else
    bad "disk headroom low: ${AVAIL_MB:-?} MB free (need ≥500 MB)"
  fi
fi

# ── 4. retention ────────────────────────────────────────────────────────────
printf '\n== retention ==\n'
KEEP="${BACKUP_KEEP:-14}"
if [ "$KEEP" -ge 1 ] 2>/dev/null; then
  ok "BACKUP_KEEP=${KEEP} (retention bounded; only files matching subnation-<ISO>.sql.gz are ever pruned)"
else
  bad "BACKUP_KEEP='${KEEP}' is not a positive integer"
fi

# ── 5. optional off-VM target ────────────────────────────────────────────────
printf '\n== off-VM target (optional) ==\n'
if [ -n "${BACKUP_PRESIGNED_PUT_URL:-}" ]; then
  case "$BACKUP_PRESIGNED_PUT_URL" in
    https://*) ok "presigned PUT URL present (https; host never printed); NOTE: presigned URLs EXPIRE — generate fresh before the cutover-week run, or the artifact stays local-only with a warning" ;;
    http://*)  bad "presigned PUT URL uses plain http — secrets-in-transit risk; use https" ;;
    *)         bad "presigned PUT URL is not an http(s) URL" ;;
  esac
else
  info "BACKUP_PRESIGNED_PUT_URL unset — backups stay on-VM only. For the production VM set one (B2/R2/S3 presigned PUT) so a VM loss cannot lose the database."
fi

printf '\n'
if [ "$FAILURES" -eq 0 ]; then
  printf '\033[1;32mBACKUP PREFLIGHT CLEAR\033[0m — run one real backup now:\n'
  echo "  pnpm --filter @workspace/scripts run backup --keep $KEEP"
  echo "and confirm it ends with '✓ gzip integrity verified' + '✓ backup complete'."
  exit 0
fi
printf '\033[1;31mBACKUP PREFLIGHT: %s BLOCKER(S)\033[0m — fix above before relying on the nightly backup.\n' "$FAILURES"
exit 1
