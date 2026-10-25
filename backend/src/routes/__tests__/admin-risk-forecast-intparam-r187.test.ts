import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import { eq, sql } from "drizzle-orm";
import {
  adminUsersTable,
  db,
  execTestSql,
  initTestDb,
  resetTestDb,
  riskEventsTable,
  riskLabelsTable,
  riskRulesTable,
} from "../../test/db";
import { signAdminToken } from "../../lib/jwt";
import { adminRiskRouter } from "../admin/risk";
import { adminForecastRouter } from "../admin/forecast";

/**
 * R187 (F-F1) — the last four Number.parseInt :id sites, digit-exact now.
 *
 * admin/risk.ts (GET /events/:id, POST /events/:id/label, PUT /rules/:id)
 * and admin/forecast.ts (GET /products/:id) still parsed with
 * `Number.parseInt(String(req.params.id ?? ""), 10)` — parseInt("12abc")
 * silently truncated to 12 and acted on resource 12 (two of the four are
 * WRITES: a risk_labels row, a rules update). All four now use the house
 * intParam (lib/http.ts, the R186 E-F2 enrichment idiom):
 *
 *   1. GET  /risk/events/12abc      → 400 INVALID_DATA (not a 404/500);
 *   2. POST /risk/events/12abc/label → 400 and event 12 stays UNLABELED
 *      (pre-fix: the label landed on event 12);
 *   3. PUT  /risk/rules/12abc        → 400 and rule 12 stays untouched;
 *   4. GET  /forecast/products/12abc → 400 INVALID_DATA;
 *   5. controls: the well-formed ids on the same routes still work
 *      (the detail view 200s, the label writes, the rule toggles).
 *
 * Harness: real adminRiskRouter + adminForecastRouter + real requireAdmin
 * over the pglite fixture DB (risk tables DDL owned here, the
 * admin-stats-emit RISK_DDL idiom + risk_rules + audit_logs).
 */

const RISK_DDL = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'risk_event_type') THEN
    CREATE TYPE risk_event_type AS ENUM (
      'login_attempt','login_success','login_failure','otp_request','otp_verify',
      'topup_attempt','topup_success','order_create','order_deliver','coupon_apply',
      'referral_event','admin_force_reauth');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'risk_level') THEN
    CREATE TYPE risk_level AS ENUM ('low','medium','high','critical');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'risk_action_taken') THEN
    CREATE TYPE risk_action_taken AS ENUM ('none','log','soft_block','hard_block','alert');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'risk_label_kind') THEN
    CREATE TYPE risk_label_kind AS ENUM ('confirmed_fraud','false_positive','escalated');
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE IF NOT EXISTS risk_events (
  id serial PRIMARY KEY,
  user_id integer REFERENCES users(id) ON DELETE SET NULL,
  event_type risk_event_type NOT NULL,
  score integer NOT NULL,
  level risk_level NOT NULL,
  confidence numeric(4,3) NOT NULL,
  rule_fired text[] NOT NULL DEFAULT '{}',
  statistical_signals jsonb NOT NULL DEFAULT '{}',
  ml_score numeric(4,3),
  top_features jsonb,
  action_taken risk_action_taken NOT NULL DEFAULT 'log',
  ip_address varchar(45),
  user_agent varchar(256),
  created_at timestamptz NOT NULL DEFAULT now(),
  shown_at timestamptz
);
CREATE TABLE IF NOT EXISTS risk_labels (
  id serial PRIMARY KEY,
  risk_event_id integer REFERENCES risk_events(id) ON DELETE SET NULL,
  label risk_label_kind NOT NULL,
  labeled_by integer REFERENCES admin_users(id) ON DELETE SET NULL,
  labeled_at timestamptz NOT NULL DEFAULT now(),
  notes text
);
CREATE TABLE IF NOT EXISTS risk_rules (
  id serial PRIMARY KEY,
  name varchar(100) NOT NULL UNIQUE,
  description text NOT NULL,
  expression jsonb NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_by integer REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by integer REFERENCES admin_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id serial PRIMARY KEY,
  actor_id integer,
  actor_type varchar(20) NOT NULL DEFAULT 'system',
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
  app.use("/api/admin", adminRiskRouter);
  app.use("/api/admin", adminForecastRouter);
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
async function seedAdmin(): Promise<string> {
  adminSeq += 1;
  const [a] = await db
    .insert(adminUsersTable)
    .values({
      username: `intparam_admin_${adminSeq}`,
      passwordHash: "x",
      isActive: true,
      permissions: ["users"],
    })
    .returning();
  return signAdminToken({ adminId: a.id, role: "admin" });
}

/** One event with the EXPLICIT id requested (the silent-truncation target). */
async function seedEventWithId(id: number): Promise<void> {
  await db.insert(riskEventsTable).values({
    id,
    eventType: "login_failure",
    score: 80,
    level: "high",
    confidence: "0.900",
  });
}

async function seedRuleWithId(id: number): Promise<void> {
  await db.insert(riskRulesTable).values({
    id,
    name: `rule_${id}`,
    description: "intparam pin rule",
    expression: { type: "and", clauses: [], score_delta: 0 },
    enabled: true,
    version: 1,
  });
}

async function call(
  url: string,
  path: string,
  method: "GET" | "POST" | "PUT",
  token: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const res = await fetch(`${url}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
}

beforeAll(async () => {
  await initTestDb();
  await execTestSql(RISK_DDL);
});

beforeEach(async () => {
  await resetTestDb();
  await db.execute(sql.raw("DELETE FROM risk_labels"));
  await db.execute(sql.raw("DELETE FROM risk_events"));
  await db.execute(sql.raw("DELETE FROM risk_rules"));
  await db.execute(sql.raw("DELETE FROM audit_logs"));
});

describe("R187 (F-F1) — digit-exact :id parsing on the risk + forecast routes", () => {
  it("GET /risk/events/12abc → 400 INVALID_DATA (never a 404 on the truncated id)", async () => {
    const token = await seedAdmin();
    await seedEventWithId(12);
    const { url, close } = await listen(buildApp());
    try {
      const res = await call(url, "/api/admin/risk/events/12abc", "GET", token);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: "INVALID_DATA" });
    } finally {
      close();
    }
  });

  it("POST /risk/events/12abc/label → 400 and event 12 stays UNLABELED (pre-fix: the label landed on 12)", async () => {
    const token = await seedAdmin();
    await seedEventWithId(12);
    const { url, close } = await listen(buildApp());
    try {
      const res = await call(url, "/api/admin/risk/events/12abc/label", "POST", token, {
        label: "escalated",
      });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: "INVALID_DATA" });

      const labels = await db
        .select()
        .from(riskLabelsTable)
        .where(eq(riskLabelsTable.riskEventId, 12));
      expect(labels).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("control — POST /risk/events/12/label still labels the well-formed id", async () => {
    const token = await seedAdmin();
    await seedEventWithId(12);
    const { url, close } = await listen(buildApp());
    try {
      const res = await call(url, "/api/admin/risk/events/12/label", "POST", token, {
        label: "escalated",
      });
      expect(res.status).toBe(200);

      const labels = await db
        .select()
        .from(riskLabelsTable)
        .where(eq(riskLabelsTable.riskEventId, 12));
      expect(labels).toHaveLength(1);
      expect(labels[0]).toMatchObject({ label: "escalated" });
    } finally {
      close();
    }
  });

  it("GET /risk/events/12 (control) — the detail view still answers 200", async () => {
    const token = await seedAdmin();
    await seedEventWithId(12);
    const { url, close } = await listen(buildApp());
    try {
      const res = await call(url, "/api/admin/risk/events/12", "GET", token);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ event: { id: 12, score: 80 } });
    } finally {
      close();
    }
  });

  it("PUT /risk/rules/12abc → 400 and rule 12 stays untouched (pre-fix: enabled flipped on 12)", async () => {
    const token = await seedAdmin();
    await seedRuleWithId(12);
    const { url, close } = await listen(buildApp());
    try {
      const res = await call(url, "/api/admin/risk/rules/12abc", "PUT", token, {
        enabled: false,
      });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: "INVALID_DATA" });

      const [rule] = await db.select().from(riskRulesTable).where(eq(riskRulesTable.id, 12));
      expect(rule.enabled).toBe(true);
      expect(rule.version).toBe(1);
    } finally {
      close();
    }
  });

  it("control — PUT /risk/rules/12 still toggles the well-formed id", async () => {
    const token = await seedAdmin();
    await seedRuleWithId(12);
    const { url, close } = await listen(buildApp());
    try {
      const res = await call(url, "/api/admin/risk/rules/12", "PUT", token, { enabled: false });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: 12, success: true });

      const [rule] = await db.select().from(riskRulesTable).where(eq(riskRulesTable.id, 12));
      expect(rule.enabled).toBe(false);
    } finally {
      close();
    }
  });

  it("GET /forecast/products/12abc → 400 INVALID_DATA (never a silent lookup of product 12)", async () => {
    const token = await seedAdmin();
    const { url, close } = await listen(buildApp());
    try {
      const res = await call(url, "/api/admin/forecast/products/12abc", "GET", token);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: "INVALID_DATA" });
    } finally {
      close();
    }
  });
});
