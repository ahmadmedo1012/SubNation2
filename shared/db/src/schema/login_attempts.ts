import { pgTable, serial, varchar, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const loginAttemptsTable = pgTable(
  "login_attempts",
  {
    id: serial("id").primaryKey(),
    identifier: varchar("identifier", { length: 100 }).notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastAttempt: timestamp("last_attempt", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // UNIQUE, matching the live table (boot SQL creates it UNIQUE).
    // Without it, the SELECT-then-INSERT lockout flow races and the
    // counter splits across duplicate rows — brute-force protection
    // silently weakens. A drizzle push previously dropped it.
    identifierUnique: uniqueIndex("idx_login_attempts_identifier").on(t.identifier),
  }),
);
