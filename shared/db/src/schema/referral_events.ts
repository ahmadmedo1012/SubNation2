import { check, index, integer, pgTable, serial, timestamp, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";

export const referralEventsTable = pgTable(
  "referral_events",
  {
    id: serial("id").primaryKey(),
    // R123-E5 (V1-M28): RESTRICT — referral credits are money-adjacent
    // attribution: a pending referral_event is the referrer's claim to a
    // future credit, and referee_id is one-to-one (UNIQUE). CASCADE
    // contradicted the R122 anonymization-keeps-rows policy — deleting a
    // REFEREE user would atomically erase the REFERRER's pending credit
    // claim. Boot twin: migrate.ts applyReferralFksRestrictStage
    // (probe-gated rebuild, the V1-M25 discipline).
    referrerId: integer("referrer_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    refereeId: integer("referee_id")
      .notNull()
      .unique()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    creditedAt: timestamp("credited_at", { withTimezone: true }),
  },
  (t) => ({
    // R123-E5 (V1-M27): idx_referral_referrer dropped — superseded by the
    // (referrer_id, created_at DESC) composite the referrals surface
    // (loyalty.ts) and the copilot referral tool sort on; boot twin:
    // migrate.ts applyIndexConsolidationStage.
    referrerCreatedIdx: index("idx_referral_referrer_created").on(t.referrerId, t.createdAt.desc()),
    // R123-E5 (V1-M29): the two-state lifecycle (pending → credited) the
    // loyalty/topup writers already enforce; the CHECK closes the bypass
    // writers. Boot twin: migrate.ts applyDomainCheckConstraintsStage
    // (probe-gated count-then-add).
    statusCheck: check("chk_referral_status", sql`status IN ('pending','credited')`),
  }),
);

export type ReferralEvent = typeof referralEventsTable.$inferSelect;
