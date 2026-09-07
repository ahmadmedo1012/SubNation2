import { index, pgTable, serial, varchar, text, boolean, timestamp } from "drizzle-orm/pg-core";

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
  }),
);

export type AdminAlert = typeof adminAlertsTable.$inferSelect;
