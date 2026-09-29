import {
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
import { createInsertSchema } from "drizzle-zod";
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
      .references(() => usersTable.id, { onDelete: "cascade" }),
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
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    userIdx: index("idx_orders_user").on(t.userId),
    productIdx: index("idx_orders_product").on(t.productId),
    statusIdx: index("idx_orders_status").on(t.status),
    // AUD103-1-F3 (r103): DESC mirrors the boot definition (migrate.ts)
    createdIdx: index("idx_orders_created").on(t.createdAt.desc()),
    statusCreatedIdx: index("idx_orders_status_created").on(t.status, t.createdAt),
    // Round-3 (8-c §4.5): the user's own orders list sorts by createdAt
    // DESC filtered by user_id — composite covers both in one index.
    userCreatedIdx: index("idx_orders_user_created").on(t.userId, t.createdAt),
    // R98-DB-01: V1-M16 (migrate.ts applyProductVariantsStage) creates this
    // live for the admin variant-delete order-history guard (COUNT WHERE
    // variant_id). Declared here so the drizzle chain + snapshot carry it
    // and a future push can't drop a live serving index.
    variantIdx: index("idx_orders_variant").on(t.variantId),
  }),
);

export const insertOrderSchema = createInsertSchema(ordersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type Order = typeof ordersTable.$inferSelect;
