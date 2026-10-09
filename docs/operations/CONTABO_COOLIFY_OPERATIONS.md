# Contabo + Coolify Operations — SubNation

> Status: CURRENT @ 2026-10-06 (R118).
> Scope: day-2 operations for the **live** production host — what runs where,
> how to deploy, where TLS/backups live, and how this host relates to the
> older Oracle guides. Companion: `docs/deployment/COOLIFY_FINAL_SETUP.md`
> (resource creation), `docs/deployment/FINAL_ROLLBACK_RUNBOOK.md`
> (rollback), `docs/DISASTER_RECOVERY.md` (backups/DR),
> `docs/operations/FINAL_MONITORING.md` (what to watch).
> Fulfills R118-A7 F34(a) — "nothing described the live host's day-2 ops".

## 1. The host (observed facts)

- **Observed live host:** a Contabo VPS — PTR
  `vmi3624162.contaboserver.net`, A records → `169.58.100.161`
  (R117-A4 live probe, 2026-10-05, recorded as dated blockquotes in
  `docs/architecture/FINAL_PRODUCTION_TOPOLOGY.md` and
  `docs/architecture/PRODUCTION_ARCHITECTURE.md`; re-confirmed by the R118
  census origin, `R118-A6-performance.md`).
- **TLS:** Let's Encrypt certificates terminated at origin (Traefik);
  HTTP/2. Cloudflare is **DNS-only (grey)** — no `cf-ray`/edge cache in the
  live path (R117-A4; verified R118 2026-10-06, `R118-A7-docs.md` §1).
- **VM shape:** unknown to the repo (R118-A7 F10).
  **Operator: record your Contabo plan here** — plan name, vCPU/RAM/disk,
  region/datacenter — so DR + capacity docs stop guessing.

The Contabo customer console (VM stop/start/rescue, ISO mount, snapshots
per plan) replaces the Oracle Cloud console in every doc that mentions one.

## 2. Where the Oracle guides apply — and where they don't

| Older doc | Status for THIS host |
|---|---|
| `docs/deprecated/ORACLE_FINAL_SETUP.md` | The original **provisioning** guide — written for Oracle Cloud free tier (ARM64, Security Lists, OCI console). **Different cloud.** The host-neutral parts (SSH hardening, fail2ban, unattended-upgrades, docker install) still apply in spirit; every Oracle console/Security-List/shape step does not (R118-A7 F17). |
| `docs/deprecated/COOLIFY_ORACLE_MIGRATION.md` | r107 migration history — how Coolify was first installed. Useful if you ever re-provision Coolify from scratch; not the live runbook. |
| `docs/deployment/COOLIFY_FINAL_SETUP.md` | **Still authoritative** for the two Coolify resources, domains, healthchecks, and deploy order — it is host-neutral (R118-A7 verdict: accurate). |
| `docs/DISASTER_RECOVERY.md` | Authoritative for backup/restore procedures (host-neutral); its host wording was corrected to the self-hosted (Contabo) VM in the R118-B4a truth pass (2026-10-06; A7 F11). |

## 3. What runs on the VM (container layout)

Per `docker-compose.yml` (the checked-in contract) and
`COOLIFY_FINAL_SETUP.md`:

| Container | Image / build | Port | Notes |
|---|---|---|---|
| `subnation` | Built by Coolify from **this repo's git main** (Dockerfile at repo root) | 8080 (internal) | Express API + Socket.IO + the built SPA, single origin. Exactly **one replica** — `SINGLE_INSTANCE_MODE=true` (synthetic in-process leadership; no Redis, no PG-lease refresher). Healthcheck: `/api/healthz` 30 s interval / 150 s start period. |
| `openwa` | Immutable GHCR image `ghcr.io/ahmadmedo1012/openwa:sha-<short>` (sha-pinned — never `:latest`) | 2785 (internal only) | WhatsApp Baileys gateway. **No public domain** — the backend reaches it over the Coolify network at `http://openwa:2785` (`docs/WHATSAPP_OPERATIONS.md`, R117 rewrite). Healthcheck 10 s start period. |
| Coolify's own | `coolify-db` (Postgres), `coolify-redis`, the **Traefik proxy** | 80/443 | Coolify control plane + the edge router (COOLIFY_FINAL_SETUP §4). |

The two SubNation containers share one Coolify docker network (the one
Traefik watches). The production deployment must NOT depend on a sibling
`../openwa` clone — that is a local-only convenience (compose header,
R112 strategy block).

## 4. Day-2: deploying

**Deploys happen when the operator triggers them** — Coolify builds on
demand from git `main` (the resource's configured branch), passing the
deployed commit as the `GIT_SHA` build arg; every deploy is traceable to an
exact commit and rollback = redeploying an older one (compose header;
COOLIFY_FINAL_SETUP §2/§7).

> **⚠ Live is currently BEHIND main (verified R118, 2026-10-06).** The live
> entry chunk is `index-DcWfE6PS.js` while the repo build emits
> `index-BTNM_6lU.js` — production is still running a build older than the
> R116→R118 chain that is on `main` (R118-A6 F-10). Deploying main is
> **launch-blocking action #1** in
> `docs/operations/OPERATOR_ACTIONS_R118.md`.

Deploy flow (SubNation resource):

1. Ensure `main` is what you want (gates: backend/frontend suites,
   typecheck, lint, build, contract gate — see `CHANGELOG.md` per round).
2. Coolify → SubNation resource → **Redeploy** (or "Restart" only if you
   want the same commit). The builder pulls `main` and builds the Dockerfile
   with the new `GIT_SHA`.
3. Watch the deploy log; on success verify:
   - `curl -s https://subnation.ly/api/healthz` → 200,
   - the deployed-SHA gate: `/api/healthz` `.version` equals the `GIT_SHA`
     you deployed (COOLIFY_FINAL_SETUP §8; `MIGRATION_RUNBOOK.md` Ph. 4),
   - `docker ps` shows the container `Up (healthy)`.
4. OpenWA deploys independently (image resource): switch the tag to the new
   `sha-<short>` and redeploy — order is free, SubNation's OTP path is
   retryable (`503 gateway_waking` + auto-retry; COOLIFY_FINAL_SETUP §5).
5. Boot migrations run automatically and are idempotent/additive (emergency
   hatch `DISABLE_BOOT_MIGRATIONS=true`, `docs/deployment/ENVIRONMENT_MATRIX.md`).

## 5. Traefik — the router, TLS, and hostnames

Traefik (Coolify's proxy) owns 80/443 and generates the routers from the
resource's **Domains** config: `https://subnation.ly` **and**
`https://www.subnation.ly` are both attached, so two Host rules exist and
Let's Encrypt production certs cover both (COOLIFY_FINAL_SETUP §6; both
hosts must also appear in `APP_ORIGINS`).

Since R121 (2026-10-07) www → apex is a **live permanent single-hop** at
this Traefik layer (`/data/coolify/proxy/dynamic/www-redirect.yml`, priority
1000) — **301 since the R124 redeploy (2026-10-09), 308 before it** (the
status digit is Coolify-Traefik-regen-dependent); only the apex serves the
app. Design/rollback record:
`docs/operations/WWW_TO_APEX_301.md` (operator summary:
`OPERATIONS_RUNBOOK.md` §13). **Never** implement that redirect
in the app (the R116 Cloudflare-loop incident is why the in-app redirect
was removed in `f10bb9b`).

## 6. Backups — where they run

Nightly, **on the VM host** (host cron, not Coolify, not Neon):

- `scripts/backup-cron.sh` at **03:15 UTC daily** — the one documented
  crontab line (`docs/DISASTER_RECOVERY.md` §Automated backups); dumps via
  `pg_dump --no-owner --no-privileges` through gzip to `/var/backups/
  subnation/`, **keep 14**, one ledger line per run, exit code propagated so
  cron flags failures.
- Optional off-VM copy: `BACKUP_PRESIGNED_PUT_URL` (S3-compatible presigned
  PUT) — this is the copy that actually matters (DISASTER_RECOVERY §Off-VM).
- Neon's own point-in-time history is only ~6 h on the free plan — the
  nightly dump is the primary recovery path (DISASTER_RECOVERY §1).
- Two restore drills have PASSed on record (2026-09-25 R112, 2026-10-01
  R115 — `docs/deployment/FINAL_RESTORE_DRILL.md` ledger).

Check health: the backup log (`/var/log/subnation-backup.log` per the
crontab line, or `<repo>/backups/backup-cron.log`) — see
`docs/operations/FINAL_MONITORING.md` §1.

## 7. Redeploy / rollback

Full choreography: `docs/deployment/FINAL_ROLLBACK_RUNBOOK.md` — read its
§0 (the WhatsApp **single-gateway rule** — one linked device — before ANY
openwa action) and §4 (Neon compatibility truth) first.

- **SubNation (git resource):** redeploy the previous commit — older SHA +
  matching `GIT_SHA` build arg (migrations are idempotent/additive).
- **OpenWA (image resource):** switch back to the previous `sha-<short>`
  tag and redeploy (session survival notes in the runbook §5).
- **DNS:** the Cloudflare A records are DNS-only — no proxy state to roll
  back (`CLOUDFLARE_FINAL_CUTOVER.md` §8 documents the live state).

## 8. VM tooling (host-neutral)

What the runbooks assume on the host (DISASTER_RECOVERY host-prereqs :131):

- **Node 22 + Corepack pnpm** (backup/restore scripts run through pnpm),
- **postgresql-client-17** (`psql` for the verification/restoration SQL),
- **docker** (+ the docker compose plugin for local/bare-VM variant runs),
- git, plus the hardening from `docs/deprecated/ORACLE_FINAL_SETUP.md`
  §7-in-spirit (fail2ban/ssh) where not already installed.

## 9. Related docs

`docs/operations/OPERATOR_ACTIONS_R118.md` (the ordered action list) ·
`docs/operations/NEON_COLD_START_RUNBOOK.md` (DB cold-starts) ·
`docs/operations/FINAL_MONITORING.md` (cron slots, healthz, alerting) ·
`docs/deployment/FINAL_PRODUCTION_ENV.md` (the env contract) ·
`docs/deployment/SECRET_HANDLING_FINAL.md` (the two resources' secret map).
