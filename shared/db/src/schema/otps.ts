import { pgTable, serial, varchar, timestamp } from "drizzle-orm/pg-core";

export const otpsTable = pgTable("otps", {
  id: serial("id").primaryKey(),
  phone: varchar("phone", { length: 20 }).notNull(),
  code: varchar("code", { length: 10 }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
