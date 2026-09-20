import express from "express";
import cookieParser from "cookie-parser";
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import {
  db,
  initTestDb,
  resetTestDb,
  referralEventsTable,
  usersTable,
  walletLedgerTable,
} from "../../test/db";
import { signUserToken } from "../../lib/jwt";
import { loyaltyRouter } from "../loyalty";
import { POINTS_PER_LYD, TIER_THRESHOLDS } from "../../lib/loyalty-tiers";

/**
 * Integration tests for the loyalty API (r4-2d / testing-audit gap #1).
 * The loyalty router is mounted at `/api/loyalty` on a fresh Express app
 * and exercised via real `fetch` calls — identical pattern to
 * routes/__tests__/cart.test.ts.
 *
 * convert-points is a direct wallet-mutation endpoint that had ZERO tests
 * before this file. These pin the strict input contract (the old
 * `parseInt` type-laundering is now 400), the business rules
 * (minimum / multiple / in-tx sufficiency), the ledger parity row
 * (Constitution §I) and the GET / summary shape.
 */

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/loyalty", loyaltyRouter);
  return app;
}

// Round-1 P3: deterministic phone seeding (no Math.random — unique-phone
// collisions made suites flaky). TRUNCATE-per-test makes these unique
// anyway; the counter guards even without a reset.
let phoneSeq = 91_200_000;
function nextPhone(): string {
  phoneSeq += 1;
  return String(phoneSeq);
}

async function seedUser(
  overrides: Partial<{
    phone: string;
    walletBalance: string;
    loyaltyPoints: number;
    lifetimeSpend: string;
  }> = {},
) {
  const [u] = await db
    .insert(usersTable)
    .values({
      phone: overrides.phone ?? nextPhone(),
      walletBalance: overrides.walletBalance ?? "0.00",
      loyaltyPoints: overrides.loyaltyPoints ?? 0,
      lifetimeSpend: overrides.lifetimeSpend ?? "0.00",
    })
    .returning();
  return u;
}

async function seedReferee(referrerId: number, status: "credited" | "pending") {
  const referee = await seedUser();
  const [event] = await db
    .insert(referralEventsTable)
    .values({
      referrerId,
      refereeId: referee.id,
      status,
      creditedAt: status === "credited" ? new Date() : null,
    })
    .returning();
  return event;
}

interface ApiOk<T = unknown> {
  status: number;
  body: T;
}

async function call<T = unknown>(
  app: express.Express,
  method: "GET" | "POST",
  path: string,
  opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<ApiOk<T>> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("no address"));
        return;
      }
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (opts.token) headers.Cookie = `auth_token=${opts.token}`;
        Object.assign(headers, opts.headers ?? {});
        const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
          method,
          headers,
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        });
        const text = await res.text();
        const body = text ? (JSON.parse(text) as unknown) : null;
        resolve({ status: res.status, body: body as T });
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

const app = buildApp();

beforeAll(async () => {
  await initTestDb();
});

beforeEach(async () => {
  await resetTestDb();
});

describe("POST /api/loyalty/convert-points — strict input validation", () => {
  // The old `parseInt(points)` accepted all of these shapes and laundered
  // them into spendable numbers (["100"] → 100, "0x64" → 100, …). The
  // strict contract: a finite integer number, or a 1-9 digit decimal
  // string — anything else is 400 INVALID_DATA.
  const invalidBodies: Array<[string, unknown]> = [
    ["missing points field", {}],
    ["array value (['100'])", { points: ["100"] }],
    ["hex string ('0x64')", { points: "0x64" }],
    ["scientific notation ('1e2')", { points: "1e2" }],
    ["float number (100.9)", { points: 100.9 }],
    ["non-numeric string ('abc')", { points: "abc" }],
    ["object value", { points: { value: 100 } }],
    ["boolean value", { points: true }],
    ["10-digit string (too long)", { points: "1234567890" }],
    ["null value", { points: null }],
  ];

  it.each(invalidBodies)("rejects %s with 400 INVALID_DATA", async (_label, body) => {
    const user = await seedUser({ loyaltyPoints: 1000 });
    const token = signUserToken({ userId: user.id });
    const res = await call<{ error: string; code: string }>(
      app,
      "POST",
      "/api/loyalty/convert-points",
      {
        token,
        body,
      },
    );
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_DATA");
  });

  it("rejects a negative integer with 400 — passes the type gate, fails the minimum rule", async () => {
    const user = await seedUser({ loyaltyPoints: 1000 });
    const token = signUserToken({ userId: user.id });
    const res = await call<{ code: string }>(app, "POST", "/api/loyalty/convert-points", {
      token,
      body: { points: -100 },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_DATA");
  });

  it("rejects an unauthenticated request with 401", async () => {
    const res = await call(app, "POST", "/api/loyalty/convert-points", {
      body: { points: 100 },
    });
    expect(res.status).toBe(401);
  });
});

describe("POST /api/loyalty/convert-points — business rules", () => {
  it(`rejects a below-minimum request (${POINTS_PER_LYD - 1} points) with 400`, async () => {
    const user = await seedUser({ loyaltyPoints: 1000 });
    const token = signUserToken({ userId: user.id });
    const res = await call<{ code: string }>(app, "POST", "/api/loyalty/convert-points", {
      token,
      body: { points: POINTS_PER_LYD - 1 },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_DATA");
  });

  it(`rejects a non-multiple of ${POINTS_PER_LYD} with 400`, async () => {
    const user = await seedUser({ loyaltyPoints: 1000 });
    const token = signUserToken({ userId: user.id });
    const res = await call<{ code: string }>(app, "POST", "/api/loyalty/convert-points", {
      token,
      body: { points: POINTS_PER_LYD + 50 },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_DATA");
  });

  it("rejects '0' (numeric string) via the minimum rule with 400", async () => {
    const user = await seedUser({ loyaltyPoints: 1000 });
    const token = signUserToken({ userId: user.id });
    const res = await call<{ code: string }>(app, "POST", "/api/loyalty/convert-points", {
      token,
      body: { points: "0" },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_DATA");
  });

  it("rejects an insufficient balance with 400 and writes nothing (in-tx check)", async () => {
    const user = await seedUser({ loyaltyPoints: 50, walletBalance: "10.00" });
    const token = signUserToken({ userId: user.id });
    const res = await call<{ code: string }>(app, "POST", "/api/loyalty/convert-points", {
      token,
      body: { points: 100 },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_DATA");

    // No partial mutation: points, balance and ledger all untouched.
    const [after] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(after.loyaltyPoints).toBe(50);
    expect(parseFloat(String(after.walletBalance))).toBe(10);
    const ledger = await db
      .select()
      .from(walletLedgerTable)
      .where(eq(walletLedgerTable.userId, user.id));
    expect(ledger).toHaveLength(0);
  });

  it("returns 409 CONFLICT when the token's user no longer exists (tx ConflictError path)", async () => {
    const token = signUserToken({ userId: 999_999 });
    const res = await call<{ code: string }>(app, "POST", "/api/loyalty/convert-points", {
      token,
      body: { points: 100 },
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CONFLICT");
  });
});

describe("POST /api/loyalty/convert-points — happy path", () => {
  it("converts 100 points: credits +1 LYD, debits points, writes the ledger parity row", async () => {
    const user = await seedUser({ loyaltyPoints: 300, walletBalance: "10.00" });
    const token = signUserToken({ userId: user.id });

    const res = await call<{
      success: boolean;
      points_spent: number;
      lyd_credited: number;
      new_points: number;
      new_balance: number;
      message: string;
    }>(app, "POST", "/api/loyalty/convert-points", { token, body: { points: 100 } });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.points_spent).toBe(100);
    expect(res.body.lyd_credited).toBe(1);
    expect(res.body.new_points).toBe(200);
    expect(res.body.new_balance).toBe(11);
    expect(typeof res.body.message).toBe("string");

    // DB state: points debited, wallet credited.
    const [after] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(after.loyaltyPoints).toBe(200);
    expect(parseFloat(String(after.walletBalance))).toBe(11);

    // Constitution §I: every balance mutation is reconstructable from
    // wallet_ledger — exactly one row for the conversion.
    const ledger = await db
      .select()
      .from(walletLedgerTable)
      .where(eq(walletLedgerTable.userId, user.id));
    expect(ledger).toHaveLength(1);
    expect(ledger[0].type).toBe("adjustment");
    expect(ledger[0].referenceType).toBe("loyalty_conversion");
    expect(parseFloat(String(ledger[0].amount))).toBe(1);
    expect(parseFloat(String(ledger[0].balanceBefore))).toBe(10);
    expect(parseFloat(String(ledger[0].balanceAfter))).toBe(11);
    // Ledger reconstruction equals final balance.
    expect(parseFloat(String(ledger[0].balanceAfter))).toBe(
      parseFloat(String(after.walletBalance)),
    );
  });

  it("accepts the same value as a numeric string ('100')", async () => {
    const user = await seedUser({ loyaltyPoints: 300, walletBalance: "0.00" });
    const token = signUserToken({ userId: user.id });
    const res = await call<{
      success: boolean;
      points_spent: number;
      lyd_credited: number;
      new_points: number;
      new_balance: number;
    }>(app, "POST", "/api/loyalty/convert-points", { token, body: { points: "100" } });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.points_spent).toBe(100);
    expect(res.body.lyd_credited).toBe(1);
    expect(res.body.new_points).toBe(200);
    expect(res.body.new_balance).toBe(1);
  });

  it("trims whitespace around a numeric string ('  100  ') before validating", async () => {
    const user = await seedUser({ loyaltyPoints: 100, walletBalance: "0.00" });
    const token = signUserToken({ userId: user.id });
    const res = await call<{ success: boolean; new_points: number }>(
      app,
      "POST",
      "/api/loyalty/convert-points",
      { token, body: { points: "  100  " } },
    );
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.new_points).toBe(0);
  });

  it("converts a larger multiple correctly (500 points → 5 LYD)", async () => {
    const user = await seedUser({ loyaltyPoints: 500, walletBalance: "2.50" });
    const token = signUserToken({ userId: user.id });
    const res = await call<{ lyd_credited: number; new_balance: number; new_points: number }>(
      app,
      "POST",
      "/api/loyalty/convert-points",
      { token, body: { points: 500 } },
    );
    expect(res.status).toBe(200);
    expect(res.body.lyd_credited).toBe(5);
    expect(res.body.new_points).toBe(0);
    expect(res.body.new_balance).toBe(7.5);
  });

  it("tx re-read: after the first convert drains the balance, a second convert fails with 400", async () => {
    // True concurrency can't be simulated against a single pglite
    // connection; the tx-internal re-read is the guard that makes the
    // optimistic lock correct. Pin it serially: convert 100/100 points —
    // the second request re-reads points INSIDE the tx, sees 0, and
    // returns insufficient (never a negative balance).
    const user = await seedUser({ loyaltyPoints: 100, walletBalance: "0.00" });
    const token = signUserToken({ userId: user.id });

    const first = await call<{ success: boolean }>(app, "POST", "/api/loyalty/convert-points", {
      token,
      body: { points: 100 },
    });
    expect(first.status).toBe(200);
    expect(first.body.success).toBe(true);

    const second = await call<{ code: string }>(app, "POST", "/api/loyalty/convert-points", {
      token,
      body: { points: 100 },
    });
    expect(second.status).toBe(400);
    expect(second.body.code).toBe("INVALID_DATA");

    // Points never went negative, wallet credited exactly once.
    const [after] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(after.loyaltyPoints).toBe(0);
    expect(parseFloat(String(after.walletBalance))).toBe(1);
    const ledger = await db
      .select()
      .from(walletLedgerTable)
      .where(eq(walletLedgerTable.userId, user.id));
    expect(ledger).toHaveLength(1);
  });

  // 99-M4 (R99-A2 P2): the idempotency middleware is now mounted on
  // convert-points. This environment has no Redis, so the middleware's
  // documented degradation contract applies: pass-through with a warn
  // (the durable layer remains the in-tx balance re-read + optimistic
  // lock pinned above). These tests pin that mounting the middleware
  // did NOT change the route's behavior for keyed requests in
  // degraded mode — keyed or not, the request converts exactly once
  // and the in-tx guards still refuse an over-convert.
  it("99-M4: a request carrying an Idempotency-Key converts normally (degraded Redis-less pass-through)", async () => {
    const user = await seedUser({ loyaltyPoints: 300, walletBalance: "0.00" });
    const token = signUserToken({ userId: user.id });

    const res = await call<{ success: boolean; new_points: number }>(
      app,
      "POST",
      "/api/loyalty/convert-points",
      {
        token,
        body: { points: 100 },
        headers: { "Idempotency-Key": "r99 loyalty intent key 0001" },
      },
    );
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.new_points).toBe(200);
  });

  it("99-M4: a same-key retry in degraded mode still cannot over-convert (in-tx guards are the backstop)", async () => {
    const user = await seedUser({ loyaltyPoints: 100, walletBalance: "0.00" });
    const token = signUserToken({ userId: user.id });

    const first = await call<{ success: boolean }>(app, "POST", "/api/loyalty/convert-points", {
      token,
      body: { points: 100 },
      headers: { "Idempotency-Key": "r99 loyalty intent key 0002" },
    });
    expect(first.status).toBe(200);

    // Same key, retry after the points were drained — the Redis replay
    // layer is absent here, so the in-tx balance check must refuse the
    // second execution (400) instead of driving points negative.
    const retry = await call<{ code: string }>(app, "POST", "/api/loyalty/convert-points", {
      token,
      body: { points: 100 },
      headers: { "Idempotency-Key": "r99 loyalty intent key 0002" },
    });
    expect(retry.status).toBe(400);

    const [after] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(after.loyaltyPoints).toBe(0);
    expect(parseFloat(String(after.walletBalance))).toBe(1);
  });
});

describe("GET /api/loyalty", () => {
  it("returns the summary shape with points, tier and points_value_lyd as a string", async () => {
    const user = await seedUser({ loyaltyPoints: 250, lifetimeSpend: "250.00" });
    const token = signUserToken({ userId: user.id });

    const res = await call<{
      points: number;
      tier: string;
      lifetime_spend: number;
      referral_code: string;
      referrals_total: number;
      referrals_credited: number;
      referrals_pending: number;
      points_value_lyd: string;
      next_tier: { tier: string; remaining: number } | null;
      tier_thresholds: Record<string, number>;
      points_rate: { points_per_referral: number; points_per_lyd: number };
    }>(app, "GET", "/api/loyalty", { token });

    expect(res.status).toBe(200);
    expect(res.body.points).toBe(250);
    expect(res.body.tier).toBe("bronze");
    expect(res.body.lifetime_spend).toBe(250);
    expect(res.body.referral_code).toBe(""); // null referralCode surfaces as ""
    expect(res.body.referrals_total).toBe(0);
    // 250 / 100 = 2.50 — MUST stay a string (toFixed(2)) per contract.
    expect(typeof res.body.points_value_lyd).toBe("string");
    expect(res.body.points_value_lyd).toBe("2.50");
    // 250 spend < 500 silver → next tier silver, 250 remaining.
    expect(res.body.next_tier?.tier).toBe("silver");
    expect(res.body.next_tier?.remaining).toBe(TIER_THRESHOLDS.silver - 250);
    expect(res.body.tier_thresholds).toEqual({
      silver: TIER_THRESHOLDS.silver,
      gold: TIER_THRESHOLDS.gold,
      platinum: TIER_THRESHOLDS.platinum,
    });
    expect(res.body.points_rate).toEqual({
      points_per_referral: 50,
      points_per_lyd: POINTS_PER_LYD,
    });
  });

  it("aggregates referral events into credited vs pending counts", async () => {
    const user = await seedUser({ loyaltyPoints: 0 });
    await seedReferee(user.id, "credited");
    await seedReferee(user.id, "credited");
    await seedReferee(user.id, "pending");
    const token = signUserToken({ userId: user.id });

    const res = await call<{
      referrals_total: number;
      referrals_credited: number;
      referrals_pending: number;
    }>(app, "GET", "/api/loyalty", { token });

    expect(res.status).toBe(200);
    expect(res.body.referrals_total).toBe(3);
    expect(res.body.referrals_credited).toBe(2);
    expect(res.body.referrals_pending).toBe(1);
  });

  it("scopes referrals to the calling user", async () => {
    const userA = await seedUser();
    const userB = await seedUser();
    await seedReferee(userA.id, "credited");
    const tokenB = signUserToken({ userId: userB.id });
    const res = await call<{ referrals_total: number }>(app, "GET", "/api/loyalty", {
      token: tokenB,
    });
    expect(res.status).toBe(200);
    expect(res.body.referrals_total).toBe(0);
  });

  it("returns 404 NOT_FOUND when the token's user no longer exists", async () => {
    const token = signUserToken({ userId: 999_999 });
    const res = await call<{ code: string }>(app, "GET", "/api/loyalty", { token });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });

  it("rejects an unauthenticated request with 401", async () => {
    const res = await call(app, "GET", "/api/loyalty");
    expect(res.status).toBe(401);
  });
});
