import { pgTable, serial, varchar, integer, timestamp } from "drizzle-orm/pg-core";

export const loginAttemptsTable = pgTable("login_attempts", {
  id: serial("id").primaryKey(),
  identifier: varchar("identifier", { length: 100 }).notNull(),
  attemptCount: integer("attempt_count").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  lastAttempt: timestamp("last_attempt", { withTimezone: true }).notNull().defaultNow(),
});
