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
import { z } from "zod/v4";
import { productsTable } from "./products";

export const inventoryTable = pgTable(
  "inventory",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id")
      .notNull()
      .references(() => productsTable.id, { onDelete: "cascade" }),
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
  }),
);

export const insertInventorySchema = createInsertSchema(inventoryTable).omit({
  id: true,
  createdAt: true,
});
export type InsertInventory = z.infer<typeof insertInventorySchema>;
export type Inventory = typeof inventoryTable.$inferSelect;
