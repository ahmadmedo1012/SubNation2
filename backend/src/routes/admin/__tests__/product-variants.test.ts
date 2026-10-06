import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import { eq } from "drizzle-orm";
import {
  adminUsersTable,
  auditLogsTable,
  db,
  initTestDb,
  ordersTable,
  productVariantsTable,
  productsTable,
  resetTestDb,
  usersTable,
} from "../../../test/db";
import { createAdminSession } from "../../../lib/admin-session";
import { requireAdmin } from "../../../middlewares/requireAdmin";
import { requirePermission } from "../../../lib/permissions";
import { __resetPricingConfigCache } from "../../../lib/pricing-config";
import { adminProductVariantsRouter } from "../product-variants";

/**
 * R118-A5 TOP-20 #8 [P2] — admin variant CRUD (catalog 2026-09-20)
 * had ZERO tests: full variant CRUD including price writes
 * (routes/admin/product-variants.ts:103-368).
 *
 * Pinned contracts (price engine: cost × 2 × 10 under the default rule):
 *
 *   - POST create: cost bounds 0.01–100,000 (400 below/above/missing),
 *     at least one label required, duplicate (plan, duration) pair per
 *     product → 409 (NULL axes included — IS NOT DISTINCT FROM probe),
 *     price always lands on the engine output unless a VALID explicit
 *     override is provided (an out-of-bounds price_lyd on POST is
 *     IGNORED, not 400 — the engine recomputes; deviation from the A5
 *     sketch, pinned as-coded), and the product display price refreshes
 *     to MIN(active variants);
 *   - PATCH: an explicit price_lyd is reflected; a cost change without
 *     a price override recomputes via the engine; an out-of-bounds
 *     price_lyd → 400 (this surface DOES validate the override);
 *   - DELETE: a variant referenced by an order → 409 guarded (force
 *     deactivate instead — order history keeps its reference); an
 *     unreferenced variant deletes cleanly;
 *   - auth: 401 without a token; 403 for an admin lacking the
 *     `inventory` scope (mounted requireAdmin → requirePermission chain
 *     from routes/admin/index.ts:67-72).
 */

/** Mirrors the production mount (admin/index.ts: protectedRouter chain). */
function buildApp(): Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(
    "/api/admin",
    requireAdmin,
    requirePermission("inventory"),
    adminProductVariantsRouter,
  );
  return app;
}

async function listen(app: Express): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("listener address is not AddressInfo"));
        return;
      }
      resolve({ url: `http://127.0.0.1:${addr.port}`, close: () => server.close() });
    });
  });
}

async function seedAdmin(permissions: string[]): Promise<string> {
  const [a] = await db
    .insert(adminUsersTable)
    .values({
      username: `variants_admin_${permissions.join("_") || "none"}`,
      passwordHash: "x",
      isActive: true,
      permissions,
    })
    .returning();
  const { token } = await createAdminSession({ adminId: a.id, role: "admin" });
  return token;
}

async function seedProduct(price = "999.00"): Promise<number> {
  const [p] = await db
    .insert(productsTable)
    .values({ name: "Variant Product", price, isActive: true })
    .returning();
  return p.id;
}

async function seedVariant(
  productId: number,
  opts: { plan?: string | null; duration?: string | null; cost?: string; price?: string },
) {
  const [v] = await db
    .insert(productVariantsTable)
    .values({
      productId,
      planLabel: opts.plan ?? null,
      durationLabel: opts.duration ?? null,
      costPrice: opts.cost ?? "10.00",
      priceLyd: opts.price ?? "200.00",
    })
    .returning();
  return v;
}

async function call(
  url: string,
  method: string,
  path: string,
  token: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const res = await fetch(`${url}/api/admin${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
}

beforeAll(async () => {
  await initTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  __resetPricingConfigCache();
});

describe("POST /api/admin/products/:id/variants (R118-A5 #8)", () => {
  it("creates the variant at the ENGINE price (cost × 2 × 10) and refreshes the product display price", async () => {
    const token = await seedAdmin(["inventory"]);
    const productId = await seedProduct("999.00");
    const { url, close } = await listen(buildApp());
    try {
      const res = await call(url, "POST", `/products/${productId}/variants`, token, {
        plan_label: "Family",
        duration_label: "شهر واحد",
        cost_price: 10,
        sort_order: 0,
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        product_id: productId,
        plan_label: "Family",
        duration_label: "شهر واحد",
        cost_price: 10,
        price_lyd: 200, // computeRetailLYD(10, {10, 100})
        computed_price_lyd: 200,
        is_active: true,
      });

      // Display price = MIN(active variants) after the mutation.
      const [p] = await db.select().from(productsTable).where(eq(productsTable.id, productId));
      expect(String(p.price)).toBe("200.00");

      // The create is audited.
      const audits = await db
        .select({ id: auditLogsTable.id })
        .from(auditLogsTable)
        .where(eq(auditLogsTable.action, "product.variant.create"));
      expect(audits).toHaveLength(1);
    } finally {
      close();
    }
  });

  it("an out-of-bounds cost_price → 400 (below 0.01, above 100,000, missing)", async () => {
    const token = await seedAdmin(["inventory"]);
    const productId = await seedProduct();
    const { url, close } = await listen(buildApp());
    try {
      // NOTE (as-coded): the route rounds BEFORE validating
      // (round2(cost) then the 0.01 bound), so 0.005 rounds UP to 0.01
      // and is accepted — 0.004 is the first value that lands below the
      // floor. Pinned separately below.
      for (const cost_price of [0, 0.004, 100_001, -1, "ten" /* non-number → null */]) {
        const res = await call(url, "POST", `/products/${productId}/variants`, token, {
          plan_label: "Family",
          cost_price,
        });
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({ code: "INVALID_DATA" });
      }
      expect(
        await db.select().from(productVariantsTable).where(eq(productVariantsTable.productId, productId)),
      ).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("cost round-then-validate boundary: 0.005 rounds up to the 0.01 floor and is accepted (as-coded)", async () => {
    const token = await seedAdmin(["inventory"]);
    const productId = await seedProduct();
    const { url, close } = await listen(buildApp());
    try {
      const res = await call(url, "POST", `/products/${productId}/variants`, token, {
        duration_label: "شهر واحد",
        cost_price: 0.005, // round2 → 0.01 → passes the floor
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ cost_price: 0.01 });
    } finally {
      close();
    }
  });

  it("a duplicate (plan, duration) pair for the same product → 409 (NULL plan included)", async () => {
    const token = await seedAdmin(["inventory"]);
    const productId = await seedProduct();
    await seedVariant(productId, { plan: null, duration: "شهر واحد", price: "200.00" });
    const { url, close } = await listen(buildApp());
    try {
      // Same (null, duration) pair — the NULLS-NOT-DISTINCT class.
      const dup = await call(url, "POST", `/products/${productId}/variants`, token, {
        duration_label: "شهر واحد",
        cost_price: 5,
      });
      expect(dup.status).toBe(409);
      expect(dup.body).toMatchObject({ code: "CONFLICT" });
      // A DIFFERENT duration on the same product is fine.
      const other = await call(url, "POST", `/products/${productId}/variants`, token, {
        duration_label: "سنة كاملة",
        cost_price: 5,
      });
      expect(other.status).toBe(201);
      // The same pair on ANOTHER product is fine too (per-product scope).
      const otherProduct = await seedProduct();
      const crossProduct = await call(url, "POST", `/products/${otherProduct}/variants`, token, {
        duration_label: "شهر واحد",
        cost_price: 5,
      });
      expect(crossProduct.status).toBe(201);
    } finally {
      close();
    }
  });

  it("neither plan nor duration label → 400", async () => {
    const token = await seedAdmin(["inventory"]);
    const productId = await seedProduct();
    const { url, close } = await listen(buildApp());
    try {
      const res = await call(url, "POST", `/products/${productId}/variants`, token, {
        cost_price: 10,
        plan_label: "   ", // whitespace-only normalizes to NULL
      });
      expect(res.status).toBe(400);
    } finally {
      close();
    }
  });

  it("an out-of-bounds price_lyd override on POST is IGNORED — the engine recomputes (as-coded)", async () => {
    const token = await seedAdmin(["inventory"]);
    const productId = await seedProduct();
    const { url, close } = await listen(buildApp());
    try {
      const res = await call(url, "POST", `/products/${productId}/variants`, token, {
        duration_label: "شهر واحد",
        cost_price: 10,
        price_lyd: -5, // invalid override → falls back to the engine price
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ price_lyd: 200 });

      // A VALID override is honored instead.
      const override = await call(url, "POST", `/products/${productId}/variants`, token, {
        duration_label: "سنة كاملة",
        cost_price: 10,
        price_lyd: 175.5,
      });
      expect(override.status).toBe(201);
      expect(override.body).toMatchObject({ price_lyd: 175.5, computed_price_lyd: 200 });
    } finally {
      close();
    }
  });
});

describe("PATCH /api/admin/products/:id/variants/:variantId (R118-A5 #8)", () => {
  it("an explicit price_lyd is reflected and the product display price follows MIN(active)", async () => {
    const token = await seedAdmin(["inventory"]);
    const productId = await seedProduct("200.00");
    const v1 = await seedVariant(productId, { duration: "شهر واحد", price: "200.00" });
    await seedVariant(productId, { duration: "سنة كاملة", price: "400.00" });

    const { url, close } = await listen(buildApp());
    try {
      const res = await call(url, "PATCH", `/products/${productId}/variants/${v1.id}`, token, {
        price_lyd: 250,
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ price_lyd: 250 });

      const [row] = await db
        .select()
        .from(productVariantsTable)
        .where(eq(productVariantsTable.id, v1.id));
      expect(String(row.priceLyd)).toBe("250.00");
      // Display price = MIN(250, 400) — follows the patch.
      const [p] = await db.select().from(productsTable).where(eq(productsTable.id, productId));
      expect(String(p.price)).toBe("250.00");
    } finally {
      close();
    }
  });

  it("a cost change without a price override recomputes the price via the engine", async () => {
    const token = await seedAdmin(["inventory"]);
    const productId = await seedProduct("200.00");
    const v = await seedVariant(productId, { duration: "شهر واحد", price: "200.00" });

    const { url, close } = await listen(buildApp());
    try {
      const res = await call(url, "PATCH", `/products/${productId}/variants/${v.id}`, token, {
        cost_price: 1, // engine: 1 × 2 × 10 = 20
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ cost_price: 1, price_lyd: 20 });
    } finally {
      close();
    }
  });

  it("an out-of-bounds price_lyd on PATCH → 400 (this surface validates the override)", async () => {
    const token = await seedAdmin(["inventory"]);
    const productId = await seedProduct();
    const v = await seedVariant(productId, { duration: "شهر واحد", price: "200.00" });

    const { url, close } = await listen(buildApp());
    try {
      for (const price_lyd of [-5, 0, 0.005, 1_000_001]) {
        const res = await call(url, "PATCH", `/products/${productId}/variants/${v.id}`, token, {
          price_lyd,
        });
        expect(res.status).toBe(400);
      }
      // Unchanged after the refusals.
      const [row] = await db
        .select()
        .from(productVariantsTable)
        .where(eq(productVariantsTable.id, v.id));
      expect(String(row.priceLyd)).toBe("200.00");
    } finally {
      close();
    }
  });
});

describe("DELETE /api/admin/products/:id/variants/:variantId (R118-A5 #8)", () => {
  it("a variant referenced by an order → 409 guarded (force deactivate instead)", async () => {
    const token = await seedAdmin(["inventory"]);
    const productId = await seedProduct("200.00");
    const v = await seedVariant(productId, { duration: "شهر واحد", price: "200.00" });
    const [buyer] = await db.insert(usersTable).values({ phone: "949000001" }).returning();
    await db.insert(ordersTable).values({
      orderCode: "SNVAR0001",
      userId: buyer.id,
      productId,
      variantId: v.id,
      variantLabel: "شهر واحد",
      amount: "200.00",
      status: "completed",
    });

    const { url, close } = await listen(buildApp());
    try {
      const res = await call(url, "DELETE", `/products/${productId}/variants/${v.id}`, token);
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: "CONFLICT" });
      // The variant survives (order history keeps its reference).
      const [row] = await db
        .select()
        .from(productVariantsTable)
        .where(eq(productVariantsTable.id, v.id));
      expect(row).toBeDefined();
    } finally {
      close();
    }
  });

  it("an unreferenced variant deletes cleanly and the display price refreshes", async () => {
    const token = await seedAdmin(["inventory"]);
    const productId = await seedProduct("400.00");
    const v1 = await seedVariant(productId, { duration: "شهر واحد", price: "400.00" });
    const v2 = await seedVariant(productId, { duration: "سنة كاملة", price: "800.00" });

    const { url, close } = await listen(buildApp());
    try {
      const res = await call(url, "DELETE", `/products/${productId}/variants/${v1.id}`, token);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true });
      expect(
        await db.select().from(productVariantsTable).where(eq(productVariantsTable.id, v1.id)),
      ).toHaveLength(0);
      // Display price follows the surviving variant.
      const [p] = await db.select().from(productsTable).where(eq(productsTable.id, productId));
      expect(String(p.price)).toBe("800.00");
      expect(String((await db.select().from(productVariantsTable).where(eq(productVariantsTable.id, v2.id)))[0].priceLyd)).toBe("800.00");
    } finally {
      close();
    }
  });
});

describe("auth gates (R118-A5 #8)", () => {
  it("no token → 401 (requireAdmin)", async () => {
    const productId = await seedProduct();
    const { url, close } = await listen(buildApp());
    try {
      const res = await fetch(`${url}/api/admin/products/${productId}/variants`);
      expect(res.status).toBe(401);
    } finally {
      close();
    }
  });

  it("an admin WITHOUT the inventory scope → 403; with it → 200 (production mount chain)", async () => {
    const noScopeToken = await seedAdmin(["users"]);
    const scopedToken = await seedAdmin(["inventory"]);
    const productId = await seedProduct();
    await seedVariant(productId, { duration: "شهر واحد", price: "200.00" });

    const { url, close } = await listen(buildApp());
    try {
      const refused = await call(url, "GET", `/products/${productId}/variants`, noScopeToken);
      expect(refused.status).toBe(403);
      expect(refused.body).toMatchObject({ code: "FORBIDDEN" });

      const allowed = await call(url, "GET", `/products/${productId}/variants`, scopedToken);
      expect(allowed.status).toBe(200);
      expect(Array.isArray(allowed.body)).toBe(true);
    } finally {
      close();
    }
  });
});
