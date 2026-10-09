import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { adminUsersTable, db, initTestDb, resetTestDb } from "../../../test/db";
import {
  inventoryTable,
  ordersTable,
  productsTable,
  supportTicketsTable,
  usersTable,
  walletTopupsTable,
} from "@workspace/db";
import { signAdminToken } from "../../../lib/jwt";
import { adminStatsRouter } from "../stats";

/**
 * R126-L4 (A7-F1, P2) — the dashboard stats GETs are finance-scoped.
 *
 * GET /api/admin/stats + /api/admin/chart-data are mounted at the admin
 * root AHEAD of the scope-gated protectedRouter (admin/index.ts:35) and
 * previously carried requireAdmin ONLY — a `support`-scoped admin (or a
 * session stolen from one) read total_revenue / today_revenue /
 * total_wallet_balance + the daily revenue series straight off the API,
 * even though the dashboard UI hides those tiles for non-finance
 * operators (dashboard.tsx canSeeMoney, R122 A2-P2).
 *
 * Locked behaviours:
 *   - a support-only admin (the A7 attack scenario) → 403 FORBIDDEN on
 *     BOTH /stats and /chart-data;
 *   - an orders-only admin → 403 too (the money scope is `finance`, not
 *     `orders` — revenue/wallet aggregates are the same class as the
 *     topups/coupons/wallet-edit surfaces, all finance-gated);
 *   - a finance-only admin → 200 on both (money surface, money scope);
 *   - the ["all"] wildcard (the operator's own account) → 200 on both.
 *
 * The second describe also re-pins the full payload VALUES under the
 * R126-L4 A6-F2 FILTER fold (10 count/sum queries → 5 single-scan
 * aggregates) — every folded number (users/wallet, orders/revenue ×2,
 * stock/unsold, topups, tickets) asserted against seeded fixtures.
 *
 * lib/cache mocked to passthrough for the same reason as
 * stats-payload.test.ts: the 30s LRU would leak one test's payload into
 * the next (resetTestDb cannot reach into it).
 */

vi.mock("../../../lib/cache", () => ({
  cacheWrap: (_key: string, _ttlSeconds: number, loader: () => Promise<unknown>) => loader(),
}));

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/admin", adminStatsRouter);
  return app;
}

async function listen(): Promise<{ url: string; close: () => void }> {
  const app = buildApp();
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

let adminSeq = 0;
async function seedAdminToken(permissions: string[]): Promise<string> {
  adminSeq += 1;
  const [a] = await db
    .insert(adminUsersTable)
    .values({
      username: `stats_scope_admin_${adminSeq}`,
      passwordHash: "x",
      isActive: true,
      permissions,
    })
    .returning();
  return signAdminToken({ adminId: a.id, role: "admin" });
}

async function callAdmin(
  url: string,
  path: string,
  token: string,
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const res = await fetch(`${url}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
}

beforeAll(async () => {
  await initTestDb();
});

beforeEach(async () => {
  await resetTestDb();
});

describe("R126-L4 (A7-F1) — /api/admin/stats + /chart-data require the finance scope", () => {
  it("a support-only admin gets 403 FORBIDDEN on both routes (the A7 attack scenario)", async () => {
    const token = await seedAdminToken(["support"]);
    const { url, close } = await listen();
    try {
      const stats = await callAdmin(url, "/api/admin/stats", token);
      expect(stats.status).toBe(403);
      expect(stats.body).toMatchObject({ code: "FORBIDDEN" });

      const chart = await callAdmin(url, "/api/admin/chart-data?days=7", token);
      expect(chart.status).toBe(403);
      expect(chart.body).toMatchObject({ code: "FORBIDDEN" });
    } finally {
      close();
    }
  });

  it("an orders-only admin also gets 403 — the money scope is finance, not orders", async () => {
    const token = await seedAdminToken(["orders"]);
    const { url, close } = await listen();
    try {
      const stats = await callAdmin(url, "/api/admin/stats", token);
      expect(stats.status).toBe(403);

      const chart = await callAdmin(url, "/api/admin/chart-data?days=7", token);
      expect(chart.status).toBe(403);
    } finally {
      close();
    }
  });

  it("a finance-only admin gets 200 on both routes", async () => {
    const token = await seedAdminToken(["finance"]);
    const { url, close } = await listen();
    try {
      const stats = await callAdmin(url, "/api/admin/stats", token);
      expect(stats.status).toBe(200);
      expect(stats.body).not.toBeNull();

      const chart = await callAdmin(url, "/api/admin/chart-data?days=7", token);
      expect(chart.status).toBe(200);
      expect(Array.isArray(chart.body)).toBe(true);
    } finally {
      close();
    }
  });

  it('the ["all"] wildcard (the operator\'s account) keeps full dashboard access', async () => {
    const token = await seedAdminToken(["all"]);
    const { url, close } = await listen();
    try {
      const stats = await callAdmin(url, "/api/admin/stats", token);
      expect(stats.status).toBe(200);

      const chart = await callAdmin(url, "/api/admin/chart-data?days=7", token);
      expect(chart.status).toBe(200);
    } finally {
      close();
    }
  });

  it("401 (no token) still precedes the scope check — auth first, scope second", async () => {
    const { url, close } = await listen();
    try {
      const res = await fetch(`${url}/api/admin/stats`);
      expect(res.status).toBe(401);
    } finally {
      close();
    }
  });
});

describe("R126-L4 (A6-F2) — FILTER-folded payload values on seeded fixtures", () => {
  it("computes every folded aggregate (users/wallet, orders/revenue, stock, topups, tickets)", async () => {
    const token = await seedAdminToken(["all"]);

    // 2 users: wallets 50.00 + 25.50 → total_users 2, wallet sum 75.5.
    const [u1] = await db
      .insert(usersTable)
      .values({ phone: "0912223333", walletBalance: "50.00" })
      .returning();
    await db.insert(usersTable).values({ phone: "0912224444", walletBalance: "25.50" });

    const [product] = await db
      .insert(productsTable)
      .values({ name: "Fold Product", price: "30.00" })
      .returning();

    // Orders: completed-today 30 + completed-3d-ago 20 → totals 2 / 50.00,
    // today 1 / 30.00. Pending 10 and failed 5 never count.
    await db.insert(ordersTable).values([
      {
        orderCode: "FOLD-TODAY",
        userId: u1.id,
        productId: product.id,
        amount: "30.00",
        status: "completed",
      },
      {
        orderCode: "FOLD-OLD",
        userId: u1.id,
        productId: product.id,
        amount: "20.00",
        status: "completed",
        createdAt: new Date(Date.now() - 3 * 86_400_000),
      },
      {
        orderCode: "FOLD-PENDING",
        userId: u1.id,
        productId: product.id,
        amount: "10.00",
        status: "pending",
      },
      {
        orderCode: "FOLD-FAILED",
        userId: u1.id,
        productId: product.id,
        amount: "5.00",
        status: "failed",
      },
    ]);

    // 1 pending topup → pending_topups 1.
    await db
      .insert(walletTopupsTable)
      .values({ userId: u1.id, amount: "15.00", status: "pending" });

    // Inventory: 2 deliverable unsold + 1 ghost unsold + 1 sold
    // → available_stock 2, unsold_rows 3.
    await db
      .insert(inventoryTable)
      .values([
        { productId: product.id, accountEmail: "fold1@x.com", accountPassword: "p1" },
        { productId: product.id, accountPassword: "p2" },
        { productId: product.id },
        { productId: product.id, accountEmail: "sold@x.com", isSold: true },
      ]);

    // 1 open ticket → open_tickets 1.
    await db
      .insert(supportTicketsTable)
      .values({ userId: u1.id, title: "fold-open", status: "open" });

    const { url, close } = await listen();
    try {
      const res = await callAdmin(url, "/api/admin/stats", token);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        total_users: 2,
        total_orders: 2,
        total_revenue: 50,
        pending_topups: 1,
        today_orders: 1,
        today_revenue: 30,
        available_stock: 2,
        total_wallet_balance: 75.5,
        open_tickets: 1,
        unsold_rows: 3,
      });
    } finally {
      close();
    }
  });
});
