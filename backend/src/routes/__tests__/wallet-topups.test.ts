import express from "express";
import cookieParser from "cookie-parser";
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  db,
  initTestDb,
  resetTestDb,
  usersTable,
  walletTopupsTable,
  notificationsTable,
} from "../../test/db";
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
  body_hash varchar(64),
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
      body: {
        amount: 50,
        payment_network: "madar",
        sender_phone,
        // R154: no reference needed anymore — the sender-phone validation
        // under test fires before any reference handling.
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

  it("R151: normalizes sender_phone before storage (dedup can't be bypassed by formatting)", async () => {
    // The composite soft-dedup (topup.service.ts:360) matches
    // senderPhone as a raw string — two submissions of the same number
    // with different formatting ("0913456789" vs "+218913456789", both
    // valid, both normalize to "913456789") bypassed the dedup and could
    // both be approved, crediting the wallet twice for one real
    // transfer. The route now stores the NORMALIZED form.
    const user = await seedUser();
    const token = signUserToken({ userId: user.id });
    const res = await call<{ id: number }>(app, "POST", "/api/wallet/topups", {
      token,
      body: {
        amount: 50,
        payment_network: "madar",
        sender_phone: "+218913456789",
        payment_reference: "TRX-NORM-1",
      },
    });
    expect(res.status).toBe(201);

    const [row] = await db
      .select()
      .from(walletTopupsTable)
      .where(eq(walletTopupsTable.id, res.body.id));
    // The canonical 9-digit form — NOT "+218913456789".
    expect(row.senderPhone).toBe("913456789");
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

  it("R154 (P5): the CUSTOMER now gets a notification row on BOTH outcomes — «قيد المراجعة» when pending, the honest refusal on auto-reject (previously NOBODY was notified)", async () => {
    // Pending path: a clean submission writes the review-acknowledgment row.
    const user = await seedUser();
    const token = signUserToken({ userId: user.id });
    await call(app, "POST", "/api/wallet/topups", {
      token,
      body: { amount: 50, payment_network: "madar" },
    });
    let rows = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.userId, user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe("wallet");
    expect(rows[0]!.title).toBe("تم استلام طلب الشحن");
    expect(rows[0]!.message).toContain("قيد المراجعة");
    expect(rows[0]!.link).toBe("/wallet");
    expect(rows[0]!.isRead).toBe(false);

    // Auto-reject path: the serial-abuser verdict gets its own row.
    const abuser = await seedUser();
    const abuserToken = signUserToken({ userId: abuser.id });
    await seedTopup(abuser.id, "rejected");
    await seedTopup(abuser.id, "rejected");
    await seedTopup(abuser.id, "rejected");
    await call(app, "POST", "/api/wallet/topups", {
      token: abuserToken,
      body: { amount: 50, payment_network: "madar" },
    });
    rows = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.userId, abuser.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe("تعذّر قبول طلب الشحن");
    expect(rows[0]!.message).toContain("تواصل مع الدعم");
    expect(rows[0]!.link).toBe("/support");
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
    // R151: sender_phone is now stored NORMALIZED (canonical 9-digit
    // form), not raw — so the composite soft-dedup at approval time
    // can't be bypassed by submitting the same number with different
    // formatting. "0912345678" → normalizeLibyanPhone → "912345678".
    expect(res.body.sender_phone).toBe("912345678");
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
    // The persisted column agrees with the normalized response.
    expect(row.senderPhone).toBe("912345678");
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

// ── R154 (P1-A): the B4-R1 hard-required reference is RETIRED for ───────
// mobile_transfer (the storefront receipt field is gone — the telecom USSD
// channel doesn't reliably surface a receipt to the customer, and the
// required field was the top abandonment point of the money path). The
// dedup battery for REFERENCED records (B4-R1 creation guard, V1-M9 partial
// unique, B2-02 exact check, composite soft-dedup) is preserved verbatim for
// legacy rows and any submission that still carries a reference. Ref-less
// mobile transfers instead get the operator-visible DUPLICATE-RISK signal:
// pending/recently-approved siblings on (amount, network, sender phone)
// surface as the pending row's admin note + the ⚠ line on the Telegram card
// — a review safeguard, never a blanket rejection.

describe("POST /api/wallet/topups — R154 ref-less mobile_transfer + duplicate-risk signal", () => {
  it.each([
    ["field omitted entirely", undefined],
    ["whitespace-only reference", "   "],
    ["empty string", ""],
  ])(
    "mobile_transfer without a reference (%s) → 201 pending (the required field is retired)",
    async (_label, payment_reference) => {
      const user = await seedUser();
      const token = signUserToken({ userId: user.id });
      const res = await call<{
        status: string;
        payment_reference: string | null;
        admin_note: string | null;
      }>(app, "POST", "/api/wallet/topups", {
        token,
        body: { amount: 50, payment_network: "madar", payment_reference },
      });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe("pending");
      expect(res.body.payment_reference).toBeNull();
      // No sibling evidence → no risk note.
      expect(res.body.admin_note).toBeNull();
    },
  );

  it("ref-less submission with a PENDING sibling (same amount/network/sender) → risk admin_note, still 201", async () => {
    const user = await seedUser();
    const token = signUserToken({ userId: user.id });

    const first = await call<{ id: number }>(app, "POST", "/api/wallet/topups", {
      token,
      body: { amount: 100, payment_network: "libyana", sender_phone: "0912345678" },
    });
    expect(first.status).toBe(201);
    // A DIFFERENT idempotency key — the deliberate repeat submission shape.
    const second = await call<{ id: number; admin_note: string | null }>(
      app,
      "POST",
      "/api/wallet/topups",
      { token, body: { amount: 100, payment_network: "libyana", sender_phone: "0912345678" } },
    );
    expect(second.status).toBe(201);
    expect(second.body.admin_note).toContain("خطر تكرار محتمل");
    expect(second.body.admin_note).toContain(`#${first.body.id}`);
  });

  it("the duplicate-risk probe matches the NORMALIZED sender phone (not the raw formatting)", async () => {
    const user = await seedUser();
    const token = signUserToken({ userId: user.id });

    const first = await call<{ id: number }>(app, "POST", "/api/wallet/topups", {
      token,
      body: { amount: 75, payment_network: "madar", sender_phone: "0912345678" },
    });
    expect(first.status).toBe(201);
    // Same phone, different formatting — stored normalized, so the probe
    // must still see the sibling.
    const second = await call<{ admin_note: string | null }>(app, "POST", "/api/wallet/topups", {
      token,
      body: { amount: 75, payment_network: "madar", sender_phone: "+218912345678" },
    });
    expect(second.status).toBe(201);
    expect(second.body.admin_note).toContain("خطر تكرار محتمل");
  });

  it("a DIFFERENT amount or sender phone or network → no risk note (legitimate repeat)", async () => {
    // Each variant rides a FRESH user — MAX_PENDING=3 would 429 a fourth
    // same-user submission before the probe could speak.
    const probe = async (body: Record<string, unknown>) => {
      const user = await seedUser();
      const first = await call(app, "POST", "/api/wallet/topups", {
        token: signUserToken({ userId: user.id }),
        body: { amount: 100, payment_network: "libyana", sender_phone: "0912345678" },
      });
      expect(first.status).toBe(201);
      const variant = await call<{ admin_note: string | null }>(app, "POST", "/api/wallet/topups", {
        token: signUserToken({ userId: user.id }),
        body,
      });
      expect(variant.status).toBe(201);
      expect(variant.body.admin_note).toBeNull();
    };

    // Different amount — e.g. the customer topped up 100 then wanted 50.
    await probe({ amount: 50, payment_network: "libyana", sender_phone: "0912345678" });
    // Different network.
    await probe({ amount: 100, payment_network: "madar", sender_phone: "0912345678" });
    // Different sender phone.
    await probe({ amount: 100, payment_network: "libyana", sender_phone: "0923456789" });
  });

  it("an APPROVED sibling within 24h also raises the signal; siblings are probe-visible regardless of their own reference", async () => {
    const user = await seedUser();
    const token = signUserToken({ userId: user.id });

    // Approved sibling (same amount/network/sender, ref-less, < 24h old).
    await db.insert(walletTopupsTable).values({
      userId: user.id,
      amount: "100.00",
      paymentMethod: "mobile_transfer",
      paymentNetwork: "libyana",
      senderPhone: "912345678",
      paymentReference: null,
      status: "approved",
    });
    const risky = await call<{ admin_note: string | null }>(app, "POST", "/api/wallet/topups", {
      token,
      body: { amount: 100, payment_network: "libyana", sender_phone: "0912345678" },
    });
    expect(risky.status).toBe(201);
    expect(risky.body.admin_note).toContain("خطر تكرار محتمل");

    // A sibling that itself carries a REFERENCE still counts toward the
    // probe — the risk being signaled is THIS transfer being a repeat; a
    // receipt-verified earlier sibling makes a matching new submission
    // MORE suspicious, not less. (Referenced rows keep their own exact-ref
    // battery; this signal is about the ref-less newcomer.)
    const other = await seedUser();
    const otherToken = signUserToken({ userId: other.id });
    await db.insert(walletTopupsTable).values({
      userId: other.id,
      amount: "100.00",
      paymentMethod: "mobile_transfer",
      paymentNetwork: "libyana",
      senderPhone: "912345678",
      paymentReference: "LEGACY-REF-1",
      status: "pending",
    });
    const refSibling = await call<{ admin_note: string | null }>(
      app,
      "POST",
      "/api/wallet/topups",
      {
        token: otherToken,
        body: { amount: 100, payment_network: "libyana", sender_phone: "0912345678" },
      },
    );
    expect(refSibling.status).toBe(201);
    expect(refSibling.body.admin_note).toContain("خطر تكرار محتمل");

    // Cross-USER isolation — a THIRD user with no history submits the same
    // (amount, network, sender) shape and gets NO signal: the probe is
    // user-scoped, so another user's matching rows never raise it.
    const third = await seedUser();
    const isolated = await call<{ admin_note: string | null }>(app, "POST", "/api/wallet/topups", {
      token: signUserToken({ userId: third.id }),
      body: { amount: 100, payment_network: "libyana", sender_phone: "0912345678" },
    });
    expect(isolated.status).toBe(201);
    expect(isolated.body.admin_note).toBeNull();
  });

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
    // R154: the reference-based creation guard stays verbatim for
    // REFERENCED records (legacy clients + lypay receipts) — the retirement
    // of the storefront field changes nothing for this battery.
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
