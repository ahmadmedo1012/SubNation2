/**
 * lib/ledger.ts — insertLedgerEntry, unit-pinned. Every LYD wallet write
 * in the app flows through this one function (checkout purchase debit,
 * topup credit, refund credit, admin adjustment, welcome bonus), yet it
 * had only indirect coverage through the service suites.
 *
 * Pinned contracts (against the REAL harness DDL — test/db.ts mirrors
 * the production V1-M9/V1-M10/V1-M26 constraint set):
 *
 *   1. arithmetic identity (chk_ledger_arithmetic): purchase debits
 *      after = before − amount; every other type credits
 *      after = before + amount (adjustments carry signed deltas);
 *   2. reference plumbing: referenceType/referenceId/description
 *      round-trip (the columns the refund/topup attribution reads);
 *   3. tx-rollback propagation: an insert riding a caller transaction
 *      that later throws is GONE — the ledger never outlives the
 *      balance mutation it explains;
 *   4. DB-level backstops, violated deliberately: chk_ledger_arithmetic
 *      and chk_ledger_amount_nonzero reject bad rows, and — the wallet
 *      backstop — chk_users_wallet_balance_nonneg rejects a negative
 *      wallet state and drags the ledger insert down with it (a
 *      negative-balance entry can never be committed).
 *
 * Error-shape note: drizzle wraps the driver error, so the Postgres
 * constraint name rides `cause` — the chain helper below surfaces it
 * (same idiom as wallet-never-negative.test.ts).
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, initTestDb, resetTestDb, usersTable, walletLedgerTable } from "../../test/db";
import { insertLedgerEntry } from "../ledger";

beforeAll(async () => {
  // 30s hook budget (coupon-watcher-gate exemplar): initTestDb builds the
  // full pglite DDL — under a contended sandbox that exceeds the 10s default.
  await initTestDb();
}, 30_000);
beforeEach(async () => {
  await resetTestDb();
});

// Deterministic seeds (no Math.random — the repo's phoneSeq convention).
let phoneSeq = 913_313_000;
function nextPhone(): string {
  phoneSeq += 1;
  return String(phoneSeq);
}

async function seedUser(balance = "50.00") {
  const [u] = await db
    .insert(usersTable)
    .values({ phone: nextPhone(), walletBalance: balance })
    .returning();
  return u;
}

async function ledgerRows(userId: number) {
  return db.select().from(walletLedgerTable).where(eq(walletLedgerTable.userId, userId));
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
): Promise<string> {
  let caught: unknown;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeTruthy();
  const chain = errorChain(caught);
  expect(chain).toMatch(constraint);
  return chain;
}

describe("insertLedgerEntry — arithmetic identity (chk_ledger_arithmetic)", () => {
  it("purchase flavor: balance_after = balance_before − amount, all columns round-trip, returns the row id", async () => {
    const user = await seedUser("50.00");

    const id = await insertLedgerEntry({
      userId: user.id,
      type: "purchase",
      amount: "10.00",
      balanceBefore: "50.00",
      balanceAfter: "40.00",
      referenceId: 4242,
      referenceType: "order",
      description: "Purchase: ledger-test product",
    });

    const rows = await ledgerRows(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(id); // R115: the returned id links cross-ledger references
    expect(rows[0].type).toBe("purchase");
    expect(parseFloat(String(rows[0].amount))).toBe(10);
    expect(parseFloat(String(rows[0].balanceBefore))).toBe(50);
    expect(parseFloat(String(rows[0].balanceAfter))).toBe(40); // 50 − 10
    expect(rows[0].referenceId).toBe(4242);
    expect(rows[0].referenceType).toBe("order");
    expect(rows[0].description).toBe("Purchase: ledger-test product");
  });

  it("credit flavors: balance_after = balance_before + amount (topup credit; signed adjustment debit)", async () => {
    const user = await seedUser("50.00");

    await insertLedgerEntry({
      userId: user.id,
      type: "topup",
      amount: "10.00",
      balanceBefore: "50.00",
      balanceAfter: "60.00",
      referenceId: 7,
      referenceType: "topup",
    });
    // Adjustments store SIGNED deltas (V1-M10): a −5 debit is
    // after = before + amount = 50 + (−5).
    await insertLedgerEntry({
      userId: user.id,
      type: "adjustment",
      amount: "-5.00",
      balanceBefore: "60.00",
      balanceAfter: "55.00",
    });

    const rows = await ledgerRows(user.id);
    expect(rows).toHaveLength(2);
    expect(parseFloat(String(rows[0].balanceAfter))).toBe(60);
    expect(parseFloat(String(rows[1].amount))).toBe(-5);
    expect(parseFloat(String(rows[1].balanceAfter))).toBe(55);
  });

  it("DB backstop: arithmetic mismatch REJECTS with chk_ledger_arithmetic (purchase credited instead of debited)", async () => {
    const user = await seedUser("50.00");

    // The classic drift bug: purchase computed with the CREDIT identity
    // (after = before + amount) instead of the debit one.
    await expectRejectsMatching(
      () =>
        insertLedgerEntry({
          userId: user.id,
          type: "purchase",
          amount: "10.00",
          balanceBefore: "50.00",
          balanceAfter: "60.00", // 50 + 10 — wrong sign for a purchase
        }),
      /chk_ledger_arithmetic/,
    );
    expect(await ledgerRows(user.id)).toHaveLength(0);
  });

  it("DB backstop: a zero-amount entry REJECTS with chk_ledger_amount_nonzero", async () => {
    const user = await seedUser("50.00");

    await expectRejectsMatching(
      () =>
        insertLedgerEntry({
          userId: user.id,
          type: "topup",
          amount: "0.00",
          balanceBefore: "50.00",
          balanceAfter: "50.00",
        }),
      /chk_ledger_amount_nonzero/,
    );
    expect(await ledgerRows(user.id)).toHaveLength(0);
  });
});

describe("insertLedgerEntry — reference plumbing", () => {
  it("omitted reference/description default to NULL (the legacy unattributed shape)", async () => {
    const user = await seedUser("50.00");

    await insertLedgerEntry({
      userId: user.id,
      type: "topup",
      amount: "10.00",
      balanceBefore: "50.00",
      balanceAfter: "60.00",
    });

    const [row] = await ledgerRows(user.id);
    expect(row.referenceId).toBeNull();
    expect(row.referenceType).toBeNull();
    expect(row.description).toBeNull();
  });
});

describe("insertLedgerEntry — transaction propagation", () => {
  it("rides the caller's COMMIT: the row lands with the balance mutation", async () => {
    const user = await seedUser("50.00");

    await db.transaction(async (tx) => {
      await tx.update(usersTable).set({ walletBalance: "40.00" }).where(eq(usersTable.id, user.id));
      // `tx as unknown as typeof db` — the repo idiom for handing a
      // drizzle transaction to the DbOrTx-parameterized ledger writers
      // (checkout.service.ts does the same at every call site).
      await insertLedgerEntry(
        {
          userId: user.id,
          type: "purchase",
          amount: "10.00",
          balanceBefore: "50.00",
          balanceAfter: "40.00",
          referenceId: 99,
          referenceType: "order",
        },
        tx as unknown as typeof db,
      );
    });

    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(40);
    expect(await ledgerRows(user.id)).toHaveLength(1);
  });

  it("rides the caller's ROLLBACK: a probe that throws AFTER the insert erases the row", async () => {
    const user = await seedUser("50.00");

    await expect(
      db.transaction(async (tx) => {
        await insertLedgerEntry(
          {
            userId: user.id,
            type: "topup",
            amount: "10.00",
            balanceBefore: "50.00",
            balanceAfter: "60.00",
          },
          tx as unknown as typeof db,
        );
        // The insert already resolved — a LATER statement failing in the
        // same tx must take the ledger row with it (the source-of-truth
        // rule: the ledger never outlives the mutation it explains).
        throw new Error("PROBE_ROLLBACK");
      }),
    ).rejects.toThrow("PROBE_ROLLBACK");

    expect(await ledgerRows(user.id)).toHaveLength(0);
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(50);
  });

  it("the wallet-level negative-balance backstop: chk_users_wallet_balance_nonneg rejects the tx AND the ledger row with it", async () => {
    const user = await seedUser("50.00");

    // The double-debit shape: a purchase that would drive the wallet to
    // −10.00 (ledger arithmetic itself is CONSISTENT — 50 − 60 = −10 —
    // so the wallet CHECK on users is the layer that must refuse, and
    // the ledger insert cannot survive the refusal).
    await expectRejectsMatching(
      () =>
        db.transaction(async (tx) => {
          await insertLedgerEntry(
            {
              userId: user.id,
              type: "purchase",
              amount: "60.00",
              balanceBefore: "50.00",
              balanceAfter: "-10.00",
            },
            tx as unknown as typeof db,
          );
          await tx
            .update(usersTable)
            .set({ walletBalance: "-10.00" })
            .where(eq(usersTable.id, user.id));
        }),
      /chk_users_wallet_balance_nonneg/,
    );

    // Neither half of the pair persisted: wallet intact, no ledger row.
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(50);
    expect(await ledgerRows(user.id)).toHaveLength(0);
  });
});
