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
scheduler ownership (single-instance mode — see §9). This is the designed
production shape (VERIFIED in code: `backend/src/lib/redis-client.ts` returns
a permanent `null` client when `REDIS_URL` is unset and every consumer
null-branches). Adding Redis later is one env var — everything self-wires on
the `"ready"` event — but it must earn its ~30 MB RAM.

## 2. ARM64 Compatibility — the evidence

Target CPU: Ampere A1 (arm64, 2 OCPU, 12 GB shared with OS+Docker+Coolify).

| Dependency | Kind | arm64 proof | Label |
|---|---|---|---|
| argon2 ^0.44.0 (backend admin auth) | native, prebuilt | tarball lists `prebuilds/linux-arm64/argon2.armv8.glibc.node` **and** `...musl.node` → works on both Debian(glibc) and Alpine(musl) arm64 | **VERIFIED** (package-level) |
| sharp (openwa → Baileys media) | native, prebuilt | lockfile pins `@img/sharp-linux-arm64` + `@img/sharp-linuxmusl-arm64` optional deps | **VERIFIED** (package-level) |
| Chromium/Puppeteer | — | **Not used anywhere.** The gateway is Baileys (pure WebSocket WhatsApp-Web protocol). The SubNation backend has no browser dependency. | **VERIFIED** (dependency graph) |
| pg / pino / express / qrcode / nanoid / baileys / libsignal | pure JS | no native bindings | **VERIFIED** |
| Base images | — | `node:22-alpine` is multi-arch (amd64+arm64) — official manifest | **VERIFIED** (manifest) |
| Full build + boot + drain on real ARM64 hardware | — | — | **NOT YET VERIFIED** → run `scripts/docker-verify.sh --arm64` (needs Docker; no audit sandbox has had Docker, r107–r110) |

How to upgrade the last row to VERIFIED before cutover, from any x86 machine
with Docker:

```bash
./scripts/docker-verify.sh --arm64   # QEMU cross-build of the exact image
# or on the Oracle VM itself (native arm64):
./scripts/docker-verify.sh
```

**r110 status (post-`bb4418e`) — the image is buildable again, but no Docker
build has run yet.** R109 proved two P0s that made the Dockerfile unbuildable
on every path — buildability the r107/r108 readiness labels above had
implicitly assumed:

1. The runtime stage's `pnpm install --frozen-lockfile --prod ...` executed
   the root `prepare: husky` script; husky is a devDependency, absent from a
   `--prod` tree → `husky: not found` → exit 1 → every image build aborted.
   **Fixed:** the install now runs with `--ignore-scripts` (the only real
   runtime externals are argon2 + firebase-admin, and both load
   bundled/prebuilt artifacts at require-time).
2. The pnpm-workspace platform-exclusion overrides ("local deployment target
   is linux-x64") had stripped every non-x64-linux native — including the
   arm64-gnu/musl AND x64-musl variants of the build toolchain
   (esbuild/rollup/@tailwindcss/oxide/lightningcss) — out of `pnpm-lock.yaml`,
   so an Alpine build failed at the vite/esbuild step on every architecture.
   **Fixed:** the exclusion overrides were dropped and the lockfile
   regenerated (the natives are back — 30 lockfile refs).

Verified so far: static inspection plus an exact-stage replay in the sandbox
(full frozen install exit 0; the runtime stage's exact command and file
layout exit 0; `require('argon2')` + `require('firebase-admin')` succeed in
the `--ignore-scripts` prod tree). NOT verified: an actual `docker build` —
no Docker exists in the audit sandbox. `scripts/docker-verify.sh` (extended
in r110 with the remaining container gates) is the command that upgrades
this on any Docker host.

## 3. Build strategy — do not burn the VM on builds

Two supported paths. **Start with B** (zero CI cost), graduate to A when
Actions minutes allow.

### Path A — CI-built multi-arch image (recommended later)
`.github/workflows/docker.yml` (r107) builds `linux/amd64 + linux/arm64`
and pushes to GHCR on `v*` tags / manual dispatch, with `GIT_SHA` baked in
and immutable `sha-<short>` tags (r108: prefer these over `:latest` in
production — see the runbook Phase-4 gate).
openwa's public repo has the identical workflow and free unmetered runners.
Costs to know: SubNation2 is a PRIVATE repo — QEMU-emulated arm64 builds take
~15-25 min of metered Actions time each. Status: **NOT YET VERIFIED**
(no Docker + exhausted minutes in the r107 sandbox) — run it once manually
before depending on it. **Pulling the PRIVATE image on the VM needs a
one-time `docker login ghcr.io` with a PAT that has `read:packages`
(Settings → Developer settings → PAT; the GITHUB_TOKEN the workflow uses to
PUSH does not exist on the VM) — otherwise the first `docker compose pull`
fails with "denied". openwa's public image needs no login.**

### Path B — Coolify builds from Git (start here)
Coolify clones the repo and runs the Dockerfile on the VM. Build cost on the
VM: one pnpm install + Vite build per deploy (~2-4 min on 2 OCPU, ~1.5-2 GB
peak RAM — fits inside the 12 GB envelope comfortably with both apps idle at
~300-500 MB combined). The Dockerfile layer cache makes subsequent builds
much cheaper (deps layer cached unless the lockfile changes).

**Version identity on VM builds (r110 note):** pass the `GIT_SHA` build arg
when building on the VM — e.g. in Coolify's build-arg settings or
`docker compose build --build-arg GIT_SHA=$(git rev-parse --short HEAD)`.
Otherwise `getReleaseSha()` (`backend/src/lib/release-sha.ts`) falls through
`RENDER_GIT_COMMIT` (absent on the VM) to `"unknown"`, and health payloads,
logs and admin surfaces report an unnamed release.

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
# Oracle host iptables (Ubuntu images) — the shipped ruleset REJECTs all
# inbound except 22. Find the FIRST REJECT rule's line number, then insert
# the ACCEPTs BEFORE it (R108: the old hard-coded "line 6" breaks when the
# shipped ruleset differs):
LN=$(sudo iptables -L INPUT --line-numbers -n | awk '/REJECT/{print $1; exit}')
sudo iptables -I INPUT "$LN" -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT "$LN" -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo iptables -I INPUT "$LN" -m state --state NEW -p tcp --dport 8000 -j ACCEPT
# Repeat for ip6tables if the VM has an IPv6 address (same pattern).
sudo netfilter-persistent save
# UFW on top:
sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
sudo ufw allow 8000/tcp && sudo ufw enable
```
Coolify manages its own Traefik inside Docker — you do NOT open 8080/2785
publicly. The compose file binds them to `127.0.0.1` for local debugging only.

### 4.4 Swap (R108 — do this before running the stack)

12 GB total is NOT 12 GB of app RAM (OS + Docker + Coolify's own containers
eat ~1.5-2 GB before your app starts; see the budget in
`docs/architecture/PRODUCTION_ARCHITECTURE.md` §5). A modest swap file is a
safety net against OOM-kills during build spikes — NOT extra RAM (Node +
Baileys under swap-thrash perform terribly; the goal is surviving the rare
spike, never swapping at steady state):

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
sudo sysctl -w vm.swappiness=10
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swappiness.conf
```

Rationale: 2 GB covers a Coolify Git-build spike (~1.5-2 GB transient) with
the OS page cache intact; swappiness=10 keeps the kernel from swapping idle
anonymous pages it merely thinks are cold. No zram — the ARM64 Ubuntu kernel
handles a plain swapfile fine and it is one less moving part.

### 4.5 Install Coolify
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
   For Coolify deployments, comment out `build:` for openwa and pull the
   CI-built image instead, **pinned to an immutable tag**:
   `image: ghcr.io/ahmadmedo1012/openwa:sha-<short>` — the openwa GHCR
   workflow publishes a `sha-<short>` tag with every build (copy it from the
   Actions run or `docker manifest inspect`); the floating `:main`/`:latest`
   tags are dev-only, exactly as `docker-compose.yml`'s own image-guidance
   comments say (public repo → free Actions image, no `docker login`
   needed). Alternatively point Coolify at a second application resource for
   openwa (Dockerfile source, pure-Git setup — SubNation from this repo,
   openwa from its repo), drop the service from the stack, and wire
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
- **Origin lockdown (R108 — tiered, honest):** locking the VM's 80/443 to
  Cloudflare IP ranges (`https://www.cloudflare.com/ips/`) as a ufw allowlist
  is tempting, but it BREAKS Coolify's Let's Encrypt HTTP-01 renewal unless
  you also switch certificates to DNS-01 (Cloudflare API token in Coolify).
  Recommended tiers: (0) no lockdown at first — Traefik only serves the
  domains it has certs for anyway; (1) later, if you want it: Cloudflare
  Origin-CA certificates (15-year, issued through the CF dashboard, uploaded
  to Coolify) + CF-IP allowlist on 80/443 — health checks from the VM itself
  (`curl 127.0.0.1`) stay unaffected because they bypass the edge entirely.
  Grey-cloud (DNS-only) fallback remains possible at any tier if Cloudflare
  itself has an incident.

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

**R108 RESOLVED — `SINGLE_INSTANCE_MODE=true` (default in
`deploy/env.compose.example`).** The single-container topology has no second
instance to arbitrate, so the R107-era PG-lease heartbeat (25 s refresh /
60 s TTL) bought nothing while keeping Neon's compute awake 24/7 — **144
coordination queries/hour ≈ 720 awake-h/mo ≈ 180 CU-h, against Neon Free's
100 CU-h/project/month allowance
**(DISASTER_RECOVERY.md records this exact failure already burning
the allowance once). In single-instance mode the scheduler runs ungated
in-process: no leader election, no lease heartbeat, ZERO periodic Neon
coordulation queries — **idle Neon autosuspend is preserved** and the only
remaining fixed-time wake-ups are the retention ladder itself (00:00-05:00
UTC, ~25 min/day ≈ 12.5 h/mo). Every job keeps running on its normal
cadence; the election machinery stays intact for a future flip-back (unset
the flag). Constraints: NEVER scale the subnation service >1 replica in this
mode (every cron would double-run); a dedicated `worker.ts` process alongside
it double-runs too (it logs a loud warning naming the fix — see §9 of the
ENVIRONMENT_MATRIX SINGLE_INSTANCE_MODE row).

The R107-era options remain available for the multi-instance future (all
inert while SINGLE_INSTANCE_MODE=true): lease cadence tuning via
`SCHEDULER_LEASE_REFRESH_MS`/`SCHEDULER_LEASE_TTL_SEC`, or migrating
Postgres onto the VM (the lease refresh then costs nothing external).
`DISABLE_WEB_SCHEDULERS` must stay `false` (no worker tier exists — flipping
it silently kills every cron; the 2026-09-08 outage class).

## 10. Startup / shutdown behavior (what you will see)

**Boot (VERIFIED in code, bounded):** port binds immediately → 503
`starting` on `/api/healthz*` → encryption-key assert → Redis init (8 s cap,
degrades to null) → migrations (write-wait ≤120 s, leader lock ≤300 s
pathological, fingerprint fast-path 1-2 queries steady-state) → gate opens
200 → schedulers start ungated (`SINGLE_INSTANCE_MODE` — no leader election;
the boot one-shots fire ~7 s later). First boot against a cold Neon is
the slow path; steady redeploys are seconds.

**Shutdown (r107-fixed):** on SIGTERM the app now evicts idle keep-alive
sockets IMMEDIATELY (the old order deadlocked on Traefik's pooled backend
connections until the force-exit fired), then releases the leader lease
(no-op in SINGLE_INSTANCE_MODE — there is no lease),
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
design, no periodic chatter). **R108: `docker-compose.yml` now pins a
rotation policy on both services (`json-file`, `max-size: 10m`,
`max-file: 3` → ≤30 MB/service on the host); Coolify additionally runs its
own Docker-cleanup (weekly image GC by default). If you bypass compose and
`docker run` manually, set `--log-opt max-size=10m --log-opt max-file=3` or
the json-file driver grows unbounded.**

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
  to the Render gateway restores the old path — **but NEVER run both
  gateways live at once (R108 correction of the old "both can serve" note):
  WhatsApp enforces one linked device per session-credential set. Two
  gateways restoring the same `openwa_sessions` row fight over the link and
  OTP breaks on BOTH paths.** The safe dance: stop the Oracle gateway
  container → resume the Render `openwa-gateway` (it must have been
  USER-suspended, not billing-suspended — see the runbook Phase-5 guard) →
  flip `WHATSAPP_OTP_BASE_URL` → verify one OTP end-to-end.

## 13. Backup / restore — current honest state

| Asset | Backup status |
|---|---|
| Neon business data | **Automated as of r110 — operator installs the cron once.** The in-repo command is `pnpm run db:backup` (`scripts/src/backup-db.ts`, needs `pg_dump` + `DATABASE_URL`); `scripts/backup-cron.sh` (r110) is the host-cron wrapper around it (loads the env file without printing values, runs the backup with `--keep`, appends a one-line ledger, propagates the exit code, optional off-VM upload via `BACKUP_PRESIGNED_PUT_URL`) — install the crontab line from `docs/DISASTER_RECOVERY.md` § "Automated backups (r110)". **R108 honesty fix on Neon's own recovery: the Free plan's restore-history window is ~6 HOURS, not 7 days — beyond that window a pg_dump is the ONLY recovery path.** Treat the daily off-VM dump as the PRIMARY recovery mechanism, not redundancy: copy it OFF the VM (object storage / another machine), and verify restorability once by loading it into a scratch Neon branch (restore rehearsal = still an operator step before cutover). |
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
