/**
 * B2-08 (round-92 audit) — MAX_ABS_ADJUSTMENT (1e9 LYD) exceeded the
 * wallet_balance column capacity numeric(10,2) (max 99,999,999.99): an
 * admin wallet_adjustment of +600,000,000 passed assertFiniteAmount and
 * the NEGATIVE_BALANCE checks, then the UPDATE failed with Postgres
 * `numeric field overflow` → unhandled 500 on a money route.
 *
 * Fix under test: the service-level bound is clamped to the column
 * capacity, and the RESULTING balance (small delta on a near-max balance)
 * is validated before the UPDATE too.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, initTestDb, resetTestDb, usersTable, walletLedgerTable } from "../../test/db";
import { AdjustmentService } from "../adjustment.service";

beforeAll(async () => {
  await initTestDb();
});
beforeEach(async () => {
  await resetTestDb();
});

const ADMIN_ID = 42;
const NOTE = { adminId: ADMIN_ID, note: "B2-08 cap test" };

let phoneSeq = 91_600_000;
function nextPhone(): string {
  phoneSeq += 1;
  return String(phoneSeq);
}

async function makeUser(balance = "0.00") {
  const [u] = await db
    .insert(usersTable)
    .values({ phone: nextPhone(), walletBalance: balance })
    .returning();
  return u;
}

describe("B2-08: adjustment bound matches numeric(10,2) capacity", () => {
  it("rejects adjust(+100,000,000) with INVALID_AMOUNT (400) — above the 99,999,999.99 column max", async () => {
    const user = await makeUser("0.00");
    await expect(AdjustmentService.adjust(user.id, 100_000_000, NOTE)).rejects.toMatchObject({
      code: "INVALID_AMOUNT",
      statusCode: 400,
    });
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(0);
    expect(await db.select().from(walletLedgerTable)).toHaveLength(0);
  });

  it("rejects setBalance(100,000,000) with INVALID_AMOUNT", async () => {
    const user = await makeUser("0.00");
    await expect(AdjustmentService.setBalance(user.id, 100_000_000, NOTE)).rejects.toMatchObject({
      code: "INVALID_AMOUNT",
      statusCode: 400,
    });
  });

  it("rejects adjust(-100,000,000) (magnitude, not sign, is bounded)", async () => {
    const user = await makeUser("50.00");
    await expect(AdjustmentService.adjust(user.id, -100_000_000, NOTE)).rejects.toMatchObject({
      code: "INVALID_AMOUNT",
    });
  });

  it("accepts the representable boundary: setBalance(99,999,999.99) commits and ledger-reconstructs", async () => {
    const user = await makeUser("0.00");
    const result = await AdjustmentService.setBalance(user.id, 99_999_999.99, NOTE);
    expect(result.walletBalance).toBe(99_999_999.99);
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(99_999_999.99);
    const [entry] = await db.select().from(walletLedgerTable);
    expect(parseFloat(String(entry.balanceAfter))).toBe(99_999_999.99);
  });

  it("rejects a small delta whose RESULT would overflow the column (balance 99,999,999.99 + 1)", async () => {
    const user = await makeUser("99999999.99");
    const [row] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(row.walletBalance))).toBe(99_999_999.99);

    await expect(AdjustmentService.adjust(user.id, 1, NOTE)).rejects.toMatchObject({
      code: "INVALID_AMOUNT",
    });
    // Balance unchanged, no ledger row.
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(99_999_999.99);
    expect(await db.select().from(walletLedgerTable)).toHaveLength(0);
  });

  it("ordinary adjustments still work (no false positive from the new guards)", async () => {
    const user = await makeUser("10.00");
    const result = await AdjustmentService.adjust(user.id, 5, NOTE);
    expect(result.walletBalance).toBe(15);
    expect(result.ledger.amount).toBe(5);
  });
});
