import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  db,
  initTestDb,
  inventoryTable,
  ordersTable,
  productsTable,
  resetTestDb,
  usersTable,
  walletLedgerTable,
} from "../../test/db";
import { CheckoutService } from "../../services/checkout.service";
import { interleaveWriterAfterSelect } from "./helpers/tx-interleave";

/**
 * R118-A5 TOP-20 #4 [P2] — M9 direct: a wallet balance can NEVER go
 * negative under racing debits.
 *
 * The A5 audit mapped M9 as "weakly enforced" — the INSUFFICIENT_BALANCE
 * happy refusal, topup CAS and adjustment caps compose the guarantee but
 * nothing probes the debit race itself. (The Promise.all drain shape —
 * two concurrent purchases, funds for one — is pinned at
 * routes/__tests__/checkout.test.ts:197; this suite adds the three faces
 * that shape does NOT cover:)
 *
 *   1. the TRUE read→write race via the tx-interleave harness — a
 *      concurrent committed writer drains the balance BETWEEN the
 *      purchase transaction's freshness read and the optimistic CAS
 *      debit; the CAS predicate (walletBalance = read-value) fails,
 *      the purchase refuses with the retryable CONCURRENCY_ERROR and
 *      the balance is never negative (checkout.service.ts:446-455);
 *   2. the exact-balance boundary — a 50.00 wallet buys a 50.00 product
 *      (leaves exactly 0.00, one ledger row), and a second purchase
 *      refuses INSUFFICIENT_BALANCE with the balance intact;
 *   3. the schema last line of defense — the V1-M9 CHECK constraint
 *      (chk_users_wallet_balance_nonneg, mirrored in the pglite harness)
 *      rejects any UPDATE that would persist a negative balance, so even
 *      a hypothetical double-debit bug cannot corrupt the row.
 */

let phoneSeq = 0;
async function seedUser(balance: string) {
  phoneSeq += 1;
  const [u] = await db
    .insert(usersTable)
    .values({ phone: `94701${String(phoneSeq).padStart(5, "0")}`, walletBalance: balance })
    .returning();
  return u;
}

async function seedProductWithStock(units: number, price = "10.00") {
  const [p] = await db
    .insert(productsTable)
    .values({ name: "M9 Race Product", price })
    .returning();
  for (let i = 0; i < units; i++) {
    await db.insert(inventoryTable).values({
      productId: p.id,
      accountEmail: `m9-${phoneSeq}-${i}@test.local`,
      accountPassword: `pw-${i}`,
    });
  }
  return p;
}

async function balanceOf(userId: number): Promise<number> {
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  return parseFloat(String(u.walletBalance));
}

beforeAll(async () => {
  await initTestDb();
});
beforeEach(async () => {
  await resetTestDb();
});

describe("M9 — wallet never negative (R118-A5 #4)", () => {
  it("a concurrent committed debit inside the read→write window → CONCURRENCY_ERROR, never a negative balance, zero money movement", async () => {
    // Balance covers the purchase — but a concurrent buyer's transaction
    // commits the SAME debit between this purchase's freshness read and
    // its guarded wallet UPDATE (the window Promise.all cannot produce
    // on the single-session pglite harness).
    const user = await seedUser("50.00");
    const product = await seedProductWithStock(2, "50.00");

    // Match the product-freshness re-check — the FIRST tx.select() inside
    // the purchase transaction (fields {price, isActive, isArchived}).
    const restore = interleaveWriterAfterSelect(db, {
      matchSelectFields: (fields) =>
        typeof fields === "object" &&
        fields !== null &&
        "isArchived" in fields &&
        "isActive" in fields,
      // The "concurrent committed winner": drains the wallet to 0.00 on
      // the REAL transaction session, after the freshness read resolved
      // but before the CAS debit UPDATE runs.
      writer: (realTx) =>
        realTx.execute(
          sql`UPDATE users SET wallet_balance = '0.00' WHERE id = ${user.id}`,
        ),
    });

    let result: Awaited<ReturnType<typeof CheckoutService.purchase>>;
    try {
      result = await CheckoutService.purchase({ userId: user.id, productId: product.id });
    } finally {
      restore();
    }

    // The optimistic wallet deduction lost the race — the structured
    // retryable refusal, never a crash and never a half-purchase.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("CONCURRENCY_ERROR");

    // NEVER negative. (Harness caveat, per helpers/tx-interleave.ts: the
    // simulated winner ran on the same session, so its debit rolled back
    // with the loser's transaction — the balance is restored to its
    // pre-race 50.00 here. The winner-keeps-its-write half is covered by
    // the sequential boundary test below + checkout.test.ts:197.)
    const balance = await balanceOf(user.id);
    expect(balance).toBeGreaterThanOrEqual(0);
    expect(balance).toBe(50);

    // Zero money movement: no order, no ledger row.
    expect(
      await db.select({ id: ordersTable.id }).from(ordersTable).where(eq(ordersTable.userId, user.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select({ id: walletLedgerTable.id })
        .from(walletLedgerTable)
        .where(eq(walletLedgerTable.userId, user.id)),
    ).toHaveLength(0);
  });

  it("exact-balance purchase leaves exactly 0.00; a second purchase → INSUFFICIENT_BALANCE with the balance intact", async () => {
    const user = await seedUser("50.00");
    const product = await seedProductWithStock(2, "50.00");

    const first = await CheckoutService.purchase({ userId: user.id, productId: product.id });
    expect(first.ok).toBe(true);
    // 50 − 50 = 0.00 — the boundary lands on exactly zero, not −0.01.
    expect(await balanceOf(user.id)).toBe(0);
    expect(
      await db
        .select({ id: walletLedgerTable.id })
        .from(walletLedgerTable)
        .where(eq(walletLedgerTable.userId, user.id)),
    ).toHaveLength(1);

    const second = await CheckoutService.purchase({ userId: user.id, productId: product.id });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("INSUFFICIENT_BALANCE");

    // Balance intact at 0.00 — the refused purchase moved nothing.
    expect(await balanceOf(user.id)).toBe(0);
    expect(
      await db
        .select({ id: walletLedgerTable.id })
        .from(walletLedgerTable)
        .where(eq(walletLedgerTable.userId, user.id)),
    ).toHaveLength(1);
    // Stock for the refused purchase was never claimed either.
    const inv = await db
      .select()
      .from(inventoryTable)
      .where(eq(inventoryTable.productId, product.id));
    expect(inv.filter((i) => i.isSold)).toHaveLength(1);
  });

  it("the V1-M9 CHECK constraint rejects any UPDATE that would persist a negative balance (schema last line of defense)", async () => {
    const user = await seedUser("5.00");
    // Even a hypothetical double-debit bug that computed a negative value
    // could never persist it: chk_users_wallet_balance_nonneg (mirrored
    // in the pglite harness from applyMoneyConstraintStage) fails the
    // write with a check violation.
    let caught: unknown;
    try {
      await db.execute(sql`UPDATE users SET wallet_balance = '-10.00' WHERE id = ${user.id}`);
    } catch (err) {
      caught = err;
    }
    // Drizzle wraps the driver error — the constraint name rides `cause`.
    const chain = [caught, (caught as { cause?: unknown } | null)?.cause]
      .filter(Boolean)
      .map((e) => String((e as Error).message ?? e))
      .join(" | ");
    expect(chain).toMatch(/chk_users_wallet_balance_nonneg/);
    // The row is untouched.
    expect(await balanceOf(user.id)).toBe(5);
  });
});
