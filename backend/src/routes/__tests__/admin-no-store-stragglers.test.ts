import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { adminUsersTable, db, initTestDb, resetTestDb } from "../../test/db";
import { signAdminToken } from "../../lib/jwt";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { adminAuthRouter } from "../admin/auth";
import { adminSettingsRouter } from "../admin/settings";

/**
 * R123-E5 (A6 P3): no-store parity with the 98-F3 / R122 pattern — the
 * admin GET surfaces that had no Cache-Control header at all:
 *
 *   GET /api/admin/session        (identity + permission list echo)
 *   GET /api/admin/settings       (platform settings the panel reads)
 *
 * Every other admin router (orders, users, topups, alerts, risk, …)
 * already carries the router-level header; these were the stragglers
 * (the copilot settings/previews stragglers left with the copilot in
 * R181). The assertions are the R122 auth-sessions idiom: raw fetch,
 * assert `cache-control: no-store` (the header IS the contract).
 */

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  // Same mount shapes as routes/admin/index.ts: the settings router at
  // "/settings", auth at the admin root.
  app.use("/api/admin", adminAuthRouter);
  app.use("/api/admin/settings", adminSettingsRouter);
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
async function seedAdmin(): Promise<{ token: string; id: number }> {
  adminSeq += 1;
  const [a] = await db
    .insert(adminUsersTable)
    .values({
      username: `nostore_admin_${adminSeq}`,
      passwordHash: "x",
      isActive: true,
      permissions: ["all"],
    })
    .returning();
  return { token: signAdminToken({ adminId: a.id, role: "admin" }), id: a.id };
}

beforeAll(async () => {
  await initTestDb();
}, 60_000);

beforeEach(async () => {
  await resetTestDb();
});

describe("R123-E5 — no-store on the admin GET stragglers", () => {
  it("GET /api/admin/session ships Cache-Control: no-store", async () => {
    const admin = await seedAdmin();
    const { url, close } = await listen();
    try {
      const res = await fetch(`${url}/api/admin/session`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
    } finally {
      close();
    }
  });

  it("GET /api/admin/settings ships Cache-Control: no-store", async () => {
    const admin = await seedAdmin();
    const { url, close } = await listen();
    try {
      const res = await fetch(`${url}/api/admin/settings`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
    } finally {
      close();
    }
  });
});

describe("R126-L4 (A7-F3) — admin auth 401/rejection paths ship Cache-Control: no-store", () => {
  it("GET /api/admin/session without a token: the requireAdmin 401 carries no-store (the live-verified gap)", async () => {
    const { url, close } = await listen();
    try {
      // No Authorization header, no cookie — requireAdmin's first
      // rejection branch. Live probe at HEAD observed this 401 with NO
      // Cache-Control; the middleware now stamps it at entry.
      const res = await fetch(`${url}/api/admin/session`);
      expect(res.status).toBe(401);
      expect(res.headers.get("cache-control")).toBe("no-store");
    } finally {
      close();
    }
  });

  it("an EXPIRED/garbage token's 401 carries no-store too (requireAdmin verify branch)", async () => {
    const { url, close } = await listen();
    try {
      const res = await fetch(`${url}/api/admin/session`, {
        headers: { Authorization: "Bearer not-a-real-jwt" },
      });
      expect(res.status).toBe(401);
      expect(res.headers.get("cache-control")).toBe("no-store");
    } finally {
      close();
    }
  });

  it("requireAdmin ALONE (bare mount, no router-level header) stamps the 401 — the middleware is the fix site", async () => {
    // The /session cases above could inherit the header from the auth
    // router's own middleware; this bare mount (the lib/__tests__/
    // permissions.test.ts idiom) pins the MIDDLEWARE entry stamp itself:
    // no router, no router-level no-store, just requireAdmin in front of
    // a route on a router that never sets Cache-Control.
    const bare = express();
    bare.use(express.json());
    bare.get("/bare-admin", requireAdmin, (_req, res) => {
      res.json({ ok: true });
    });
    const server = bare.listen(0);
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no address");
    const url = `http://127.0.0.1:${addr.port}`;
    try {
      const res = await fetch(`${url}/bare-admin`);
      expect(res.status).toBe(401);
      expect(res.headers.get("cache-control")).toBe("no-store");
    } finally {
      server.close();
    }
  });

  it("POST /api/admin/login with unknown credentials: the inline 401 carries no-store (auth router-level header)", async () => {
    const { url, close } = await listen();
    try {
      // Unknown username → the dummy-argon2 401 branch inside the login
      // handler (not requireAdmin) — covered by the auth router's new
      // router-level no-store middleware.
      const res = await fetch(`${url}/api/admin/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "no-such-admin", password: "wrong-password" }),
      });
      expect(res.status).toBe(401);
      expect(res.headers.get("cache-control")).toBe("no-store");
    } finally {
      close();
    }
  });
});
