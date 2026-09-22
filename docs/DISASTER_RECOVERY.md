# Disaster Recovery Runbook — SubNation

> **Render-era document (written 2026-09 against the pre-migration stack).**
> The Render/Vercel procedures below are the LEGACY ROLLBACK PATH — valid
> until the Phase-6 deletion, kept per mission §63. Post-migration recovery
> for the Oracle/Coolify stack: `docs/deployment/MIGRATION_RUNBOOK.md`
> Phase 6 + `docs/deployment/COOLIFY_ORACLE_MIGRATION.md` §12 (rollback),
> §13 (backup/restore), §14 (troubleshooting).

**Scope:** the live Render service `srv-d7vv91tckfvc73evnccg` (web canonical at `https://subnation.ly`) backed by Neon Postgres (project calm-art-99771185, us-east-1). No Redis is provisioned in the current free-tier deployment (an optional Redis tier exists only on paper — see `OPERATIONS_RUNBOOK.md` §5). This runbook is platform-specific.

## RTO / RPO targets

| System                                 | RTO                                             | RPO                                                                               |
| -------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------- |
| Neon Postgres (auth, orders, products) | **≤ 30 min** (restore from Neon branch history) | **≤ 24 h** (with daily off-site backup; **≤ 60 s** on Neon paid tier with PITR)   |
| Application code                       | < 5 min                                         | 0 — git is source of truth                                                        |
| Render service config                  | < 15 min                                        | 0 — `render.yaml` is checked in                                                   |
| Sentry / observability                 | n/a                                             | n/a — best-effort capture; loss of error events does not affect product behaviour |

> No Redis RTO row: no Redis service is provisioned (2026-09-20 free-tier
> round). If an optional Redis is ever attached, its loss would only reset
> rate-limit windows + alerting dedup — transient, no recovery action.

## Backup inventory

### 1. Neon branch history (in-place restore)

Free tier: 7-day branch history. Launch tier: configurable up to 14 days.  
Access: https://console.neon.tech/app/projects → SubNation → Branches → main → Restore.

**This is the fastest restore path** — no external upload, no `pg_restore`. Pick a timestamp within the retention window and Neon spins up a new branch from that point.

### 2. Off-site `pg_dump` backups (this repo)

Script: `scripts/src/backup-db.ts` (run via `pnpm run db:backup`).  
Behaviour: streams `pg_dump --no-owner --no-privileges --format=plain` through `gzip` to `./backups/subnation-<ISO>.sql.gz`. Local retention (r110): the newest `--keep <N>` dumps (default 14) are kept — older files matching the exact generated name are pruned after each successful run.  
Optional upload: set `BACKUP_PRESIGNED_PUT_URL` to a presigned PUT URL from any S3-compatible provider (Backblaze B2, Cloudflare R2, AWS S3) — file is HTTP PUT after the local write completes.
Nightly automation (r110): `scripts/backup-cron.sh` — see [Automated backups](#automated-backups-r110--host-cron-on-the-oracle-vm) below.

**Local invocation (any Postgres-client-equipped shell):**

```bash
DATABASE_URL=postgresql://... pnpm run db:backup
```

**Render Cron Job invocation (provision separately) — LEGACY (Render, pre-migration):**

> Post-migration on Oracle: automated — `scripts/backup-cron.sh` installed in
> the VM host crontab (see "Automated backups" below).
> `docs/deployment/COOLIFY_ORACLE_MIGRATION.md` §13 keeps the asset table.
> The backup script itself is hosting-neutral and unchanged.

1. Create a new Render Cron Job (free tier supports cron jobs ≤ 15 min runtime).
2. Build command: `pnpm install --frozen-lockfile`.
3. Start command: `pnpm run db:backup`.
4. Schedule: `0 3 * * *` (daily at 03:00 UTC).
5. Env vars:
   - `DATABASE_URL` (sync from web service or paste manually)
   - `BACKUP_PRESIGNED_PUT_URL` (issue per-day; or use a long-lived bucket-write key with a small wrapper)
6. Region: Oregon (matches the web service).

### 3. Application code

Git repository on GitHub (`ahmadmedo1012/SubNation2`), main branch. Branch protection: require CI green + 1 reviewer (already enforced by CI workflow). Commit history is the recovery source of truth.

### 4. Render service config — LEGACY (pre-migration)

`render.yaml` checked in. Re-applying via `render blueprint apply` recreates the web service definition modulo `sync: false` secrets, which must be repopulated from password manager. Post-migration the stack definition is `docker-compose.yml` + Coolify (re-provision from `docs/deployment/COOLIFY_ORACLE_MIGRATION.md` + git).

### 5. Secrets

Owner-managed. Rotation procedure: rotate from the source of truth for each secret
(e.g. BotFather for TELEGRAM_BOT_TOKEN, Neon console for DATABASE_URL,
Sentry dashboard for DSNs) then update the matching Render env var and
redeploy. The list of `sync: false` keys on the Render service *(r99 —
regenerated verbatim from render.yaml; the previous list predated rounds
93–98 and was missing over half the keys — dangerous in the rotation
scenario below, where this list IS the runbook)*:

- **Core secrets**: `DATABASE_URL`, `SESSION_SECRET`, `ADMIN_JWT_SECRET`, `ENCRYPTION_KEY`, `METRICS_ADMIN_TOKEN`
- **Origins**: `FRONTEND_ORIGINS`, `VITE_SENTRY_DSN`, `VITE_GSC_VERIFICATION`, `VITE_GA_TRACKING_ID`
- **Firebase**: `FIREBASE_SERVICE_ACCOUNT_JSON`, `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`
- **WhatsApp/OpenWA**: `WHATSAPP_OTP_BASE_URL`, `WHATSAPP_OTP_API_KEY`, `WHATSAPP_OTP_SETTLE_MS`
- **Telegram**: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_ADMIN_IDS`
- **Seed/admin**: `ADMIN_USERNAME`, `ADMIN_PASSWORD`
- **Sentry**: `SENTRY_AUTH_TOKEN`, `SENTRY_DSN` (both `sync: false` — NOT `generateValue`), `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_DASHBOARD_URL`
- **Dashboards/alerting**: `RENDER_DASHBOARD_URL`, `NEON_DASHBOARD_URL`, `ALERTING_RUNBOOK_URL`, `DISCORD_WEBHOOK_URL`, `GENERIC_ALERT_WEBHOOK_URL`
- **AI (dormant until worker tier)**: `COPILOT_PROVIDER`, `COPILOT_API_KEY`, `COPILOT_MODEL`, `COPILOT_BASE_URL`, `ENRICHMENT_DAILY_TOKEN_CAP`, `ENRICHMENT_PER_RUN_CAP`

Keep these in a password manager (1Password / Bitwarden) with the service entry "SubNation Render".

## Automated backups (r110 — host cron on the Oracle VM)

> **Status (r110): automated in-repo, operator installs once.**
> `scripts/backup-cron.sh` is the cron wrapper; the crontab line below must
> exist on the VM for backups to run. Until it is installed, backups remain
> manual-only. This closes the R109 §27 P1 gap ("no automated backup before
> cutover").

**What the wrapper does per run** — `backup-cron.sh <REPO_DIR> [ENV_FILE]`:

1. Resolves the repo checkout and loads the env file (`KEY=VALUE` lines,
   parsed without sourcing, **values never printed**): needs `DATABASE_URL`,
   honours optional `BACKUP_DIR` / `BACKUP_KEEP` / `BACKUP_PRESIGNED_PUT_URL`
   / `BACKUP_CRON_LOG`.
2. Runs the in-repo backup with the repo's own tsx:
   `pnpm --filter @workspace/scripts run backup --keep <N>` — exactly what
   root `pnpm run db:backup` resolves to; `--keep` defaults to 14.
3. Appends ONE ledger line to the log — `<UTC timestamp> exit=<code>
   file=<name|-> keep=<N>` — no secrets.
4. Propagates the backup's exit code so cron flags the failure.

**Why host cron and not the app container:** the app runtime image has no
`pg_dump` (adding `postgresql-client` plus the DB credentials to the app
image would widen the blast radius), and a host-level job keeps taking
backups while the app container is down or redeploying — exactly when you
want them.

### One-time install (on the VM, as root)

```bash
# Repo convention for the VM host: /opt/subnation (the Coolify doc builds
# from git and fixes no host-side path; any path works — pass it to the
# wrapper as its first argument).
git clone https://github.com/ahmadmedo1012/SubNation2 /opt/subnation
cd /opt/subnation && pnpm install --frozen-lockfile
apt install -y postgresql-client # provides pg_dump

# env file (root-only readable; nothing below ever prints its values)
install -m 600 /dev/null /opt/subnation/.env
cat >> /opt/subnation/.env <<'EOF'
DATABASE_URL=postgresql://...?sslmode=require
BACKUP_DIR=/var/backups/subnation
BACKUP_KEEP=14
# optional off-VM copy: BACKUP_PRESIGNED_PUT_URL=https://... (see below)
EOF

# smoke-test once before scheduling — expect a "✓ backup complete" line
/opt/subnation/scripts/backup-cron.sh /opt/subnation
```

Set `BACKUP_DIR` explicitly as above: run through pnpm, the script's
`./backups` default resolves relative to the `scripts/` package dir
(`scripts/backups/`), not the repo root.

### Crontab (root, `crontab -e`)

```cron
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
30 4 * * * /opt/subnation/scripts/backup-cron.sh /opt/subnation >> /var/log/subnation-backup.log 2>&1
```

- `30 4 * * *` — daily 04:30 UTC: low-traffic window for the .ly audience;
  the dump runs for minutes and does not affect the Neon autosuspend
  economics (`COOLIFY_ORACLE_MIGRATION.md` §9).
- The `PATH=` line matters — cron's default PATH is minimal and pnpm/node
  usually live outside it; adjust to the output of `command -v pnpm`.
- The redirect sends the full run transcript to the same file as the
  one-line ledger (`/var/log/subnation-backup.log`; when `/var/log` is not
  writable — non-root install — the wrapper falls back to
  `<REPO_DIR>/backups/backup-cron.log`, or honours `BACKUP_CRON_LOG`).

### Retention policy

- **Local (on the VM):** newest **14** dumps kept (`--keep`, override with
  `BACKUP_KEEP` in the env file). Only files matching the exact generated
  `subnation-<ISO>.sql.gz` name are ever pruned, and only after a fully
  successful run — a failed night never deletes the last good backup.
- **Off-VM:** not managed by this job — see below.

### Off-VM copy (the copy that actually matters)

`BACKUP_PRESIGNED_PUT_URL` stays the documented option — backup-db.ts
HTTP-PUTs every successful dump to it. **Presigned URLs expire** (the
examples use `--expires-in 86400`, i.e. 24 h; S3 sigv4 caps at 7 days), so
the value in the env file must be re-issued periodically. Until the
operator automates that re-issue (e.g. a weekly `aws s3 presign` cron) or
switches to an `rclone`/`rsync` copy with long-lived credentials plus a
bucket lifecycle rule ("keep daily 30 days, then delete"), treat the
off-VM copy as best-effort. Losing the VM loses every local backup, and
Neon Free's restore-history window is only ~6 h
(`COOLIFY_ORACLE_MIGRATION.md` §13) — the nightly off-VM dump is the
PRIMARY recovery mechanism, not redundancy.

### Checking health

`tail -n 5 /var/log/subnation-backup.log` — every line should read
`... exit=0 file=subnation-<ISO>.sql.gz keep=14`; a non-zero `exit=` means
open the transcript just above that line. No alerting is wired to this
ledger yet (honest) — fold the check into the weekly ops pass, or wire it
to the alerting webhook later.

### Security note (r110)

backup-db.ts passes the connection to pg_dump via libpq `PG*` environment
variables instead of a command-line connstring — the DB password is no
longer visible in `ps` output on the backup host (R109 §27 P2 fix).

## Recovery scenarios

### Scenario A — A single table corrupted by a bad migration / app bug

1. Stop traffic if necessary: Render Dashboard → service → Maintenance Mode
   (LEGACY — post-migration: stop the `subnation` container in Coolify or
   enable a Cloudflare maintenance rule).
2. Open Neon Console → SQL Editor.
3. From a known-good Neon branch (or a `pg_dump` artifact), run a targeted restore:
   ```sql
   -- Drop affected rows
   BEGIN;
   DELETE FROM <table> WHERE <broken predicate>;
   -- Re-insert from backup (use psql --command='\copy ...' from gunzipped dump)
   COMMIT;
   ```
4. Verify count + a smoke query.
5. Disable maintenance mode.

**RTO target: 30 min.**

### Scenario B — Full DB loss / Neon project deleted

1. Spin up a new Neon project. Same region (aws-us-east-1). Same role name (`neondb_owner`).
2. Get the new connection string.
3. Restore the latest off-site backup:
   ```bash
   gunzip -c subnation-<ISO>.sql.gz | psql "<NEW_DATABASE_URL>"
   ```
4. Update `DATABASE_URL` in Render Dashboard → Environment (LEGACY —
   post-migration: update the compose `.env` — from
   `deploy/env.compose.example` — in Coolify).
5. Render auto-redeploys (post-migration: redeploy the container in Coolify).
6. Verify: `curl -s -H "Authorization: Bearer $ADMIN_JWT" https://subnation.ly/api/healthz/ready | jq .checks.neon` → `status: ok` (`/ready` is admin-gated — a bare curl gets 401).

**RTO target: 60 min** (most of the time is the `psql` restore, ~1 min/MB of dump).

### Scenario C — Application failed deploy (bad commit went to main) — LEGACY (Render, pre-migration)

> Post-migration equivalent: redeploy the previous Coolify deployment (or pin
> an older image tag in compose) — `docs/deployment/COOLIFY_ORACLE_MIGRATION.md`
> §12.

1. Render Dashboard → Service → Deploys → click the previous-known-good deploy → **Rollback**.
2. Render serves the rolled-back artifact within ~30 s.
3. Open a hotfix branch from the bad commit, fix forward, push.
4. Verify CI green; merge.

**RTO target: 5 min.**

### Scenario D — Region outage (Render Oregon down) — LEGACY (Render, pre-migration)

> Post-migration: single-VM topology — no region failover. VM-level recovery =
> snapshot `/data/coolify` + re-provision the stack from
> `docs/deployment/COOLIFY_ORACLE_MIGRATION.md` + git (§13); watch Oracle's
> status page instead of status.render.com.

1. Subscribe to https://status.render.com — usually within 15 min an estimate appears.
2. If outage > 1 h, consider failover:
   - Spin up the same blueprint in Render's Frankfurt or Virginia region.
   - Update DNS records `subnation.ly` A/AAAA → new region's edge IP (Render dashboard exports this).
   - Wait for DNS TTL (currently 300 s — set in the registrar).
3. Most outages resolve in < 1 h. If users are reporting 502s, a status-page note is more valuable than a half-baked failover.

**RTO target: 90 min for full failover; 30 min for status-page communication.**

### Scenario E — Security breach (suspected unauthorized access)

1. Rotate every `sync: false` secret in the Render dashboard (LEGACY —
   post-migration: rotate them in the compose `.env` / Coolify env).
   Order matters: Firebase admin first (highest blast radius), then SESSION_SECRET (forces all users to log out — this is desirable), then DATABASE_URL.
2. Open `/admin/system` → review:
   - Recent alerts panel
   - Auth & Security panel (failure rate, lockouts, Firebase failures)
   - HTTP Request Analytics (top routes, error rate)
3. Run `SELECT * FROM auth_activity ORDER BY created_at DESC LIMIT 100` in Neon SQL Editor.
4. Run `SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100` (after Phase 1.6 ships).
5. Patch root cause before re-enabling traffic.

**RTO target: variable; rotate-and-monitor takes ~2 h.**

## Restore drill schedule

Quarterly. Calendar events on the 1st of January / April / July / October.

**Drill procedure (Scenario B — full-DB restore into a scratch Neon branch):**

1. Locate the newest `subnation-<ISO>.sql.gz` in the backup dir (the nightly
   cron produces one — see "Automated backups"); or take a fresh one via
   `pnpm run db:backup`.
2. Spin up a throwaway Neon branch via Console → "New branch from main".
3. Restore the dump into it:
   ```bash
   gunzip -c subnation-<ISO>.sql.gz | psql "<branch-url>"
   ```
4. Run smoke queries on the branch:
   ```sql
   SELECT count(*) FROM users;
   SELECT count(*) FROM products;
   SELECT count(*) FROM orders;
   SELECT count(*) FROM admin_users;
   ```
5. Compare against current production:
   ```sql
   -- on prod
   SELECT count(*) FROM users;
   ```
6. Confirm difference is 0 (or accounted for by writes since the backup time).
7. Delete the throwaway branch.
8. Record the run in the drill ledger below (date, scenario, steps, result,
   operator). Never backfill — a drill that was not executed does not go in
   the ledger.

**Drill ledger (r110):**

| Date             | Scenario                                  | Steps                 | Result                                                                                                                                                                                                                       | Operator |
| ---------------- | ----------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| PENDING-OPERATOR | B — full-DB restore into a scratch branch | procedure above (1–8) | **NOT EXERCISED** — r110 automated the nightly backup but could not run a drill: the remediation sandbox has no live `DATABASE_URL` and no `pg_dump`/`psql` binaries. First drill is a pre-cutover requirement (`COOLIFY_ORACLE_MIGRATION.md` §13) | —        |

## Emergency contacts

Operator: ahmadmedo1012  
Telegram bot: configured (see `TELEGRAM_CHAT_ID` env)  
Sentry alerts: routed to operator email + Telegram via webhook

## Lessons learned log

- **2026-05-16:** Neon free-tier compute hours exhausted during the secret-rotation window. Symptom: every Postgres query timed out at exactly 937 ms (Neon edge proxy fast-fail). Resolution: upgraded to Neon Launch tier; queries resumed. Prevention: monitor Neon usage page weekly; budget alarm at 70% of monthly compute hours.
- **2026-05-16:** `DATABASE_URL` was accidentally cleared from Render env during rotation — new deploys failed at boot with "DATABASE_URL is not set". Resolution: restored from password manager. Prevention: always Edit (don't delete) secret values during rotation.

## Documentation updates

Update this runbook after every:

- Real incident (add to Lessons Learned).
- Drill (update the drill ledger above).
- Infrastructure change (Neon tier upgrade, region change, new managed service).
- Secret rotation procedure change.

Quarterly review on the same calendar as the drill.
