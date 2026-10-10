import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  db,
  initTestDb,
  inventoryTable,
  productVariantsTable,
  productsTable,
  usersTable,
} from "../../test/db";
import { productsRouter } from "../products";
import { CheckoutService } from "../../services/checkout.service";
import express from "express";
import cookieParser from "cookie-parser";

/**
 * R130 (A7-F1) — variant-AVAILABILITY pricing regression suite.
 *
 * The availability-blind "cheapest variant" surfaces constructed the
 * A2/A7 mixed state: the grid advertised «تبدأ من» the price of a
 * variant whose claim pool was PROVABLY empty (its scoped units sold out
 * + no generic units — per-variant availability is scoped>0 OR
 * generic>0, and the generic pool is product-wide), quick-add blessed it
 * (the stock snapshot is the product TOTAL), and the charge could only
 * 409. Money was never at risk (the pre-tx fast-fail answers before any
 * mutation — A7's structural proof), but the storefront showed a price
 * the buyer could never pay.
 *
 * Pinned here (the three closes):
 *   1. detail + list displayBase = the cheapest AVAILABLE variant's
 *      price, falling back to the drained min only when EVERY variant
 *      is unavailable (sold-out products keep their last price);
 *   2. legacy null-variant checkout resolves the cheapest variant that
 *      can CLAIM a unit (was: productsVariants[0] blind by price);
 *   3. all-drained legacy checkout still fails closed with
 *      OUT_OF_STOCK — the 409 semantics are unchanged, never a
 *      fabricated charge.
 */

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/products", productsRouter);
  return app;
}

async function call<T = unknown>(
  app: express.Express,
  path: string,
): Promise<{ status: number; body: T }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("no address"));
        return;
      }
      try {
        const res = await fetch(`http://127.0.0.1:${addr.port}${path}`);
        const text = await res.text();
        let body: unknown = text;
        try {
          body = JSON.parse(text);
        } catch {
          // non-JSON — keep text
        }
        resolve({ status: res.status, body: body as T });
      } catch (e) {
        reject(e);
      } finally {
        server.close();
      }
    });
  });
}

/** Mixed state: cheapest variant drained, pricier variant holds scoped
 * stock, zero generic units. products.price keeps the import's old
 * availability-blind min (25) — the DTO must NOT surface it. */
async function seedMixedState() {
  const [p] = await db
    .insert(productsTable)
    .values({ name: "Mixed State Product", slug: "mixed-state", price: "25.00", isActive: true })
    .returning();
  const [drained] = await db
    .insert(productVariantsTable)
    .values({
      productId: p.id,
      planLabel: "Basic",
      durationLabel: "1 Month",
      costPrice: "10.00",
      priceLyd: "25.00",
      isActive: true,
    })
    .returning();
  const [holdable] = await db
    .insert(productVariantsTable)
    .values({
      productId: p.id,
      planLabel: "Premium",
      durationLabel: "1 Year",
      costPrice: "30.00",
      priceLyd: "80.00",
      isActive: true,
    })
    .returning();
  // The ONLY unsold unit sits in the pricier variant's scoped pool.
  await db.insert(inventoryTable).values({
    productId: p.id,
    variantId: holdable.id,
    accountEmail: "premium@test.local",
    accountPassword: "pw",
  });
  return { product: p, drained, holdable };
}

beforeAll(async () => {
  await initTestDb();
});
// R130 note: deliberately NO resetTestDb between cases. The catalog
// cache (withCatalogCache) is module state that survives resets, and
// resetTestDb restarts identity at 1 — every fixture would re-occupy
// id 1 and read the PREVIOUS case's cached detail-by-id body (the
// exact trap product-detail-shape.test.ts documents for slugs). Letting
// identity increment gives every fixture a fresh id → a fresh cache key.
// Assertions are per-product, so cross-case rows are inert.

describe("displayBase — the «تبدأ من» price is availability-aware (A7-F1 close 1)", () => {
  it("detail DTO prices the product off the cheapest AVAILABLE variant in the mixed state", async () => {
    const { product } = await seedMixedState();
    const app = buildApp();

    const { status, body } = await call<Record<string, unknown>>(
      app,
      `/api/products/${product.id}`,
    );
    expect(status).toBe(200);
    // Was 25 (the drained min) — now the cheapest BUYABLE price.
    expect(body.price).toBe(80);
    const variants = body.variants as Array<Record<string, unknown>>;
    expect(variants).toHaveLength(2);
    const drainedDto = variants.find((v) => v.price === 25);
    const holdableDto = variants.find((v) => v.price === 80);
    expect(drainedDto?.is_available).toBe(false);
    expect(holdableDto?.is_available).toBe(true);
  });

  it("list DTO (the grid's fields=list projection) agrees with the detail price", async () => {
    const { product } = await seedMixedState();
    const app = buildApp();

    const { status, body } = await call<Record<string, unknown>[]>(
      app,
      `/api/products?fields=list&per_page=50`,
    );
    expect(status).toBe(200);
    const row = (body as Array<Record<string, unknown>>).find((r) => r.id === product.id);
    expect(row).toBeDefined();
    expect(row?.price).toBe(80);
  });

  it("a fully drained product keeps the availability-blind min (sold-out products show their price)", async () => {
    const [p] = await db
      .insert(productsTable)
      .values({ name: "All Drained", slug: "all-drained", price: "25.00", isActive: true })
      .returning();
    await db.insert(productVariantsTable).values([
      {
        productId: p.id,
        planLabel: "Basic",
        costPrice: "10.00",
        priceLyd: "25.00",
        isActive: true,
      },
      {
        productId: p.id,
        planLabel: "Premium",
        costPrice: "30.00",
        priceLyd: "80.00",
        isActive: true,
      },
    ]);
    // Zero unsold inventory anywhere — both variants drained.
    const app = buildApp();

    const { status, body } = await call<Record<string, unknown>>(app, `/api/products/${p.id}`);
    expect(status).toBe(200);
    expect(body.is_available).toBe(false);
    // Fallback: the availability-blind min (nothing is buyable — the
    // sold-out state owns the presentation).
    expect(body.price).toBe(25);
  });

  it("a product-wide generic pool keeps every variant available (min unchanged)", async () => {
    const [p] = await db
      .insert(productsTable)
      .values({ name: "Generic Pool", slug: "generic-pool", price: "25.00", isActive: true })
      .returning();
    await db.insert(productVariantsTable).values([
      {
        productId: p.id,
        planLabel: "Basic",
        costPrice: "10.00",
        priceLyd: "25.00",
        isActive: true,
      },
      {
        productId: p.id,
        planLabel: "Premium",
        costPrice: "30.00",
        priceLyd: "80.00",
        isActive: true,
      },
    ]);
    // ONE generic (variant_id NULL) unit: per the two-pool test every
    // variant is available — the display min stays 25 (unchanged legacy
    // behavior; the unit is claimable by any variant).
    await db.insert(inventoryTable).values({
      productId: p.id,
      accountEmail: "generic@test.local",
      accountPassword: "pw",
    });
    const app = buildApp();

    const { status, body } = await call<Record<string, unknown>>(app, `/api/products/${p.id}`);
    expect(status).toBe(200);
    expect(body.price).toBe(25);
    expect(body.is_available).toBe(true);
  });
});

describe("legacy null-variant checkout — resolves a CLAIMABLE variant (A7-F1 close 2)", () => {
  it("charges the cheapest AVAILABLE variant's price and fulfills from its pool", async () => {
    const user = await db
      .insert(usersTable)
      .values({ phone: "911111111", walletBalance: "200.00" })
      .returning();
    const { product, holdable } = await seedMixedState();

    const result = await CheckoutService.purchase({
      userId: user[0].id,
      productId: product.id,
      // NO variantId — the legacy path. Was: productsVariants[0] (the
      // drained 25.00) → guaranteed 409 mid-checkout.
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.finalPrice).toBe(80);
      expect(result.order.deliveredEmail).toBe("premium@test.local");
    }

    // The held unit was claimed from the pricier variant's pool.
    const claimed = await db
      .select()
      .from(inventoryTable)
      .where(eq(inventoryTable.productId, product.id));
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.isSold).toBe(true);
    expect(claimed[0]?.variantId).toBe(holdable.id);
  });

  it("still fails closed OUT_OF_STOCK when no variant can claim a unit (409 semantics unchanged)", async () => {
    const user = await db
      .insert(usersTable)
      .values({ phone: "922222222", walletBalance: "200.00" })
      .returning();
    const [p] = await db
      .insert(productsTable)
      .values({
        name: "All Drained Legacy",
        slug: "all-drained-legacy",
        price: "25.00",
        isActive: true,
      })
      .returning();
    await db.insert(productVariantsTable).values([
      {
        productId: p.id,
        planLabel: "Basic",
        costPrice: "10.00",
        priceLyd: "25.00",
        isActive: true,
      },
      {
        productId: p.id,
        planLabel: "Premium",
        costPrice: "30.00",
        priceLyd: "80.00",
        isActive: true,
      },
    ]);

    const result = await CheckoutService.purchase({ userId: user[0].id, productId: p.id });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("OUT_OF_STOCK");
  });
});
