import { index, pgTable, varchar, timestamp, integer } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const sessionsTable = pgTable(
  "sessions",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    userAgent: varchar("user_agent", { length: 255 }),
    ipAddress: varchar("ip_address", { length: 45 }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdIdx: index("idx_sessions_user_id").on(t.userId),
    // R127-L3 (B7 P2-1 / B8 G1): session-prune's `expires_at < now()`
    // (jobs/session-prune.ts, daily 05:00 + boot one-shot) had no index
    // support — only idx_sessions_user_id existed. Boot twin: migrate.ts
    // applyRetentionPruneIndexesStage (V1-M31); drizzle mirror: 0020.
    expiresAtIdx: index("idx_sessions_expires_at").on(t.expiresAt),
  }),
);
