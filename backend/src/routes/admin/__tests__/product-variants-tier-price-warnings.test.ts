import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
import { logger } from "../../../lib/logger";
import { adminProductVariantsRouter } from "../product-variants";

// R167 (B3): module-boundary mock of the R162 validator — the default
// implementation IS the real findTierPriceAnomalies (every test below but
// the degradation pin runs the true rule); the degradation test overrides
// it once to throw, proving the sweep can never 5xx a committed write.
const { findTierPriceAnomaliesMock } = vi.hoisted(() => ({ findTierPriceAnomaliesMock: vi.fn() }));

vi.mock("../../../lib/catalog-quality", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/catalog-quality")>();
  findTierPriceAnomaliesMock.mockImplementation(actual.findTierPriceAnomalies);
  return { ...actual, findTierPriceAnomalies: findTierPriceAnomaliesMock };
});

/**
 * R167-D (B3 wiring) — the R162 cross-duration tier-price validator is now
 * on the admin variant write path as WARN-FIRST, ADDITIVE, NEVER BLOCKING
 * product copy:
 *
 *   - POST/PATCH success: the response keeps the full variant payload and
 *     carries `warnings: [{kind, message}]` IFF the write left the
 *     product's ACTIVE variant matrix with a cross-duration tier-price
 *     inconsistency; a clean write has NO warnings field at all (the
 *     additive contract — existing consumers see zero change);
 *   - the copy is operator-facing Arabic matching the validator's actual
 *     anomaly semantics (equalized / inverted across shared durations);
 *   - exactly ONE warn-level log line per offending write;
 *   - the sweep validates the ACTIVE matrix (the public storefront
 *     projection — catalog.service.ts), so DEACTIVATION is the documented
 *     silencer, and a validator/DB failure inside the sweep degrades to a
 *     logged warn line while the committed write still answers 2xx.
 *
 * Fixtures reuse the live catalog's label dialect (Disney+ أساسي/بريميوم ×
 * شهر واحد/سنة كاملة — the R162 suite's verbatim-live-label convention).
 */

const EQUALIZED_MESSAGE =
  "تحذير: سعر الباقتين «أساسي» و«بريميوم» متساوٍ (15,980.00 د.ل) عند مدة «سنة كاملة» رغم اختلاف ترتيب سعرهما عند المدد الأخرى للمنتج نفسه — تحقّق من صحة الأسعار.";

const INVERTED_MESSAGE_500_400 =
  "تحذير: ترتيب سعر الباقتين «أساسي» و«بريميوم» معكوس عند مدة «سنة كاملة» («أساسي» بسعر 500.00 د.ل و«بريميوم» بسعر 400.00 د.ل) خلافًا لترتيبهما عند المدد الأخرى للمنتج نفسه — تحقّق من صحة الأسعار.";

const INVERTED_MESSAGE_500_300 =
  "تحذير: ترتيب سعر الباقتين «أساسي» و«بريميوم» معكوس عند مدة «سنة كاملة» («أساسي» بسعر 500.00 د.ل و«بريميوم» بسعر 300.00 د.ل) خلافًا لترتيبهما عند المدد الأخرى للمنتج نفسه — تحقّق من صحة الأسعار.";

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
      username: `tierprice_admin_${permissions.join("_") || "none"}`,
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
    .values({ name: "Tier Price Product", price, isActive: true })
    .returning();
  return p.id;
}

async function seedVariant(
  productId: number,
  opts: {
    plan?: string | null;
    duration?: string | null;
    cost?: string;
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
      costPrice: opts.cost ?? "10.00",
      priceLyd: opts.price ?? "200.00",
      isActive: opts.active ?? true,
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

/** The sweep's warn lines only — logger.warn(filtering by message). */
function tierPriceWarnCalls(warnSpy: { mock: { calls: unknown[][] } }): unknown[][] {
  return warnSpy.mock.calls.filter(
    (c) => typeof c[1] === "string" && (c[1] as string).includes("tier-price"),
  );
}

beforeAll(async () => {
  await initTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  __resetPricingConfigCache();
  // Clear call history only — the real-validator default implementation
  // installed by the mock factory must survive every test.
  findTierPriceAnomaliesMock.mockClear();
});

describe("R167 (B3) — tier-price warnings on POST/PATCH (warn-first, additive, never blocking)", () => {
  it("a POST completing an equalized pair → 201 + warnings (Arabic equalized copy) + exactly one warn line", async () => {
    const token = await seedAdmin(["inventory"]);
    const productId = await seedProduct();
    await seedVariant(productId, { plan: "أساسي", duration: "شهر واحد", price: "100.00" });
    await seedVariant(productId, { plan: "بريميوم", duration: "شهر واحد", price: "200.00" });
    await seedVariant(productId, { plan: "بريميوم", duration: "سنة كاملة", price: "15980.00" });

    const { url, close } = await listen(buildApp());
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    try {
      // The Ahrefs shape: أساسي joins سنة كاملة at بريميوم's 15,980
      // while شهر واحد orders them 100 < 200 (the anchor).
      const res = await call(url, "POST", `/products/${productId}/variants`, token, {
        plan_label: "أساسي",
        duration_label: "سنة كاملة",
        cost_price: 10,
        price_lyd: 15980,
      });
      expect(res.status).toBe(201);
      // The write itself succeeded — full variant payload intact.
      expect(res.body).not.toBeNull();
      const body = res.body as Record<string, unknown>;
      expect(body).toMatchObject({
        product_id: productId,
        plan_label: "أساسي",
        duration_label: "سنة كاملة",
        price_lyd: 15980,
        is_active: true,
      });
      // The additive warnings field with the documented shape + copy.
      expect(body.warnings).toEqual([{ kind: "equalized", message: EQUALIZED_MESSAGE }]);

      // Exactly ONE warn-level line rides the offending write.
      const warnCalls = tierPriceWarnCalls(warnSpy);
      expect(warnCalls).toHaveLength(1);
      expect(warnCalls[0][0]).toMatchObject({ productId, variantId: body.id });
      expect(
        ((warnCalls[0][0] as { anomalies?: Array<{ kind: string }> }).anomalies ?? []).map(
          (a) => a.kind,
        ),
      ).toEqual(["equalized"]);
    } finally {
      warnSpy.mockRestore();
      close();
    }
  });

  it("a PATCH flipping the direction → 200 + warnings (Arabic inverted copy)", async () => {
    const token = await seedAdmin(["inventory"]);
    const productId = await seedProduct();
    await seedVariant(productId, { plan: "أساسي", duration: "شهر واحد", price: "100.00" });
    await seedVariant(productId, { plan: "بريميوم", duration: "شهر واحد", price: "200.00" });
    await seedVariant(productId, { plan: "أساسي", duration: "سنة كاملة", price: "500.00" });
    const premiumAnnual = await seedVariant(productId, {
      plan: "بريميوم",
      duration: "سنة كاملة",
      price: "900.00",
    });

    const { url, close } = await listen(buildApp());
    try {
      // Clean matrix (100 < 200 anchored at شهر واحد, 500 < 900) — the
      // patch inverts سنة كاملة: 500 > 300.
      const res = await call(
        url,
        "PATCH",
        `/products/${productId}/variants/${premiumAnnual.id}`,
        token,
        { price_lyd: 300 },
      );
      expect(res.status).toBe(200);
      expect(res.body).not.toBeNull();
      const body = res.body as Record<string, unknown>;
      expect(body).toMatchObject({ id: premiumAnnual.id, price_lyd: 300 });
      expect(body.warnings).toEqual([{ kind: "inverted", message: INVERTED_MESSAGE_500_300 }]);
    } finally {
      close();
    }
  });

  it("clean writes carry NO warnings field at all — the additive contract (incl. the tierless single-plan limit)", async () => {
    const token = await seedAdmin(["inventory"]);

    const { url, close } = await listen(buildApp());
    try {
      // First variant on an empty product — nothing to cross-check.
      const single = await seedProduct();
      const res = await call(url, "POST", `/products/${single}/variants`, token, {
        plan_label: "أساسي",
        duration_label: "شهر واحد",
        cost_price: 10,
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ plan_label: "أساسي", price_lyd: 200 });
      expect(res.body).not.toHaveProperty("warnings");

      // Tierless duration-only product (the Netflix live shape — plan
      // axis null): the validator skips planless rows by documented limit.
      const tierless = await seedProduct();
      await seedVariant(tierless, { plan: null, duration: "شهر واحد", price: "79.80" });
      await seedVariant(tierless, { plan: null, duration: "3 أشهر", price: "199.80" });
      const tierlessCreate = await call(url, "POST", `/products/${tierless}/variants`, token, {
        duration_label: "6 أشهر",
        cost_price: 30,
        price_lyd: 339.8,
      });
      expect(tierlessCreate.status).toBe(201);
      expect(tierlessCreate.body).not.toHaveProperty("warnings");

      // A strictly-ordered tier matrix (Disney+ shape) stays clean on PATCH.
      const ordered = await seedProduct();
      const basic = await seedVariant(ordered, {
        plan: "أساسي",
        duration: "شهر واحد",
        price: "79.80",
      });
      await seedVariant(ordered, { plan: "بريميوم", duration: "شهر واحد", price: "119.80" });
      await seedVariant(ordered, { plan: "أساسي", duration: "3 أشهر", price: "199.80" });
      await seedVariant(ordered, { plan: "بريميوم", duration: "3 أشهر", price: "299.80" });
      const orderedPatch = await call(
        url,
        "PATCH",
        `/products/${ordered}/variants/${basic.id}`,
        token,
        { price_lyd: 89.8 },
      );
      expect(orderedPatch.status).toBe(200);
      expect(orderedPatch.body).toMatchObject({ price_lyd: 89.8 });
      expect(orderedPatch.body).not.toHaveProperty("warnings");
    } finally {
      close();
    }
  });

  it("the sweep validates the ACTIVE matrix — a deactivated anomalous row does not warn; activating it does (deactivation = the documented silencer)", async () => {
    const token = await seedAdmin(["inventory"]);
    const productId = await seedProduct();
    await seedVariant(productId, { plan: "أساسي", duration: "شهر واحد", price: "100.00" });
    await seedVariant(productId, { plan: "بريميوم", duration: "شهر واحد", price: "200.00" });
    await seedVariant(productId, { plan: "أساسي", duration: "سنة كاملة", price: "500.00" });
    // INACTIVE: invisible to both the storefront and the sweep.
    const dormant = await seedVariant(productId, {
      plan: "بريميوم",
      duration: "سنة كاملة",
      price: "900.00",
      active: false,
    });

    const { url, close } = await listen(buildApp());
    try {
      // Editing the deactivated row: its price moves in the DB, but the
      // ACTIVE matrix still has أساسي alone at سنة كاملة → no warnings.
      const editDormant = await call(
        url,
        "PATCH",
        `/products/${productId}/variants/${dormant.id}`,
        token,
        { price_lyd: 400 },
      );
      expect(editDormant.status).toBe(200);
      expect(editDormant.body).not.toHaveProperty("warnings");

      // Activating it completes the anomalous matrix (anchor شهر واحد:
      // 100 < 200; سنة كاملة: 500 > 400 → inverted) → warnings appear.
      const activate = await call(
        url,
        "PATCH",
        `/products/${productId}/variants/${dormant.id}`,
        token,
        { is_active: true },
      );
      expect(activate.status).toBe(200);
      expect(activate.body).not.toBeNull();
      expect((activate.body as Record<string, unknown>).warnings).toEqual([
        { kind: "inverted", message: INVERTED_MESSAGE_500_400 },
      ]);
    } finally {
      close();
    }
  });

  it("a validator throw degrades to a logged warn line — the committed write still answers 201, no warnings field, and the real rule serves the next write", async () => {
    const token = await seedAdmin(["inventory"]);
    const productId = await seedProduct();
    await seedVariant(productId, { plan: "أساسي", duration: "شهر واحد", price: "100.00" });

    // The module-boundary mock (real by default) throws for the sweep's
    // next single call — proving the defensive wrap, never a 5xx.
    findTierPriceAnomaliesMock.mockImplementationOnce(() => {
      throw new Error("validator boom (R167 degradation pin)");
    });

    const { url, close } = await listen(buildApp());
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    try {
      const degraded = await call(url, "POST", `/products/${productId}/variants`, token, {
        plan_label: "بريميوم",
        duration_label: "شهر واحد",
        cost_price: 10,
      });
      expect(degraded.status).toBe(201);
      expect(degraded.body).toMatchObject({ plan_label: "بريميوم", price_lyd: 200 });
      expect(degraded.body).not.toHaveProperty("warnings");

      // The write committed — the sweep failure changed nothing.
      const rows = await db
        .select({ id: productVariantsTable.id })
        .from(productVariantsTable)
        .where(eq(productVariantsTable.productId, productId));
      expect(rows).toHaveLength(2);

      // The failure surfaced as exactly one warn line, not a 5xx.
      const warnCalls = tierPriceWarnCalls(warnSpy);
      expect(warnCalls).toHaveLength(1);
      expect(warnCalls[0][1]).toBe(
        "tier-price anomaly sweep failed (non-fatal — the variant write stays committed)",
      );

      // The next write runs the REAL rule again (clean set → clean body).
      const next = await call(url, "POST", `/products/${productId}/variants`, token, {
        plan_label: "بريميوم",
        duration_label: "سنة كاملة",
        cost_price: 10,
      });
      expect(next.status).toBe(201);
      expect(next.body).not.toHaveProperty("warnings");
      expect(tierPriceWarnCalls(warnSpy)).toHaveLength(1);
      expect(findTierPriceAnomaliesMock).toHaveBeenCalledTimes(2);
    } finally {
      warnSpy.mockRestore();
      close();
    }
  });
});
