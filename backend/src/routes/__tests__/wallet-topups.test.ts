import express from "express";
import cookieParser from "cookie-parser";
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, initTestDb, resetTestDb, usersTable, walletTopupsTable } from "../../test/db";
import { signUserToken } from "../../lib/jwt";
import { walletRouter } from "../wallet";
import { __resetIdempotencyTableProbeForTests } from "../../lib/idempotency";

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
  extraHeaders: Record<string, string> = {},
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
        Object.assign(headers, extraHeaders);
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

// B4-R1 (R111): the same-key replay test exercises the durable DB claim
// (this suite has no Redis double — the middleware is a pass-through, so
// the pre-tx findIdempotentOrderId + in-tx claimIdempotencyKey path is
// the real guard under test). The base test schema (test/db.ts) predates
// V1-M12 and never contained this table — mirror the post-V1-M20
// production shape: order_id NULLABLE (V1-M19) and NO orders FK (V1-M20
// dropped it — topup claims write topup ids, which an orders FK would
// reject with 23503).
const IDEMPOTENCY_DDL = `
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key text PRIMARY KEY,
  order_id integer,
  reference_type varchar(32) NOT NULL DEFAULT 'order',
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

beforeAll(async () => {
  await initTestDb();
  await db.execute(sql.raw(IDEMPOTENCY_DDL));
  // Re-arm the 42P01 probe: a prior suite-run may have latched
  // tableMissing before this file created the table.
  __resetIdempotencyTableProbeForTests();
});

beforeEach(async () => {
  await resetTestDb();
  // resetTestDb does not know this table (orders-idempotency-route
  // established the manual-truncate convention for the same reason).
  await db.execute(sql.raw("TRUNCATE idempotency_keys"));
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
      // B4-R1: the reference is required now — include one so THIS test
      // still exercises the sender-phone validation it was written for.
      body: {
        amount: 50,
        payment_network: "madar",
        sender_phone,
        payment_reference: "TRX-PHONE-CHECK-1",
      },
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

  it("rejects a payment_reference longer than 100 chars with 400 (F-03 handler cap)", async () => {
    // F-03 (round-93): the handler trims and caps the reference at 100
    // chars — the semantic bound the dedup layers compare on. The zod
    // 255-char schema is only the looser outer perimeter, so a 101..255
    // char value passes zod and is rejected here.
    const user = await seedUser();
    const token = signUserToken({ userId: user.id });
    const res = await call<{ code: string }>(app, "POST", "/api/wallet/topups", {
      token,
      body: { amount: 50, payment_network: "madar", payment_reference: "R".repeat(101) },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_DATA");
    expect(await db.select().from(walletTopupsTable)).toHaveLength(0);
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
      body: { amount: 50, payment_network: "madar", payment_reference: "TRX-CAP-4TH" },
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
      body: { amount: 50, payment_network: "madar", payment_reference: "TRX-CAP-MIXED" },
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
      body: { amount: 50, payment_network: "madar", payment_reference: "TRX-AUTOREJ-1" },
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
      { token, body: { amount: 50, payment_network: "madar", payment_reference: "TRX-AUTOREJ-2" } },
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
      body: { amount: 0.01, payment_network: "madar", payment_reference: "TRX-BOUND-MIN" },
    });
    expect(min.status).toBe(201);
    expect(min.body.amount).toBe(0.01);

    const max = await call<{ amount: number }>(app, "POST", "/api/wallet/topups", {
      token,
      body: { amount: 10000, payment_network: "madar", payment_reference: "TRX-BOUND-MAX" },
    });
    expect(max.status).toBe(201);
    expect(max.body.amount).toBe(10000);
  });

  it("rejects a payment_reference at the 100-char handler boundary", async () => {
    // F-03 (round-93): the handler cap (trimmed, ≤ 100) replaced the old
    // 255-char raw boundary.
    const user = await seedUser();
    const token = signUserToken({ userId: user.id });
    const res = await call<{ payment_reference: string | null }>(
      app,
      "POST",
      "/api/wallet/topups",
      {
        token,
        body: {
          amount: 50,
          payment_network: "madar",
          payment_reference: "R".repeat(100),
        },
      },
    );
    expect(res.status).toBe(201);
    expect(res.body.payment_reference).toHaveLength(100);
  });
});

// ── B4-R1 (R111, round-111 B4 audit): payment_reference REQUIRED for ────────
// mobile_transfer + creation-time duplicate-receipt guard. A blank ref was
// exempt from EVERY dedup layer (V1-M9 partial unique, B2-02 exact check,
// composite soft-dedup — all key on the reference), so two ref-less pendings
// for one real transfer were both approvable (200 LYD credited for one 100
// LYD transfer). lypay keeps the reference optional.

describe("POST /api/wallet/topups — B4-R1 reference requirement (mobile_transfer)", () => {
  it.each([
    ["field omitted entirely", undefined],
    ["whitespace-only reference", "   "],
    ["empty string", ""],
  ])(
    "mobile_transfer without a usable reference (%s) → 400 INVALID_DATA",
    async (_label, payment_reference) => {
      const user = await seedUser();
      const token = signUserToken({ userId: user.id });
      const res = await call<{ code: string; error: string }>(app, "POST", "/api/wallet/topups", {
        token,
        body: { amount: 50, payment_network: "madar", payment_reference },
      });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("INVALID_DATA");
      // R126-L2 (A8 F4): the 400 mirrors the storefront's «رمز التحويل»
      // label canon (was «مرجع التحويل» — A8's terminology table).
      expect(res.body.error).toContain("رمز التحويل");
      expect(res.body.error).not.toContain("مرجع التحويل");
      // Nothing was written.
      expect(await db.select().from(walletTopupsTable)).toHaveLength(0);
    },
  );

  it("lypay keeps the reference optional (gateway receipts are not consistently exposed to users)", async () => {
    const user = await seedUser();
    const token = signUserToken({ userId: user.id });
    const res = await call<{ status: string; payment_reference: string | null }>(
      app,
      "POST",
      "/api/wallet/topups",
      { token, body: { amount: 25, payment_method: "lypay", sender_account: "LYP-ACC-B4R1" } },
    );
    expect(res.status).toBe(201);
    expect(res.body.payment_reference).toBeNull();
  });

  it("same user + reference + amount with a PENDING row → 409 DUPLICATE_PENDING_REFERENCE, no second row", async () => {
    const user = await seedUser();
    const token = signUserToken({ userId: user.id });

    const first = await call<{ id: number }>(app, "POST", "/api/wallet/topups", {
      token,
      body: {
        amount: 100,
        payment_network: "libyana",
        payment_reference: "RECEIPT-DUP-1",
        sender_phone: "0912345678",
      },
    });
    expect(first.status).toBe(201);

    // A DIFFERENT idempotency key (or none) — the resubmission shape the
    // HTTP replay layer cannot catch.
    const dup = await call<{ code: string; details: { reason?: string } }>(
      app,
      "POST",
      "/api/wallet/topups",
      {
        token,
        body: {
          amount: 100,
          payment_network: "libyana",
          payment_reference: "RECEIPT-DUP-1",
          sender_phone: "0912345678",
        },
      },
    );
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe("CONFLICT");
    expect(dup.body.details.reason).toBe("DUPLICATE_PENDING_REFERENCE");

    // Exactly ONE row for the receipt.
    const rows = await db
      .select()
      .from(walletTopupsTable)
      .where(eq(walletTopupsTable.userId, user.id));
    expect(rows).toHaveLength(1);
  });

  it("same reference with a DIFFERENT amount is allowed (approval battery still guards it)", async () => {
    const user = await seedUser();
    const token = signUserToken({ userId: user.id });
    const first = await call(app, "POST", "/api/wallet/topups", {
      token,
      body: { amount: 100, payment_network: "madar", payment_reference: "RECEIPT-AMT-1" },
    });
    expect(first.status).toBe(201);
    const second = await call(app, "POST", "/api/wallet/topups", {
      token,
      body: { amount: 200, payment_network: "madar", payment_reference: "RECEIPT-AMT-1" },
    });
    expect(second.status).toBe(201);
  });

  it("the same Idempotency-Key replay still short-circuits BEFORE the duplicate-receipt 409", async () => {
    const user = await seedUser();
    const token = signUserToken({ userId: user.id });
    const body = {
      amount: 100,
      payment_network: "madar",
      payment_reference: "RECEIPT-IDEM-1",
    };
    const key = { "Idempotency-Key": "b4r1 replay key 0001" };

    const first = await call(app, "POST", "/api/wallet/topups", { token, body }, key);
    expect(first.status).toBe(201);
    const retry = await call(app, "POST", "/api/wallet/topups", { token, body }, key);
    expect(retry.status).toBe(200);
  });

  it("legacy blank-ref PENDING rows stay approvable (B4-R1 enforces at CREATION only)", async () => {
    // The live table holds pre-fix blank-ref pending rows (verified
    // 2026-09-24: 2 pending blank-ref). Seeded directly — the route can no
    // longer mint this shape, but TopupService.approve must keep reviewing
    // the existing ones, else real customer money strands in limbo.
    const user = await seedUser({ walletBalance: "0.00" });
    const [legacy] = await db
      .insert(walletTopupsTable)
      .values({
        userId: user.id,
        amount: "100.00",
        paymentMethod: "mobile_transfer",
        paymentNetwork: "libyana",
        paymentReference: null,
        status: "pending",
      })
      .returning();

    const { TopupService } = await import("../../services/topup.service");
    await TopupService.approve(legacy.id, null);

    const [after] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(after.walletBalance))).toBe(100);
    const [row] = await db
      .select()
      .from(walletTopupsTable)
      .where(eq(walletTopupsTable.id, legacy.id));
    expect(row.status).toBe("approved");
  });
});

// ── B2-F2 (R111, round-111 B2 audit): payment_network allowlist + column ────
// bounds (varchar(50/20/255)) — oversized values are 400s, never 22001 500s.

describe("POST /api/wallet/topups — B2-F2 network allowlist + field bounds", () => {
  it("rejects an off-allowlist payment_network with 400 (was free-form)", async () => {
    const user = await seedUser();
    const token = signUserToken({ userId: user.id });
    const res = await call<{ code: string; error: string }>(app, "POST", "/api/wallet/topups", {
      token,
      body: { amount: 50, payment_network: "crypto-chain", payment_reference: "TRX-NET-1" },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_DATA");
    expect(res.body.error).toContain("شبكة الدفع");
  });

  it("rejects an over-long payment_network with 400 (varchar(50) — was a 500)", async () => {
    const user = await seedUser();
    const token = signUserToken({ userId: user.id });
    const res = await call<{ code: string }>(app, "POST", "/api/wallet/topups", {
      token,
      body: {
        amount: 50,
        payment_network: "n".repeat(51),
        payment_reference: "TRX-NET-2",
      },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_DATA");
  });

  it("normalizes the network (trim + lowercase) before the allowlist + storage", async () => {
    const user = await seedUser();
    const token = signUserToken({ userId: user.id });
    const res = await call<{ payment_network: string | null }>(app, "POST", "/api/wallet/topups", {
      token,
      body: {
        amount: 50,
        payment_network: "  Madar ",
        payment_reference: "TRX-NET-3",
      },
    });
    expect(res.status).toBe(201);
    expect(res.body.payment_network).toBe("madar");
  });

  it.each(["libyana", "madar", "sadad", "lypay"])(
    "accepts every allowlisted network (%s) — frontend + live legacy values",
    async (network) => {
      const user = await seedUser();
      const token = signUserToken({ userId: user.id });
      const res = await call<{ payment_network: string | null }>(
        app,
        "POST",
        "/api/wallet/topups",
        {
          token,
          body: { amount: 50, payment_network: network, payment_reference: `TRX-${network}` },
        },
      );
      expect(res.status).toBe(201);
      expect(res.body.payment_network).toBe(network);
    },
  );

  it("rejects an over-long sender_account with 400 (varchar(255) — was a 500)", async () => {
    const user = await seedUser();
    const token = signUserToken({ userId: user.id });
    const res = await call<{ code: string }>(app, "POST", "/api/wallet/topups", {
      token,
      body: {
        amount: 25,
        payment_method: "lypay",
        sender_account: "A".repeat(256),
      },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_DATA");
  });

  it("rejects an over-long sender_phone on lypay with 400 (varchar(20) — was a 500; lypay skips the Libyan-number check)", async () => {
    const user = await seedUser();
    const token = signUserToken({ userId: user.id });
    const res = await call<{ code: string }>(app, "POST", "/api/wallet/topups", {
      token,
      body: {
        amount: 25,
        payment_method: "lypay",
        sender_account: "LYP-ACC-PHONE-LEN",
        sender_phone: "9".repeat(21),
      },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_DATA");
  });

  it("accepts sender_account at the 255-char boundary", async () => {
    const user = await seedUser();
    const token = signUserToken({ userId: user.id });
    const res = await call<{ sender_account: string | null }>(app, "POST", "/api/wallet/topups", {
      token,
      body: {
        amount: 25,
        payment_method: "lypay",
        sender_account: "A".repeat(255),
      },
    });
    expect(res.status).toBe(201);
    expect(res.body.sender_account).toHaveLength(255);
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
      body: { amount: 10, payment_network: "madar", payment_reference: "TRX-LIST-A1" },
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

// ── AUD103-5-F7 (r103): topup rounding at the boundary (R102 fix, unpinned) ──

describe("POST /api/wallet/topups — boundary rounding (AUD103-5-F7)", () => {
  it("a 3-decimal amount is stored, responded, and credited as the 2-dp rounded value", async () => {
    const user = await seedUser({ walletBalance: "0.00" });
    const token = signUserToken({ userId: user.id });

    // zod accepts up to 3+ decimals; numeric(10,2) rounds SILENTLY. The
    // R102 fix rounds at the boundary so the operator approval card, the
    // credited amount, and the ledger agree (10.555 → 10.56).
    const res = await call<{ id: number; amount: number; status: string }>(
      app,
      "POST",
      "/api/wallet/topups",
      {
        token,
        body: { amount: 10.555, payment_network: "madar", payment_reference: "TRX-ROUND-1" },
      },
    );
    expect(res.status).toBe(201);
    expect(res.body.amount).toBe(10.56);

    // The STORED row is the rounded value (display-vs-storage parity).
    const [row] = await db
      .select()
      .from(walletTopupsTable)
      .where(eq(walletTopupsTable.userId, user.id));
    expect(row).toBeDefined();
    expect(String(row.amount)).toBe("10.56");

    // And the APPROVED credit moves exactly the rounded amount (same
    // rounding idiom at the service boundary — topup.service.ts).
    const { TopupService } = await import("../../services/topup.service");
    await TopupService.approve(row.id, null);
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(10.56);
  });
});
