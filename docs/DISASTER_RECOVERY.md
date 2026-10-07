# Disaster Recovery Runbook — SubNation

> **THE disaster-recovery source of truth for the current (self-hosted VM +
> Coolify) stack.** The Render/Vercel procedures are the LEGACY ROLLBACK PATH —
> clearly marked below and kept until the Phase-6 deletion. Current-stack
> recovery procedure map: `docs/deployment/FINAL_ROLLBACK_RUNBOOK.md`
> (decision matrix) + `docs/deployment/FINAL_RESTORE_DRILL.md` (the drill)
> + `docs/deprecated/COOLIFY_ORACLE_MIGRATION.md` §12-§14 (the r107 guide,
> moved to `docs/deprecated/` by the R122 docs reorg).

**Scope (current stack):** the Coolify deployment on the self-hosted VM
(observed live host, R117: a Contabo VPS — not Oracle; canonical
at `https://subnation.ly` — www 308→apex since R121) backed by Neon
Postgres (project calm-art-99771185, us-east-1). No Redis is provisioned
(anywhere — the optional Redis tier on paper is retired; see
`NEON_IDLE_ECONOMICS.md` §7).

## RTO / RPO targets

| System                                 | RTO                                             | RPO                                                                               |
| -------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------- |
| Neon Postgres (auth, orders, products) | **≤ 30 min** (restore latest dump into a fresh project/branch — `FINAL_RESTORE_DRILL.md`) | **≤ 24 h** (nightly off-VM dump; Neon Free's own history window is only ~6 h — see §1 below) |
| Application code                       | < 5 min                                         | 0 — git is source of truth                                                        |
| Stack definition                       | < 30 min | 0 — `docker-compose.yml` + Coolify docs are checked in (re-provision from `COOLIFY_FINAL_SETUP.md`) |

> No Redis RTO row: no Redis service is provisioned (2026-09-20 free-tier
> round). If an optional Redis is ever attached, its loss would only reset
> rate-limit windows + alerting dedup — transient, no recovery action.

## Backup inventory

### 1. Neon restore history (in-place point-in-time restore)

**Neon Free plan: ~6-hour history window** (point-in-time restore capped at
1 GB-month of changes; scheduled backups are NOT available on Free).
Launch tier: up to 7 days. Access:
https://console.neon.tech/app/projects → SubNation → Branches → main → Restore.

Verify the current allowance at execution time — https://neon.com/docs
("Restore history" / plans page). Because the Free window is only hours,
the **nightly off-VM `pg_dump` (§2 below) is the PRIMARY recovery
mechanism**; Neon's own history is a convenience for very recent mistakes
only.

### 2. Off-site `pg_dump` backups (this repo)

Script: `scripts/src/backup-db.ts` (run via `pnpm run db:backup`).  
Behaviour: streams `pg_dump --no-owner --no-privileges --format=plain` through `gzip` to `./backups/subnation-<ISO>.sql.gz`. Local retention (r110): the newest `--keep <N>` dumps (default 14) are kept — older files matching the exact generated name are pruned after each successful run.  
Optional upload: set `BACKUP_PRESIGNED_PUT_URL` to a presigned PUT URL from any S3-compatible provider (Backblaze B2, Cloudflare R2, AWS S3) — file is HTTP PUT after the local write completes.
Nightly automation (r110): `scripts/backup-cron.sh` — see [Automated backups](#automated-backups-r110--host-cron-on-the-vm) below.

**Local invocation (any Postgres-client-equipped shell):**

```bash
DATABASE_URL=postgresql://... pnpm run db:backup
```

**Render Cron Job invocation (provision separately) — LEGACY (Render, pre-migration):**

> Post-migration on the live stack: automated — `scripts/backup-cron.sh` installed in
> the VM host crontab (see "Automated backups" below).
> `docs/deprecated/COOLIFY_ORACLE_MIGRATION.md` §13 keeps the asset table.
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

`render.yaml` preserved in git history (deleted from the working tree
2026-10-05). Re-applying via `render blueprint apply` recreates the web
service definition modulo `sync: false` secrets, which must be repopulated
from password manager. Post-migration the stack definition is
`docker-compose.yml` + Coolify (re-provision from
`docs/deprecated/COOLIFY_ORACLE_MIGRATION.md` + git).

### 5. Secrets

Owner-managed. Rotation procedure: rotate from the source of truth for each
secret (e.g. BotFather for TELEGRAM_BOT_TOKEN, Neon console for DATABASE_URL,
Sentry dashboard for DSNs), then update the matching value on the CURRENT
surface — the Coolify env panel / the compose `.env` — and redeploy.
*(LEGACY — Render, pre-migration: this procedure said "update the matching
Render env var and redeploy", and the `sync: false` list below was the
rotation checklist. `ENCRYPTION_KEY` rotation now has a documented 3-step
`ENCRYPTION_KEY_PREV` procedure — see the ENCRYPTION_KEY_PREV block in
`config/env.example`.)* The list of `sync: false` keys on the Render
service *(r99 — regenerated verbatim from render.yaml; the previous list
predated rounds 93–98 and was missing over half the keys — dangerous in
the rotation scenario, where this list WAS the runbook)*:

- **Core secrets**: `DATABASE_URL`, `SESSION_SECRET`, `ADMIN_JWT_SECRET`, `ENCRYPTION_KEY`, `METRICS_ADMIN_TOKEN`
- **Origins**: `FRONTEND_ORIGINS`, `VITE_SENTRY_DSN`, `VITE_GSC_VERIFICATION`, `VITE_GA_TRACKING_ID`
- **Firebase**: `FIREBASE_SERVICE_ACCOUNT_JSON`, `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`
- **WhatsApp/OpenWA**: `WHATSAPP_OTP_BASE_URL`, `WHATSAPP_OTP_API_KEY`, `WHATSAPP_OTP_SETTLE_MS`
- **Telegram**: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_ADMIN_IDS`
- **Seed/admin**: `ADMIN_USERNAME`, `ADMIN_PASSWORD`
- **Sentry**: `SENTRY_AUTH_TOKEN`, `SENTRY_DSN` (both `sync: false` — NOT `generateValue`), `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_DASHBOARD_URL`
- **Dashboards/alerting**: `RENDER_DASHBOARD_URL`, `NEON_DASHBOARD_URL`, `ALERTING_RUNBOOK_URL`, `DISCORD_WEBHOOK_URL`, `GENERIC_ALERT_WEBHOOK_URL`
- **AI (optional — off by default)**: copilot: `COPILOT_PROVIDER`, `COPILOT_API_KEY`, `COPILOT_MODEL`, `COPILOT_BASE_URL` — dormant until all four are set; runs in-process, NO worker tier needed. Enrichment caps: `ENRICHMENT_DAILY_TOKEN_CAP`, `ENRICHMENT_PER_RUN_CAP` — additionally gated on `WORKER_TIER=true`, which the single-instance topology never sets → permanently inert (see `docs/deployment/FINAL_PRODUCTION_ENV.md`)

Keep these in a password manager (1Password / Bitwarden) with the service
entry "SubNation (Coolify/compose env)".

## Automated backups (r110 — host cron on the VM)

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

### One-time install (on the VM, as `ubuntu`)

Host prerequisites (Node 22 + Corepack pnpm + `postgresql-client-17` —
host-neutral): **`ORACLE_FINAL_SETUP.md` §9** (Oracle-era provisioning
guide; the same toolchain applies on the Contabo host) — the backup chain
needs exactly those and `backup-preflight.sh` verifies them. This block
only wires the cron.

```bash
# Repo convention on the VM (the command book uses the same path):
git clone https://github.com/ahmadmedo1012/SubNation2 /home/ubuntu/SubNation2
cd /home/ubuntu/SubNation2 && pnpm install --frozen-lockfile

# env file (600, owner-only readable; nothing below ever prints its values)
install -m 600 /dev/null /home/ubuntu/SubNation2/.env
cat >> /home/ubuntu/SubNation2/.env <<'EOF'
DATABASE_URL=postgresql://...?sslmode=require
BACKUP_DIR=/var/backups/subnation
BACKUP_KEEP=14
# optional off-VM copy: BACKUP_PRESIGNED_PUT_URL=https://... (see below)
EOF

# backup dir writable by the ubuntu user (the cron runs unprivileged):
sudo mkdir -p /var/backups/subnation && sudo chown ubuntu:ubuntu /var/backups/subnation

# log file writable by the ubuntu user (else the wrapper falls back to
# <repo>/backups/backup-cron.log — also fine):
sudo touch /var/log/subnation-backup.log && sudo chown ubuntu:ubuntu /var/log/subnation-backup.log

# smoke-test once before scheduling — expect a "✓ backup complete" line
/home/ubuntu/SubNation2/scripts/backup-cron.sh /home/ubuntu/SubNation2
```

Set `BACKUP_DIR` explicitly as above: run through pnpm, the script's
`./backups` default resolves relative to the `scripts/` package dir
(`scripts/backups/`), not the repo root.

### Crontab (the `ubuntu` user, `crontab -e`) — THE one documented schedule

```cron
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
15 3 * * * /home/ubuntu/SubNation2/scripts/backup-cron.sh /home/ubuntu/SubNation2 >> /var/log/subnation-backup.log 2>&1
```

- `15 3 * * *` — daily 03:15 UTC: quiet window for the .ly audience, and
  deliberately BETWEEN the app's own in-process cron slots (02:15 … 05:00;
  04:30 is the auth_activity retention slot — see
  `LOGGING_AND_RETENTION_FINAL.md`), so the dump never overlaps a retention
  batch. This is the single documented schedule — every doc that mentions
  the nightly backup references this line.
- The `PATH=` line matters — cron's default PATH is minimal and pnpm/node
  usually live outside it; adjust to the output of `command -v pnpm`
  (`ORACLE_FINAL_SETUP.md` §9 explains the trap).

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
> an older image tag in compose) — `docs/deprecated/COOLIFY_ORACLE_MIGRATION.md`
> §12.

1. Render Dashboard → Service → Deploys → click the previous-known-good deploy → **Rollback**.
2. Render serves the rolled-back artifact within ~30 s.
3. Open a hotfix branch from the bad commit, fix forward, push.
4. Verify CI green; merge.

**RTO target: 5 min.**

### Scenario D — Region outage (Render Oregon down) — LEGACY (Render, pre-migration)

> Post-migration: single-VM topology — no region failover. VM-level recovery =
> snapshot `/data/coolify` + re-provision the stack from
> `docs/deprecated/COOLIFY_ORACLE_MIGRATION.md` + git (§13); watch the host
> provider's status page (Contabo) instead of status.render.com.

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
4. Run `SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100`.
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

**Drill ledger (r110; refreshed R118, 2026-10-06 — mirrored from
`FINAL_RESTORE_DRILL.md` §4, the ledger of record):**

| Date             | Scenario                                  | Steps                 | Result                                                                                                                                                                                                                       | Operator |
| ---------------- | ----------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 2026-09-25 (R112) | B — full-DB restore (sandbox → live Neon dump source + local scratch PG cluster) | `FINAL_RESTORE_DRILL.md` §1-5 | **PASS** — details in `FINAL_RESTORE_DRILL.md` §4 | r112 agent |
| 2026-10-01 (R115) | B — full-DB restore (release sandbox → live Neon backup source + Neon scratch branch `r115-restore-drill`) | `FINAL_RESTORE_DRILL.md` §1-5 | **PASS** — `restore-drill-check.sh` exit 0 `RESTORE DRILL DATABASE VALIDATED`; details in `FINAL_RESTORE_DRILL.md` §4 | r115 release engineer |
| PENDING-OPERATOR | B — first **ON-VM** drill (run §1-5 from the production VM itself to prove the host toolchain) | `FINAL_RESTORE_DRILL.md` §1-5 | The two PASS drills ran from engineering/release sandboxes; the first on-VM drill remains an open operator action | —        |

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
