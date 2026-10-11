import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { db, initTestDb, resetTestDb, ordersTable, productsTable, usersTable } from "../../test/db";
import {
  applyIdempotencyKeysStage,
  applyIdempotencyReferenceTypeStage,
  applyIdempotencyBodyHashStage,
} from "../../migrate";
import {
  __resetIdempotencyTableProbeForTests,
  claimIdempotencyKey,
  findIdempotentOrderId,
  findIdempotencyClaimed,
} from "../../lib/idempotency";

/**
 * R134 (A7-F4) — V1-M32: idempotency_keys.body_hash, the durable
 * idempotency reuse predicate's column.
 *
 * The pglite harness has no idempotency_keys table in its shared DDL
 * (the migrate-v1m12/v1m27 convention: provisioned per-file), so each
 * case builds the pre-M32 shape via applyIdempotencyKeysStage (which
 * creates the table WITHOUT body_hash), then runs the stage:
 *
 *   - the column lands varchar(64) NULLABLE, no default;
 *   - the re-run is the steady-state contract (probe sees the column →
 *     zero DDL);
 *   - the claim/replay round-trip through the REAL service helpers
 *     stores and reads the hash;
 *   - the drizzle 0021 mirror carries the same column.
 */

function repoPath(rel: string): string {
  return new URL(`../../../../${rel}`, import.meta.url).pathname;
}

/** idempotency_keys is not in the shared harness DDL — drop + rebuild per
 * case. M12 + M19 together (the migrate-v1m12 convention: the current
 * shape includes reference_type), then M32 under test adds body_hash. */
async function rebuildPreM32Shape(): Promise<void> {
  await db.execute(sql.raw("DROP TABLE IF EXISTS idempotency_keys"));
  __resetIdempotencyTableProbeForTests();
  await applyIdempotencyKeysStage();
  await applyIdempotencyReferenceTypeStage();
}

/** The V1-M12 shape keeps the FK to orders(id) (dropped only in V1-M20)
 * — seed a real order row so the claim insert satisfies it. */
async function seedOrder(): Promise<number> {
  await db.insert(usersTable).values({ id: 1, phone: "09100000001", walletBalance: "100.00" });
  const [product] = await db
    .insert(productsTable)
    .values({ name: "V1-M32 Product", price: "5.00" })
    .returning({ id: productsTable.id });
  const [order] = await db
    .insert(ordersTable)
    .values({
      orderCode: "SN-V1M32-1",
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

/** pglite's execute result carries rows under .rows (the v1m24 idiom). */
function rowsOf(result: unknown): Array<Record<string, unknown>> {
  return (result as unknown as { rows?: Array<Record<string, unknown>> }).rows ?? [];
}

beforeAll(initTestDb, 60_000);

beforeEach(async () => {
  await resetTestDb();
});

describe("V1-M32 — idempotency_keys.body_hash (A7-F4)", () => {
  it("adds the column varchar(64) nullable on the legacy shape", async () => {
    await rebuildPreM32Shape();
    await applyIdempotencyBodyHashStage();

    const rows = rowsOf(
      await db.execute(sql`
      SELECT column_name, data_type, character_maximum_length, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'idempotency_keys' AND column_name = 'body_hash'
    `),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].data_type).toBe("character varying");
    expect(String(rows[0].character_maximum_length)).toBe("64");
    expect(rows[0].is_nullable).toBe("YES");
    expect(rows[0].column_default).toBeNull();
  });

  it("the re-run is the steady-state contract (probe → zero DDL)", async () => {
    await rebuildPreM32Shape();
    await applyIdempotencyBodyHashStage();
    // Second run: the probe sees the column and the stage must no-op —
    // it returns without executing any ALTER (idempotence by probe).
    await applyIdempotencyBodyHashStage();

    const rows = rowsOf(
      await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'idempotency_keys' AND column_name = 'body_hash'
    `),
    );
    expect(rows).toHaveLength(1);
  });

  it("the service round-trip: claim stores the hash, lookups read it back", async () => {
    await rebuildPreM32Shape();
    await applyIdempotencyBodyHashStage();
    __resetIdempotencyTableProbeForTests();
    const orderId = await seedOrder();

    // (The v1m12 precedent: claim via `db` directly — the transaction
    // wrapper adds nothing to this pin in the pglite harness.)
    await claimIdempotencyKey(db, "u1:m32-hash", orderId, "order", "a".repeat(64));

    const byOrder = await findIdempotentOrderId("u1:m32-hash", "order");
    expect(byOrder?.orderId).toBe(orderId);
    expect(byOrder?.bodyHash).toBe("a".repeat(64));

    const byClaimed = await findIdempotencyClaimed("u1:m32-hash");
    expect(byClaimed?.bodyHash).toBe("a".repeat(64));

    // Legacy NULL-hash claim: the pre-R134 writer shape (bodyHash
    // defaulted to null) reads back as null — the transition window.
    await claimIdempotencyKey(db, "u1:m32-legacy", orderId, "order");
    const legacy = await findIdempotentOrderId("u1:m32-legacy", "order");
    expect(legacy?.orderId).toBe(orderId);
    expect(legacy?.bodyHash).toBeNull();
  });

  it("the drizzle 0021 mirror carries the same column (chain ↔ runtime parity)", async () => {
    const mirror = await readFile(repoPath("shared/db/drizzle/0021_lazy_cardiac.sql"), "utf8");
    expect(mirror).toContain('ADD COLUMN IF NOT EXISTS "body_hash" varchar(64)');
  });
});
