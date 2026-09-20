import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import cookieParser from "cookie-parser";
import express, { type Express } from "express";
import { eq } from "drizzle-orm";
import { signAdminToken } from "../../lib/jwt";
import { createAdminSession, revokeAdminSession } from "../../lib/admin-session";
import { adminUsersTable, adminSessionsTable, db, initTestDb, resetTestDb } from "../../test/db";
import metricsRouter from "../metrics";

/**
 * SEC-92-02 (round-92 B1 security audit) — /api/metrics auth gate.
 *
 * requireAdmin (middlewares/requireAdmin.ts, V1-CRITICAL) rejects the 2FA
 * TEMP token everywhere; /api/metrics verified the admin JWT itself and
 * had no isTemp check, so a password-only attacker (password + no TOTP)
 * could read the full Prometheus operational telemetry (traffic,
 * latencies, DB pool, socket counts) by presenting the half-session temp
 * token. These tests pin that fix: temp token → 401, full token → 200.
 *
 * 98-F3 (R98-A1 P2-2): the admin-JWT branch now mirrors requireAdmin's
 * revocation posture — the row-backed `sid` must resolve to a live
 * admin_sessions row (logout/password-change kill it), the admin row
 * must still exist and be is_active (soft-disable kills it), and
 * revoked sessions 401 instead of riding the 8h JWT TTL.
 */

function buildApp(): Express {
  const app = express();
  app.use(cookieParser());
  app.use("/api", metricsRouter);
  return app;
}

function listen(app: Express): Promise<{ url: string; close: () => void }> {
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

async function get(
  url: string,
  headers: Record<string, string>,
): Promise<{ status: number; body: string; contentType: string | null }> {
  const res = await fetch(`${url}/api/metrics`, { headers });
  const body = await res.text();
  return { status: res.status, body, contentType: res.headers.get("content-type") };
}

const TEMP_TOKEN = signAdminToken({ adminId: 1, role: "super_admin", isTemp: true });

async function seedAdmin(): Promise<number> {
  const [a] = await db
    .insert(adminUsersTable)
    .values({ username: "metrics_admin", passwordHash: "x", isActive: true })
    .returning();
  return a.id;
}

beforeAll(async () => {
  // The static-token path must stay inert so the JWT paths are the ones
  // under test.
  delete process.env.METRICS_ADMIN_TOKEN;
  await initTestDb();
});

beforeEach(async () => {
  await resetTestDb();
});

describe("GET /api/metrics — admin JWT auth (SEC-92-02)", () => {
  it("no credentials → 401", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const res = await get(url, {});
      expect(res.status).toBe(401);
    } finally {
      close();
    }
  });

  it("2FA TEMP token via cookie → 401 (mirrors requireAdmin V1-CRITICAL)", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const res = await get(url, { Cookie: `admin_token=${TEMP_TOKEN}` });
      expect(res.status).toBe(401);
    } finally {
      close();
    }
  });

  it("2FA TEMP token via Authorization: Bearer → 401", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const res = await get(url, { Authorization: `Bearer ${TEMP_TOKEN}` });
      expect(res.status).toBe(401);
    } finally {
      close();
    }
  });

  it("FULL admin token (live session row) via cookie → 200 Prometheus exposition", async () => {
    const adminId = await seedAdmin();
    const { token } = await createAdminSession({ adminId, role: "admin" });
    const { url, close } = await listen(buildApp());
    try {
      const res = await get(url, { Cookie: `admin_token=${token}` });
      expect(res.status).toBe(200);
      expect(res.contentType).toContain("text/plain");
      expect(res.body.length).toBeGreaterThan(0);
    } finally {
      close();
    }
  });

  it("FULL admin token (live session row) via Authorization: Bearer → 200", async () => {
    const adminId = await seedAdmin();
    const { token } = await createAdminSession({ adminId, role: "admin" });
    const { url, close } = await listen(buildApp());
    try {
      const res = await get(url, { Authorization: `Bearer ${token}` });
      expect(res.status).toBe(200);
    } finally {
      close();
    }
  });

  it("garbage token → 401 (fail closed, no oracle about which check failed)", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const res = await get(url, { Cookie: "admin_token=not-a-jwt" });
      expect(res.status).toBe(401);
    } finally {
      close();
    }
  });
});

describe("GET /api/metrics — session revocation parity with requireAdmin (98-F3, R98-A1 P2-2)", () => {
  it("a REVOKED session row (logout semantics) → 401, not the 8h JWT free-ride", async () => {
    const adminId = await seedAdmin();
    const { token, sid } = await createAdminSession({ adminId, role: "admin" });
    await revokeAdminSession(sid, "logout");

    const { url, close } = await listen(buildApp());
    try {
      const res = await get(url, { Cookie: `admin_token=${token}` });
      expect(res.status).toBe(401);
    } finally {
      close();
    }
  });

  it("an EXPIRED session row → 401", async () => {
    const adminId = await seedAdmin();
    const { token, sid } = await createAdminSession({ adminId, role: "admin" });
    await db
      .update(adminSessionsTable)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(adminSessionsTable.id, sid));

    const { url, close } = await listen(buildApp());
    try {
      const res = await get(url, { Cookie: `admin_token=${token}` });
      expect(res.status).toBe(401);
    } finally {
      close();
    }
  });

  it("a soft-DISABLED admin (is_active=false) → 401 in real time", async () => {
    const adminId = await seedAdmin();
    const { token } = await createAdminSession({ adminId, role: "admin" });
    await db
      .update(adminUsersTable)
      .set({ isActive: false })
      .where(eq(adminUsersTable.id, adminId));

    const { url, close } = await listen(buildApp());
    try {
      const res = await get(url, { Cookie: `admin_token=${token}` });
      expect(res.status).toBe(401);
    } finally {
      close();
    }
  });

  it("a deleted admin row → 401", async () => {
    const adminId = await seedAdmin();
    const { token, sid } = await createAdminSession({ adminId, role: "admin" });
    // Delete the session row first (FK), then the admin row.
    await db.delete(adminSessionsTable).where(eq(adminSessionsTable.id, sid));
    await db.delete(adminUsersTable).where(eq(adminUsersTable.id, adminId));

    const { url, close } = await listen(buildApp());
    try {
      const res = await get(url, { Cookie: `admin_token=${token}` });
      expect(res.status).toBe(401);
    } finally {
      close();
    }
  });

  it("sid-less token still passes OUTSIDE production (legacy test fixtures)", async () => {
    // Mirrors requireAdmin's non-production posture (see
    // routes/admin/__tests__/admin-session-revocation.test.ts): the row
    // must still exist + be active.
    const adminId = await seedAdmin();
    const legacy = signAdminToken({ adminId, role: "admin" });
    const { url, close } = await listen(buildApp());
    try {
      const res = await get(url, { Cookie: `admin_token=${legacy}` });
      expect(res.status).toBe(200);
    } finally {
      close();
    }
  });
});
