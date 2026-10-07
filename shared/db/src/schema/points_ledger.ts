import {
  check,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  serial,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";

/**
 * points_ledger — append-only loyalty attribution ledger (R115, Part 8).
 *
 * users.loyalty_points stays the cached balance (speed); this table makes
 * every point mutation reconstructable: "why does this user have exactly
 * 750 points?" is a SELECT away, and reconciliation is
 *   loyalty_points == points_after of the user's latest row
 *   (and Σ points_delta over all rows).
 *
 * Sources (one row per mutation, same transaction as the balance write):
 *   purchase_award   reference order          checkout.service
 *   refund_reversal  reference order          refund.service (exact
 *                     unrevoked remainder of that order's award — never
 *                     points from other sources)
 *   referral_credit  reference referral_event topup.service / admin credit
 *   conversion_out   reference wallet_ledger  routes/loyalty convert-points
 *                     (lyd_credited pins the rate in-row)
 *   admin_set        actor + reason           admin users PATCH (delta
 *                     against the prior balance — reason mandatory)
 *   correction       reason                   R115 opening balances only
 *
 * Structural guards (V1-M21):
 *   CHECK (points_after = points_before + points_delta)
 *   CHECK (points_delta <> 0)
 *   CHECK (points_before >= 0 AND points_after >= 0)
 *   partial UNIQUE (type, reference_id) WHERE reference_id IS NOT NULL
 *     → one award/reversal/credit per source row (double-grant impossible)
 *   CHECK reason present for admin_set/correction
 *
 * Retention: NEVER delete from this table (audit trail; excluded from all
 * retention jobs — same class as wallet_ledger).
 */
export const pointsLedgerTypeEnum = pgEnum("points_ledger_type", [
  "purchase_award",
  "refund_reversal",
  "referral_credit",
  "conversion_out",
  "admin_set",
  "correction",
]);

export const pointsLedgerTable = pgTable(
  "points_ledger",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      // R122 (A4-P1-2): RESTRICT — this table's own docstring says
      // "Retention: NEVER delete from this table (audit trail; excluded
      // from all retention jobs — same class as wallet_ledger)", but the
      // FK was CASCADE: a manual DELETE FROM users would atomically erase
      // the user's entire points history. Boot twin: V1-M25 (migrate.ts
      // applyMoneyLedgerUserFkRestrictStage) rebuilds the boot-created
      // points_ledger_user_id_fkey as ON DELETE RESTRICT.
      .references(() => usersTable.id, { onDelete: "restrict" }),
    type: pointsLedgerTypeEnum("type").notNull(),
    /** Signed delta: positive = earned, negative = revoked/spent. */
    pointsDelta: integer("points_delta").notNull(),
    pointsBefore: integer("points_before").notNull(),
    pointsAfter: integer("points_after").notNull(),
    /** Present only for conversion_out — the LYD credit this conversion
     * yielded at the then-current rate (rate pinned in-row, so a future
     * POINTS_PER_LYD change never rewrites history). */
    lydCredited: numeric("lyd_credited", { precision: 10, scale: 2 }),
    referenceId: integer("reference_id"),
    referenceType: varchar("reference_type", { length: 50 }),
    /** Who performed an admin_set (admin user id). NULL for user actions. */
    actorAdminId: integer("actor_admin_id"),
    /** Mandatory for admin_set / correction (DB-enforced). */
    reason: varchar("reason", { length: 500 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("idx_points_ledger_user").on(t.userId),
    typeIdx: index("idx_points_ledger_type").on(t.type),
    userCreatedIdx: index("idx_points_ledger_user_created").on(t.userId, t.createdAt),
    // Structural exactly-once per source: one purchase_award / one
    // refund_reversal per order, one referral_credit per referral_event,
    // one conversion_out per wallet_ledger row. admin_set / correction
    // carry reference_id NULL and are exempt.
    // R118-A3 F2: declared uniqueIndex (was plain index — the TS/snapshot
    // lied about the LIVE object, which has been UNIQUE since V1-M21
    // created it via `CREATE UNIQUE INDEX IF NOT EXISTS`, migrate.ts).
    // A drizzle push under the old declaration would have rebuilt the
    // points exactly-once guard as NON-unique under the same name, and
    // the boot reconcile (name-exists skip) would never have restored it.
    // Same mirror idiom as uniq_wallet_topups_payment_reference.
    sourceUnique: uniqueIndex("uniq_points_ledger_type_reference")
      .on(t.type, t.referenceId)
      .where(sql`reference_id IS NOT NULL`),
    // R118-A3 F3: the four structural CHECKs the boot SQL (V1-M21 table
    // DDL, migrate.ts) has always applied live; declared via check() so
    // the drizzle chain + snapshot carries them too (constraint names +
    // expressions pinned verbatim to the boot SQL — same discipline as
    // enrichment_drafts/inventory_forecasts, R98-DB-03).
    arithmeticCheck: check(
      "chk_points_ledger_arithmetic",
      sql`points_after = points_before + points_delta`,
    ),
    deltaNonzeroCheck: check("chk_points_ledger_delta_nonzero", sql`points_delta <> 0`),
    balancesNonnegCheck: check(
      "chk_points_ledger_balances_nonneg",
      sql`points_before >= 0 AND points_after >= 0`,
    ),
    reasonForManualCheck: check(
      "chk_points_ledger_reason_for_manual",
      sql`type NOT IN ('admin_set', 'correction') OR reason IS NOT NULL`,
    ),
  }),
);

export type PointsLedgerEntry = typeof pointsLedgerTable.$inferSelect;
