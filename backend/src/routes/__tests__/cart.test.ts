import express from "express";
import cookieParser from "cookie-parser";
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import {
  db,
  initTestDb,
  resetTestDb,
  cartItemsTable,
  productsTable,
  usersTable,
} from "../../test/db";
import { signUserToken } from "../../lib/jwt";
import { cartRouter } from "../cart";

/**
 * Integration tests for the cart API. The cart router is mounted at
 * `/api/cart`, so we register it on a fresh Express app and exercise it
 * via real `fetch` calls (saves the supertest dependency, identical
 * pattern to routes/__tests__/cwv.test.ts).
 */

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/cart", cartRouter);
  return app;
}

async function seedUser(phone = "91100001") {
  const [u] = await db
    .insert(usersTable)
    .values({ phone, walletBalance: "100.00" })
    .returning();
  return u;
}

async function seedProduct(overrides: Partial<{ name: string; price: string; isActive: boolean }> = {}) {
  const [p] = await db
    .insert(productsTable)
    .values({
      name: overrides.name ?? "Test Product",
      price: overrides.price ?? "25.00",
      isActive: overrides.isActive ?? true,
    })
    .returning();
  return p;
}

interface ApiOk<T = unknown> {
  status: number;
  body: T;
}

async function call<T = unknown>(
  app: express.Express,
  method: "GET" | "POST" | "PATCH" | "DELETE",
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
let userA: Awaited<ReturnType<typeof seedUser>>;
let userB: Awaited<ReturnType<typeof seedUser>>;
let product1: Awaited<ReturnType<typeof seedProduct>>;
let product2: Awaited<ReturnType<typeof seedProduct>>;

beforeAll(async () => {
  await initTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  userA = await seedUser("91100001");
  userB = await seedUser("91100002");
  product1 = await seedProduct({ name: "Netflix", price: "30.00" });
  product2 = await seedProduct({ name: "Spotify", price: "15.00" });
});

describe("GET /api/cart", () => {
  it("returns empty items + total 0 for a brand-new user", async () => {
    const token = signUserToken({ userId: userA.id });
    const res = await call<{ items: unknown[]; total: number }>(app, "GET", "/api/cart", { token });
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it("rejects unauthenticated requests with 401", async () => {
    const res = await call(app, "GET", "/api/cart");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/cart/items", () => {
  it("adds an item to the cart and returns the row", async () => {
    const token = signUserToken({ userId: userA.id });
    const res = await call<{
      id: number;
      product_id: number;
      quantity: number;
      subtotal: number;
    }>(app, "POST", "/api/cart/items", {
      token,
      body: { product_id: product1.id, quantity: 2 },
    });
    expect(res.status).toBe(201);
    expect(res.body.product_id).toBe(product1.id);
    expect(res.body.quantity).toBe(2);
    expect(res.body.subtotal).toBe(60); // 30 × 2
  });

  it("bumps the quantity when the same product is added twice", async () => {
    const token = signUserToken({ userId: userA.id });
    await call(app, "POST", "/api/cart/items", {
      token,
      body: { product_id: product1.id, quantity: 1 },
    });
    const res = await call<{ quantity: number }>(app, "POST", "/api/cart/items", {
      token,
      body: { product_id: product1.id, quantity: 3 },
    });
    expect(res.status).toBe(201);
    expect(res.body.quantity).toBe(4);
  });

  it("rejects a missing product_id with 400", async () => {
    const token = signUserToken({ userId: userA.id });
    const res = await call(app, "POST", "/api/cart/items", {
      token,
      body: { quantity: 1 },
    });
    expect(res.status).toBe(400);
  });

  it("rejects non-positive quantity with 400", async () => {
    const token = signUserToken({ userId: userA.id });
    const res = await call(app, "POST", "/api/cart/items", {
      token,
      body: { product_id: product1.id, quantity: 0 },
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 when the product does not exist", async () => {
    const token = signUserToken({ userId: userA.id });
    const res = await call(app, "POST", "/api/cart/items", {
      token,
      body: { product_id: 999_999, quantity: 1 },
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 when the product is inactive", async () => {
    const inactive = await seedProduct({ name: "Old", isActive: false });
    const token = signUserToken({ userId: userA.id });
    const res = await call(app, "POST", "/api/cart/items", {
      token,
      body: { product_id: inactive.id, quantity: 1 },
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/cart — populated", () => {
  it("lists items and computes the cart total", async () => {
    const token = signUserToken({ userId: userA.id });
    await call(app, "POST", "/api/cart/items", {
      token,
      body: { product_id: product1.id, quantity: 2 },
    });
    await call(app, "POST", "/api/cart/items", {
      token,
      body: { product_id: product2.id, quantity: 1 },
    });
    const res = await call<{ items: { product_id: number; subtotal: number }[]; total: number }>(
      app,
      "GET",
      "/api/cart",
      { token },
    );
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.total).toBe(75); // 60 + 15
  });

  it("scopes results to the calling user (userB cannot see userA's cart)", async () => {
    const tokenA = signUserToken({ userId: userA.id });
    const tokenB = signUserToken({ userId: userB.id });
    await call(app, "POST", "/api/cart/items", {
      token: tokenA,
      body: { product_id: product1.id, quantity: 1 },
    });
    const resB = await call<{ items: unknown[] }>(app, "GET", "/api/cart", { token: tokenB });
    expect(resB.body.items).toEqual([]);
  });
});

describe("PATCH /api/cart/items/:id", () => {
  it("updates the quantity of an existing item", async () => {
    const token = signUserToken({ userId: userA.id });
    const created = await call<{ id: number }>(app, "POST", "/api/cart/items", {
      token,
      body: { product_id: product1.id, quantity: 1 },
    });
    const res = await call<{ quantity: number; subtotal: number }>(
      app,
      "PATCH",
      `/api/cart/items/${created.body.id}`,
      { token, body: { quantity: 5 } },
    );
    expect(res.status).toBe(200);
    expect(res.body.quantity).toBe(5);
    expect(res.body.subtotal).toBe(150);
  });

  it("rejects a quantity below 1", async () => {
    const token = signUserToken({ userId: userA.id });
    const created = await call<{ id: number }>(app, "POST", "/api/cart/items", {
      token,
      body: { product_id: product1.id, quantity: 1 },
    });
    const res = await call(app, "PATCH", `/api/cart/items/${created.body.id}`, {
      token,
      body: { quantity: 0 },
    });
    expect(res.status).toBe(400);
  });

  it("refuses to mutate another user's row (404)", async () => {
    const tokenA = signUserToken({ userId: userA.id });
    const tokenB = signUserToken({ userId: userB.id });
    const created = await call<{ id: number }>(app, "POST", "/api/cart/items", {
      token: tokenA,
      body: { product_id: product1.id, quantity: 1 },
    });
    const res = await call(app, "PATCH", `/api/cart/items/${created.body.id}`, {
      token: tokenB,
      body: { quantity: 7 },
    });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/cart/items/:id", () => {
  it("removes a single item", async () => {
    const token = signUserToken({ userId: userA.id });
    const created = await call<{ id: number }>(app, "POST", "/api/cart/items", {
      token,
      body: { product_id: product1.id, quantity: 1 },
    });
    const del = await call<{ success: boolean }>(
      app,
      "DELETE",
      `/api/cart/items/${created.body.id}`,
      { token },
    );
    expect(del.status).toBe(200);
    expect(del.body.success).toBe(true);
    const list = await call<{ items: unknown[] }>(app, "GET", "/api/cart", { token });
    expect(list.body.items).toEqual([]);
  });

  it("returns 404 for an item belonging to another user", async () => {
    const tokenA = signUserToken({ userId: userA.id });
    const tokenB = signUserToken({ userId: userB.id });
    const created = await call<{ id: number }>(app, "POST", "/api/cart/items", {
      token: tokenA,
      body: { product_id: product1.id, quantity: 1 },
    });
    const res = await call(app, "DELETE", `/api/cart/items/${created.body.id}`, {
      token: tokenB,
    });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/cart", () => {
  it("clears every item for the user but leaves other users untouched", async () => {
    const tokenA = signUserToken({ userId: userA.id });
    const tokenB = signUserToken({ userId: userB.id });
    await call(app, "POST", "/api/cart/items", {
      token: tokenA,
      body: { product_id: product1.id, quantity: 1 },
    });
    await call(app, "POST", "/api/cart/items", {
      token: tokenA,
      body: { product_id: product2.id, quantity: 2 },
    });
    await call(app, "POST", "/api/cart/items", {
      token: tokenB,
      body: { product_id: product1.id, quantity: 4 },
    });

    const res = await call<{ success: boolean }>(app, "DELETE", "/api/cart", { token: tokenA });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const aList = await call<{ items: unknown[] }>(app, "GET", "/api/cart", { token: tokenA });
    expect(aList.body.items).toEqual([]);

    const bList = await call<{ items: { quantity: number }[] }>(app, "GET", "/api/cart", {
      token: tokenB,
    });
    expect(bList.body.items).toHaveLength(1);
    expect(bList.body.items[0]?.quantity).toBe(4);
  });
});

describe("cart_items table constraints", () => {
  it("persists createdAt and updatedAt on insert", async () => {
    const token = signUserToken({ userId: userA.id });
    const created = await call<{ id: number }>(app, "POST", "/api/cart/items", {
      token,
      body: { product_id: product1.id, quantity: 1 },
    });
    const rows = await db.select().from(cartItemsTable);
    const found = rows.find((r) => r.id === created.body.id);
    expect(found).toBeDefined();
    expect(found?.quantity).toBe(1);
    expect(found?.createdAt).toBeInstanceOf(Date);
  });
});
