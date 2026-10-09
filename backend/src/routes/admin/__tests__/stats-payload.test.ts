import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { adminUsersTable, db, initTestDb, resetTestDb } from "../../../test/db";
import { inventoryTable, productsTable, supportTicketsTable, usersTable } from "@workspace/db";
import { signAdminToken } from "../../../lib/jwt";
import { adminStatsRouter } from "../stats";

/**
 * R120-B4 (A2-F3 + A6-F5) — admin stats payload contract.
 *
 *   1. open_tickets: the support badge count — tickets with status
 *      open/in_progress (the ticket_status pg enum is
 *      open/in_progress/closed). The layout sidebar + dashboard badge
 *      this number; closed tickets must NOT count.
 *   2. available_stock: DELIVERABLE units only (at least one
 *      credential field present — mirrors routes/products.ts:83
 *      deliverableUnitCondition, R102). Ghost rows (zero credentials,
 *      refused at checkout by the INVENTORY_CORRUPT gate) used to
 *      inflate the admin stock KPI above the public stats for the same
 *      catalog; the raw unsold count now rides along as unsold_rows so
 *      the gap stays observable.
 *
 * lib/cache is mocked to passthrough: the route caches the payload for
 * 30s under "admin:stats", and the in-memory LRU would serve test #1's
 * payload to every later test (resetTestDb cannot reach into it).
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

const ADMIN_USERNAME = "stats-payload-admin";

async function seedAdminToken(): Promise<string> {
  const [a] = await db
    .insert(adminUsersTable)
    .values({
      username: ADMIN_USERNAME,
      passwordHash: "x",
      isActive: true,
      // R126-L4 (A7-F1): /api/admin/stats is now finance-scoped — the
      // payload-contract fixtures below read it as the full-scope
      // operator would.
      permissions: ["all"],
    })
    .returning();
  return signAdminToken({ adminId: a.id, role: "admin" });
}

async function getStats(
  url: string,
  token: string,
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const res = await fetch(`${url}/api/admin/stats`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
}

async function seedStatsFixtures(): Promise<void> {
  // One user (support tickets FK) + one product (inventory FK).
  const [user] = await db.insert(usersTable).values({ phone: "0911111111" }).returning();
  const [product] = await db
    .insert(productsTable)
    .values({ name: "Netflix 1M", price: "25.00", category: "streaming" })
    .returning();

  // Tickets: 2 open + 1 in_progress + 2 closed → open_tickets MUST be 3.
  await db.insert(supportTicketsTable).values([
    { userId: user.id, title: "t-open-1", status: "open" },
    { userId: user.id, title: "t-open-2", status: "open" },
    { userId: user.id, title: "t-progress", status: "in_progress" },
    { userId: user.id, title: "t-closed-1", status: "closed" },
    { userId: user.id, title: "t-closed-2", status: "closed" },
  ]);

  // Inventory:
  //   - 3 unsold DELIVERABLE rows (credential present) → stock.
  //   - 2 unsold GHOST rows (zero credentials) → NOT stock, still
  //     unsold_rows.
  //   - 1 sold deliverable row → neither.
  await db
    .insert(inventoryTable)
    .values([
      { productId: product.id, accountEmail: "a@x.com", accountPassword: "p1" },
      { productId: product.id, accountEmail: "b@x.com" },
      { productId: product.id, accountPassword: "p3" },
      { productId: product.id },
      { productId: product.id },
      { productId: product.id, accountEmail: "sold@x.com", isSold: true },
    ]);
}

beforeAll(async () => {
  await initTestDb();
});

beforeEach(async () => {
  await resetTestDb();
});

describe("R120-B4 A2-F3: GET /api/admin/stats — open_tickets counts open + in_progress only", () => {
  it("reports the waiting-tickets count the sidebar badge renders", async () => {
    await seedStatsFixtures();
    const { url, close } = await listen(buildApp());
    try {
      const token = await seedAdminToken();
      const res = await getStats(url, token);

      expect(res.status).toBe(200);
      expect(res.body).not.toBeNull();
      // THE A2-F3 pin: open(2) + in_progress(1) = 3; closed never counts.
      expect(res.body!.open_tickets).toBe(3);
    } finally {
      close();
    }
  });

  it("answers 0 (not an error) when no tickets exist", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const token = await seedAdminToken();
      const res = await getStats(url, token);
      expect(res.status).toBe(200);
      expect(res.body!.open_tickets).toBe(0);
    } finally {
      close();
    }
  });

  it("requires an admin session (401 without a token)", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const res = await fetch(`${url}/api/admin/stats`);
      expect(res.status).toBe(401);
    } finally {
      close();
    }
  });
});

describe("R120-B4 A6-F5: GET /api/admin/stats — available_stock counts DELIVERABLE units", () => {
  it("excludes ghost rows (zero credentials) from stock while reporting them in unsold_rows", async () => {
    await seedStatsFixtures();
    const { url, close } = await listen(buildApp());
    try {
      const token = await seedAdminToken();
      const res = await getStats(url, token);

      expect(res.status).toBe(200);
      // 3 deliverable unsold rows — the public stock definition
      // (routes/products.ts deliverableUnitCondition), not 5 raw rows.
      expect(res.body!.available_stock).toBe(3);
      // The raw unsold count (3 deliverable + 2 ghost) stays observable.
      expect(res.body!.unsold_rows).toBe(5);
    } finally {
      close();
    }
  });
});

// R123-E5 (A6 P3): no-store parity with the 98-F3 pattern — the admin
// dashboard GETs (stats + chart-data) were the last admin analytics
// surfaces without Cache-Control: no-store. The 30s server-side
// cacheWrap is the only caching layer allowed; revenue/wallet
// aggregates must never be served by an intermediary.
describe("R123-E5 — no-store on the admin stats GETs", () => {
  it("GET /api/admin/stats ships Cache-Control: no-store", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const token = await seedAdminToken();
      const res = await fetch(`${url}/api/admin/stats`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
    } finally {
      close();
    }
  });

  it("GET /api/admin/chart-data ships Cache-Control: no-store", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const token = await seedAdminToken();
      const res = await fetch(`${url}/api/admin/chart-data?days=7`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
    } finally {
      close();
    }
  });
});
