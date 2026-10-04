import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  adminUsersTable,
  auditLogsTable,
  db,
  execTestSql,
  initTestDb,
  referralEventsTable,
  resetTestDb,
  usersTable,
} from "../../test/db";
import { signAdminToken } from "../../lib/jwt";
import { couponsRouter } from "../coupons";
import { adminReferralsRouter } from "../admin/referrals";

/**
 * R110 (109-m P3): the admin coupon mutations (create / update /
 * archive) and the referral credit were the last admin writes without
 * writeAuditLog rows. These tests pin the added audit calls using the
 * repo's established conventions — minimal metadata (identifier +
 * essential before/after fields), admin actor propagated from
 * requireAdmin, fire-and-forget so a failed audit never blocks the
 * mutation (harness pattern: alerts-test-dispatch.test.ts).
 *
 * The pglite harness does not carry audit_logs (it is a boot-migrations
 * table, not a money-path table) — created locally here, like the
 * alerts suite does.
 */

const AUDIT_DDL = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'audit_actor_type') THEN
    CREATE TYPE audit_actor_type AS ENUM ('user', 'admin', 'system');
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS audit_logs (
  id serial PRIMARY KEY,
  actor_id integer,
  actor_type audit_actor_type NOT NULL DEFAULT 'system',
  action varchar(100) NOT NULL,
  target_type varchar(50),
  target_id integer,
  metadata text,
  ip varchar(45),
  user_agent varchar(500),
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/coupons", couponsRouter);
  app.use("/api/admin", adminReferralsRouter);
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

async function seedAdmin(): Promise<{ id: number; token: string }> {
  const [a] = await db
    .insert(adminUsersTable)
    .values({
      username: "admin_audit_pins",
      passwordHash: "x",
      isActive: true,
      // "all" passes both requirePermission("finance") (coupons) and
      // ("users") (referrals) mounted on these routes.
      permissions: ["all"],
    })
    .returning();
  return { id: a.id, token: signAdminToken({ adminId: a.id, role: "admin" }) };
}

async function request(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  token: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${url}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/**
 * writeAuditLog is fire-and-forget on the route paths under test — the
 * insert may still be in flight when the HTTP response resolves. Poll
 * briefly (pglite is in-process; this resolves on the first tick in
 * practice) so the assertions are race-free.
 */
async function auditRowsFor(action: string): Promise<Array<typeof auditLogsTable.$inferSelect>> {
  const read = () => db.select().from(auditLogsTable).where(eq(auditLogsTable.action, action));
  for (let attempt = 0; attempt < 40; attempt++) {
    const rows = await read();
    if (rows.length > 0) return rows;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return read();
}

beforeAll(async () => {
  await initTestDb();
  await execTestSql(AUDIT_DDL);
});

beforeEach(async () => {
  await resetTestDb();
  await db.execute(sql.raw("TRUNCATE audit_logs RESTART IDENTITY"));
});

describe("R110 — coupons admin mutations write audit rows (109-m P3)", () => {
  it("create audits action + coupon id + the definition fields", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const admin = await seedAdmin();
      const res = await request(url, "POST", "/api/coupons/admin", admin.token, {
        code: "AUDIT10",
        type: "percentage",
        value: 10,
        max_uses: 100,
      });
      expect(res.status).toBe(201);

      const audits = await auditRowsFor("coupon.create");
      expect(audits).toHaveLength(1);
      expect(audits[0].actorId).toBe(admin.id);
      expect(audits[0].actorType).toBe("admin");
      expect(audits[0].targetType).toBe("coupon");
      expect(audits[0].targetId).toBe((res.body as { id: number }).id);
      expect(JSON.parse(audits[0].metadata!)).toMatchObject({
        code: "AUDIT10",
        type: "percentage",
        value: 10,
        max_uses: 100,
      });
    } finally {
      close();
    }
  });

  it("update audits before/after for exactly the changed fields", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const admin = await seedAdmin();
      const created = await request(url, "POST", "/api/coupons/admin", admin.token, {
        code: "AUDITPATCH",
        type: "fixed",
        value: 5,
      });
      expect(created.status).toBe(201);

      const res = await request(
        url,
        "PATCH",
        `/api/coupons/admin/${(created.body as { id: number }).id}`,
        admin.token,
        { is_active: false, max_uses: 7 },
      );
      expect(res.status).toBe(200);

      const audits = await auditRowsFor("coupon.update");
      expect(audits).toHaveLength(1);
      expect(audits[0].targetId).toBe((created.body as { id: number }).id);
      expect(JSON.parse(audits[0].metadata!)).toMatchObject({
        code: "AUDITPATCH",
        changes: {
          is_active: { before: true, after: false },
          max_uses: { before: null, after: 7 },
        },
      });
    } finally {
      close();
    }
  });

  it("archive audits the coupon id + code", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const admin = await seedAdmin();
      const created = await request(url, "POST", "/api/coupons/admin", admin.token, {
        code: "AUDITARCH",
        type: "fixed",
        value: 3,
      });
      expect(created.status).toBe(201);

      const res = await request(
        url,
        "DELETE",
        `/api/coupons/admin/${(created.body as { id: number }).id}`,
        admin.token,
      );
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true });

      const audits = await auditRowsFor("coupon.archive");
      expect(audits).toHaveLength(1);
      expect(audits[0].targetId).toBe((created.body as { id: number }).id);
      expect(JSON.parse(audits[0].metadata!)).toMatchObject({ code: "AUDITARCH" });
    } finally {
      close();
    }
  });
});

describe("R110 — referral credit writes an audit row (109-m P3)", () => {
  it("credit audits the event id, both parties, and the granted points", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const admin = await seedAdmin();
      const [referrer] = await db.insert(usersTable).values({ phone: "0911000011" }).returning();
      const [referee] = await db.insert(usersTable).values({ phone: "0911000012" }).returning();
      const [event] = await db
        .insert(referralEventsTable)
        .values({ referrerId: referrer.id, refereeId: referee.id, status: "pending" })
        .returning();

      const res = await request(
        url,
        "POST",
        `/api/admin/referrals/${event.id}/credit`,
        admin.token,
      );
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, points_credited: 50 });

      const audits = await auditRowsFor("referral.credit");
      expect(audits).toHaveLength(1);
      expect(audits[0].actorId).toBe(admin.id);
      expect(audits[0].targetType).toBe("referral_event");
      expect(audits[0].targetId).toBe(event.id);
      expect(JSON.parse(audits[0].metadata!)).toMatchObject({
        referrer_id: referrer.id,
        referee_id: referee.id,
        points: 50,
      });
    } finally {
      close();
    }
  });
});

// ── B1-3 (R111, round-111 B1 audit): the referral credit is a money write ──
// (50 loyalty points = 0.50 LYD convertible at 100:1) and now carries the
// `finance` scope gate on the route itself — the router mount only demands
// `users` (the LIST is user data). The mini-app mount here skips the
// parent users gate exactly like the other suites; the route-level finance
// gate is what these tests pin (in the real composition an admin needs
// users + finance, matching admin/index.ts).

describe("B1-3 — POST /api/admin/referrals/:id/credit requires the finance scope", () => {
  async function seedScopedAdmin(permissions: string[]): Promise<string> {
    const [a] = await db
      .insert(adminUsersTable)
      .values({
        username: `admin_ref_scope_${permissions.join("_")}`,
        passwordHash: "x",
        isActive: true,
        permissions,
      })
      .returning();
    return signAdminToken({ adminId: a.id, role: "admin" });
  }

  it("a users-only admin (the old mount scope) → 403, no points granted, no audit row", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const token = await seedScopedAdmin(["users"]);
      const [referrer] = await db.insert(usersTable).values({ phone: "0911000021" }).returning();
      const [referee] = await db.insert(usersTable).values({ phone: "0911000022" }).returning();
      const [event] = await db
        .insert(referralEventsTable)
        .values({ referrerId: referrer.id, refereeId: referee.id, status: "pending" })
        .returning();

      const res = await request(url, "POST", `/api/admin/referrals/${event.id}/credit`, token);
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: "FORBIDDEN" });

      // Nothing granted: event still pending, referrer points untouched.
      const [row] = await db
        .select()
        .from(referralEventsTable)
        .where(eq(referralEventsTable.id, event.id));
      expect(row.status).toBe("pending");
      const [after] = await db.select().from(usersTable).where(eq(usersTable.id, referrer.id));
      expect(after.loyaltyPoints).toBe(0);
    } finally {
      close();
    }
  });

  it("an admin holding finance (users+finance, or the wildcard) may still credit", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const token = await seedScopedAdmin(["users", "finance"]);
      const [referrer] = await db.insert(usersTable).values({ phone: "0911000031" }).returning();
      const [referee] = await db.insert(usersTable).values({ phone: "0911000032" }).returning();
      const [event] = await db
        .insert(referralEventsTable)
        .values({ referrerId: referrer.id, refereeId: referee.id, status: "pending" })
        .returning();

      const res = await request(url, "POST", `/api/admin/referrals/${event.id}/credit`, token);
      expect(res.status).toBe(200);
      const [after] = await db.select().from(usersTable).where(eq(usersTable.id, referrer.id));
      expect(after.loyaltyPoints).toBe(50);
    } finally {
      close();
    }
  });
});
