import { pgTable, serial, varchar, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const adminAlertsTable = pgTable("admin_alerts", {
  id: serial("id").primaryKey(),
  type: varchar("type", { length: 30 }).notNull().default("system"),
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message"),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AdminAlert = typeof adminAlertsTable.$inferSelect;
