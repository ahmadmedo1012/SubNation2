/**
 * F4 (round-94 A4) — product trust re-asserted inside the purchase tx.
 *
 * The product row (price / isActive / isArchived) was the ONLY link of
 * the pricing chain without an in-tx freshness guard (flash sale had
 * B2-06, coupon had B2-05). An admin raise 10→20 (or a deactivation /
 * archive) landing between computePricing and the tx let the buyer be
 * debited the STALE price — or buy a just-archived product
 * (out-of-catalog sale) — silently.
 *
 * Fix under test: the tx re-reads price/isActive/isArchived and throws
 * PRODUCT_STALE, which surfaces as the stable retryable envelope
 * { reason: "CONCURRENCY_ERROR", code: "PRODUCT_STALE" } (deliberately
 * NOT a new CheckoutFailureReason member — the route's exhaustive
 * switch is another agent's ownership; see the type comment in
 * checkout.service.ts).
 *
 * Race injection: the same computePricing-hook mock the B2-05/B2-06
 * suite uses (routes/__tests__/checkout-coupon-expiry-in-tx.test.ts) —
 * the "concurrent admin mutation" commits right AFTER pricing read the
 * product and right BEFORE the purchase transaction opens.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
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
import { CheckoutService } from "../checkout.service";

// ── Race-injection mock ─────────────────────────────────────────────────────
// Runs after the original computePricing resolves (the pricing inputs are
// "read") and before purchase() opens the transaction — the concurrent
// admin-writer slot.
const pricingHook = vi.hoisted(() => ({
  fn: null as null | (() => Promise<void>),
}));

vi.mock("../../lib/pricing", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../lib/pricing")>();
  return {
    ...orig,
    computePricing: async (input: import("../../lib/pricing").ComputePricingInput) => {
      const result = await orig.computePricing(input);
      if (pricingHook.fn) await pricingHook.fn();
      return result;
    },
  };
});

beforeAll(async () => {
  await initTestDb();
});
beforeEach(async () => {
  await resetTestDb();
  pricingHook.fn = null;
});
afterEach(() => {
  pricingHook.fn = null;
});

async function seedUser(balance: string) {
  const [u] = await db
    .insert(usersTable)
    .values({ phone: `9${Math.floor(Math.random() * 1e8)}`, walletBalance: balance })
    .returning();
  return u;
}

async function seedProduct(price = "10.00") {
  const [p] = await db.insert(productsTable).values({ name: "F4 Product", price }).returning();
  await db.insert(inventoryTable).values({
    productId: p.id,
    accountEmail: "acct@test.local",
    accountPassword: "plain-legacy-pw",
  });
  return p;
}

function expectFullRollback(userId: number, productId: number) {
  return (async () => {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    expect(parseFloat(String(u.walletBalance))).toBe(50);
    expect(await db.select().from(ordersTable)).toHaveLength(0);
    expect(await db.select().from(walletLedgerTable)).toHaveLength(0);
    const inv = await db
      .select()
      .from(inventoryTable)
      .where(eq(inventoryTable.productId, productId));
    expect(inv.every((i) => !i.isSold)).toBe(true);
  })();
}

describe("F4: product price/state re-validated inside the purchase transaction", () => {
  it("price raised between pricing and the tx → CONCURRENCY_ERROR + code PRODUCT_STALE, full rollback", async () => {
    const user = await seedUser("50.00");
    const product = await seedProduct("10.00");

    pricingHook.fn = async () => {
      await db
        .update(productsTable)
        .set({ price: "20.00" })
        .where(eq(productsTable.id, product.id));
    };

    const result = await CheckoutService.purchase({ userId: user.id, productId: product.id });

    expect(result).toMatchObject({ ok: false, reason: "CONCURRENCY_ERROR", code: "PRODUCT_STALE" });
    await expectFullRollback(user.id, product.id);
  });

  it("product archived between pricing and the tx → PRODUCT_STALE (no out-of-catalog sale)", async () => {
    const user = await seedUser("50.00");
    const product = await seedProduct("10.00");

    pricingHook.fn = async () => {
      await db
        .update(productsTable)
        .set({ isArchived: true })
        .where(eq(productsTable.id, product.id));
    };

    const result = await CheckoutService.purchase({ userId: user.id, productId: product.id });
    expect(result).toMatchObject({ ok: false, reason: "CONCURRENCY_ERROR", code: "PRODUCT_STALE" });
    await expectFullRollback(user.id, product.id);
  });

  it("product deactivated between pricing and the tx → PRODUCT_STALE", async () => {
    const user = await seedUser("50.00");
    const product = await seedProduct("10.00");

    pricingHook.fn = async () => {
      await db
        .update(productsTable)
        .set({ isActive: false })
        .where(eq(productsTable.id, product.id));
    };

    const result = await CheckoutService.purchase({ userId: user.id, productId: product.id });
    expect(result).toMatchObject({ ok: false, reason: "CONCURRENCY_ERROR", code: "PRODUCT_STALE" });
    await expectFullRollback(user.id, product.id);
  });

  it("price change committed BEFORE the pre-tx read still returns PRODUCT_NOT_FOUND (fast-fail path intact)", async () => {
    const user = await seedUser("50.00");
    const product = await seedProduct("10.00");
    // Archive before the call — the pre-tx lookup filters isArchived.
    await db
      .update(productsTable)
      .set({ isArchived: true })
      .where(eq(productsTable.id, product.id));

    const result = await CheckoutService.purchase({ userId: user.id, productId: product.id });
    expect(result).toMatchObject({ ok: false, reason: "PRODUCT_NOT_FOUND" });
  });

  it("value-based comparison: same price at a different numeric scale is NOT stale (no false positive)", async () => {
    const user = await seedUser("50.00");
    const product = await seedProduct("10.00");

    pricingHook.fn = async () => {
      await db
        .update(productsTable)
        .set({ price: "10.0" })
        .where(eq(productsTable.id, product.id));
    };

    const result = await CheckoutService.purchase({ userId: user.id, productId: product.id });
    expect(result.ok).toBe(true);
  });

  it("no race → purchase succeeds at the list price (no false positive)", async () => {
    const user = await seedUser("50.00");
    const product = await seedProduct("10.00");

    const result = await CheckoutService.purchase({ userId: user.id, productId: product.id });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.finalPrice).toBe(10);
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(40);
  });
});
