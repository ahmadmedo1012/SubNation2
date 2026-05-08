import { pgTable, serial, integer, varchar, timestamp } from "drizzle-orm/pg-core";

export const referralEventsTable = pgTable("referral_events", {
  id: serial("id").primaryKey(),
  referrerId: integer("referrer_id").notNull(),
  refereeId: integer("referee_id").notNull().unique(),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  creditedAt: timestamp("credited_at", { withTimezone: true }),
});

export type ReferralEvent = typeof referralEventsTable.$inferSelect;
