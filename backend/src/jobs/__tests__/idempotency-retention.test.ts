import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import {
  db,
  initTestDb,
  resetTestDb,
  idempotencyKeysTable,
  ordersTable,
  productsTable,
  usersTable,
} from "../../test/db";
import { applyIdempotencyKeysStage, applyIdempotencyReferenceTypeStage } from "../../migrate";
import { pruneOldIdempotencyKeys } from "../idempotency-retention";

/**
 * idempotency_keys retention (97-F7, R97-A3 retention audit finding #7.3):
 *
 * The table had NO retention policy of any kind — rows left only via the
 * order/user CASCADE deletes, so every guarded purchase grew the table by
 * one row forever (unbounded growth on the money path's hottest insert).
 *
 * pruneOldIdempotencyKeys (48h retention on created_at — the HTTP-layer
 * dedup cache expires at 24h; 48h doubles that horizon) is wired into the
 * daily 00:00 UTC retention policy slot in jobs/cron.ts. These tests pin
 * the retention behavior on the pglite harness:
 *   - rows older than 48h are deleted;
 *   - fresh rows survive (replay protection window intact);
 *   - re-runs are no-ops (idempotent);
 *   - deleting a key row deletes NO financial record (the order stays).
 */

// Explicit hook timeout: the pglite WASM boot + DDL runs under heavy
// parallel-suite CPU contention (same rationale as migrate-v1m9/v1m10/v1m12).
beforeAll(initTestDb, 60_000);

beforeEach(async () => {
  await resetTestDb();
  // Strip the table back to the pre-V1-M12 state, then re-create it so
  // the retention DELETE has the real production shape to run against.
  await db.execute(sql.raw("DROP TABLE IF EXISTS idempotency_keys"));
  await applyIdempotencyKeysStage();
  // R102 (V1-M19): keep the harness table at the CURRENT shape so the
  // drizzle object (which now selects reference_type) resolves.
  await applyIdempotencyReferenceTypeStage();
});

async function seedOrder(orderCode: string): Promise<number> {
  await db.insert(usersTable).values({ id: 1, phone: "09100000021", walletBalance: "100.00" });
  const [product] = await db
    .insert(productsTable)
    .values({ name: "Retention Product", price: "5.00" })
    .returning({ id: productsTable.id });
  const [order] = await db
    .insert(ordersTable)
    .values({
      orderCode,
      userId: 1,
      productId: product.id,
      amount: "5.00",
      walletBalanceBefore: "100.00",
      walletBalanceAfter: "95.00",
      status: "completed",
    })
    .returning({ id: ordersTable.id });
  return order.id;
}

async function insertKey(key: string, orderId: number, ageHours: number): Promise<void> {
  await db.execute(sql`
    INSERT INTO idempotency_keys (key, order_id, created_at)
    VALUES (${key}, ${orderId}, now() - make_interval(hours => ${ageHours}))
  `);
}

async function countKeys(): Promise<number> {
  const result = await db.execute(sql`SELECT count(*) AS c FROM idempotency_keys`);
  const rows = (result as unknown as { rows?: Array<{ c: string }> }).rows ?? [];
  return Number(rows[0]?.c ?? 0);
}

describe("pruneOldIdempotencyKeys — 48h retention", () => {
  it("deletes rows older than 48h and keeps fresh rows", async () => {
    const orderId = await seedOrder("SN-RET-1");
    await insertKey("u1:old-72h", orderId, 72);
    await insertKey("u1:old-49h", orderId, 49);
    await insertKey("u1:fresh-47h", orderId, 47);
    await insertKey("u1:fresh-1h", orderId, 1);
    expect(await countKeys()).toBe(4);

    const removed = await pruneOldIdempotencyKeys();

    expect(removed).toBe(2);
    const survivors = await db.select().from(idempotencyKeysTable);
    expect(survivors.map((r) => r.key).sort()).toEqual(["u1:fresh-1h", "u1:fresh-47h"]);
  });

  it("retention deletes NO financial record — the order row stays", async () => {
    const orderId = await seedOrder("SN-RET-2");
    await insertKey("u1:expired-purchase", orderId, 96);

    await pruneOldIdempotencyKeys();

    expect(await countKeys()).toBe(0);
    const [order] = await db.select().from(ordersTable);
    expect(order.id).toBe(orderId);
    expect(order.orderCode).toBe("SN-RET-2");
  });

  it("re-runs are no-ops (returns 0, table unchanged)", async () => {
    const orderId = await seedOrder("SN-RET-3");
    await insertKey("u1:old-72h", orderId, 72);
    await insertKey("u1:fresh-2h", orderId, 2);

    expect(await pruneOldIdempotencyKeys()).toBe(1);
    expect(await pruneOldIdempotencyKeys()).toBe(0);
    expect(await countKeys()).toBe(1);
  });

  it("empty table is a clean no-op", async () => {
    expect(await pruneOldIdempotencyKeys()).toBe(0);
    expect(await countKeys()).toBe(0);
  });
});
