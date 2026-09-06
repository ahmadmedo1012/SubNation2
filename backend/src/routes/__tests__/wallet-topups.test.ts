import express from "express";
import cookieParser from "cookie-parser";
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import {
  db,
  initTestDb,
  resetTestDb,
  usersTable,
  walletTopupsTable,
} from "../../test/db";
import { signUserToken } from "../../lib/jwt";
import { walletRouter } from "../wallet";

/**
 * Integration tests for the wallet top-up creation API (r4-2d /
 * testing-audit gap #2). The wallet router is mounted at `/api/wallet` on
 * a fresh Express app and exercised via real `fetch` calls — identical
 * pattern to routes/__tests__/cart.test.ts.
 *
 * POST /api/wallet/topups is a money-adjacent write whose HTTP surface
 * had ZERO tests (only the service-level approve/reject state machine
 * was covered). These pin the generated-zod perimeter (amount bounds,
 * reference length), the handler's conditional requirements, the
 * 3-pending cap (429 TOPUP_LIMIT_EXCEEDED) and the auto-reject
 * heuristic for serially-rejected users.
 *
 * TELEGRAM_* is unset → the fire-and-forget approval notify self-skips;
 * RISK_PIPELINE_ENABLED defaults off → risk scoring self-skips. No
 * external calls are made.
 */

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/wallet", walletRouter);
  return app;
}

// Round-1 P3: deterministic phone seeding (no Math.random — unique-phone
// collisions made suites flaky). TRUNCATE-per-test makes these unique
// anyway; the counter guards even without a reset.
let phoneSeq = 91_300_000;
function nextPhone(): string {
  phoneSeq += 1;
  return String(phoneSeq);
}

async function seedUser(overrides: Partial<{ phone: string; walletBalance: string }> = {}) {
  const [u] = await db
    .insert(usersTable)
    .values({
      phone: overrides.phone ?? nextPhone(),
      walletBalance: overrides.walletBalance ?? "0.00",
    })
    .returning();
  return u;
}

type TopupStatus = "pending" | "approved" | "rejected";

/** Seed a topup row directly (bypasses the route — used to set up the
 * pending-cap and auto-reject scenarios). */
async function seedTopup(
  userId: number,
  status: TopupStatus,
  overrides: Partial<{ amount: string }> = {},
) {
  const [t] = await db
    .insert(walletTopupsTable)
    .values({
      userId,
      amount: overrides.amount ?? "20.00",
      paymentMethod: "mobile_transfer",
      paymentNetwork: "madar",
      status,
    })
    .returning();
  return t;
}

interface ApiOk<T = unknown> {
  status: number;
  body: T;
}

async function call<T = unknown>(
  app: express.Express,
  method: "GET" | "POST",
  path: string,
  opts: { token?: string; body?: unknown } = {},
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

describe("POST /api/wallet/topups — validation (generated zod + handler rules)", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const res = await call(app, "POST", "/api/wallet/topups", {
      body: { amount: 50, payment_network: "madar" },
    });
    expect(res.status).toBe(401);
  });

  it.each([
    ["amount 0 (zero)", 0],
    ["negative amount", -5],
    ["amount above the cap (10000.01)", 10000.01],
    ["non-number amount (string '50')", "50"],
  ])("rejects %s with 400 INVALID_DATA", async (_label, amount) => {
    const user = await seedUser();
    const token = signUserToken({ userId: user.id });
    const res = await call<{ code: string }>(app, "POST", "/api/wallet/topups", {
      token,
      body: { amount, payment_network: "madar" },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_DATA");
  });

  it("rejects an unknown payment_method with 400 INVALID_DATA (zod enum)", async () => {
    const user = await seedUser();
    const token = signUserToken({ userId: user.id });
    const res = await call<{ code: string }>(app, "POST", "/api/wallet/topups", {
      token,
      body: { amount: 50, payment_method: "crypto" },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_DATA");
  });

  it("rejects mobile_transfer (the default method) without payment_network with 400", async () => {
    const user = await seedUser();
    const token = signUserToken({ userId: user.id });
    const res = await call<{ code: string }>(app, "POST", "/api/wallet/topups", {
      token,
      body: { amount: 50 },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_DATA");
  });

  it("rejects lypay without sender_account with 400", async () => {
    const user = await seedUser();
    const token = signUserToken({ userId: user.id });
    const res = await call<{ code: string }>(app, "POST", "/api/wallet/topups", {
      token,
      body: { amount: 50, payment_method: "lypay" },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_DATA");
  });

  it.each([
    ["too short ('12345')", "12345"],
    ["9 digits with a non-Libyan prefix ('123456789')", "123456789"],
  ])("rejects an invalid sender_phone (%s) with 400", async (_label, sender_phone) => {
    const user = await seedUser();
    const token = signUserToken({ userId: user.id });
    const res = await call<{ code: string }>(app, "POST", "/api/wallet/topups", {
      token,
      body: { amount: 50, payment_network: "madar", sender_phone },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_DATA");
  });

  it("rejects a payment_reference longer than 255 chars with 400 (zod maxLength)", async () => {
    // The generated CreateTopupBody bounds payment_reference at 255 —
    // previously an over-long reference hit the DB and 500'd.
    const user = await seedUser();
    const token = signUserToken({ userId: user.id });
    const res = await call<{ code: string }>(app, "POST", "/api/wallet/topups", {
      token,
      body: { amount: 50, payment_network: "madar", payment_reference: "R".repeat(256) },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_DATA");
  });
});

describe("POST /api/wallet/topups — pending cap (MAX_PENDING = 3)", () => {
  it("returns 429 TOPUP_LIMIT_EXCEEDED with pending_count and limit on the 4th request", async () => {
    const user = await seedUser();
    const token = signUserToken({ userId: user.id });
    await seedTopup(user.id, "pending");
    await seedTopup(user.id, "pending");
    await seedTopup(user.id, "pending");

    const res = await call<{
      error: string;
      code: string;
      pending_count: number;
      limit: number;
    }>(app, "POST", "/api/wallet/topups", {
      token,
      body: { amount: 50, payment_network: "madar" },
    });

    expect(res.status).toBe(429);
    // The envelope the frontend getErrorMessage maps on (V4-P1): raw
    // {error, code, pending_count, limit} — NOT createErrorResponse.
    expect(res.body.code).toBe("TOPUP_LIMIT_EXCEEDED");
    expect(res.body.pending_count).toBe(3);
    expect(res.body.limit).toBe(3);

    // No 4th row was written.
    const rows = await db
      .select()
      .from(walletTopupsTable)
      .where(eq(walletTopupsTable.userId, user.id));
    expect(rows).toHaveLength(3);
  });

  it("approved and rejected topups do NOT count toward the pending cap", async () => {
    const user = await seedUser();
    const token = signUserToken({ userId: user.id });
    await seedTopup(user.id, "approved");
    await seedTopup(user.id, "rejected");
    await seedTopup(user.id, "pending");

    const res = await call<{ code?: string }>(app, "POST", "/api/wallet/topups", {
      token,
      body: { amount: 50, payment_network: "madar" },
    });
    expect(res.status).toBe(201);
  });
});

describe("POST /api/wallet/topups — auto-reject heuristic (≥3 prior rejections)", () => {
  it("creates the topup with status 'rejected' and an admin note for a serially-rejected user", async () => {
    const user = await seedUser();
    const token = signUserToken({ userId: user.id });
    await seedTopup(user.id, "rejected");
    await seedTopup(user.id, "rejected");
    await seedTopup(user.id, "rejected");

    const res = await call<{
      id: number;
      status: string;
      admin_note: string | null;
    }>(app, "POST", "/api/wallet/topups", {
      token,
      body: { amount: 50, payment_network: "madar" },
    });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("rejected");
    expect(typeof res.body.admin_note).toBe("string");
    expect(res.body.admin_note).not.toBeNull();

    // Persisted row agrees with the response.
    const [row] = await db
      .select()
      .from(walletTopupsTable)
      .where(eq(walletTopupsTable.id, res.body.id));
    expect(row.status).toBe("rejected");
    expect(row.adminNote).not.toBeNull();
  });

  it("stays 'pending' below the threshold (only 2 prior rejections)", async () => {
    const user = await seedUser();
    const token = signUserToken({ userId: user.id });
    await seedTopup(user.id, "rejected");
    await seedTopup(user.id, "rejected");

    const res = await call<{ status: string; admin_note: string | null }>(
      app,
      "POST",
      "/api/wallet/topups",
      { token, body: { amount: 50, payment_network: "madar" } },
    );
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("pending");
    expect(res.body.admin_note).toBeNull();
  });
});

describe("POST /api/wallet/topups — happy path", () => {
  it("creates a pending mobile_transfer topup and returns the formatted row", async () => {
    const user = await seedUser();
    const token = signUserToken({ userId: user.id });

    const res = await call<{
      id: number;
      amount: number;
      payment_method: string;
      payment_network: string | null;
      sender_phone: string | null;
      sender_account: string | null;
      payment_reference: string | null;
      status: string;
      admin_note: string | null;
      created_at: string | null;
      reviewed_at: string | null;
    }>(app, "POST", "/api/wallet/topups", {
      token,
      body: {
        amount: 50,
        payment_method: "mobile_transfer",
        payment_network: "madar",
        sender_phone: "0912345678",
        payment_reference: "TX-REF-1",
      },
    });

    expect(res.status).toBe(201);
    expect(res.body.amount).toBe(50);
    expect(res.body.payment_method).toBe("mobile_transfer");
    expect(res.body.payment_network).toBe("madar");
    // Stored raw (validation-only normalization) — pins current behavior.
    expect(res.body.sender_phone).toBe("0912345678");
    expect(res.body.sender_account).toBeNull();
    expect(res.body.payment_reference).toBe("TX-REF-1");
    expect(res.body.status).toBe("pending");
    expect(res.body.admin_note).toBeNull();
    expect(typeof res.body.created_at).toBe("string");
    expect(res.body.reviewed_at).toBeNull();

    const [row] = await db
      .select()
      .from(walletTopupsTable)
      .where(eq(walletTopupsTable.id, res.body.id));
    expect(row.userId).toBe(user.id);
    expect(parseFloat(String(row.amount))).toBe(50);
    expect(row.status).toBe("pending");
  });

  it("creates a pending lypay topup with sender_account and no network", async () => {
    const user = await seedUser();
    const token = signUserToken({ userId: user.id });
    const res = await call<{
      payment_method: string;
      payment_network: string | null;
      sender_account: string | null;
      status: string;
    }>(app, "POST", "/api/wallet/topups", {
      token,
      body: { amount: 25, payment_method: "lypay", sender_account: "LYP-ACC-9" },
    });
    expect(res.status).toBe(201);
    expect(res.body.payment_method).toBe("lypay");
    expect(res.body.payment_network).toBeNull();
    expect(res.body.sender_account).toBe("LYP-ACC-9");
    expect(res.body.status).toBe("pending");
  });

  it("accepts the amount boundaries: 0.01 and 10000", async () => {
    const user = await seedUser();
    const token = signUserToken({ userId: user.id });

    const min = await call<{ amount: number }>(app, "POST", "/api/wallet/topups", {
      token,
      body: { amount: 0.01, payment_network: "madar" },
    });
    expect(min.status).toBe(201);
    expect(min.body.amount).toBe(0.01);

    const max = await call<{ amount: number }>(app, "POST", "/api/wallet/topups", {
      token,
      body: { amount: 10000, payment_network: "madar" },
    });
    expect(max.status).toBe(201);
    expect(max.body.amount).toBe(10000);
  });

  it("accepts a payment_reference at the 255-char boundary", async () => {
    const user = await seedUser();
    const token = signUserToken({ userId: user.id });
    const res = await call<{ payment_reference: string | null }>(
      app,
      "POST",
      "/api/wallet/topups",
      {
        token,
        body: { amount: 50, payment_network: "madar", payment_reference: "R".repeat(255) },
      },
    );
    expect(res.status).toBe(201);
    expect(res.body.payment_reference).toHaveLength(255);
  });
});

describe("GET /api/wallet/topups", () => {
  it("lists the calling user's topups only (user-scoped)", async () => {
    const userA = await seedUser();
    const userB = await seedUser();
    const tokenA = signUserToken({ userId: userA.id });
    const tokenB = signUserToken({ userId: userB.id });

    await call(app, "POST", "/api/wallet/topups", {
      token: tokenA,
      body: { amount: 10, payment_network: "madar" },
    });
    await call(app, "POST", "/api/wallet/topups", {
      token: tokenA,
      body: { amount: 20, payment_method: "lypay", sender_account: "A-1" },
    });

    const listA = await call<{ id: number; amount: number; status: string }[]>(
      app,
      "GET",
      "/api/wallet/topups",
      { token: tokenA },
    );
    expect(listA.status).toBe(200);
    expect(listA.body).toHaveLength(2);
    expect(listA.body.map((t) => t.amount).sort((a, b) => a - b)).toEqual([10, 20]);
    expect(listA.body.every((t) => t.status === "pending")).toBe(true);

    const listB = await call<unknown[]>(app, "GET", "/api/wallet/topups", { token: tokenB });
    expect(listB.status).toBe(200);
    expect(listB.body).toEqual([]);
  });

  it("rejects an unauthenticated request with 401", async () => {
    const res = await call(app, "GET", "/api/wallet/topups");
    expect(res.status).toBe(401);
  });
});
