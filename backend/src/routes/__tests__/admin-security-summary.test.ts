import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { adminUsersTable, db, initTestDb, resetTestDb } from "../../test/db";
import { signAdminToken } from "../../lib/jwt";
import { adminSecurityRouter } from "../admin/security";

/**
 * R125-I6 (A8 B-11): /auth-stats/summary equivalence + efficiency pin.
 *
 * The route used to answer with FOUR sequential full-table count(*)
 * queries (total, success, failure, last24h); it now computes all four
 * in ONE aggregate using count(*) FILTER clauses. This suite pins:
 *
 *   1. EQUIVALENCE — for a mixed fixture (successes, failures, rows
 *      older/newer than 24h, an empty table) the endpoint's numbers
 *      equal a hand-computed baseline from the same rows;
 *   2. EFFICIENCY — exactly ONE select hits auth_activity per request
 *      (the 4-query shape is the regression this guards against);
 *   3. the empty table answers all-zero (the aggregate always returns
 *      one row — the `?? 0` fallbacks stay honest).
 *
 * auth_activity is not part of the shared harness DDL — provisioned
 * per-file (the body-schema-400s convention).
 */

const AUTH_ACTIVITY_DDL = `
CREATE TABLE auth_activity (
  id serial PRIMARY KEY,
  user_id integer,
  identifier varchar(255) NOT NULL,
  action varchar(50) NOT NULL,
  provider varchar(50),
  success boolean NOT NULL,
  ip_address varchar(45),
  user_agent text,
  failure_reason varchar(255),
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/admin", adminSecurityRouter);
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

async function seedAdmin(): Promise<string> {
  const [a] = await db
    .insert(adminUsersTable)
    .values({ username: "admin_summary", passwordHash: "x", isActive: true })
    .returning();
  return signAdminToken({ adminId: a.id, role: "admin" });
}

async function seedActivity(
  success: boolean,
  createdAt: Date,
  action = "login_password",
): Promise<void> {
  await db.execute(
    sql`INSERT INTO auth_activity (identifier, action, success, created_at)
        VALUES ('0912345678', ${action}, ${success},
                ${createdAt.toISOString()}::timestamptz)`,
  );
}

async function getSummary(
  url: string,
  token: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${url}/api/admin/auth-stats/summary`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
}

beforeAll(async () => {
  await initTestDb();
  await db.execute(sql.raw(AUTH_ACTIVITY_DDL));
});

beforeEach(async () => {
  await resetTestDb();
  await db.execute(sql.raw("DELETE FROM auth_activity"));
});

describe("GET /api/admin/auth-stats/summary — FILTER aggregate (R125-I6, A8 B-11)", () => {
  it("computes total/success/failure/last24h equal to the row-level baseline (one scan)", async () => {
    const token = await seedAdmin();
    const now = Date.now();
    // 6 rows: 4 success (2 fresh, 2 old) + 2 failure (1 fresh, 1 old).
    await seedActivity(true, new Date(now - 60_000));
    await seedActivity(true, new Date(now - 2 * 60 * 60 * 1000));
    await seedActivity(true, new Date(now - 3 * 24 * 60 * 60 * 1000));
    await seedActivity(true, new Date(now - 5 * 24 * 60 * 60 * 1000));
    await seedActivity(false, new Date(now - 30_000));
    await seedActivity(false, new Date(now - 4 * 24 * 60 * 60 * 1000));

    const { url, close } = await listen();
    try {
      const res = await getSummary(url, token);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ total: 6, success: 4, failure: 2, last24h: 3 });
    } finally {
      close();
    }
  });

  it("answers all-zero on an empty table (the aggregate row still exists)", async () => {
    const token = await seedAdmin();
    const { url, close } = await listen();
    try {
      const res = await getSummary(url, token);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ total: 0, success: 0, failure: 0, last24h: 0 });
    } finally {
      close();
    }
  });

  it("runs exactly ONE auth_activity select per request (the 4-query shape is the regression)", async () => {
    const token = await seedAdmin();
    await seedActivity(true, new Date());
    await seedActivity(false, new Date());

    const { url, close } = await listen();
    try {
      const selectSpy = vi.spyOn(db, "select");
      const res = await getSummary(url, token);
      expect(res.status).toBe(200);

      // THE efficiency assertion: exactly TWO selects serve this request
      // — one from requireAdmin's admin_users lookup, ONE for the summary
      // aggregate. The pre-R125 shape made FOUR summary selects (five
      // total); a revert to it fails here.
      expect(selectSpy).toHaveBeenCalledTimes(2);
      selectSpy.mockRestore();
    } finally {
      close();
    }
  });
});
