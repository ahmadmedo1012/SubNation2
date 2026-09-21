import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { productsTable } from "./products";
import { productVariantsTable } from "./product-variants";

export const inventoryTable = pgTable(
  "inventory",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id")
      .notNull()
      .references(() => productsTable.id, { onDelete: "cascade" }),
    /**
     * Variant-scoped stock: when set, this unit only fulfills orders for
     * that specific catalog variant (product_variants.id). Nullable —
     * legacy/undifferentiated units fulfill any variant of the product
     * (the checkout claims variant-scoped units first, then falls back
     * to product-level units).
     */
    variantId: integer("variant_id").references(() => productVariantsTable.id, {
      onDelete: "set null",
      // AUD103-1-F6 (r103) — CONTRACT: ON DELETE SET NULL silently DEMOTES a
      // variant-scoped unit to a generic unit, which the manual provider can
      // then fulfill against ANY variant of the product (a "1 Year" credential
      // could ship on a "1 Month" order). Dormant today (no production write
      // path sets variant_id — scoped uploads are consciously-deferred work),
      // but the moment scoped uploads ship, the admin variant-DELETE guard
      // (routes/admin/product-variants.ts) MUST also 409 on unsold scoped
      // units for that variant — ship the guard in the SAME change.
    }),
    accountEmail: varchar("account_email", { length: 255 }),
    accountPassword: varchar("account_password", { length: 512 }),
    extraDetails: text("extra_details"),
    isSold: boolean("is_sold").notNull().default(false),
    soldAt: timestamp("sold_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * Monotonic write-clock used by the AI Admin Copilot's preview-staleness
     * check (010-ai-admin-copilot, FR-PREVIEW-004). Captured at draft time and
     * compared at execute time; if it has advanced the preview is rejected.
     *
     * NOT NULL with default now() so existing rows backfill cleanly via the
     * boot migration's `ADD COLUMN IF NOT EXISTS`.
     *
     * The Drizzle `$onUpdate` hook only runs on calls that go through Drizzle
     * (not raw SQL); the database does not auto-update this column. Code paths
     * that bypass Drizzle (e.g. raw `db.execute(sql`UPDATE ...`)`) MUST set it
     * explicitly to keep the staleness invariant honest.
     */
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    productIdx: index("idx_inventory_product").on(t.productId),
    // AUD103-1-F3 (r103): partial mirrors the boot definition (migrate.ts):
    // idx_inventory_sold ON inventory(is_sold) WHERE is_sold = false.
    soldIdx: index("idx_inventory_sold").on(t.isSold).where(sql`is_sold = false`),
    productSoldIdx: index("idx_inventory_product_sold").on(t.productId, t.isSold),
    // R98-DB-01: V1-M16 (migrate.ts applyProductVariantsStage) creates this
    // live for the variant-scoped stock lookups. Declared here so the
    // drizzle chain + snapshot carry it and a future push can't drop it.
    variantIdx: index("idx_inventory_variant").on(t.variantId),
  }),
);

export const insertInventorySchema = createInsertSchema(inventoryTable).omit({
  id: true,
  createdAt: true,
});
export type Inventory = typeof inventoryTable.$inferSelect;
