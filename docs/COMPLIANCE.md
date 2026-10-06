# SubNation Compliance & Data Retention Policy

## Data Retention Guidelines

1. **Active User Data**: Kept indefinitely while the user's account is active.
2. **Audit Logs** _(r99 — corrected; cadences re-verified r110; **corrected R118, 2026-10-06** — the r111 B6-05 purge landed)_: Retained **180 days**, then purged automatically by the daily 05:00 UTC retention cron (`backend/src/jobs/auth-audit-retention.ts` — `AUDIT_LOGS_RETENTION_DAYS = 180`, batched 1 000 rows/run; idempotent boot one-shot covers restart gaps). The same cron prunes `login_attempts` at **7 days**. Other retention crons: `admin_alerts` (unread stale-marked at 14 d, read rows deleted at 30 d), `sessions` (rows pruned once expired, ≤ 30 d), `risk_events` (90 d), and whatsapp OTP rows (24 h — pruned opportunistically from OTP traffic plus at boot, not by a cron). Verified table of record: `docs/operations/LOGGING_AND_RETENTION_FINAL.md` §4.
3. **Session Data**: Stored until the session expires (maximum 30 days); stale rows are pruned by the daily 05:00 UTC retention cron — user sessions once expired, admin sessions expired > 24 h or revoked > 30 d (idempotent boot one-shots cover restart gaps; the pre-R109 doc's "hourly session-prune" cadence no longer exists).
4. **Deleted Accounts** _(r99 — corrected)_: **No automated deletion pipeline exists yet.** Account deletion is a manual operator procedure (support ticket → operator action in the admin panel). A soft-delete + 30-day cooling-off flow is a stated roadmap item, not implemented behavior — do not promise it to users until it lands.

## Roles & Permissions (RBAC)

- Access is scope-based (`all`, `orders`, `finance`, `inventory`, `support`, `users`, `admins`, `settings` — see `shared/permissions.ts` and `docs/API.md` §RBAC for the authoritative list). There is **no tenant/organization scoping** (r99 — the previous "Manager (tenant-scoped)" wording described a model that was never implemented).

## Backup Policies

- **Database** _(r99 — corrected, R104 — script repointed; **corrected R118, 2026-10-06** — r110 automation acknowledged)_: **Nightly automated dumps on the VM host** — `scripts/backup-cron.sh` at 03:15 UTC (keep 14, `pg_dump` via `pnpm run db:backup` → `scripts/src/backup-db.ts`) + optional off-VM presigned-PUT copy; see the "Automated backups" section of `docs/DISASTER_RECOVERY.md`. Neon's point-in-time recovery window (~6 h on Free) exists at the provider level as a convenience only — the nightly dump is the primary recovery mechanism.
- **Drills**: Restore drills executed and **PASS** — 2026-09-25 (R112) and 2026-10-01 (R115, `restore-drill-check.sh` exit 0 VALIDATED); ledger of record: `docs/deployment/FINAL_RESTORE_DRILL.md` §4 (mirrored in DISASTER_RECOVERY.md). The first **on-VM** drill remains an open operator action. Cadence: quarterly per DISASTER_RECOVERY.md.
