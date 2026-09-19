import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db, initTestDb, resetTestDb } from "../../test/db";
import {
  inventoryTable,
  ordersTable,
  productVariantsTable,
  productsTable,
  usersTable,
  walletLedgerTable,
} from "@workspace/db";
import { CheckoutService } from "../../services/checkout.service";

/**
 * Catalog-variant checkout tests (catalog reconstruction 2026-09-20).
 *
 * The purchase path is variant-aware end-to-end. Pinned contracts:
 *
 *   1. EXPLICIT selection — purchase(variantId=year) charges the YEAR
 *      variant's price (not the product-level price, not the cheapest).
 *   2. DEFAULT resolution — purchase without variantId on a variant-carrying
 *      product charges the CHEAPEST active variant (the storefront's
 *      "تبدأ من" number) — a legacy API caller can never be charged a price
 *      the UI never showed.
 *   3. VARIANT_NOT_FOUND — a bogus/inactive/foreign variantId fails closed
 *      with zero money movement.
 *   4. INVENTORY claim preference — variant-scoped stock is consumed before
 *      product-level stock; the order row carries variant_id + the
 *      immutable variant_label copy.
 *   5. LEGACY path — variant-less products keep the exact pre-2026-09-20
 *      behavior (product price, no variant fields on the order).
 */

async function seedUserWithBalance(balance: string) {
  const [u] = await db
    .insert(usersTable)
    .values({ phone: `9${Math.floor(Math.random() * 1e8)}`, walletBalance: balance })
    .returning();
  return u;
}

async function seedVariantProduct() {
  const [product] = await db
    .insert(productsTable)
    .values({ name: "Netflix", slug: "netflix", price: "79.80", isActive: true })
    .returning();
  const [month] = await db
    .insert(productVariantsTable)
    .values({
      productId: product.id,
      planLabel: null,
      durationLabel: "شهر واحد",
      costPrice: "3.99",
      priceLyd: "79.80",
      sortOrder: 0,
    })
    .returning();
  const [year] = await db
    .insert(productVariantsTable)
    .values({
      productId: product.id,
      planLabel: null,
      durationLabel: "سنة كاملة",
      costPrice: "29.99",
      priceLyd: "599.80",
      sortOrder: 1,
    })
    .returning();
  return { product, month, year };
}

function unit(
  productId: number,
  email: string,
  variantId: number | null = null,
): { productId: number; accountEmail: string; accountPassword: string; variantId: number | null } {
  return { productId, accountEmail: email, accountPassword: "plainpass", variantId };
}

beforeAll(async () => {
  await initTestDb();
});
beforeEach(async () => {
  await resetTestDb();
});

describe("explicit variant selection", () => {
  it("charges the selected variant's price and records variant_id + label", async () => {
    const user = await seedUserWithBalance("1000.00");
    const { product, year } = await seedVariantProduct();
    await db.insert(inventoryTable).values([unit(product.id, "a@test.local"), unit(product.id, "b@test.local")]);

    const result = await CheckoutService.purchase({
      userId: user.id,
      productId: product.id,
      variantId: year.id,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.finalPrice).toBe(599.8);

    const [order] = await db.select().from(ordersTable).where(eq(ordersTable.userId, user.id));
    expect(order.variantId).toBe(year.id);
    expect(order.variantLabel).toBe("سنة كاملة");
    expect(parseFloat(String(order.amount))).toBe(599.8);

    // Wallet debited the variant price; ledger mirrors it.
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(400.2);
    const ledger = await db.select().from(walletLedgerTable).where(eq(walletLedgerTable.userId, user.id));
    expect(ledger).toHaveLength(1);
    expect(parseFloat(String(ledger[0].amount))).toBe(599.8);
  });
});

describe("default variant resolution (no variantId)", () => {
  it("charges the cheapest active variant — the displayed price", async () => {
    const user = await seedUserWithBalance("100.00");
    const { product } = await seedVariantProduct();
    await db.insert(inventoryTable).values(unit(product.id, "a@test.local"));

    const result = await CheckoutService.purchase({ userId: user.id, productId: product.id });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.finalPrice).toBe(79.8); // cheapest variant, NOT product.price path
    const [order] = await db.select().from(ordersTable).where(eq(ordersTable.userId, user.id));
    expect(order.variantId).not.toBeNull();
    expect(order.variantLabel).toBe("شهر واحد");
  });
});

describe("invalid variant handling", () => {
  it("VARIANT_NOT_FOUND for a nonexistent id — zero money movement", async () => {
    const user = await seedUserWithBalance("100.00");
    const { product } = await seedVariantProduct();
    await db.insert(inventoryTable).values(unit(product.id, "a@test.local"));

    const result = await CheckoutService.purchase({
      userId: user.id,
      productId: product.id,
      variantId: 999_999,
    });

    expect(result).toMatchObject({ ok: false, reason: "VARIANT_NOT_FOUND" });
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(100);
    const orders = await db.select().from(ordersTable).where(eq(ordersTable.userId, user.id));
    expect(orders).toHaveLength(0);
  });

  it("VARIANT_NOT_FOUND when the variant belongs to a different product", async () => {
    const user = await seedUserWithBalance("100.00");
    const { product, month } = await seedVariantProduct();
    const [other] = await db
      .insert(productsTable)
      .values({ name: "Other", price: "10.00", isActive: true })
      .returning();
    await db.insert(inventoryTable).values([
      unit(product.id, "a@test.local"),
      unit(other.id, "b@test.local"),
    ]);

    const result = await CheckoutService.purchase({
      userId: user.id,
      productId: other.id,
      variantId: month.id, // Netflix's variant on a foreign product
    });

    expect(result).toMatchObject({ ok: false, reason: "VARIANT_NOT_FOUND" });
    const orders = await db.select().from(ordersTable).where(eq(ordersTable.userId, user.id));
    expect(orders).toHaveLength(0);
  });
});

describe("inventory claim preference", () => {
  it("burns variant-scoped stock first, then product-level stock", async () => {
    const user = await seedUserWithBalance("200.00");
    const { product, month } = await seedVariantProduct();
    // Generic (variant_id NULL) FIRST by id — the claim must SKIP it when a
    // variant-scoped unit exists.
    await db.insert(inventoryTable).values([
      unit(product.id, "generic@test.local", null),
      unit(product.id, "month-scoped@test.local", month.id),
    ]);

    const result = await CheckoutService.purchase({
      userId: user.id,
      productId: product.id,
      variantId: month.id,
    });

    expect(result.ok).toBe(true);
    const rows = await db.select().from(inventoryTable).where(eq(inventoryTable.productId, product.id));
    const sold = rows.find((r) => r.isSold);
    const unsold = rows.find((r) => !r.isSold);
    expect(sold?.accountEmail).toBe("month-scoped@test.local");
    expect(unsold?.accountEmail).toBe("generic@test.local");
  });

  it("falls back to product-level stock when no variant-scoped unit exists", async () => {
    const user = await seedUserWithBalance("200.00");
    const { product, month } = await seedVariantProduct();
    await db.insert(inventoryTable).values(unit(product.id, "generic@test.local", null));

    const result = await CheckoutService.purchase({
      userId: user.id,
      productId: product.id,
      variantId: month.id,
    });

    expect(result.ok).toBe(true);
    const [row] = await db.select().from(inventoryTable).where(eq(inventoryTable.productId, product.id));
    expect(row.isSold).toBe(true);
    expect(row.accountEmail).toBe("generic@test.local");
  });
});

describe("legacy variant-less products (backward compatibility)", () => {
  it("prices off products.price with no variant fields on the order", async () => {
    const user = await seedUserWithBalance("100.00");
    const [product] = await db
      .insert(productsTable)
      .values({ name: "Legacy", price: "50.00", isActive: true })
      .returning();
    await db.insert(inventoryTable).values(unit(product.id, "legacy@test.local"));

    const result = await CheckoutService.purchase({ userId: user.id, productId: product.id });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.finalPrice).toBe(50);
    const [order] = await db.select().from(ordersTable).where(eq(ordersTable.userId, user.id));
    expect(order.variantId).toBeNull();
    expect(order.variantLabel).toBeNull();
    expect(parseFloat(String(order.amount))).toBe(50);
  });
});
