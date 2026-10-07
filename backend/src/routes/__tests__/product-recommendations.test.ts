import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, initTestDb, productsTable, resetTestDb } from "../../test/db";
import { productsRouter } from "../products";

/**
 * R120-B6/A6-F15 — /api/products/:id/recommendations null-category guard.
 *
 * products.category is NULLABLE. The recommendation select used to cast
 * `product.category as string` and hand NULL straight to eq() — a type
 * lie leaning on SQL's `= NULL` never-true comparison. The guard now
 * early-returns the empty array (same response shape) for category-less
 * products. Pinned here:
 *   - null-category product → 200 + [] (never a 500, never peers);
 *   - the normal same-category path still recommends (isActive/
 *     isArchived filters + self-exclusion intact);
 *   - unknown id → 404 (pre-existing semantics).
 *
 * Cache-collision note: withCatalogCache keys persist across `it`s in
 * this file (module state), and resetTestDb restarts product identity at
 * 1 — every case advances the serial with filler products first so each
 * test's target id is unique (same discipline as
 * product-detail-shape.test.ts).
 */

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/products", productsRouter);
  return app;
}

async function call(app: Express, path: string): Promise<{ status: number; body: unknown }> {
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
        resolve({ status: res.status, body: text ? JSON.parse(text) : null });
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

interface SeedProduct {
  name: string;
  slug: string;
  category: string | null;
  isActive?: boolean;
  isArchived?: boolean;
  price?: string;
}

async function seed(products: SeedProduct[]): Promise<number[]> {
  const rows = await db
    .insert(productsTable)
    .values(
      products.map((p) => ({
        name: p.name,
        slug: p.slug,
        description: "وصف",
        imageUrl: `https://cdn.example.com/${p.slug}.webp`,
        price: p.price ?? "29.00",
        category: p.category,
        isActive: p.isActive ?? true,
        isArchived: p.isArchived ?? false,
      })),
    )
    .returning({ id: productsTable.id });
  return rows.map((r) => r.id);
}

beforeAll(async () => {
  await initTestDb();
});

beforeEach(async () => {
  await resetTestDb();
});

describe("GET /api/products/:id/recommendations — null-category guard (R120-B6/A6-F15)", () => {
  it("null-category product → 200 + [] even when same-store peers exist", async () => {
    // Filler first so this case's ids are unique across the file (cache).
    const [filler, target, peer] = await seed([
      { name: "Filler A", slug: "rec-filler-a", category: "tools" },
      // The target itself: NO category.
      { name: "No Category Product", slug: "rec-no-category", category: null },
      // A fully-qualified peer — must NOT leak into the null-category
      // product's recommendations.
      { name: "Categorized Peer", slug: "rec-peer", category: "streaming" },
    ]);
    expect(target).toBeDefined();
    expect(peer).toBeDefined();
    void filler;

    const { status, body } = await call(buildApp(), `/api/products/${target}/recommendations`);
    expect(status).toBe(200);
    expect(body).toEqual([]);
  });

  it("categorized product → same-category active peers only (self/archived/other-category excluded)", async () => {
    // Two fillers: this case's target lands on a fresh id (cache keys).
    const ids = await seed([
      { name: "Filler B", slug: "rec-filler-b", category: "tools" },
      { name: "Filler C", slug: "rec-filler-c", category: "tools" },
      { name: "Target Show", slug: "rec-target-show", category: "streaming", price: "39.00" },
      { name: "Same Cat Peer", slug: "rec-same-cat-peer", category: "streaming", price: "19.50" },
      { name: "Archived Peer", slug: "rec-archived-peer", category: "streaming", isArchived: true },
      { name: "Inactive Peer", slug: "rec-inactive-peer", category: "streaming", isActive: false },
      { name: "Other Cat Peer", slug: "rec-other-cat-peer", category: "gaming" },
    ]);
    const [, , target, peerId, , ,] = ids;

    const { status, body } = await call(buildApp(), `/api/products/${target}/recommendations`);
    expect(status).toBe(200);
    expect(body).toEqual([
      {
        id: peerId,
        name: "Same Cat Peer",
        image_url: "https://cdn.example.com/rec-same-cat-peer.webp",
        price: 19.5,
      },
    ]);
  });

  it("unknown id → 404 (semantics preserved alongside the guard)", async () => {
    const { status, body } = await call(buildApp(), "/api/products/999999/recommendations");
    expect(status).toBe(404);
    expect(body).toMatchObject({ code: "NOT_FOUND" });
  });
});
