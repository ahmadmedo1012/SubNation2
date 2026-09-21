/**
 * F8 (round-94 A4) — coupon_maxed alert strictly AFTER the commit.
 *
 * notifyCouponMaxedOut + logAdminAlert used to fire INSIDE the purchase
 * transaction. Any later statement failing in the tx (ledger insert,
 * orderCode collision, and now the F10 key claim) rolled usedCount
 * back — but the operator had already received the Telegram card and
 * the admin-alert row, and logAdminAlert's 24h dedupe key then muted
 * the TRUE exhaustion alert when a real buyer later consumed the last
 * slot (the same alert-shrinkage class the round-93 A6 fix closed for
 * stockWatcher).
 *
 * Under test (refund.service.ts:271's post-commit principle applied to
 * checkout):
 *   1. a purchase that reaches maxUses AND commits → the coupon_maxed
 *      admin alert exists;
 *   2. a purchase that reaches maxUses IN-TX but then rolls back (the
 *      F10 key-claim collision is used as the deterministic late-tx
 *      failure) → NO coupon_maxed alert, usedCount back to 0, and the
 *      next real buyer's successful purchase emits the alert honestly.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
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
import { interleaveWriterAfterSelect } from "./helpers/tx-interleave";

const IDEM_KEY = "f8 race key 00000001";

beforeAll(async () => {
  await initTestDb();
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      key text PRIMARY KEY,
      order_id integer REFERENCES orders(id) ON DELETE CASCADE,
      reference_type varchar(32) NOT NULL DEFAULT 'order',
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
});
beforeEach(async () => {
  await resetTestDb();
});

let phoneSeq = 913_400_000;
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

async function seedProductWithStock(units: number, price = "30.00") {
  const [p] = await db.insert(productsTable).values({ name: "F8 Product", price }).returning();
  for (let i = 0; i < units; i++) {
    await db.insert(inventoryTable).values({
      productId: p.id,
      accountEmail: `acct${i}@test.local`,
      accountPassword: `pw-${i}`,
    });
  }
  return p;
}

async function seedMaxedOutCoupon(maxUses: number) {
  const [c] = await db
    .insert(couponsTable)
    .values({
      code: "LASTSLOT",
      type: "percentage",
      value: "10.00",
      maxUses,
      usedCount: 0,
      isActive: true,
    })
    .returning();
  return c;
}

async function couponMaxedAlerts(): Promise<Array<{ type: string }>> {
  const res = await db.execute(sql`SELECT type FROM admin_alerts WHERE type = ${"coupon_maxed"}`);
  return (res as unknown as { rows?: Array<{ type: string }> }).rows ?? [];
}

describe("F8: coupon_maxed side effects live on the post-commit side", () => {
  it("committed purchase that consumes the last slot → alert emitted (true positive)", async () => {
    const user = await seedUser("50.00");
    const product = await seedProductWithStock(2);
    await seedMaxedOutCoupon(1);

    const result = await CheckoutService.purchase({
      userId: user.id,
      productId: product.id,
      couponCode: "LASTSLOT",
    });

    expect(result.ok).toBe(true);
    expect(await couponMaxedAlerts()).toHaveLength(1);
  });

  it("in-tx maxed but ROLLED BACK (late-tx failure) → NO alert, usedCount restored, next real buyer alerts honestly", async () => {
    const user = await seedUser("50.00");
    const product = await seedProductWithStock(2);
    await seedMaxedOutCoupon(1);

    // A real order row the FK can point at (the simulated concurrent
    // same-key winner's order).
    const [seedOrder] = await db
      .insert(ordersTable)
      .values({
        orderCode: "SNSEEDF8000001",
        userId: user.id,
        productId: product.id,
        amount: "30.00",
        walletBalanceBefore: "50.00",
        walletBalanceAfter: "20.00",
        status: "completed",
        deliveredAt: new Date(),
      })
      .returning({ id: ordersTable.id });

    // The product freshness re-check is the first tx select (3-key
    // projection) — arm the late-tx failure there: the "concurrent
    // same-key purchase" pre-claims our idempotency key, so the F10
    // claim at the END of this tx collides (23505) and rolls everything
    // back — including the coupon increment that reached maxUses.
    const isProductFreshnessSelect = (fields: unknown): boolean =>
      !!fields &&
      typeof fields === "object" &&
      Object.keys(fields as object).length === 3 &&
      "price" in (fields as object) &&
      "isActive" in (fields as object) &&
      "isArchived" in (fields as object);

    const restore = interleaveWriterAfterSelect(db, {
      matchSelectFields: isProductFreshnessSelect,
      writer: async (realTx) => {
        await realTx.execute(
          sql`INSERT INTO idempotency_keys (key, order_id)
              VALUES (${"u" + user.id + ":" + IDEM_KEY}, ${seedOrder.id})`,
        );
      },
    });

    let result: Awaited<ReturnType<typeof CheckoutService.purchase>>;
    try {
      result = await CheckoutService.purchase({
        userId: user.id,
        productId: product.id,
        couponCode: "LASTSLOT",
        idempotencyKey: IDEM_KEY,
      });
    } finally {
      restore();
    }

    // The purchase failed (classified conflict) — and the in-tx
    // exhaustion never became an alert.
    expect(result).toMatchObject({ ok: false, reason: "CONCURRENCY_ERROR" });
    expect(await couponMaxedAlerts()).toHaveLength(0); // THE F8 assertion

    // The coupon increment rolled back — the slot is honestly available.
    const [coupon] = await db.select().from(couponsTable).where(eq(couponsTable.code, "LASTSLOT"));
    expect(coupon.usedCount).toBe(0);

    // No phantom charge / order / ledger from the failed attempt.
    expect(await db.select().from(walletLedgerTable)).toHaveLength(0);
    expect(await db.select().from(ordersTable)).toHaveLength(1); // the seed only

    // And when a REAL buyer consumes the last slot afterwards, the alert
    // fires — the 24h dedupe key was never poisoned by the false one.
    const real = await CheckoutService.purchase({
      userId: user.id,
      productId: product.id,
      couponCode: "LASTSLOT",
      idempotencyKey: "f8 fresh key 0000002",
    });
    expect(real.ok).toBe(true);
    expect(await couponMaxedAlerts()).toHaveLength(1);
  });
});
