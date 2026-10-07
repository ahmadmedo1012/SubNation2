import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  db,
  initTestDb,
  resetTestDb,
  productsTable,
  usersTable,
  walletLedgerTable,
} from "../../test/db";
import { applyMoneyArithmeticChecksStage } from "../../migrate";

/**
 * R122 (A4-P2-5) — V1-M26: the two money CHECKs the R118-A3 F3 sweep
 * stopped short of.
 *
 *   chk_orders_amount_pos    orders.amount > 0 — checkout's INVALID_PRICE
 *                            gate already enforces it at the perimeter;
 *                            the CHECK closes the bypass writers.
 *   chk_ledger_arithmetic    the type-aware wallet_ledger identity —
 *                            purchases DEBIT (after = before - amount,
 *                            positive magnitude + type-carried sign, the
 *                            V1-M10 convention), every other type credits
 *                            (after = before + amount; adjustments store
 *                            signed deltas). The naive uniform identity
 *                            would reject every purchase.
 *
 * Stage shape is the V1-M9 checkConstraints loop verbatim: violation
 * count-probe → alert + skip; DO-block ADD with duplicate_object swallow.
 * The tests follow migrate-v1m9.test.ts (idempotent application, applied
 * constraints reject bad data, violation pre-check paths) and
 * migrate-v1m10.test.ts (legitimate writer rows pass).
 */

// Strip the two V1-M26 constraints back to the pristine pre-stage state
// (the harness DDL ships them — parity with the post-boot shape — so the
// violation paths can be exercised from a genuinely constraint-free DB).
const V1_M26_DROP_STATEMENTS = [
  "ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_amount_pos",
  "ALTER TABLE wallet_ledger DROP CONSTRAINT IF EXISTS chk_ledger_arithmetic",
];

beforeAll(initTestDb, 60_000);
beforeEach(async () => {
  await resetTestDb();
  for (const stmt of V1_M26_DROP_STATEMENTS) {
    await db.execute(sql.raw(stmt));
  }
});

let phoneSeq = 91_600_000;
function nextPhone(): string {
  phoneSeq += 1;
  return String(phoneSeq);
}

async function seedUserAndProduct(): Promise<{ userId: number; productId: number }> {
  const [user] = await db
    .insert(usersTable)
    .values({ phone: nextPhone(), walletBalance: "100.00" })
    .returning();
  const [product] = await db
    .insert(productsTable)
    .values({ name: `v1m26-probe-${phoneSeq}`, price: "10.00" })
    .returning();
  return { userId: user.id, productId: product.id };
}

async function constraintExists(name: string): Promise<boolean> {
  const result = await db.execute(sql`SELECT 1 AS one FROM pg_constraint WHERE conname = ${name}`);
  const rows = (result as unknown as { rows?: unknown[] }).rows ?? [];
  return rows.length > 0;
}

async function countAlerts(dedupeKey: string): Promise<number> {
  const result = await db.execute(
    sql`SELECT count(*) AS c FROM admin_alerts WHERE dedupe_key = ${dedupeKey}`,
  );
  const rows = (result as unknown as { rows?: Array<{ c: number | string }> }).rows ?? [];
  return Number(rows[0]?.c ?? 0);
}

/** Unwrap drizzle's error cause to pin the exact constraint that rejected. */
async function constraintViolationName(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (err) {
    const cause = (err as { cause?: { constraint?: string } }).cause;
    return cause?.constraint ?? (err as { constraint?: string }).constraint;
  }
}

describe("V1-M26 — applyMoneyArithmeticChecksStage (A4-P2-5)", () => {
  it("applies both constraints, and a second run is a clean no-op", async () => {
    await applyMoneyArithmeticChecksStage();
    await applyMoneyArithmeticChecksStage(); // idempotency: no error, same state

    expect(await constraintExists("chk_orders_amount_pos")).toBe(true);
    expect(await constraintExists("chk_ledger_arithmetic")).toBe(true);
  });

  it("the applied CHECKs reject bypass-writer dirt", async () => {
    await applyMoneyArithmeticChecksStage();
    const { userId, productId } = await seedUserAndProduct();

    // Zero-amount order (checkout's INVALID_PRICE gate bypassed).
    expect(
      await constraintViolationName(
        db.execute(
          sql`INSERT INTO orders (order_code, user_id, product_id, amount, status)
              VALUES ('ORD-M26-ZERO', ${userId}, ${productId}, 0, 'pending')`,
        ),
      ),
    ).toBe("chk_orders_amount_pos");

    // Incoherent credit row: after != before + amount for a topup.
    expect(
      await constraintViolationName(
        db.execute(
          sql`INSERT INTO wallet_ledger (user_id, type, amount, balance_before, balance_after)
              VALUES (${userId}, 'topup', 10, 100, 200)`,
        ),
      ),
    ).toBe("chk_ledger_arithmetic");
  });

  it("legitimate writer-convention rows pass — every type, both identities (V1-M10 semantics)", async () => {
    await applyMoneyArithmeticChecksStage();
    const { userId } = await seedUserAndProduct();

    // topup / refund / referral_credit: credit identity, positive amount.
    for (const [type, before, amount] of [
      ["topup", 0, 25],
      ["refund", 85.01, 14.99],
      ["referral_credit", 85.01, 5],
    ] as const) {
      await db.execute(
        sql`INSERT INTO wallet_ledger (user_id, type, amount, balance_before, balance_after)
            VALUES (${userId}, ${type}, ${amount}, ${before}, ${before + amount})`,
      );
    }
    // adjustment: SIGNED delta (amount = after - before).
    await db.execute(
      sql`INSERT INTO wallet_ledger (user_id, type, amount, balance_before, balance_after)
          VALUES (${userId}, 'adjustment', -30, 105, 75)`,
    );
    // purchase: POSITIVE magnitude, DEBIT identity (after = before - amount)
    // — the row the naive uniform CHECK would have rejected.
    await db.execute(
      sql`INSERT INTO wallet_ledger (user_id, type, amount, balance_before, balance_after)
          VALUES (${userId}, 'purchase', 14.99, 100, 85.01)`,
    );
    // A purchase row that violates the debit identity IS rejected.
    expect(
      await constraintViolationName(
        db.execute(
          sql`INSERT INTO wallet_ledger (user_id, type, amount, balance_before, balance_after)
              VALUES (${userId}, 'purchase', 14.99, 100, 114.99)`,
        ),
      ),
    ).toBe("chk_ledger_arithmetic");
  });

  it("violation pre-check: skips the constraint, alerts, and never touches the data", async () => {
    // Dirt that predates the stage (a bypass writer's zero-amount order).
    const { userId, productId } = await seedUserAndProduct();
    await db.execute(
      sql`INSERT INTO orders (order_code, user_id, product_id, amount, status)
          VALUES ('ORD-M26-DIRTY', ${userId}, ${productId}, 0, 'pending')`,
    );

    await applyMoneyArithmeticChecksStage();

    // Constraint NOT added (alert, not a failed ALTER); the dirty row kept.
    expect(await constraintExists("chk_orders_amount_pos")).toBe(false);
    expect(await countAlerts("db:constraint:chk_orders_amount_pos")).toBe(1);
    const dirty = await db.execute(
      sql`SELECT count(*) AS c FROM orders WHERE order_code = 'ORD-M26-DIRTY'`,
    );
    const dirtyRows = (dirty as unknown as { rows?: Array<{ c: number | string }> }).rows ?? [];
    expect(Number(dirtyRows[0]?.c ?? 0)).toBe(1);
    // Per-constraint short-circuit: the OTHER constraint still applied.
    expect(await constraintExists("chk_ledger_arithmetic")).toBe(true);
  });

  it("re-running the violation path dedupes the alert (24h window)", async () => {
    const { userId, productId } = await seedUserAndProduct();
    await db.execute(
      sql`INSERT INTO orders (order_code, user_id, product_id, amount, status)
          VALUES ('ORD-M26-DIRTY2', ${userId}, ${productId}, 0, 'pending')`,
    );
    await applyMoneyArithmeticChecksStage();
    await applyMoneyArithmeticChecksStage();
    expect(await countAlerts("db:constraint:chk_orders_amount_pos")).toBe(1);
  });

  it("applies the previously-skipped constraint once the data is fixed", async () => {
    const { userId, productId } = await seedUserAndProduct();
    await db.execute(
      sql`INSERT INTO orders (order_code, user_id, product_id, amount, status)
          VALUES ('ORD-M26-FIXABLE', ${userId}, ${productId}, 0, 'pending')`,
    );
    await applyMoneyArithmeticChecksStage();
    expect(await constraintExists("chk_orders_amount_pos")).toBe(false);

    await db.execute(sql`UPDATE orders SET amount = 10 WHERE order_code = 'ORD-M26-FIXABLE'`);
    await applyMoneyArithmeticChecksStage();
    expect(await constraintExists("chk_orders_amount_pos")).toBe(true);
  });

  it("the ledger arithmetic skip path alerts without blocking the orders twin", async () => {
    // An incoherent historical topup row (e.g. a hand-edited backup).
    const { userId } = await seedUserAndProduct();
    await db.execute(
      sql`INSERT INTO wallet_ledger (user_id, type, amount, balance_before, balance_after)
          VALUES (${userId}, 'topup', 10, 100, 200)`,
    );

    await applyMoneyArithmeticChecksStage();

    expect(await constraintExists("chk_ledger_arithmetic")).toBe(false);
    expect(await countAlerts("db:constraint:chk_ledger_arithmetic")).toBe(1);
    expect(await constraintExists("chk_orders_amount_pos")).toBe(true);
    // The incoherent row was NOT modified by boot.
    const row = await db
      .select()
      .from(walletLedgerTable)
      .where(eq(walletLedgerTable.userId, userId));
    expect(row).toHaveLength(1);
    expect(parseFloat(String(row[0].balanceAfter))).toBe(200);
  });
});
