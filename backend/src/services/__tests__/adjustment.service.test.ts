/**
 * AdjustmentService — F-004 (security audit 004) regression coverage.
 *
 * Asserts that admin wallet adjustments:
 *   - update wallet balance atomically with a ledger entry
 *   - record balanceBefore / balanceAfter on the ledger row
 *   - reject negative-balance results (overdraft prevention)
 *   - reject zero-delta calls (no-op detection)
 *   - reject unknown users
 *   - use type=adjustment + referenceType=admin_adjustment for filterable trail
 *
 * Closes audit Finding F-004 (specs/004-security-audit/security.md).
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, initTestDb, resetTestDb, usersTable, walletLedgerTable } from "../../test/db";
import { AdjustmentError, AdjustmentService } from "../adjustment.service";

beforeAll(async () => {
  await initTestDb();
});
beforeEach(async () => {
  await resetTestDb();
});

async function makeUser(balance = "0.00") {
  const [u] = await db
    .insert(usersTable)
    .values({ phone: `9${Math.floor(Math.random() * 1e8)}`, walletBalance: balance })
    .returning();
  return u;
}

const ADMIN_ID = 42;

describe("AdjustmentService.adjust — F-004", () => {
  it("credits wallet AND writes a ledger entry atomically (F-004 happy path)", async () => {
    const user = await makeUser("100.00");

    const result = await AdjustmentService.adjust(user.id, 50, {
      adminId: ADMIN_ID,
      note: "manual top-up correction",
    });

    expect(result.walletBalance).toBe(150);

    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(150);

    const ledger = await db
      .select()
      .from(walletLedgerTable)
      .where(eq(walletLedgerTable.userId, user.id));
    expect(ledger).toHaveLength(1);
    expect(ledger[0].type).toBe("adjustment");
    expect(parseFloat(String(ledger[0].balanceBefore))).toBe(100);
    expect(parseFloat(String(ledger[0].balanceAfter))).toBe(150);
    expect(parseFloat(String(ledger[0].amount))).toBe(50);
    expect(ledger[0].referenceType).toBe("admin_adjustment");
    expect(ledger[0].referenceId).toBe(ADMIN_ID);
    expect(ledger[0].description).toContain("manual top-up");
  });

  it("debits wallet on a negative delta (admin reversal)", async () => {
    const user = await makeUser("100.00");

    const result = await AdjustmentService.adjust(user.id, -30, {
      adminId: ADMIN_ID,
      note: "credit reversal",
    });

    expect(result.walletBalance).toBe(70);
    const ledger = await db
      .select()
      .from(walletLedgerTable)
      .where(eq(walletLedgerTable.userId, user.id));
    expect(parseFloat(String(ledger[0].amount))).toBe(-30);
    expect(parseFloat(String(ledger[0].balanceAfter))).toBe(70);
  });

  it("rejects zero delta as a no-op (no ledger row written)", async () => {
    const user = await makeUser("100.00");

    await expect(
      AdjustmentService.adjust(user.id, 0, { adminId: ADMIN_ID, note: "no-op" }),
    ).rejects.toBeInstanceOf(AdjustmentError);

    expect(await db.select().from(walletLedgerTable)).toHaveLength(0);
  });

  it("rejects an adjustment that would produce a negative balance", async () => {
    const user = await makeUser("20.00");

    await expect(
      AdjustmentService.adjust(user.id, -50, { adminId: ADMIN_ID, note: "overdraft" }),
    ).rejects.toThrow(/سالباً/);

    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(20); // unchanged
    expect(await db.select().from(walletLedgerTable)).toHaveLength(0);
  });

  it("rejects an unknown user with USER_NOT_FOUND", async () => {
    await expect(
      AdjustmentService.adjust(999_999, 10, { adminId: ADMIN_ID, note: "ghost" }),
    ).rejects.toMatchObject({ code: "USER_NOT_FOUND" });

    expect(await db.select().from(walletLedgerTable)).toHaveLength(0);
  });

  // ── Round-3 regression tests (8-d #4): assertFiniteAmount shipped in
  // Round 2 (H6 — 1e999/NaN JSON payloads) with NO tests. These pin the
  // exact fail-closed contract: no ledger row, no balance mutation.
  it.each([
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["NaN", Number.NaN],
  ])("rejects a non-finite delta (%s) with INVALID_AMOUNT and writes nothing", async (_label, bad) => {
    const user = await makeUser("100.00");
    await expect(
      AdjustmentService.adjust(user.id, bad, { adminId: ADMIN_ID, note: "bad" }),
    ).rejects.toMatchObject({ code: "INVALID_AMOUNT" });

    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(100);
    expect(await db.select().from(walletLedgerTable)).toHaveLength(0);
  });

  it("rejects an out-of-bounds delta (1e999 parsed from JSON) with INVALID_AMOUNT", async () => {
    const user = await makeUser("100.00");
    // JSON.parse turns 1e999 into Infinity — the exact H6 payload.
    const parsed = JSON.parse('{"delta": 1e999}').delta;
    expect(parsed).toBe(Number.POSITIVE_INFINITY);
    await expect(
      AdjustmentService.adjust(user.id, parsed, { adminId: ADMIN_ID, note: "huge" }),
    ).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
    expect(await db.select().from(walletLedgerTable)).toHaveLength(0);
  });
});

describe("AdjustmentService.setBalance — F-004", () => {
  it("replaces balance and records the implicit delta in the ledger", async () => {
    const user = await makeUser("100.00");

    const result = await AdjustmentService.setBalance(user.id, 25, {
      adminId: ADMIN_ID,
      note: "promo balance set",
    });

    expect(result.walletBalance).toBe(25);

    const ledger = await db
      .select()
      .from(walletLedgerTable)
      .where(eq(walletLedgerTable.userId, user.id));
    expect(ledger).toHaveLength(1);
    expect(parseFloat(String(ledger[0].balanceBefore))).toBe(100);
    expect(parseFloat(String(ledger[0].balanceAfter))).toBe(25);
    // amount = balanceAfter - balanceBefore = 25 - 100 = -75
    expect(parseFloat(String(ledger[0].amount))).toBe(-75);
  });

  it("rejects a negative target balance", async () => {
    const user = await makeUser("50.00");

    await expect(
      AdjustmentService.setBalance(user.id, -10, { adminId: ADMIN_ID, note: "bad" }),
    ).rejects.toMatchObject({ code: "NEGATIVE_BALANCE" });

    expect(await db.select().from(walletLedgerTable)).toHaveLength(0);
  });
});

describe("AdjustmentService — ledger reconstruction invariant", () => {
  it("sum of ledger amounts equals current balance after a series of adjustments (Constitution Principle I)", async () => {
    const user = await makeUser("0.00");

    await AdjustmentService.adjust(user.id, 100, {
      adminId: ADMIN_ID,
      note: "initial credit",
    });
    await AdjustmentService.adjust(user.id, -25, {
      adminId: ADMIN_ID,
      note: "first reversal",
    });
    await AdjustmentService.adjust(user.id, 50, {
      adminId: ADMIN_ID,
      note: "second credit",
    });

    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    const ledger = await db
      .select()
      .from(walletLedgerTable)
      .where(eq(walletLedgerTable.userId, user.id));

    const ledgerSum = ledger.reduce((acc, row) => acc + parseFloat(String(row.amount)), 0);
    expect(parseFloat(String(u.walletBalance))).toBe(125);
    expect(+ledgerSum.toFixed(2)).toBe(125);
    expect(ledger).toHaveLength(3);
    // The latest ledger row's balanceAfter must equal current balance.
    const latest = ledger[ledger.length - 1];
    expect(parseFloat(String(latest.balanceAfter))).toBe(parseFloat(String(u.walletBalance)));
  });
});
