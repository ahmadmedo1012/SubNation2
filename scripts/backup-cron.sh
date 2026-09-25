#!/usr/bin/env bash
# (r110) Host-level backup automation for the Oracle VM — the cron wrapper
# the operator installs so the nightly `pg_dump` actually runs (R109 §27 P1:
# the project had NO automated backup before cutover).
#
# Companion docs: docs/DISASTER_RECOVERY.md §"Automated backups".
# The app runtime image deliberately has no pg_dump — that's why backups run
# from the host crontab, not from the app's in-process cron (see the docs
# section for the full rationale).
#
# Usage:
#   backup-cron.sh <REPO_DIR> [ENV_FILE]
#
#     REPO_DIR  path to the SubNation2 checkout on this VM
#               (or the REPO_DIR env var)
#     ENV_FILE  KEY=VALUE file that defines DATABASE_URL and optionally
#               BACKUP_DIR / BACKUP_KEEP / BACKUP_PRESIGNED_PUT_URL /
#               BACKUP_CRON_LOG (or the ENV_FILE env var; default
#               <REPO_DIR>/.env when that file exists)
#
# What it does per run:
#   1. loads the env file WITHOUT sourcing it and WITHOUT printing values
#   2. runs the documented in-repo backup command
#      (`pnpm --filter @workspace/scripts run backup --keep <N>` — the same
#      `tsx scripts/src/backup-db.ts` that `pnpm run db:backup` resolves to)
#   3. appends ONE line (timestamp, exit code, artifact name, retention — no
#      secrets) to the ledger: $BACKUP_CRON_LOG, else /var/log/subnation-backup.log
#      when writable, else <REPO_DIR>/backups/backup-cron.log
#   4. propagates the backup's exit code so cron flags the failure
#
# Exit codes: the backup's own exit code (see scripts/src/backup-db.ts
# header), or 64 for wrapper usage errors, or 2 when DATABASE_URL is absent
# from the env file, or 69 when pnpm is not on PATH.
set -euo pipefail

REPO_DIR="${1:-${REPO_DIR:-}}"
ENV_FILE="${2:-${ENV_FILE:-}}"

if [ -z "$REPO_DIR" ]; then
  echo "✗ usage: backup-cron.sh <REPO_DIR> [ENV_FILE]" >&2
  exit 64
fi
if [ ! -f "$REPO_DIR/package.json" ] || [ ! -f "$REPO_DIR/pnpm-workspace.yaml" ]; then
  echo "✗ $REPO_DIR is not a SubNation2 checkout (missing package.json / pnpm-workspace.yaml)" >&2
  exit 64
fi
# canonicalize to an absolute path (crontab lines may be relative to $HOME)
REPO_DIR=$(cd "$REPO_DIR" && pwd)

if [ -z "$ENV_FILE" ]; then
  if [ -f "$REPO_DIR/.env" ]; then
    ENV_FILE="$REPO_DIR/.env"
  else
    echo "✗ no ENV_FILE argument and no $REPO_DIR/.env found." >&2
    echo "  Create one containing at least DATABASE_URL=... (see docs/DISASTER_RECOVERY.md §Automated backups)." >&2
    exit 64
  fi
fi
if [ ! -f "$ENV_FILE" ]; then
  echo "✗ env file not found: $ENV_FILE" >&2
  exit 64
fi

# (r110) Load KEY=VALUE pairs WITHOUT sourcing the file — compose-style .env
# values (spaces, $, backticks) are taken literally, and nothing is ever
# printed. PATH is deliberately not overridable from the env file.
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    '' | '#'*) continue ;;
    *=*)
      key=${line%%=*}
      value=${line#*=}
      case "$key" in
        '' | *[!A-Za-z0-9_]* | [0-9]* | PATH)
          echo "⚠ env file: skipping line with invalid/reserved key (key name only, value never printed)" >&2
          continue
          ;;
      esac
      # strip ONE pair of matching surrounding quotes, compose-style
      case "$value" in
        '"'*'"') value=${value#\"}; value=${value%\"} ;;
        "'"*"'") value=${value#\'}; value=${value%\'} ;;
      esac
      export "$key=$value"
      ;;
    *)
      echo "⚠ env file: skipping a non KEY=VALUE line (line content not printed)" >&2
      ;;
  esac
done <"$ENV_FILE"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "✗ DATABASE_URL is not defined in $ENV_FILE (value never printed)" >&2
  exit 2
fi
BACKUP_KEEP="${BACKUP_KEEP:-14}"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "✗ pnpm is not on PATH — cron's default PATH is minimal; add a PATH= line to the crontab (see docs/DISASTER_RECOVERY.md §Automated backups)" >&2
  exit 69
fi
# pre-flight only — backup-db.ts gives the definitive exit-3 error message
if ! command -v pg_dump >/dev/null 2>&1; then
  echo "⚠ pg_dump is not on PATH yet (apt install postgresql-client); the backup below will fail with exit 3 until it is" >&2
fi

echo "→ subnation backup started=$(date -u +%Y-%m-%dT%H:%M:%SZ) repo=$REPO_DIR keep=$BACKUP_KEEP"

# (r110) Same command the docs use (`pnpm run db:backup` at the repo root
# resolves to `pnpm --filter @workspace/scripts run backup`) — arguments
# after the script name are forwarded to backup-db.ts.
set +e
backup_output=$(cd "$REPO_DIR" && pnpm --filter @workspace/scripts run backup --keep "$BACKUP_KEEP" 2>&1)
backup_rc=$?
set -e
printf '%s\n' "$backup_output"

# the artifact name from the script's final completion line (never a secret)
backup_file=$(printf '%s\n' "$backup_output" | sed -n 's/^✓ backup complete: //p' | tail -n 1)
if [ -z "$backup_file" ]; then
  backup_file="-"
fi

LOG_FILE="${BACKUP_CRON_LOG:-}"
if [ -z "$LOG_FILE" ]; then
  if (umask 022; >>/var/log/subnation-backup.log) 2>/dev/null; then
    LOG_FILE="/var/log/subnation-backup.log"
  else
    mkdir -p "$REPO_DIR/backups"
    LOG_FILE="$REPO_DIR/backups/backup-cron.log"
  fi
fi

# (r110) one line per run, no secrets: timestamp, exit code, artifact, retention
printf '%s exit=%d file=%s keep=%s\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$backup_rc" "$backup_file" "$BACKUP_KEEP" >>"$LOG_FILE"
echo "→ result logged to $LOG_FILE"

exit "$backup_rc"
