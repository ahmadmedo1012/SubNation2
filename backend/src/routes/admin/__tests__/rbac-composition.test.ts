import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { adminUsersTable, db, initTestDb, resetTestDb } from "../../../test/db";
import { signAdminToken } from "../../../lib/jwt";
import { adminRouter } from "../index";

/**
 * R134 (A5-F1) — RBAC composition: path-scoped gates, not cumulative.
 *
 * The pre-R134 mounts were `protectedRouter.use("/", requirePermission(x),
 * router)`. Express `use("/")` prefix-matches EVERY protected admin
 * request, so the gates composed cumulatively — a request to
 * /api/admin/orders traversed eleven gates in mount order, and a scoped
 * admin (e.g. ["orders"]) was 403'd by the FIRST unrelated gate (the
 * `users` gate in front of the risk router) before ever reaching their
 * own scope's routes. At runtime only "all"/near-union grants worked;
 * the R122 subset-grant story was functionally dead (fail-closed
 * over-restriction, never escalation).
 *
 * This suite mounts the REAL adminRouter (the composition under test)
 * and pins, per scoped admin:
 *   - their own scope's family route is REACHED (200 on an empty list);
 *   - every other family 403s with the permission envelope;
 *   - the wildcard ["all"] keeps full reach;
 *   - path-segment boundaries: "/orders" does NOT match "/orders2"
 *     (a 404 route-not-found, not a 403 gate) — the use-mount matching
 *     law the path-scoped gates rely on.
 */

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/admin", adminRouter);
  return app;
}

async function listen(): Promise<{ url: string; close: () => void }> {
  const app = buildApp();
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

let adminSeq = 0;

/** Seed an admin row + a sid-less bearer token (requireAdmin accepts those
 * outside production as long as the row exists and is active). */
async function seedAdmin(permissions: string[]): Promise<{ token: string }> {
  adminSeq += 1;
  const [a] = await db
    .insert(adminUsersTable)
    .values({
      username: `rbac_comp_${String(adminSeq).padStart(3, "0")}`,
      passwordHash: "not-a-real-hash",
      isActive: true,
      permissions,
    })
    .returning();
  return { token: signAdminToken({ adminId: a.id, role: "admin" }) };
}

async function getStatus(
  url: string,
  path: string,
  token: string,
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const res = await fetch(`${url}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  // A bare test app has no JSON 404 fallback — the express default 404
  // is HTML. Only parse when it looks like JSON.
  const body = text.trimStart().startsWith("{")
    ? (JSON.parse(text) as Record<string, unknown>)
    : null;
  return { status: res.status, body };
}

beforeAll(async () => {
  await initTestDb();
}, 60_000);

beforeEach(async () => {
  await resetTestDb();
});

describe("R134 A5-F1 — path-scoped RBAC composition (the real adminRouter)", () => {
  it("an orders-scoped admin reaches /orders and is 403'd by every other family", async () => {
    const { token } = await seedAdmin(["orders"]);
    const { url, close } = await listen();
    try {
      const own = await getStatus(url, "/api/admin/orders", token);
      expect(own.status, "GET /api/admin/orders must reach the orders router").toBe(200);

      for (const path of [
        "/api/admin/topups", // finance gate
        "/api/admin/users", // users gate
        "/api/admin/products", // inventory gate
        "/api/admin/referrals", // users gate
        "/api/admin/tickets", // support gate
        "/api/admin/risk/events", // users gate (risk family)
        "/api/admin/enrichment/list", // inventory gate
        "/api/admin/forecast/at-risk", // inventory gate
        "/api/admin/auth-activity", // admins gate
      ]) {
        const denied = await getStatus(url, path, token);
        expect(denied.status, `GET ${path} must stay 403 for an orders-only admin`).toBe(403);
        expect(denied.body?.code).toBe("FORBIDDEN");
      }
    } finally {
      await close();
    }
  });

  it("a finance-scoped admin reaches /topups; a users-scoped admin reaches /users — each 403'd cross-family", async () => {
    const { token: financeToken } = await seedAdmin(["finance"]);
    const { token: usersToken } = await seedAdmin(["users"]);
    const { url, close } = await listen();
    try {
      const topups = await getStatus(url, "/api/admin/topups", financeToken);
      expect(topups.status, "GET /api/admin/topups must reach the topups router").toBe(200);
      const financeDenied = await getStatus(url, "/api/admin/orders", financeToken);
      expect(financeDenied.status).toBe(403);

      const users = await getStatus(url, "/api/admin/users", usersToken);
      expect(users.status, "GET /api/admin/users must reach the users router").toBe(200);
      const usersDenied = await getStatus(url, "/api/admin/orders", usersToken);
      expect(usersDenied.status).toBe(403);
      const usersDenied2 = await getStatus(url, "/api/admin/topups", usersToken);
      expect(usersDenied2.status).toBe(403);
    } finally {
      await close();
    }
  });

  it("an inventory-scoped admin reaches the catalog family (products + pricing + flash-sales)", async () => {
    const { token } = await seedAdmin(["inventory"]);
    const { url, close } = await listen();
    try {
      for (const path of ["/api/admin/products", "/api/admin/flash-sales"]) {
        const own = await getStatus(url, path, token);
        expect(own.status, `GET ${path} must reach the inventory family`).toBe(200);
      }
      const denied = await getStatus(url, "/api/admin/orders", token);
      expect(denied.status).toBe(403);
    } finally {
      await close();
    }
  });

  it('the ["all"] wildcard keeps full reach (the production shape is unchanged)', async () => {
    const { token } = await seedAdmin(["all"]);
    const { url, close } = await listen();
    try {
      for (const path of [
        "/api/admin/orders",
        "/api/admin/topups",
        "/api/admin/users",
        "/api/admin/products",
      ]) {
        const own = await getStatus(url, path, token);
        expect(own.status, `GET ${path} must stay reachable for ["all"]`).toBe(200);
      }
    } finally {
      await close();
    }
  });

  it("use-mount gates are segment-bound: /orders does NOT match /orders2 (404, not 403)", async () => {
    const { token } = await seedAdmin(["orders"]);
    const { url, close } = await listen();
    try {
      const adjacent = await getStatus(url, "/api/admin/orders2", token);
      // No route matches; the orders gate must not fire for the adjacent
      // segment, so this is the router family's 404 — not a permission 403.
      expect(adjacent.status).toBe(404);
      expect(adjacent.body?.code).not.toBe("INSUFFICIENT_PERMISSIONS");
    } finally {
      await close();
    }
  });

  it("an unauthenticated caller is still 401'd before any scope gate (fail-closed base)", async () => {
    const { url, close } = await listen();
    try {
      const res = await fetch(`${url}/api/admin/orders`);
      expect(res.status).toBe(401);
    } finally {
      await close();
    }
  });
});
