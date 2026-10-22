import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { db, execTestSql, initTestDb, resetTestDb } from "../../test/db";
import { applyCopilotRemovalStage } from "../../migrate";

/**
 * V1-M36 (R181) — the AI Admin Copilot permanent removal, upgrade path.
 *
 * The fresh-install path is pinned by the chain-apply suite (chain 0027
 * drops the three tables on a chain-built database; the harness DDL no
 * longer carries them). THIS suite pins the boot stage's convergence of
 * a PRE-R181 database — the production upgrade case:
 *
 *   1. the three copilot tables (dependency order, no CASCADE) drop;
 *   2. the copilot.phases system_settings row drops — and ONLY that row;
 *   3. audit_logs rows the copilot's dual-writer stamped
 *      (action LIKE 'copilot.%' / target_type = 'copilot_action')
 *      drop — and ONLY those rows (money/admin/security audit history
 *      is untouched);
 *   4. a converged database re-runs the stage with ZERO DDL (the
 *      probe-gated steady-state contract);
 *   5. a fresh install (never saw the tables) is a no-op.
 */

// The pre-R181 shape of the copilot tables (migrate.ts's retired create
// block, verbatim column surface — the stage only needs existence, but
// the real shape keeps the probe honest against schema drift).
const PRE_R181_COPILOT_DDL = [
  `
CREATE TABLE copilot_previews (
  id                    VARCHAR(32)  PRIMARY KEY,
  admin_id              INTEGER      NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  intent_text           TEXT         NOT NULL,
  tool_name             VARCHAR(100) NOT NULL,
  action_class          VARCHAR(50)  NOT NULL,
  risk_tier             VARCHAR(20)  NOT NULL,
  affected_ids          JSONB        NOT NULL,
  affected_entity_type  VARCHAR(50)  NOT NULL,
  record_versions       JSONB        NOT NULL,
  preview_payload       JSONB        NOT NULL,
  model_id              VARCHAR(64)  NOT NULL,
  correlation_id        VARCHAR(64)  NOT NULL,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at            TIMESTAMPTZ  NOT NULL,
  consumed_at           TIMESTAMPTZ,
  confirmed_once_at     TIMESTAMPTZ,
  cooldown_starts_at    TIMESTAMPTZ,
  confirmed_twice_at    TIMESTAMPTZ
);
CREATE TABLE copilot_actions (
  id                  SERIAL       PRIMARY KEY,
  preview_id          VARCHAR(32)  REFERENCES copilot_previews(id) ON DELETE SET NULL,
  admin_id            INTEGER      NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  intent_text         TEXT         NOT NULL,
  tool_name           VARCHAR(100),
  action_class        VARCHAR(50)  NOT NULL,
  risk_tier           VARCHAR(20)  NOT NULL,
  outcome             VARCHAR(20)  NOT NULL,
  failure_reason      TEXT,
  before_state        JSONB,
  after_state         JSONB,
  confirmed_once_at   TIMESTAMPTZ,
  confirmed_twice_at  TIMESTAMPTZ,
  executed_at         TIMESTAMPTZ,
  model_id            VARCHAR(64),
  model_input_tokens  INTEGER,
  model_output_tokens INTEGER,
  correlation_id      VARCHAR(64)  NOT NULL,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE TABLE copilot_action_items (
  id              SERIAL       PRIMARY KEY,
  action_id       INTEGER      NOT NULL REFERENCES copilot_actions(id) ON DELETE CASCADE,
  entity_type     VARCHAR(50)  NOT NULL,
  entity_id       INTEGER      NOT NULL,
  outcome         VARCHAR(20)  NOT NULL,
  failure_reason  TEXT,
  before_value    JSONB,
  after_value     JSONB
);
`,
];

async function tableExists(table: string): Promise<boolean> {
  const result = await db.execute(
    sql`SELECT 1 AS one FROM information_schema.tables WHERE table_name = ${table}`,
  );
  const rows = (result as unknown as { rows?: unknown[] }).rows ?? [];
  return rows.length > 0;
}

async function scalar(query: ReturnType<typeof sql>): Promise<number> {
  const result = await db.execute(query);
  const rows = (result as unknown as { rows?: Array<{ c?: number }> }).rows ?? [];
  return Number(rows[0]?.c ?? 0);
}

async function seedAdmin(): Promise<number> {
  const result = await db.execute(sql`
    INSERT INTO admin_users (username, password_hash, is_active, permissions)
    VALUES ('v1m36_admin', 'x', true, '["all"]'::jsonb)
    RETURNING id
  `);
  const rows = (result as unknown as { rows?: Array<{ id: number }> }).rows ?? [];
  return rows[0]!.id;
}

async function seedCopilotState(adminId: number): Promise<void> {
  await db.execute(sql`
    INSERT INTO copilot_previews (id, admin_id, intent_text, tool_name, action_class,
      risk_tier, affected_ids, affected_entity_type, record_versions, preview_payload,
      model_id, correlation_id, expires_at)
    VALUES ('01V1M36PREVIEW0000000000001', ${adminId}, 'intent', 'update_product',
      'catalog_write', 'low', '[]'::jsonb, 'product', '{}'::jsonb, '{}'::jsonb,
      'test-model', 'corr-1', NOW() + INTERVAL '1 hour')
  `);
  await db.execute(sql`
    INSERT INTO copilot_actions (preview_id, admin_id, intent_text, tool_name, action_class,
      risk_tier, outcome, correlation_id)
    VALUES ('01V1M36PREVIEW0000000000001', ${adminId}, 'intent', 'update_product',
      'catalog_write', 'low', 'success', 'corr-1')
  `);
  await db.execute(sql`
    INSERT INTO copilot_action_items (action_id, entity_type, entity_id, outcome)
    SELECT id, 'product', 1, 'success' FROM copilot_actions LIMIT 1
  `);
  // system_settings is NOT in resetTestDb's truncate list (rows persist
  // across a file's tests) — clear this test's keys first so re-seeding
  // is exact.
  await db.execute(sql`
    DELETE FROM system_settings WHERE key IN ('copilot.phases', 'v1m36.sibling')
  `);
  await db.execute(sql`
    INSERT INTO system_settings (key, value) VALUES ('copilot.phases', '{"phase1_enabled":true}')
  `);
  // The audit rows the copilot's dual-writer stamped…
  await db.execute(sql`
    INSERT INTO audit_logs (actor_type, actor_id, action, target_type, target_id, metadata)
    VALUES ('admin', ${adminId}, 'copilot.catalog_write', 'copilot_action', 1, '{}')
  `);
  // …and the audit rows from OTHER writers that MUST survive.
  await db.execute(sql`
    INSERT INTO audit_logs (actor_type, actor_id, action, target_type, target_id, metadata)
    VALUES
      ('admin', ${adminId}, 'topup.approve', 'wallet_topup', 42, '{}'),
      ('admin', ${adminId}, 'order.refund', 'order', 7, '{}'),
      ('admin', ${adminId}, 'risk.label', 'risk_event', 9, '{}')
  `);
  await db.execute(sql`
    INSERT INTO system_settings (key, value) VALUES ('v1m36.sibling', '{}')
  `);
}

beforeAll(initTestDb, 60_000);

beforeEach(async () => {
  await resetTestDb();
  // Start from the PRE-R181 shape: the copilot tables exist with data
  // (execTestSql — the harness's multi-statement exec path; drizzle's
  // db.execute takes single prepared statements only).
  await execTestSql(PRE_R181_COPILOT_DDL.join("\n"));
});

describe("V1-M36 (R181) — copilot removal: the upgrade convergence", () => {
  it("drops the three copilot tables with their data + the phase setting + the copilot audit rows", async () => {
    const adminId = await seedAdmin();
    await seedCopilotState(adminId);
    // The PRE-R181 state genuinely carries the feature's data — the
    // drops below must destroy real rows, not just empty tables.
    expect(await tableExists("copilot_previews")).toBe(true);
    expect(await tableExists("copilot_actions")).toBe(true);
    expect(await tableExists("copilot_action_items")).toBe(true);
    expect(
      await scalar(sql`SELECT count(*) AS c FROM system_settings WHERE key = 'copilot.phases'`),
    ).toBe(1);
    expect(await scalar(sql`SELECT count(*) AS c FROM audit_logs`)).toBe(4);

    await applyCopilotRemovalStage();

    expect(await tableExists("copilot_previews")).toBe(false);
    expect(await tableExists("copilot_actions")).toBe(false);
    expect(await tableExists("copilot_action_items")).toBe(false);
    expect(
      await scalar(sql`SELECT count(*) AS c FROM system_settings WHERE key = 'copilot.phases'`),
    ).toBe(0);
    expect(
      await scalar(
        sql`SELECT count(*) AS c FROM audit_logs WHERE action LIKE 'copilot.%' OR target_type = 'copilot_action'`,
      ),
    ).toBe(0);
  });

  it("ONLY the copilot audit rows drop — money/admin/security audit history survives", async () => {
    const adminId = await seedAdmin();
    await seedCopilotState(adminId);
    await applyCopilotRemovalStage();
    expect(await scalar(sql`SELECT count(*) AS c FROM audit_logs`)).toBe(3);
    const result = await db.execute(sql`SELECT action FROM audit_logs ORDER BY action`);
    const rows = (result as unknown as { rows?: Array<{ action: string }> }).rows ?? [];
    expect(rows.map((r) => r.action).sort()).toEqual([
      "order.refund",
      "risk.label",
      "topup.approve",
    ]);
  });

  it("ONLY the copilot.phases setting drops — sibling settings survive", async () => {
    const adminId = await seedAdmin();
    await seedCopilotState(adminId);
    await applyCopilotRemovalStage();
    expect(
      await scalar(sql`SELECT count(*) AS c FROM system_settings WHERE key = 'v1m36.sibling'`),
    ).toBe(1);
  });

  it("a converged database re-runs the stage as a no-op (idempotent, zero-DDL steady state)", async () => {
    const adminId = await seedAdmin();
    await seedCopilotState(adminId);
    await applyCopilotRemovalStage();
    // Second run must not throw and must leave the world unchanged.
    await applyCopilotRemovalStage();
    expect(await tableExists("copilot_previews")).toBe(false);
    expect(await scalar(sql`SELECT count(*) AS c FROM audit_logs`)).toBe(3);
  });

  it("a fresh install (never saw the tables) is a clean no-op", async () => {
    // Drop the pre-R181 DDL the beforeEach created — fresh-install shape.
    await db.execute(sql.raw("DROP TABLE IF EXISTS copilot_action_items"));
    await db.execute(sql.raw("DROP TABLE IF EXISTS copilot_actions"));
    await db.execute(sql.raw("DROP TABLE IF EXISTS copilot_previews"));
    await applyCopilotRemovalStage();
    expect(await tableExists("copilot_previews")).toBe(false);
    // No copilot.phases row was ever created and none appears.
    expect(
      await scalar(sql`SELECT count(*) AS c FROM system_settings WHERE key = 'copilot.phases'`),
    ).toBe(0);
  });
});
