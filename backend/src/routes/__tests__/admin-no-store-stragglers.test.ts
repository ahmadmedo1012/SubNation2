import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { adminUsersTable, db, initTestDb, resetTestDb } from "../../test/db";
import { signAdminToken } from "../../lib/jwt";
import { adminAuthRouter } from "../admin/auth";
import { adminSettingsRouter } from "../admin/settings";
import { copilotRouter } from "../admin/copilot";

/**
 * R123-E5 (A6 P3): no-store parity with the 98-F3 / R122 pattern — the
 * four admin GET surfaces that had no Cache-Control header at all:
 *
 *   GET /api/admin/session        (identity + permission list echo)
 *   GET /api/admin/settings       (platform settings the panel reads)
 *   GET /api/admin/copilot/settings (phase flags — panel render control)
 *   GET /api/admin/copilot/previews/:id (staged mutation payload)
 *
 * Every other admin router (orders, users, topups, alerts, risk, …)
 * already carries the router-level header; these were the stragglers.
 * The assertions are the R122 auth-sessions idiom: raw fetch, assert
 * `cache-control: no-store` (the header IS the contract).
 *
 * copilot_previews is not part of the shared harness DDL, so the table
 * is provisioned per-file (the copilot-history-contract convention) —
 * the preview GET then takes its clean 404 path (no row seeded), which
 * ALSO proves the router-level header applies to error envelopes.
 */

const COPILOT_PREVIEWS_DDL = `
CREATE TABLE copilot_previews (
  id varchar(32) PRIMARY KEY,
  admin_id integer NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  intent_text text NOT NULL,
  tool_name varchar(100) NOT NULL,
  action_class varchar(50) NOT NULL,
  risk_tier varchar(20) NOT NULL,
  affected_ids jsonb NOT NULL,
  affected_entity_type varchar(50) NOT NULL,
  record_versions jsonb NOT NULL,
  preview_payload jsonb NOT NULL,
  model_id varchar(64) NOT NULL,
  correlation_id varchar(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  confirmed_once_at timestamptz,
  cooldown_starts_at timestamptz,
  confirmed_twice_at timestamptz
);
`;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  // Same mount shapes as routes/admin/index.ts: the settings router at
  // "/settings", auth + copilot at the admin root.
  app.use("/api/admin", adminAuthRouter, copilotRouter);
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
  await db.execute(sql.raw("DROP TABLE IF EXISTS copilot_previews"));
  await db.execute(sql.raw(COPILOT_PREVIEWS_DDL));
});

describe("R123-E5 — no-store on the four admin GET stragglers", () => {
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

  it("GET /api/admin/copilot/settings ships Cache-Control: no-store", async () => {
    const admin = await seedAdmin();
    const { url, close } = await listen();
    try {
      const res = await fetch(`${url}/api/admin/copilot/settings`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
    } finally {
      close();
    }
  });

  it("GET /api/admin/copilot/previews/:id ships Cache-Control: no-store (error envelopes too)", async () => {
    const admin = await seedAdmin();
    const { url, close } = await listen();
    try {
      // No preview row seeded — the 404 path. The router-level header
      // fires before the handler, so the error envelope carries it too
      // (a cached 404 would be worse than a cached 200 here).
      const res = await fetch(`${url}/api/admin/copilot/previews/01NOSTORE`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      });
      expect(res.status).toBe(404);
      expect(res.headers.get("cache-control")).toBe("no-store");
    } finally {
      close();
    }
  });
});
