# Oracle Cloud + Coolify Migration Guide

> **Status (r107):** Migration-READY artifacts. Everything in this document is
> derived from the actual repository state at commit `6f4b715` + the r107
> migration round. Verification labels follow the honesty contract:
> **VERIFIED** (proved here), **PARTIALLY VERIFIED**, **NOT YET VERIFIED**
> (needs real infra), **BLOCKED BY EXTERNAL INFRASTRUCTURE**.

## 1. Target Architecture

```
                browser (Arabic RTL SPA + admin)
                     │
                 Cloudflare (DNS + proxy + WAF, subnation.ly)
                     │
        Oracle Cloud Always Free VM — Ampere A1, ARM64
        (2 OCPU / 12 GB RAM total, Ubuntu 22.04/24.04)
                     │
                 Coolify (Docker orchestration + Traefik edge)
                     │
        ┌────────────┴────────────┐
        │                         │
   subnation (this repo)     openwa (github.com/ahmadmedo1012/openwa)
   Express 5 + Socket.IO     Baileys WhatsApp gateway (pure WebSocket,
   + built SPA, one image    NO Chromium/Puppeteer — arm64-safe by design)
   :8080 internally          :2785 internally, /data volume
        │                         │
        └────────────┬────────────┘
                     │
        Neon PostgreSQL (EXTERNAL — unchanged during migration)
        DATABASE_URL (app) + PERSISTENCE_URL (gateway sessions,
        same DB is fine — gateway self-creates openwa_sessions)
```

**Stateless vs stateful:**

| Component | State | Persistence |
|---|---|---|
| subnation container | stateless | none — all state in Neon |
| openwa container | session auth folder | `/data` volume (defense-in-depth) + `openwa_sessions` table in Neon (source of truth) |
| Neon | all business data | external, untouched |
| Coolify | its own config | `/data/coolify` volume (Coolify installer default) |

**Redis: intentionally NOT deployed.** The single container runs the app's
in-memory fallbacks for rate limiting, cache, idempotency replay and the
PG-lease scheduler leadership. This is the CURRENT production shape
(VERIFIED in code: `backend/src/lib/redis-client.ts` returns a permanent
`null` client when `REDIS_URL` is unset and every consumer null-branches).
Adding Redis later is one env var — everything self-wires on the `"ready"`
event — but it must earn its ~30 MB RAM.

## 2. ARM64 Compatibility — the evidence

Target CPU: Ampere A1 (arm64, 2 OCPU, 12 GB shared with OS+Docker+Coolify).

| Dependency | Kind | arm64 proof | Label |
|---|---|---|---|
| argon2 ^0.44.0 (backend admin auth) | native, prebuilt | tarball lists `prebuilds/linux-arm64/argon2.armv8.glibc.node` **and** `...musl.node` → works on both Debian(glibc) and Alpine(musl) arm64 | **VERIFIED** (package-level) |
| sharp (openwa → Baileys media) | native, prebuilt | lockfile pins `@img/sharp-linux-arm64` + `@img/sharp-linuxmusl-arm64` optional deps | **VERIFIED** (package-level) |
| Chromium/Puppeteer | — | **Not used anywhere.** The gateway is Baileys (pure WebSocket WhatsApp-Web protocol). The SubNation backend has no browser dependency. | **VERIFIED** (dependency graph) |
| pg / pino / express / qrcode / nanoid / baileys / libsignal | pure JS | no native bindings | **VERIFIED** |
| Base images | — | `node:22-alpine` is multi-arch (amd64+arm64) — official manifest | **VERIFIED** (manifest) |
| Full build + boot + drain on real ARM64 hardware | — | — | **NOT YET VERIFIED** → run `scripts/docker-verify.sh --arm64` (needs Docker; the r107 sandbox had none) |

How to upgrade the last row to VERIFIED before cutover, from any x86 machine
with Docker:

```bash
./scripts/docker-verify.sh --arm64   # QEMU cross-build of the exact image
# or on the Oracle VM itself (native arm64):
./scripts/docker-verify.sh
```

## 3. Build strategy — do not burn the VM on builds

Two supported paths. **Start with B** (zero CI cost), graduate to A when
Actions minutes allow.

### Path A — CI-built multi-arch image (recommended later)
`.github/workflows/docker.yml` (r107) builds `linux/amd64 + linux/arm64`
and pushes to GHCR on `v*` tags / manual dispatch, with `GIT_SHA` baked in.
openwa's public repo has the identical workflow and free unmetered runners.
Costs to know: SubNation2 is a PRIVATE repo — QEMU-emulated arm64 builds take
~15-25 min of metered Actions time each. Status: **NOT YET VERIFIED**
(no Docker + exhausted minutes in the r107 sandbox) — run it once manually
before depending on it.

### Path B — Coolify builds from Git (start here)
Coolify clones the repo and runs the Dockerfile on the VM. Build cost on the
VM: one pnpm install + Vite build per deploy (~2-4 min on 2 OCPU, ~1.5-2 GB
peak RAM — fits inside the 12 GB envelope comfortably with both apps idle at
~300-500 MB combined). The Dockerfile layer cache makes subsequent builds
much cheaper (deps layer cached unless the lockfile changes).

**Never needed:** Render/Vercel build minutes — that economy no longer
applies on self-hosted hardware.

## 4. Server setup (Ubuntu, ARM64)

### 4.1 Prerequisites
- Oracle Cloud Always Free account, Ampere A1 shape (VM.Standard.A1.Flex),
  2 OCPU / 12 GB, Ubuntu 22.04 or 24.04 image, boot volume ≥ 50 GB (free
  allowance is 200 GB total — 50 is plenty for OS + Docker + 2 images).
- **Warning (Oracle-specific):** the default Ubuntu images ship iptables
  rules that DROP everything except SSH. You must open ports in BOTH the
  Oracle Cloud Security List (or NSG) AND the host iptables/netfilter
  (see 4.3) — the classic "why can't I reach my VM" trap.

### 4.2 First boot hardening
```bash
ssh -i <key> ubuntu@<VM_PUBLIC_IP>
sudo apt update && sudo apt -y upgrade
# SSH: key-only (Oracle images are key-only by default), disable password auth if present
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl restart ssh
# basics
sudo apt -y install ufw fail2ban
```

### 4.3 Firewall ports
| Port | Purpose | Open where |
|---|---|---|
| 22/tcp | SSH (rate-limit or restrict to your IP) | Oracle SL + iptables + ufw |
| 80/tcp | HTTP (ACME + redirect) | Oracle SL + iptables + ufw |
| 443/tcp | HTTPS + WebSocket | Oracle SL + iptables + ufw |
| 8000/tcp | Coolify dashboard (initial setup; close or restrict after) | Oracle SL + iptables + ufw |
| 3000/3001 | compose host bindings are **127.0.0.1-only** — never open these | — |

```bash
# Oracle host iptables (Ubuntu images) — insert BEFORE the REJECT rules:
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 8000 -j ACCEPT
sudo netfilter-persistent save
# UFW on top:
sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
sudo ufw allow 8000/tcp && sudo ufw enable
```
Coolify manages its own Traefik inside Docker — you do NOT open 8080/2785
publicly. The compose file binds them to `127.0.0.1` for local debugging only.

### 4.4 Install Coolify
```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```
The installer prints a root password and serves the first-run wizard on
`http://<VM_IP>:8000`. Change the password immediately, then:
- Settings → set the instance's FQDN if you want the dashboard on a subdomain
  (recommended: `coolify.subnation.ly` via Cloudflare, orange-cloud OFF for
  the dashboard — keep direct — and protect with a strong password).
- Close port 8000 in the firewall once the dashboard has a domain/you're
  done with the wizard (or restrict to your IP).

## 5. Deploying SubNation through Coolify

**Project → New → Docker Compose** (recommended — the repo ships
`docker-compose.yml`):

1. Source: GitHub → `ahmadmedo1012/SubNation2` (add a deployment token or
   your PAT in Coolify's Git providers first). Branch `main`.
2. Coolify reads `docker-compose.yml`. It expects a `.env` — paste the
   contents of `deploy/env.compose.example` with real values into Coolify's
   environment editor (Coolify stores it as the stack's env). Delete the
   `ports:` entries for `subnation`/`openwa` (or leave them — they bind
   localhost-only and are harmless) if Coolify complains about port mapping
   in its network model.
3. The `openwa` service build context is `${OPENWA_REPO_DIR:-../openwa}` —
   **a sibling clone does not exist inside Coolify's build environment.**
   For Coolify deployments, comment out `build:` for openwa and use:
   `image: ghcr.io/ahmadmedo1012/openwa:main` (public repo → free Actions
   image) or point Coolify at a second application resource for openwa and
   drop the service from the stack. Alternative for a pure-Git setup:
   deploy the two as separate Coolify "Applications" (Dockerfile source)
   — SubNation from this repo, openwa from its repo — and wire
   `WHATSAPP_OTP_BASE_URL` to the gateway's Coolify-internal hostname.
4. Domains (per service, in Coolify):
   - subnation → `https://subnation.ly` (+ `https://www.subnation.ly` or a
     CNAME www→apex) — Coolify issues Let's Encrypt automatically.
   - openwa → keep INTERNAL if the backend is the only caller
     (`WHATSAPP_OTP_BASE_URL=http://<openwa-container>:2785`). If operators
     need the dashboard/QR pages from the internet, give it a domain like
     `wa.subnation.ly` and switch the backend base URL to it.
5. Health check: Coolify reads the compose `healthcheck` (also baked into
   the Dockerfile): `GET /api/healthz` — expect 503 `{"status":"starting"}`
   during boot (migrations + cold Neon, up to ~120 s), then 200.
   `start_period: 150s` covers the worst case.

**Required env vars** (full matrix: `docs/deployment/ENVIRONMENT_MATRIX.md`,
template: `deploy/env.compose.example`): `DATABASE_URL`, `SESSION_SECRET`,
`ENCRYPTION_KEY` (64 hex), `ADMIN_JWT_SECRET` (≠ SESSION_SECRET),
`APP_URL`/`APP_ORIGINS` (+ `AUTH_COOKIE_SAMESITE=lax` now that the SPA is
same-origin), and the WhatsApp bridge vars.

### Build-time env (VITE_*) — the ONE trap
The SPA is built inside the Docker image; `VITE_*` values are BAKED at build
time. **Leave `VITE_API_BASE_URL`, `VITE_SOCKET_URL`, `VITE_API_URL` EMPTY**
— empty means same-origin (`frontend/src/lib/api-config.ts` falls back to
relative `/api` paths and `io(undefined)` connects same-origin — VERIFIED by
unit tests). Setting them to the old Render origin is the classic silent
breakage: the migrated site would keep calling `subnation2.onrender.com`.

## 6. OpenWA gateway on the same VM

Session survival recipe (VERIFIED in code, `openwa/src/persist.ts` +
`index.ts` boot restore):
- `OPENWA_API_KEY` — gateway exits(1) without it.
- `PERSISTENCE_URL` — Neon Postgres; the gateway self-creates
  `openwa_sessions (name, creds BYTEA, updated_at)` and stores the whole
  Baileys auth folder AES-256-GCM-encrypted (key: scrypt of
  `OPENWA_CREDENTIALS_KEY`, falling back to the API key's derivation).
- `OPENWA_CREDENTIALS_KEY` — set it ONCE (≥32 chars,
  `openssl rand -hex 32`) and never rotate casually; rotation re-encrypts
  transparently on first read, but the key must be stable across restarts.
- Volume `/data` — the hot auth folder. With `PERSISTENCE_URL` working the
  session survives restarts even on a brand-new volume (boot restore refills
  the folder from the DB); the volume is defense-in-depth + faster restore.
- `WHATSAPP_OTP_API_KEY` on SubNation must EQUAL `OPENWA_API_KEY`.

Restart persistence: SIGTERM handler flushes all ready sessions within 4 s
(VERIFIED in code) — the compose `stop_grace_period: 15s` gives it room.

## 7. Cloudflare + domains

Keep the same DNS records, change only the origin:
| Record | Before | After cutover |
|---|---|---|
| `subnation.ly` A/AAAA | (Vercel/Render) | VM public IP, proxied (orange) |
| `www` CNAME | → apex | unchanged |
| SSL/TLS mode | Full (strict) | Full (strict) — Coolify's LE cert is valid |

- **WebSockets:** Cloudflare proxies WS natively; Socket.IO rides
  `/socket.io/` on the same origin (upgrade handled by Traefik → container).
  The r107 same-origin handshake fix (`backend/src/lib/socket.ts`
  `isOriginAllowed`) accepts the Origin-less polling handshake when the Host
  matches the allowlist — without it the very first (polling) handshake was
  rejected with `unauthorized`. VERIFIED by unit tests; smoke-test live after
  deploy (open the site, watch the Network tab for a `socket.io/?...EIO=4`
  101/polling success).
- **Caching:** keep Cloudflare defaults; the app already sets
  `Cache-Control` on its public GETs (`/api/healthz/summary` 15 s, `/live`
  5 s). Authenticated endpoints are `no-store` (VERIFIED in code). Do NOT
  create a Cache Rule that caches `/api/*` broadly.
- **Cutover is a DNS edit only** — nothing in the app hardcodes the old
  hosts (the one exception, the admin WhatsApp docs link, is now env-driven
  via `VITE_OPENWA_DOCS_URL`).
- Do the DNS switch YOURSELF (operator decision), after the runbook's
  validation gates pass. Nothing in this document requires it to happen now.

## 8. Health model (what to monitor)

| Endpoint | Auth | Meaning | Cost |
|---|---|---|---|
| `GET /api/healthz` | public | static ok once boot gate opens; 503 `starting` before | zero — platform probe target |
| `GET /api/healthz/live` | public | process-alive liveness, no I/O | zero |
| `GET /api/healthz/summary` | public | aggregate ok/degraded/failing | 15 s in-process cache + single-flight |
| `GET /api/healthz/ready` | admin | full per-subsystem breakdown + scheduler topology | 15 s cache |

External uptime check (operator traffic, not self-ping — allowed): point any
monitor at `https://subnation.ly/api/healthz/summary`. Without Redis the
worker-heartbeat alert is inert by design; an external probe covers that gap.

## 9. Scheduler + Neon economics on an always-on box

The web container elects itself leader via a Postgres lease
(`scheduler_leader_lease`) refreshed every **25 s** (r104 default; TTL 60 s).
On Render Free that cadence only ran while awake. Always-on it runs 24/7 —
**with Neon Free (autosuspend ≈5 min) this keeps Neon's compute awake
~720 h/mo against a 191.9 h free allowance.** r107 made the cadence
env-tunable so this is a CONSCIOUS choice, not an accident:

- Accept always-awake Neon (it also kills cold-start latency — arguably a
  feature), or
- `SCHEDULER_LEASE_REFRESH_MS=50000` + `SCHEDULER_LEASE_TTL_SEC=120`
  (halves the query rate; Neon still never sleeps at 50 s intervals — this
  only reduces load, NOT the awake hours), or
- Migrate Postgres onto the VM later (Docker Postgres or managed) — the lease
  refresh then costs nothing external.

`DISABLE_WEB_SCHEDULERS` must stay `false` (no worker tier exists — flipping
it silently kills every cron; the 2026-09-08 outage class).

## 10. Startup / shutdown behavior (what you will see)

**Boot (VERIFIED in code, bounded):** port binds immediately → 503
`starting` on `/api/healthz*` → encryption-key assert → Redis init (8 s cap,
degrades to null) → migrations (write-wait ≤120 s, leader lock ≤300 s
pathological, fingerprint fast-path 1-2 queries steady-state) → gate opens
200 → schedulers elect leader 7 s later. First boot against a cold Neon is
the slow path; steady redeploys are seconds.

**Shutdown (r107-fixed):** on SIGTERM the app now evicts idle keep-alive
sockets IMMEDIATELY (the old order deadlocked on Traefik's pooled backend
connections until the force-exit fired), then releases the leader lease,
closes Socket.IO, drains in-flight HTTP (budget 25 s, env-tunable via
`GRACEFUL_SHUTDOWN_TIMEOUT_MS`), ends the Postgres pool, flushes Sentry,
exit(0). Compose/Coolify stop grace (40 s) sits above the app budget so the
clean path always wins. **Container-behavior label: NOT YET VERIFIED on real
Docker — `scripts/docker-verify.sh` step 5 proves it (exit code 0, not 137).**

## 11. Logs

`docker logs subnation` / Coolify's log pane. Structured pino JSON with a
pinned redaction list (tokens/cookies/OTP never logged — VERIFIED by
`logger-nested-redaction.test.ts`). The gateway masks phone digits to
last-4 at every call site. Log volume at idle is near-zero (event-driven
design, no periodic chatter beyond the leader refresh at debug level).

## 12. Rollback

- **App-level:** redeploy the previous Coolify deployment (Coolify keeps
  history) or `docker compose` pin an older image tag / previous build.
  Migrations are idempotent + forward-compatible within the additive schema
  policy; for a broken-migration emergency there is
  `DISABLE_BOOT_MIGRATIONS=true` (escape hatch, documented in
  `config/env.example`).
- **Platform-level:** keep Render/Vercel alive (do NOT delete the old
  services) until the new stack has run clean for an agreed soak period.
  Rolling back the DNS record is then a 1-minute operation.
- **Gateway:** sessions live in Neon; re-pointing `WHATSAPP_OTP_BASE_URL`
  to the Render gateway instantly restores the old path (both gateways can
  serve the same persisted session — the table is shared).

## 13. Backup / restore — current honest state

| Asset | Backup status |
|---|---|
| Neon business data | **Operator must configure.** `scripts/db-backup.sh` exists in-repo (pg_dump → local file); schedule it on the VM cron or use Neon's own PITR (free tier: 7 days restore window on their dashboard). Not automated today — CONFIGURE BEFORE CUTOVER. |
| openwa sessions | Same DB → covered by the same backup; `OPENWA_CREDENTIALS_KEY` needed to decrypt → back it up with the secrets. |
| Secrets/.env | Operator-owned. Keep an encrypted copy (e.g. age/gpg) OUTSIDE the VM. |
| Coolify config | Lives in `/data/coolify` (volume) — snapshot the volume or re-provision (stack is reproducible from this doc + git). |
| Product images | In git (45 WebP, ~0.5 MB) — already durable. |

Nothing else on the VM is irreplaceable: the whole stack re-creates from
git + this document + the secrets list.

## 14. Troubleshooting quick table

| Symptom | Likely cause | Fix |
|---|---|---|
| Health stays 503 `starting` >3 min | Neon unreachable / migration lock stuck | `docker logs` → check `DATABASE_URL`; check `scheduler_leader_lease` row age; worst case `DISABLE_BOOT_MIGRATIONS=true` once |
| Site loads, API 401/403 everywhere | `APP_ORIGINS` missing the serving origin | set `APP_ORIGINS=https://subnation.ly,https://www.subnation.ly`, redeploy |
| Socket.IO `unauthorized` reconnect loop | deploy ran with a build where the r107 Host-fallback is absent, or Host mismatch | confirm image includes r107+; check the Host header reaches the container (Traefik preserves it by default) |
| WhatsApp OTP never sends | gateway down / key mismatch / session logged out | hit gateway `/healthz`; verify `WHATSAPP_OTP_API_KEY == OPENWA_API_KEY`; open gateway QR/pair page and re-link |
| Can't reach VM on 80/443 after install | Oracle iptables DROP (§4.3 trap) | add the iptables rules + Security List entries |
| `docker stop` shows exit 137 | drain exceeded the grace window | raise compose `stop_grace_period` above `GRACEFUL_SHUTDOWN_TIMEOUT_MS` |
