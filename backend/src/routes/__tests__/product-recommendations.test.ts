import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, initTestDb, inventoryTable, productsTable, resetTestDb } from "../../test/db";
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
        // R122 (A1-P2): slug rides the recommendations DTO — the
        // frontend rail links /product/<slug ?? id>; the id-only link
        // forced a numeric-URL hop for every recommended product.
        slug: "rec-same-cat-peer",
        name: "Same Cat Peer",
        image_url: "https://cdn.example.com/rec-same-cat-peer.webp",
        price: 19.5,
        // R147: is_available rides the DTO — this fixture seeds no
        // inventory, so the peer is honestly sold out.
        is_available: false,
      },
    ]);
  });

  it("R147 (P0): mixed stock — stocked peers LEAD (stock-first ordering) + honest is_available flags", async () => {
    // The live-catalog defect: 44/45 products sold out and the rail's
    // ONLY in-stock peer rendered LAST with no نفد mark. Pin the two
    // halves of the fix: (a) stocked-first ordering with the id-ASC
    // tiebreak inside each group, (b) is_available derived from
    // DELIVERABLE inventory (R102) — sold is_sold=true units and
    // credential-less units both count as zero stock.
    //
    // Cache discipline (file header): eight fillers put this case's
    // target on id 9 (no prior case requested 9; 2/3/4/7 are resident).
    const ids = await seed([
      { name: "Filler F1", slug: "rec-filler-f1", category: "tools" },
      { name: "Filler F2", slug: "rec-filler-f2", category: "tools" },
      { name: "Filler F3", slug: "rec-filler-f3", category: "tools" },
      { name: "Filler F4", slug: "rec-filler-f4", category: "tools" },
      { name: "Filler F5", slug: "rec-filler-f5", category: "tools" },
      { name: "Filler F6", slug: "rec-filler-f6", category: "tools" },
      { name: "Filler F7", slug: "rec-filler-f7", category: "tools" },
      { name: "Filler F8", slug: "rec-filler-f8", category: "tools" },
      { name: "Mixed Target", slug: "rec-mixed-target", category: "streaming" },
      // Sold-out peer BEFORE the stocked ones by insertion (id 10).
      { name: "Sold Out Peer A", slug: "rec-sold-a", category: "streaming", price: "15.00" },
      // Stocked peers (ids 11, 12) — deliverable inventory below.
      { name: "Stocked Peer B", slug: "rec-stocked-b", category: "streaming", price: "25.00" },
      { name: "Stocked Peer C", slug: "rec-stocked-c", category: "streaming", price: "35.00" },
      // Sold-out peer D: carries an unsold but CREDENTIAL-LESS unit —
      // R102: not deliverable, counts as zero stock.
      { name: "Undeliverable Peer D", slug: "rec-sold-d", category: "streaming", price: "45.00" },
    ]);
    const [, , , , , , , , , soldA, stockedB, stockedC, soldD] = ids;

    // Deliverable stock for B and C (generic pool — variant_id NULL).
    await db.insert(inventoryTable).values([
      { productId: stockedB, accountEmail: "b@rec.local", accountPassword: "pw" },
      { productId: stockedC, accountEmail: "c@rec.local", accountPassword: "pw" },
      // D's unit: unsold but zero credential fields → not deliverable.
      { productId: soldD },
    ]);

    const { status, body } = await call(buildApp(), `/api/products/${ids[8]}/recommendations`);
    expect(status).toBe(200);
    expect(body).toEqual([
      {
        id: stockedB,
        slug: "rec-stocked-b",
        name: "Stocked Peer B",
        image_url: "https://cdn.example.com/rec-stocked-b.webp",
        price: 25,
        is_available: true,
      },
      {
        id: stockedC,
        slug: "rec-stocked-c",
        name: "Stocked Peer C",
        image_url: "https://cdn.example.com/rec-stocked-c.webp",
        price: 35,
        is_available: true,
      },
      {
        id: soldA,
        slug: "rec-sold-a",
        name: "Sold Out Peer A",
        image_url: "https://cdn.example.com/rec-sold-a.webp",
        price: 15,
        is_available: false,
      },
      {
        id: soldD,
        slug: "rec-sold-d",
        name: "Undeliverable Peer D",
        image_url: "https://cdn.example.com/rec-sold-d.webp",
        price: 45,
        is_available: false,
      },
    ]);
  });

  it("unknown id → 404 (semantics preserved alongside the guard)", async () => {
    const { status, body } = await call(buildApp(), "/api/products/999999/recommendations");
    expect(status).toBe(404);
    expect(body).toMatchObject({ code: "NOT_FOUND" });
  });

  it("R143 (L4-5): an ARCHIVED anchor product → 404 — the lookup mirrors the 110-F visibility rule", async () => {
    // The anchor (lookup-stage) product is archived while same-category
    // LIVE peers exist — the peers query filters, but the lookup used to
    // answer found:true for hidden ids (the one public product surface
    // without the mirror the detail routes carry).
    //
    // Cache discipline (file header): withCatalogCache persists across
    // `it`s and resetTestDb restarts ids at 1 — three fillers put this
    // case's target on id 4 (no prior test requested 4).
    const [f1, f2, f3, target, peer] = await seed([
      { name: "Filler D1", slug: "rec-filler-d1", category: "tools" },
      { name: "Filler D2", slug: "rec-filler-d2", category: "tools" },
      { name: "Filler D3", slug: "rec-filler-d3", category: "tools" },
      {
        name: "Archived Anchor",
        slug: "rec-archived-anchor",
        category: "streaming",
        isArchived: true,
      },
      { name: "Live Same Cat Peer", slug: "rec-live-peer", category: "streaming" },
    ]);
    expect(peer).toBeDefined();
    void f1;
    void f2;
    void f3;

    const { status, body } = await call(buildApp(), `/api/products/${target}/recommendations`);
    expect(status).toBe(404);
    expect(body).toMatchObject({ code: "NOT_FOUND" });
  });

  it("R143 (L4-5): a DEACTIVATED anchor product → 404 (is_active arm of the same mirror)", async () => {
    // Six fillers → target id 7 (ids 2 and 6 are already cache-resident
    // from the earlier cases; 4 from the archived leg above).
    const [f1, f2, f3, f4, f5, f6, target, peer] = await seed([
      { name: "Filler E1", slug: "rec-filler-e1", category: "tools" },
      { name: "Filler E2", slug: "rec-filler-e2", category: "tools" },
      { name: "Filler E3", slug: "rec-filler-e3", category: "tools" },
      { name: "Filler E4", slug: "rec-filler-e4", category: "tools" },
      { name: "Filler E5", slug: "rec-filler-e5", category: "tools" },
      { name: "Filler E6", slug: "rec-filler-e6", category: "tools" },
      {
        name: "Inactive Anchor",
        slug: "rec-inactive-anchor",
        category: "streaming",
        isActive: false,
      },
      { name: "Another Live Peer", slug: "rec-live-peer-2", category: "streaming" },
    ]);
    expect(peer).toBeDefined();
    void f1;
    void f2;
    void f3;
    void f4;
    void f5;
    void f6;

    const { status, body } = await call(buildApp(), `/api/products/${target}/recommendations`);
    expect(status).toBe(404);
    expect(body).toMatchObject({ code: "NOT_FOUND" });
  });
});
