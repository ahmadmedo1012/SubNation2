import {
  index,
  pgTable,
  serial,
  varchar,
  integer,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

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
    // R127-L3 (B7 P2-1 / B8 G5): THE important one of the retention
    // bundle — auth-audit-retention's `last_attempt < cutoff` prune
    // (jobs/auth-audit-retention.ts, 7-day window + boot one-shot) had
    // no index support, and this is the one ATTACKER-GROWN table: one
    // upsert per `phone:ip`/`username:ip` pair, so IP-rotating
    // credential stuffing grows it linearly with distinct pairs. Each
    // ctid batch (≤1000 rows) costs a full seq scan without an index —
    // the catch-up-purge amplifier B7 §7 worked through (1.7M rows →
    // ~1,700 consecutive full scans per prune, precisely while the DB
    // is already under attack). Boot twin: migrate.ts
    // applyRetentionPruneIndexesStage (V1-M31); drizzle mirror: 0020.
    lastAttemptIdx: index("idx_login_attempts_last_attempt").on(t.lastAttempt),
  }),
);
