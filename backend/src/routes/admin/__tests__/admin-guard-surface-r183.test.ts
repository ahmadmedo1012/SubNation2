import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { adminUsersTable, db, initTestDb, resetTestDb } from "../../../test/db";
import { signAdminToken } from "../../../lib/jwt";
import { requireAdmin } from "../../../middlewares/requireAdmin";
import { requirePermission } from "../../../lib/permissions";
import { adminRouter } from "../index";
import { authProviderAdminRouter } from "../../auth-settings";
import { couponsRouter } from "../../coupons";

/**
 * R183 — the guard-surface coverage sweep: the nine families that
 * rbac-composition.test.ts (R134 A5-F1) never reached.
 *
 * The R134 sweep pinned the composition LAW (path-scoped gates,
 * segment boundaries, the orders/finance/users/inventory cross-family
 * matrix) but left these families with NO scope-gate pin of their own —
 * every one of them was verified only through 200-shape tests that
 * mount the router bare with an all-scope token, so a mount-order or
 * gate-scope regression in exactly these families would have passed
 * every existing test:
 *
 *   pricing (GET /pricing/config — inventory), alerts REST
 *   (GET /alerts/new — support), settings root (GET /settings —
 *   settings), settings/auth (GET /admin/settings/auth — settings,
 *   mounted at the ROOT router, routes/index.ts:59), observability
 *   (GET /observability/summary — settings), diagnostics (GET
 *   /diagnostics — settings), auth-stats (GET /auth-stats/summary —
 *   admins), the /admins mount negative (GET /admins — admins), and
 *   the coupons admin family (GET /api/coupons/admin — route-level
 *   requireAdmin + finance, outside the /api/admin tree).
 *
 * This suite mounts the REAL adminRouter plus mirrored copies of the
 * two root-router mounts (routes/index.ts:54 and :59 — the exact
 * middleware chains, in the exact order) and pins, per family:
 *   - unauthenticated → 401 (the fail-closed base);
 *   - a wrong-scope admin → 403 with the FORBIDDEN envelope;
 *   - the right-scope admin → 200 (the route is actually REACHED —
 *     proving the gate matches the family, not just that it fires).
 */

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  // Mirror of routes/index.ts:58-59 — the admin tree first, then the
  // auth-providers admin mount on the root router (same order, same
  // middleware chain: requireAdmin → requirePermission("settings")).
  app.use("/api/admin", adminRouter);
  app.use(
    "/api/admin/settings",
    requireAdmin,
    requirePermission("settings"),
    authProviderAdminRouter,
  );
  // Mirror of routes/index.ts:54 — the coupons router (admin routes
  // inside carry their own route-level requireAdmin + finance gates).
  app.use("/api/coupons", couponsRouter);
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
      username: `r183_guard_${String(adminSeq).padStart(3, "0")}`,
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
  token: string | null,
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const res = await fetch(`${url}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
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
  // auth_activity is not part of the shared harness DDL (the
  // openapi-response-contracts convention) — provision it per-file so the
  // auth-stats summary handler can be REACHED, not just gated.
  await db.execute(
    sql`CREATE TABLE IF NOT EXISTS auth_activity (
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
    )`,
  );
}, 60_000);

beforeEach(async () => {
  await resetTestDb();
});

describe("R183 — the guard-surface sweep (the nine families the R134 matrix never pinned)", () => {
  it("the settings-scoped family: settings root + settings/auth + observability + diagnostics (401 → 403 wrong-scope → 200 right-scope)", async () => {
    const { token: wrongScope } = await seedAdmin(["orders"]);
    const { token: rightScope } = await seedAdmin(["settings"]);
    const { url, close } = await listen();
    try {
      const family = [
        "/api/admin/settings", // settings root (adminSettingsRouter)
        "/api/admin/settings/auth", // the root-router mount (routes/index.ts:59)
        "/api/admin/observability/summary", // settings gate
        "/api/admin/diagnostics", // settings gate
      ];
      for (const path of family) {
        const anon = await getStatus(url, path, null);
        expect(anon.status, `GET ${path} must be 401 unauthenticated`).toBe(401);

        const denied = await getStatus(url, path, wrongScope);
        expect(denied.status, `GET ${path} must be 403 for an orders-only admin`).toBe(403);
        expect(denied.body?.code).toBe("FORBIDDEN");

        const own = await getStatus(url, path, rightScope);
        expect(own.status, `GET ${path} must REACH its handler for a settings admin`).toBe(200);
      }
    } finally {
      await close();
    }
  });

  it("the alerts REST family: GET /alerts/new is support-gated (the socket twin was pinned, the REST twin never was)", async () => {
    const { token: wrongScope } = await seedAdmin(["orders"]);
    const { token: rightScope } = await seedAdmin(["support"]);
    const { url, close } = await listen();
    try {
      const anon = await getStatus(url, "/api/admin/alerts/new", null);
      expect(anon.status).toBe(401);

      const denied = await getStatus(url, "/api/admin/alerts/new", wrongScope);
      expect(denied.status, "an orders-only admin must not read the alert feed").toBe(403);
      expect(denied.body?.code).toBe("FORBIDDEN");

      const own = await getStatus(url, "/api/admin/alerts/new", rightScope);
      expect(own.status, "a support admin must reach the alert feed").toBe(200);
      expect(own.body?.alerts).toEqual([]);
    } finally {
      await close();
    }
  });

  it("the admins-scoped family: the /admins mount negative + auth-stats (an orders-only admin is 403'd; an admins admin reaches both)", async () => {
    const { token: wrongScope } = await seedAdmin(["orders"]);
    const { token: rightScope } = await seedAdmin(["admins"]);
    const { url, close } = await listen();
    try {
      // The /admins mount-gate negative: admins-rbac-subset only ever
      // exercised admins-scope actors — a wrong-scope 403 on the MOUNT
      // itself was never pinned.
      const denied = await getStatus(url, "/api/admin/admins", wrongScope);
      expect(denied.status, "GET /api/admin/admins must be 403 for an orders-only admin").toBe(403);
      expect(denied.body?.code).toBe("FORBIDDEN");

      const deniedStats = await getStatus(url, "/api/admin/auth-stats/summary", wrongScope);
      expect(deniedStats.status, "auth-stats must be admins-gated").toBe(403);

      const own = await getStatus(url, "/api/admin/admins", rightScope);
      expect(own.status, "an admins admin must reach the admin list").toBe(200);
      const ownStats = await getStatus(url, "/api/admin/auth-stats/summary", rightScope);
      expect(ownStats.status, "an admins admin must reach the auth-stats summary").toBe(200);
    } finally {
      await close();
    }
  });

  it("the pricing family: GET /pricing/config is inventory-gated (the R181-retired calculator's surviving config surface)", async () => {
    const { token: wrongScope } = await seedAdmin(["orders"]);
    const { token: rightScope } = await seedAdmin(["inventory"]);
    const { url, close } = await listen();
    try {
      const anon = await getStatus(url, "/api/admin/pricing/config", null);
      expect(anon.status).toBe(401);

      const denied = await getStatus(url, "/api/admin/pricing/config", wrongScope);
      expect(denied.status, "pricing config must be inventory-gated").toBe(403);
      expect(denied.body?.code).toBe("FORBIDDEN");

      const own = await getStatus(url, "/api/admin/pricing/config", rightScope);
      expect(own.status, "an inventory admin must reach the pricing config").toBe(200);
    } finally {
      await close();
    }
  });

  it("the coupons admin family: GET /api/coupons/admin is route-level admin+finance gated (outside the /api/admin tree)", async () => {
    const { token: wrongScope } = await seedAdmin(["orders"]);
    const { token: rightScope } = await seedAdmin(["finance"]);
    const { url, close } = await listen();
    try {
      const anon = await getStatus(url, "/api/coupons/admin", null);
      expect(anon.status, "the coupon admin list must be 401 unauthenticated").toBe(401);

      const denied = await getStatus(url, "/api/coupons/admin", wrongScope);
      expect(denied.status, "an orders-only admin must not read the coupon admin list").toBe(403);
      expect(denied.body?.code).toBe("FORBIDDEN");

      const own = await getStatus(url, "/api/coupons/admin", rightScope);
      expect(own.status, "a finance admin must reach the coupon admin list").toBe(200);
    } finally {
      await close();
    }
  });
});
