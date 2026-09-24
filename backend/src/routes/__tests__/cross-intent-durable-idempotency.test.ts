import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { count, eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  db,
  execTestSql,
  initTestDb,
  resetTestDb,
  usersTable,
  productsTable,
  inventoryTable,
  ordersTable,
  walletTopupsTable,
  idempotencyKeysTable,
} from "../../test/db";
import { signUserToken } from "../../lib/jwt";
import { __resetIdempotencyTableProbeForTests } from "../../lib/idempotency";
import { ordersRouter } from "../orders";
import { walletRouter } from "../wallet";

vi.mock("../../telegram", () => ({
  notifyNewOrder: vi.fn(),
  notifyNewTopup: vi.fn(),
  notifyCouponMaxedOut: vi.fn(),
}));

/**
 * R110 (109-f P3) — cross-intent durable Idempotency-Key reuse.
 *
 * The durable guard stores claims under `u{userId}:{key}` with NO
 * intent component in the PRIMARY KEY — the intent only rides the
 * reference_type discriminator. A client reusing ONE Idempotency-Key
 * across two different money intents (checkout, then topup — and the
 * reverse) therefore collides on the PK. The contract under that
 * collision, pinned here for both directions:
 *
 *   - the second intent is classified as a 409 conflict, never a
 *     replay of the other intent's row (the referenceType filter keeps
 *     the lookups disjoint);
 *   - its transaction rolls back COMPLETELY — no second pending topup,
 *     no second order, no second debit;
 *   - the first intent's claim remains the only idempotency_keys row.
 *
 * No Redis is mocked — REDIS_URL is unset, the production/target shape
 * where the HTTP middleware is a pass-through and the durable layer is
 * the only dedup (same harness as wallet-topups-durable-idempotency).
 */

// The V1-M20 (post-fix) shape: order_id is a plain integer column —
// reference_type-discriminated, app-owned integrity, no FK.
const IDEMPOTENCY_DDL = `
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key text PRIMARY KEY,
  order_id integer,
  reference_type varchar(32) NOT NULL DEFAULT 'order',
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/orders", ordersRouter);
  app.use("/api/wallet", walletRouter);
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

let phoneSeq = 93_200_000;
async function seedUser(balance = "50.00"): Promise<{ id: number; token: string }> {
  phoneSeq += 1;
  const [u] = await db
    .insert(usersTable)
    .values({ phone: String(phoneSeq), walletBalance: balance })
    .returning();
  return { id: u.id, token: signUserToken({ userId: u.id }) };
}

async function seedProductWithStock(price = "10.00"): Promise<number> {
  const [p] = await db
    .insert(productsTable)
    .values({ name: "Cross-Intent Product", price })
    .returning();
  await db.insert(inventoryTable).values({
    productId: p.id,
    accountEmail: "cross-intent@test.local",
    accountPassword: "pw-cross-intent",
  });
  return p.id;
}

function topupBody() {
  // B4-R1 (R111): mobile_transfer requires a payment_reference now; each
  // test uses its own key so a single fixed receipt per call site is fine.
  return {
    amount: 50,
    payment_method: "mobile_transfer",
    payment_network: "madar",
    sender_phone: "0913456789",
    payment_reference: "TRX-CROSS-INTENT-1",
  };
}

async function postJson(
  url: string,
  path: string,
  token: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: Headers; body: unknown }> {
  const res = await fetch(`${url}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `auth_token=${token}`,
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}

async function balanceOf(userId: number): Promise<number> {
  const [row] = await db
    .select({ b: usersTable.walletBalance })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  return parseFloat(String(row.b));
}

async function orderCount(userId: number): Promise<number> {
  const [row] = await db
    .select({ c: count() })
    .from(ordersTable)
    .where(eq(ordersTable.userId, userId));
  return Number(row?.c ?? 0);
}

async function pendingTopupCount(userId: number): Promise<number> {
  const [row] = await db
    .select({ c: count() })
    .from(walletTopupsTable)
    .where(eq(walletTopupsTable.userId, userId));
  return Number(row?.c ?? 0);
}

beforeAll(async () => {
  await initTestDb();
  await execTestSql(IDEMPOTENCY_DDL);
  __resetIdempotencyTableProbeForTests();
});

beforeEach(async () => {
  await resetTestDb();
  await db.execute(sql.raw("TRUNCATE idempotency_keys"));
  vi.clearAllMocks();
  // The probe latches per boot; re-arm after the (re)created table.
  __resetIdempotencyTableProbeForTests();
});

describe("R110 — one Idempotency-Key reused across orders ↔ topups (durable layer)", () => {
  it("checkout then topup with the same key → topup 409, no second row, no replay", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const { id: userId, token } = await seedUser();
      const productId = await seedProductWithStock();
      const key = { "Idempotency-Key": "cross intent key 0001" };

      // First intent: the checkout claims the key ('order') atomically
      // with the debit — 201, charged once.
      const checkout = await postJson(url, "/api/orders", token, { product_id: productId }, key);
      expect(checkout.status).toBe(201);
      expect(await balanceOf(userId)).toBe(40);

      // Second intent, SAME key: the pre-tx 'topup.create' lookup misses
      // (referenceType keeps intents disjoint), the in-tx claim hits the
      // PK held by the order → the whole submission rolls back and is
      // classified as a 409 — never a replay of the order.
      const topup = await postJson(url, "/api/wallet/topups", token, topupBody(), key);
      expect(topup.status).toBe(409);
      expect(topup.body).toMatchObject({ code: "CONFLICT" });

      // No double effect: one order, zero pending topups, one debit,
      // and the single claim is still the order's.
      expect(await orderCount(userId)).toBe(1);
      expect(await pendingTopupCount(userId)).toBe(0);
      expect(await balanceOf(userId)).toBe(40);
      const claims = await db.select().from(idempotencyKeysTable);
      expect(claims).toHaveLength(1);
      expect(claims[0].referenceType).toBe("order");
    } finally {
      close();
    }
  });

  it("topup then checkout with the same key → checkout 409, purchase tx fully rolled back", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const { id: userId, token } = await seedUser();
      const productId = await seedProductWithStock();
      const key = { "Idempotency-Key": "cross intent key 0002" };

      // First intent: the topup claims the key ('topup.create')
      // atomically with the pending row.
      const topup = await postJson(url, "/api/wallet/topups", token, topupBody(), key);
      expect(topup.status).toBe(201);
      expect(await pendingTopupCount(userId)).toBe(1);

      // Second intent, SAME key: the checkout's pre-tx 'order' lookup
      // misses, the in-tx claim collides with the topup's PK → the ENTIRE
      // purchase transaction (debit + order + ledger) rolls back and the
      // route answers the retryable 409 (CONCURRENCY_ERROR → CONFLICT).
      const checkout = await postJson(url, "/api/orders", token, { product_id: productId }, key);
      expect(checkout.status).toBe(409);
      expect(checkout.body).toMatchObject({ code: "CONFLICT" });

      // No double effect: no order was created, the wallet debit was
      // rolled back, the pending topup survives, and the claim is still
      // the topup's.
      expect(await orderCount(userId)).toBe(0);
      expect(await balanceOf(userId)).toBe(50);
      expect(await pendingTopupCount(userId)).toBe(1);
      const claims = await db.select().from(idempotencyKeysTable);
      expect(claims).toHaveLength(1);
      expect(claims[0].referenceType).toBe("topup.create");
    } finally {
      close();
    }
  });
});
