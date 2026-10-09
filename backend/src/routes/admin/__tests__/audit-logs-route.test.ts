import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { adminUsersTable, auditLogsTable, db, initTestDb, resetTestDb } from "../../../test/db";
import { signAdminToken } from "../../../lib/jwt";
import { requireAdmin } from "../../../middlewares/requireAdmin";
import { requirePermission } from "../../../lib/permissions";
import { adminRouter } from "../index";
import { adminAuditLogsRouter } from "../audit-logs";

/**
 * R127-L5 (B15-1) — the audit-trail reader route.
 *
 * Two harnesses:
 *
 *   1. ISOLATED — the route behind its exact production gate chain
 *      (requireAdmin → requirePermission("admins") → the router,
 *      mounted at /api/admin/audit-logs). This pins the route's OWN
 *      scope decision: an admins-scoped admin passes, a support-only
 *      admin 403s, no token 401s — without the admin root mount's
 *      sibling "/"-scoped routers (a support admin on the full chain
 *      is rejected by the EARLIER users mount, which would mask the
 *      admins gate this suite exists to pin).
 *   2. INTEGRATION — the REAL adminRouter: the ["all"] wildcard
 *      operator reaches GET /api/admin/audit-logs through the full
 *      middleware stack and gets the page envelope (the mount +
 *      production path).
 *
 * Locked behaviours: scope, envelope + attribution, pagination
 * clamps, filters (action/actor/target/date-range), and the 400
 * strictness class (unparseable dates, non-integer ids — A5-09).
 */

function buildIsolatedApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/admin/audit-logs", requireAdmin, requirePermission("admins"), adminAuditLogsRouter);
  return app;
}

function buildRealApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/admin", adminRouter);
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

let adminSeq = 0;
async function seedAdmin(
  permissions: string[],
): Promise<{ id: number; username: string; token: string }> {
  adminSeq += 1;
  const username = `audit_admin_${adminSeq}`;
  const [a] = await db
    .insert(adminUsersTable)
    .values({
      username,
      passwordHash: "x",
      isActive: true,
      permissions,
    })
    .returning();
  return { id: a.id, username, token: signAdminToken({ adminId: a.id, role: "admin" }) };
}

async function callLogs(
  url: string,
  path: string,
  token: string | null,
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const res = await fetch(`${url}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
}

/** Seed one audit row (deterministic createdAt where given). */
async function seedAudit(
  over: Partial<{
    actorId: number | null;
    actorType: "user" | "admin" | "system";
    action: string;
    targetType: string;
    targetId: number;
    metadata: string;
    ip: string;
    createdAt: Date;
  }> = {},
) {
  const [row] = await db
    .insert(auditLogsTable)
    .values({
      actorId: over.actorId ?? null,
      actorType: over.actorType ?? "admin",
      action: over.action ?? "topup.approve",
      targetType: over.targetType ?? "topup",
      targetId: over.targetId ?? null,
      metadata: over.metadata ?? null,
      ip: over.ip ?? null,
      ...(over.createdAt ? { createdAt: over.createdAt } : {}),
    })
    .returning();
  return row;
}

beforeAll(async () => {
  await initTestDb();
});

beforeEach(async () => {
  await resetTestDb();
});

describe("R127-L5 — /api/admin/audit-logs auth scope (admins gate)", () => {
  it("no token → 401", async () => {
    const { url, close } = await listen(buildIsolatedApp());
    try {
      const res = await callLogs(url, "/api/admin/audit-logs", null);
      expect(res.status).toBe(401);
    } finally {
      close();
    }
  });

  it("a support-only admin → 403 FORBIDDEN (the audit trail is admins-scope)", async () => {
    const { token } = await seedAdmin(["support"]);
    const { url, close } = await listen(buildIsolatedApp());
    try {
      const res = await callLogs(url, "/api/admin/audit-logs", token);
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: "FORBIDDEN" });
    } finally {
      close();
    }
  });

  it("an admins-scoped admin → 200 (the security family's own gate)", async () => {
    const { token } = await seedAdmin(["admins"]);
    const { url, close } = await listen(buildIsolatedApp());
    try {
      const res = await callLogs(url, "/api/admin/audit-logs", token);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ logs: [], total: 0, page: 1, limit: 50, hasMore: false });
    } finally {
      close();
    }
  });

  it('the REAL admin router serves GET /api/admin/audit-logs to the ["all"] operator', async () => {
    const { token } = await seedAdmin(["all"]);
    const { url, close } = await listen(buildRealApp());
    try {
      const res = await callLogs(url, "/api/admin/audit-logs", token);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ logs: [], total: 0, page: 1, limit: 50, hasMore: false });
    } finally {
      close();
    }
  });
});

describe("R127-L5 — /api/admin/audit-logs envelope, ordering + attribution", () => {
  it("returns the alerts-page envelope, newest first, with the LEFT-JOINed actorUsername", async () => {
    const admin = await seedAdmin(["admins"]);
    await seedAudit({
      actorId: admin.id,
      action: "topup.approve",
      targetId: 41,
      ip: "41.208.0.1",
      createdAt: new Date("2026-10-01T10:00:00Z"),
    });
    await seedAudit({
      actorId: null,
      action: "topup.reject",
      targetId: 42,
      metadata: JSON.stringify({ source: "telegram_webhook", actor: "@ops", from_id: 111 }),
      ip: "149.154.167.1",
      createdAt: new Date("2026-10-02T10:00:00Z"),
    });

    const { url, close } = await listen(buildIsolatedApp());
    try {
      const res = await callLogs(url, "/api/admin/audit-logs", admin.token);
      expect(res.status).toBe(200);
      const body = res.body as {
        logs: Array<Record<string, unknown>>;
        total: number;
        page: number;
        limit: number;
        hasMore: boolean;
      };
      expect(body.total).toBe(2);
      expect(body.page).toBe(1);
      expect(body.limit).toBe(50);
      expect(body.hasMore).toBe(false);
      expect(body.logs).toHaveLength(2);

      // Newest first: the telegram row (2026-10-02) precedes the
      // console row (2026-10-01).
      expect(body.logs[0]).toMatchObject({
        action: "topup.reject",
        targetId: 42,
        actorId: null,
        actorUsername: null,
        ip: "149.154.167.1",
      });
      // B15-1's attribution answer: the console row names the admin.
      expect(body.logs[1]).toMatchObject({
        action: "topup.approve",
        actorId: admin.id,
        actorUsername: admin.username,
      });
      expect(typeof body.logs[1].createdAt).toBe("string");
    } finally {
      close();
    }
  });

  it("same-timestamp rows order by id DESC (the stable-offset tiebreaker)", async () => {
    const admin = await seedAdmin(["admins"]);
    const ts = new Date("2026-10-01T10:00:00Z");
    await seedAudit({ action: "tie.first", createdAt: ts });
    await seedAudit({ action: "tie.second", createdAt: ts });

    const { url, close } = await listen(buildIsolatedApp());
    try {
      const res = await callLogs(url, "/api/admin/audit-logs", admin.token);
      const actions = (res.body as { logs: Array<{ action: string }> }).logs.map((l) => l.action);
      expect(actions).toEqual(["tie.second", "tie.first"]);
    } finally {
      close();
    }
  });
});

describe("R127-L5 — /api/admin/audit-logs pagination (shared clamps)", () => {
  it("page/limit slice the trail; hasMore is honest on the last page", async () => {
    const admin = await seedAdmin(["admins"]);
    // Five rows, strictly increasing timestamps (newest = seed #5).
    for (let i = 1; i <= 5; i += 1) {
      await seedAudit({
        action: `test.event_${i}`,
        createdAt: new Date(Date.UTC(2026, 9, i)),
      });
    }

    const { url, close } = await listen(buildIsolatedApp());
    try {
      const page1 = await callLogs(url, "/api/admin/audit-logs?limit=2&page=1", admin.token);
      expect(page1.status).toBe(200);
      expect(page1.body).toMatchObject({ total: 5, page: 1, limit: 2, hasMore: true });
      expect((page1.body as { logs: Array<{ action: string }> }).logs.map((l) => l.action)).toEqual(
        ["test.event_5", "test.event_4"],
      );

      const page3 = await callLogs(url, "/api/admin/audit-logs?limit=2&page=3", admin.token);
      expect(page3.body).toMatchObject({ total: 5, page: 3, limit: 2, hasMore: false });
      expect((page3.body as { logs: Array<{ action: string }> }).logs.map((l) => l.action)).toEqual(
        ["test.event_1"],
      );
    } finally {
      close();
    }
  });

  it("garbage page/limit clamp (NaN → defaults, limit caps at 200)", async () => {
    const admin = await seedAdmin(["admins"]);
    const { url, close } = await listen(buildIsolatedApp());
    try {
      const res = await callLogs(url, "/api/admin/audit-logs?page=abc&limit=99999", admin.token);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ page: 1, limit: 200 });
    } finally {
      close();
    }
  });
});

describe("R127-L5 — /api/admin/audit-logs filters", () => {
  it('action (exact match, "all" = no filter)', async () => {
    const admin = await seedAdmin(["admins"]);
    await seedAudit({ action: "topup.approve" });
    await seedAudit({ action: "topup.reject" });

    const { url, close } = await listen(buildIsolatedApp());
    try {
      const filtered = await callLogs(
        url,
        "/api/admin/audit-logs?action=topup.approve",
        admin.token,
      );
      const actions = (filtered.body as { logs: Array<{ action: string }> }).logs.map(
        (l) => l.action,
      );
      expect(actions).toEqual(["topup.approve"]);

      const all = await callLogs(url, "/api/admin/audit-logs?action=all", admin.token);
      expect((all.body as { total: number }).total).toBe(2);
    } finally {
      close();
    }
  });

  it("actor (admin id) + target (row id)", async () => {
    const admin = await seedAdmin(["admins"]);
    const other = await seedAdmin(["admins"]);
    await seedAudit({ actorId: admin.id, action: "user.update", targetId: 7 });
    await seedAudit({ actorId: other.id, action: "user.update", targetId: 8 });

    const { url, close } = await listen(buildIsolatedApp());
    try {
      const byActor = await callLogs(url, `/api/admin/audit-logs?actor=${admin.id}`, admin.token);
      expect(byActor.status).toBe(200);
      expect((byActor.body as { total: number }).total).toBe(1);
      expect((byActor.body as { logs: Array<{ actorId: number | null }> }).logs[0].actorId).toBe(
        admin.id,
      );

      const byTarget = await callLogs(url, "/api/admin/audit-logs?target=8", admin.token);
      expect((byTarget.body as { total: number }).total).toBe(1);
      expect((byTarget.body as { logs: Array<{ targetId: number | null }> }).logs[0].targetId).toBe(
        8,
      );
    } finally {
      close();
    }
  });

  it("startDate/endDate are inclusive bounds on created_at", async () => {
    const admin = await seedAdmin(["admins"]);
    await seedAudit({ action: "old.event", createdAt: new Date("2026-09-01T00:00:00Z") });
    await seedAudit({ action: "mid.event", createdAt: new Date("2026-10-01T00:00:00Z") });
    await seedAudit({ action: "new.event", createdAt: new Date("2026-11-01T00:00:00Z") });

    const { url, close } = await listen(buildIsolatedApp());
    try {
      const window = await callLogs(
        url,
        "/api/admin/audit-logs?startDate=2026-09-15T00:00:00.000Z&endDate=2026-10-15T00:00:00.000Z",
        admin.token,
      );
      const actions = (window.body as { logs: Array<{ action: string }> }).logs.map(
        (l) => l.action,
      );
      expect(actions).toEqual(["mid.event"]);

      const fromStart = await callLogs(
        url,
        "/api/admin/audit-logs?startDate=2026-10-01T00:00:00.000Z",
        admin.token,
      );
      expect((fromStart.body as { total: number }).total).toBe(2);
    } finally {
      close();
    }
  });
});

describe("R127-L5 — /api/admin/audit-logs 400s (A5-09 strictness class)", () => {
  it("unparseable startDate / endDate → 400 INVALID_DATA", async () => {
    const admin = await seedAdmin(["admins"]);
    const { url, close } = await listen(buildIsolatedApp());
    try {
      const start = await callLogs(url, "/api/admin/audit-logs?startDate=abc", admin.token);
      expect(start.status).toBe(400);
      expect(start.body).toMatchObject({ code: "INVALID_DATA" });

      const end = await callLogs(url, "/api/admin/audit-logs?endDate=not-a-date", admin.token);
      expect(end.status).toBe(400);
      expect(end.body).toMatchObject({ code: "INVALID_DATA" });
    } finally {
      close();
    }
  });

  it("non-integer actor / target → 400 INVALID_DATA", async () => {
    const admin = await seedAdmin(["admins"]);
    const { url, close } = await listen(buildIsolatedApp());
    try {
      const actor = await callLogs(url, "/api/admin/audit-logs?actor=12abc", admin.token);
      expect(actor.status).toBe(400);
      expect(actor.body).toMatchObject({ code: "INVALID_DATA" });

      const target = await callLogs(url, "/api/admin/audit-logs?target=-5", admin.token);
      expect(target.status).toBe(400);
      expect(target.body).toMatchObject({ code: "INVALID_DATA" });
    } finally {
      close();
    }
  });
});
