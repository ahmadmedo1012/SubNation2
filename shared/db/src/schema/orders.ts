import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { inventoryTable } from "./inventory";
import { productsTable } from "./products";
import { productVariantsTable } from "./product-variants";
import { usersTable } from "./users";

export const orderStatusEnum = pgEnum("order_status", [
  "pending",
  "completed",
  "failed",
  "refunded",
]);

export const ordersTable = pgTable(
  "orders",
  {
    id: serial("id").primaryKey(),
    orderCode: varchar("order_code", { length: 50 }).notNull().unique(),
    userId: integer("user_id")
      .notNull()
      // R122 (A4-P1-2): RESTRICT — orders are financial history; the only
      // supported "deletion" story is user anonymization (keep the rows).
      // Boot twin: V1-M25 (migrate.ts applyMoneyLedgerUserFkRestrictStage)
      // rebuilds fk_orders_user as ON DELETE RESTRICT.
      .references(() => usersTable.id, { onDelete: "restrict" }),
    productId: integer("product_id")
      .notNull()
      .references(() => productsTable.id, { onDelete: "restrict" }),
    /**
     * The purchased catalog variant (product_variants.id). Nullable for
     * legacy orders placed before variants existed (2026-09-20) — the
     * product-level price applied then. New orders always carry a
     * variant_id when the product has variants.
     */
    variantId: integer("variant_id").references(() => productVariantsTable.id, {
      onDelete: "set null",
    }),
    /**
     * Immutable historical copy of the purchased variant's display label
     * (e.g. "Individual — 3 Months") captured at purchase time. Survives
     * variant edits/deletion the same way delivered_* fields survive
     * product edits — order history must never rewrite itself.
     */
    variantLabel: varchar("variant_label", { length: 240 }),
    inventoryId: integer("inventory_id").references(() => inventoryTable.id, {
      onDelete: "set null",
    }),
    amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
    walletBalanceBefore: numeric("wallet_balance_before", { precision: 10, scale: 2 })
      .notNull()
      .default("0.00"),
    walletBalanceAfter: numeric("wallet_balance_after", { precision: 10, scale: 2 })
      .notNull()
      .default("0.00"),
    status: orderStatusEnum("status").notNull().default("pending"),
    deliveredEmail: varchar("delivered_email", { length: 255 }),
    deliveredPassword: varchar("delivered_password", { length: 512 }),
    deliveredExtraDetails: text("delivered_extra_details"),
    deliveredUsageTerms: text("delivered_usage_terms"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    couponCode: varchar("coupon_code", { length: 50 }),
    /**
     * R115 (V1-M22): first-class refund reconciliation. Previously a
     * refund was only reconstructable by joining wallet_ledger (type
     * 'refund', reference_id = order id) — refunded_at/amount/by now live
     * on the order itself, written by RefundService in the same tx as the
     * status flip. refund_amount <= amount is DB-enforced; partial refunds
     * are not a product concept yet (full refunds only) but the column is
     * sized for them.
     */
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    refundAmount: numeric("refund_amount", { precision: 10, scale: 2 }),
    refundedByAdminId: integer("refunded_by_admin_id"),
    // R97-DB-03 (D3 closure, round-97 F7): the live DB column is
    // NOT NULL DEFAULT 0.00 (created that way by migrate.ts boot SQL);
    // the schema TS was the lenient twin — drizzle-kit generate would
    // have proposed a weakening DROP NOT NULL. Aligned to the DB.
    discountAmount: numeric("discount_amount", { precision: 10, scale: 2 })
      .notNull()
      .default("0.00"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * R165 (the R162 ADR): client-minted checkout-attempt token — ONE
     * logical confirm (including its partial-failure retries) reuses the
     * same UUID across every unit-order of that attempt. Informational
     * only: never in money math, idempotency claims, refunds, or
     * inventory. Nullable, no default, NO backfill — NULL = a pre-feature
     * singleton/legacy order. Boot twin: V1-M35 (migrate.ts
     * applyOrdersGroupColumnStage, catalog-probe gated); drizzle mirror:
     * chain 0026.
     */
    orderGroupId: varchar("order_group_id", { length: 36 }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    productIdx: index("idx_orders_product").on(t.productId),
    // R123-E5 (V1-M27): idx_orders_user + idx_orders_status dropped — strict
    // prefixes of idx_orders_user_created / idx_orders_status_created; the
    // boot twin is migrate.ts applyIndexConsolidationStage (probe-gated
    // DROP INDEX IF EXISTS).
    // AUD103-1-F3 (r103): DESC mirrors the boot definition (migrate.ts)
    createdIdx: index("idx_orders_created").on(sql`created_at DESC`),
    statusCreatedIdx: index("idx_orders_status_created").on(t.status, t.createdAt),
    // Round-3 (8-c §4.5): the user's own orders list sorts by createdAt
    // DESC filtered by user_id — composite covers both in one index.
    // R135 (DB-1 / V1-M34): extended to the FULL keyset tail
    // (user_id, created_at DESC, id DESC) — same rationale as the
    // wallet_ledger twin (routes/orders.ts sorts WHERE user_id ORDER BY
    // created_at DESC today; the id DESC tiebreaker makes the index
    // keyset-ready the day that list adopts cursor pagination, the
    // idx_risk_events_created_id_desc house shape). Raw sql`col DESC`
    // expression columns (NOT .desc() — the R134-A8-F1 convention:
    // drizzle-kit 0.31.9 serializes .desc() as DESC NULLS LAST and would
    // diverge from the boot twin's plain DESC; on these NOT NULL columns
    // the two are order-identical, so this is chain↔boot parity, not a
    // live change). Boot twin: migrate.ts applyR135IndexWaveStage
    // (V1-M34 probe-gated same-name swap) + the base round-4 block;
    // drizzle mirror: chain 0023.
    userCreatedIdx: index("idx_orders_user_created").on(
      t.userId,
      sql`created_at DESC`,
      sql`id DESC`,
    ),
    // R98-DB-01: V1-M16 (migrate.ts applyProductVariantsStage) creates this
    // live for the admin variant-delete order-history guard (COUNT WHERE
    // variant_id). Declared here so the drizzle chain + snapshot carry it
    // and a future push can't drop a live serving index.
    variantIdx: index("idx_orders_variant").on(t.variantId),
    // R165 (V1-M35, the R162 ADR): the order-group lookup — PARTIAL on
    // (user_id, order_group_id) WHERE order_group_id IS NOT NULL (the
    // V1-M31/V1-M34 partial idiom — same shape as idx_coupons_expires_at):
    // every consumer query is ownership-scoped (user_id + group), the
    // group ids are random UUIDs so the second column is highly selective,
    // and historical NULL rows stay out of the index entirely. Boot twin:
    // migrate.ts applyOrdersGroupColumnStage; drizzle mirror: chain 0026.
    userGroupIdx: index("idx_orders_user_group")
      .on(t.userId, t.orderGroupId)
      .where(sql`order_group_id IS NOT NULL`),
    // R118-A3 F3: refund reconciliation guard the boot SQL (V1-M22)
    // applies live — a refund is either absent or strictly positive and
    // never exceeds the order's own amount. Pinned verbatim to the boot
    // SQL (migrate.ts applyOrdersRefundColumnsStage).
    refundAmountRangeCheck: check(
      "chk_orders_refund_amount_range",
      sql`refund_amount IS NULL OR (refund_amount > 0 AND refund_amount <= amount)`,
    ),
    // R122 (A4-P2-5): every order is a positive-money charge — checkout
    // already enforces this at the perimeter (the INVALID_PRICE gate,
    // checkout.service.ts, rejects finalPrice <= 0); the CHECK closes the
    // bypass paths (cron, SQL console, a future writer) the same way
    // chk_topups_amount_pos does for topups. Boot twin: V1-M26 (migrate.ts
    // applyMoneyArithmeticChecksStage), probe-gated count-then-add.
    amountPosCheck: check("chk_orders_amount_pos", sql`amount > 0`),
  }),
);

// R135 (DB-1): insertOrderSchema removed — zero consumers repo-wide
// (grep-verified) along with its drizzle-zod import (the dependency line
// left shared/db/package.json the same round).
export type Order = typeof ordersTable.$inferSelect;
