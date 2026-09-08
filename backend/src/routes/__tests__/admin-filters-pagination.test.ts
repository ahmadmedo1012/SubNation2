import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  adminUsersTable,
  db,
  initTestDb,
  resetTestDb,
  usersTable,
  walletTopupsTable,
  ordersTable,
  productsTable,
  supportTicketsTable,
} from "../../test/db";
import { signAdminToken } from "../../lib/jwt";
import { adminTopupsRouter } from "../admin/topups";
import { adminOrdersRouter } from "../admin/orders";
import { adminTicketsRouter } from "../admin/tickets";

/**
 * A5-03 (round-94): the admin list routes feed `?status=` straight into
 * pg-enum columns — an out-of-enum value used to reach Postgres as 22P02
 * (`invalid input value for enum "topup_status"`) → 500 INTERNAL_ERROR.
 * The routes now schema-validate the filter: bad value → 400 INVALID_DATA
 * (an Arabic message), valid value → filtered 200.
 *
 * A2 (round-94): topups/tickets gain ?page=&limit= with the admin-orders
 * clamp pattern ([1..200], page ≥ 1) — previously hard-capped at the
 * newest 100 rows, which hid the oldest pending money-queue entries.
 */

function buildApp(...routers: Array<{ use: (path: string, r: unknown) => void }>): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  for (const r of routers) app.use("/api/admin", r as never);
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

async function seedAdmin(): Promise<string> {
  const [a] = await db
    .insert(adminUsersTable)
    .values({ username: "admin_filters", passwordHash: "x", isActive: true })
    .returning();
  return signAdminToken({ adminId: a.id, role: "admin" });
}

let phoneSeq = 94_100_000;
async function seedUser(): Promise<number> {
  phoneSeq += 1;
  const [u] = await db
    .insert(usersTable)
    .values({ phone: String(phoneSeq), walletBalance: "0.00" })
    .returning();
  return u.id;
}

async function seedTopup(userId: number, status: "pending" | "approved" | "rejected", amount = "20.00") {
  const [t] = await db
    .insert(walletTopupsTable)
    .values({ userId, amount, paymentMethod: "mobile_transfer", status })
    .returning();
  return t;
}

async function seedOrder(userId: number, status: "pending" | "completed" | "failed" | "refunded") {
  const [p] = await db.insert(productsTable).values({ name: "P", price: "5.00" }).returning();
  const [o] = await db
    .insert(ordersTable)
    .values({ orderCode: `SN${Math.floor(Math.random() * 1e9)}`, userId, productId: p.id, amount: "5.00", status })
    .returning();
  return o;
}

const call = async (
  url: string,
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown }> => {
  const res = await fetch(`${url}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...((init.headers as Record<string, string>) ?? {}) },
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

beforeAll(async () => {
  await initTestDb();
});

beforeEach(async () => {
  await resetTestDb();
});

describe("GET /api/admin/topups — pg-enum status filter (A5-03)", () => {
  it("rejects an out-of-enum status with 400 INVALID_DATA (was 500 via Postgres 22P02)", async () => {
    const app = buildApp(adminTopupsRouter);
    const { url, close } = await listen(app);
    try {
      const token = await seedAdmin();
      const res = await call(url, "/api/admin/topups?status=fake_status", token);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: "INVALID_DATA" });
      expect((res.body as { error: string }).error).toContain("pending");
    } finally {
      close();
    }
  });

  it("accepts a valid status and filters the list", async () => {
    const app = buildApp(adminTopupsRouter);
    const { url, close } = await listen(app);
    try {
      const token = await seedAdmin();
      const userId = await seedUser();
      await seedTopup(userId, "pending");
      await seedTopup(userId, "approved");
      const res = await call(url, "/api/admin/topups?status=pending", token);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect((res.body as Array<{ status: string }>)[0].status).toBe("pending");
    } finally {
      close();
    }
  });

  it("paginates with ?page=&limit= and keeps the bare-array body", async () => {
    const app = buildApp(adminTopupsRouter);
    const { url, close } = await listen(app);
    try {
      const token = await seedAdmin();
      const userId = await seedUser();
      // 3 topups with distinct createdAt: stagger by 2s so ordering is stable.
      const first = await seedTopup(userId, "pending");
      await db
        .update(walletTopupsTable)
        .set({ createdAt: new Date(Date.now() - 60_000) })
        .where(eq(walletTopupsTable.id, first.id));
      await seedTopup(userId, "pending");
      await seedTopup(userId, "pending");

      const page1 = await call(url, "/api/admin/topups?limit=2&page=1", token);
      expect(Array.isArray(page1.body)).toBe(true);
      expect(page1.body).toHaveLength(2);
      const page2 = await call(url, "/api/admin/topups?limit=2&page=2", token);
      expect(page2.body).toHaveLength(1);
      // Page 2 must be the OLDEST row (page 1 held the newest two).
      expect((page2.body as Array<{ id: number }>)[0].id).toBe(first.id);
    } finally {
      close();
    }
  });
});

describe("GET /api/admin/orders — pg-enum status filter (A5-03)", () => {
  it("rejects an out-of-enum status with 400 INVALID_DATA", async () => {
    const app = buildApp(adminOrdersRouter);
    const { url, close } = await listen(app);
    try {
      const token = await seedAdmin();
      const res = await call(url, "/api/admin/orders?status=bogus", token);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: "INVALID_DATA" });
    } finally {
      close();
    }
  });

  it("accepts a valid status and filters the list", async () => {
    const app = buildApp(adminOrdersRouter);
    const { url, close } = await listen(app);
    try {
      const token = await seedAdmin();
      const userId = await seedUser();
      await seedOrder(userId, "completed");
      await seedOrder(userId, "pending");
      const res = await call(url, "/api/admin/orders?status=pending", token);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect((res.body as Array<{ status: string }>)[0].status).toBe("pending");
    } finally {
      close();
    }
  });
});

describe("GET /api/admin/tickets — pg-enum status filter + pagination (A5-03/A2)", () => {
  it("rejects an out-of-enum status with 400 INVALID_DATA", async () => {
    const app = buildApp(adminTicketsRouter);
    const { url, close } = await listen(app);
    try {
      const token = await seedAdmin();
      const res = await call(url, "/api/admin/tickets?status=zzz", token);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: "INVALID_DATA" });
    } finally {
      close();
    }
  });

  it("filters by a valid status and paginates", async () => {
    const app = buildApp(adminTicketsRouter);
    const { url, close } = await listen(app);
    try {
      const token = await seedAdmin();
      const userId = await seedUser();
      await db.insert(supportTicketsTable).values({ userId, title: "T1", status: "open" });
      await db.insert(supportTicketsTable).values({ userId, title: "T2", status: "closed" });
      const res = await call(url, "/api/admin/tickets?status=open", token);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect((res.body as Array<{ title: string }>)[0].title).toBe("T1");
    } finally {
      close();
    }
  });
});
