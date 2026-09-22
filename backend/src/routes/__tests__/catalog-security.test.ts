import express from "express";
import cookieParser from "cookie-parser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  db,
  initTestDb,
  resetTestDb,
  inventoryTable,
  productVariantsTable,
  productsTable,
} from "../../test/db";
import { productsRouter } from "../products";

/**
 * Catalog DTO security + integrity tests (catalog reconstruction 2026-09-20).
 *
 * Two guarantees, exercised against the REAL public products routes over
 * the pglite harness:
 *
 *   A. SECURITY — the customer-facing catalog DTO never carries internal
 *      procurement data. The variant rows in the DB hold cost_price (USD),
 *      sku (supplier option keys) — the /api/products responses must not
 *      serialize any of it (field names OR values), and the raw JSON must
 *      not contain the forbidden vocabulary anywhere.
 *
 *   B. INTEGRITY — the catalog's public invariants: unique slugs, every
 *      active product priced, variants ride the product, archived products
 *      invisible, per-variant prices honest against the pricing rule.
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

/** Words that must NEVER appear in a public catalog response. */
const FORBIDDEN_KEYS = [
  "cost_price",
  "costPrice",
  "originalCost",
  "providerCost",
  "supplierPrice",
  "wholesalePrice",
  "wholesale_price",
  "margin",
  "markup",
  "provider",
  "supplier",
  "sku",
  "internal_cost",
  // R102 (provider-readiness): the fulfillment-layer vocabulary joins the
  // forbidden set — provider identity/references are operator-only data
  // (provider_fulfillments table), never public catalog fields.
  "providerOrder",
  "provider_order",
  "providerOrderId",
  "provider_order_id",
  "fulfillment",
  "attempt",
];

function collectKeys(value: unknown, acc: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) collectKeys(v, acc);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      acc.add(k);
      collectKeys(v, acc);
    }
  }
  return acc;
}

async function seedCatalog() {
  // A product with variants carrying VERY recognizable internal values.
  const [netflix] = await db
    .insert(productsTable)
    .values({
      name: "Netflix",
      slug: "netflix",
      description: "اشتراك Netflix",
      price: "79.80",
      costPrice: "3.99", // legacy product-level cost — must also stay hidden
      category: "streaming",
      isActive: true,
    })
    .returning();

  await db.insert(productVariantsTable).values([
    {
      productId: netflix.id,
      durationLabel: "شهر واحد",
      durationDays: 30,
      costPrice: "3.99",
      priceLyd: "79.80",
      sku: "netflix|1 Month|INTERNAL-SKU-SECRET",
      sortOrder: 0,
    },
    {
      productId: netflix.id,
      durationLabel: "سنة كاملة",
      durationDays: 365,
      costPrice: "29.99",
      priceLyd: "599.80",
      sku: "netflix|1 Year|INTERNAL-SKU-SECRET",
      sortOrder: 1,
    },
  ]);

  // A variant-less legacy product (product-level pricing path).
  const [legacy] = await db
    .insert(productsTable)
    .values({
      name: "Legacy Product",
      slug: "legacy-product",
      price: "50.00",
      costPrice: "25.00",
      category: "software",
      isActive: true,
    })
    .returning();

  // An archived product — must be invisible on every public surface.
  await db
    .insert(productsTable)
    .values({
      name: "Archived Product",
      slug: "archived-product",
      price: "10.00",
      category: "streaming",
      isActive: true,
      isArchived: true,
    })
    .returning();

  // Stock so is_available is honest.
  await db.insert(inventoryTable).values({
    productId: netflix.id,
    accountEmail: "stock@example.com",
    accountPassword: "plainpass",
  });

  return { netflix, legacy };
}

beforeAll(async () => {
  await initTestDb();
});

beforeEach(async () => {
  await resetTestDb();
});

describe("A. public catalog DTO security", () => {
  it("GET /api/products carries no internal fields anywhere in the JSON", async () => {
    await seedCatalog();
    const app = buildApp();
    const { status, body, text } = await call<unknown[]>(app, "/api/products");
    expect(status).toBe(200);

    const keys = collectKeys(body);
    for (const forbidden of FORBIDDEN_KEYS) {
      expect(keys.has(forbidden), `response key "${forbidden}" must not exist`).toBe(false);
    }
    // And the raw serialized text: no internal VALUES leak either (the
    // seeded sku + costs are uniquely recognizable strings/numbers).
    expect(text).not.toContain("INTERNAL-SKU-SECRET");
    expect(text).not.toContain("cost");
    expect(text).not.toContain("29.99"); // the $29.99 cost (price 599.80 differs)
    expect(text).not.toContain("3.99"); // the $3.99 cost
  });

  it("GET /api/products/:id and /by-slug/:slug expose variants WITHOUT internal fields", async () => {
    const { netflix, legacy } = await seedCatalog();
    const app = buildApp();

    for (const path of [`/api/products/${netflix.id}`, `/api/products/by-slug/netflix`]) {
      const { status, body, text } = await call<Record<string, unknown>>(app, path);
      expect(status).toBe(200);
      const keys = collectKeys(body);
      for (const forbidden of FORBIDDEN_KEYS) {
        expect(keys.has(forbidden), `${path}: key "${forbidden}" must not exist`).toBe(false);
      }
      expect(text).not.toContain("INTERNAL-SKU-SECRET");
      expect(text).not.toContain("3.99");

      const variants = (body as { variants?: unknown[] }).variants;
      expect(Array.isArray(variants)).toBe(true);
      expect(variants).toHaveLength(2);
      const first = variants![0] as Record<string, unknown>;
      expect(first).toHaveProperty("label");
      expect(first).toHaveProperty("price");
      expect(first).toHaveProperty("is_available");
    }

    // The legacy (variant-less) product still serves the old shape.
    const legacyRes = await call<Record<string, unknown>>(app, `/api/products/${legacy.id}`);
    expect(legacyRes.status).toBe(200);
    expect(legacyRes.body).toHaveProperty("price", 50);
    expect((legacyRes.body as { variants: unknown[] }).variants).toEqual([]);
    expect(legacyRes.text).not.toContain("25.00");
  });

  it("variant DTO carries the public contract fields only", async () => {
    await seedCatalog();
    const app = buildApp();
    const { body } = await call<Record<string, unknown>>(app, "/api/products/by-slug/netflix");
    const variant = (body.variants as Record<string, unknown>[])[0];
    // The public contract: exactly these keys (label + price + availability
    // + the two axis labels). Anything else is scope creep to catch early.
    expect(Object.keys(variant).sort()).toEqual(
      [
        "discount_percent",
        "duration_label",
        "id",
        "is_available",
        "label",
        "plan_label",
        "price",
        "sale_price",
      ].sort(),
    );
  });
});

describe("B. catalog integrity invariants", () => {
  it("archived products never appear in the public catalog", async () => {
    await seedCatalog();
    const app = buildApp();
    const { body } = await call<{ name: string; slug: string | null }[]>(app, "/api/products");
    const names = body.map((p) => p.name);
    expect(names).toContain("Netflix");
    expect(names).toContain("Legacy Product");
    expect(names).not.toContain("Archived Product");
  });

  // 110-F (R110 — 109-n P3): the detail routes filtered is_archived only,
  // so a deactivated product (is_active=false, not archived) stayed
  // fetchable by id/slug while the list route and sitemap already hid it.
  // Both detail WHEREs now mirror the list route — deactivated 404s
  // exactly like archived. This also pins the archived filter on the
  // DETAIL routes (list-route invisibility alone was already pinned).
  it("deactivated (is_active=false) products 404 on the detail routes — like archived ones", async () => {
    const { netflix } = await seedCatalog();
    const app = buildApp();

    // Deactivated-but-NOT-archived: the exact gap the fix closes.
    const [deactivated] = await db
      .insert(productsTable)
      .values({
        name: "Deactivated Product",
        slug: "deactivated-product",
        price: "15.00",
        category: "streaming",
        isActive: false,
        isArchived: false,
      })
      .returning();

    for (const path of [
      `/api/products/${deactivated.id}`,
      "/api/products/by-slug/deactivated-product",
    ]) {
      const { status } = await call(app, path);
      expect(status, `${path} must 404 for a deactivated product`).toBe(404);
    }

    // Archived (seeded by seedCatalog): 404 on the detail surface too.
    const archived = await call(app, "/api/products/by-slug/archived-product");
    expect(archived.status, "archived product must 404 on detail").toBe(404);

    // Guard against over-filtering: ACTIVE products still 200 on both
    // detail paths (id and slug), and a truly unknown id still 404s.
    for (const path of [`/api/products/${netflix.id}`, "/api/products/by-slug/netflix"]) {
      const { status } = await call(app, path);
      expect(status, `${path} must stay 200 for an active product`).toBe(200);
    }
    const unknown = await call(app, "/api/products/999999");
    expect(unknown.status).toBe(404);
  });

  it('list price = cheapest active variant price (the "تبدأ من" number)', async () => {
    await seedCatalog();
    const app = buildApp();
    const { body } = await call<Record<string, unknown>[]>(app, "/api/products");
    const netflix = body.find((p) => p.name === "Netflix") as {
      price: number;
      price_from: boolean;
      variants: { price: number }[];
    };
    expect(netflix.price).toBe(79.8);
    expect(netflix.price_from).toBe(true);
    expect(Math.min(...netflix.variants.map((v) => v.price))).toBe(79.8);
  });

  it("variant prices follow the official pricing rule (cost × 2 × 10)", async () => {
    await seedCatalog();
    const app = buildApp();
    const { body } = await call<Record<string, unknown>[]>(app, "/api/products");
    const netflix = body.find((p) => p.name === "Netflix") as {
      variants: { price: number }[];
    };
    // Seeded: $3.99 → 79.80 and $29.99 → 599.80 (cost × 20 exactly).
    expect(netflix.variants.map((v) => v.price).sort((a, b) => a - b)).toEqual([79.8, 599.8]);
  });

  it("every public product has a price and an availability flag", async () => {
    await seedCatalog();
    const app = buildApp();
    const { body } = await call<Record<string, unknown>[]>(app, "/api/products");
    expect(body.length).toBeGreaterThanOrEqual(2);
    for (const p of body) {
      expect(typeof p.price).toBe("number");
      expect(p.price).toBeGreaterThan(0);
      expect(typeof p.is_available).toBe("boolean");
      expect(typeof p.stock_count).toBe("number");
    }
  });
});
