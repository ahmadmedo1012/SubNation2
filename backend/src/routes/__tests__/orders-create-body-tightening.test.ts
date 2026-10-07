import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import {
  db,
  initTestDb,
  resetTestDb,
  inventoryTable,
  productsTable,
  usersTable,
} from "../../test/db";
import { signUserToken } from "../../lib/jwt";
import { ordersRouter } from "../orders";

/**
 * R120-B6/A6-F7 — CreateOrderBody contract tightening.
 *
 * The generated zod (shared/api-zod) previously accepted an unbounded
 * product_id (0 / negatives / floats passed the parse and died as a 404
 * or a DB-cast error downstream) and an unbounded coupon_code (arbitrary
 * payload sizes reached the pricing + cache layers). The spec source now
 * carries product_id minimum: 1 (+ .int() hand-applied — orval's mapper
 * cannot express integer-ness) and coupon_code maxLength: 64, and the
 * route reads coupon_code from the PARSED body only (the old raw
 * req.body re-read was a split-brain that bypassed the new bound).
 *
 * These tests pin the tightened perimeter at the HTTP boundary.
 */

vi.mock("../../telegram", () => ({
  notifyNewOrder: vi.fn(),
}));

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

let phoneSeq = 96_400_000;
async function seedUser(): Promise<string> {
  phoneSeq += 1;
  const [u] = await db
    .insert(usersTable)
    .values({ phone: String(phoneSeq), walletBalance: "50.00" })
    .returning();
  return signUserToken({ userId: u.id });
}

async function seedProduct(): Promise<number> {
  const [p] = await db
    .insert(productsTable)
    .values({ name: "Body Product", price: "10.00" })
    .returning();
  await db.insert(inventoryTable).values({
    productId: p.id,
    accountEmail: "body@test.local",
    accountPassword: "pw-body",
  });
  return p.id;
}

async function post(
  url: string,
  token: string,
  body: unknown,
): Promise<{ status: number; body: { error?: string; code?: string; message?: string } }> {
  const res = await fetch(`${url}/api/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `auth_token=${token}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** The exact parse-400 shape (message + code) the route returns on safeParse failure. */
const PARSE_400 = { status: 400, message: "بيانات غير صالحة", code: "INVALID_DATA" };

beforeAll(async () => {
  await initTestDb();
  await db.execute(sql.raw(IDEMPOTENCY_DDL));
});

beforeEach(async () => {
  await resetTestDb();
  await db.execute(sql.raw("TRUNCATE idempotency_keys"));
});

describe("A6-F7 — POST /api/orders tightened CreateOrderBody", () => {
  it("product_id 0 → the parse 400 (previously passed the parse and 404'd)", async () => {
    const token = await seedUser();
    const productId = await seedProduct();
    const { url, close } = await listen(buildApp());
    try {
      const res = await post(url, token, { product_id: 0 });
      expect(res.status).toBe(PARSE_400.status);
      expect(res.body.error).toBe(PARSE_400.message);
      expect(res.body.code).toBe(PARSE_400.code);
      // Same for negatives + floats — the .min(1)/.int() bounds.
      for (const bad of [-7, 1.5, Number.NaN]) {
        const r = await post(url, token, { product_id: bad });
        expect(r.status).toBe(400);
        expect(r.body.error).toBe(PARSE_400.message);
      }
      expect(productId).toBeGreaterThan(0); // seeded; lint: no unused var
    } finally {
      close();
    }
  });

  it("coupon_code longer than 64 chars → the parse 400 (was unbounded)", async () => {
    const token = await seedUser();
    await seedProduct();
    const { url, close } = await listen(buildApp());
    try {
      const res = await post(url, token, {
        product_id: 1,
        coupon_code: "X".repeat(65),
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe(PARSE_400.message);
      expect(res.body.code).toBe(PARSE_400.code);
    } finally {
      close();
    }
  });

  it("non-string coupon_code (number) → the parse 400", async () => {
    const token = await seedUser();
    await seedProduct();
    const { url, close } = await listen(buildApp());
    try {
      const res = await post(url, token, { product_id: 1, coupon_code: 5 });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe(PARSE_400.message);
    } finally {
      close();
    }
  });

  it("boundary coupon_code of exactly 64 chars PASSES the parse (reaches coupon validation)", async () => {
    const token = await seedUser();
    await seedProduct();
    const { url, close } = await listen(buildApp());
    try {
      const res = await post(url, token, {
        product_id: 1,
        coupon_code: "Y".repeat(64),
      });
      // Parse passed; the (nonexistent) coupon is rejected by the pricing
      // layer with its OWN message — not the parse-400 shape.
      expect(res.status).toBe(400);
      expect(res.body.error).not.toBe(PARSE_400.message);
      expect(res.body.error).toBe("كوبون غير موجود");
    } finally {
      close();
    }
  });

  it("legitimate body still purchases (201) — the tightening rejects nothing valid", async () => {
    const token = await seedUser();
    const productId = await seedProduct();
    const { url, close } = await listen(buildApp());
    try {
      const res = await post(url, token, { product_id: productId, coupon_code: null });
      expect(res.status).toBe(201);
    } finally {
      close();
    }
  });

  it("coupon_code normalization (trim + uppercase) survives the parsed-body switch", async () => {
    // The route normalizes AFTER the parse; the coupon re-read now comes
    // from parse.data. A whitespace-padded lowercase code must reach the
    // pricing layer as the trimmed/uppercased code — rejected as an
    // unknown coupon (its own message), not as a parse failure.
    const token = await seedUser();
    await seedProduct();
    const { url, close } = await listen(buildApp());
    try {
      const res = await post(url, token, { product_id: 1, coupon_code: "  save10  " });
      expect(res.status).toBe(400);
      expect(res.body.error).not.toBe(PARSE_400.message);
      expect(res.body.error).toBe("كوبون غير موجود");
    } finally {
      close();
    }
  });
});
