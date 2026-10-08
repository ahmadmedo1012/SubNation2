import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import {
  couponsTable,
  db,
  flashSalesTable,
  initTestDb,
  resetTestDb,
  usersTable,
} from "../../test/db";
import { signUserToken } from "../../lib/jwt";
import { totalDiscountCapMessage } from "../../lib/pricing";
import { couponsRouter } from "../coupons";

/**
 * R123 (E1, test battery) — POST /api/coupons/validate: the FULL branch
 * matrix of the checkout coupon pre-flight, including the R123-E1
 * combined-cap parity fix.
 *
 * Before R123-E1 the endpoint computed the coupon in isolation from
 * (code, order_amount) and never evaluated the R115 combined cap
 * (pricing.max_total_discount_pct, enforced only in lib/pricing's
 * resolveCoupon at checkout): an active flash sale + coupon crossing
 * the cap validated GREEN here — the money screen confirmed a total —
 * and checkout then refused the purchase with total_discount_cap. The
 * route now resolves the active flash sale itself (the client sends
 * the EFFECTIVE price, sale_price ?? price — openapi
 * ValidateCouponBody), reconstructs the list price, and runs the SAME
 * shared evaluation (lib/pricing.evaluateTotalDiscountCap +
 * totalDiscountCapMessage) checkout uses.
 *
 * Branches pinned: unknown code (404 NOT_FOUND) · inactive · expired ·
 * max-uses-reached · below-min-order · full-coverage (all 400
 * INVALID_DATA) · happy path (lowercase→UPPERCASE + exact math) ·
 * flash+coupon crossing the cap (400, the shared cap message) ·
 * flash+coupon UNDER the cap (still valid, honest math) · coupon-alone
 * over the cap with no flash (400 — checkout refuses it too).
 *
 * The router is mounted on a real Express app and exercised via fetch
 * (wallet-topups.test.ts idiom). The couponValidateLimiter lives in
 * app.ts, NOT on the router — mounting the router alone keeps these
 * calls unthrottled. The opportunistic coupon sweep
 * (fireThrottledMaintenance at the handler top) is fire-and-forget and
 * idempotent; the expired-case assertion is deliberately message-
 * agnostic because the sweep may flip is_active first (both are 400
 * INVALID_DATA).
 */

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/coupons", couponsRouter);
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

async function validate(
  url: string,
  token: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${url}/api/coupons/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `auth_token=${token}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

async function seedCoupon(
  // Repo idiom (refund-coupon-slot.test.ts): Partial overrides — but the
  // insert requires code+value, so they are pinned in the parameter type.
  values: Omit<Partial<typeof couponsTable.$inferInsert>, "value"> & {
    code: string;
    value: string;
  },
): Promise<void> {
  await db.insert(couponsTable).values(values);
}

async function seedActiveFlashSale(discountPercent: string): Promise<void> {
  // At most one ACTIVE row can exist (uniq_flash_sales_active_singleton
  // in production; resetTestDb clears flash_sales between tests).
  await db.insert(flashSalesTable).values({
    title: "Matrix flash",
    discountPercent,
    endsAt: new Date(Date.now() + 3_600_000),
    isActive: true,
  });
}

let phoneSeq = 92_000_000;
function nextPhone(): string {
  phoneSeq += 1;
  return String(phoneSeq);
}

let cachedToken: string | null = null;
async function userToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  const [u] = await db.insert(usersTable).values({ phone: nextPhone() }).returning();
  cachedToken = signUserToken({ userId: u.id });
  return cachedToken;
}

const app = buildApp();

beforeAll(async () => {
  await initTestDb();
});
beforeEach(async () => {
  await resetTestDb();
  cachedToken = null;
});

describe("POST /api/coupons/validate — the rejection matrix (all INVALID_DATA except 404)", () => {
  it("an unknown code → 404 NOT_FOUND", async () => {
    const { url, close } = await listen(app);
    try {
      const res = await validate(url, await userToken(), { code: "NOSUCH", order_amount: 59.8 });
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ code: "NOT_FOUND" });
    } finally {
      close();
    }
  });

  it("an inactive coupon → 400 INVALID_DATA", async () => {
    await seedCoupon({ code: "OFF10", type: "percentage", value: "10", isActive: false });
    const { url, close } = await listen(app);
    try {
      const res = await validate(url, await userToken(), { code: "OFF10", order_amount: 59.8 });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: "INVALID_DATA" });
    } finally {
      close();
    }
  });

  it("an expired coupon → 400 INVALID_DATA (the handler's own expiry gate)", async () => {
    await seedCoupon({
      code: "OLD10",
      type: "percentage",
      value: "10",
      isActive: true,
      expiresAt: new Date(Date.now() - 3_600_000),
    });
    const { url, close } = await listen(app);
    try {
      const res = await validate(url, await userToken(), { code: "OLD10", order_amount: 59.8 });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: "INVALID_DATA" });
    } finally {
      close();
    }
  });

  it("a maxed-out coupon (used_count >= max_uses) → 400 INVALID_DATA", async () => {
    await seedCoupon({
      code: "MAX10",
      type: "percentage",
      value: "10",
      isActive: true,
      maxUses: 2,
      usedCount: 2,
    });
    const { url, close } = await listen(app);
    try {
      const res = await validate(url, await userToken(), { code: "MAX10", order_amount: 59.8 });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: "INVALID_DATA" });
    } finally {
      close();
    }
  });

  it("an order below min_order_amount → 400 INVALID_DATA (min expressed in the message)", async () => {
    await seedCoupon({
      code: "MIN30",
      type: "percentage",
      value: "10",
      isActive: true,
      minOrderAmount: "30.00",
    });
    const { url, close } = await listen(app);
    try {
      const res = await validate(url, await userToken(), { code: "MIN30", order_amount: 25 });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: "INVALID_DATA" });
      expect(String(res.body.error)).toContain("30.00");
    } finally {
      close();
    }
  });

  it("a full-coverage fixed coupon (final would be 0) → 400 INVALID_DATA, never valid:true final 0", async () => {
    await seedCoupon({ code: "FULL50", type: "fixed", value: "50", isActive: true });
    const { url, close } = await listen(app);
    try {
      const res = await validate(url, await userToken(), { code: "FULL50", order_amount: 50 });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: "INVALID_DATA" });
    } finally {
      close();
    }
  });
});

describe("POST /api/coupons/validate — happy path (exact math, uppercase lookup)", () => {
  it("a lowercase code resolves the UPPERCASE row and returns the exact discount/final math", async () => {
    await seedCoupon({
      code: "SAVE10",
      type: "percentage",
      value: "10",
      isActive: true,
      description: "استقبال",
    });
    const { url, close } = await listen(app);
    try {
      const res = await validate(url, await userToken(), { code: "save10", order_amount: 59.8 });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        valid: true,
        code: "SAVE10", // the STORED row code — lookup uppercased the input
        type: "percentage",
        value: 10,
        discount_amount: 5.98,
        final_amount: 53.82,
        description: "استقبال",
      });
    } finally {
      close();
    }
  });
});

describe("R123 (E1): /validate applies the R115 combined cap — checkout parity", () => {
  it("flash 45% + coupon 10% crossing the 50% cap → 400 with the SAME message checkout refuses with", async () => {
    // The audit trigger: list 59.80, flash 45% → effective 32.89 (what
    // the client sends — sale_price ?? price); coupon 10% of 32.89 =
    // 3.29; combined = 45 + (3.29 / 59.80)×100 = 50.5% > 50.
    await seedActiveFlashSale("45");
    await seedCoupon({ code: "SAVE10", type: "percentage", value: "10", isActive: true });
    const { url, close } = await listen(app);
    try {
      const res = await validate(url, await userToken(), { code: "SAVE10", order_amount: 32.89 });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: "INVALID_DATA" });
      // The message IS the shared totalDiscountCapMessage — the exact
      // text lib/pricing's resolveCoupon returns as reasonAr (what
      // checkout surfaces), so validate and checkout can never disagree
      // on the WHY either.
      const combinedPct = 45 + (3.29 / 59.8) * 100;
      expect(res.body.error).toBe(totalDiscountCapMessage(combinedPct, 50));
      expect(String(res.body.error)).toContain("50%");
    } finally {
      close();
    }
  });

  it("flash + coupon UNDER the cap still validates green with the honest stacked math", async () => {
    // list 59.80, flash 30% → effective 41.86; coupon 10% of 41.86 =
    // 4.19; combined = 30 + 7.0 = 37% < 50 → valid, and the response
    // quotes the coupon-against-EFFECTIVE-price math checkout charges.
    await seedActiveFlashSale("30");
    await seedCoupon({ code: "SAVE10", type: "percentage", value: "10", isActive: true });
    const { url, close } = await listen(app);
    try {
      const res = await validate(url, await userToken(), { code: "SAVE10", order_amount: 41.86 });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        valid: true,
        discount_amount: 4.19,
        final_amount: 37.67,
      });
    } finally {
      close();
    }
  });

  it("a coupon ALONE over the cap (no flash) → 400 — checkout refuses it with total_discount_cap too", async () => {
    // 60% off with cap 50: combined = 0 + 60 = 60% > 50. Pre-R123 this
    // validated green; checkout rejected it — the same divergence class
    // the flash case exposes, closed by the shared evaluation.
    await seedCoupon({ code: "BIG60", type: "percentage", value: "60", isActive: true });
    const { url, close } = await listen(app);
    try {
      const res = await validate(url, await userToken(), { code: "BIG60", order_amount: 59.8 });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: "INVALID_DATA" });
      expect(res.body.error).toBe(totalDiscountCapMessage(60, 50));
    } finally {
      close();
    }
  });

  it("an EXPIRED flash sale does not engage the cap (stale sale rows are inert)", async () => {
    // Expired-but-active sale rows are filtered by ends_at > now in the
    // shared lookup — the effective price the client sends is then the
    // list price, and a 10% coupon validates exactly as the no-flash
    // happy path.
    await db.insert(flashSalesTable).values({
      title: "Expired flash",
      discountPercent: "45",
      endsAt: new Date(Date.now() - 3_600_000),
      isActive: true,
    });
    await seedCoupon({ code: "SAVE10", type: "percentage", value: "10", isActive: true });
    const { url, close } = await listen(app);
    try {
      const res = await validate(url, await userToken(), { code: "SAVE10", order_amount: 59.8 });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ valid: true, discount_amount: 5.98, final_amount: 53.82 });
    } finally {
      close();
    }
  });
});
