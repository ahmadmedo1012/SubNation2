import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { adminSessionsTable, adminUsersTable, db, initTestDb, resetTestDb, usersTable } from "../../../test/db";
import { signAdminToken } from "../../../lib/jwt";
import {
  createAdminSession,
  isValidAdminSession,
  pruneStaleAdminSessions,
  revokeAdminSession,
  revokeAllAdminSessions,
} from "../../../lib/admin-session";
import { requireAdmin } from "../../../middlewares/requireAdmin";
import { hashPassword } from "../../../lib/crypto";

/**
 * V1-M13 / A8-01 (round-94): admin JWTs are paired with an
 * admin_sessions row; requireAdmin re-validates the row so logout,
 * change-password and is_active flips kill tokens in real time.
 * Non-production keeps accepting sid-less tokens (test fixtures).
 */

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.get("/api/admin/echo", requireAdmin, (req, res) => {
    const adminReq = req as Parameters<typeof requireAdmin>[0] & { adminId: number; adminSessionId: string | null };
    res.json({ ok: true, adminId: adminReq.adminId, sid: adminReq.adminSessionId });
  });
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

async function seedAdmin(): Promise<number> {
  const [a] = await db
    .insert(adminUsersTable)
    .values({ username: "admin_sess", passwordHash: await hashPassword("pass-12345"), isActive: true })
    .returning();
  return a.id;
}

async function get(url: string, token: string) {
  const res = await fetch(`${url}/api/admin/echo`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}

beforeAll(async () => {
  await initTestDb();
});

beforeEach(async () => {
  await resetTestDb();
});

describe("admin session rows (V1-M13 / A8-01)", () => {
  it("createAdminSession mints a row + sid-bound token that requireAdmin accepts", async () => {
    const adminId = await seedAdmin();
    const { token, sid } = await createAdminSession({ adminId, role: "admin", userAgent: "vitest", ipAddress: "127.0.0.1" });

    expect(sid).toMatch(/^[0-9a-f]{32}$/);
    const [row] = await db.select().from(adminSessionsTable).where(eq(adminSessionsTable.id, sid)).limit(1);
    expect(row).toBeDefined();
    expect(row.adminId).toBe(adminId);
    expect(row.revokedAt).toBeNull();
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const { url, close } = await listen(buildApp());
    try {
      const res = await get(url, token);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ ok: true, adminId, sid });
    } finally {
      close();
    }
  });

  it("revokeAdminSession kills the token immediately (logout semantics)", async () => {
    const adminId = await seedAdmin();
    const { token, sid } = await createAdminSession({ adminId, role: "admin" });
    await revokeAdminSession(sid, "logout");

    expect(await isValidAdminSession(sid, adminId)).toBe(false);
    const { url, close } = await listen(buildApp());
    try {
      const res = await get(url, token);
      expect(res.status).toBe(401);
    } finally {
      close();
    }
  });

  it("revokeAllAdminSessions kills every outstanding session (password-change semantics)", async () => {
    const adminId = await seedAdmin();
    const s1 = await createAdminSession({ adminId, role: "admin" });
    const s2 = await createAdminSession({ adminId, role: "admin" });
    await revokeAllAdminSessions(adminId, "password_changed");

    expect(await isValidAdminSession(s1.sid, adminId)).toBe(false);
    expect(await isValidAdminSession(s2.sid, adminId)).toBe(false);
  });

  it("a foreign admin's sid does not validate for another adminId", async () => {
    const adminId = await seedAdmin();
    const otherId = (
      await db
        .insert(adminUsersTable)
        .values({ username: "admin_other", passwordHash: "x", isActive: true })
        .returning()
    )[0].id;
    const { sid } = await createAdminSession({ adminId, role: "admin" });
    expect(await isValidAdminSession(sid, adminId)).toBe(true);
    expect(await isValidAdminSession(sid, otherId)).toBe(false);
  });

  it("expired session rows are invalid even before pruning", async () => {
    const adminId = await seedAdmin();
    const { sid } = await createAdminSession({ adminId, role: "admin" });
    await db
      .update(adminSessionsTable)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(adminSessionsTable.id, sid));
    expect(await isValidAdminSession(sid, adminId)).toBe(false);
  });

  it("pruneStaleAdminSessions removes expired/old-revoked rows only", async () => {
    const adminId = await seedAdmin();
    const live = await createAdminSession({ adminId, role: "admin" });
    // expired 2 days ago
    const old = await createAdminSession({ adminId, role: "admin" });
    await db
      .update(adminSessionsTable)
      .set({ expiresAt: new Date(Date.now() - 2 * 24 * 3600 * 1000) })
      .where(eq(adminSessionsTable.id, old.sid));
    // revoked 40 days ago
    const ancient = await createAdminSession({ adminId, role: "admin" });
    await db
      .update(adminSessionsTable)
      .set({ revokedAt: new Date(Date.now() - 40 * 24 * 3600 * 1000), revokedReason: "logout" })
      .where(eq(adminSessionsTable.id, ancient.sid));

    const removed = await pruneStaleAdminSessions();
    expect(removed).toBe(2);
    const remaining = await db.select({ id: adminSessionsTable.id }).from(adminSessionsTable);
    expect(remaining.map((r) => r.id)).toEqual([live.sid]);
  });

  it("sid-less tokens still pass OUTSIDE production (legacy test fixtures)", async () => {
    const adminId = await seedAdmin();
    const legacy = signAdminToken({ adminId, role: "admin" });
    const { url, close } = await listen(buildApp());
    try {
      const res = await get(url, legacy);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ ok: true, sid: null });
    } finally {
      close();
    }
  });
});
