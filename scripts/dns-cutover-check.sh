#!/usr/bin/env bash
# =============================================================================
# SubNation — DNS cutover readiness check (R112 §16)
# =============================================================================
# READ-ONLY. This script NEVER modifies DNS — the actual record change is an
# operator action. It answers exactly one question:
#
#     "If I pointed subnation.ly at TARGET_IP right now, would production
#      work end-to-end?"
#
# Checks (in order — every one must pass for READY):
#   1. current DNS A/AAAA records for the domain (+ TTL note)
#   2. the TARGET VM answers on 80/443 (Traefik/Coolify edge) and SSH on 22
#   3. HTTPS: the edge serves a certificate covering the production host
#      (self-signed/pre-issuance → NOT READY: wait for Let's Encrypt first)
#   4. Host routing: a request with Host: <production host> reaches the app
#      (and NOT the Traefik default backend)
#   5. API health: /api/healthz → 200 on the target, via the production host
#   6. Socket.IO: the engine.io polling handshake answers on the target
#
# Usage:
#   ./scripts/dns-cutover-check.sh <DOMAIN> <TARGET_IP>
#   ./scripts/dns-cutover-check.sh subnation.ly 132.145.123.4
#
# Exit codes: 0 = READY for cutover · 1 = NOT READY (fix first) · 64 = usage
# =============================================================================
set -euo pipefail
FAILURES=0
ok()  { printf '\033[1;32m   ✓ %s\033[0m\n' "$1"; }
bad() { printf '\033[1;31m   ✗ %s\033[0m\n' "$1"; FAILURES=$((FAILURES+1)); }
inf() { printf '\033[1;36m   ℹ %s\033[0m\n' "$1"; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "✗ $1 is required" >&2; exit 64; }; }
need curl; need dig || need nslookup || { echo "✗ dig or nslookup is required (dnsutils)" >&2; exit 64; }

DOMAIN="${1:-}"
TARGET_IP="${2:-}"
[ -n "$DOMAIN" ] && [ -n "$TARGET_IP" ] || { echo "usage: dns-cutover-check.sh <DOMAIN> <TARGET_IP>" >&2; exit 64; }
# basic IP shape guard (v4 here; v6 cutover is out of scope for this script)
[[ "$TARGET_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "✗ TARGET_IP '${TARGET_IP}' is not an IPv4 literal" >&2; exit 64; }

# ── 1. current DNS state (read-only) ────────────────────────────────────────
printf '\n== current DNS (read-only) ==\n'
if command -v dig >/dev/null 2>&1; then
  A_NOW="$(dig +short A "$DOMAIN" @1.1.1.1 2>/dev/null | rg '^[0-9]+\.' | head -1 || true)"
  [ -n "$A_NOW" ] && inf "current A record (via 1.1.1.1): ${A_NOW}" || inf "no A record published yet (first-time cutover)"
  TTL_NOW="$(dig A "$DOMAIN" @1.1.1.1 +noall +answer 2>/dev/null | awk '{print $2}' | head -1 || true)"
  if [ -n "${TTL_NOW:-}" ] && [ "${TTL_NOW}" -gt 300 ] 2>/dev/null; then
    inf "current TTL ${TTL_NOW}s — consider lowering BEFORE cutover day for a fast rollback path"
  else
    inf "current TTL ${TTL_NOW:-n/a}s (rollback-friendly)"
  fi
fi

# ── 2. target VM edge ports ─────────────────────────────────────────────────
printf '\n== target VM (%s) ==\n' "$TARGET_IP"
for port in 80 443 22; do
  if curl -s -o /dev/null --max-time 5 "http://${TARGET_IP}:${port}/" 2>/dev/null \
     || timeout 5 bash -c "</dev/tcp/${TARGET_IP}/${port}" 2>/dev/null; then
    ok "port ${port}/tcp open on the target"
  else
    bad "port ${port}/tcp NOT reachable on ${TARGET_IP} (Oracle security list + iptables + Coolify must all allow it)"
  fi
done

# ── 3. HTTPS certificate on the target (via SNI = production host) ─────────
printf '\n== TLS on the target ==\n'
CERT_OK=0
if command -v openssl >/dev/null 2>&1; then
  TLS_OUT="$(timeout 10 openssl s_client -connect "${TARGET_IP}:443" -servername "$DOMAIN" </dev/null 2>/dev/null || true)"
  if printf '%s' "$TLS_OUT" | grep -q "CN\|subject="; then
    ISSUER="$(printf '%s' "$TLS_OUT" | openssl x509 -noout -issuer 2>/dev/null || echo '?')"
    SUBJECT="$(printf '%s' "$TLS_OUT" | openssl x509 -noout -subject 2>/dev/null || echo '?')"
    if printf '%s' "$SUBJECT" | grep -q "$DOMAIN"; then
      if printf '%s' "$ISSUER" | grep -qi "let's encrypt\|letsencrypt\|google trust\|digicert\|sectigo"; then
        ok "certificate covers ${DOMAIN} (issuer: ${ISSUER#*=})"
        CERT_OK=1
      else
        bad "certificate for ${DOMAIN} is self-signed/default (${ISSUER#*=}) — Coolify's Let's Encrypt hasn't issued yet; DNS cutover would serve browser warnings"
      fi
    else
      bad "certificate does not cover ${DOMAIN} (subject: ${SUBJECT#*=}) — issue the cert for the production host first"
    fi
  else
    bad "no TLS handshake on ${TARGET_IP}:443 with SNI ${DOMAIN}"
  fi
else
  inf "openssl not available — skipping certificate inspection (verify in the browser instead)"
  CERT_OK=1
fi

# ── 4+5. Host routing + API health THROUGH the target, with the real Host ────
printf '\n== application through the target (Host: %s) ==\n' "$DOMAIN"
resolve() { curl --resolve "${DOMAIN}:443:${TARGET_IP}" --resolve "${DOMAIN}:80:${TARGET_IP}" "$@"; }

if [ "$CERT_OK" = "1" ]; then
  HEALTH_CODE="$(resolve -s -o /dev/null -w '%{http_code}' --max-time 10 "https://${DOMAIN}/api/healthz" || true)"
  if [ "$HEALTH_CODE" = "200" ]; then
    ok "/api/healthz → 200 through the target with the production Host"
  elif [ "$HEALTH_CODE" = "503" ]; then
    bad "/api/healthz → 503 (boot gate still 'starting' — migrations or cold Neon wait in progress; retry in a minute)"
  else
    bad "/api/healthz → ${HEALTH_CODE:-no answer} (expected 200) — the app is not reachable via Host ${DOMAIN} on the target"
  fi

  SPA_CODE="$(resolve -s -o /dev/null -w '%{http_code}' --max-time 10 "https://${DOMAIN}/" || true)"
  [ "$SPA_CODE" = "200" ] && ok "GET / → 200 (SPA served)" || bad "GET / → ${SPA_CODE:-no answer} (expected 200)"

  SOCKET_RESP="$(resolve -s --max-time 10 -w '\n%{http_code}' "https://${DOMAIN}/socket.io/?EIO=4&transport=polling" || true)"
  SOCKET_CODE="${SOCKET_RESP##*$'\n'}"
  SOCKET_BODY="${SOCKET_RESP%$'\n'*}"
  if [ "$SOCKET_CODE" = "200" ] && printf '%s' "$SOCKET_BODY" | grep -q '^0{"sid"'; then
    ok "Socket.IO engine.io handshake answers (realtime transport alive through the edge)"
  else
    bad "Socket.IO handshake: HTTP ${SOCKET_CODE:-none} (Cloudflare must have WebSockets enabled for the orange-cloud record)"
  fi
else
  bad "skipped app checks — TLS must be green first (see above)"
fi

printf '\n'
if [ "$FAILURES" -eq 0 ]; then
  printf '\033[1;32mREADY\033[0m — pointing DNS at %s should serve production end-to-end.\n' "$TARGET_IP"
  echo "  The actual DNS change stays an OPERATOR action (Cloudflare dashboard)."
  echo "  Cutover order: keep TTL low, switch the A record, watch https://${DOMAIN}/api/healthz"
  exit 0
fi
printf '\033[1;31mNOT READY\033[0m — %s check(s) failed. Fix them before touching DNS.\n' "$FAILURES"
exit 1
