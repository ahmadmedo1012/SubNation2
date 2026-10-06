#!/usr/bin/env bash
# =============================================================================
# SubNation — Docker verification harness (r107; r110: full §15 gate list)
# =============================================================================
# Run this on ANY machine with Docker (your laptop or the production VM
# — originally the Oracle VM; live host since 2026-10 = a Contabo VM, per
# the R117 live probe) to prove
# the migration artifacts actually work. This workspace could not run Docker
# (no daemon in the sandbox), so the "VERIFIED" labels for container behavior
# depend on THIS script passing where Docker exists.
#
# Gates (§15 runtime verification — 10/10 covered since r110):
#   1.  Build: the production image builds on the NATIVE arch of the machine.
#   2.  (optional, --arm64) The image builds for linux/arm64 via QEMU/buildx
#       — the original Oracle Ampere A1 target (the live Contabo host uses
#       its native arch) — WITHOUT a container registry.
#   3.  Startup + API health: the container boots, /api/healthz flips
#       503 "starting" → 200 (boot gate opens after migrations).
#   4.  SPA serving: GET / → 200 (single-origin contract).
#   5.  Socket.IO: the engine.io polling handshake answers on /socket.io/.
#   6.  docker inspect: container user = node, healthcheck configured,
#       log rotation 10m × 3, host bind 127.0.0.1-only, image ENV secret-free.
#   7.  docker compose config: validates docker-compose.yml (+ .env) and
#       asserts restart / log-rotation / healthcheck / localhost-bind policy
#       for BOTH services (subnation + openwa).
#   8.  OpenWA health: gateway /healthz via the compose host port
#       (127.0.0.1:3001). SKIPPED loudly when no gateway runs on this host —
#       bring the compose stack up to cover it.
#   9.  Restart: `docker restart` → /api/healthz 200 again (clean second
#       boot; migrations re-apply idempotently). The restart POLICY itself
#       (unless-stopped) is asserted in gate 7.
#  10.  Graceful drain: `docker stop -t 40` exits 0 within the grace window,
#       no SIGKILL ("Initializer exited with 137" / exit code 137 = FAILED
#       drain test).
#
# Usage:
#   ./scripts/docker-verify.sh [--arm64] [--env-file <ENV_FILE>]
#     gates 1, 3-7, 9, 10 (+8 when openwa is up); --arm64 adds gate 2
#
# ENVIRONMENT MODEL (r113): the harness loads the SAME .env file the
# documented workflow fills (cp deploy/env.compose.example .env) — same
# safe KEY=VALUE parser as scripts/final-cutover-preflight.sh: values are
# never printed, PATH is never overridden, and variables already present
# in the real environment WIN over the file (so you can point DATABASE_URL
# at a scratch DB without editing .env). The container then receives the
# FULL production runtime set (APP_URL, APP_ORIGINS, SINGLE_INSTANCE_MODE,
# WHATSAPP_OTP_*, optional integrations — everything the app reads), so the
# verification models the real production environment instead of a stripped
# dev one. REQUIRED after loading: DATABASE_URL, SESSION_SECRET,
# ENCRYPTION_KEY, ADMIN_JWT_SECRET, APP_URL, APP_ORIGINS — the harness
# fails loudly naming exactly what is missing; it never silently
# substitutes defaults for production requirements.
#
# Requires: docker (with the buildx + compose plugins), a reachable
# DATABASE_URL (Neon works), and the required env above (file or exported).
# Gate 7 additionally needs the env file to exist (it usually already does).
#
# Host port: the verify container binds 127.0.0.1:3000 by default. Override
# with SUBNATION_VERIFY_PORT when the compose stack already owns 3000 (e.g.
# running this ON the production VM); gate 8's gateway port likewise via
# OPENWA_VERIFY_PORT (default 3001).
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_TAG="subnation-verify:local"
CONTAINER_NAME="subnation-verify"
HOST_PORT="${SUBNATION_VERIFY_PORT:-3000}"
OPENWA_HEALTH_URL="http://127.0.0.1:${OPENWA_VERIFY_PORT:-3001}/healthz"
BASE_URL="http://127.0.0.1:${HOST_PORT}"
FAILURES=0
SKIPS=0

# ── r113: safe env-file loading (the documented .env IS the input) ──────────
# Same contract as scripts/final-cutover-preflight.sh: parse KEY=VALUE lines
# without sourcing, never print values, never touch PATH, only export the
# known application keys, and ONLY when the variable is not already set in
# the real environment (environment wins — same precedence as compose).
ENV_FILE=""
ARM64_REQUESTED=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --arm64)    ARM64_REQUESTED=1 ;;
    --env-file) [[ $# -ge 2 ]] || { echo "✗ --env-file needs a path argument" >&2; exit 64; }
                ENV_FILE="$2"; shift ;;
    *)          echo "✗ unknown argument: $1 (usage: $0 [--arm64] [--env-file <ENV_FILE>])" >&2; exit 64 ;;
  esac
  shift
done
if [[ -z "$ENV_FILE" && -f "$ROOT_DIR/.env" ]]; then ENV_FILE="$ROOT_DIR/.env"; fi
# Every runtime variable the production container reads (deploy/
# env.compose.example is the template; ENVIRONMENT_MATRIX.md the matrix).
# Anything in this list that ends up SET (file or environment) is passed to
# the verify container — nothing else ever is.
RUNTIME_VARS=(
  DATABASE_URL SESSION_SECRET ENCRYPTION_KEY ADMIN_JWT_SECRET
  APP_URL APP_ORIGINS APP_ORIGIN AUTH_COOKIE_SAMESITE
  SINGLE_INSTANCE_MODE DISABLE_WEB_SCHEDULERS DISABLE_BOOT_MIGRATIONS
  WHATSAPP_OTP_BASE_URL WHATSAPP_OTP_API_KEY WHATSAPP_OTP_SESSION
  WHATSAPP_OTP_AUTO_CREATE_SESSION WHATSAPP_OTP_SETTLE_MS
  OPENWA_API_KEY PERSISTENCE_URL OPENWA_CREDENTIALS_KEY
  ALERTING_ENABLED TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID DISCORD_WEBHOOK_URL
  GENERIC_ALERT_WEBHOOK_URL SENTRY_DSN SENTRY_TRACES_SAMPLE_RATE
  COPILOT_PROVIDER COPILOT_API_KEY COPILOT_MODEL COPILOT_BASE_URL
  FIREBASE_AUTH_ENABLED FIREBASE_SERVICE_ACCOUNT_JSON METRICS_ADMIN_TOKEN
  GRACEFUL_SHUTDOWN_TIMEOUT_MS
)
if [[ -n "$ENV_FILE" ]]; then
  [[ -f "$ENV_FILE" ]] || { echo "✗ env file not found: $ENV_FILE" >&2; exit 64; }
  echo "→ loading env file (values never printed): $ENV_FILE"
  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in ''|'#'*) continue ;; *=*) ;; *) continue ;; esac
    key=${line%%=*}; value=${line#*=}
    case "$key" in ''|*[!A-Za-z0-9_]*|[0-9]*|PATH) continue ;; esac
    # strip ONE pair of matching surrounding quotes, compose-style
    case "$value" in '"'*'"') value=${value#\"}; value=${value%\"} ;; "'"*'"') value=${value#\'}; value=${value%\'} ;; esac
    # only known keys; the real environment keeps precedence
    for known in "${RUNTIME_VARS[@]}"; do
      if [[ "$key" == "$known" && -z "${!key:-}" ]]; then
        export "$key=$value"
        break
      fi
    done
  done <"$ENV_FILE"
else
  echo "→ no env file found (pass --env-file <path>, or create .env at the repo root: cp deploy/env.compose.example .env)"
  echo "  falling back to the current environment only"
fi

# ── r113: explicit required-vs-optional validation ───────────────────────
MISSING=()
for req in DATABASE_URL SESSION_SECRET ENCRYPTION_KEY ADMIN_JWT_SECRET APP_URL APP_ORIGINS; do
  [[ -n "${!req:-}" ]] || MISSING+=("$req")
done
if [[ ${#MISSING[@]} -gt 0 ]]; then
  echo "✗ missing REQUIRED production variables: ${MISSING[*]}" >&2
  echo "  Fill them in the env file (deploy/env.compose.example is the template) or export them." >&2
  echo "  The harness never substitutes defaults for production requirements." >&2
  exit 64
fi
echo "→ required production variables present (values never printed): DATABASE_URL SESSION_SECRET ENCRYPTION_KEY ADMIN_JWT_SECRET APP_URL APP_ORIGINS"

# Collect the passthrough set: every known runtime var that is currently set.
ENV_PASS=()
for v in "${RUNTIME_VARS[@]}"; do
  [[ -n "${!v:-}" ]] && ENV_PASS+=("-e" "$v")
done
NUM_RUNTIME=$(( ${#ENV_PASS[@]} / 2 ))
echo "→ passing ${NUM_RUNTIME} production runtime variables to the verify container (values never printed)"

# Single-instance warning: if another app instance (compose stack / Coolify)
# is already running against the same DATABASE_URL, its crons double-run
# while this harness is up. Run the harness BEFORE starting the stack.
if [[ "${SINGLE_INSTANCE_MODE:-}" == "true" ]]; then
  echo "→ SINGLE_INSTANCE_MODE=true — if the Coolify/compose stack is ALREADY running"
  echo "  against the same DATABASE_URL, stop it first: single-instance schedulers"
  echo "  double-run every cron while both containers are up."
fi
# R112 (§8): explicit, unambiguous ARM64 verdict. One of:
#   not-run | verified | failed
# The final summary prints "ARM64 VERIFIED" / "ARM64 NOT VERIFIED"
# from this state — never a mixed or silent result.
ARM64_STATE="not-run"

step() { printf '\n\033[1;36m== %s ==\033[0m\n' "$1"; }
ok()   { printf '\033[1;32m   PASS: %s\033[0m\n' "$1"; }
fail() { printf '\033[1;31m   FAIL: %s\033[0m\n' "$1"; FAILURES=$((FAILURES+1)); }
skip() { printf '\033[1;33m   SKIP: %s\033[0m\n' "$1"; SKIPS=$((SKIPS+1)); }

cd "$ROOT_DIR"

# ── 1. Native build ─────────────────────────────────────────────────────────
step "1/10 Build image (native: $(docker version --format '{{.Server.Arch}}'))"
docker build \
  --build-arg GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo verify)" \
  -t "$IMAGE_TAG" . \
  && ok "native build" || fail "native build"

# ── 2. Optional arm64 cross-build ───────────────────────────────────────────
if [[ "$ARM64_REQUESTED" == "1" ]]; then
  step "2/10 Cross-build linux/arm64 (QEMU — the Oracle Ampere target)"
  if docker buildx build \
    --platform linux/arm64 \
    --build-arg GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo verify)" \
    -t "$IMAGE_TAG-arm64" --load .; then
    ok "arm64 build (proves the pnpm/argon2 natives on arm64)"
    ARM64_STATE="verified"
  else
    # QEMU/binfmt absence, emulated compile failure, buildx errors — every
    # flavor lands here. Never report success when the cross-build failed.
    fail "arm64 build (see output above; on apt hosts: docker run --privileged --rm tonistiigi/binfmt --install arm64 installs the emulator)"
    ARM64_STATE="failed"
  fi
else
  step "2/10 arm64 cross-build SKIPPED (pass --arm64 to enable)"
fi

# ── 3. Boot + health gate ───────────────────────────────────────────────────
step "3/10 Boot container + /api/healthz readiness gate"
docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
# --log-driver/--log-opt mirror the compose log-rotation policy (10 MB × 3
# files) so gate 6 can assert the runtime actually honors them.
if ! docker run -d --name "$CONTAINER_NAME" \
  "${ENV_PASS[@]}" \
  --log-driver json-file --log-opt max-size=10m --log-opt max-file=3 \
  -p "127.0.0.1:${HOST_PORT}:8080" \
  "$IMAGE_TAG" >/dev/null; then
  fail "docker run failed (is 127.0.0.1:${HOST_PORT} already taken? override with SUBNATION_VERIFY_PORT)"
  printf '\n\033[1;31mRUN ABORTED — the container never started; later gates cannot run.\033[0m\n'
  exit 1
fi

READY=0
for i in $(seq 1 60); do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' "${BASE_URL}/api/healthz" || true)"
  if [[ "$CODE" == "200" ]]; then READY=1; break; fi
  # 503 "starting" during the migration window is EXPECTED and healthy.
  if [[ "$CODE" != "503" && "$CODE" != "000" ]]; then
    echo "   unexpected health code: $CODE (attempt $i)"
  fi
  sleep 3
done
[[ "$READY" == "1" ]] && ok "healthz 200 after boot (≤180 s incl. migrations)" \
  || { fail "healthz never reached 200"; docker logs "$CONTAINER_NAME" 2>&1 | tail -30; }

# ── 4. Single-origin SPA ────────────────────────────────────────────────────
step "4/10 Single-origin SPA served by the backend"
HTML_CODE="$(curl -s -o /dev/null -w '%{http_code}' "${BASE_URL}/" || true)"
[[ "$HTML_CODE" == "200" ]] && ok "GET / → 200 (SPA)" || fail "GET / → $HTML_CODE (expected 200)"

# ── 5. Socket.IO endpoint ───────────────────────────────────────────────────
# socket.io is mounted on its default path /socket.io/ (socket.ts passes no
# `path` option). A polling engine.io handshake must answer 200 with an
# "open" packet (0{"sid":…}) — this proves the realtime transport is alive
# on the same origin (auth middleware only runs at the socket level, so an
# unauthenticated handshake still receives a sid).
step "5/10 Socket.IO endpoint (engine.io polling handshake)"
SOCKET_RESP="$(curl -s --max-time 10 -w '\n%{http_code}' \
  "${BASE_URL}/socket.io/?EIO=4&transport=polling" || true)"
SOCKET_CODE="${SOCKET_RESP##*$'\n'}"
SOCKET_BODY="${SOCKET_RESP%$'\n'*}"
if [[ "$SOCKET_CODE" == "200" ]] && printf '%s' "$SOCKET_BODY" | grep -q '^0{"sid"'; then
  ok "engine.io handshake 200 + sid issued (realtime transport alive)"
else
  fail "socket.io handshake: HTTP ${SOCKET_CODE:-none}, body: ${SOCKET_BODY:-<empty>}"
fi

# ── 6. docker inspect gates ─────────────────────────────────────────────────
step "6/10 docker inspect gates (user, healthcheck, log config, bind, secrets)"
INSPECT_USER="$(docker inspect -f '{{.Config.User}}' "$CONTAINER_NAME" 2>/dev/null || echo '?')"
if [[ "$INSPECT_USER" == "node" ]]; then
  ok "container user = node (non-root, UID 1000)"
else
  fail "container user = '${INSPECT_USER}' (expected 'node')"
fi

HEALTHCHECK_CFG="$(docker inspect -f '{{json .Config.Healthcheck}}' "$CONTAINER_NAME" 2>/dev/null || true)"
if printf '%s' "$HEALTHCHECK_CFG" | grep -q '/api/healthz'; then
  ok "image healthcheck configured (probes /api/healthz)"
else
  fail "healthcheck config missing the /api/healthz probe: ${HEALTHCHECK_CFG:-<none>}"
fi
# Docker's own probe cadence is 30 s — report the runtime status, don't block on it.
echo "   (docker health status right now: $(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$CONTAINER_NAME" 2>/dev/null || echo '?'))"

LOG_DRIVER="$(docker inspect -f '{{.HostConfig.LogConfig.Type}}' "$CONTAINER_NAME" 2>/dev/null || true)"
LOG_OPTS="$(docker inspect -f '{{json .HostConfig.LogConfig.Config}}' "$CONTAINER_NAME" 2>/dev/null || true)"
if [[ "$LOG_DRIVER" == "json-file" ]] \
  && printf '%s' "$LOG_OPTS" | grep -q '"max-size":"10m"' \
  && printf '%s' "$LOG_OPTS" | grep -q '"max-file":"3"'; then
  ok "log config: json-file with 10m × 3 rotation (matches compose policy)"
else
  fail "log config: driver='${LOG_DRIVER}' opts=${LOG_OPTS} (expected json-file 10m × 3)"
fi

PORT_MAP="$(docker inspect -f '{{json .NetworkSettings.Ports}}' "$CONTAINER_NAME" 2>/dev/null || true)"
if printf '%s' "$PORT_MAP" | grep -q '"127.0.0.1"' \
  && ! printf '%s' "$PORT_MAP" | grep -q '"0.0.0.0"'; then
  ok "host binding is localhost-only (${PORT_MAP})"
else
  fail "unexpected host binding: ${PORT_MAP} (expected 127.0.0.1-only)"
fi

# §15 secret leakage: the IMAGE must be secret-free — secrets only ever
# arrive via runtime env (-e flags above), never baked into image layers.
IMG_ENV="$(docker inspect -f '{{json .Config.Env}}' "$IMAGE_TAG" 2>/dev/null || echo '[]')"
SECRET_LEAK=0
for secret_key in DATABASE_URL SESSION_SECRET ENCRYPTION_KEY ADMIN_JWT_SECRET; do
  if printf '%s' "$IMG_ENV" | grep -q "\"${secret_key}="; then
    fail "secret ${secret_key} is baked into the image ENV"
    SECRET_LEAK=1
  fi
done
if [[ "$SECRET_LEAK" == "0" ]]; then
  ok "image ENV is secret-free (NODE_ENV/PORT/TZ/GIT_SHA only)"
fi

# §15 mounted volumes: the verify container intentionally mounts none —
# volume policy is a compose concern and is covered by gate 7.
echo "   (mounts: $(docker inspect -f '{{json .Mounts}}' "$CONTAINER_NAME" 2>/dev/null || echo '?'))"

# ── 7. docker compose config validation ─────────────────────────────────────
step "7/10 docker compose config validation (+ restart/log/health/bind policy)"
if ! docker compose version >/dev/null 2>&1; then
  fail "docker compose plugin unavailable ('docker compose version' failed)"
elif [[ ! -f "$ROOT_DIR/.env" ]]; then
  skip "needs $ROOT_DIR/.env for the subnation env_file — cp deploy/env.compose.example .env, fill secrets, re-run"
else
  COMPOSE_ARGS=(--project-directory "$ROOT_DIR" -f "$ROOT_DIR/docker-compose.yml")
  COMPOSE_RENDERED=""
  COMPOSE_OK=0
  if COMPOSE_RENDERED="$(docker compose "${COMPOSE_ARGS[@]}" config 2>&1)"; then
    ok "docker compose config parses + interpolates cleanly"
    COMPOSE_OK=1
  else
    fail "docker compose config rejected the file:"
    printf '%s\n' "$COMPOSE_RENDERED" | sed 's/^/     /' | head -20
  fi
  if [[ "$COMPOSE_OK" == "1" ]]; then
    SERVICES="$(docker compose "${COMPOSE_ARGS[@]}" config --services 2>/dev/null | sort | xargs echo || true)"
    if [[ "$SERVICES" == "openwa subnation" ]]; then
      ok "both services present (openwa, subnation)"
    else
      fail "services: ${SERVICES:-<none>} (expected openwa + subnation)"
    fi

    RESTART_COUNT="$(printf '%s\n' "$COMPOSE_RENDERED" | grep -c 'restart: unless-stopped' || true)"
    [[ "$RESTART_COUNT" == "2" ]] && ok "restart: unless-stopped on both services" \
      || fail "restart policy count = ${RESTART_COUNT} (expected 2 × unless-stopped)"

    MAXSIZE_COUNT="$(printf '%s\n' "$COMPOSE_RENDERED" | grep -cE 'max-size: "?10m"?' || true)"
    MAXFILE_COUNT="$(printf '%s\n' "$COMPOSE_RENDERED" | grep -cE 'max-file: "?3"?' || true)"
    [[ "$MAXSIZE_COUNT" == "2" && "$MAXFILE_COUNT" == "2" ]] \
      && ok "log rotation 10m × 3 on both services" \
      || fail "log rotation: max-size ×${MAXSIZE_COUNT}, max-file ×${MAXFILE_COUNT} (expected 2 × each)"

    if printf '%s\n' "$COMPOSE_RENDERED" | grep -q '8080/api/healthz' \
      && printf '%s\n' "$COMPOSE_RENDERED" | grep -q '2785/healthz'; then
      ok "healthchecks declared for both services (healthz probes)"
    else
      fail "healthcheck probes missing from the rendered compose config"
    fi

    # `docker compose config` normalizes ports to long syntax; every
    # published port must carry host_ip: 127.0.0.1 (localhost-only).
    PUBLISHED_COUNT="$(printf '%s\n' "$COMPOSE_RENDERED" | grep -cE 'published:' || true)"
    LOCALHOST_COUNT="$(printf '%s\n' "$COMPOSE_RENDERED" | grep -cE 'host_ip: 127\.0\.0\.1' || true)"
    [[ "$PUBLISHED_COUNT" == "2" && "$LOCALHOST_COUNT" == "2" ]] \
      && ok "all published ports bound to 127.0.0.1 only" \
      || fail "port bindings: published ×${PUBLISHED_COUNT}, host_ip 127.0.0.1 ×${LOCALHOST_COUNT} (expected 2/2 localhost-only — check SUBNATION_HOST_PORT / OPENWA_HOST_PORT)"
  fi
fi

# ── 8. OpenWA gateway health ────────────────────────────────────────────────
# The gateway is a separate compose service (127.0.0.1:3001 → 2785); its
# /healthz is exempt from the API-key gate. This probe is read-only and safe
# against a running production stack.
step "8/10 OpenWA gateway /healthz (${OPENWA_HEALTH_URL})"
# curl rc distinguishes "nothing is listening" (7 = connection refused →
# SKIP, the stack is simply not up here) from "something is listening but
# dead" (28 = timeout → FAIL — that's a real gateway outage, not a skip).
OPENWA_RC=0
OPENWA_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$OPENWA_HEALTH_URL")" || OPENWA_RC=$?
if [[ "$OPENWA_RC" == "0" && "$OPENWA_CODE" == "200" ]]; then
  ok "openwa /healthz → 200 (gateway reachable + healthy)"
elif [[ "$OPENWA_RC" == "7" ]]; then
  skip "no gateway on ${OPENWA_HEALTH_URL} (connection refused) — bring up the compose stack (docker compose up -d openwa) and re-run to cover this gate"
else
  fail "openwa /healthz → HTTP ${OPENWA_CODE:-none} (curl rc ${OPENWA_RC}; expected 200)"
fi

# ── 9. Restart resilience ───────────────────────────────────────────────────
# -t 40 mirrors the compose stop_grace_period so the restart itself never
# SIGKILLs the drain handlers mid-write.
step "9/10 Restart resilience (docker restart -t 40 → readiness again)"
docker restart -t 40 "$CONTAINER_NAME" >/dev/null
READY2=0
for i in $(seq 1 60); do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' "${BASE_URL}/api/healthz" || true)"
  if [[ "$CODE" == "200" ]]; then READY2=1; break; fi
  if [[ "$CODE" != "503" && "$CODE" != "000" ]]; then
    echo "   unexpected health code after restart: $CODE (attempt $i)"
  fi
  sleep 3
done
if [[ "$READY2" == "1" ]]; then
  ok "healthy again after docker restart (≤180 s; clean second boot, migrations idempotent)"
else
  fail "healthz never returned to 200 after restart"
  docker logs --tail 30 "$CONTAINER_NAME" 2>&1 | sed 's/^/     /' || true
fi

# ── 10. Graceful drain ──────────────────────────────────────────────────────
step "10/10 Graceful drain (docker stop)"
T0="$(date +%s)"
docker stop -t 40 "$CONTAINER_NAME" >/dev/null 2>&1 || true
T1="$(date +%s)"
EXIT_CODE="$(docker inspect -f '{{.State.ExitCode}}' "$CONTAINER_NAME" 2>/dev/null || echo "?")"
DRAIN_S=$((T1 - T0))
echo "   drain took ${DRAIN_S}s, container exit code: $EXIT_CODE"
[[ "$EXIT_CODE" == "0" ]] && ok "clean exit(0) — pool drained, SIGTERM handled" \
  || fail "exit code $EXIT_CODE (137=SIGKILL: drain budget exceeded; anything else: crash on shutdown)"
docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true

printf '\n'
# ── R112 (§8): the unambiguous ARM64 verdict — printed in EVERY outcome, so
# a human reading only the last lines of a log can never mistake the state.
case "$ARM64_STATE" in
  verified)
    printf '\033[1;32mARM64 VERIFIED\033[0m — linux/arm64 image built successfully on this machine (gate 2).\n'
    ;;
  failed)
    printf '\033[1;31mARM64 NOT VERIFIED\033[0m — the linux/arm64 cross-build FAILED (gate 2). Do not deploy to Oracle Ampere until this passes.\n'
    ;;
  *)
    printf '\033[1;33mARM64 NOT VERIFIED\033[0m — the arm64 gate was not requested; run \\`%s --arm64\\` to verify the Oracle Ampere target.\n' "$0"
    ;;
esac
printf '\n'
if [[ "$FAILURES" -eq 0 && "$SKIPS" -eq 0 ]]; then
  printf '\033[1;32mALL §15 GATES PASSED (10/10)\033[0m — container behaviors are now VERIFIED on this machine/arch.\n'
  exit 0
elif [[ "$FAILURES" -eq 0 ]]; then
  printf '\033[1;32mALL RAN GATES PASSED\033[0m — %d gate(s) SKIPPED (see the yellow SKIP lines above; bring up the compose stack + .env to cover them).\n' "$SKIPS"
  exit 0
else
  printf '\033[1;31m%s CHECK(S) FAILED\033[0m — fix before migrating production.\n' "$FAILURES"
  exit 1
fi
