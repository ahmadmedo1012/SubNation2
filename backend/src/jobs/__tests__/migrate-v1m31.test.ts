import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { db, initTestDb, resetTestDb } from "../../test/db";
import { applyRetentionPruneIndexesStage } from "../../migrate";

/**
 * R127-L3 (B7 P2-1 + B8 §2 G1–G7) — V1-M31: the retention/prune index
 * bundle.
 *
 * The pglite harness carries the PRE-V1-M31 shape: its DDL declares
 * every long-standing index but NONE of the eight new prune-predicate
 * indexes, so the default run is the legacy-shape convergence (all
 * eight created), and the re-run is the steady-state contract (zero
 * DDL that changes anything — every statement is CREATE INDEX IF NOT
 * EXISTS, the V1-M24 additive-twin form).
 *
 * Two of the eight targets (idempotency_keys / inventory_forecasts)
 * are not in the shared harness DDL — provisioned per-file, the
 * migrate-v1m27 convention. The drizzle 0020 mirror rides along like
 * 0019 did in migrate-v1m27.test.ts.
 */

/** Resolve a repo path relative to this test file (backend/src/jobs/__tests__). */
function repoPath(rel: string): string {
  return new URL(`../../../../${rel}`, import.meta.url).pathname;
}

/** The stage's own bundle — name + table + the pg_indexes indexdef fragment. */
const BUNDLE: Array<{ name: string; table: string; defFragment: string }> = [
  { name: "idx_sessions_expires_at", table: "sessions", defFragment: "(expires_at)" },
  { name: "idx_admin_sessions_expires_at", table: "admin_sessions", defFragment: "(expires_at)" },
  {
    name: "idx_admin_sessions_revoked_at",
    table: "admin_sessions",
    defFragment: "(revoked_at) WHERE (revoked_at IS NOT NULL)",
  },
  {
    name: "idx_admin_alerts_unread",
    table: "admin_alerts",
    defFragment: "(created_at DESC) WHERE (is_read = false)",
  },
  { name: "idx_idempotency_keys_created", table: "idempotency_keys", defFragment: "(created_at)" },
  {
    name: "idx_login_attempts_last_attempt",
    table: "login_attempts",
    defFragment: "(last_attempt)",
  },
  { name: "idx_notifications_created", table: "notifications", defFragment: "(created_at)" },
  {
    name: "idx_forecasts_forecast_date",
    table: "inventory_forecasts",
    defFragment: "(forecast_date)",
  },
];

const PER_FILE_DDL = [
  // Not in the shared harness DDL (the migrate-v1m27 convention).
  `CREATE TABLE IF NOT EXISTS idempotency_keys (
    key text PRIMARY KEY,
    order_id integer,
    reference_type varchar(32) NOT NULL DEFAULT 'order',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS inventory_forecasts (
    id serial PRIMARY KEY,
    product_id integer NOT NULL,
    forecast_date date NOT NULL
  )`,
];

const PER_FILE_TABLES = ["idempotency_keys", "inventory_forecasts"];

async function indexExists(name: string): Promise<boolean> {
  const result = await db.execute(sql`SELECT 1 AS one FROM pg_indexes WHERE indexname = ${name}`);
  const rows = (result as unknown as { rows?: unknown[] }).rows ?? [];
  return rows.length > 0;
}

async function indexDef(name: string): Promise<string | undefined> {
  const result = await db.execute(
    sql`SELECT indexdef AS def FROM pg_indexes WHERE indexname = ${name}`,
  );
  const rows = (result as unknown as { rows?: Array<{ def: string }> }).rows ?? [];
  return rows[0]?.def;
}

beforeAll(async () => {
  await initTestDb();
  // Explicit hook timeout — the 2-CPU full-suite contention rationale
  // (migrate-v1m9.test.ts).
}, 60_000);

beforeEach(async () => {
  await resetTestDb();
  // (Re-)provision the per-file tables (drop first so a previous case's
  // indexes never leak forward; one statement per execute — pglite
  // rejects multi-command prepared statements).
  for (const table of PER_FILE_TABLES) {
    await db.execute(sql.raw(`DROP TABLE IF EXISTS ${table} CASCADE`));
  }
  for (const stmt of PER_FILE_DDL) {
    await db.execute(sql.raw(stmt));
  }
});

describe("V1-M31 — applyRetentionPruneIndexesStage (R127-L3, B7 P2-1 + B8 G1–G7)", () => {
  it("legacy shape (pre-V1-M31): all eight indexes created", async () => {
    // The harness carries none of the bundle yet.
    for (const { name } of BUNDLE) {
      expect(await indexExists(name)).toBe(false);
    }

    await applyRetentionPruneIndexesStage();

    for (const { name } of BUNDLE) {
      expect(await indexExists(name)).toBe(true);
    }
  });

  it("steady state: re-running the stage is a pure no-op (IF NOT EXISTS only)", async () => {
    await applyRetentionPruneIndexesStage();
    const defsBefore = [];
    for (const { name } of BUNDLE) {
      defsBefore.push(await indexDef(name));
    }

    await applyRetentionPruneIndexesStage();

    const defsAfter = [];
    for (const { name } of BUNDLE) {
      defsAfter.push(await indexDef(name));
    }
    // Identity — no drop/recreate churn, no shape drift.
    expect(defsAfter).toEqual(defsBefore);
  });

  it("the partial + DESC serving shapes are pinned (B7 directive 2 / B8 G2)", async () => {
    await applyRetentionPruneIndexesStage();
    // pg renders column order, DESC and partial predicates explicitly
    // in indexdef — pin the shapes the prune predicates and the
    // unread-badge rely on, on the right table.
    for (const { name, table, defFragment } of BUNDLE) {
      const def = await indexDef(name);
      expect(def, `indexdef of ${name}`).toContain(`USING btree ${defFragment}`);
      const result = await db.execute(
        sql`SELECT tablename AS t FROM pg_indexes WHERE indexname = ${name}`,
      );
      const rows = (result as unknown as { rows?: Array<{ t: string }> }).rows ?? [];
      expect(rows[0]?.t).toBe(table);
    }
    // Belt: the two partial predicates verbatim (pg wraps them in parens).
    expect(await indexDef("idx_admin_alerts_unread")).toContain("WHERE (is_read = false)");
    expect(await indexDef("idx_admin_sessions_revoked_at")).toContain(
      "WHERE (revoked_at IS NOT NULL)",
    );
    // And the unread badge twin is DESC, mirroring the drawer's ORDER BY.
    expect(await indexDef("idx_admin_alerts_unread")).toContain("created_at DESC");
  });
});

describe("R127 — the drizzle 0020 mirror (chain follows the schema)", () => {
  interface JournalEntry {
    idx: number;
    tag: string;
  }

  /** Strip `--` comment lines, split on drizzle's breakpoint marker, drop blanks. */
  function parseStatements(fileSql: string): string[] {
    return fileSql
      .replace(/^\s*--.*$/gm, "")
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  async function statements(): Promise<string[]> {
    return parseStatements(await readFile(repoPath("shared/db/drizzle/0020_hot_mojo.sql"), "utf8"));
  }

  it("the journal carries 0019 → 0020 in order", async () => {
    const raw = JSON.parse(
      await readFile(repoPath("shared/db/drizzle/meta/_journal.json"), "utf8"),
    );
    const entries = raw.entries as JournalEntry[];
    const idx19 = entries.findIndex((e) => e.idx === 19);
    const idx20 = entries.findIndex((e) => e.idx === 20);
    expect(idx19).toBeGreaterThanOrEqual(0);
    expect(idx20).toBe(idx19 + 1);
    expect(entries[idx20].tag).toMatch(/^0020_/);
  });

  it("0020 declares the eight V1-M31 objects, hardened (r110 idiom — IF NOT EXISTS)", async () => {
    const all = (await statements()).join("\n");
    for (const { name } of BUNDLE) {
      expect(all).toContain(`CREATE INDEX IF NOT EXISTS "${name}"`);
    }
    // Nothing else smuggled in: exactly eight statements, all creates.
    const stmts = await statements();
    expect(stmts).toHaveLength(8);
    for (const stmt of stmts) {
      expect(stmt).toMatch(/^CREATE INDEX IF NOT EXISTS/);
    }
    // Deliberately NOT CONCURRENTLY — drizzle's migrator wraps all
    // pending statements in one transaction, where CONCURRENTLY is
    // invalid (PG 25001); see the 0020 header for the full decision.
    expect(all).not.toContain("CONCURRENTLY");
  });

  it("0020 executes cleanly + idempotently on the runtime shape (live-boot dry-run)", async () => {
    const stmts = await statements();
    const applyChain = async () => {
      for (const stmt of stmts) {
        await db.execute(sql.raw(stmt));
      }
    };
    // Fresh shape: the chain alone converges to the full bundle…
    await applyChain();
    for (const { name } of BUNDLE) {
      expect(await indexExists(name)).toBe(true);
    }
    // …and the runtime stage on top of it is a no-op (same objects).
    await applyRetentionPruneIndexesStage();
    // Second application: clean no-op.
    await applyChain();
    for (const { name } of BUNDLE) {
      expect(await indexExists(name)).toBe(true);
    }
  });
});
