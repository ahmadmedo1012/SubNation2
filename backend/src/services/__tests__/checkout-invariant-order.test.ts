/**
 * R122 (A3-P2-5): the checkout result handler's `if (!order)` fallback was
 * DEAD code — the purchase transaction either returns the inserted order
 * row or throws (mapped by the catch to a {failure} object or rethrown) —
 * and it was mislabeled: a future refactor that made it reachable would
 * have answered {ok:false, reason:"INVENTORY_CLAIMED"}, i.e. the
 * retryable "someone else claimed the stock" 409, masking the actual
 * defect. The branch is now an assertion-style guard that throws, so a
 * logic regression fails loudly (a named 500 via the global handler,
 * caught by tests) instead of laundering itself as a business conflict.
 *
 * This test forces the "regression" shape directly: db.transaction is
 * spied to resolve undefined (a transaction wrapper that neither returned
 * a row nor threw — e.g. a future refactor dropping the return), and the
 * guard must fire with the honest error rather than resolving
 * INVENTORY_CLAIMED.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  db,
  initTestDb,
  inventoryTable,
  productsTable,
  resetTestDb,
  usersTable,
} from "../../test/db";
import { CheckoutService } from "../checkout.service";

beforeAll(async () => {
  await initTestDb();
});
beforeEach(async () => {
  await resetTestDb();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("R122 (A3-P2-5) — the no-order invariant fails loudly, never as INVENTORY_CLAIMED", () => {
  it("a transaction that resolves without a row or a failure THROWS the invariant error", async () => {
    // Seed the full pre-transaction read set (user, product, inventory)
    // so purchase() reaches the transaction with everything valid.
    const [user] = await db
      .insert(usersTable)
      .values({ phone: "91770001", walletBalance: "50.00" })
      .returning();
    const [product] = await db
      .insert(productsTable)
      .values({ name: "Invariant Product", price: "10.00" })
      .returning();
    await db.insert(inventoryTable).values({
      productId: product.id,
      accountEmail: "acct@test.local",
      accountPassword: "plain-legacy-pw",
    });

    // The forced regression: the transaction resolves to NOTHING.
    const txSpy = vi.spyOn(db, "transaction");
    txSpy.mockResolvedValue(undefined as never);

    await expect(
      CheckoutService.purchase({ userId: user.id, productId: product.id }),
    ).rejects.toThrow("checkout: transaction resolved without an order or a failure reason");

    // And it is a REJECTION — never a resolved {ok:false,
    // reason:"INVENTORY_CLAIMED"} (the old mislabel).
    const result = await CheckoutService.purchase({
      userId: user.id,
      productId: product.id,
    }).catch((err: unknown) => err);
    expect(result).toBeInstanceOf(Error);
    expect(result).not.toMatchObject({ ok: false, reason: "INVENTORY_CLAIMED" });
  });

  it("the spy is restored — the very next purchase runs the REAL transaction and succeeds", async () => {
    const [user] = await db
      .insert(usersTable)
      .values({ phone: "91770002", walletBalance: "50.00" })
      .returning();
    const [product] = await db
      .insert(productsTable)
      .values({ name: "Invariant Product 2", price: "10.00" })
      .returning();
    await db.insert(inventoryTable).values({
      productId: product.id,
      accountEmail: "acct@test.local",
      accountPassword: "plain-legacy-pw",
    });

    const spied = vi.spyOn(db, "transaction");
    spied.mockResolvedValue(undefined as never);
    await expect(
      CheckoutService.purchase({ userId: user.id, productId: product.id }),
    ).rejects.toThrow(/without an order or a failure reason/);

    // Restore the real implementation — the same call shape now succeeds.
    vi.restoreAllMocks();
    const result = await CheckoutService.purchase({ userId: user.id, productId: product.id });
    expect(result.ok).toBe(true);
  });
});
