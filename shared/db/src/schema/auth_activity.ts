import { pgTable, serial, index, varchar, boolean, text, timestamp, integer } from "drizzle-orm/pg-core";

export const authActivityTable = pgTable(
  "auth_activity",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id"),
    identifier: varchar("identifier", { length: 255 }).notNull(),
    action: varchar("action", { length: 50 }).notNull(),
    provider: varchar("provider", { length: 50 }),
    success: boolean("success").notNull(),
    ipAddress: varchar("ip_address", { length: 45 }),
    userAgent: text("user_agent"),
    failureReason: varchar("failure_reason", { length: 255 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index("idx_auth_activity_user").on(table.userId),
    identifierIdx: index("idx_auth_activity_identifier").on(table.identifier),
    actionIdx: index("idx_auth_activity_action").on(table.action),
    createdIdx: index("idx_auth_activity_created").on(table.createdAt),
  }),
);
