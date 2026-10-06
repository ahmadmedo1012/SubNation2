import express from "express";
import cookieParser from "cookie-parser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  db,
  flashSalesTable,
  initTestDb,
  inventoryTable,
  ordersTable,
  productVariantsTable,
  productsTable,
  resetTestDb,
  usersTable,
} from "../../test/db";
import { productsRouter } from "../products";

/**
 * F-1 (R118-A6) — product-detail route shape regression suite.
 *
 * The detail routes' 3 sequential DB stages (product+flash → stock+count
 * → variants ≈ 3 × ~100 ms app→Neon RTT per cache miss) were collapsed:
 * /:id now runs ALL of its queries in ONE Promise.all (the id is known
 * upfront) and /by-slug in 2 (variants/stock need the id resolved from
 * the slug). loadPublicVariants was split into fetchVariantPoolData (DB)
 * + projectVariantDtos (JS projection) and both routes now share one DTO
 * builder — but the HARD CONSTRAINT of the fix is that the response is
 * byte-identical to the pre-fix shape: same JSON fields, same order,
 * same 404 semantics.
 *
 * Pinned here:
 *   - the exact ordered top-level field list of the detail DTO;
 *   - the exact ordered field list of each variant object;
 *   - /:id and /by-slug return the SAME body for the same product;
 *   - representative VALUES (min-variant display price, flash-sale
 *     arithmetic via computeFlashSalePrice, deliverable stock count,
 *     completed-only order count, price_from semantics);
 *   - 404 semantics preserved (deactivated-by-slug, unknown id).
 *
 * Cache-collision note: withCatalogCache keys persist across `it`s in
 * this file (module state), and resetTestDb restarts identity at 1 — so
 * every case uses slugs/ids unique to itself (never re-hitting a
 * detail-by-id key a previous case populated with different data).
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
): Promise<{ status: number; body: T; text: string }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("no address"));
        return;
      }
      try {
        const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
          headers: { Accept: "application/json" },
        });
        const text = await res.text();
        const body = text ? JSON.parse(text) : null;
        resolve({ status: res.status, body: body as T, text });
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

/** The public detail-DTO contract, in order (snapshot-like field list). */
const DETAIL_FIELDS = [
  "id",
  "slug",
  "name",
  "description",
  "description_long",
  "faq",
  "seo_title",
  "features",
  "seo_description",
  "image_url",
  "price",
  "price_from",
  "category",
  "is_active",
  "usage_terms",
  "stock_count",
  "is_available",
  "sale_price",
  "discount_percent",
  "order_count",
  "variants",
];

const VARIANT_FIELDS = [
  "id",
  "plan_label",
  "duration_label",
  "label",
  "price",
  "sale_price",
  "discount_percent",
  "is_available",
];

async function seedDetailFixture(): Promise<{ productId: number }> {
  const [product] = await db
    .insert(productsTable)
    .values({
      name: "Shape Fixture Product",
      slug: "shape-fixture-product",
      description: "وصف قصير",
      descriptionLong: "وصف طويل يغطي الحقل description_long",
      seoTitle: "SEO Title",
      seoDescription: "SEO description",
      imageUrl: "https://cdn.example.com/p.webp",
      price: "99.00",
      category: "streaming",
      isActive: true,
      usageTerms: "شروط الاستخدام",
    })
    .returning();

  await db.insert(productVariantsTable).values([
    {
      productId: product.id,
      planLabel: "Individual",
      durationLabel: "شهر واحد",
      durationDays: 30,
      costPrice: "3.99",
      priceLyd: "79.80",
      sku: "shape|1mo|INTERNAL-SECRET",
      sortOrder: 0,
    },
    {
      productId: product.id,
      planLabel: "Family",
      durationLabel: "سنة كاملة",
      durationDays: 365,
      costPrice: "29.99",
      priceLyd: "599.80",
      sku: "shape|1y|INTERNAL-SECRET",
      sortOrder: 1,
    },
  ]);

  // Deliverable generic-pool stock (1 unsold deliverable + 1 sold row
  // that must NOT count).
  await db.insert(inventoryTable).values([
    { productId: product.id, accountEmail: "stock@example.com", accountPassword: "pw" },
    {
      productId: product.id,
      accountEmail: "sold@example.com",
      accountPassword: "pw",
      isSold: true,
    },
  ]);

  // Completed orders count only completed (2 completed + 1 pending).
  const [buyer] = await db
    .insert(usersTable)
    .values({ phone: "9450999001", walletBalance: "0.00" })
    .returning();
  await db.insert(ordersTable).values([
    {
      orderCode: "SNSHAPE000001",
      userId: buyer.id,
      productId: product.id,
      amount: "79.80",
      status: "completed",
    },
    {
      orderCode: "SNSHAPE000002",
      userId: buyer.id,
      productId: product.id,
      amount: "79.80",
      status: "completed",
    },
    {
      orderCode: "SNSHAPE000003",
      userId: buyer.id,
      productId: product.id,
      amount: "79.80",
      status: "pending",
    },
  ]);

  // Active 10% flash sale → sale_price = computeFlashSalePrice(x, 10).
  await db.insert(flashSalesTable).values({
    title: "Shape Fixture Sale",
    discountPercent: "10.00",
    endsAt: new Date(Date.now() + 60 * 60 * 1000),
    isActive: true,
  });

  return { productId: product.id };
}

beforeAll(async () => {
  await initTestDb();
});

beforeEach(async () => {
  await resetTestDb();
});

describe("product detail routes — response shape pinned across the F-1 stage collapse (R118-A6)", () => {
  it("GET /api/products/:id serves the exact contracted field list, in order, with honest values", async () => {
    const { productId } = await seedDetailFixture();
    const app = buildApp();

    const { status, body } = await call<Record<string, unknown>>(
      app,
      `/api/products/${productId}`,
    );
    expect(status).toBe(200);

    // Snapshot-like field list — order matters (byte-identical constraint).
    expect(Object.keys(body)).toEqual(DETAIL_FIELDS);

    const variants = body.variants as Record<string, unknown>[];
    expect(variants).toHaveLength(2);
    for (const v of variants) expect(Object.keys(v)).toEqual(VARIANT_FIELDS);

    // Representative values: display price = cheapest variant; flash-sale
    // arithmetic routed through computeFlashSalePrice (79.80 → 71.82);
    // deliverable-only stock; completed-only order count; price_from only
    // with >1 variant.
    expect(body.price).toBe(79.8);
    expect(body.price_from).toBe(true);
    expect(body.sale_price).toBe(71.82);
    expect(body.discount_percent).toBe(10);
    expect(body.stock_count).toBe(1);
    expect(body.is_available).toBe(true);
    expect(body.order_count).toBe(2);
    expect(variants[0].price).toBe(79.8);
    expect(variants[0].sale_price).toBe(71.82);
    expect(variants[1].sale_price).toBe(539.82);
    expect(variants[0].is_available).toBe(true);
    expect(body.description_long).toBe("وصف طويل يغطي الحقل description_long");
    expect(body.usage_terms).toBe("شروط الاستخدام");
  });

  it("GET /api/products/by-slug/:slug serves the SAME shape and the SAME body as /:id (route parity)", async () => {
    const { productId } = await seedDetailFixture();
    const app = buildApp();

    const byId = await call<Record<string, unknown>>(app, `/api/products/${productId}`);
    const bySlug = await call<Record<string, unknown>>(app, "/api/products/by-slug/shape-fixture-product");

    expect(bySlug.status).toBe(200);
    expect(Object.keys(bySlug.body)).toEqual(DETAIL_FIELDS);
    // Deep parity between the two routes for the same product — the
    // shared buildProductDetailDto guarantees this by construction.
    expect(bySlug.body).toEqual(byId.body);
  });

  it("404 semantics preserved: deactivated product by slug and unknown id", async () => {
    // Unique slug for this case (catalog cache keys persist across cases).
    await db.insert(productsTable).values({
      name: "Shape Deactivated",
      slug: "shape-deactivated",
      price: "15.00",
      category: "streaming",
      isActive: false,
      isArchived: false,
    });
    const app = buildApp();

    const deactivated = await call(app, "/api/products/by-slug/shape-deactivated");
    expect(deactivated.status).toBe(404);
    expect(deactivated.body).toMatchObject({ code: "NOT_FOUND" });

    const unknown = await call(app, "/api/products/999999");
    expect(unknown.status).toBe(404);
    expect(unknown.body).toMatchObject({ code: "NOT_FOUND" });
  });
});
