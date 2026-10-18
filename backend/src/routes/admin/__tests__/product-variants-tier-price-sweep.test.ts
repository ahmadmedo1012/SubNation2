import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import { eq } from "drizzle-orm";
import {
  adminUsersTable,
  db,
  initTestDb,
  productVariantsTable,
  productsTable,
  resetTestDb,
} from "../../../test/db";
import { createAdminSession } from "../../../lib/admin-session";
import { requireAdmin } from "../../../middlewares/requireAdmin";
import { requirePermission } from "../../../lib/permissions";
import { __resetPricingConfigCache } from "../../../lib/pricing-config";
import { adminProductVariantsRouter } from "../product-variants";

/**
 * R168 (L2) — GET /api/admin/products/tier-price-sweep: the whole-catalog
 * READ-ONLY twin of the R167 write-path warnings.
 *
 *   - 200 envelope {checked_at, products_scanned, variants_scanned, scan_cap,
 *     products_with_findings, findings[]} over EVERY active, non-archived
 *     product's ACTIVE variant matrix (deactivation = the documented
 *     silencer, R167 semantics);
 *   - each finding carries the validator's numeric shape, the VERBATIM
 *     tierPriceWarningMessage Arabic copy (one registry — the same string
 *     the write-path warnings ride) and the product's active variant rows
 *     as the correction evidence;
 *   - read-only by construction: no writes/audit/IndexNow — calling it
 *     twice returns identical findings;
 *   - auth: 401 without a token, 403 with a non-inventory scope.
 *
 * Fixtures reuse the live catalog's label dialect — the AREFS_LIVE matrix
 * is copied verbatim from lib/__tests__/catalog-quality.test.ts (the
 * defect class that motivated the R162 rule).
 */

const AREFS_EQUALIZED_MESSAGE =
  "تحذير: سعر الباقتين «قياسي» و«متقدم» متساوٍ (15,980.00 د.ل) عند مدة «سنوي» رغم اختلاف ترتيب سعرهما عند المدد الأخرى للمنتج نفسه — تحقّق من صحة الأسعار.";

const INVERTED_MESSAGE_500_400 =
  "تحذير: ترتيب سعر الباقتين «أساسي» و«بريميوم» معكوس عند مدة «سنة كاملة» («أساسي» بسعر 500.00 د.ل و«بريميوم» بسعر 400.00 د.ل) خلافًا لترتيبهما عند المدد الأخرى للمنتج نفسه — تحقّق من صحة الأسعار.";

/** Mirrors the production mount (admin/index.ts: protectedRouter chain). */
function buildApp(): Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/admin", requireAdmin, requirePermission("inventory"), adminProductVariantsRouter);
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
      username: `sweep_admin_${permissions.join("_") || "none"}`,
      passwordHash: "x",
      isActive: true,
      permissions,
    })
    .returning();
  const { token } = await createAdminSession({ adminId: a.id, role: "admin" });
  return token;
}

async function seedProduct(opts: {
  name: string;
  price?: string;
  isArchived?: boolean;
}): Promise<number> {
  const [p] = await db
    .insert(productsTable)
    .values({
      name: opts.name,
      price: opts.price ?? "999.00",
      isActive: true,
      ...(opts.isArchived ? { isArchived: true } : {}),
    })
    .returning();
  return p.id;
}

async function seedVariant(
  productId: number,
  opts: {
    plan?: string | null;
    duration?: string | null;
    price?: string;
    active?: boolean;
  },
) {
  const [v] = await db
    .insert(productVariantsTable)
    .values({
      productId,
      planLabel: opts.plan ?? null,
      durationLabel: opts.duration ?? null,
      costPrice: "10.00",
      priceLyd: opts.price ?? "200.00",
      isActive: opts.active ?? true,
    })
    .returning();
  return v;
}

async function call(
  url: string,
  path: string,
  token: string | null,
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const res = await fetch(`${url}/api/admin${path}`, {
    method: "GET",
    headers: token === null ? {} : { Authorization: `Bearer ${token}` },
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

/** The live fixture set: AREFS (equalized) + inverted + Disney (ordered) + Netflix (tierless). */
async function seedCatalog(): Promise<void> {
  // 1. The AREFS_LIVE matrix (verbatim from catalog-quality.test.ts —
  //    the live defect: قياسي/متقدم collide at سنوي 15,980).
  const ahrefs = await seedProduct({ name: "Ahrefs", price: "1980.00" });
  await seedVariant(ahrefs, { plan: "لايت", duration: "شهري", price: "1980.00" });
  await seedVariant(ahrefs, { plan: "قياسي", duration: "شهري", price: "3980.00" });
  await seedVariant(ahrefs, { plan: "متقدم", duration: "شهري", price: "5980.00" });
  await seedVariant(ahrefs, { plan: "لايت", duration: "سنوي", price: "11980.00" });
  await seedVariant(ahrefs, { plan: "قياسي", duration: "سنوي", price: "15980.00" });
  await seedVariant(ahrefs, { plan: "متقدم", duration: "سنوي", price: "15980.00" });

  // 2. An inverted pair (anchor شهر واحد 100 < 200; سنة كاملة 500 > 400).
  const inverted = await seedProduct({ name: "Inverted Product", price: "100.00" });
  await seedVariant(inverted, { plan: "أساسي", duration: "شهر واحد", price: "100.00" });
  await seedVariant(inverted, { plan: "بريميوم", duration: "شهر واحد", price: "200.00" });
  await seedVariant(inverted, { plan: "أساسي", duration: "سنة كاملة", price: "500.00" });
  await seedVariant(inverted, { plan: "بريميوم", duration: "سنة كاملة", price: "400.00" });

  // 3. A fully-ordered Disney+ matrix — no findings.
  const disney = await seedProduct({ name: "Disney+", price: "79.80" });
  await seedVariant(disney, { plan: "أساسي", duration: "شهر واحد", price: "79.80" });
  await seedVariant(disney, { plan: "بريميوم", duration: "شهر واحد", price: "119.80" });
  await seedVariant(disney, { plan: "أساسي", duration: "3 أشهر", price: "199.80" });
  await seedVariant(disney, { plan: "بريميوم", duration: "3 أشهر", price: "299.80" });
  await seedVariant(disney, { plan: "أساسي", duration: "6 أشهر", price: "339.80" });
  await seedVariant(disney, { plan: "بريميوم", duration: "6 أشهر", price: "539.80" });
  await seedVariant(disney, { plan: "أساسي", duration: "سنة كاملة", price: "599.80" });
  await seedVariant(disney, { plan: "بريميوم", duration: "سنة كاملة", price: "999.80" });

  // 4. A tierless Netflix-like matrix (plan axis null) — no pairs to check.
  const netflix = await seedProduct({ name: "Netflix", price: "79.80" });
  await seedVariant(netflix, { plan: null, duration: "شهر واحد", price: "79.80" });
  await seedVariant(netflix, { plan: null, duration: "3 أشهر", price: "199.80" });
  await seedVariant(netflix, { plan: null, duration: "6 أشهر", price: "339.80" });
  await seedVariant(netflix, { plan: null, duration: "سنة كاملة", price: "599.80" });
}

describe("R168 (L2) — GET /products/tier-price-sweep (read-only whole-catalog audit)", () => {
  it("200 shape + counts: every active product scanned, variants summed, cap echoed", async () => {
    await seedCatalog();
    const token = await seedAdmin(["inventory"]);
    const { url, close } = await listen(buildApp());
    try {
      const res = await call(url, "/products/tier-price-sweep", token);
      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(typeof body.checked_at).toBe("string");
      expect(new Date(body.checked_at as string).toString()).not.toBe("Invalid Date");
      // All 4 seeded active products (incl. the clean ones — the sweep
      // audits the whole catalog, it does not pre-filter).
      expect(body.products_scanned).toBe(4);
      // 6 + 4 + 8 + 4 active variant rows.
      expect(body.variants_scanned).toBe(22);
      expect(body.scan_cap).toBe(1000);
      expect(body.products_with_findings).toBe(2);
      expect(body.findings).toHaveLength(2);
    } finally {
      close();
    }
  });

  it("finding contents: numeric shape + the exact Arabic copy (tierPriceWarningMessage registry) + the variant evidence + product identity", async () => {
    await seedCatalog();
    const token = await seedAdmin(["inventory"]);
    const { url, close } = await listen(buildApp());
    try {
      const res = await call(url, "/products/tier-price-sweep", token);
      const findings = (res.body as { findings: Array<Record<string, unknown>> }).findings;
      expect(findings).toHaveLength(2);
      const kinds = findings.map((f) => f.kind).sort();
      expect(kinds).toEqual(["equalized", "inverted"]);

      const equalized = findings.find((f) => f.kind === "equalized")!;
      expect(equalized).toMatchObject({
        product_name: "Ahrefs",
        plan_a: "قياسي",
        plan_b: "متقدم",
        duration: "سنوي",
        price: 15980,
      });
      // The VERBATIM write-path copy — one registry, no fork.
      expect(equalized.message).toBe(AREFS_EQUALIZED_MESSAGE);
      expect(equalized.price_a).toBeUndefined();
      expect(equalized.price_b).toBeUndefined();
      // The evidence: the product's ACTIVE variant rows.
      expect(equalized.variants).toEqual([
        { id: expect.any(Number), plan_label: "لايت", duration_label: "شهري", price: 1980 },
        { id: expect.any(Number), plan_label: "قياسي", duration_label: "شهري", price: 3980 },
        { id: expect.any(Number), plan_label: "متقدم", duration_label: "شهري", price: 5980 },
        { id: expect.any(Number), plan_label: "لايت", duration_label: "سنوي", price: 11980 },
        { id: expect.any(Number), plan_label: "قياسي", duration_label: "سنوي", price: 15980 },
        { id: expect.any(Number), plan_label: "متقدم", duration_label: "سنوي", price: 15980 },
      ]);
      expect(typeof equalized.product_id).toBe("number");
      // seedProduct sets no slug — the row-level null rides the finding.
      expect(equalized.product_slug).toBeNull();

      const inverted = findings.find((f) => f.kind === "inverted")!;
      expect(inverted).toMatchObject({
        product_name: "Inverted Product",
        plan_a: "أساسي",
        plan_b: "بريميوم",
        duration: "سنة كاملة",
        price_a: 500,
        price_b: 400,
      });
      expect(inverted.message).toBe(INVERTED_MESSAGE_500_400);
      expect(inverted.price).toBeUndefined();
      expect((inverted.variants as unknown[]).length).toBe(4);
    } finally {
      close();
    }
  });

  it("the sweep validates the ACTIVE matrix — a deactivated anomalous row is excluded (deactivation silences, R167 semantics)", async () => {
    const token = await seedAdmin(["inventory"]);
    const productId = await seedProduct({ name: "Dormant Anomaly" });
    await seedVariant(productId, { plan: "أساسي", duration: "شهر واحد", price: "100.00" });
    await seedVariant(productId, { plan: "بريميوم", duration: "شهر واحد", price: "200.00" });
    await seedVariant(productId, { plan: "أساسي", duration: "سنة كاملة", price: "500.00" });
    // INACTIVE: the inverted سنة كاملة row is invisible to the sweep.
    await seedVariant(productId, {
      plan: "بريميوم",
      duration: "سنة كاملة",
      price: "400.00",
      active: false,
    });

    const { url, close } = await listen(buildApp());
    try {
      const res = await call(url, "/products/tier-price-sweep", token);
      expect(res.status).toBe(200);
      expect((res.body as { products_with_findings: number }).products_with_findings).toBe(0);
      expect((res.body as { findings: unknown[] }).findings).toEqual([]);
      // The deactivated row is excluded from variants_scanned too.
      expect((res.body as { variants_scanned: number }).variants_scanned).toBe(3);
    } finally {
      close();
    }
  });

  it("auth: 401 without a token, 403 with a non-inventory scope", async () => {
    await seedCatalog();
    const supportToken = await seedAdmin(["support"]);
    const { url, close } = await listen(buildApp());
    try {
      const anon = await call(url, "/products/tier-price-sweep", null);
      expect(anon.status).toBe(401);

      const scoped = await call(url, "/products/tier-price-sweep", supportToken);
      expect(scoped.status).toBe(403);
    } finally {
      close();
    }
  });

  it("read-only: a second call returns identical results (no observable state change)", async () => {
    await seedCatalog();
    const token = await seedAdmin(["inventory"]);
    const { url, close } = await listen(buildApp());
    try {
      const first = await call(url, "/products/tier-price-sweep", token);
      const second = await call(url, "/products/tier-price-sweep", token);
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      // checked_at advances by design; everything else is byte-identical.
      const { checked_at: _ignoredFirst, ...firstBody } = first.body as Record<string, unknown>;
      const { checked_at: _ignoredSecond, ...secondBody } = second.body as Record<string, unknown>;
      expect(firstBody).toEqual(secondBody);
      expect(_ignoredFirst).not.toBe(_ignoredSecond);
    } finally {
      close();
    }
  });

  it("an archived product is excluded from the scan entirely", async () => {
    const token = await seedAdmin(["inventory"]);
    // An anomalous matrix on an ARCHIVED product — invisible.
    const archived = await seedProduct({ name: "Archived Ahrefs", isArchived: true });
    await seedVariant(archived, { plan: "قياسي", duration: "شهري", price: "3980.00" });
    await seedVariant(archived, { plan: "متقدم", duration: "شهري", price: "5980.00" });
    await seedVariant(archived, { plan: "قياسي", duration: "سنوي", price: "15980.00" });
    await seedVariant(archived, { plan: "متقدم", duration: "سنوي", price: "15980.00" });
    // An INACTIVE product is likewise excluded (isActive = false).
    const inactive = await seedProduct({ name: "Inactive Ahrefs", price: "3980.00" });
    await db.update(productsTable).set({ isActive: false }).where(eq(productsTable.id, inactive));
    await seedVariant(inactive, { plan: "قياسي", duration: "شهري", price: "3980.00" });
    await seedVariant(inactive, { plan: "متقدم", duration: "شهري", price: "5980.00" });
    await seedVariant(inactive, { plan: "قياسي", duration: "سنوي", price: "15980.00" });
    await seedVariant(inactive, { plan: "متقدم", duration: "سنوي", price: "15980.00" });

    const { url, close } = await listen(buildApp());
    try {
      const res = await call(url, "/products/tier-price-sweep", token);
      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body.products_scanned).toBe(0);
      expect(body.variants_scanned).toBe(0);
      expect(body.products_with_findings).toBe(0);
      expect(body.findings).toEqual([]);
    } finally {
      close();
    }
  });
});

// The validator-throw degradation case is NOT mocked here: unlike the
// R167 write path (a committed write that must never 5xx — its sweep is
// defensively wrapped), this route's only inputs are its own DB reads; a
// mid-handler failure is a genuine next(err) 500, the correct error
// convention for a read-only diagnostics surface. Mocking drizzle rows
// mid-handler is not a clean module boundary (noted per the task's
// "only if mockable cleanly" instruction).
