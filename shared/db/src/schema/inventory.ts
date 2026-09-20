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
    soldIdx: index("idx_inventory_sold").on(t.isSold),
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
