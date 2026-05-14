# SubNation Compliance & Data Retention Policy

## Data Retention Guidelines

1. **Active User Data**: Kept indefinitely while the user's account is active.
2. **Audit Logs**: Retained for 1 year, then securely archived or purged.
3. **Session Data**: Stored until the session expires (maximum 30 days), then automatically cleared by TTL or cron.
4. **Deleted Accounts**: Hard deleted after 30 days of cooling-off period (soft delete first).

## Roles & Permissions (RBAC)

- **Super Admin**: Full access to all systems, billing, and organizational boundaries.
- **Admin**: Standard operational access.
- **Support**: Read-only or limited write access for customer support requests.
- **Manager**: Access scoped to specific tenant or organizational boundary.

## Backup Policies

- **Database**: Automated nightly backups via Neon, retained for 7 days (point-in-time recovery).
- **Drills**: Monthly automated or manual restore drills documented in `scripts/db-restore.sh`.
