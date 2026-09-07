/**
 * B2-05 / B2-06 (round-92 audit) — in-transaction re-validation of the
 * pre-tx pricing inputs at redemption time.
 *
 * B2-05: resolveCoupon validates `is_active` / `expires_at` OUTSIDE the
 * purchase transaction; an admin deactivation (or the clock crossing
 * expires_at) landing between validation and commit previously still
 * redeemed a just-dead coupon. The atomic-with-check increment now also
 * re-asserts active + unexpired at commit time.
 *
 * B2-06: `applyFlashSale` reads `isActive && ends_at > now` outside the
 * purchase tx — a sale ending at 18:00:00.000 could commit a discounted
 * purchase at 18:00:00.100. The tx now re-reads the priced sale row and
 * rejects as STALE_FLASH_SALE when it expired / deactivated / changed.
 *
 * Race injection: computePricing is mocked (via vi.mock with the original
 * module re-exported) so a "concurrent admin mutation" commits right AFTER
 * pricing validated the inputs and right BEFORE the purchase transaction
 * opens — the exact TOCTOU window. The stale-in-tx rejection surfaces as
 * COUPON_EXHAUSTED (409 at the route) / STALE_FLASH_SALE (409 at the
 * route).
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  db,
  initTestDb,
  resetTestDb,
  couponsTable,
  flashSalesTable,
  inventoryTable,
  ordersTable,
  productsTable,
  usersTable,
  walletLedgerTable,
} from "../../test/db";
import { CheckoutService } from "../../services/checkout.service";

// ── Race-injection mock ─────────────────────────────────────────────────────
// `pricingHook.fn` runs after the original computePricing resolves (the
// validation inputs are now "read") and before the caller continues into
// the transaction — the concurrent-admin-writer slot.
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

async function seedProductWithStock(units: number, price = "30.00") {
  const [p] = await db.insert(productsTable).values({ name: "Stale Product", price }).returning();
  for (let i = 0; i < units; i++) {
    await db.insert(inventoryTable).values({
      productId: p.id,
      accountEmail: `acct${i}@test.local`,
      accountPassword: `pw-${i}`,
    });
  }
  return p;
}

async function seedCoupon(overrides: Partial<typeof couponsTable.$inferInsert> = {}) {
  const [c] = await db
    .insert(couponsTable)
    .values({
      code: "RACE10",
      type: "percentage",
      value: "10.00",
      maxUses: 100,
      usedCount: 0,
      isActive: true,
      ...overrides,
    })
    .returning();
  return c;
}

describe("B2-05: coupon is_active / expires_at re-asserted inside the purchase tx", () => {
  it("coupon deactivated between validation and purchase → COUPON_EXHAUSTED, full rollback (no debit, no order, no increment)", async () => {
    const user = await seedUser("50.00");
    const product = await seedProductWithStock(1, "30.00");
    await seedCoupon({ code: "RACE10" });

    // The race: admin disables the coupon after pricing validated it.
    pricingHook.fn = async () => {
      await db.update(couponsTable).set({ isActive: false }).where(eq(couponsTable.code, "RACE10"));
    };

    const result = await CheckoutService.purchase({
      userId: user.id,
      productId: product.id,
      couponCode: "RACE10",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("COUPON_EXHAUSTED");

    // Everything rolled back — the dead coupon was not redeemed.
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(50);
    const [coupon] = await db.select().from(couponsTable).where(eq(couponsTable.code, "RACE10"));
    expect(coupon.usedCount).toBe(0);
    expect(await db.select().from(ordersTable)).toHaveLength(0);
    expect(await db.select().from(walletLedgerTable)).toHaveLength(0);
    const inv = await db.select().from(inventoryTable);
    expect(inv.every((i) => !i.isSold)).toBe(true);
  });

  it("coupon expiring between validation and purchase → COUPON_EXHAUSTED", async () => {
    const user = await seedUser("50.00");
    const product = await seedProductWithStock(1, "30.00");
    await seedCoupon({ code: "RACE10", expiresAt: new Date(Date.now() + 60_000) });

    pricingHook.fn = async () => {
      await db
        .update(couponsTable)
        .set({ expiresAt: new Date(Date.now() - 1_000) })
        .where(eq(couponsTable.code, "RACE10"));
    };

    const result = await CheckoutService.purchase({
      userId: user.id,
      productId: product.id,
      couponCode: "RACE10",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("COUPON_EXHAUSTED");
    const [coupon] = await db.select().from(couponsTable).where(eq(couponsTable.code, "RACE10"));
    expect(coupon.usedCount).toBe(0);
  });

  it("deactivated BEFORE validation still returns the pre-existing INVALID_COUPON (regression: fast-fail path intact)", async () => {
    const user = await seedUser("50.00");
    const product = await seedProductWithStock(1, "30.00");
    await seedCoupon({ code: "RACE10", isActive: false });

    const result = await CheckoutService.purchase({
      userId: user.id,
      productId: product.id,
      couponCode: "RACE10",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("INVALID_COUPON");
  });

  it("still-active coupon redeems normally when nothing races (no false positive)", async () => {
    const user = await seedUser("50.00");
    const product = await seedProductWithStock(1, "30.00");
    await seedCoupon({ code: "RACE10" });

    const result = await CheckoutService.purchase({
      userId: user.id,
      productId: product.id,
      couponCode: "RACE10",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.finalPrice).toBe(27); // 30 − 10%
    const [coupon] = await db.select().from(couponsTable).where(eq(couponsTable.code, "RACE10"));
    expect(coupon.usedCount).toBe(1);
  });
});

describe("B2-06: flash-sale ends_at / price re-validated inside the purchase tx", () => {
  it("sale expiring between pricing and the tx → STALE_FLASH_SALE, full rollback", async () => {
    const user = await seedUser("50.00");
    const product = await seedProductWithStock(1, "30.00");
    const [sale] = await db
      .insert(flashSalesTable)
      .values({ title: "Flash", discountPercent: "20.00", endsAt: new Date(Date.now() + 60_000) })
      .returning();
    void sale;

    pricingHook.fn = async () => {
      await db
        .update(flashSalesTable)
        .set({ endsAt: new Date(Date.now() - 1_000) })
        .where(eq(flashSalesTable.title, "Flash"));
    };

    const result = await CheckoutService.purchase({ userId: user.id, productId: product.id });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("STALE_FLASH_SALE");
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(50); // list price NOT debited
    expect(await db.select().from(ordersTable)).toHaveLength(0);
    const inv = await db.select().from(inventoryTable);
    expect(inv.every((i) => !i.isSold)).toBe(true);
  });

  it("sale deactivated between pricing and the tx → STALE_FLASH_SALE", async () => {
    const user = await seedUser("50.00");
    const product = await seedProductWithStock(1, "30.00");
    await db
      .insert(flashSalesTable)
      .values({ title: "Flash", discountPercent: "20.00", endsAt: new Date(Date.now() + 60_000) });

    pricingHook.fn = async () => {
      await db
        .update(flashSalesTable)
        .set({ isActive: false })
        .where(eq(flashSalesTable.title, "Flash"));
    };

    const result = await CheckoutService.purchase({ userId: user.id, productId: product.id });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("STALE_FLASH_SALE");
  });

  it("sale discount changed between pricing and the tx → STALE_FLASH_SALE (stale price rejected)", async () => {
    const user = await seedUser("50.00");
    const product = await seedProductWithStock(1, "30.00");
    await db
      .insert(flashSalesTable)
      .values({ title: "Flash", discountPercent: "20.00", endsAt: new Date(Date.now() + 60_000) });

    pricingHook.fn = async () => {
      await db
        .update(flashSalesTable)
        .set({ discountPercent: "50.00" })
        .where(eq(flashSalesTable.title, "Flash"));
    };

    const result = await CheckoutService.purchase({ userId: user.id, productId: product.id });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("STALE_FLASH_SALE");
  });

  it("live sale still prices the purchase when nothing races (no false positive)", async () => {
    const user = await seedUser("50.00");
    const product = await seedProductWithStock(1, "30.00");
    await db
      .insert(flashSalesTable)
      .values({ title: "Flash", discountPercent: "20.00", endsAt: new Date(Date.now() + 60_000) });

    const result = await CheckoutService.purchase({ userId: user.id, productId: product.id });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.finalPrice).toBe(24); // 30 × 0.8
  });
});
