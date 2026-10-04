import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import { eq, sql } from "drizzle-orm";
import { adminUsersTable, db, initTestDb, resetTestDb, riskConfigTable } from "../../test/db";
import { createAdminSession } from "../../lib/admin-session";
import { adminRiskRouter } from "../admin/risk";

/**
 * 98-F3 (R98-A1 P2-5) — PUT /api/admin/risk/config nested-shape validation.
 *
 * The PUT body used to read nested fields with raw `??` fallbacks: a STRING
 * threshold ("30") passed the coerced ordering comparison and persisted into
 * the jsonb column as a string — silently disabling level gating downstream
 * (risk-config-cache.service levelFor compares numbers). Unbounded /
 * object-valued allowlist arrays corrupted the matcher and bloated the
 * singleton row. The route now schema-validates the whole nested shape
 * (thresholds: finite 0-100 numbers, ips: real IP literals capped at 100,
 * requireApprovalUserIds: positive ints capped at 1000) and answers 400 +
 * Arabic copy on mismatch, keeping the low < medium < high < critical
 * ordering invariant that was already enforced.
 *
 * Harness: real adminRiskRouter + real requireAdmin over the pglite fixture
 * DB (risk_config + audit_logs DDL owned here — not in the shared harness).
 */

function buildApp(): Express {
  const app = express();
  // Mirror the real app's 1 MB JSON limit (app.ts express.json) so the
  // over-length-array case exercises the zod bound, not the parser cap.
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/admin", adminRiskRouter);
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

interface AuthedSession {
  adminId: number;
  token: string;
}

async function seedAdmin(): Promise<AuthedSession> {
  const [a] = await db
    .insert(adminUsersTable)
    .values({
      username: "risk_admin",
      passwordHash: "x",
      isActive: true,
      permissions: ["users"],
    })
    .returning();
  const { token } = await createAdminSession({ adminId: a.id, role: "admin" });
  return { adminId: a.id, token };
}

async function putConfig(
  url: string,
  token: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const res = await fetch(`${url}/api/admin/risk/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : null,
  };
}

async function currentConfigRow(): Promise<typeof riskConfigTable.$inferSelect | undefined> {
  const [row] = await db.select().from(riskConfigTable).where(eq(riskConfigTable.id, 1)).limit(1);
  return row;
}

beforeAll(async () => {
  await initTestDb();
  // risk_config + audit_logs are not part of the shared test DDL — this
  // file owns them (mirrors shared/db/src/schema/risk.ts + audit_logs.ts;
  // writeAuditLog is awaited on the PUT path).
  await db.execute(
    sql.raw(`CREATE TABLE IF NOT EXISTS risk_config (
  id integer PRIMARY KEY DEFAULT 1,
  thresholds jsonb NOT NULL DEFAULT '{"low":0,"medium":30,"high":60,"critical":85}',
  allowlist jsonb NOT NULL DEFAULT '{"ips":[],"devices":[],"phones":[]}',
  auto_block_enabled jsonb NOT NULL DEFAULT '{"softBlock":true,"hardBlock":false,"alert":true}',
  require_approval_user_ids jsonb NOT NULL DEFAULT '[]',
  model_enabled boolean NOT NULL DEFAULT false,
  updated_by integer REFERENCES admin_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
)`),
  );
  await db.execute(
    sql.raw(`DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'audit_actor_type') THEN
    CREATE TYPE audit_actor_type AS ENUM ('user', 'admin', 'system');
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;`),
  );
  await db.execute(
    sql.raw(`CREATE TABLE IF NOT EXISTS audit_logs (
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
)`),
  );
});

beforeEach(async () => {
  await resetTestDb();
  // risk_config / audit_logs are not in the shared TRUNCATE list.
  await db.execute(sql.raw("DELETE FROM risk_config;"));
  await db.execute(sql.raw("DELETE FROM audit_logs;"));
});

describe("98-F3 — PUT /api/admin/risk/config nested-shape validation", () => {
  it("a STRING threshold → 400 (never persisted into the jsonb column)", async () => {
    const { token } = await seedAdmin();
    const { url, close } = await listen(buildApp());
    try {
      const res = await putConfig(url, token, {
        thresholds: { low: "0", medium: 30, high: 60, critical: 85 },
      });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: "INVALID_DATA" });
      expect(await currentConfigRow()).toBeUndefined();
    } finally {
      close();
    }
  });

  it("a NaN threshold → 400", async () => {
    const { token } = await seedAdmin();
    const { url, close } = await listen(buildApp());
    try {
      const res = await putConfig(url, token, {
        thresholds: { medium: Number.NaN },
      });
      expect(res.status).toBe(400);
      expect(await currentConfigRow()).toBeUndefined();
    } finally {
      close();
    }
  });

  it("an over-range threshold (101) → 400", async () => {
    const { token } = await seedAdmin();
    const { url, close } = await listen(buildApp());
    try {
      const res = await putConfig(url, token, { thresholds: { critical: 101 } });
      expect(res.status).toBe(400);
      expect(await currentConfigRow()).toBeUndefined();
    } finally {
      close();
    }
  });

  it("a 10 000-entry allowlist.ips array → 400 (row-bloat bound)", async () => {
    const { token } = await seedAdmin();
    const { url, close } = await listen(buildApp());
    try {
      const ips = Array.from(
        { length: 10_000 },
        (_, i) => `10.0.${Math.floor(i / 250)}.${i % 250}`,
      );
      const res = await putConfig(url, token, { allowlist: { ips } });
      expect(res.status).toBe(400);
      expect(await currentConfigRow()).toBeUndefined();
    } finally {
      close();
    }
  });

  it('a non-IP allowlist entry ("not-an-ip") → 400 (matcher integrity)', async () => {
    const { token } = await seedAdmin();
    const { url, close } = await listen(buildApp());
    try {
      const res = await putConfig(url, token, {
        allowlist: { ips: ["not-an-ip"] },
      });
      expect(res.status).toBe(400);
      expect(await currentConfigRow()).toBeUndefined();
    } finally {
      close();
    }
  });

  it("a non-integer / non-positive requireApprovalUserIds entry → 400", async () => {
    const { token } = await seedAdmin();
    const { url, close } = await listen(buildApp());
    try {
      const res = await putConfig(url, token, { requireApprovalUserIds: [1, 2.5] });
      expect(res.status).toBe(400);
      const res2 = await putConfig(url, token, { requireApprovalUserIds: [-3] });
      expect(res2.status).toBe(400);
      expect(await currentConfigRow()).toBeUndefined();
    } finally {
      close();
    }
  });

  it("a VALID body → 200 and persists into the singleton row", async () => {
    const { adminId, token } = await seedAdmin();
    const { url, close } = await listen(buildApp());
    try {
      const res = await putConfig(url, token, {
        thresholds: { low: 5, medium: 35, high: 65, critical: 90 },
        allowlist: { ips: ["203.0.113.9", "2001:db8::1"] },
        autoBlockEnabled: { softBlock: false, alert: true },
        modelEnabled: true,
        requireApprovalUserIds: [7, 42],
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: 1,
        model_enabled: true,
        require_approval_user_ids: [7, 42],
      });

      const row = await currentConfigRow();
      expect(row).toBeDefined();
      expect(row!.thresholds).toEqual({ low: 5, medium: 35, high: 65, critical: 90 });
      expect(row!.allowlist).toEqual({
        ips: ["203.0.113.9", "2001:db8::1"],
        devices: [],
        phones: [],
      });
      expect(row!.updatedBy).toBe(adminId);
    } finally {
      close();
    }
  });

  it("the ordering invariant is still enforced AFTER shape validation (low ≥ medium → 400)", async () => {
    const { token } = await seedAdmin();
    const { url, close } = await listen(buildApp());
    try {
      const res = await putConfig(url, token, {
        thresholds: { low: 40, medium: 30, high: 60, critical: 85 },
      });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: expect.stringContaining("thresholds") });
      expect(await currentConfigRow()).toBeUndefined();
    } finally {
      close();
    }
  });

  it("hardBlock without modelEnabled is still refused (pre-existing invariant, unchanged)", async () => {
    const { token } = await seedAdmin();
    const { url, close } = await listen(buildApp());
    try {
      const res = await putConfig(url, token, {
        autoBlockEnabled: { hardBlock: true },
        modelEnabled: false,
      });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: expect.stringContaining("hardBlock") });
    } finally {
      close();
    }
  });

  it("unauthenticated PUT → 401 (requireAdmin still in front)", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const res = await fetch(`${url}/api/admin/risk/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      expect(res.status).toBe(401);
    } finally {
      close();
    }
  });
});
