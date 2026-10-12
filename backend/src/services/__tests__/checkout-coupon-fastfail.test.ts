/**
 * INVALID_COUPON fast-fail (checkout.service.ts:299-301) — direct table
 * coverage for every gating flavor of lib/pricing.ts resolveCoupon.
 *
 * Pre-existing coverage was one indirect route test (deactivated-before-
 * validation in routes/__tests__/checkout-coupon-expiry-in-tx.test.ts).
 * This suite pins the SERVICE branch directly: a coupon that fails
 * validation at pricing time must fast-fail with
 * { ok: false, reason: "INVALID_COUPON", message: reasonAr } — the
 * Arabic reason passed through verbatim from lib/pricing.ts (single
 * source) — with zero money movement AND zero coupon mutation (a
 * fast-failed redemption must never burn a used_count slot).
 *
 * Gating columns (read off resolveCoupon): is_active, expires_at (vs
 * now), max_uses vs used_count, min_order_amount vs basePrice — plus
 * the not_found row-miss flavor. The "wrong product" flavor is
 * below_min_order: coupons are product-agnostic, so a coupon whose
 * min_order_amount exceeds THIS product's price is the coupon that does
 * not apply to this purchase.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  couponsTable,
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

beforeAll(async () => {
  // 30s hook budget (coupon-watcher-gate exemplar): initTestDb builds the
  // full pglite DDL — under a contended sandbox that exceeds the 10s default.
  await initTestDb();
}, 30_000);
beforeEach(async () => {
  await resetTestDb();
});

// Deterministic seeds (no Math.random — the repo's phoneSeq convention).
let phoneSeq = 913_312_000;
function nextPhone(): string {
  phoneSeq += 1;
  return String(phoneSeq);
}

const HOURS = 60 * 60 * 1000;

async function seedUser(balance: string) {
  const [u] = await db
    .insert(usersTable)
    .values({ phone: nextPhone(), walletBalance: balance })
    .returning();
  return u;
}

async function seedProduct(price = "10.00") {
  const [p] = await db.insert(productsTable).values({ name: "ICF Product", price }).returning();
  await db.insert(inventoryTable).values({
    productId: p.id,
    accountEmail: "acct@icf.local",
    accountPassword: "pw-icf",
  });
  return p;
}

/** Coupon row seeds — one per resolveCoupon gate. NULL = no row (not_found). */
type CouponSeed = Partial<typeof couponsTable.$inferInsert> | null;

const COUPON_SEEDS: Record<string, CouponSeed> = {
  expired: { isActive: true, expiresAt: new Date(Date.now() - 2 * HOURS) },
  inactive: { isActive: false, expiresAt: new Date(Date.now() + 24 * HOURS) },
  maxed: { isActive: true, expiresAt: null, maxUses: 2, usedCount: 2 },
  belowMinOrder: { isActive: true, expiresAt: null, minOrderAmount: "100.00" },
  notFound: null,
};

/** reasonAr is the single-source Arabic copy from lib/pricing.ts resolveCoupon. */
const EXPECTED_REASON_AR: Record<string, string> = {
  expired: "انتهت صلاحية الكوبون",
  inactive: "كوبون غير مفعل",
  maxed: "تم استنفاد الكوبون",
  belowMinOrder: "يتطلب حد أدنى 100.00 د.ل",
  notFound: "كوبون غير موجود",
};

describe("INVALID_COUPON fast-fail at validation time — reasonAr passthrough + zero money movement", () => {
  it.each([
    ["expired coupon (expires_at in the past)", "expired"],
    ["inactive coupon (is_active=false)", "inactive"],
    ["maxed coupon (used_count = max_uses)", "maxed"],
    ["wrong-product coupon (price below min_order_amount)", "belowMinOrder"],
    ["unknown code (no coupon row)", "notFound"],
  ])("%s → INVALID_COUPON with the pricing layer's reasonAr", async (_label, flavorKey) => {
    const flavor = flavorKey as keyof typeof COUPON_SEEDS;
    const user = await seedUser("50.00");
    const product = await seedProduct("10.00");

    const code = `ICF-${flavor.toUpperCase()}`;
    let couponId: number | null = null;
    let usedCountBefore: number | null = null;
    if (COUPON_SEEDS[flavor] !== null) {
      const [row] = await db
        .insert(couponsTable)
        .values({
          code,
          type: "percentage",
          value: "20.00",
          ...(COUPON_SEEDS[flavor] as Partial<typeof couponsTable.$inferInsert>),
        })
        .returning();
      couponId = row.id;
      usedCountBefore = row.usedCount;
    }

    const result = await CheckoutService.purchase({
      userId: user.id,
      productId: product.id,
      couponCode: code,
    });

    // The fast-fail envelope: the service's own message IS the pricing
    // layer's reasonAr (routes/orders.ts prefers it for the 400 body).
    expect(result).toMatchObject({ ok: false, reason: "INVALID_COUPON" });
    if (!result.ok) expect(result.message).toBe(EXPECTED_REASON_AR[flavor]);

    // Zero money movement.
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(50);
    expect(await db.select().from(ordersTable)).toHaveLength(0);
    expect(await db.select().from(walletLedgerTable)).toHaveLength(0);
    const inv = await db
      .select()
      .from(inventoryTable)
      .where(eq(inventoryTable.productId, product.id));
    expect(inv.every((i) => !i.isSold)).toBe(true);

    // Zero coupon mutation — a failed validation never burns a slot.
    if (couponId !== null) {
      const [c] = await db.select().from(couponsTable).where(eq(couponsTable.id, couponId));
      expect(c.usedCount).toBe(usedCountBefore);
    }
  });

  it("control: a VALID coupon sails past the fast-fail and the discount lands exactly once", async () => {
    const user = await seedUser("50.00");
    const product = await seedProduct("10.00");
    await db.insert(couponsTable).values({
      code: "ICF-VALID",
      type: "percentage",
      value: "20.00",
      isActive: true,
      expiresAt: new Date(Date.now() + 24 * HOURS),
      maxUses: 5,
      usedCount: 0,
    });

    const result = await CheckoutService.purchase({
      userId: user.id,
      productId: product.id,
      couponCode: "ICF-VALID",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.finalPrice).toBe(8); // 10.00 − 20%
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(42);
    const [c] = await db.select().from(couponsTable).where(eq(couponsTable.code, "ICF-VALID"));
    expect(c.usedCount).toBe(1);
    expect(await db.select().from(ordersTable)).toHaveLength(1);
    expect(await db.select().from(walletLedgerTable)).toHaveLength(1);
  });
});
