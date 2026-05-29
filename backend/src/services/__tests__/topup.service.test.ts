import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, initTestDb, resetTestDb, usersTable, walletLedgerTable } from "../../test/db";
import { eq } from "drizzle-orm";
import { TopupService } from "../topup.service";

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

describe("Wallet top-up (pglite-isolated)", () => {
  it("credits the wallet and appends a ledger entry atomically", async () => {
    const user = await makeUser("10.00");

    const topup = await TopupService.createApprovedTopup(user.id, 25, "test-gw", "ref-1");

    const [after] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(after.walletBalance))).toBe(35); // 10 + 25
    expect(topup.status).toBe("approved");

    const ledger = await db
      .select()
      .from(walletLedgerTable)
      .where(eq(walletLedgerTable.userId, user.id));
    expect(ledger).toHaveLength(1);
    expect(ledger[0].type).toBe("topup");
    expect(parseFloat(String(ledger[0].balanceBefore))).toBe(10);
    expect(parseFloat(String(ledger[0].balanceAfter))).toBe(35);
    expect(ledger[0].referenceId).toBe(topup.id);
  });

  it("rejects a top-up for a non-existent user (no rows written)", async () => {
    await expect(TopupService.createApprovedTopup(999999, 50, "gw", "ref-x")).rejects.toThrow();
    const ledger = await db.select().from(walletLedgerTable);
    expect(ledger).toHaveLength(0);
  });
});
