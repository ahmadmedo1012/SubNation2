import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, initTestDb, resetTestDb } from "../../test/db";
import {
  inventoryTable,
  ordersTable,
  productsTable,
  providerFulfillmentsTable,
  usersTable,
} from "@workspace/db";
import { CheckoutService } from "../../services/checkout.service";
import { getFulfillmentProvider } from "../../services/providers/registry";
import { manualProvider } from "../../services/providers/manual.provider";

/**
 * R102 (provider-readiness) — the fulfillment provider layer.
 *
 * Pins the contract the external-provider phase will rely on:
 *   1. every successful purchase writes a provider_fulfillments row
 *      (manual, attempt 1, succeeded, no provider order id) INSIDE the
 *      purchase transaction — rollback of the purchase rolls back the
 *      record too (no orphan fulfillment rows);
 *   2. the (provider, provider_order_id) unique index: plain-UNIQUE
 *      semantics — manual NULL rows coexist (the first R102 draft used
 *      NULLS NOT DISTINCT and this exact scenario failed on the second
 *      purchase), while one non-null provider order can never back two
 *      orders (the provider idempotency anchor);
 *   3. the registry: defaults to manual, and an unknown/typo
 *      FULFILLMENT_PROVIDER falls SAFELY back to manual (an operator
 *      error can never produce a null provider on the money path).
 */

async function seedUserWithBalance(balance: string) {
  const [u] = await db
    .insert(usersTable)
    .values({ phone: `9${Math.floor(Math.random() * 1e8)}`, walletBalance: balance })
    .returning();
  return u;
}

async function seedProductWithStock(name: string) {
  const [p] = await db.insert(productsTable).values({ name, price: "10.00" }).returning();
  await db.insert(inventoryTable).values({
    productId: p.id,
    accountEmail: "acct@test.local",
    accountPassword: "plaintext-ok",
  });
  return p;
}

beforeAll(async () => {
  await initTestDb();
});
beforeEach(async () => {
  await resetTestDb();
  delete process.env.FULFILLMENT_PROVIDER;
});

describe("R102 — provider_fulfillments record lifecycle", () => {
  it("a successful purchase writes a manual 'succeeded' fulfillment row atomically with the order", async () => {
    const user = await seedUserWithBalance("50.00");
    const product = await seedProductWithStock("Provider Row Product");

    const result = await CheckoutService.purchase({ userId: user.id, productId: product.id });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error("purchase failed");

    const rows = await db
      .select()
      .from(providerFulfillmentsTable)
      .where(eq(providerFulfillmentsTable.orderId, result.order.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      provider: "manual",
      attempt: 1,
      status: "succeeded",
      providerOrderId: null,
    });
  });

  it("a failed purchase leaves NO fulfillment row (record is inside the purchase transaction)", async () => {
    const user = await seedUserWithBalance("50.00");
    const product = await seedProductWithStock("Rollback Product");
    // Deactivate the product AFTER seeding stock — purchase must fail at
    // the PRODUCT_STALE gate, inside the transaction.
    await db.update(productsTable).set({ isActive: false }).where(eq(productsTable.id, product.id));

    const result = await CheckoutService.purchase({ userId: user.id, productId: product.id });
    expect(result).toMatchObject({ ok: false });

    const rows = await db.select().from(providerFulfillmentsTable);
    expect(rows).toHaveLength(0);
  });

  it("two manual purchases coexist — the NULL provider_order_id half of the unique index stays permissive", async () => {
    const user = await seedUserWithBalance("100.00");
    const productA = await seedProductWithStock("First Manual Product");
    const productB = await seedProductWithStock("Second Manual Product");

    const first = await CheckoutService.purchase({ userId: user.id, productId: productA.id });
    const second = await CheckoutService.purchase({ userId: user.id, productId: productB.id });
    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: true });

    const rows = await db.select().from(providerFulfillmentsTable);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.provider === "manual" && r.providerOrderId === null)).toBe(true);
  });

  it("one non-null provider order can never back two orders (idempotency anchor)", async () => {
    const user = await seedUserWithBalance("100.00");
    const productA = await seedProductWithStock("Anchor Product A");
    const productB = await seedProductWithStock("Anchor Product B");
    const first = await CheckoutService.purchase({ userId: user.id, productId: productA.id });
    const second = await CheckoutService.purchase({ userId: user.id, productId: productB.id });
    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: true });
    if (!first.ok || !second.ok) throw new Error("purchases failed");

    // Simulate the future async provider attaching the SAME provider order
    // reference to a second order — the unique index must refuse it.
    const [orderRow] = await db.select().from(ordersTable).limit(2);
    const other = (await db.select().from(ordersTable).limit(2)).find((o) => o.id !== orderRow.id)!;

    await expect(
      db.insert(providerFulfillmentsTable).values({
        orderId: first.order.id,
        provider: "external-future",
        attempt: 1,
        status: "succeeded",
        providerOrderId: "PROV-123",
      }),
    ).resolves.toBeDefined();

    // Drizzle wraps the pg error — the SQLSTATE lives on .cause.
    await expect(
      db.insert(providerFulfillmentsTable).values({
        orderId: other.id,
        provider: "external-future",
        attempt: 1,
        status: "succeeded",
        providerOrderId: "PROV-123", // same provider order, second order
      }),
    ).rejects.toMatchObject({ cause: { code: "23505" } });
  });
});

describe("R102 — provider registry fail-safe", () => {
  it("defaults to the manual provider", () => {
    expect(getFulfillmentProvider().id).toBe("manual");
  });

  it("an unknown FULFILLMENT_PROVIDER value falls back to manual (money path never sees a null provider)", () => {
    const original = process.env.FULFILLMENT_PROVIDER;
    process.env.FULFILLMENT_PROVIDER = "external-not-registered-yet";
    try {
      expect(getFulfillmentProvider()).toBe(manualProvider);
    } finally {
      if (original === undefined) delete process.env.FULFILLMENT_PROVIDER;
      else process.env.FULFILLMENT_PROVIDER = original;
    }
  });

  it("explicit 'manual' resolves to the manual provider", () => {
    process.env.FULFILLMENT_PROVIDER = "MANUAL";
    expect(getFulfillmentProvider().id).toBe("manual");
  });
});
