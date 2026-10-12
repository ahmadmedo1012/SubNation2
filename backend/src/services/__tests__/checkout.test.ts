/**
 * USER_NOT_FOUND (checkout.service.ts:326) — the last money-reason with
 * ZERO direct service-suite coverage (the historical routes/__tests__/
 * checkout.test.ts family never drifted a bogus userId through the
 * pipeline; only PRODUCT_NOT_FOUND / OUT_OF_STOCK / INSUFFICIENT_BALANCE
 * / INVALID_PRICE / coupon reasons had pins).
 *
 * The branch sits AFTER pricing and BEFORE the balance check: a request
 * whose userId resolves to no users row must fail closed with
 * USER_NOT_FOUND and leave the entire money surface untouched — no
 * order, no ledger row, no inventory claim, no loyalty award, and no
 * coupon redemption slot burned.
 *
 * R136 note: this suite lives at the services home (mirroring
 * checkout-product-stale / checkout-idempotency); the routes-level
 * checkout.test.ts describes are untouched.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  couponsTable,
  db,
  initTestDb,
  inventoryTable,
  ordersTable,
  pointsLedgerTable,
  productVariantsTable,
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
let phoneSeq = 913_311_000;
function nextPhone(): string {
  phoneSeq += 1;
  return String(phoneSeq);
}

async function seedUser(balance: string) {
  const [u] = await db
    .insert(usersTable)
    .values({ phone: nextPhone(), walletBalance: balance })
    .returning();
  return u;
}

async function seedProduct(price = "10.00", units = 2) {
  const [p] = await db.insert(productsTable).values({ name: "UNF Product", price }).returning();
  for (let i = 0; i < units; i++) {
    await db.insert(inventoryTable).values({
      productId: p.id,
      accountEmail: `acct${i}@unf.local`,
      accountPassword: `pw-${i}`,
    });
  }
  return p;
}

/** A userId that provably has no users row (fresh TRUNCATE → serial starts at 1). */
const GHOST_USER_ID = 999_999;

describe("CheckoutService — USER_NOT_FOUND (ghost buyer fails closed)", () => {
  it("a userId with no user row → USER_NOT_FOUND, zero side effects on the money surface", async () => {
    // A REAL user is seeded only to prove the ghost id is not an artifact
    // of an empty table — the purchase targets the ghost id instead.
    const realUser = await seedUser("50.00");
    const product = await seedProduct();

    const result = await CheckoutService.purchase({
      userId: GHOST_USER_ID,
      productId: product.id,
    });

    expect(result).toMatchObject({ ok: false, reason: "USER_NOT_FOUND" });

    // Zero money movement: the seeded (real) balance is the control, the
    // ghost cannot have moved anything — but the writes must not have
    // landed either: no order, no ledger, no award, no inventory claim.
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, realUser.id));
    expect(parseFloat(String(u.walletBalance))).toBe(50);
    expect(await db.select().from(usersTable)).toHaveLength(1);
    expect(await db.select().from(ordersTable)).toHaveLength(0);
    expect(await db.select().from(walletLedgerTable)).toHaveLength(0);
    expect(await db.select().from(pointsLedgerTable)).toHaveLength(0);
    const inv = await db
      .select()
      .from(inventoryTable)
      .where(eq(inventoryTable.productId, product.id));
    expect(inv.every((i) => !i.isSold)).toBe(true);
  });

  it("variant path: ghost buyer with an explicit variantId → USER_NOT_FOUND, no claim, no coupon slot burned", async () => {
    const product = await seedProduct("10.00", 1);
    const [variant] = await db
      .insert(productVariantsTable)
      .values({
        productId: product.id,
        planLabel: "Family",
        durationLabel: "1 Month",
        costPrice: "2.00",
        priceLyd: "10.00",
        sortOrder: 0,
      })
      .returning();
    const [coupon] = await db
      .insert(couponsTable)
      .values({
        code: "UNFCOUPON",
        type: "percentage",
        value: "10.00",
        maxUses: 1,
        usedCount: 0,
        isActive: true,
      })
      .returning();

    // The coupon VALIDATES (checkout.service.ts:299-301 passes it) — the
    // user lookup is what fails. A redemption slot must not be consumed:
    // usedCount stays 0 or a later REAL buyer loses the coupon.
    const result = await CheckoutService.purchase({
      userId: GHOST_USER_ID,
      productId: product.id,
      variantId: variant.id,
      couponCode: "UNFCOUPON",
    });

    expect(result).toMatchObject({ ok: false, reason: "USER_NOT_FOUND" });
    expect(await db.select().from(usersTable)).toHaveLength(0);
    expect(await db.select().from(ordersTable)).toHaveLength(0);
    expect(await db.select().from(walletLedgerTable)).toHaveLength(0);
    const [c] = await db.select().from(couponsTable).where(eq(couponsTable.id, coupon.id));
    expect(c.usedCount).toBe(0);
    const inv = await db
      .select()
      .from(inventoryTable)
      .where(eq(inventoryTable.productId, product.id));
    expect(inv.every((i) => !i.isSold)).toBe(true);
  });
});
