# Final Production Topology — the single-page architecture truth (R112)

> ONE page: what runs where, which port is reachable, which secret lives in
> which service, what fails alone, what is backed up, what can scale. Deep
> dives: `docs/deployment/` (setup/cutover/rollback) ·
> `docs/deployment/SECRET_HANDLING_FINAL.md` (values) ·
> `docs/DISASTER_RECOVERY.md` (restore) ·
> `PRODUCTION_ARCHITECTURE.md` (deep engineering reference — scheduler
> economics, schema authority, lifecycles, security, history).

## 1. The request path (browser → store)

> *(Diagram corrected R118, 2026-10-06: the r112 design assumed a proxied
> Cloudflare edge + the Oracle VM; the observed live path is DNS-only + the
> self-hosted VM — see the R117 blockquote below.)*

```
 Internet
    │
    ▼
 Cloudflare DNS (DNS-only, grey cloud — observed live: NO proxy, NO edge
    │  TLS/WAF, NO WebSockets toggle in the path. The never-enacted r112
    │  design was proxied-orange + Full (strict) — see CLOUDFLARE_FINAL_CUTOVER §8)
    │  subnation.ly A → 169.58.100.161 · www → same A, **redirected www→apex at Traefik (www-redirect.yml, priority 1000, R121; 301 since the R124 redeploy 2026-10-09, 308 before it)**
    ▼
 self-hosted VM :443  (observed host: Contabo — R117 live probe; 22/80/443 public)
    │
    ▼
 Coolify's Traefik (per-service Host routers · Let's Encrypt production
    │  certs — TLS terminates HERE, at origin)
    │  router: subnation.ly / www → subnation
    ▼
 subnation container :3000  (Coolify production shape — PORT=3000 per the
    │  Wave-1 cutover record; internal only, never a host port. The docker-
    │  compose bare-VM fallback shape differs: PORT=8080 internal + host bind
    │  127.0.0.1:3000→8080 — see §4 for the full two-shape port map)
    Express 5, ONE origin serves EVERYTHING:
    ├── SPA static (frontend/dist, Arabic RTL, PWA)
    ├── /api/*            (auth, catalog, checkout, wallet, admin, SEO files)
    └── /socket.io/*      (same-origin WS — direct to origin)
```

Single-origin contract: `VITE_API_BASE_URL`/`VITE_SOCKET_URL`/`VITE_API_URL`
stay EMPTY — the browser speaks relative `/api` and same-origin WebSockets.
There is no second origin anywhere in the path.

> **Observed host (R117 live probe, 2026-10-05):** live A records for both
> `subnation.ly` and `www.subnation.ly` point at `169.58.100.161` (PTR
> `vmi3624162.contaboserver.net` — **Contabo VPS, not the Oracle VM** this page
> and the migration runbooks describe), TLS is a Let's Encrypt cert at origin,
> and no `cf-ray`/`server: cloudflare` headers appear (the Cloudflare zone is
> DNS-only, grey-cloud). Verify and reconcile: if the fleet moved hosts, update
> the DR/backup runbook host references (`ORACLE_FINAL_SETUP.md`,
> `DISASTER_RECOVERY.md`) to the real host. *(Reconciled R118, 2026-10-06 —
> the host-naming truth pass landed across this docs tree.)*

## 2. The OTP path (login code via WhatsApp)

```
 subnation container
    │  WHATSAPP_OTP_BASE_URL=http://openwa:2785   (docker-network service name;
    │  X-API-Key == OPENWA_API_KEY)                 Coolify network, NOT public DNS)
    ▼
 openwa container :2785  (internal only — no domain, no host port)
    │  Baileys WebSocket session (subnation-otp, auto-restored from Neon at boot)
    ▼
 WhatsApp (the linked-device gateway)
```

Gateway down/cold is degraded, not fatal: backend answers `503 gateway_waking`
+ `Retry-After: 30`; the frontend retries. **Single-gateway rule: exactly one
openwa instance per WhatsApp credential — stop the old container before
starting a new one** (`FINAL_ROLLBACK_RUNBOOK.md` §0).

## 3. The data path

```
 subnation ──DATABASE_URL (sslmode=require)──► Neon Postgres (external)
                                             business schema (boot reconciler
                                             V1-M6…V1-M23; drizzle mirror chain
                                             0015 applied live — 0016 (R118)
                                             has landed, in merge `966d70f`;
                                             autosuspend-aware
                                             pool: small max, short idle)
 openwa   ──PERSISTENCE_URL (sslmode=require)► same Neon
                                             openwa_sessions (gateway-created,
                                             AES-256-GCM credential blobs)
```

Neon is external, TLS-only, and the single source of truth. Idle autosuspend
is a feature: `SINGLE_INSTANCE_MODE=true` means ZERO periodic coordination
queries — nothing keeps Neon awake.

## 4. Port map

| Port | Scope | What it is |
|---|---|---|
| 22/tcp | **PUBLIC** | SSH — key-only + fail2ban |
| 80/tcp | **PUBLIC** | HTTP→HTTPS redirect + Let's Encrypt ACME |
| 443/tcp | **PUBLIC** | all production traffic (HTTPS + WebSocket) |
| 8000/tcp | TEMPORARY | Coolify first-boot wizard — closed in both layers after setup |
| 3000 | internal (Coolify network) | subnation Express in the **Coolify production app** (`kjxqu…`): `PORT=3000` per the Wave-1 cutover record (`docs/project-plan/10-progress-log.md` "ports 3000") — Traefik-only reach, never a host port |
| 8080 | internal (docker network) | subnation Express in the **docker-compose bare-VM fallback shape ONLY** (`docker-compose.yml`: `PORT=8080` internal, host bind `127.0.0.1:3000→8080`) — not the Coolify production shape |
| 2785 | internal (docker network) | openwa gateway — subnation-only reach (both shapes) |
| 3001 | loopback-only (compose shape) | compose debug bind `127.0.0.1:3001→2785` |
| 5432, 6379 | nothing listens | Postgres is external (Neon); no Redis exists |

Two port shapes exist — label every mention by host: the **Coolify production
app** runs `PORT=3000` (Wave-1 cutover record; `00-system-overview.mmd` "PORT=3000");
the **docker-compose bare-VM fallback topology** (`docker-compose.yml`) runs
`PORT=8080` internal with a `127.0.0.1:3000→8080` host bind. The rows above
name which shape each port belongs to.

Two-layer rule: a port is reachable only if BOTH the provider security group
(e.g. the Contabo firewall, if enabled) and the host iptables/ufw allow it.
Original contract + `ss -tlnp` expectations:
`ORACLE_FINAL_SETUP.md` §6 (Oracle-era provisioning guide — adapt the
provider-console part to the actual host).

## 5. Secrets map (values: `SECRET_HANDLING_FINAL.md`)

| Holder | Secrets |
|---|---|
| subnation resource | `DATABASE_URL` · `SESSION_SECRET` · `ENCRYPTION_KEY` (64 hex) · `ENCRYPTION_KEY_PREV` (optional — decrypt-only rotation fallback, R118 crypto v2; drop after the re-encrypt job drains all v1+v2 blobs) · `ADMIN_JWT_SECRET` (≠ session) · `WHATSAPP_OTP_API_KEY` (+ optional integrations) |
| openwa resource | `OPENWA_API_KEY` · `PERSISTENCE_URL` · `OPENWA_CREDENTIALS_KEY` (generate-ONCE, restore-verbatim) (+ optional `DASHBOARD_*`) |

The ONE cross-service equality: `OPENWA_API_KEY` == `WHATSAPP_OTP_API_KEY`
(the gateway auth pair — any mismatch rejects every OTP). Everything else is
service-scoped; the secret family is pairwise distinct. Offline encrypted
backup is mandatory — five of these can never be re-derived.

## 6. Failure boundaries (what dies alone)

| Failure | What you see | Blast radius | Recovery |
|---|---|---|---|
| openwa container | OTP requests → 503 + `Retry-After`; store + admin + sockets fully alive | OTP only | restart/redeploy; session auto-restores from Neon |
| subnation container | Traefik 502 on the domain; DNS still points at the VM; openwa idles | whole app surface | Coolify redeploy; boot migrations no-op; `FINAL_ROLLBACK_RUNBOOK.md` §1 |
| Traefik (Coolify edge) | 502/timeout on EVERYTHING public — containers still run | all public traffic | `docker restart` the Coolify edge container |
| Whole VM | Cloudflare answers DNS but the origin is gone (DNS-only zone: browsers get connection timeouts / no answer) | entire stack | re-provision VM (`ORACLE_FINAL_SETUP.md` — Oracle-era guide, adapt for the Contabo console) + Coolify (`COOLIFY_FINAL_SETUP.md`) + restore (`DISASTER_RECOVERY.md`) |
| Neon | healthz `neon` degraded→failing; DB-backed API errors; scheduled jobs retry; openwa runs on its local folder until the DB returns | all data reads/writes | Neon-side incident; `DISASTER_RECOVERY.md` scenarios |
| Cloudflare (DNS-only today) | domain-resolution issues only — no edge exists in the live path | DNS resolution | wait out the incident / `CLOUDFLARE_FINAL_CUTOVER.md` §8; if the zone were ever re-proxied, edge errors/blank return to this row |

No split-brain exists anywhere in that table: the money path is single-writer
by design (ONE subnation replica + transactional idempotency claims), and
Neon is the only persistent state.

## 7. Backup boundaries + RTO/RPO

| Asset | Backed up? | Truth |
|---|---|---|
| Neon logical dump | **YES** | nightly `scripts/backup-cron.sh` on the VM host cron (03:15 UTC, keep 14) + optional off-VM presigned PUT (`BACKUP_PRESIGNED_PUT_URL`) — the off-VM copy is the PRIMARY recovery mechanism |
| VM config / OS | no | re-provisionable from `ORACLE_FINAL_SETUP.md` in ~1 h (Oracle-era guide — adapt for the actual host) |
| Coolify config | no | re-creatable from `COOLIFY_FINAL_SETUP.md` + git |
| openwa `/data` volume | no | re-pairable via QR in minutes (Neon blobs restore first) |
| Code + compose + runbooks | yes | git is the source of truth |

**RPO = 24 h** (nightly dump + off-VM copy). **RTO = hours for the full
stack** (VM re-provision + Coolify + redeploy + the DISASTER_RECOVERY restore
drill); DB-only restores target 30–60 min (`DISASTER_RECOVERY.md` scenarios
A/B). Neon Free's own restore history is only ~6 h — the nightly off-VM dump
is the real safety net.

## 8. Scaling truth

- **ONE subnation replica.** `SINGLE_INSTANCE_MODE` is a contract, not a
  suggestion: there is no leader election in this mode, so a second replica
  double-runs every cron (retention, alerting, sweeps). Vertical scaling only.
- **ONE openwa instance.** The WhatsApp single-gateway rule (§2) — full stop.
- **Vertical only** on the VM: resize per the operator's host plan (the
  live host is a Contabo VPS — R117 observed; the VM shape is not recorded
  in this repo, record it here when known). Historical note: the original
  r107-era target was Oracle Always Free A1, then capped at **2 OCPU /
  12 GB total** since 2026-06-15 — that A1 allowance no longer applies.
- **Neon is external and scales independently** — tier upgrades (PITR, compute)
  never touch this topology.

## 9. What this architecture deliberately does NOT have

| Missing | Why (one line) |
|---|---|
| Redis | every consumer has a bounded in-memory fallback; Redis would add a stateful paid service to save nothing — and the distributed lock it enabled was the Neon-killer lease (r108 economics) |
| Dedicated worker tier | no essential function may depend on a worker existing (2026-09-20 free round); all jobs run in-process under SINGLE_INSTANCE_MODE |
| Keep-alive / self-ping traffic | idle Neon autosuspend IS the design (~0.5 idle q/h vs 144 q/h lease); the 2026-09-20 purge removed every artificial request |
| Multi-region / HA | one VM is the whole compute surface by economics; DNS TTL 300 s + Cloudflare grey-cloud are the levers, and the single-writer DB would serialize any second region anyway |
