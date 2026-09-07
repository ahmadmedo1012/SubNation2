/**
 * P0-sim chain (round-93 live simulation, 93-SIM-live-findings) —
 * RefundService must null delivered_extra_details in the refund tx.
 *
 * Sim-verified: after a refund, delivered_email/password were nulled but
 * delivered_extra_details stayed SET in the DB. For code-only inventory
 * that column IS the delivered product (checkout stores the code there —
 * admin/products.ts `extraDetails: code`), and for credential rows it
 * carries the account's extra secret material — a refunded order kept a
 * live credential sitting in the orders row.
 *
 * Also pins the delivered_usage_terms decision: catalog text is NOT
 * nulled (it comes from products.usage_terms, is visible pre-purchase,
 * and is gated at the API boundary instead — see
 * orders-credentials-serialization.test.ts for the gate's regression net).
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  db,
  initTestDb,
  resetTestDb,
  inventoryTable,
  ordersTable,
  productsTable,
  usersTable,
} from "../../test/db";
import { CheckoutService } from "../checkout.service";
import { RefundService } from "../refund.service";

const ADMIN_ID = 42;

beforeAll(async () => {
  await initTestDb();
});
beforeEach(async () => {
  await resetTestDb();
});

let phoneSeq = 91_700_000;
function nextPhone(): string {
  phoneSeq += 1;
  return String(phoneSeq);
}

/**
 * Seed a completed order whose inventory carries extra_details — the
 * code-only / credential+extra product shape. Uses the REAL checkout path
 * so the delivered_* columns get populated exactly as production does.
 */
async function seedCompletedOrderWithExtra() {
  const [user] = await db
    .insert(usersTable)
    .values({ phone: nextPhone(), walletBalance: "100.00" })
    .returning();
  const [product] = await db
    .insert(productsTable)
    .values({
      name: "Code Product",
      price: "20.00",
      usageTerms: "استخدام واحد لكل كود.",
    })
    .returning();
  await db.insert(inventoryTable).values({
    productId: product.id,
    accountEmail: null,
    accountPassword: null,
    extraDetails: "GIFT-CODE-4477",
  });
  const result = await CheckoutService.purchase({ userId: user.id, productId: product.id });
  if (!result.ok) throw new Error("test seed failed: " + result.reason);
  return { user, product, order: result.order };
}

describe("P0-sim: refund nulls delivered_extra_details (DB state)", () => {
  it("refund nulls email, password AND extra_details in the same tx", async () => {
    const { user, order } = await seedCompletedOrderWithExtra();

    // Precondition: checkout stored the code as the extra details.
    const [before] = await db.select().from(ordersTable).where(eq(ordersTable.id, order.id));
    expect(before.status).toBe("completed");
    expect(before.deliveredExtraDetails).toBe("GIFT-CODE-4477");

    await RefundService.refundOrder(order.id, { adminId: ADMIN_ID, note: "code already used" });

    // THE P0-sim chain pin: the delivered code is revoked with the refund.
    const [after] = await db.select().from(ordersTable).where(eq(ordersTable.id, order.id));
    expect(after.status).toBe("refunded");
    expect(after.deliveredEmail).toBeNull();
    expect(after.deliveredPassword).toBeNull();
    expect(after.deliveredExtraDetails).toBeNull();

    // The refund itself still works (wallet restored, ledger written).
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(100);
  });

  it("usage terms survive the refund in DB (catalog text — gated at the API, not nulled here)", async () => {
    const { order } = await seedCompletedOrderWithExtra();
    await RefundService.refundOrder(order.id, { adminId: ADMIN_ID });

    const [after] = await db.select().from(ordersTable).where(eq(ordersTable.id, order.id));
    // Deliberate design decision (documented in refund.service.ts):
    // products.usage_terms is storefront-visible catalog text, not
    // per-unit credential material. Refund nulls the credential columns;
    // the API gate (formatOrder) hides terms for non-completed orders.
    expect(after.deliveredUsageTerms).toBe("استخدام واحد لكل كود.");
    expect(after.deliveredExtraDetails).toBeNull();
  });
});
