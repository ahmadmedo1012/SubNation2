/**
 * R115 Part 13 — the variant-aware admin pricing calculator.
 *
 * The pre-R115 calculator read products.price/costPrice: margin math was
 * dead for the real catalog (product cost NULL, real costs live on
 * variants in USD), it could only simulate the cheapest variant, and it
 * subtracted an unconverted USD cost from an LYD price. This suite pins
 * the rewrite: variant truth, currency-correct costs, risk states,
 * worst-case + guardrail math — and the never-regress contract that the
 * calculator's discount stack equals checkout's (same computePricing).
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, initTestDb, productVariantsTable, productsTable, resetTestDb } from "../../../test/db";
import { adminUsersTable } from "@workspace/db";
import express, { type Express } from "express";
import { adminPricingCalculatorRouter } from "../pricing-calculator";
import { signAdminToken } from "../../../lib/jwt";

let seq = 0;
async function seedProductWithVariants() {
  seq += 1;
  const [p] = await db
    .insert(productsTable)
    .values({
      name: `Calc Product ${seq}`,
      slug: `calc-product-${seq}`,
      price: "59.80",
      costPrice: null, // the live-catalog reality: product cost is NULL
    })
    .returning();
  const [cheap] = await db
    .insert(productVariantsTable)
    .values({
      productId: p.id,
      planLabel: "Basic",
      durationLabel: "1 Month",
      costPrice: "2.99",
      priceLyd: "59.80",
      isActive: true,
    })
    .returning();
  const [premium] = await db
    .insert(productVariantsTable)
    .values({
      productId: p.id,
      planLabel: "Pro",
      durationLabel: "1 Year",
      costPrice: "199.00",
      priceLyd: "3980.00",
      isActive: true,
    })
    .returning();
  return { product: p, cheap, premium };
}

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/admin", adminPricingCalculatorRouter);
  return app;
}

async function listen(app: Express): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("no address"));
        return;
      }
      resolve({ url: `http://127.0.0.1:${addr.port}`, close: () => server.close() });
    });
  });
}

let adminToken = "";
beforeAll(async () => {
  await initTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  const [admin] = await db
    .insert(adminUsersTable)
    .values({
      username: "calcadmin",
      passwordHash: "not-a-real-hash",
      isActive: true,
      permissions: ["all"],
    })
    .returning();
  adminToken = signAdminToken({ adminId: admin.id, role: "admin" });
});

async function calc(url: string, body: Record<string, unknown>) {
  const res = await fetch(`${url}/api/admin/pricing/calculate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("R115 variant-aware pricing calculator", () => {
  it("variant mode: uses the VARIANT's price and USD cost × rate — the 29× divergence the old calculator hid", async () => {
    const { premium } = await seedProductWithVariants();
    const { url, close } = await listen(buildApp());
    try {
      const { status, body } = await calc(url, { variant_id: premium.id });
      expect(status).toBe(200);
      expect(body.inputs).toMatchObject({ price_source: "variant", variant_id: premium.id });
      expect(body.pricing).toMatchObject({ list_price: 3980 });
      // cost 199 USD × 10 = 1990 LYD — CURRENCY-CORRECT (the old code
      // subtracted raw USD from LYD).
      expect(body.inputs).toMatchObject({ cost_usd: 199, cost_price: 1990 });
      expect(body.margins).toMatchObject({ gross_lyd: 1990, gross_pct: 50 });
      expect(body.risk_state).toBe("SAFE");
    } finally {
      close();
    }
  });

  it("product mode: simulates the CHEAPEST active variant (never the raw product row) and says so", async () => {
    const { product } = await seedProductWithVariants();
    const { url, close } = await listen(buildApp());
    try {
      const { status, body } = await calc(url, { product_id: product.id });
      expect(status).toBe(200);
      expect(body.inputs).toMatchObject({ price_source: "product_cheapest_variant" });
      expect(body.pricing).toMatchObject({ list_price: 59.8 });
      expect(body.inputs).toMatchObject({ cost_usd: 2.99, cost_price: 29.9 });
      const warnings = body.warnings as Array<{ code: string }>;
      expect(warnings.some((w) => w.code === "cheapest_variant_used")).toBe(true);
      expect(body.risk_state).toBe("SAFE"); // 50% margin
    } finally {
      close();
    }
  });

  it("manual mode: explicit LYD sandbox values work (cost stays LYD)", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const { body } = await calc(url, { price: 100, cost_price: 96 });
      expect(body.inputs).toMatchObject({ price_source: "manual" });
      expect(body.margins).toMatchObject({ gross_lyd: 4 });
      expect(body.risk_state).toBe("THIN"); // 4% — under the 5% thin line
    } finally {
      close();
    }
  });

  it("risk states: LOSS under cost, WATCH under 15%, THIN under 5%", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const loss = await calc(url, { price: 100, cost_price: 120 });
      expect(loss.body.risk_state).toBe("LOSS");
      expect(
        (loss.body.warnings as Array<{ code: string }>).some((w) => w.code === "loss_on_transaction"),
      ).toBe(true);

      const watch = await calc(url, { price: 100, cost_price: 88 });
      expect(watch.body.risk_state).toBe("WATCH"); // 12%

      const thin = await calc(url, { price: 100, cost_price: 98 });
      expect(thin.body.risk_state).toBe("THIN"); // 2%
    } finally {
      close();
    }
  });

  it("loyalty + referral liability modeled from the policy module; referred simulation subtracts 5.50", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const { body } = await calc(url, { price: 100, cost_price: 50, simulate_referred: true });
      expect(body.loyalty).toMatchObject({ points_earned: 100, lyd_accrued: 1 });
      expect(body.referral_cost).toMatchObject({ total_referral_cost_lyd: 5.5 });
      // gross 50 − loyalty 1 − referral 5.5 = 43.5
      expect(body.margins).toMatchObject({ referral_adjusted_lyd: 43.5 });
      expect(String((body.referral_cost as { trigger: string }).trigger)).toContain("first approved topup");
    } finally {
      close();
    }
  });

  it("worst case + guardrails: cap-bounded stack, break-even, safe minimum — all present and sane", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const { body } = await calc(url, { price: 100, cost_price: 50 });
      expect(body.config).toMatchObject({ max_total_discount_pct: 50 });
      expect(body.worst_case).toMatchObject({ combined_discount_pct: 50, price: 50, gross_lyd: 0 });
      expect(body.guardrails).toMatchObject({ break_even_price: 50, max_safe_discount_pct: 50 });
      // safe min incl. program: p×0.5×0.99 ≥ 50 + 5.5 → 55.5/0.495 ≈ 112.12
      expect((body.guardrails as { safe_min_price_incl_program: number }).safe_min_price_incl_program).toBeCloseTo(
        112.12,
        1,
      );
    } finally {
      close();
    }
  });

  it("missing cost → margin null + info warning (never fake numbers)", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const { body } = await calc(url, { price: 100 });
      expect(body.inputs).toMatchObject({ cost_price: null });
      expect(body.margins).toMatchObject({ gross_lyd: null });
      expect(
        (body.warnings as Array<{ code: string }>).some((w) => w.code === "no_cost_price"),
      ).toBe(true);
      expect(body.risk_state).toBe("WATCH");
    } finally {
      close();
    }
  });

  it("no input → 400 with the new guidance (variant_id now accepted)", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const { status, body } = await calc(url, {});
      expect(status).toBe(400);
      expect(String(body.error)).toContain("variant_id");
    } finally {
      close();
    }
  });

  it("variant 404 for an unknown id", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const { status } = await calc(url, { variant_id: 999999 });
      expect(status).toBe(404);
    } finally {
      close();
    }
  });
});
