# Disaster Recovery Runbook — SubNation

**Scope:** the live Render service `srv-d7vv91tckfvc73evnccg` (web canonical at `https://subnation.ly`) backed by Neon Postgres + Redis Cloud. This runbook is platform-specific. For background see `PRODUCTION_READINESS_MASTER.md` Phase 2.

## RTO / RPO targets

| System | RTO | RPO |
|---|---|---|
| Neon Postgres (auth, orders, products) | **≤ 30 min** (restore from Neon branch history) | **≤ 24 h** (with daily off-site backup; **≤ 60 s** on Neon paid tier with PITR) |
| Application code | < 5 min | 0 — git is source of truth |
| Render service config | < 15 min | 0 — `render.yaml` is checked in |
| Redis Cloud | < 15 min | **30 min** (durable state is rate-limit windows + alerting dedup; loss = transient blip, no recovery action needed) |
| Sentry / observability | n/a | n/a — best-effort capture; loss of error events does not affect product behaviour |

## Backup inventory

### 1. Neon branch history (in-place restore)

Free tier: 7-day branch history. Launch tier: configurable up to 14 days.  
Access: https://console.neon.tech/app/projects → SubNation → Branches → main → Restore.

**This is the fastest restore path** — no external upload, no `pg_restore`. Pick a timestamp within the retention window and Neon spins up a new branch from that point.

### 2. Off-site `pg_dump` backups (this repo)

Script: `scripts/src/backup-db.ts` (run via `pnpm run db:backup`).  
Behaviour: streams `pg_dump --no-owner --no-privileges --format=plain` through `gzip` to `./backups/subnation-<ISO>.sql.gz`.  
Optional upload: set `BACKUP_PRESIGNED_PUT_URL` to a presigned PUT URL from any S3-compatible provider (Backblaze B2, Cloudflare R2, AWS S3) — file is HTTP PUT after the local write completes.

**Local invocation (any Postgres-client-equipped shell):**
```bash
DATABASE_URL=postgresql://... pnpm run db:backup
```

**Render Cron Job invocation (provision separately):**
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

### 4. Render service config

`render.yaml` checked in. Re-applying via `render blueprint apply` recreates the web service definition modulo `sync: false` secrets, which must be repopulated from password manager.

### 5. Secrets

Owner-managed. Rotation procedure documented in `SECRET_ROTATION_RUNBOOK.md`. The list of `sync: false` keys on the Render service:
- `DATABASE_URL`
- `SESSION_SECRET`
- `ENCRYPTION_KEY`
- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `VITE_FIREBASE_*` (the 8 Firebase web config keys)
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
- `ADMIN_USERNAME`, `ADMIN_PASSWORD`
- `SENTRY_AUTH_TOKEN`, `SENTRY_DSN` (the latter is `generateValue: true`)

Keep these in a password manager (1Password / Bitwarden) with the service entry "SubNation Render".

## Recovery scenarios

### Scenario A — A single table corrupted by a bad migration / app bug

1. Stop traffic if necessary: Render Dashboard → service → Maintenance Mode.
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

1. Spin up a new Neon project. Same region (US-West-2). Same role name (`neondb_owner`).
2. Get the new connection string.
3. Restore the latest off-site backup:
   ```bash
   gunzip -c subnation-<ISO>.sql.gz | psql "<NEW_DATABASE_URL>"
   ```
4. Update `DATABASE_URL` in Render Dashboard → Environment.
5. Render auto-redeploys.
6. Verify: `curl -s https://subnation.ly/api/healthz/ready | jq .checks.neon` → `status: ok`.

**RTO target: 60 min** (most of the time is the `psql` restore, ~1 min/MB of dump).

### Scenario C — Application failed deploy (bad commit went to main)

1. Render Dashboard → Service → Deploys → click the previous-known-good deploy → **Rollback**.
2. Render serves the rolled-back artifact within ~30 s.
3. Open a hotfix branch from the bad commit, fix forward, push.
4. Verify CI green; merge.

**RTO target: 5 min.**

### Scenario D — Region outage (Render Oregon down)

1. Subscribe to https://status.render.com — usually within 15 min an estimate appears.
2. If outage > 1 h, consider failover:
   - Spin up the same blueprint in Render's Frankfurt or Virginia region.
   - Update DNS records `subnation.ly` A/AAAA → new region's edge IP (Render dashboard exports this).
   - Wait for DNS TTL (currently 300 s — set in the registrar).
3. Most outages resolve in < 1 h. If users are reporting 502s, a status-page note is more valuable than a half-baked failover.

**RTO target: 90 min for full failover; 30 min for status-page communication.**

### Scenario E — Security breach (suspected unauthorized access)

1. Rotate every secret listed in `SECRET_ROTATION_RUNBOOK.md`. Order matters: Firebase admin first (highest blast radius), then SESSION_SECRET (forces all users to log out — this is desirable), then DATABASE_URL.
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

**Drill procedure:**
1. Take a fresh `pg_dump` via `pnpm run db:backup` (write to local).
2. Spin up a throwaway Neon branch via Console → "New branch from main".
3. `psql "<branch-url>" < backup-file`.
4. Run smoke queries:
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
8. Document in this file: drill date, backup age tested, rows verified, anomalies found.

| Drill date | Backup tested | Rows verified | Anomalies | Operator |
|---|---|---|---|---|
| _(none yet — first drill due before public launch)_ | | | | |

## Emergency contacts

Operator: ahmadmedo1012  
Telegram bot: configured (see `TELEGRAM_CHAT_ID` env)  
Sentry alerts: routed to operator email + Telegram via webhook

## Lessons learned log

- **2026-05-16:** Neon free-tier compute hours exhausted during the secret-rotation window. Symptom: every Postgres query timed out at exactly 937 ms (Neon edge proxy fast-fail). Resolution: upgraded to Neon Launch tier; queries resumed. Prevention: monitor Neon usage page weekly; budget alarm at 70% of monthly compute hours.
- **2026-05-16:** `DATABASE_URL` was accidentally cleared from Render env during rotation — new deploys failed at boot with "DATABASE_URL is not set". Resolution: restored from password manager. Prevention: `SECRET_ROTATION_RUNBOOK.md` Phase 3 reworded to emphasize "Edit (don't delete)".

## Documentation updates

Update this runbook after every:
- Real incident (add to Lessons Learned).
- Drill (update the table above).
- Infrastructure change (Neon tier upgrade, region change, new managed service).
- Secret rotation procedure change.

Quarterly review on the same calendar as the drill.
