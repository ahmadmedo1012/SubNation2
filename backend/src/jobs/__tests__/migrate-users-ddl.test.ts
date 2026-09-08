import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { db, initTestDb, resetTestDb } from "../../test/db";
import {
  applyUsersColumnReconcileStage,
  applyUsersPasswordlessCleanupStage,
} from "../../migrate";

/**
 * F1 (round-94 A6) — steady-state boots execute ZERO DDL on `users`.
 *
 * The old migration issued an unconditional
 * `ALTER TABLE users ADD COLUMN IF NOT EXISTS github_id, …, last_auth_at`
 * every boot and Stage C then dropped the legacy subset again — 8 ALTER
 * TABLE statements (each a momentary AccessExclusiveLock on the table
 * behind every login) per cold start forever, plus DDL-class commands
 * that widen the read-only-window (25006) retry surface for zero schema
 * change. The fix mirrors ensurePgTrgmExtension: catalog probe first,
 * ALTER only when a column is genuinely missing; transient (pre-Stage-C)
 * columns are only ever re-created while `password_hash` still exists.
 *
 * The pglite harness `users` table is a POST-Stage-C (steady-state) shape
 * — exactly the production state the zero-DDL pin must certify.
 */

beforeAll(initTestDb, 60_000);
beforeEach(resetTestDb);

// ── recording executor (same chunk-walking as migrate-v1m9's recorder) ──
interface Recorded {
  statements: string[];
  execute: (query: SQL) => Promise<unknown>;
}

function recorder(): Recorded {
  const statements: string[] = [];
  return {
    statements,
    execute: async (query) => {
      const text = String(
        (query as unknown as { queryChunks?: Array<{ value: unknown }> }).queryChunks
          ?.map((c) => c.value)
          .join(""),
      );
      statements.push(text);
      return db.execute(query);
    },
  };
}

/** Statement classes that take locks / are rejected in read-only windows. */
const DDL_ON_USERS = /ALTER\s+TABLE\s+users|DROP\s+TABLE\s+otps/i;

async function usersColumns(): Promise<Set<string>> {
  const result = await db.execute(sql`
    SELECT column_name FROM information_schema.columns WHERE table_name = 'users'
  `);
  const rows = (result as unknown as { rows?: Array<{ column_name: string }> }).rows ?? [];
  return new Set(rows.map((r) => r.column_name));
}

// Pristine-state restoration: the tests mutate `users` columns, and
// resetTestDb truncates ROWS only. Raw SQL (NOT the stage under test) so
// a broken stage cannot silently bootstrap itself a green state.
const LEGACY_COLUMNS = [
  "password_hash",
  "github_id",
  "facebook_id",
  "password_login_enabled",
  "legacy_password_disabled_at",
];
const FINAL_COLUMNS: Array<[string, string]> = [
  ["telegram_id", "VARCHAR(255)"],
  ["firebase_uid", "VARCHAR(255)"],
  ["email", "VARCHAR(255)"],
  ["email_verified", "BOOLEAN"],
  ["phone_verified", "BOOLEAN"],
  ["display_name", "VARCHAR(255)"],
  ["photo_url", "TEXT"],
  ["auth_provider", "VARCHAR(50)"],
  ["last_auth_at", "TIMESTAMPTZ"],
];

beforeEach(async () => {
  for (const col of LEGACY_COLUMNS) {
    await db.execute(sql.raw(`ALTER TABLE users DROP COLUMN IF EXISTS ${col}`));
  }
  for (const [name, definition] of FINAL_COLUMNS) {
    await db.execute(sql.raw(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${name} ${definition}`));
  }
  await db.execute(sql.raw(`DROP TABLE IF EXISTS otps`));
});

describe("F1 — steady-state boot (post-Stage-C, the production shape)", () => {
  it("applyUsersColumnReconcileStage issues ZERO DDL on users", async () => {
    const rec = recorder();
    await applyUsersColumnReconcileStage(rec.execute);

    // THE regression pin: catalog probe only — no ALTER TABLE users at all.
    expect(rec.statements.filter((s) => DDL_ON_USERS.test(s))).toHaveLength(0);
    expect(rec.statements.length).toBeGreaterThanOrEqual(1); // the probe itself
  });

  it("applyUsersPasswordlessCleanupStage issues ZERO DDL on users", async () => {
    const rec = recorder();
    await applyUsersPasswordlessCleanupStage(rec.execute);

    expect(rec.statements.filter((s) => DDL_ON_USERS.test(s))).toHaveLength(0);
  });

  it("repeated full-stage cycles stay at zero DDL (the forever-boot contract)", async () => {
    for (let i = 0; i < 3; i++) {
      const rec = recorder();
      await applyUsersColumnReconcileStage(rec.execute);
      await applyUsersPasswordlessCleanupStage(rec.execute);
      expect(rec.statements.filter((s) => DDL_ON_USERS.test(s))).toHaveLength(0);
    }
    // State intact: final columns present, legacy columns gone.
    const cols = await usersColumns();
    for (const [name] of FINAL_COLUMNS) expect(cols.has(name)).toBe(true);
    for (const name of LEGACY_COLUMNS) expect(cols.has(name)).toBe(false);
  });
});

describe("F1 — legacy / mid-migration database (Stage C pending)", () => {
  it("reconcile ADDs missing transient columns ONLY while password_hash exists", async () => {
    // Simulate a very old DB: password_hash present, the other legacy
    // provider columns never created. Stage B (legacy provider data
    // migration) reads github_id/facebook_id, so they must appear here.
    await db.execute(
      sql.raw(`ALTER TABLE users ADD COLUMN password_hash VARCHAR(255) NOT NULL DEFAULT ''`),
    );

    const rec = recorder();
    await applyUsersColumnReconcileStage(rec.execute);

    const alters = rec.statements.filter((s) => /ALTER\s+TABLE\s+users/i.test(s));
    expect(alters).toHaveLength(1);
    expect(alters[0]).toContain("github_id");
    expect(alters[0]).toContain("facebook_id");
    expect(alters[0]).toContain("password_login_enabled");
    expect(alters[0]).toContain("legacy_password_disabled_at");

    const cols = await usersColumns();
    for (const name of LEGACY_COLUMNS) expect(cols.has(name)).toBe(true);
  });

  it("cleanup drops ALL legacy columns + the otps table, in one guarded statement", async () => {
    // Fresh-install shape: CREATE TABLE users carried the legacy columns.
    for (const [name, definition] of [
      ["password_hash", "VARCHAR(255) NOT NULL DEFAULT ''"],
      ["github_id", "VARCHAR(255)"],
      ["facebook_id", "VARCHAR(255)"],
      ["password_login_enabled", "BOOLEAN NOT NULL DEFAULT TRUE"],
      ["legacy_password_disabled_at", "TIMESTAMPTZ"],
    ] as const) {
      await db.execute(sql.raw(`ALTER TABLE users ADD COLUMN ${name} ${definition}`));
    }
    await db.execute(sql.raw(`CREATE TABLE otps (id SERIAL PRIMARY KEY)`));

    await applyUsersPasswordlessCleanupStage();

    const cols = await usersColumns();
    for (const name of LEGACY_COLUMNS) expect(cols.has(name)).toBe(false);
    const otps = await db.execute(
      sql`SELECT 1 AS one FROM information_schema.tables WHERE table_name = 'otps'`,
    );
    expect(((otps as unknown as { rows?: unknown[] }).rows ?? []).length).toBe(0);
  });

  it("after Stage C runs once, later boots NEVER resurrect the legacy columns", async () => {
    await db.execute(
      sql.raw(`ALTER TABLE users ADD COLUMN password_hash VARCHAR(255) NOT NULL DEFAULT ''`),
    );

    // Boot 1: reconcile (adds transient), then Stage C (drops everything).
    await applyUsersColumnReconcileStage();
    await applyUsersPasswordlessCleanupStage();

    // Boot 2..N: steady state — this is the exact ADD→DROP→ADD→DROP churn
    // the old code performed on every boot; it must be gone.
    for (let i = 0; i < 2; i++) {
      const rec = recorder();
      await applyUsersColumnReconcileStage(rec.execute);
      expect(rec.statements.filter((s) => DDL_ON_USERS.test(s))).toHaveLength(0);
      const cols = await usersColumns();
      for (const name of LEGACY_COLUMNS) expect(cols.has(name)).toBe(false);
    }
  });
});

describe("F1 — final-schema drift recovery (post-Stage-C databases)", () => {
  it("a genuinely missing FINAL column is re-added even in steady state", async () => {
    await db.execute(sql.raw(`ALTER TABLE users DROP COLUMN telegram_id`));

    const rec = recorder();
    await applyUsersColumnReconcileStage(rec.execute);

    const alters = rec.statements.filter((s) => /ALTER\s+TABLE\s+users/i.test(s));
    expect(alters).toHaveLength(1);
    expect(alters[0]).toContain("ADD COLUMN IF NOT EXISTS telegram_id");
    // The transient set must NOT come back with it.
    expect(alters[0]).not.toContain("github_id");
    const cols = await usersColumns();
    expect(cols.has("telegram_id")).toBe(true);
  });

  it("password_login_enabled never resurrects once Stage C dropped it (the churn pin)", async () => {
    // Post-Stage-C database where the column is absent — the old code
    // re-created it here on EVERY boot only for Stage C to drop it again.
    const rec = recorder();
    await applyUsersColumnReconcileStage(rec.execute);

    expect(rec.statements.some((s) => /password_login_enabled/i.test(s))).toBe(false);
    expect((await usersColumns()).has("password_login_enabled")).toBe(false);
  });
});
