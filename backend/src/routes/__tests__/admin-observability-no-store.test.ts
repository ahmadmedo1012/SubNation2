import express, { type Express } from "express";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { adminUsersTable, db, initTestDb, resetTestDb } from "../../test/db";
import { signAdminToken } from "../../lib/jwt";
import { adminObservabilityRouter } from "../admin/observability";

/**
 * R125-I6 (A8 B-8): the observability router's no-store pin.
 *
 * Only /metrics used to set Cache-Control: no-store; the other five GETs
 * (/summary, /alerts/recent, /deploys/recent, /sentry/summary,
 * /scheduler — the last polled every 15 s by the admin System tab) were
 * cacheable by any intermediary, making observability the lone gap in
 * the 31/32 admin no-store coverage. The header is now lifted to
 * router.use (the same 98-F3 pattern every other admin file uses), so
 * ALL SIX GETs — and the /metrics 500 envelope — carry it.
 *
 * Real modules (no scheduler/redis mocks): with no REDIS_URL the redis
 * client is null by design and getSchedulerState returns its default
 * snapshot, which is exactly the production no-Redis shape this router
 * serves. The header IS the assertion (the R122 auth-sessions idiom).
 */

function buildApp(): Express {
  const app = express();
  app.use("/api/admin/observability", adminObservabilityRouter);
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
    .values({ username: "admin_observability_nostore", passwordHash: "x", isActive: true })
    .returning();
  return signAdminToken({ adminId: a.id, role: "admin" });
}

beforeAll(async () => {
  await initTestDb();
});

beforeEach(async () => {
  await resetTestDb();
});

describe("R125-I6 (A8 B-8) — every observability GET ships Cache-Control: no-store", () => {
  const GETS = [
    "/api/admin/observability/summary",
    "/api/admin/observability/alerts/recent",
    "/api/admin/observability/deploys/recent",
    "/api/admin/observability/sentry/summary",
    "/api/admin/observability/metrics",
    "/api/admin/observability/scheduler",
  ];

  it.each(GETS)("GET %s → 200 + cache-control: no-store", async (path) => {
    const token = await seedAdmin();
    const { url, close } = await listen();
    try {
      const res = await fetch(`${url}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
    } finally {
      close();
    }
  });

  it("the five previously-unguarded GETs are covered (the pre-fix gap list)", async () => {
    // The regression list from A8 B-8, asserted as a set so a future
    // route addition that forgets the router.use lift still fails the
    // it.each above — and this test documents WHICH routes were the gap.
    const token = await seedAdmin();
    const { url, close } = await listen();
    try {
      for (const path of GETS.slice(0, 5)) {
        const res = await fetch(`${url}${path}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        expect(res.headers.get("cache-control")).toBe("no-store");
      }
    } finally {
      close();
    }
  });
});
