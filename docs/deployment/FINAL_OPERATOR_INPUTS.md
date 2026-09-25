# FINAL OPERATOR INPUTS — what ONLY the human operator provides (R112)

> Everything engineering can prepare is prepared and on GitHub. The cutover
> now waits exclusively on the inputs below — none of them can be supplied
> (or safely guessed) by any agent. Each row lists exactly what is needed,
> where it goes, and which doc walks you through it.

## ORACLE (the VM)

| Input | What exactly | Goes into |
|---|---|---|
| VM provisioning | An Always-Free-eligible Ampere A1 VM: **aarch64**, min 2 OCPU / 6 GB RAM, 50 GB boot volume, Ubuntu 24.04, your SSH public key | Oracle console — full walk-through: `docs/deployment/ORACLE_FINAL_SETUP.md` §1 |
| VM public IP | The reserved public IPv4 of that VM | Cloudflare A record + `scripts/dns-cutover-check.sh <domain> <ip>` |
| SSH access | The key pair for `ubuntu@<ip>` (agent never holds it) | every ORACLE step |

## CLOUDFLARE (DNS)

| Input | What exactly | Goes into |
|---|---|---|
| Domain control | DNS editing rights for **subnation.ly** in Cloudflare | `docs/deployment/CLOUDFLARE_FINAL_CUTOVER.md` §records |
| DNS edit action | The A record switch itself — deliberately NEVER automated | cutover checklist §C |
| Optional: scoped API token | ONLY if you later want API-driven DNS checks (not needed for cutover; dashboard suffices) | — |

## NEON (the database)

| Input | What exactly | Goes into |
|---|---|---|
| `DATABASE_URL` | The production Neon connection string (PG 17, `sslmode=require`) — it already exists; the operator copies it into the VM `.env` | `.env` + Coolify SubNation env |
| `PERSISTENCE_URL` | The openwa persistence string (same Neon DB is fine — openwa self-creates `openwa_sessions`) | `.env` + Coolify OpenWA env |
| (Optional) a scratch DB/branch | For the on-VM restore drill | `docs/deployment/FINAL_RESTORE_DRILL.md` |

## GITHUB (source of truth for builds)

| Input | What exactly | Goes into |
|---|---|---|
| Coolify ↔ GitHub connection | Link your GitHub account in Coolify (read access to `ahmadmedo1012/SubNation2` is enough) | `docs/deployment/COOLIFY_FINAL_SETUP.md` §prerequisites |
| GHCR pull access | Public images: `ghcr.io/ahmadmedo1012/openwa:sha-<short>` (public); `subnation2` images are a manual-dispatch fallback | §image strategy in `docker-compose.yml` header |

## APPLICATION (production secrets)

| Input | What exactly | Goes into |
|---|---|---|
| The five generated secrets | Run `scripts/generate-production-secrets.sh` (on the VM), store the output in your password manager + the encrypted offline backup, paste into the Coolify env screens | `docs/deployment/SECRET_HANDLING_FINAL.md` |
| Optional integration secrets | Telegram bot token / Discord webhook / Sentry DSN — only if you want those channels live | `docs/deployment/FINAL_PRODUCTION_ENV.md` §optional |

## OPERATOR (the human steps)

| Input | What exactly | Doc |
|---|---|---|
| TOTP enrollment | Enable 2FA on the `ahmadmedo` admin account (scan QR, save recovery path) | `docs/operations/FINAL_ADMIN_TOTP_SETUP.md` |
| Inventory data | Load real stock via the admin bulk-upload (45 active products currently hold **1 deliverable unit** — netflix-premium) | `docs/operations/FINAL_INVENTORY_LOADING.md` |
| Backup target (recommended) | A B2/R2/S3 bucket + one presigned PUT URL so backups leave the VM | `docs/DISASTER_RECOVERY.md` + `scripts/backup-preflight.sh` §5 |
| First on-VM restore drill | The sandbox drill passed (2026-09-25); re-run once on the VM for tooling parity | `docs/deployment/FINAL_RESTORE_DRILL.md` |

## What is deliberately NOT requested

- **No Redis, no worker tier** — single-instance contract (`docs/deployment/NEON_IDLE_ECONOMICS.md`).
- **No Render API token** — Render stays a cold legacy fallback; its services stay suspended until you decide their fate (`docs/deployment/RENDER_LEGACY_FALLBACK.md`).
- **No Vercel token** — the SPA ships from the same origin as the API.
- **No Cloudflare API token** for cutover — dashboard-only by design.
- **No WhatsApp credentials to any human/agent** — the QR pairing happens on the VM, in the gateway dashboard, by you.
