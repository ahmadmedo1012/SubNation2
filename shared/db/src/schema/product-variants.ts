import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  serial,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { productsTable } from "./products";

/**
 * Catalog variants — the Retail catalog's sellable unit.
 *
 * Embronic (the sourcing supplier) structures every retail product as
 * **Product → Plan → Validity → Price (USD cost)**, e.g.:
 *   Netflix      → (no plan) × {1 Month, 3 Months, 6 Months, 1 Year}
 *   Spotify      → {Individual, Duo, Family} × {1 Month, …, 1 Year}
 *   Disney+      → {Basic, Premium} × {1 Month, …, 1 Year}
 *   cPanel       → {VPS, Dedicated} × {1 Month, 1 Year, Lifetime}
 *   Cloud Store  → {500 GB, 1 TB, Unlimited} (storage, not a duration)
 *
 * Modeling each of these as a separate `products` row (the pre-2026-09-20
 * approach) duplicates brands, scatters stock, and makes pricing review
 * impossible. This table restores the real structure: one row per
 * sellable option, parented by a single product.
 *
 * Both label columns are nullable — a variant is uniquely identified by
 * the (plan, duration) pair within its product and at least one of the
 * two must be non-null (enforced at the API layer; a CHECK would fight
 * the UNIQUE index on NULL semantics in older Postgres).
 *
 * ── Pricing contract (single source of truth) ──────────────────────────────
 * `costPrice`  — supplier USD cost (INTERNAL: admin-only, never on public
 *                DTOs / HTML / JS; see lib/pricing-config).
 * `priceLyd`   — the customer-facing retail price in LYD. Always computed
 *                through computeRetailLYD(cost, rate, markup) at write time
 *                (import + admin create/edit + bulk recompute). The runtime
 *                rule: rate = 1 USD → 10 LYD, markup = 100% (cost × 2 × 10),
 *                both operator-adjustable from admin settings
 *                (system_settings keys `pricing.usd_to_lyd` / `pricing.markup_percent`).
 */
export const productVariantsTable = pgTable(
  "product_variants",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id")
      .notNull()
      .references(() => productsTable.id, { onDelete: "cascade" }),
    /**
     * Tier/plan axis — "Individual", "Duo", "Family", "Basic", "Premium",
     * "With Ads", "Lite", "VPS", "500 GB" … null for products with a
     * single plan axis (Netflix: duration only).
     */
    planLabel: varchar("plan_label", { length: 120 }),
    /**
     * Validity axis — "1 Month", "3 Months", "6 Months", "1 Year",
     * "Lifetime", "Monthly", "Yearly", "500 GB" (storage-tier products
     * reuse this axis when the option isn't temporal).
     */
    durationLabel: varchar("duration_label", { length: 120 }),
    /** Approximate validity in days (30/90/180/365) for sorting + display. */
    durationDays: integer("duration_days"),
    /** Supplier USD cost per unit — INTERNAL, never leaves admin context. */
    costPrice: numeric("cost_price", { precision: 10, scale: 2 }).notNull(),
    /** Customer retail price in LYD — computed via the pricing engine. */
    priceLyd: numeric("price_lyd", { precision: 10, scale: 2 }).notNull(),
    /** Internal stock-keeping label for the operator (admin-only). */
    sku: varchar("sku", { length: 160 }),
    isActive: boolean("is_active").notNull().default(true),
    /** Editorial ordering within the product (cheapest-first import). */
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    productIdx: index("idx_product_variants_product").on(t.productId),
    productActiveIdx: index("idx_product_variants_product_active").on(t.productId, t.isActive),
    // One row per (plan, duration) pair within a product. NULLs are
    // distinct in Postgres UNIQUE, so the API layer normalizes absent
    // axes to empty strings before insert to keep dedup honest.
    planDurationUniqueIdx: uniqueIndex("uniq_product_variants_plan_duration").on(
      t.productId,
      t.planLabel,
      t.durationLabel,
    ),
  }),
);

export const insertProductVariantSchema = createInsertSchema(productVariantsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertProductVariant = z.infer<typeof insertProductVariantSchema>;
export type ProductVariant = typeof productVariantsTable.$inferSelect;
