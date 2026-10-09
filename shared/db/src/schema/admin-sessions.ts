import { index, integer, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { adminUsersTable } from "./admin_users";

/**
 * A8-01 (round-94): server-side admin session rows.
 *
 * The admin JWT used to be the ONLY source of truth — logout cleared a
 * cookie, change-password explicitly documented "does NOT invalidate
 * sessions", and a stolen bearer token kept FULL financial authority
 * (refunds, wallet adjustments, topup approvals) for its whole 8h TTL.
 * The storefront fixed this in round-92 with the `sessions` table; the
 * admin surface never got the same treatment.
 *
 * Every admin login now inserts a row here and the token carries a `sid`
 * claim. `requireAdmin` (and /probe) re-validate the row: revoked or
 * expired row ⇒ dead token, no matter what the JWT alone says. Logout
 * revokes one row; change-password and is_active flips kill them all.
 *
 * Strictness: production tokens MUST carry a sid (fail-closed — a
 * pre-migration token is rejected at worst once, the admin re-logs in).
 * Non-production keeps accepting sid-less tokens so the pglite test
 * suite's `signAdminToken({adminId, role})` fixtures keep working.
 */
export const adminSessionsTable = pgTable(
  "admin_sessions",
  {
    // sid — 32-char hex from randomUUID(). Not a serial: sessions are
    // addressed by an unguessable id, never enumerated.
    id: varchar("id", { length: 64 }).primaryKey(),
    adminId: integer("admin_id")
      .notNull()
      .references(() => adminUsersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedReason: varchar("revoked_reason", { length: 100 }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    userAgent: varchar("user_agent", { length: 255 }),
    ipAddress: varchar("ip_address", { length: 45 }),
  },
  (t) => ({
    adminIdIdx: index("idx_admin_sessions_admin").on(t.adminId),
    // R127-L3 (B7 P2-1): pruneStaleAdminSessions' predicate
    // (`expires_at < now()-24h OR (revoked_at IS NOT NULL AND
    // revoked_at < now()-30d)`, lib/admin-session.ts) had no index
    // support — only idx_admin_sessions_admin existed. The revoked_at
    // twin is PARTIAL (`WHERE revoked_at IS NOT NULL`) to cap the
    // per-insert write cost: the column is NULL until first revoke.
    // Boot twin: migrate.ts applyRetentionPruneIndexesStage (V1-M31);
    // drizzle mirror: 0020.
    expiresAtIdx: index("idx_admin_sessions_expires_at").on(t.expiresAt),
    revokedAtIdx: index("idx_admin_sessions_revoked_at")
      .on(t.revokedAt)
      .where(sql`revoked_at IS NOT NULL`),
  }),
);
