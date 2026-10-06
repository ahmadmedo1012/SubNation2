#!/usr/bin/env bash
# =============================================================================
# SubNation — restore-drill validation (R112 §18)
# =============================================================================
# Given a SAFE, SCRATCH database URL (a database restored from a backup for
# drill purposes — NEVER production), validate that the restore is complete
# and business-critical data survived.
#
# THIS SCRIPT NEVER WRITES. It only runs read-only SQL. It deliberately
# refuses to run against the production database name to make
# "restore over production" impossible by construction:
#   - the URL's database part must contain "drill" or "scratch" or "restore"
#     (whichever naming you chose when creating the scratch DB)
#
# Usage (on the production VM — originally the Oracle VM; live host since
# 2026-10 = a Contabo VM, per the R117 live probe — after restoring a dump
# into a scratch database):
#   ./scripts/restore-drill-check.sh "postgresql://user:pass@host:5432/subnation_drill?sslmode=require"
#
# Exit codes: 0 = drill database validated · 1 = validation failed ·
#             64 = usage error (incl. a URL that looks like production)
# =============================================================================
set -euo pipefail
FAILURES=0
ok()  { printf '\033[1;32m   ✓ %s\033[0m\n' "$1"; }
bad() { printf '\033[1;31m   ✗ %s\033[0m\n' "$1"; FAILURES=$((FAILURES+1)); }
inf() { printf '\033[1;36m   ℹ %s\033[0m\n' "$1"; }

URL="${1:-}"
if [ -z "$URL" ]; then
  echo "usage: restore-drill-check.sh <SCRATCH_DATABASE_URL>" >&2
  echo "  The URL's database name must contain drill/scratch/restore." >&2
  exit 64
fi

# ── production-guard: refuse anything that is not an explicit scratch name ──
DBNAME="$(printf '%s' "$URL" | sed -E 's#^[^/]*//[^/]*/##; s#\?.*$##')"
case "$DBNAME" in
  *drill*|*scratch*|*restore*|*test*) : ;; # explicit scratch name — allowed
  *)
    echo "✗ REFUSING to run: database '${DBNAME}' does not look like a scratch/drill database." >&2
    echo "  Create a SEPARATE database for the drill (createdb subnation_drill) and restore into it." >&2
    echo "  Restoring over production is FORBIDDEN by docs/deployment/FINAL_RESTORE_DRILL.md." >&2
    exit 64
    ;;
esac
inf "target database: ${DBNAME} (scratch name accepted; URL value never printed)"

if ! command -v psql >/dev/null 2>&1; then
  echo "✗ psql is required on PATH (apt install postgresql-client)" >&2
  exit 64
fi

# psql runner (read-only queries; -A -t for clean scalar output)
scalar() {
  psql "$URL" -A -t -c "$1" 2>/dev/null || echo ""
}

printf '\n== schema ==\n'
TABLES="$(scalar "SELECT count(*) FROM pg_tables WHERE schemaname='public';")"
if [ "${TABLES:-0}" -ge 38 ] 2>/dev/null; then
  ok "public tables: ${TABLES} (expected ≥38)"
else
  bad "public tables: ${TABLES:-none} (expected ≥38 — restore incomplete?)"
fi

printf '\n== critical tables ==\n'
for t in users admin_users products product_variants inventory wallet_topups orders openwa_sessions; do
  N="$(scalar "SELECT count(*) FROM ${t};")"
  if [ -n "$N" ]; then
    ok "${t}: ${N} rows"
  else
    bad "${t}: MISSING or unreadable"
  fi
done

printf '\n== business data ==\n'
ACTIVE="$(scalar "SELECT count(*) FROM products WHERE is_active AND NOT is_archived;")"
ok_or_bad() { if [ "$2" = "1" ]; then ok "$1"; else bad "$1"; fi; }
[ -n "$ACTIVE" ] && [ "$ACTIVE" -gt 0 ] 2>/dev/null \
  && ok "ACTIVE products: ${ACTIVE} (r112 live baseline: 45)" \
  || bad "ACTIVE products: ${ACTIVE:-none} — catalog did not survive the restore"

ADMINS="$(scalar "SELECT count(*) FROM admin_users;")"
[ "${ADMINS:-0}" -ge 1 ] 2>/dev/null \
  && ok "admin_users: ${ADMINS} (operator account present)" \
  || bad "admin_users: ${ADMINS:-none} — no admin can log in after this restore"

DELIV="$(scalar "SELECT count(*) FROM inventory i JOIN products p ON p.id = i.product_id WHERE (i.account_email IS NOT NULL OR i.account_password IS NOT NULL) AND p.is_active AND NOT p.is_archived;")"
inf "deliverable units under ACTIVE products: ${DELIV:-?} (OPERATOR DATA — r112 live baseline: 1; restock is an operator action, never fabricated)"

# openwa_sessions presence (0 rows is EXPECTED when no session was linked at
# backup time — the requirement is that the TABLE exists and is queryable)
OWA="$(scalar "SELECT count(*) FROM openwa_sessions;")"
[ -n "$OWA" ] && ok "openwa_sessions queryable (${OWA} rows — 0 is expected if no session was linked at backup time)" \
  || bad "openwa_sessions not queryable"

printf '\n'
if [ "$FAILURES" -eq 0 ]; then
  printf '\033[1;32mRESTORE DRILL DATABASE VALIDATED\033[0m — record this run in docs/deployment/FINAL_RESTORE_DRILL.md and DROP the scratch database.\n'
  echo "  Drop it with: psql \"<admin url>\" -c 'DROP DATABASE ${DBNAME} WITH (FORCE);'"
  exit 0
fi
printf '\033[1;31mRESTORE DRILL: %s CHECK(S) FAILED\033[0m — do NOT trust backups from this configuration until fixed.\n' "$FAILURES"
exit 1
