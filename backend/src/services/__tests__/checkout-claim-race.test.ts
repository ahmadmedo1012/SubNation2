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
 * AUD103-5-F5 (r103, P2): the INVENTORY_CLAIMED race outcome — the guarded
 * claim UPDATE's 0-rows branch (manual.provider.ts) — was never produced by
 * any test. The harness simulates the exact committed-concurrent-writer
 * state: another buyer's transaction marks the unit sold BETWEEN this
 * purchase's locked SELECT and its guarded claim UPDATE. READ COMMITTED
 * re-evaluates the WHERE against the latest row version → 0 rows →
 * INVENTORY_CLAIMED → the whole purchase rolls back (wallet, order, ledger).
 */

let phoneSeq = 0;
async function seedUser(balance: string) {
  phoneSeq += 1;
  const [u] = await db
    .insert(usersTable)
    .values({ phone: `94601${String(phoneSeq).padStart(5, "0")}`, walletBalance: balance })
    .returning();
  return u;
}

async function seedProductWithStock(units: number, price = "10.00") {
  const [p] = await db
    .insert(productsTable)
    .values({ name: "Claim Race Product", price })
    .returning();
  for (let i = 0; i < units; i++) {
    await db.insert(inventoryTable).values({
      productId: p.id,
      accountEmail: `race${i}@test.local`,
      accountPassword: `pw-${i}`,
    });
  }
  return p;
}

beforeAll(async () => {
  await initTestDb();
});
beforeEach(async () => {
  await resetTestDb();
});

describe("checkout — guarded inventory claim race (AUD103-5-F5)", () => {
  it("a concurrent writer claiming the unit mid-transaction → INVENTORY_CLAIMED, zero money movement", async () => {
    const user = await seedUser("50.00");
    const product = await seedProductWithStock(1, "30.00");

    // The manual provider's claim SELECT is the only BARE tx.select() inside
    // the purchase transaction (every checkout.service re-check selects
    // explicit field objects) — matching on `fields === undefined` targets
    // exactly the claim read that opens the race window.
    const restore = interleaveWriterAfterSelect(db, {
      matchSelectFields: (fields) => fields === undefined,
      // The "concurrent committed buyer": marks every unsold unit of this
      // product sold on the REAL transaction session, after the locked
      // read resolved but before the guarded UPDATE runs.
      writer: (realTx) =>
        realTx.execute(
          sql`UPDATE inventory SET is_sold = true, sold_at = now()
             WHERE product_id = ${product.id} AND is_sold = false`,
        ),
    });

    let result: Awaited<ReturnType<typeof CheckoutService.purchase>>;
    try {
      result = await CheckoutService.purchase({ userId: user.id, productId: product.id });
    } finally {
      restore();
    }

    // The guarded claim lost the race — the structured refusal, never a
    // crash and never a half-purchase.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("INVENTORY_CLAIMED");

    // ZERO money movement: wallet untouched…
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(50);
    // …no order…
    const orders = await db.select().from(ordersTable).where(eq(ordersTable.userId, user.id));
    expect(orders).toHaveLength(0);
    // …no ledger row…
    const ledger = await db
      .select()
      .from(walletLedgerTable)
      .where(eq(walletLedgerTable.userId, user.id));
    expect(ledger).toHaveLength(0);
    // …and the harness's documented caveat applies: the writer ran on the
    // SAME session as the service transaction, so when the purchase rolled
    // back it took the simulated winner's UPDATE with it — the unit reads
    // unsold HERE. (The "winner keeps its write" half of the guarantee is
    // covered by the sequential happy-path suites — see the harness
    // docblock.) What this test pins is the loser's side: the structured
    // INVENTORY_CLAIMED refusal + zero money movement above.
    const inv = await db
      .select()
      .from(inventoryTable)
      .where(eq(inventoryTable.productId, product.id));
    expect(inv).toHaveLength(1);
    expect(inv[0].isSold).toBe(false);
  });
});
