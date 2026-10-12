/**
 * lib/points-ledger.ts — insertPointsLedgerEntry (+ findRefundReversal),
 * unit-pinned. Points are LYD-convertible money (100:1, R115) and every
 * points write flows through this one function, yet it had only indirect
 * coverage through the checkout/refund service suites.
 *
 * Pinned contracts (against the REAL harness DDL — test/db.ts mirrors
 * the V1-M21 constraint set from migrate.ts applyPointsLedgerStage):
 *
 *   1. arithmetic identity (chk_points_ledger_arithmetic):
 *      points_after = points_before + points_delta — award and reversal
 *      flavors both land;
 *   2. reference plumbing: referenceType/referenceId round-trip,
 *      lydCredited for conversion_out, and findRefundReversal resolves
 *      the row a later refund reads (the attribution half);
 *   3. tx-rollback propagation: an insert riding a caller transaction
 *      that throws after is GONE — the ledger never outlives the
 *      loyalty_points mutation it explains;
 *   4. DB-level backstops, violated deliberately:
 *      chk_points_ledger_balances_nonneg (a negative-balance entry must
 *      REJECT), chk_points_ledger_arithmetic (drifted arithmetic),
 *      chk_points_ledger_delta_nonzero (a zero delta), and
 *      chk_points_ledger_reason_for_manual (admin_set/correction need a
 *      reason) — plus the structural exactly-once partial UNIQUE
 *      uniq_points_ledger_type_reference (one award per order).
 *
 * Error-shape note: drizzle wraps the driver error, so the Postgres
 * constraint name rides `cause` — same idiom as ledger.test.ts /
 * wallet-never-negative.test.ts.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, initTestDb, pointsLedgerTable, resetTestDb, usersTable } from "../../test/db";
import { findRefundReversal, insertPointsLedgerEntry } from "../points-ledger";

beforeAll(async () => {
  // 30s hook budget (coupon-watcher-gate exemplar): initTestDb builds the
  // full pglite DDL — under a contended sandbox that exceeds the 10s default.
  await initTestDb();
}, 30_000);
beforeEach(async () => {
  await resetTestDb();
});

// Deterministic seeds (no Math.random — the repo's phoneSeq convention).
let phoneSeq = 913_315_000;
function nextPhone(): string {
  phoneSeq += 1;
  return String(phoneSeq);
}

async function seedUser(loyaltyPoints = 0) {
  const [u] = await db.insert(usersTable).values({ phone: nextPhone(), loyaltyPoints }).returning();
  return u;
}

async function pointsRows(userId: number) {
  return db.select().from(pointsLedgerTable).where(eq(pointsLedgerTable.userId, userId));
}

/** Drizzle wraps driver errors — the constraint name rides `cause`. */
function errorChain(err: unknown): string {
  return [err, (err as { cause?: unknown } | null)?.cause]
    .filter(Boolean)
    .map((e) => String((e as Error).message ?? e))
    .join(" | ");
}

async function expectRejectsMatching(
  fn: () => Promise<unknown>,
  constraint: RegExp,
): Promise<void> {
  let caught: unknown;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeTruthy();
  expect(errorChain(caught)).toMatch(constraint);
}

describe("insertPointsLedgerEntry — arithmetic identity (chk_points_ledger_arithmetic)", () => {
  it("purchase_award flavor: after = before + delta, all columns round-trip", async () => {
    const user = await seedUser(0);

    await insertPointsLedgerEntry({
      userId: user.id,
      type: "purchase_award",
      pointsDelta: 10,
      pointsBefore: 0,
      pointsAfter: 10,
      referenceId: 4242,
      referenceType: "order",
    });

    const rows = await pointsRows(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("purchase_award");
    expect(rows[0].pointsDelta).toBe(10);
    expect(rows[0].pointsBefore).toBe(0);
    expect(rows[0].pointsAfter).toBe(10); // 0 + 10
    expect(rows[0].referenceId).toBe(4242);
    expect(rows[0].referenceType).toBe("order");
  });

  it("refund_reversal flavor: after = before + (negative delta)", async () => {
    const user = await seedUser(10);

    await insertPointsLedgerEntry({
      userId: user.id,
      type: "refund_reversal",
      pointsDelta: -10,
      pointsBefore: 10,
      pointsAfter: 0,
      referenceId: 4242,
      referenceType: "order",
    });

    const [row] = await pointsRows(user.id);
    expect(row.pointsDelta).toBe(-10);
    expect(row.pointsAfter).toBe(0); // 10 + (−10)
  });

  it("DB backstop: drifted arithmetic REJECTS with chk_points_ledger_arithmetic", async () => {
    const user = await seedUser(10);

    await expectRejectsMatching(
      () =>
        insertPointsLedgerEntry({
          userId: user.id,
          type: "purchase_award",
          pointsDelta: 10,
          pointsBefore: 10,
          pointsAfter: 15, // 10 + 10 ≠ 15
        }),
      /chk_points_ledger_arithmetic/,
    );
    expect(await pointsRows(user.id)).toHaveLength(0);
  });
});

describe("insertPointsLedgerEntry — DB-level backstops (violated deliberately)", () => {
  it("a NEGATIVE-BALANCE entry must REJECT: chk_points_ledger_balances_nonneg", async () => {
    const user = await seedUser(10);

    // Arithmetic is internally CONSISTENT (10 + (−15) = −5) — the
    // non-negativity CHECK is the layer that must refuse a balance
    // crossing below zero, exactly like the wallet's
    // chk_users_wallet_balance_nonneg twin.
    await expectRejectsMatching(
      () =>
        insertPointsLedgerEntry({
          userId: user.id,
          type: "correction",
          pointsDelta: -15,
          pointsBefore: 10,
          pointsAfter: -5,
          reason: "over-revoke attempt",
        }),
      /chk_points_ledger_balances_nonneg/,
    );
    expect(await pointsRows(user.id)).toHaveLength(0);
  });

  it("a zero-delta entry REJECTS with chk_points_ledger_delta_nonzero (no no-op ledger noise)", async () => {
    const user = await seedUser(10);

    await expectRejectsMatching(
      () =>
        insertPointsLedgerEntry({
          userId: user.id,
          type: "purchase_award",
          pointsDelta: 0,
          pointsBefore: 10,
          pointsAfter: 10,
          referenceId: 1,
          referenceType: "order",
        }),
      /chk_points_ledger_delta_nonzero/,
    );
    expect(await pointsRows(user.id)).toHaveLength(0);
  });

  it("manual types need a reason: admin_set without one REJECTS (chk_points_ledger_reason_for_manual)", async () => {
    const user = await seedUser(0);

    await expectRejectsMatching(
      () =>
        insertPointsLedgerEntry({
          userId: user.id,
          type: "admin_set",
          pointsDelta: 50,
          pointsBefore: 0,
          pointsAfter: 50,
        }),
      /chk_points_ledger_reason_for_manual/,
    );

    // With the reason supplied the same shape lands.
    await insertPointsLedgerEntry({
      userId: user.id,
      type: "admin_set",
      pointsDelta: 50,
      pointsBefore: 0,
      pointsAfter: 50,
      actorAdminId: 1,
      reason: "goodwill grant",
    });
    const rows = await pointsRows(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].reason).toBe("goodwill grant");
    expect(rows[0].actorAdminId).toBe(1);
  });

  it("exactly-once: a second purchase_award with the SAME reference_id REJECTS (uniq_points_ledger_type_reference)", async () => {
    const user = await seedUser(0);

    await insertPointsLedgerEntry({
      userId: user.id,
      type: "purchase_award",
      pointsDelta: 10,
      pointsBefore: 0,
      pointsAfter: 10,
      referenceId: 777,
      referenceType: "order",
    });
    await expectRejectsMatching(
      () =>
        insertPointsLedgerEntry({
          userId: user.id,
          type: "purchase_award",
          pointsDelta: 10,
          pointsBefore: 10,
          pointsAfter: 20,
          referenceId: 777, // the same order — a double award is structural
          referenceType: "order",
        }),
      /uniq_points_ledger_type_reference|duplicate key/i,
    );
    expect(await pointsRows(user.id)).toHaveLength(1);
  });
});

describe("insertPointsLedgerEntry — reference plumbing + the attribution read", () => {
  it("conversion_out carries lydCredited and round-trips its reference", async () => {
    const user = await seedUser(100);

    await insertPointsLedgerEntry({
      userId: user.id,
      type: "conversion_out",
      pointsDelta: -100,
      pointsBefore: 100,
      pointsAfter: 0,
      lydCredited: 1.0,
      referenceId: 55,
      referenceType: "conversion",
    });

    const [row] = await pointsRows(user.id);
    expect(parseFloat(String(row.lydCredited))).toBe(1); // 100:1
    expect(row.referenceType).toBe("conversion");
    expect(row.referenceId).toBe(55);
  });

  it("findRefundReversal resolves exactly the (type='refund_reversal', reference_type='order', reference_id) row", async () => {
    const user = await seedUser(10);

    expect(await findRefundReversal(4242)).toBeNull(); // nothing yet
    await insertPointsLedgerEntry({
      userId: user.id,
      type: "refund_reversal",
      pointsDelta: -10,
      pointsBefore: 10,
      pointsAfter: 0,
      referenceId: 4242,
      referenceType: "order",
    });

    const found = await findRefundReversal(4242);
    expect(found).not.toBeNull();
    expect(found?.pointsDelta).toBe(-10);
    // Scoped to THIS order — another order's reversal is invisible.
    expect(await findRefundReversal(9999)).toBeNull();
  });
});

describe("insertPointsLedgerEntry — transaction propagation", () => {
  it("rides the caller's COMMIT: the row lands with the users.loyalty_points mutation", async () => {
    const user = await seedUser(0);

    await db.transaction(async (tx) => {
      await tx.update(usersTable).set({ loyaltyPoints: 10 }).where(eq(usersTable.id, user.id));
      await insertPointsLedgerEntry(
        {
          userId: user.id,
          type: "purchase_award",
          pointsDelta: 10,
          pointsBefore: 0,
          pointsAfter: 10,
          referenceId: 99,
          referenceType: "order",
        },
        // `tx as unknown as typeof db` — the repo idiom for the DbOrTx
        // parameter (checkout.service.ts does the same).
        tx as unknown as typeof db,
      );
    });

    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(u.loyaltyPoints).toBe(10);
    expect(await pointsRows(user.id)).toHaveLength(1);
  });

  it("rides the caller's ROLLBACK: a probe that throws AFTER the insert erases the row", async () => {
    const user = await seedUser(0);

    await expect(
      db.transaction(async (tx) => {
        await insertPointsLedgerEntry(
          {
            userId: user.id,
            type: "purchase_award",
            pointsDelta: 10,
            pointsBefore: 0,
            pointsAfter: 10,
            referenceId: 100,
            referenceType: "order",
          },
          tx as unknown as typeof db,
        );
        throw new Error("PROBE_ROLLBACK");
      }),
    ).rejects.toThrow("PROBE_ROLLBACK");

    expect(await pointsRows(user.id)).toHaveLength(0);
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(u.loyaltyPoints).toBe(0);
  });
});
