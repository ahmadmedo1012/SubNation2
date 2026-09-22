#!/usr/bin/env bash
# =============================================================================
# SubNation — Docker verification harness (r107)
# =============================================================================
# Run this on ANY machine with Docker (your laptop or the Oracle VM) to prove
# the migration artifacts actually work. This workspace could not run Docker
# (no daemon in the sandbox), so the r107 "VERIFIED" labels for container
# behavior depend on THIS script passing where Docker exists.
#
# What it proves, in order:
#   1. The production image builds on the NATIVE arch of the machine.
#   2. (optional, --arm64) The image builds for linux/arm64 via QEMU/buildx —
#      the Oracle Ampere A1 target — WITHOUT a container registry.
#   3. The container boots, /api/healthz flips 503 "starting" → 200.
#   4. The SPA is served by the same origin (single-origin contract).
#   5. docker stop drains gracefully: exit within the grace window, no SIGKILL
#      ("Initializer exited with 137" / exit code 137 = FAILED drain test).
#
# Usage:
#   ./scripts/docker-verify.sh            # native build + boot + drain
#   ./scripts/docker-verify.sh --arm64    # also cross-build arm64 via buildx
#
# Requires: docker (with buildx), a reachable DATABASE_URL (Neon works).
# Pass secrets via env vars — the script reads what the app reads.
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_TAG="subnation-verify:local"
CONTAINER_NAME="subnation-verify"
FAILURES=0

step() { printf '\n\033[1;36m== %s ==\033[0m\n' "$1"; }
ok()   { printf '\033[1;32m   PASS: %s\033[0m\n' "$1"; }
fail() { printf '\033[1;31m   FAIL: %s\033[0m\n' "$1"; FAILURES=$((FAILURES+1)); }

: "${DATABASE_URL:?DATABASE_URL must be set (Neon connection string)}"
: "${SESSION_SECRET:?SESSION_SECRET must be set (32+ chars)}"
: "${ENCRYPTION_KEY:?ENCRYPTION_KEY must be set (64 hex chars)}"
: "${ADMIN_JWT_SECRET:?ADMIN_JWT_SECRET must be set (differs from SESSION_SECRET)}"

cd "$ROOT_DIR"

# ── 1. Native build ─────────────────────────────────────────────────────────
step "1/5 Build image (native: $(docker version --format '{{.Server.Arch}}'))"
docker build \
  --build-arg GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo verify)" \
  -t "$IMAGE_TAG" . \
  && ok "native build" || fail "native build"

# ── 2. Optional arm64 cross-build ───────────────────────────────────────────
if [[ "${1:-}" == "--arm64" ]]; then
  step "2/5 Cross-build linux/arm64 (QEMU — the Oracle Ampere target)"
  docker buildx build \
    --platform linux/arm64 \
    --build-arg GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo verify)" \
    -t "$IMAGE_TAG-arm64" --load . \
    && ok "arm64 build" || fail "arm64 build (see notes: this proves the pnpm/argon2/sharp toolchain on arm64)"
else
  step "2/5 arm64 cross-build SKIPPED (pass --arm64 to enable)"
fi

# ── 3. Boot + health gate ───────────────────────────────────────────────────
step "3/5 Boot container + /api/healthz readiness gate"
docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER_NAME" \
  -e DATABASE_URL -e SESSION_SECRET -e ENCRYPTION_KEY -e ADMIN_JWT_SECRET \
  -e APP_URL="$APP_URL" \
  -e APP_ORIGINS="${APP_ORIGINS:-https://subnation.ly,https://www.subnation.ly}" \
  -p 127.0.0.1:3000:8080 \
  "$IMAGE_TAG" >/dev/null

READY=0
for i in $(seq 1 60); do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/healthz || true)"
  if [[ "$CODE" == "200" ]]; then READY=1; break; fi
  # 503 "starting" during the migration window is EXPECTED and healthy.
  if [[ "$CODE" != "503" && "$CODE" != "000" ]]; then
    echo "   unexpected health code: $CODE (attempt $i)"
  fi
  sleep 3
done
[[ "$READY" == "1" ]] && ok "healthz 200 after boot (≤180 s incl. migrations)" \
  || { fail "healthz never reached 200"; docker logs "$CONTAINER_NAME" | tail -30; }

# ── 4. Single-origin SPA ────────────────────────────────────────────────────
step "4/5 Single-origin SPA served by the backend"
HTML_CODE="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/ || true)"
[[ "$HTML_CODE" == "200" ]] && ok "GET / → 200 (SPA)" || fail "GET / → $HTML_CODE (expected 200)"

step "5/5 Graceful drain (docker stop)"
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
if [[ "$FAILURES" -eq 0 ]]; then
  printf '\033[1;32mALL CHECKS PASSED\033[0m — container behaviors are now VERIFIED on this machine/arch.\n'
  exit 0
else
  printf '\033[1;31m%s CHECK(S) FAILED\033[0m — fix before migrating production.\n' "$FAILURES"
  exit 1
fi
