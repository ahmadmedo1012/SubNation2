import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { adminUsersTable, db, initTestDb, resetTestDb } from "../../test/db";
import { signAdminToken } from "../../lib/jwt";
import { adminCopilotHistoryRouter } from "../admin/copilot/history";

/**
 * A5-02 / A5-06 (round-94): the copilot history contract.
 *
 * A5-02: CopilotHistoryEntry REQUIRES admin_id (openapi + generated
 * zod `admin_id: zod.number()`), but the response never emitted it —
 * every orval-generated client failed parsing on EVERY history
 * response. The mapper now carries the column.
 *
 * A5-06: the contract documents `since_iso` (with the legacy `since`
 * alias still accepted); an unparseable value for either name is a
 * 400 (previously silently ignored — the documented filter was a
 * no-op). entity_type/entity_id are documented deprecated no-ops.
 */

const COPILOT_ACTIONS_DDL = `
CREATE TABLE copilot_actions (
  id serial PRIMARY KEY,
  preview_id varchar(32),
  admin_id integer NOT NULL,
  intent_text text NOT NULL,
  tool_name varchar(100),
  action_class varchar(50) NOT NULL,
  risk_tier varchar(20) NOT NULL,
  outcome varchar(20) NOT NULL,
  failure_reason text,
  before_state jsonb,
  after_state jsonb,
  confirmed_once_at timestamptz,
  confirmed_twice_at timestamptz,
  executed_at timestamptz,
  model_id varchar(64),
  model_input_tokens integer,
  model_output_tokens integer,
  correlation_id varchar(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/admin", adminCopilotHistoryRouter);
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

async function seedAdmin(username: string): Promise<{ id: number; token: string }> {
  const [a] = await db
    .insert(adminUsersTable)
    .values({ username, passwordHash: "x", isActive: true })
    .returning();
  return { id: a.id, token: signAdminToken({ adminId: a.id, role: "admin" }) };
}

let actionSeq = 0;
async function seedAction(
  adminId: number,
  createdAt: Date,
  overrides: Partial<{ outcome: string; actionClass: string }> = {},
): Promise<number> {
  actionSeq += 1;
  const [row] = await db
    .execute(
      sql`INSERT INTO copilot_actions
          (admin_id, intent_text, action_class, risk_tier, outcome, correlation_id, created_at)
          VALUES (${adminId}, ${"غيّر سعر المنتج"}, ${overrides.actionClass ?? "catalog_edit"},
                  ${"low"}, ${overrides.outcome ?? "success"}, ${"corr-" + actionSeq},
                  ${createdAt.toISOString()}::timestamptz)
          RETURNING id`,
    )
    .then((r) => (Array.isArray(r) ? r : (r.rows ?? [])) as Array<{ id: number }>);
  return row.id;
}

async function get(url: string, path: string, token: string) {
  const res = await fetch(`${url}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

beforeAll(async () => {
  await initTestDb();
  await db.execute(sql.raw(COPILOT_ACTIONS_DDL));
});

beforeEach(async () => {
  await resetTestDb();
  await db.execute(sql.raw("TRUNCATE copilot_actions RESTART IDENTITY"));
});

describe("GET /api/admin/copilot/history — contract (A5-02/A5-06)", () => {
  it("emits admin_id on every entry (the field orval-generated clients require)", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const admin = await seedAdmin("admin_history_1");
      await seedAction(admin.id, new Date(Date.now() - 60_000));
      await seedAction(admin.id, new Date());

      const res = await get(url, "/api/admin/copilot/history", admin.token);
      expect(res.status).toBe(200);
      const entries = (res.body as { entries: Array<Record<string, unknown>> }).entries;
      expect(entries).toHaveLength(2);
      for (const e of entries) {
        expect(e.admin_id).toBe(admin.id);
      }
    } finally {
      close();
    }
  });

  it("stays owner-scoped (another admin's actions are invisible)", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const owner = await seedAdmin("admin_history_owner");
      const other = await seedAdmin("admin_history_other");
      await seedAction(owner.id, new Date());

      const res = await get(url, "/api/admin/copilot/history", other.token);
      expect(res.status).toBe(200);
      expect((res.body as { entries: unknown[] }).entries).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("filters by since_iso (the documented param — previously a silent no-op)", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const admin = await seedAdmin("admin_history_since");
      const cutoff = new Date(Date.now() - 30 * 60_000);
      await seedAction(admin.id, new Date(cutoff.getTime() - 60_000)); // older
      await seedAction(admin.id, new Date()); // newer

      const res = await get(
        url,
        `/api/admin/copilot/history?since_iso=${encodeURIComponent(cutoff.toISOString())}`,
        admin.token,
      );
      expect(res.status).toBe(200);
      const entries = (res.body as { entries: Array<Record<string, unknown>> }).entries;
      expect(entries).toHaveLength(1);
      expect(entries[0].admin_id).toBe(admin.id);
    } finally {
      close();
    }
  });

  it("accepts the legacy `since` alias with the same semantics", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const admin = await seedAdmin("admin_history_alias");
      const cutoff = new Date(Date.now() - 30 * 60_000);
      await seedAction(admin.id, new Date(cutoff.getTime() - 60_000));
      await seedAction(admin.id, new Date());

      const res = await get(
        url,
        `/api/admin/copilot/history?since=${encodeURIComponent(cutoff.toISOString())}`,
        admin.token,
      );
      expect(res.status).toBe(200);
      expect((res.body as { entries: unknown[] }).entries).toHaveLength(1);
    } finally {
      close();
    }
  });

  it("400s for an unparseable since_iso instead of silently ignoring it", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const admin = await seedAdmin("admin_history_bad");
      const res = await get(url, "/api/admin/copilot/history?since_iso=not-a-date", admin.token);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: "INVALID_DATA" });
    } finally {
      close();
    }
  });

  it("ignores the deprecated entity_type param (documented no-op, not a 400)", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const admin = await seedAdmin("admin_history_entity");
      await seedAction(admin.id, new Date());

      const res = await get(url, "/api/admin/copilot/history?entity_type=product", admin.token);
      expect(res.status).toBe(200);
      expect((res.body as { entries: unknown[] }).entries).toHaveLength(1);
    } finally {
      close();
    }
  });
});

// R123-E5 (A6 P3): no-store parity with the 98-F3 pattern — the
// history feed carries an admin's own action audit (prompts,
// outcomes); an intermediary must never serve it from cache.
describe("R123-E5 — no-store on GET /api/admin/copilot/history", () => {
  it("the history read ships Cache-Control: no-store", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const admin = await seedAdmin("admin_history_nostore");
      await seedAction(admin.id, new Date());

      // Raw fetch — the `get` helper discards headers, and the header
      // IS the assertion (the R122 auth-sessions no-store idiom).
      const res = await fetch(`${url}/api/admin/copilot/history`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(((await res.json()) as { entries: unknown[] }).entries).toHaveLength(1);
    } finally {
      close();
    }
  });
});
