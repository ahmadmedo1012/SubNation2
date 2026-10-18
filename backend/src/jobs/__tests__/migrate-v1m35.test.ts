import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { db, initTestDb, resetTestDb, ordersTable, productsTable, usersTable } from "../../test/db";
import { applyOrdersGroupColumnStage } from "../../migrate";

/**
 * R165 (the R162 ADR) — V1-M35: orders.order_group_id, the client-minted
 * checkout-attempt token's column + the ownership-scoped partial index
 * idx_orders_user_group.
 *
 * The pglite harness's shared DDL already carries the post-M35 shape
 * (test/db.ts orders CREATE TABLE + the index), so each case builds the
 * pre-M35 shape by DROPping the column (which drops the dependent
 * partial index with it), then runs the stage:
 *
 *   - the column lands varchar(36) NULLABLE, no default;
 *   - the partial index lands with the exact predicate;
 *   - the re-run is the steady-state contract (probe sees the column →
 *     zero DDL; the CREATE INDEX IF NOT EXISTS no-ops);
 *   - the drizzle 0026 mirror carries the same statements.
 */

function repoPath(rel: string): string {
  return new URL(`../../../../${rel}`, import.meta.url).pathname;
}

/** Drop the column + its index → the pre-V1-M35 shape. */
async function rebuildPreM35Shape(): Promise<void> {
  await db.execute(sql.raw(`DROP INDEX IF EXISTS idx_orders_user_group`));
  await db.execute(sql.raw(`ALTER TABLE orders DROP COLUMN IF EXISTS order_group_id`));
}

/** pglite's execute result carries rows under .rows (the v1m24 idiom). */
function rowsOf(result: unknown): Array<Record<string, unknown>> {
  return (result as unknown as { rows?: Array<Record<string, unknown>> }).rows ?? [];
}

beforeAll(initTestDb, 60_000);

beforeEach(async () => {
  await resetTestDb();
});

describe("V1-M35 — orders.order_group_id (R165, the R162 ADR)", () => {
  it("adds the column varchar(36) nullable + the partial index on the legacy shape", async () => {
    await rebuildPreM35Shape();
    await applyOrdersGroupColumnStage();

    const cols = rowsOf(
      await db.execute(sql`
      SELECT column_name, data_type, character_maximum_length, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'orders' AND column_name = 'order_group_id'
    `),
    );
    expect(cols).toHaveLength(1);
    expect(cols[0].data_type).toBe("character varying");
    expect(String(cols[0].character_maximum_length)).toBe("36");
    expect(cols[0].is_nullable).toBe("YES");
    expect(cols[0].column_default).toBeNull();

    // The partial index: composite + the WHERE predicate, by name.
    const idx = rowsOf(
      await db.execute(sql`
      SELECT indexdef AS indexdef FROM pg_indexes
      WHERE schemaname = current_schema() AND tablename = 'orders'
        AND indexname = 'idx_orders_user_group'
    `),
    );
    expect(idx).toHaveLength(1);
    expect(String(idx[0].indexdef)).toContain("ON public.orders");
    expect(String(idx[0].indexdef)).toContain("(user_id, order_group_id)");
    expect(String(idx[0].indexdef)).toContain("(order_group_id IS NOT NULL)");
  });

  it("the re-run is the steady-state contract (probe → zero DDL, no duplicate objects)", async () => {
    await rebuildPreM35Shape();
    await applyOrdersGroupColumnStage();
    // Second run: the probe sees the column (no ALTER) and CREATE INDEX
    // IF NOT EXISTS no-ops — exactly one column + one index remain.
    await applyOrdersGroupColumnStage();

    const cols = rowsOf(
      await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'orders' AND column_name = 'order_group_id'
    `),
    );
    expect(cols).toHaveLength(1);

    const idx = rowsOf(
      await db.execute(sql`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = current_schema() AND tablename = 'orders'
        AND indexname = 'idx_orders_user_group'
    `),
    );
    expect(idx).toHaveLength(1);
  });

  it("the stage coexists with the harness shape (fresh-install parity — the additive index)", async () => {
    // The harness DDL already created the column + index (the boot twin's
    // post-M35 shape); the stage must be a zero-DDL no-op against it, not
    // a collision.
    await applyOrdersGroupColumnStage();
    const cols = rowsOf(
      await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'orders' AND column_name = 'order_group_id'
    `),
    );
    expect(cols).toHaveLength(1);
  });

  it("NULL is the legacy shape — a seeded pre-feature order reads back null (no backfill)", async () => {
    await db.insert(usersTable).values({ id: 1, phone: "09100000071", walletBalance: "100.00" });
    const [product] = await db
      .insert(productsTable)
      .values({ name: "V1-M35 Product", price: "5.00" })
      .returning({ id: productsTable.id });
    const [order] = await db
      .insert(ordersTable)
      .values({
        orderCode: "SN-V1M35-1",
        userId: 1,
        productId: product.id,
        amount: "5.00",
        walletBalanceBefore: "100.00",
        walletBalanceAfter: "95.00",
        status: "completed",
      })
      .returning();
    expect(order.orderGroupId).toBeNull();
  });

  it("the drizzle 0026 mirror carries the same statements (chain ↔ runtime parity)", async () => {
    const mirror = await readFile(repoPath("shared/db/drizzle/0026_freezing_kid_colt.sql"), "utf8");
    expect(mirror).toContain('ADD COLUMN IF NOT EXISTS "order_group_id" varchar(36)');
    expect(mirror).toContain('CREATE INDEX IF NOT EXISTS "idx_orders_user_group"');
    expect(mirror).toContain("ON");
    expect(mirror).toContain('"user_id","order_group_id"');
    expect(mirror).toContain("WHERE order_group_id IS NOT NULL");
  });
});
