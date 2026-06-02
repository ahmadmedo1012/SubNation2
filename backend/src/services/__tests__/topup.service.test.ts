import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  db,
  initTestDb,
  resetTestDb,
  usersTable,
  walletLedgerTable,
  walletTopupsTable,
} from "../../test/db";
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

  it("F-007: approve() reads balance INSIDE the transaction so a concurrent change does not skew the ledger", async () => {
    // Setup: user balance = 100, pending topup of +50.
    // Without F-007, approve() captured balance=100 from the outer
    // SELECT (line 84). If a concurrent purchase / topup mutated the
    // balance to 80 before approve() reached its inner UPDATE, the
    // UPDATE would still write 100+50=150 (overwriting the concurrent
    // change to 80) and the ledger would record balanceBefore=100
    // while the actual pre-approval balance was 80 — ledger
    // reconstruction breaks.
    //
    // With F-007, the inner re-read sees balance=80, the
    // optimistic-lock UPDATE writes 130, and the ledger correctly
    // records balanceBefore=80, balanceAfter=130. Sum-of-ledger
    // equals final balance.
    const user = await makeUser("100.00");
    const [topup] = await db
      .insert(walletTopupsTable)
      .values({
        userId: user.id,
        amount: "50.00",
        paymentMethod: "manual",
        status: "pending",
      })
      .returning();

    // TopupService.approve() reads the user once before opening its
    // transaction. We mutate the balance directly between approve()'s
    // outer SELECT and its inner UPDATE — simulating a concurrent
    // committed purchase or topup. The inner re-read inside the tx
    // must see the new value (80), not the stale outer-SELECT value
    // (100).
    await db.update(usersTable).set({ walletBalance: "80.00" }).where(eq(usersTable.id, user.id));

    await TopupService.approve(topup.id, "ok");

    const [after] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    // Final balance = 80 (post-mutation) + 50 (topup) = 130, NOT 150.
    expect(parseFloat(String(after.walletBalance))).toBe(130);

    const ledger = await db
      .select()
      .from(walletLedgerTable)
      .where(eq(walletLedgerTable.userId, user.id));
    expect(ledger).toHaveLength(1);
    expect(parseFloat(String(ledger[0].balanceBefore))).toBe(80);
    expect(parseFloat(String(ledger[0].balanceAfter))).toBe(130);
    // Ledger reconstruction must equal current balance — Constitution
    // Principle I.
    expect(parseFloat(String(ledger[0].balanceAfter))).toBe(
      parseFloat(String(after.walletBalance)),
    );
  });
});
