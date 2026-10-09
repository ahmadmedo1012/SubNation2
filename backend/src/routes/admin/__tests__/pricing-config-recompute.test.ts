import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import { eq } from "drizzle-orm";
import {
  adminUsersTable,
  auditLogsTable,
  db,
  execTestSql,
  initTestDb,
  productVariantsTable,
  productsTable,
  resetTestDb,
  systemSettingsTable,
} from "../../../test/db";
import { createAdminSession } from "../../../lib/admin-session";
import { __resetPricingConfigCache } from "../../../lib/pricing-config";
import { adminPricingConfigRouter } from "../pricing-config";

/**
 * R118-A5 TOP-20 #1 [P1] — POST /api/admin/pricing/recompute.
 *
 * The bulk price-rewrite endpoint had ZERO tests (A5 G-1): one confirmed
 * tap rewrites every active variant's price_lyd via the current rule and
 * refreshes every product's display price — the largest single-statement
 * money surface in the admin. The frontend dry-run/confirm UX is tested
 * only against a stubbed fetch (A5 W-5), so this suite pins the HTTP
 * contract on the backend side:
 *
 *   1. drifted variants are rewritten to computeRetailLYD(cost, rule)
 *      and products.price is refreshed to MIN(active variant price);
 *   2. re-running after success is a no-op (variants_updated: 0 — the
 *      idempotence claim at routes/admin/pricing-config.ts:104-106);
 *   3. dry_run=true previews counts + a before→after sample and writes
 *      ZERO rows (R115 Part 15);
 *   4. the audit row carries per-variant before/after values (R115:
 *      the recovery trail — the old prices are otherwise unrecoverable).
 *
 * Engine math (lib/pricing-config defaults): 1 USD = 10 LYD, markup 100%
 * ⇒ price_lyd = cost × 2 × 10 = cost × 20.
 *
 * Harness: real adminPricingConfigRouter + requireAdmin over the pglite
 * fixture DB (same shape as admin-risk-config.test.ts). The pricing
 * config cache (60 s TTL) is dropped per test so each scenario re-sees
 * the truncated system_settings table.
 */

function buildApp(): Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/admin", adminPricingConfigRouter);
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

let adminToken: string;

async function seedAdmin(): Promise<void> {
  const [a] = await db
    .insert(adminUsersTable)
    .values({ username: "pricing_admin", passwordHash: "x", isActive: true })
    .returning();
  const { token } = await createAdminSession({ adminId: a.id, role: "admin" });
  adminToken = token;
}

/** product + two variants. `drifted` overrides v1's stored price (engine: 200). */
async function seedProductPair(
  name: string,
  v1: { cost: string; stored: string },
  v2: { cost: string; stored: string },
  productPrice: string,
): Promise<{ productId: number; v1Id: number; v2Id: number }> {
  const [p] = await db
    .insert(productsTable)
    .values({ name, price: productPrice, isActive: true })
    .returning();
  const [variant1] = await db
    .insert(productVariantsTable)
    .values({
      productId: p.id,
      planLabel: "Family",
      durationLabel: "شهر واحد",
      costPrice: v1.cost,
      priceLyd: v1.stored,
      sortOrder: 0,
    })
    .returning();
  const [variant2] = await db
    .insert(productVariantsTable)
    .values({
      productId: p.id,
      planLabel: "Family",
      durationLabel: "سنة كاملة",
      costPrice: v2.cost,
      priceLyd: v2.stored,
      sortOrder: 1,
    })
    .returning();
  return { productId: p.id, v1Id: variant1.id, v2Id: variant2.id };
}

/**
 * Product A carries ONE drifted variant (cost 10 ⇒ engine 200, stored 250)
 * plus an in-engine variant (cost 20 ⇒ 400), display price parked at 400.
 * Product B is fully in-engine (cost 1 ⇒ 20, cost 2 ⇒ 40, display 20) —
 * the "nothing to do" half of the catalog.
 */
async function seedCatalog(): Promise<{
  productA: { productId: number; v1Id: number; v2Id: number };
  productB: { productId: number; v1Id: number; v2Id: number };
}> {
  const productA = await seedProductPair(
    "Drifted Product",
    { cost: "10.00", stored: "250.00" },
    { cost: "20.00", stored: "400.00" },
    "400.00",
  );
  const productB = await seedProductPair(
    "Clean Product",
    { cost: "1.00", stored: "20.00" },
    { cost: "2.00", stored: "40.00" },
    "20.00",
  );
  return { productA, productB };
}

async function recompute(
  url: string,
  dryRun = false,
): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  const res = await fetch(`${url}/api/admin/pricing/recompute${dryRun ? "?dry_run=true" : ""}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

async function variantRow(id: number) {
  const [row] = await db
    .select()
    .from(productVariantsTable)
    .where(eq(productVariantsTable.id, id))
    .limit(1);
  return row;
}

async function productRow(id: number) {
  const [row] = await db.select().from(productsTable).where(eq(productsTable.id, id)).limit(1);
  return row;
}

beforeAll(async () => {
  await initTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  __resetPricingConfigCache();
  await seedAdmin();
});

describe("POST /api/admin/pricing/recompute — bulk price rewrite (R118-A5 #1)", () => {
  it("rewrites a drifted variant to computeRetailLYD and refreshes product price = MIN(active variants)", async () => {
    const { productA, productB } = await seedCatalog();
    const { url, close } = await listen(buildApp());
    try {
      const res = await recompute(url);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ variants_updated: 1, products_updated: 1 });

      // The drifted variant is corrected to the engine output (10 × 2 × 10)…
      const v1 = await variantRow(productA.v1Id);
      expect(String(v1.priceLyd)).toBe("200.00");
      // …cost is untouched (recompute only moves price_lyd)…
      expect(String(v1.costPrice)).toBe("10.00");
      // …and the in-engine variants on BOTH products are left alone.
      expect(String((await variantRow(productA.v2Id)).priceLyd)).toBe("400.00");
      expect(String((await variantRow(productB.v1Id)).priceLyd)).toBe("20.00");
      expect(String((await variantRow(productB.v2Id)).priceLyd)).toBe("40.00");

      // Display prices refresh to MIN(active variant price): product A's
      // min drops 400 → 200 (counted); product B was already at its min.
      expect(String((await productRow(productA.productId)).price)).toBe("200.00");
      expect(String((await productRow(productB.productId)).price)).toBe("20.00");
    } finally {
      close();
    }
  });

  it("re-running after success is a no-op (variants_updated: 0, rows unchanged)", async () => {
    const { productA } = await seedCatalog();
    const { url, close } = await listen(buildApp());
    try {
      const first = await recompute(url);
      expect(first.body).toMatchObject({ variants_updated: 1 });

      const second = await recompute(url);
      expect(second.status).toBe(200);
      expect(second.body).toMatchObject({ variants_updated: 0, products_updated: 0 });

      // Nothing moved on the second pass.
      expect(String((await variantRow(productA.v1Id)).priceLyd)).toBe("200.00");
      expect(String((await productRow(productA.productId)).price)).toBe("200.00");
    } finally {
      close();
    }
  });

  it("dry_run=true returns counts + a before→after sample and writes ZERO rows", async () => {
    const { productA, productB } = await seedCatalog();
    const { url, close } = await listen(buildApp());
    try {
      const res = await recompute(url, true);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        dry_run: true,
        variants_drifted: 1,
        products_affected: 1,
        usd_to_lyd: 10,
        markup_percent: 100,
      });

      const sample = res.body.sample as Array<Record<string, unknown>>;
      expect(sample).toHaveLength(1);
      expect(sample[0]).toMatchObject({
        variant_id: productA.v1Id,
        product_id: productA.productId,
        price_before: 250,
        price_after: 200,
        delta: -50,
      });

      // ZERO rows written: the drifted variant + display prices are intact.
      expect(String((await variantRow(productA.v1Id)).priceLyd)).toBe("250.00");
      expect(String((await productRow(productA.productId)).price)).toBe("400.00");
      expect(String((await productRow(productB.productId)).price)).toBe("20.00");
      // No settings rows were invented by the preview either.
      const settings = await db.select().from(systemSettingsTable);
      expect(settings).toHaveLength(0);
      // …and no audit row for a preview.
      const audits = await db
        .select({ id: auditLogsTable.id })
        .from(auditLogsTable)
        .where(eq(auditLogsTable.action, "pricing.recompute"));
      expect(audits).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("the audit row carries per-variant before/after values (A5 P1-1 recovery trail)", async () => {
    const { productA } = await seedCatalog();
    const { url, close } = await listen(buildApp());
    try {
      await recompute(url);

      const audits = await db
        .select()
        .from(auditLogsTable)
        .where(eq(auditLogsTable.action, "pricing.recompute"));
      expect(audits).toHaveLength(1);
      const meta = JSON.parse(audits[0].metadata as string) as Record<string, unknown>;
      expect(meta).toMatchObject({ variants_updated: 1, products_updated: 1 });
      const changes = meta.changes as Array<Record<string, unknown>>;
      expect(changes).toHaveLength(1);
      expect(changes[0]).toEqual({
        variant_id: productA.v1Id,
        before: 250,
        after: 200,
      });
    } finally {
      close();
    }
  });

  it("unauthenticated POST → 401 (requireAdmin in front of the bulk write)", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const res = await fetch(`${url}/api/admin/pricing/recompute`, { method: "POST" });
      expect(res.status).toBe(401);
    } finally {
      close();
    }
  });
});

// ── R125-I6 (A8 B-3): transactional recompute — mid-failure rollback pins ────
//
// The per-variant UPDATE loop + the products.price refresh now ride ONE
// db.transaction. Both pins inject a REAL mid-transaction failure at the
// Postgres level (a trigger that raises) — no mocks, so the assertion
// covers the actual BEGIN/ROLLBACK semantics of the route:
//
//   1. the 2nd variant UPDATE raises  → variant #1's already-applied
//      write must roll back with it (previously: mixed prices persisted,
//      no audit, no cache bump — shopper-visible MIN() drift);
//   2. the products.price refresh raises AFTER the whole loop finished →
//      every variant write must roll back too.
//
// Trigger + counter table live only in this file's pglite instance; both
// are torn down after each scenario (the counter is reset, the trigger
// dropped) so the earlier scenarios stay independent.
describe("POST /api/admin/pricing/recompute — atomicity (R125-I6, A8 B-3)", () => {
  const INJECT_TABLE = `
    CREATE TABLE IF NOT EXISTS recompute_inject (n integer NOT NULL DEFAULT 0);
    TRUNCATE recompute_inject;
    INSERT INTO recompute_inject DEFAULT VALUES;
  `;

  async function armVariantTrigger(): Promise<void> {
    // execTestSql, not db.execute — the harness's prepared-query path
    // rejects multi-statement strings (the round-94 C5 rule).
    await execTestSql(`
      CREATE OR REPLACE FUNCTION recompute_fail_on_second() RETURNS trigger AS $$
      BEGIN
        UPDATE recompute_inject SET n = n + 1;
        IF (SELECT n FROM recompute_inject LIMIT 1) >= 2 THEN
          RAISE EXCEPTION 'injected mid-recompute failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS trg_recompute_inject ON product_variants;
      CREATE TRIGGER trg_recompute_inject BEFORE UPDATE ON product_variants
        FOR EACH ROW EXECUTE FUNCTION recompute_fail_on_second();
    `);
  }

  async function armProductTrigger(): Promise<void> {
    await execTestSql(`
      CREATE OR REPLACE FUNCTION recompute_fail_on_product_price() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'injected products-price failure';
      END;
      $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS trg_recompute_products ON products;
      CREATE TRIGGER trg_recompute_products BEFORE UPDATE ON products
        FOR EACH ROW EXECUTE FUNCTION recompute_fail_on_product_price();
    `);
  }

  async function disarmTriggers(): Promise<void> {
    await execTestSql(`
      DROP TRIGGER IF EXISTS trg_recompute_inject ON product_variants;
      DROP TRIGGER IF EXISTS trg_recompute_products ON products;
    `);
  }

  /** Raw fetch — the injected failures surface as the express default
   * error handler's HTML 500 (no JSON envelope), which the shared
   * `recompute` helper would choke parsing. Status + body text only. */
  async function recomputeRaw(url: string): Promise<{ status: number; text: string }> {
    const res = await fetch(`${url}/api/admin/pricing/recompute`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    return { status: res.status, text: await res.text() };
  }

  it("a mid-loop variant failure rolls back EVERY variant write (no mixed prices)", async () => {
    // Two drifted variants (stored 250/500 vs engine 200/1000) on two
    // products — whichever order the loop visits them, the second UPDATE
    // raises and the first must not survive.
    const { productA } = await seedCatalog();
    const second = await seedProductPair(
      "Second Drifted Product",
      { cost: "50.00", stored: "500.00" },
      { cost: "60.00", stored: "600.00" },
      "500.00",
    );
    const { url, close } = await listen(buildApp());
    try {
      await execTestSql(INJECT_TABLE);
      await armVariantTrigger();

      const res = await recomputeRaw(url);
      expect(res.status).toBe(500);
      // (pglite's drizzle layer wraps the trigger's RAISE in a "Failed
      // query" message, so only the status + DB state are asserted.)

      // BOTH drifted variants keep their OLD prices — the update that
      // succeeded before the raise is rolled back with the failed one.
      expect(String((await variantRow(productA.v1Id)).priceLyd)).toBe("250.00");
      expect(String((await variantRow(second.v1Id)).priceLyd)).toBe("500.00");
      // Neither product's display price moved (the refresh never ran).
      expect(String((await productRow(productA.productId)).price)).toBe("400.00");
      expect(String((await productRow(second.productId)).price)).toBe("500.00");

      // No audit row for a rolled-back recompute.
      const audits = await db
        .select({ id: auditLogsTable.id })
        .from(auditLogsTable)
        .where(eq(auditLogsTable.action, "pricing.recompute"));
      expect(audits).toHaveLength(0);
    } finally {
      await disarmTriggers();
      close();
    }
  });

  it("a failure in the products.price refresh (after the loop) rolls the variant writes back too", async () => {
    const { productA } = await seedCatalog();
    const { url, close } = await listen(buildApp());
    try {
      await armProductTrigger();

      const res = await recomputeRaw(url);
      expect(res.status).toBe(500);
      // (same pglite wrapper note as the mid-loop scenario)

      // The loop finished (variant updated to the engine price inside the
      // tx), but the display-price refresh raised — the variant write must
      // roll back with the transaction, leaving NO mixed state.
      expect(String((await variantRow(productA.v1Id)).priceLyd)).toBe("250.00");
      expect(String((await productRow(productA.productId)).price)).toBe("400.00");

      const audits = await db
        .select({ id: auditLogsTable.id })
        .from(auditLogsTable)
        .where(eq(auditLogsTable.action, "pricing.recompute"));
      expect(audits).toHaveLength(0);
    } finally {
      await disarmTriggers();
      close();
    }
  });
});
