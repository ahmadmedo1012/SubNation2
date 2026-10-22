import express from "express";
import cookieParser from "cookie-parser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  db,
  flashSalesTable,
  initTestDb,
  inventoryTable,
  productVariantsTable,
  productsTable,
  resetTestDb,
} from "../../test/db";
import { bumpCatalogCache } from "../../lib/catalog-cache";
import { productsRouter } from "../products";

/**
 * R182 (§3 catalog truth) — the purchasable-floor regression suite.
 *
 * The stats handler's `lowest_price` used to be the availability-blind
 * `min(products.price)` over ALL active products — the live site
 * advertised «تبدأ الأسعار من 59.80 د.ل» (Windows 8, sold out) while the
 * only purchasable product started at 980 LYD. The floor is now the
 * cheapest price a customer can actually pay RIGHT NOW, per product the
 * cheapest BUYABLE variant under the two-pool claim semantics (scoped
 * stock OR generic stock — the same rule displayBaseFromVariants uses
 * for the card/PDP «تبدأ من»), and NULL when nothing is purchasable
 * (the hero then renders the truthful unavailable line).
 *
 * Pinned here:
 *   - sold-out minimums never set the floor (the exact live defect);
 *   - zero purchasable products → lowest_price null + available 0;
 *   - two-pool buyability: scoped stock on a pricier variant does NOT
 *     make the cheaper drained variant the floor; generic stock does;
 *   - a no-variant purchasable product floors at its row price;
 *   - the five-field stats shape survives (field presence).
 *
 * Cache note: the stats cache key is CONSTANT ("stats"), so every case
 * bumps the catalog cache generation first — without the bump the first
 * case's payload would satisfy the rest (module state survives
 * resetTestDb, which only clears rows and restarts identity).
 */

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/products", productsRouter);
  return app;
}

async function callStats(
  app: express.Express,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("no address"));
        return;
      }
      try {
        const res = await fetch(`http://127.0.0.1:${addr.port}/api/products/stats`, {
          headers: { Accept: "application/json" },
        });
        const text = await res.text();
        const body = text ? JSON.parse(text) : null;
        resolve({ status: res.status, body: body as Record<string, unknown> });
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

async function insertProduct(values: {
  slug: string;
  name: string;
  price: string;
}): Promise<number> {
  const [row] = await db
    .insert(productsTable)
    .values({
      name: values.name,
      slug: values.slug,
      description: "وصف قصير",
      imageUrl: "https://cdn.example.com/p.webp",
      price: values.price,
      category: "software",
      isActive: true,
    })
    .returning();
  return row.id;
}

async function insertVariant(productId: number, priceLyd: string, sortOrder: number) {
  const [row] = await db
    .insert(productVariantsTable)
    .values({
      productId,
      planLabel: `Plan ${sortOrder}`,
      durationLabel: "شهر واحد",
      durationDays: 30,
      costPrice: "1.00",
      priceLyd,
      sku: `r182|${productId}|${sortOrder}`,
      sortOrder,
    })
    .returning();
  return row.id;
}

/** A deliverable unsold inventory unit (scoped to variantId when given). */
async function insertUnit(productId: number, variantId?: number) {
  await db.insert(inventoryTable).values({
    productId,
    variantId: variantId ?? null,
    accountEmail: `stock-${productId}-${variantId ?? "g"}@example.com`,
    accountPassword: "pw",
  });
}

beforeAll(async () => {
  await initTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  bumpCatalogCache();
});

describe("R182 §3 — lowest_price is the purchasable floor, not the catalog minimum", () => {
  it("a sold-out product's price never sets the floor (the live 59.80-vs-980 defect)", async () => {
    // The sold-out cheap product (no deliverable stock at all).
    await insertProduct({ slug: "r182-cheap-soldout", name: "Cheap Sold Out", price: "59.80" });
    // The purchasable variant product: scoped deliverable stock ONLY on
    // its cheapest variant (980).
    const buyableId = await insertProduct({
      slug: "r182-buyable",
      name: "Buyable Tiered",
      price: "980.00",
    });
    const v1 = await insertVariant(buyableId, "980.00", 0);
    await insertVariant(buyableId, "1980.00", 1);
    await insertVariant(buyableId, "2980.00", 2);
    await insertUnit(buyableId, v1);

    const { status, body } = await callStats(buildApp());
    expect(status).toBe(200);
    expect(body.total_products).toBe(2);
    expect(body.available_products).toBe(1);
    // The floor is 980 — the cheapest BUYABLE price — never the 59.80
    // sold-out catalog minimum the old min(products.price) returned.
    expect(body.lowest_price).toBe(980);
  });

  it("nothing purchasable → lowest_price null (the hero's truthful-unavailable input)", async () => {
    await insertProduct({ slug: "r182-all-soldout", name: "All Sold Out", price: "59.80" });

    const { status, body } = await callStats(buildApp());
    expect(status).toBe(200);
    expect(body.available_products).toBe(0);
    expect(body.lowest_price).toBeNull();
    expect(body.total_products).toBe(1);
  });

  it("two-pool: scoped stock on the pricier variant does not floor at the drained cheaper variant", async () => {
    const id = await insertProduct({
      slug: "r182-scoped-only",
      name: "Scoped Only",
      price: "79.80",
    });
    await insertVariant(id, "79.80", 0);
    const pricey = await insertVariant(id, "599.80", 1);
    // Deliverable scoped stock ONLY on the 599.80 variant.
    await insertUnit(id, pricey);

    const { body } = await callStats(buildApp());
    expect(body.available_products).toBe(1);
    // The 79.80 variant's pool is empty and the product's generic pool is
    // empty → its price is NOT buyable → the floor is 599.80 (the same
    // two-pool truth the card's «تبدأ من» already enforces).
    expect(body.lowest_price).toBe(599.8);
  });

  it("two-pool: generic (variant_id IS NULL) stock makes the cheapest variant the floor", async () => {
    const id = await insertProduct({
      slug: "r182-generic-pool",
      name: "Generic Pool",
      price: "79.80",
    });
    await insertVariant(id, "79.80", 0);
    await insertVariant(id, "599.80", 1);
    // Deliverable GENERIC stock — every active variant is buyable.
    await insertUnit(id);

    const { body } = await callStats(buildApp());
    expect(body.available_products).toBe(1);
    expect(body.lowest_price).toBe(79.8);
  });

  it("a purchasable product without variants floors at its row price", async () => {
    const id = await insertProduct({
      slug: "r182-no-variants",
      name: "No Variants",
      price: "42.00",
    });
    // A cheaper product with no stock at all must not undercut the floor.
    await insertProduct({ slug: "r182-other", name: "Other", price: "10.00" });
    await insertUnit(id);

    const { body } = await callStats(buildApp());
    expect(body.available_products).toBe(1);
    expect(body.lowest_price).toBe(42);
  });

  it("the stats shape keeps its five contracted fields", async () => {
    const { body } = await callStats(buildApp());
    expect(Object.keys(body).sort()).toEqual([
      "available_products",
      "has_flash_sale",
      "lowest_price",
      "total_products",
      "total_units",
    ]);
  });

  it("R182 (review #3): an ACTIVE flash sale discounts the floor (the cards' sale badges agree)", async () => {
    const id = await insertProduct({
      slug: "r182-sale-floor",
      name: "Sale Floor",
      price: "100.00",
    });
    await insertVariant(id, "100.00", 0);
    await insertVariant(id, "200.00", 1);
    await insertUnit(id);
    // 10% sale on the buyable floor of 100 → the payable floor is 90,
    // exactly what the card's sale badge shows for the same variant.
    await db.insert(flashSalesTable).values({
      title: "R182 Floor Sale",
      discountPercent: "10.00",
      endsAt: new Date(Date.now() + 60 * 60 * 1000),
      isActive: true,
    });

    const { body } = await callStats(buildApp());
    expect(body.has_flash_sale).toBe(true);
    expect(body.lowest_price).toBe(90);
  });
});
