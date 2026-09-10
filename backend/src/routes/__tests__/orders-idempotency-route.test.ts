import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  db,
  initTestDb,
  resetTestDb,
  inventoryTable,
  ordersTable,
  productsTable,
  usersTable,
} from "../../test/db";
import { signUserToken } from "../../lib/jwt";
import { ordersRouter } from "../orders";
import { notifyNewOrder } from "../../telegram";
import { CheckoutService } from "../../services/checkout.service";

/**
 * F10 / F4 route wiring (round-94 C4 → C5):
 *
 *  - POST /api/orders passes the raw `Idempotency-Key` header into
 *    CheckoutService.purchase (the durable in-tx guard). A retry with
 *    the same key REPLAYS the original order: 200 (not 201),
 *    `Idempotent-Replayed: true`, no second charge, no second
 *    new-order notification.
 *
 *  - `result.code === "PRODUCT_STALE"` maps to 409 with the re-price
 *    message (F4: product price/active/archive changed mid-purchase).
 *
 *  - A7: the user orders surface carries Cache-Control: no-store.
 */
vi.mock("../../telegram", () => ({
  notifyNewOrder: vi.fn(),
}));

const IDEMPOTENCY_DDL = `
CREATE TABLE idempotency_keys (
  key text PRIMARY KEY,
  order_id integer NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
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
        reject(new Error("no address"));
        return;
      }
      resolve({ url: `http://127.0.0.1:${addr.port}`, close: () => server.close() });
    });
  });
}

let phoneSeq = 94_600_000;
async function seedUser(balance = "50.00"): Promise<{ id: number; token: string }> {
  phoneSeq += 1;
  const [u] = await db
    .insert(usersTable)
    .values({ phone: String(phoneSeq), walletBalance: balance })
    .returning();
  return { id: u.id, token: signUserToken({ userId: u.id }) };
}

async function seedProductWithStock(price = "10.00"): Promise<number> {
  const [p] = await db.insert(productsTable).values({ name: "Idem Product", price }).returning();
  await db.insert(inventoryTable).values({
    productId: p.id,
    accountEmail: "idem@test.local",
    accountPassword: "pw-idem",
  });
  return p.id;
}

async function post(
  url: string,
  token: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: Headers; body: unknown }> {
  const res = await fetch(`${url}/api/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `auth_token=${token}`, ...headers },
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

beforeAll(async () => {
  await initTestDb();
  await db.execute(sql.raw(IDEMPOTENCY_DDL));
});

beforeEach(async () => {
  await resetTestDb();
  await db.execute(sql.raw("TRUNCATE idempotency_keys"));
  vi.clearAllMocks();
  // Re-arm the 42P01 probe (the service latches "table missing" per boot).
  const { __resetIdempotencyTableProbeForTests } = await import("../../lib/idempotency");
  __resetIdempotencyTableProbeForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/orders — durable idempotency wiring (F10)", () => {
  it("first purchase: 201, charges once, notifies once", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const { id: userId, token } = await seedUser();
      const productId = await seedProductWithStock();
      const key = { "Idempotency-Key": "route idem key 0001" };

      const res = await post(url, token, { product_id: productId }, key);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: "completed" });
      expect(await balanceOf(userId)).toBe(40);
      expect(notifyNewOrder).toHaveBeenCalledTimes(1);
    } finally {
      close();
    }
  });

  it("retry with the same key: 200 + Idempotent-Replayed, no second charge, no second notification", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const { id: userId, token } = await seedUser();
      const productId = await seedProductWithStock();
      const key = { "Idempotency-Key": "route idem key 0002" };

      const first = await post(url, token, { product_id: productId }, key);
      expect(first.status).toBe(201);
      const firstOrderId = (first.body as { id: number }).id;

      // No Redis here — the HTTP-layer cache is a pass-through, so the
      // durable in-tx guard (idempotency_keys) is what replays.
      const retry = await post(url, token, { product_id: productId }, key);
      expect(retry.status).toBe(200);
      expect(retry.headers.get("Idempotent-Replayed")).toBe("true");
      expect((retry.body as { id: number }).id).toBe(firstOrderId);

      // Exactly one charge, one order, one notification.
      expect(await balanceOf(userId)).toBe(40);
      const rows = await db
        .select({ id: ordersTable.id })
        .from(ordersTable)
        .where(eq(ordersTable.userId, userId));
      expect(rows).toHaveLength(1);
      expect(notifyNewOrder).toHaveBeenCalledTimes(1);
    } finally {
      close();
    }
  });

  it("retries WITHOUT a key still purchase normally (legacy pass-through)", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const { id: userId, token } = await seedUser();
      const productId = await seedProductWithStock();

      const res = await post(url, token, { product_id: productId });
      expect(res.status).toBe(201);
      expect(await balanceOf(userId)).toBe(40);
    } finally {
      close();
    }
  });
});

describe("POST /api/orders — PRODUCT_STALE mapping (F4)", () => {
  it("maps CONCURRENCY_ERROR + code=PRODUCT_STALE to 409 with the re-price message", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const { token } = await seedUser();
      const productId = await seedProductWithStock();

      const spy = vi.spyOn(CheckoutService, "purchase").mockResolvedValue({
        ok: false,
        reason: "CONCURRENCY_ERROR",
        code: "PRODUCT_STALE",
      });

      const res = await post(url, token, { product_id: productId });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: "CONFLICT" });
      expect((res.body as { error: string }).error).toContain("تغيّرت بيانات المنتج");
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ productId, idempotencyKey: undefined }),
      );
    } finally {
      close();
    }
  });

  it("forwards the Idempotency-Key header into CheckoutService.purchase", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const { token } = await seedUser();
      const productId = await seedProductWithStock();

      const spy = vi.spyOn(CheckoutService, "purchase").mockResolvedValue({
        ok: false,
        reason: "PRODUCT_NOT_FOUND",
      });

      await post(url, token, { product_id: productId }, { "Idempotency-Key": "header fwd 123456" });
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: "header fwd 123456" }),
      );
    } finally {
      close();
    }
  });
});

describe("GET /api/orders — Cache-Control (A7)", () => {
  it("serves the user orders surface with Cache-Control: no-store", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const { token } = await seedUser();
      const res = await fetch(`${url}/api/orders`, {
        headers: { Cookie: `auth_token=${token}` },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
    } finally {
      close();
    }
  });
});
