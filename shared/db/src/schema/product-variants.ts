import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  serial,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { productsTable } from "./products";

/**
 * Catalog variants — the Retail catalog's sellable unit.
 *
 * The sourcing supplier structures every retail product as
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
 * two must be non-null (enforced at the API layer). Dedup of NULL axes:
 * the LIVE unique index is NULLS NOT DISTINCT (V1-M17 — see the index
 * mirror comment below), so (product, 'Family', NULL) can only exist once
 * even when normalizeLabels keeps returning null for absent axes.
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
    // R123-E5 (V1-M27): idx_product_variants_product dropped — a strict
    // prefix of idx_product_variants_product_active; boot twin:
    // migrate.ts applyIndexConsolidationStage (probe-gated DROP INDEX
    // IF EXISTS).
    productActiveIdx: index("idx_product_variants_product_active").on(t.productId, t.isActive),
    // One row per (plan, duration) pair within a product. The LIVE index
    // (replaced by migrate.ts V1-M17, round-98 F4 / R98-DB-05) is declared
    // `NULLS NOT DISTINCT` so absent axes (NULL plan/duration labels)
    // dedup at the DB level. drizzle-orm's uniqueIndex() cannot express
    // nulls-distinctness (only unique() constraints can, and the live
    // object is an INDEX) — the authoritative DDL is the boot migration;
    // this declaration mirrors it via the products.ts idx_products_slug_unique
    // mirror-comment idiom. normalizeLabels deliberately keeps returning
    // null for absent axes; the admin route's IS NOT DISTINCT FROM probe
    // stays as a friendly pre-check, while the index is the race-proof
    // guard.
    planDurationUniqueIdx: uniqueIndex("uniq_product_variants_plan_duration").on(
      t.productId,
      t.planLabel,
      t.durationLabel,
    ),
    // R123-E5 (V1-M29): retail price strictly positive, supplier cost
    // non-negative — what the admin/import zod bodies (min 0.01) already
    // enforce; the CHECK closes the bypass writers. Boot twin:
    // migrate.ts applyDomainCheckConstraintsStage (probe-gated).
    pricePosCheck: check("chk_variant_price_pos", sql`price_lyd > 0 AND cost_price >= 0`),
  }),
);

export const insertProductVariantSchema = createInsertSchema(productVariantsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type ProductVariant = typeof productVariantsTable.$inferSelect;
