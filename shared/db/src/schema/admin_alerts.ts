import { index, pgTable, serial, varchar, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const adminAlertsTable = pgTable(
  "admin_alerts",
  {
    id: serial("id").primaryKey(),
    type: varchar("type", { length: 30 }).notNull().default("system"),
    title: varchar("title", { length: 255 }).notNull(),
    message: text("message"),
    isRead: boolean("is_read").notNull().default(false),
    // Round-5 (db-audit 2026-09-07): dedupe key for repeated operational
    // alerts (stock watchers, security advisories). NULL for one-off
    // alerts. When set, logAdminAlert skips the insert while an alert
    // with the same key is younger than the dedupe window — the
    // in-memory Sets in stockWatcher reset on every cold start (Render
    // free tier restarts often), which produced 321 unread duplicate
    // alerts for 6 permanently out-of-stock products in 12 days.
    dedupeKey: varchar("dedupe_key", { length: 100 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Serves the dedupe EXISTS lookup (key + recency) and the retention
    // sweeps in one index.
    dedupeIdx: index("idx_admin_alerts_dedupe_key").on(t.dedupeKey, t.createdAt),
    // R118-A6 F-4: the admin alerts read paths (list ORDER BY created_at
    // DESC LIMIT/OFFSET, /new is_read=false … LIMIT 50, unread-count)
    // had no supporting index — seq scan + top-N sort on every open
    // admin tab poll. PLAIN (not partial WHERE NOT is_read): the main
    // list sorts the whole table, so the partial variant would leave the
    // hottest path unindexed; the /new + unread-count queries filter
    // fine on the same btree. DESC mirrors the dominant ORDER BY. Boot
    // twin: migrate.ts must CREATE INDEX IF NOT EXISTS this name for the
    // live DB (V1-M24-class stage — see the R118-B3 report).
    createdIdx: index("idx_admin_alerts_created").on(t.createdAt.desc()),
    // R127-L3 (B8 G2): the unread-badge family — countUnreadAlerts
    // (alertLogger.ts, polled by /admin/alerts/unread-count),
    // markStaleUnreadAlertsRead (unread > 14d) and the /new drawer's
    // `is_read = false … LIMIT 50` — had no predicate-matching index
    // (idx_admin_alerts_created is full-table, createdIdx above serves
    // the sorted list). PARTIAL on the is_read = false minority slice,
    // DESC to mirror the drawer's ORDER BY. Boot twin: migrate.ts
    // applyRetentionPruneIndexesStage (V1-M31); drizzle mirror: 0020.
    unreadIdx: index("idx_admin_alerts_unread")
      .on(t.createdAt.desc())
      .where(sql`is_read = false`),
  }),
);
