import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { adminUsersTable, db, initTestDb, resetTestDb, auditLogsTable, execTestSql } from "../../test/db";
import { signAdminToken } from "../../lib/jwt";
import { adminAlertsRouter } from "../admin/alerts";

/**
 * A5-08 (round-94): POST /api/admin/alerts/test used to throw away
 * dispatchTestAlert's real per-channel results and hardcode
 * `{telegram:{ok:true}, discord:{ok:true}, webhook:{ok:true}}` — an
 * operator probing channels during a live outage saw three green
 * checkmarks. The route now mirrors the ACTUAL delivery outcomes and
 * writes an audit row.
 */

vi.mock("../../services/alerting.service", () => ({
  dispatchTestAlert: vi.fn(),
}));

import { dispatchTestAlert } from "../../services/alerting.service";
import type { ChannelDeliveryResult } from "../../services/alerting.service";

const AUDIT_DDL = `
CREATE TYPE audit_actor_type AS ENUM ('user', 'admin', 'system');
CREATE TABLE audit_logs (
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
  app.use("/api/admin/alerts", adminAlertsRouter);
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
    .values({ username: "admin_alerts", passwordHash: "x", isActive: true })
    .returning();
  return { id: a.id, token: signAdminToken({ adminId: a.id, role: "admin" }) };
}

async function postTest(url: string, token: string, body: unknown = {}) {
  const res = await fetch(`${url}/api/admin/alerts/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeAll(async () => {
  await initTestDb();
  await execTestSql(AUDIT_DDL);
});

beforeEach(async () => {
  await resetTestDb();
  await db.execute(sql.raw("TRUNCATE audit_logs RESTART IDENTITY"));
  vi.clearAllMocks();
});

describe("POST /api/admin/alerts/test — real delivery results (A5-08)", () => {
  it("reports per-channel ok:false for failed/skipped channels instead of hardcoded true", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const admin = await seedAdmin();
      const delivery: ChannelDeliveryResult[] = [
        { channel: "telegram", outcome: "delivered", attempts: 1 },
        { channel: "discord", outcome: "failed", attempts: 2, errorMessage: "401 Unauthorized" },
        { channel: "webhook", outcome: "skipped", attempts: 0 },
      ];
      vi.mocked(dispatchTestAlert).mockResolvedValue({
        alert: {
          rule: "api_5xx_rate_high",
          severity: "warning",
          value: 0,
          threshold: 5,
          firedAt: new Date().toISOString(),
          labels: {},
          dedupKey: "k",
          summary: "s",
          runbookUrl: "https://subnation.ly/runbook",
        },
        delivery,
      });

      const res = await postTest(url, admin.token);
      expect(res.status).toBe(200);
      const deliveryBody = res.body.delivery as Record<string, Record<string, unknown>>;
      expect(deliveryBody.telegram).toMatchObject({ ok: true, outcome: "delivered", attempts: 1 });
      expect(deliveryBody.discord).toMatchObject({ ok: false, outcome: "failed" });
      expect(deliveryBody.discord.error_message).toBe("401 Unauthorized");
      expect(deliveryBody.webhook).toMatchObject({ ok: false, outcome: "skipped" });
    } finally {
      close();
    }
  });

  it("passes the rule name through to dispatchTestAlert and audits the dispatch", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const admin = await seedAdmin();
      vi.mocked(dispatchTestAlert).mockResolvedValue({
        alert: {
          rule: "redis_disconnect",
          severity: "critical",
          value: 0,
          threshold: 1,
          firedAt: new Date().toISOString(),
          labels: {},
          dedupKey: "k",
          summary: "s",
          runbookUrl: "https://subnation.ly/runbook",
        },
        delivery: [],
      });

      const res = await postTest(url, admin.token, { rule: "redis_disconnect" });
      expect(res.status).toBe(200);
      expect(dispatchTestAlert).toHaveBeenCalledWith("redis_disconnect");

      const audits = await db
        .select()
        .from(auditLogsTable)
        .where(eq(auditLogsTable.action, "alert.test_dispatch"));
      expect(audits).toHaveLength(1);
      expect(audits[0].actorId).toBe(admin.id);
      expect(JSON.parse(audits[0].metadata!)).toMatchObject({ rule: "redis_disconnect" });
    } finally {
      close();
    }
  });

  it("500s cleanly when dispatchTestAlert throws (no fabricated ok:true on outage)", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const admin = await seedAdmin();
      vi.mocked(dispatchTestAlert).mockRejectedValue(new Error("redis down"));

      const res = await postTest(url, admin.token);
      expect(res.status).toBe(500);
      expect(res.body).toMatchObject({ code: "INTERNAL_ERROR" });
    } finally {
      close();
    }
  });
});
