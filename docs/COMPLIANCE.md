# SubNation Compliance & Data Retention Policy

## Data Retention Guidelines

1. **Active User Data**: Kept indefinitely while the user's account is active.
2. **Audit Logs** _(r99 — corrected; cadences re-verified r110)_: Retained indefinitely for now. **No automated purge exists yet** — the retention crons cover `admin_alerts` (30 d), `sessions` (rows pruned once expired, ≤ 30 d), `risk_events` (90 d), and whatsapp OTP rows (24 h — pruned opportunistically from OTP traffic plus at boot, not by a cron), but `audit_logs` itself has no retention job. Plan and implement a purge policy before claiming a 1-year bound externally.
3. **Session Data**: Stored until the session expires (maximum 30 days); stale rows are pruned by the daily 05:00 UTC retention cron — user sessions once expired, admin sessions expired > 24 h or revoked > 30 d (idempotent boot one-shots cover restart gaps; the pre-R109 doc's "hourly session-prune" cadence no longer exists).
4. **Deleted Accounts** _(r99 — corrected)_: **No automated deletion pipeline exists yet.** Account deletion is a manual operator procedure (support ticket → operator action in the admin panel). A soft-delete + 30-day cooling-off flow is a stated roadmap item, not implemented behavior — do not promise it to users until it lands.

## Roles & Permissions (RBAC)

- Access is scope-based (`all`, `orders`, `finance`, `inventory`, `support`, `users`, `admins`, `settings` — see `shared/permissions.ts` and `docs/API.md` §RBAC for the authoritative list). There is **no tenant/organization scoping** (r99 — the previous "Manager (tenant-scoped)" wording described a model that was never implemented).

## Backup Policies

- **Database** _(r99 — corrected, R104 — script repointed)_: Backups are **MANUAL** today (`pnpm run db:backup` → `scripts/src/backup-db.ts`; see `docs/DISASTER_RECOVERY.md`). Neon's point-in-time recovery window exists at the provider level, but no automated nightly backup job runs — provisioning one (Render Cron Job or equivalent) is an operator TODO documented in DISASTER_RECOVERY.md.
- **Drills**: Restore drills are manual and currently **not scheduled** (DISASTER_RECOVERY.md tracks the drill log as "none yet").
