/**
 * R159 — GET /api/admin/orders ?sort= (the orders sort affordance ledger
 * item the R158 round deferred: "needs backend param").
 *
 * The admin orders list is SERVER-paginated, so the sort must ride the
 * SQL ORDER BY (the users directory's client-side chip sort can only
 * rank the loaded window). Pinned here:
 *
 *   1. ABSENT ?sort= → the frozen default `created_at DESC` —
 *      byte-identical to pre-R159 (the param is additive).
 *   2. each whitelisted key/direction orders by that column:
 *      created_at:asc / created_at:desc / total:asc / total:desc
 *      (`total` = the orders.amount column; the DTO key stays `amount`).
 *   3. amount TIES break on `id DESC` — Postgres's sort is not stable
 *      across LIMIT/OFFSET pages, and equal amounts are the common case
 *      (fixed-price products); without the tiebreaker the accumulating
 *      load-more client could duplicate or drop rows across pages.
 *   4. unknown key/direction → 400 INVALID_DATA (the ?status= family
 *      idiom — never a Postgres error, never a silently ignored value).
 *   5. composes with the ?status= filter.
 *
 * Runs against the REAL adminOrdersRouter over the pglite harness (same
 * mount pattern as admin-orders-credentials.test.ts).
 */

import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { signAdminToken } from "../../lib/jwt";
import { adminOrdersRouter } from "../admin/orders";
import {
  adminUsersTable,
  db,
  initTestDb,
  ordersTable,
  productsTable,
  resetTestDb,
  usersTable,
} from "../../test/db";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/admin", adminOrdersRouter);
  return app;
}

const app = buildApp();

beforeAll(async () => {
  await initTestDb();
});
beforeEach(async () => {
  await resetTestDb();
});

let phoneSeq = 91_800_000;
function nextPhone(): string {
  phoneSeq += 1;
  return String(phoneSeq);
}

async function seedAdmin(): Promise<string> {
  const [a] = await db
    .insert(adminUsersTable)
    .values({
      username: `admin_sort_${Math.floor(Math.random() * 1e6)}`,
      passwordHash: "x",
      isActive: true,
      permissions: ["orders"],
    })
    .returning();
  return signAdminToken({ adminId: a.id, role: "admin" });
}

interface SeedSpec {
  amount: string;
  createdAt: Date;
  status?: "pending" | "completed" | "failed" | "refunded";
}

/** One user + product + the given orders (ids ascend with insertion). */
async function seedOrders(specs: SeedSpec[]): Promise<number[]> {
  const [user] = await db.insert(usersTable).values({ phone: nextPhone() }).returning();
  const [product] = await db
    .insert(productsTable)
    .values({ name: `P-${Math.floor(Math.random() * 1e6)}`, price: "30.00" })
    .returning();
  const ids: number[] = [];
  for (const spec of specs) {
    const [order] = await db
      .insert(ordersTable)
      .values({
        orderCode: `R159-${Math.floor(Math.random() * 1e9)}`,
        userId: user.id,
        productId: product.id,
        amount: spec.amount,
        status: spec.status ?? "completed",
        createdAt: spec.createdAt,
      })
      .returning({ id: ordersTable.id });
    ids.push(order.id);
  }
  return ids;
}

async function listen(): Promise<{ url: string; close: () => void }> {
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

async function getJson(url: string, path: string, token?: string) {
  const res = await fetch(`${url}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** Row order as `amount` values (numeric strings sort by value here — the
 * seeds use whole LYD amounts distinct per test). */
const amountsOf = (body: Array<{ amount: number }>) => body.map((r) => r.amount);

describe("R159: GET /api/admin/orders ?sort= — the validated column sort", () => {
  it("ABSENT ?sort= keeps the frozen default: created_at DESC (newest first)", async () => {
    const { url, close } = await listen();
    try {
      const token = await seedAdmin();
      // Inserted oldest→newest; ids [1,2,3] map to t1<t2<t3.
      await seedOrders([
        { amount: "30.00", createdAt: new Date("2026-09-01T10:00:00Z") },
        { amount: "10.00", createdAt: new Date("2026-09-02T10:00:00Z") },
        { amount: "20.00", createdAt: new Date("2026-09-03T10:00:00Z") },
      ]);

      const res = await getJson(url, "/api/admin/orders?limit=10", token);
      expect(res.status).toBe(200);
      expect(amountsOf(res.body)).toEqual([20, 10, 30]);
    } finally {
      close();
    }
  });

  it("created_at:asc → oldest first; created_at:desc → newest first", async () => {
    const { url, close } = await listen();
    try {
      const token = await seedAdmin();
      await seedOrders([
        { amount: "30.00", createdAt: new Date("2026-09-01T10:00:00Z") },
        { amount: "10.00", createdAt: new Date("2026-09-02T10:00:00Z") },
        { amount: "20.00", createdAt: new Date("2026-09-03T10:00:00Z") },
      ]);

      const asc = await getJson(url, "/api/admin/orders?limit=10&sort=created_at%3Aasc", token);
      expect(asc.status).toBe(200);
      expect(amountsOf(asc.body)).toEqual([30, 10, 20]);

      const desc = await getJson(url, "/api/admin/orders?limit=10&sort=created_at%3Adesc", token);
      expect(desc.status).toBe(200);
      expect(amountsOf(desc.body)).toEqual([20, 10, 30]);
    } finally {
      close();
    }
  });

  it("total:asc / total:desc order by the order amount (URL `total` = DTO `amount`)", async () => {
    const { url, close } = await listen();
    try {
      const token = await seedAdmin();
      await seedOrders([
        { amount: "30.00", createdAt: new Date("2026-09-01T10:00:00Z") },
        { amount: "10.00", createdAt: new Date("2026-09-02T10:00:00Z") },
        { amount: "20.00", createdAt: new Date("2026-09-03T10:00:00Z") },
      ]);

      const asc = await getJson(url, "/api/admin/orders?limit=10&sort=total%3Aasc", token);
      expect(asc.status).toBe(200);
      expect(amountsOf(asc.body)).toEqual([10, 20, 30]);

      const desc = await getJson(url, "/api/admin/orders?limit=10&sort=total%3Adesc", token);
      expect(desc.status).toBe(200);
      expect(amountsOf(desc.body)).toEqual([30, 20, 10]);
    } finally {
      close();
    }
  });

  it("amount TIES break on id DESC, stable across LIMIT/OFFSET pages (the load-more contract)", async () => {
    const { url, close } = await listen();
    try {
      const token = await seedAdmin();
      // Five identical-amount orders — the fixed-price-product common
      // case. ids ascend with insertion, so the id DESC tiebreaker must
      // page them [5,4] / [3,2] / [1] with no duplicate or drop.
      const ids = await seedOrders(
        Array.from({ length: 5 }, (_, i) => ({
          amount: "10.00",
          createdAt: new Date(`2026-09-0${i + 1}T10:00:00Z`),
        })),
      );
      const expectDesc = ids.slice().reverse();

      const pages: number[][] = [];
      for (const page of [1, 2, 3]) {
        const res = await getJson(
          url,
          `/api/admin/orders?limit=2&page=${page}&sort=total%3Adesc`,
          token,
        );
        expect(res.status).toBe(200);
        pages.push(res.body.map((r: { id: number }) => r.id));
      }
      expect(pages.flat()).toEqual(expectDesc);
    } finally {
      close();
    }
  });

  it("composes with the ?status= filter (sorted within the filtered window)", async () => {
    const { url, close } = await listen();
    try {
      const token = await seedAdmin();
      await seedOrders([
        { amount: "30.00", createdAt: new Date("2026-09-01T10:00:00Z"), status: "pending" },
        { amount: "10.00", createdAt: new Date("2026-09-02T10:00:00Z"), status: "completed" },
        { amount: "20.00", createdAt: new Date("2026-09-03T10:00:00Z"), status: "pending" },
      ]);

      const res = await getJson(
        url,
        "/api/admin/orders?limit=10&status=pending&sort=total%3Aasc",
        token,
      );
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(amountsOf(res.body)).toEqual([20, 30]);
    } finally {
      close();
    }
  });

  it("unknown key or direction → 400 INVALID_DATA with the allowed values (never a silent ignore)", async () => {
    const { url, close } = await listen();
    try {
      const token = await seedAdmin();
      await seedOrders([{ amount: "10.00", createdAt: new Date("2026-09-01T10:00:00Z") }]);

      // Direction typos, unknown keys (incl. the DTO key `amount` — the
      // URL-facing name is `total`), and injection-shaped values.
      for (const bad of [
        "created_at",
        "created_at:up",
        "amount:desc",
        "total",
        "total:asc;DROP",
        "created_at:asc,total:desc",
      ]) {
        const res = await getJson(url, `/api/admin/orders?sort=${encodeURIComponent(bad)}`, token);
        expect(res.status, bad).toBe(400);
        expect(res.body.code, bad).toBe("INVALID_DATA");
        expect(res.body.error).toContain("ترتيب غير صالح");
      }
    } finally {
      close();
    }
  });
});
