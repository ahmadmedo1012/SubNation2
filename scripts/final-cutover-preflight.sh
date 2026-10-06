#!/usr/bin/env bash
# =============================================================================
# SubNation — FINAL CUTOVER PRE-FLIGHT (R112 §7)
# =============================================================================
# Everything that can be validated BEFORE the DNS cutover, in one script.
# Run it on the production VM (originally the Oracle VM; live host since
# 2026-10 = a Contabo VM, per the R117 live probe — or anywhere Docker +
# the repo + .env exist) after Coolify brings the stack up but BEFORE you
# touch Cloudflare.
#
# Sections:
#   A. architecture / Docker / Compose / binaries
#   B. environment variables + secret shapes (values NEVER printed)
#   C. origin consistency + single-instance contract
#   D. port policy (nothing public except 80/443/22)
#   E. database URL shape + migration status (live)
#   F. image / build / git SHA (release identity)
#   G. Cloudflare input format
#   H. backup prerequisites
#   I. OpenWA gateway health (r113: production OTP dependency — never a
#      silent skip; see the gate's three-way verdict)
#
# Usage:
#   ./scripts/final-cutover-preflight.sh [ENV_FILE]
#     ENV_FILE defaults to ./.env next to the repo root.
#
# Exit codes: 0 = PREFLIGHT CLEAR (cutover-ready from this machine's view) ·
#             1 = BLOCKER(s) found · 64 = usage error
#
# SECRECY CONTRACT: no variable VALUE is ever printed. Checks report
# presence, length, boolean shape, or scheme/host-class only — the same
# policy as scripts/src/validate-production-env.ts.
# =============================================================================
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${1:-}"
FAILURES=0
SKIPS=0
ok()   { printf '\033[1;32m   ✓ %s\033[0m\n' "$1"; }
bad()  { printf '\033[1;31m   ✗ %s\033[0m\n' "$1"; FAILURES=$((FAILURES+1)); }
warn() { printf '\033[1;33m   ⚠ %s\033[0m\n' "$1"; }
inf()  { printf '\033[1;36m   ℹ %s\033[0m\n' "$1"; }
skip() { printf '\033[1;33m   ↷ %s\033[0m\n' "$1"; SKIPS=$((SKIPS+1)); }
step() { printf '\n\033[1;36m== %s ==\033[0m\n' "$1"; }

[ -n "$ENV_FILE" ] || [ -f "$ROOT_DIR/.env" ] && ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"

# ═══════════════════════════════════════════════════════════════════════════
step "A. machine: architecture / docker / compose / binaries"
ARCH="$(uname -m)"
case "$ARCH" in
  # (R119, audit A7-F9) Contabo-era truth: the live production host since
  # 2026-10 is a Contabo x86_64 VM (R117 live probe; the original target
  # was Oracle Ampere A1 ARM64). BOTH arches are supported — the images
  # are multi-arch; docker-verify.sh --arm64 proves the ARM64 cross-build.
  x86_64)        ok "architecture: ${ARCH} (Contabo VM — the live production shape since 2026-10)" ;;
  aarch64|arm64) ok "architecture: ${ARCH} (ARM64 — the original Oracle Ampere A1 target; supported multi-arch insurance)" ;;
  *)             bad "architecture: ${ARCH} — unsupported for production" ;;
esac
if command -v docker >/dev/null 2>&1; then
  ok "docker: $(docker --version | head -c 60)"
  if docker info >/dev/null 2>&1; then ok "docker daemon reachable"; else bad "docker daemon NOT reachable (is the user in the docker group?)"; fi
else
  bad "docker not installed"
fi
if docker compose version >/dev/null 2>&1; then
  ok "docker compose: $(docker compose version | head -c 60)"
else
  bad "docker compose plugin missing"
fi
for bin in curl git openssl; do
  command -v "$bin" >/dev/null 2>&1 && ok "${bin} present" || bad "${bin} missing"
done
command -v pg_dump >/dev/null 2>&1 \
  && ok "pg_dump present ($(pg_dump --version 2>/dev/null | head -c 40)) — needed for backups" \
  || warn "pg_dump missing — apt install postgresql-client-17 (Neon runs PG 17)"

# ═══════════════════════════════════════════════════════════════════════════
step "B. environment: required variables + secret shapes (values never printed)"
if [ -n "${ENV_FILE:-}" ] && [ -f "$ENV_FILE" ]; then
  inf "loading: $ENV_FILE (KEY=VALUE pairs, values never printed)"
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|\#*) continue ;; *=*) ;; *) continue ;; esac
    key=${line%%=*}; value=${line#*=}
    case "$key" in ''|*[!A-Za-z0-9_]*|[0-9]*|PATH) continue ;; esac
    case "$value" in '"'*'"') value=${value#\"}; value=${value%\"} ;; "'"*"'") value=${value#\'}; value=${value%\'} ;; esac
    case "$key" in
      # never re-export a shell-hazardous var wholesale; only the known set
      DATABASE_URL|SESSION_SECRET|ENCRYPTION_KEY|ADMIN_JWT_SECRET|APP_URL|APP_ORIGINS|APP_ORIGIN|AUTH_COOKIE_SAMESITE|SINGLE_INSTANCE_MODE|DISABLE_WEB_SCHEDULERS|DISABLE_BOOT_MIGRATIONS|WHATSAPP_OTP_BASE_URL|WHATSAPP_OTP_API_KEY|WHATSAPP_OTP_SESSION|WHATSAPP_OTP_AUTO_CREATE_SESSION|OPENWA_API_KEY|OPENWA_CREDENTIALS_KEY|PERSISTENCE_URL|ALERTING_ENABLED|SUBNATION_HOST_PORT|OPENWA_HOST_PORT)
        export "$key=$value" ;;
    esac
  done <"$ENV_FILE"
else
  inf "no env file — checking the current environment only"
fi

req_var() { # name min_len
  local v="${!1:-}"
  if [ -z "$v" ]; then bad "$1 is not set"; return 1; fi
  if [ "${#v}" -lt "$2" ]; then bad "$1 is shorter than ${2} chars (got ${#v})"; return 1; fi
  ok "$1 set (len ${#v})"; return 0
}
req_var SESSION_SECRET 32
req_var ADMIN_JWT_SECRET 32
if [ -n "${SESSION_SECRET:-}" ] && [ -n "${ADMIN_JWT_SECRET:-}" ]; then
  [ "$SESSION_SECRET" != "$ADMIN_JWT_SECRET" ] && ok "ADMIN_JWT_SECRET differs from SESSION_SECRET" \
    || bad "ADMIN_JWT_SECRET == SESSION_SECRET (F-001 requires separation)"
fi
if [ -n "${ENCRYPTION_KEY:-}" ]; then
  if [[ "$ENCRYPTION_KEY" =~ ^[a-f0-9]{64}$ ]]; then
    ok "ENCRYPTION_KEY is exactly 64 hex chars"
  else
    bad "ENCRYPTION_KEY is NOT 64 lowercase hex chars (got len ${#ENCRYPTION_KEY})"
  fi
else
  bad "ENCRYPTION_KEY is not set"
fi
# gateway key equality contract
if [ -n "${WHATSAPP_OTP_API_KEY:-}" ] && [ -n "${OPENWA_API_KEY:-}" ]; then
  [ "$WHATSAPP_OTP_API_KEY" = "$OPENWA_API_KEY" ] \
    && ok "WHATSAPP_OTP_API_KEY == OPENWA_API_KEY (gateway auth contract)" \
    || bad "WHATSAPP_OTP_API_KEY != OPENWA_API_KEY — every OTP request would be rejected"
else
  bad "OPENWA_API_KEY / WHATSAPP_OTP_API_KEY not both set"
fi
if [ -n "${OPENWA_CREDENTIALS_KEY:-}" ] && [ -n "${OPENWA_API_KEY:-}" ]; then
  [ "$OPENWA_CREDENTIALS_KEY" != "$OPENWA_API_KEY" ] \
    && ok "OPENWA_CREDENTIALS_KEY differs from OPENWA_API_KEY (separation contract)" \
    || bad "OPENWA_CREDENTIALS_KEY == OPENWA_API_KEY (must differ — persist.ts key separation)"
fi
for v in DATABASE_URL PERSISTENCE_URL; do
  val="${!v:-}"
  if [ -z "$val" ]; then bad "$v is not set"; continue; fi
  case "$val" in
    postgres://*|postgresql://*) ;;
    *) bad "$v is not a postgres URL (shape only checked)"; continue ;;
  esac
  case "$val" in
    *sslmode=require*|*sslmode=verify-full*) ok "$v: postgres scheme + sslmode enforced" ;;
    *) bad "$v lacks sslmode=require" ;;
  esac
done

# ═══════════════════════════════════════════════════════════════════════════
step "C. origins + single-instance contract"
APP_URL="${APP_URL:-}"
APP_ORIGINS="${APP_ORIGINS:-}"
APP_ORIGIN="${APP_ORIGIN:-}"
if [ -n "$APP_URL" ]; then
  ok "APP_URL set (scheme+host: $(printf '%s' "$APP_URL" | sed -E 's#(https?://[^/]+).*#\1#'))"
else
  bad "APP_URL is not set (canonical production domain)"
fi
if [ -n "$APP_ORIGINS" ] && [ -n "$APP_URL" ]; then
  case ",$APP_ORIGINS," in
    *",$APP_URL,"*|*",$APP_URL,"*) ok "APP_URL is inside APP_ORIGINS" ;;
    *) bad "APP_URL not found in APP_ORIGINS (CORS/CSRF/Socket.IO allow-list would reject the canonical origin)" ;;
  esac
else
  bad "APP_ORIGINS is not set"
fi
[ -n "$APP_ORIGIN" ] && ok "APP_ORIGIN set (admin alert deep links)" || warn "APP_ORIGIN unset — defaults to APP_URL at runtime"
case "${AUTH_COOKIE_SAMESITE:-lax}" in
  lax) ok "AUTH_COOKIE_SAMESITE=lax (single-origin contract)" ;;
  none) bad "AUTH_COOKIE_SAMESITE=none — weakens cookies on a single-origin deployment (the #1 migration trap)" ;;
  *)    warn "AUTH_COOKIE_SAMESITE=${AUTH_COOKIE_SAMESITE}" ;;
esac
case "${SINGLE_INSTANCE_MODE:-}" in
  true) ok "SINGLE_INSTANCE_MODE=true (no leader election, no lease heartbeat, zero periodic Neon coordination queries)" ;;
  *)    bad "SINGLE_INSTANCE_MODE is NOT true (r108 production contract: the Neon-killer lease heartbeat stays disabled only in this mode)" ;;
esac
case "${DISABLE_WEB_SCHEDULERS:-}" in
  false|"") ok "DISABLE_WEB_SCHEDULERS=false/empty (schedulers run — required: no dedicated worker exists)" ;;
  *)    bad "DISABLE_WEB_SCHEDULERS=true would kill every cron with NO dedicated worker running" ;;
esac
case "${DISABLE_BOOT_MIGRATIONS:-false}" in
  false) ok "DISABLE_BOOT_MIGRATIONS=false (migrations apply at boot)" ;;
  *)    bad "DISABLE_BOOT_MIGRATIONS=true — emergency-only escape hatch, not for cutover" ;;
esac

# ═══════════════════════════════════════════════════════════════════════════
step "D. port policy"
SUBNATION_HOST_PORT="${SUBNATION_HOST_PORT:-127.0.0.1:3000}"
OPENWA_HOST_PORT="${OPENWA_HOST_PORT:-127.0.0.1:3001}"
for pair in "subnation:$SUBNATION_HOST_PORT" "openwa:$OPENWA_HOST_PORT"; do
  name="${pair%%:*}"; bind="${pair#*:}"
  case "$bind" in
    127.0.0.1:*|localhost:*) ok "${name} host bind is loopback-only (${bind%%:*})" ;;
    "") ok "${name} host bind empty (Coolify-internal — nothing published)" ;;
    *) bad "${name} host bind '${bind}' is NOT loopback — app ports must never be public (Cloudflare→Traefik owns 80/443)" ;;
  esac
done
# live firewall sanity (best effort)
if command -v iptables >/dev/null 2>&1; then
  if iptables -L INPUT -n >/dev/null 2>&1; then
    inf "iptables INPUT policy: $(iptables -L INPUT -n | head -1 | awk '{print $NF}') — enforce the FINAL contract: PUBLIC 22/80/443, nothing else (see docs/deployment/ORACLE_FINAL_SETUP.md §firewall)"
  else
    skip "iptables not readable without root — verify the port contract manually"
  fi
fi

# ═══════════════════════════════════════════════════════════════════════════
step "E. database: URL shape + live migration status"
# The authoritative migration check is the boot itself: docker-verify.sh gate
# 3 boots the container and requires /api/healthz 503→200 (the readiness gate
# opens only after bootMigrations() finishes). This preflight stays read-only
# here; a second SQL-level check would duplicate that gate without adding
# authority.
if [ -n "${DATABASE_URL:-}" ]; then
  ok "DATABASE_URL present (shape verified in section B)"
  inf "migration status is proven by docker-verify.sh gate 3 (boot → healthz 503→200) — run it right after this preflight"
  inf "reminder: r111 T3 proved 4 non-destructive migrations pend the first r112 boot (V1-M20 FK drop is mandatory before the FIRST topup)"
else
  bad "DATABASE_URL not set — nothing to check"
fi

# ═══════════════════════════════════════════════════════════════════════════
step "F. release identity: git SHA + image"
GIT_SHA="$(cd "$ROOT_DIR" && git rev-parse --short HEAD 2>/dev/null || echo '')"
if [ -n "$GIT_SHA" ]; then
  DIRTY="$(cd "$ROOT_DIR" && git status --porcelain | head -1)"
  [ -z "$DIRTY" ] && ok "git HEAD: ${GIT_SHA} (clean tree)" || warn "git HEAD: ${GIT_SHA} — working tree has local changes (release identity is ambiguous until committed)"
else
  warn "not a git checkout (Coolify builder context) — the deployed image tag IS the release identity; verify it in Coolify"
fi
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  if docker image inspect ghcr.io/ahmadmedo1012/subnation2:sha-"$GIT_SHA" >/dev/null 2>&1; then
    ok "GHCR image for ${GIT_SHA} present locally"
  else
    inf "no local sha-<short> image for ${GIT_SHA} — fine when Coolify builds from Git (the build log is the record); use the GHCR fallback only in emergencies"
  fi
  RUNNING="$(docker ps --format '{{.Image}}' 2>/dev/null | head -5)"
  [ -n "$RUNNING" ] && inf "running images: $(echo "$RUNNING" | tr '\n' ' ' | head -c 120)" || inf "no containers running yet (start the stack, then re-run)"
fi

# ═══════════════════════════════════════════════════════════════════════════
step "G. Cloudflare input format"
CLOUDFLARE_IP="${CLOUDFLARE_TARGET_IP:-}"
if [ -n "$CLOUDFLARE_IP" ]; then
  [[ "$CLOUDFLARE_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] \
    && ok "CLOUDFLARE_TARGET_IP is an IPv4 literal" \
    || bad "CLOUDFLARE_TARGET_IP is not an IPv4 literal"
else
  inf "CLOUDFLARE_TARGET_IP env not set — the operator supplies the VM IP at cutover time (docs/deployment/CLOUDFLARE_FINAL_CUTOVER.md)"
  inf "DNS stays an OPERATOR action: this stack never touches the Cloudflare API automatically"
fi

# ═══════════════════════════════════════════════════════════════════════════
step "H. backup prerequisites"
if [ -x "$ROOT_DIR/scripts/backup-preflight.sh" ]; then
  set +e
  BP_OUT="$("$ROOT_DIR/scripts/backup-preflight.sh" "${ENV_FILE:-}" 2>&1)"
  BP_RC=$?
  set -e
  printf '%s\n' "$BP_OUT" | sed 's/^/     /'
  if [ "$BP_RC" -eq 0 ]; then
    ok "backup preflight CLEAR (backup-preflight.sh exit 0)"
  else
    bad "backup preflight reported blocker(s) — fix before cutover"
  fi
else
  bad "scripts/backup-preflight.sh missing from this checkout"
fi

# ═══════════════════════════════════════════════════════════════════════════
step "I. OpenWA gateway health (the production OTP dependency)"
# r113 (§7): a production cutover REQUIRES a healthy OpenWA — a generic/local
# run (stack deliberately not up yet) may skip, but only LOUDLY, and the
# final summary restates the verdict. Three-way outcome, never silent:
#   PASSED  — an openwa container reports (healthy), or the compose loopback
#             port answers /healthz 200
#   FAILED  — the gateway exists on this host but is down/unhealthy
#   SKIPPED — no openwa container and no listener: the stack is not up HERE
OPENWA_VERDICT="SKIPPED"
OPENWA_CONTAINERS=""
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  OPENWA_CONTAINERS="$(docker ps -a --format '{{.Names}}|{{.Status}}' 2>/dev/null | grep -i openwa || true)"
fi
if [ -n "$OPENWA_CONTAINERS" ]; then
  inf "openwa container(s) on this host:"
  printf '%s\n' "$OPENWA_CONTAINERS" | sed 's/^/     /'
  OWA_HEALTHY=0; OWA_RUNNING=0; OWA_DOWN=0
  printf '%s\n' "$OPENWA_CONTAINERS" | while IFS='|' read -r cname cstatus; do
    [ -n "$cname" ] || continue
    case "$cstatus" in
      Up*"(healthy)") printf '%s\n' "healthy|$cname" ;;
      Up*)            printf '%s\n' "running|$cname" ;;
      *)              printf '%s\n' "down|$cname|$cstatus" ;;
    esac
  done > /tmp/.preflight-openwa.$$
  while IFS='|' read -r state cname extra; do
    case "$state" in
      healthy) OWA_HEALTHY=$((OWA_HEALTHY+1)) ;;
      running) OWA_RUNNING=$((OWA_RUNNING+1)) ;;
      down)    bad "openwa container '$cname' is NOT running: $extra" ;;
    esac
  done </tmp/.preflight-openwa.$$
  rm -f /tmp/.preflight-openwa.$$
  if [ "$OWA_HEALTHY" -ge 1 ]; then
    ok "OpenWA gate PASSED — container reports (healthy) (image HEALTHCHECK probes /healthz)"
    OPENWA_VERDICT="PASSED"
  elif [ "$OWA_RUNNING" -ge 1 ]; then
    # up, but the 30s-interval HEALTHCHECK has not reported yet — inspect once
    OWA_NAME="$(printf '%s\n' "$OPENWA_CONTAINERS" | head -1 | cut -d'|' -f1)"
    OWA_STATE="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$OWA_NAME" 2>/dev/null || echo '?')"
    if [ "$OWA_STATE" = "healthy" ]; then
      ok "OpenWA gate PASSED — docker health state: healthy"
      OPENWA_VERDICT="PASSED"
    else
      bad "OpenWA gate FAILED — container up but docker health state: ${OWA_STATE} (may still be in start_period — re-run in a minute; if it stays unhealthy: docker logs ${OWA_NAME})"
      OPENWA_VERDICT="FAILED"
    fi
  else
    bad "OpenWA gate FAILED — every openwa container on this host is down"
    OPENWA_VERDICT="FAILED"
  fi
else
  # no container — try the compose-published loopback port (127.0.0.1:3001)
  OPENWA_PORT_PROBE="http://127.0.0.1:${OPENWA_VERIFY_PORT:-3001}/healthz"
  OWA_RC=0
  OWA_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$OPENWA_PORT_PROBE")" || OWA_RC=$?
  if [ "$OWA_RC" = "0" ] && [ "$OWA_CODE" = "200" ]; then
    ok "OpenWA gate PASSED — $OPENWA_PORT_PROBE answered 200"
    OPENWA_VERDICT="PASSED"
  elif [ "$OWA_RC" = "7" ]; then
    skip "OpenWA gate SKIPPED — no openwa container on this host and nothing listening on $OPENWA_PORT_PROBE (stack not up HERE)"
    warn "A PRODUCTION cutover run must show this gate as PASSED — bring the Coolify stack up and re-run before touching DNS"
  else
    bad "OpenWA gate FAILED — something listens on $OPENWA_PORT_PROBE but answers HTTP ${OWA_CODE:-none} (curl rc ${OWA_RC})"
    OPENWA_VERDICT="FAILED"
  fi
fi

# ═══════════════════════════════════════════════════════════════════════════
printf '\n'
if [ "$FAILURES" -eq 0 ] && [ "$OPENWA_VERDICT" = "PASSED" ]; then
  printf '\033[1;32mPREFLIGHT CLEAR (OpenWA: PASSED)\033[0m — %d skipped (informational). Next: docker-verify.sh, private smoke test, then the operator DNS cutover.\n' "$SKIPS"
  exit 0
fi
if [ "$FAILURES" -eq 0 ]; then
  printf '\033[1;33mPREFLIGHT CLEAR WITH OPENWA SKIPPED\033[0m — %d skipped (informational). OpenWA was NOT verified (stack not up on this machine): this is acceptable for an early environment check ONLY.\n' "$SKIPS"
  printf 'A production cutover run must end with: PREFLIGHT CLEAR (OpenWA: PASSED).\n'
  exit 0
fi
printf '\033[1;31mPREFLIGHT: %s BLOCKER(S)\033[0m — resolve every red line above before the DNS cutover.\n' "$FAILURES"
exit 1
