import { index, integer, pgTable, serial, timestamp, varchar } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const referralEventsTable = pgTable(
  "referral_events",
  {
    id: serial("id").primaryKey(),
    referrerId: integer("referrer_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    refereeId: integer("referee_id")
      .notNull()
      .unique()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    creditedAt: timestamp("credited_at", { withTimezone: true }),
  },
  (t) => ({
    referrerIdx: index("idx_referral_referrer").on(t.referrerId),
  }),
);

export type ReferralEvent = typeof referralEventsTable.$inferSelect;
