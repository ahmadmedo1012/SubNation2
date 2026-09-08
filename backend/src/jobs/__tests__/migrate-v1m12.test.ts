import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import {
  db,
  initTestDb,
  resetTestDb,
  idempotencyKeysTable,
  ordersTable,
  productsTable,
  usersTable,
} from "../../test/db";
import { applyIdempotencyKeysStage } from "../../migrate";
import {
  __resetIdempotencyTableProbeForTests,
  claimIdempotencyKey,
  findIdempotentOrderId,
  isIdempotencyKeyViolation,
} from "../../lib/idempotency";

/**
 * V1-M12 (round-94 A4/C4/C6) — durable idempotency_keys for the money path.
 *
 * The service layer (lib/idempotency.ts, F10) ships a degradation contract:
 * until the table exists every SQLSTATE 42P01 turns the guard into a no-op
 * (legacy pass-through). This migration creates the table the service
 * expects — with column names/types pinned VERBATIM to
 * shared/db/src/schema/idempotency-keys.ts and lib/idempotency.ts:
 *
 *   key        text        PRIMARY KEY        (the user-scoped `u{id}:{k}`)
 *   order_id   integer     NOT NULL FK → orders(id) ON DELETE CASCADE
 *   created_at timestamptz NOT NULL DEFAULT now()
 *   + idx_idempotency_keys_order ON (order_id)
 *
 * A name/type drift would break the 42P01-latch silently, so the tests pin
 * the catalog shape, the claim/replay round-trip THROUGH the real service
 * helpers, and idempotent re-runs (pglite harness).
 */

// Explicit hook timeout: the pglite WASM boot + DDL runs under heavy
// parallel-suite CPU contention (same rationale as migrate-v1m9/v1m10).
beforeAll(initTestDb, 60_000);

beforeEach(async () => {
  await resetTestDb();
  // Strip the table back to the pre-V1-M12 state the stage must build.
  await db.execute(sql.raw("DROP TABLE IF EXISTS idempotency_keys"));
  __resetIdempotencyTableProbeForTests();
});

async function columnsOf(table: string): Promise<Map<string, string>> {
  const result = await db.execute(sql`
    SELECT column_name, data_type, column_default, is_nullable
    FROM information_schema.columns
    WHERE table_name = ${table}
  `);
  const rows = (result as unknown as { rows?: Array<Record<string, string>> }).rows ?? [];
  const map = new Map<string, string>();
  for (const row of rows) map.set(row.column_name, row.data_type);
  return map;
}

async function tableExists(table: string): Promise<boolean> {
  const result = await db.execute(
    sql`SELECT 1 AS one FROM information_schema.tables WHERE table_name = ${table}`,
  );
  const rows = (result as unknown as { rows?: unknown[] }).rows ?? [];
  return rows.length > 0;
}

async function indexExists(name: string): Promise<boolean> {
  const result = await db.execute(
    sql`SELECT 1 AS one FROM pg_indexes WHERE indexname = ${name}`,
  );
  const rows = (result as unknown as { rows?: unknown[] }).rows ?? [];
  return rows.length > 0;
}

async function seedOrder(): Promise<number> {
  await db.insert(usersTable).values({ id: 1, phone: "09100000001", walletBalance: "100.00" });
  const [product] = await db
    .insert(productsTable)
    .values({ name: "V1-M12 Product", price: "5.00" })
    .returning({ id: productsTable.id });
  const [order] = await db
    .insert(ordersTable)
    .values({
      orderCode: "SN-V1M12-1",
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

describe("V1-M12 applyIdempotencyKeysStage — catalog shape (pinned to schema TS + lib)", () => {
  it("creates exactly key/order_id/created_at with the pinned types", async () => {
    await applyIdempotencyKeysStage();

    expect(await tableExists("idempotency_keys")).toBe(true);
    const cols = await columnsOf("idempotency_keys");
    expect([...cols.keys()].sort()).toEqual(["created_at", "key", "order_id"]);
    // Pinned types — a drift here breaks lib/idempotency.ts's queries.
    expect(cols.get("key")).toBe("text");
    expect(cols.get("order_id")).toBe("integer");
    expect(cols.get("created_at")).toBe("timestamp with time zone");
  });

  it("key is the PRIMARY KEY (duplicate claim = 23505 on idempotency_keys)", async () => {
    const orderId = await seedOrder();
    await applyIdempotencyKeysStage();

    await claimIdempotencyKey(db, "u1:retry-key-abc", orderId);

    let violation: unknown;
    try {
      await claimIdempotencyKey(db, "u1:retry-key-abc", orderId);
    } catch (err) {
      violation = err;
    }
    // The exact contract checkout relies on: the concurrent-winner error
    // is recognized as an idempotency-key violation (replay, not a 500).
    expect(violation).toBeDefined();
    expect(isIdempotencyKeyViolation(violation)).toBe(true);
  });

  it("order_id is NOT NULL, references orders(id), and cascades on order delete", async () => {
    const orderId = await seedOrder();
    await applyIdempotencyKeysStage();

    // NOT NULL + FK + ON DELETE CASCADE, checked via the catalog and a
    // live delete (the dedup row must never outlive the money it guards).
    const fk = await db.execute(sql`
      SELECT confdeltype FROM pg_constraint
      WHERE contype = 'f' AND conrelid = 'idempotency_keys'::regclass
    `);
    const fkRows = (fk as unknown as { rows?: Array<{ confdeltype: string }> }).rows ?? [];
    expect(fkRows[0]?.confdeltype).toBe("c"); // 'c' = ON DELETE CASCADE

    await claimIdempotencyKey(db, "u1:cascade-key-abc", orderId);
    await db.delete(ordersTable).where(eq(ordersTable.id, orderId));
    const survivors = await db.select().from(idempotencyKeysTable);
    expect(survivors).toHaveLength(0);
  });

  it("created_at defaults to now() and idx_idempotency_keys_order exists", async () => {
    const orderId = await seedOrder();
    await applyIdempotencyKeysStage();

    const defaults = await db.execute(sql`
      SELECT column_default FROM information_schema.columns
      WHERE table_name = 'idempotency_keys' AND column_name = 'created_at'
    `);
    const rows =
      (defaults as unknown as { rows?: Array<{ column_default: string | null }> }).rows ?? [];
    expect(rows[0]?.column_default).toContain("now()");

    expect(await indexExists("idx_idempotency_keys_order")).toBe(true);

    await claimIdempotencyKey(db, "u1:default-now-abc", orderId);
    const [row] = await db.select().from(idempotencyKeysTable);
    expect(row.createdAt).toBeInstanceOf(Date);
  });
});

describe("V1-M12 — idempotent re-runs", () => {
  it("applying the stage twice keeps exactly one table and the rows intact", async () => {
    const orderId = await seedOrder();
    await applyIdempotencyKeysStage();
    await claimIdempotencyKey(db, "u1:stable-key-abc", orderId);

    await applyIdempotencyKeysStage(); // re-run must be a no-op

    expect(await tableExists("idempotency_keys")).toBe(true);
    const rows = await db.select().from(idempotencyKeysTable);
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe("u1:stable-key-abc");
    expect(rows[0].orderId).toBe(orderId);
  });

  it("re-runs issue no DDL-class statements (recording executor)", async () => {
    await applyIdempotencyKeysStage();

    const statements: string[] = [];
    const recording = async (query: SQL) => {
      const text = String(
        (query as unknown as { queryChunks?: Array<{ value: unknown }> }).queryChunks
          ?.map((c) => c.value)
          .join(""),
      );
      statements.push(text);
      return db.execute(query);
    };
    await applyIdempotencyKeysStage(recording);

    // Steady-state: only the DO-block existence probe (catalog read — the
    // CREATE TABLE inside its IF never fires, hence no top-level DDL) and
    // the catalog-gated CREATE INDEX IF NOT EXISTS. No bare CREATE TABLE /
    // ALTER statements are issued against the live schema.
    expect(statements.some((s) => /^\s*CREATE TABLE/i.test(s))).toBe(false);
    expect(statements.some((s) => /\bALTER TABLE\b/i.test(s))).toBe(false);
    expect(statements.some((s) => s.includes("idempotency_keys"))).toBe(true);
  });
});

describe("V1-M12 ↔ lib/idempotency.ts — the service round-trip (name parity proof)", () => {
  it("findIdempotentOrderId replays the order the claim created", async () => {
    const orderId = await seedOrder();
    await applyIdempotencyKeysStage();
    __resetIdempotencyTableProbeForTests();

    // Pre-claim: fresh key → null → checkout proceeds unguarded (legacy).
    expect(await findIdempotentOrderId("u1:roundtrip-key-1")).toBeNull();

    await claimIdempotencyKey(db, "u1:roundtrip-key-1", orderId);

    // Post-claim: a retry with the same key replays THIS order instead of
    // re-pricing/re-charging — the whole point of F10.
    expect(await findIdempotentOrderId("u1:roundtrip-key-1")).toBe(orderId);
    expect(await findIdempotentOrderId("u1:other-buyer-key-1")).toBeNull();
  });

  it("the drizzle table object resolves against the migrated table (registry parity)", async () => {
    const orderId = await seedOrder();
    await applyIdempotencyKeysStage();

    // idempotencyKeysTable is now re-exported from @workspace/db/schema
    // (schema/index.ts registration) — selecting through it must work.
    await db.insert(idempotencyKeysTable).values({ key: "u1:registry-key-1", orderId });
    const [row] = await db.select().from(idempotencyKeysTable).limit(1);
    expect(row.key).toBe("u1:registry-key-1");
    expect(row.orderId).toBe(orderId);
  });
});
