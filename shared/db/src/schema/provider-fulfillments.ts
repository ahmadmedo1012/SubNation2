import { index, integer, pgEnum, pgTable, serial, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { ordersTable } from "./orders";

/**
 * Provider fulfillment ledger — one row per fulfillment attempt per order
 * (R102, provider-readiness phase).
 *
 * WHY THIS EXISTS: the next project phase connects an external fulfillment
 * provider (the sourcing supplier's reseller API). Today fulfillment is
 * fully manual and IN-transaction: checkout claims a pre-uploaded local
 * inventory unit and copies its credentials onto the order row
 * (services/checkout.service.ts). An external provider introduces a second
 * fulfillment mode with its own identity, its own order reference, its own
 * retry semantics — and the platform needs a durable, auditable record of
 * WHO fulfilled WHAT and AGAINST WHICH provider order.
 *
 * WHAT THIS TABLE IS NOT:
 *   - It is NOT a credential store: delivered credentials live exactly
 *     where they live today — on `orders.delivered_*` (H2 at-rest contract,
 *     encrypted, write-once). This table records the fulfillment RELATION,
 *     not the payload.
 *   - It is NOT an order_items table: one order = one unit in this
 *     architecture (the cart fans out unit-orders client-side).
 *
 * SECRECY: `provider` and `provider_order_id` are OPERATOR-ONLY vocabulary
 * — same classification as `product_variants.sku` and `cost_price`. They
 * must never appear in any public DTO (pinned by catalog-security tests).
 *
 * LIFECYCLE: FK `ON DELETE CASCADE` follows the order — the fulfillment
 * record never outlives the money it documents (idempotency-keys idiom).
 *
 * MIGRATION: created by boot migration V1-M18 (migrate.ts). The live
 * `uniq_provider_fulfillments_provider_order` index is a PLAIN UNIQUE
 * (default NULLS DISTINCT — deliberately NOT the V1-M17 NULLS NOT
 * DISTINCT idiom): manual rows never carry a provider order id, and
 * distinct-NULLs is what lets ANY number of (manual, NULL) rows coexist
 * (one per order). The non-null half of the invariant — one provider
 * order can back EXACTLY ONE SubNation order — is enforced identically
 * by both modes, and that is the idempotency anchor that matters for
 * the provider seam. (The first R102 draft used NULLS NOT DISTINCT and
 * the checkout suite caught it immediately: the second-ever manual
 * purchase violated (manual, NULL). Lesson re-learned: V1-M17's
 * nulls-not-distinct rebuild is the EXCEPTION for NULL-equal business
 * keys, not a default to copy.)
 */
export const providerFulfillmentStatusEnum = pgEnum("provider_fulfillment_status", [
  "pending",
  "succeeded",
  "failed",
]);

export const providerFulfillmentsTable = pgTable(
  "provider_fulfillments",
  {
    id: serial("id").primaryKey(),
    /** The order this fulfillment attempt belongs to (cascade). */
    orderId: integer("order_id")
      .notNull()
      .references(() => ordersTable.id, { onDelete: "cascade" }),
    /** Provider identity — closed operator vocabulary ('manual' today). */
    provider: varchar("provider", { length: 32 }).notNull().default("manual"),
    /** 1-based attempt number within this order (manual is always 1). */
    attempt: integer("attempt").notNull().default(1),
    /**
     * Lifecycle: 'succeeded' at purchase time for the manual (synchronous)
     * provider. An async provider writes 'pending' at purchase and flips to
     * 'succeeded'/'failed' when the provider settles — orders.status stays
     * the customer-visible gate either way (routes/orders.ts formatOrder
     * only releases credentials for 'completed').
     */
    status: providerFulfillmentStatusEnum("status").notNull(),
    /** The provider's own order reference — idempotency anchor (nullable for manual). */
    providerOrderId: varchar("provider_order_id", { length: 255 }),
    /** Stable failure vocabulary for ops dashboards (nullable while succeeded). */
    errorCode: varchar("error_code", { length: 64 }),
    /** Last error detail for diagnosis — never credentials, never secrets. */
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orderIdx: index("idx_provider_fulfillments_order").on(t.orderId),
    // Plain UNIQUE (default NULLS DISTINCT) — see module docblock: the
    // non-null half (one provider order → one order) is the idempotency
    // anchor; the NULL half must stay permissive for manual rows.
    providerOrderUniqueIdx: uniqueIndex("uniq_provider_fulfillments_provider_order").on(
      t.provider,
      t.providerOrderId,
    ),
  }),
);
