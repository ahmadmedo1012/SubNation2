import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, initTestDb, resetTestDb, adminUsersTable, adminAlertsTable } from "../../test/db";
import { signAdminToken } from "../../lib/jwt";
import { adminAlertsRouter } from "../admin/alerts";

/**
 * 96-F1 (R96-A5 M15) — GET /api/admin/alerts/new?since= pushes the
 * `since` filter into SQL (WHERE id > sinceId ORDER BY id DESC LIMIT 50)
 * instead of fetching the last 50 rows and filtering in JavaScript.
 *
 * Behavioral contract pinned here (the route is exercised end-to-end
 * through the mounted router):
 *   - only rows with id > since are returned, newest-first (id DESC);
 *   - `since=0` / missing / garbage → all rows (bounded by the 50 cap);
 *   - the 50-row cap is applied in SQL — a 60-row table with since=0
 *     returns exactly the 50 NEWEST ids, not "last-50-by-created_at
 *     filtered down" (the old JS shape could silently drop newer rows
 *     when older ones dominated the fetch window);
 *   - polls past the newest id return an empty array without a 500.
 */

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/admin/alerts", adminAlertsRouter);
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

async function seedAdmin(): Promise<{ id: number; token: string }> {
  const [a] = await db
    .insert(adminUsersTable)
    .values({ username: "admin_since", passwordHash: "x", isActive: true })
    .returning();
  return { id: a.id, token: signAdminToken({ adminId: a.id, role: "admin" }) };
}

async function seedAlerts(n: number): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < n; i++) {
    const [row] = await db
      .insert(adminAlertsTable)
      .values({ type: "system", title: `Alert ${i + 1}`, message: "m" })
      .returning({ id: adminAlertsTable.id });
    ids.push(row.id);
  }
  return ids;
}

async function getNew(
  url: string,
  token: string,
  query = "",
): Promise<{ status: number; body: { alerts?: Array<{ id: number }> } }> {
  const res = await fetch(`${url}/api/admin/alerts/new${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: res.status, body: (await res.json()) as { alerts?: Array<{ id: number }> } };
}

beforeAll(async () => {
  await initTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  vi.restoreAllMocks();
});

describe("GET /api/admin/alerts/new?since= — SQL-side filter (96-F1 M15)", () => {
  it("returns only rows with id > since, newest-first", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const { token } = await seedAdmin();
      const ids = await seedAlerts(5); // [1,2,3,4,5]

      const res = await getNew(url, token, "?since=2");
      expect(res.status).toBe(200);
      expect(res.body.alerts!.map((a) => a.id)).toEqual([ids[4], ids[3], ids[2]]);
    } finally {
      close();
    }
  });

  it("since=0 / missing / garbage → every row (same legacy semantics)", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const { token } = await seedAdmin();
      const ids = await seedAlerts(3);

      for (const query of ["?since=0", "", "?since=abc", "?since=-7"]) {
        const res = await getNew(url, token, query);
        expect(res.status, `query=${query}`).toBe(200);
        expect(res.body.alerts!.map((a) => a.id)).toEqual([...ids].reverse());
      }
    } finally {
      close();
    }
  });

  it("applies the 50-row cap in SQL — 60 rows with since=0 yield the 50 NEWEST ids", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const { token } = await seedAdmin();
      const ids = await seedAlerts(60);

      const res = await getNew(url, token, "?since=0");
      expect(res.status).toBe(200);
      expect(res.body.alerts).toHaveLength(50);
      // Newest-first: ids 60 … 11 — the JS-filter shape could only ever
      // return rows it had already fetched by created_at, silently
      // dropping the newest when the fetch window skewed.
      expect(res.body.alerts![0]!.id).toBe(ids[59]);
      expect(res.body.alerts![49]!.id).toBe(ids[10]);
    } finally {
      close();
    }
  });

  it("a poll past the newest id returns [] (no error, no rows)", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const { token } = await seedAdmin();
      const ids = await seedAlerts(2);

      const res = await getNew(url, token, `?since=${ids[1]}`);
      expect(res.status).toBe(200);
      expect(res.body.alerts).toEqual([]);
    } finally {
      close();
    }
  });

  it("requires an authenticated admin", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const res = await getNew(url, "not-a-token", "?since=0");
      expect(res.status).toBe(401);
    } finally {
      close();
    }
  });
});
