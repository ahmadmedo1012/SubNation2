#!/usr/bin/env bash
# =============================================================================
# SubNation — production secret generation (R112 §13)
# =============================================================================
# Generates cryptographically secure values for every secret the production
# stack consumes, with the correct length/shape each consumer validates at
# boot. Output is clearly labelled VALUES ONLY — pipe it into your password
# manager or the Coolify env screens; nothing is written to disk, nothing is
# uploaded, nothing is committed.
#
# WHAT IT GENERATES (and the rule each value must satisfy):
#   SESSION_SECRET          ≥32 chars  (backend/src/lib/jwt.ts boot assert)
#   ENCRYPTION_KEY          EXACTLY 64 hex chars = 32 bytes
#                           (backend/src/lib/encryption.ts length assert)
#   ADMIN_JWT_SECRET        ≥32 chars, MUST differ from SESSION_SECRET
#                           (F-001 separate admin signing secret)
#   OPENWA_API_KEY          ≥32 chars  (gateway auth; SubNation sends it as
#                           WHATSAPP_OTP_API_KEY — MUST be the SAME value)
#   OPENWA_CREDENTIALS_KEY  ≥32 chars, MUST differ from OPENWA_API_KEY
#                           (openwa persist.ts: session-credential encryption;
#                           only the FIRST rotation is transparent — generate
#                           ONCE and keep it in the offline backup)
#   OTP_HMAC_KEY            only when OTP_HMAC_KEY_EXPLICIT=1 (the app derives
#                           the OTP HMAC key from SESSION_SECRET —
#                           HMAC(SESSION_SECRET, "whatsapp-otp-v1"),
#                           whatsapp-otp.service.ts A8-07 — by default)
#   DASHBOARD_SESSION_SECRET only when DASHBOARD_ENABLED=1 (openwa dashboard)
#
# SAFETY CONTRACT:
#   - reads /dev/urandom via openssl rand (CSPRNG)
#   - NEVER rotates existing production secrets automatically
#   - NEVER writes to the repository, NEVER touches a remote service
#   - output contains ONLY the generated values with their names
#
# Usage:
#   ./scripts/generate-production-secrets.sh                    # core five
#   OTP_HMAC_KEY_EXPLICIT=1 ./scripts/generate-production-secrets.sh
#   DASHBOARD_ENABLED=1 ./scripts/generate-production-secrets.sh
#   ALL=1 ./scripts/generate-production-secrets.sh              # every knob
# =============================================================================
set -euo pipefail

need() { command -v "$1" >/dev/null 2>&1 || { echo "✗ $1 is required (install openssl)" >&2; exit 1; }; }
need openssl

ALL="${ALL:-}"
if [[ "$ALL" == "1" ]]; then
  OTP_HMAC_KEY_EXPLICIT=1
  DASHBOARD_ENABLED=1
fi

# ≥32-char secrets: 48 random bytes → 96 hex chars (uniform charset, no
# base64 punctuation that some env screens mangle).
hex32plus() { openssl rand -hex 48; }          # 96 hex chars
hex64()     { openssl rand -hex 32; }          # exactly 64 hex chars

SESSION_SECRET="$(hex32plus)"
ENCRYPTION_KEY="$(hex64)"
ADMIN_JWT_SECRET="$(hex32plus)"
OPENWA_API_KEY="$(hex32plus)"
OPENWA_CREDENTIALS_KEY="$(hex32plus)"

# Defensive shape guards — these mirror the boot-time validators exactly.
[[ ${#SESSION_SECRET} -ge 32 ]]         || { echo "✗ internal: SESSION_SECRET too short" >&2; exit 1; }
[[ ${#ENCRYPTION_KEY} -eq 64 ]]         || { echo "✗ internal: ENCRYPTION_KEY not 64 hex" >&2; exit 1; }
[[ ${#ADMIN_JWT_SECRET} -ge 32 ]]       || { echo "✗ internal: ADMIN_JWT_SECRET too short" >&2; exit 1; }
[[ "$ADMIN_JWT_SECRET" != "$SESSION_SECRET" ]] || { echo "✗ internal: ADMIN_JWT_SECRET == SESSION_SECRET" >&2; exit 1; }
[[ ${#OPENWA_API_KEY} -ge 32 ]]         || { echo "✗ internal: OPENWA_API_KEY too short" >&2; exit 1; }
[[ "$OPENWA_CREDENTIALS_KEY" != "$OPENWA_API_KEY" ]] || { echo "✗ internal: CREDENTIALS_KEY == API_KEY" >&2; exit 1; }
[[ "$SESSION_SECRET" != "$ENCRYPTION_KEY" ]] || { echo "✗ internal: SESSION == ENCRYPTION" >&2; exit 1; }
[[ "$ADMIN_JWT_SECRET" != "$ENCRYPTION_KEY" ]] || { echo "✗ internal: ADMIN_JWT == ENCRYPTION" >&2; exit 1; }

cat <<EOF
# ─────────────────────────────────────────────────────────────────────────────
# SubNation production secrets — generated $(date -u +%Y-%m-%dT%H:%M:%SZ)
# Copy each value into its service. NEVER commit, NEVER paste into chat.
# Where each value goes (see docs/deployment/SECRET_HANDLING_FINAL.md):
#   SESSION_SECRET         → SubNation runtime env
#   ENCRYPTION_KEY         → SubNation runtime env
#   ADMIN_JWT_SECRET       → SubNation runtime env
#   OPENWA_API_KEY         → openwa service env  AND  SubNation env as
#                            WHATSAPP_OTP_API_KEY (identical value!)
#   OPENWA_CREDENTIALS_KEY → openwa service env (MUST differ from API key)
# ─────────────────────────────────────────────────────────────────────────────
SESSION_SECRET=$SESSION_SECRET
ENCRYPTION_KEY=$ENCRYPTION_KEY
ADMIN_JWT_SECRET=$ADMIN_JWT_SECRET
OPENWA_API_KEY=$OPENWA_API_KEY
WHATSAPP_OTP_API_KEY=$OPENWA_API_KEY
OPENWA_CREDENTIALS_KEY=$OPENWA_CREDENTIALS_KEY
EOF

if [[ "${OTP_HMAC_KEY_EXPLICIT:-0}" == "1" ]]; then
  echo "# only set OTP_HMAC_KEY if you intentionally override the ENCRYPTION_KEY-derived default:"
  echo "OTP_HMAC_KEY=$(hex64)"
fi
if [[ "${DASHBOARD_ENABLED:-0}" == "1" ]]; then
  echo ""
  echo "# openwa operator dashboard (optional — leave unset to disable):"
  echo "DASHBOARD_USERNAME=admin"
  echo "DASHBOARD_PASSWORD=$(openssl rand -base64 18 | tr -d '\n/+=' | cut -c1-20)"
  echo "DASHBOARD_SESSION_SECRET=$(hex32plus)"
fi

cat <<'EOF'

# NEXT STEPS:
#   1. Store these in your password manager + the encrypted offline backup
#      (docs/deployment/SECRET_HANDLING_FINAL.md §offline backup).
#   2. Fill .env on the VM / Coolify env screens from the stored copy.
#   3. Verify shapes: tsx scripts/src/validate-production-env.ts --file .env --strict
#   4. This script does NOT rotate anything that already exists in production.
EOF
