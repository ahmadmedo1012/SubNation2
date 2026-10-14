import { describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import type { SQL } from "drizzle-orm";

/**
 * R143 (L9-2 / F-1 proper) — the full `runMigrations()` body boot test.
 *
 * Every other migrate suite pins individual STAGES against the shared
 * pglite harness (whose DDL pre-carries the live shape), because the
 * body's raw `db.execute` calls hit drizzle's prepared-query path, which
 * 42601's on multi-statement batches. The lane-L9 feasibility probe
 * proved the whole body runs on a fresh PGlite when `db` is bound to
 * that engine with execute routed through the simple-query protocol
 * (`client.exec`) — the same path `execTestSql` already proves works.
 *
 * This file lands that probe in-tree: the `@workspace/db` alias target
 * (src/test/db.ts) is mocked so `db` is a drizzle instance over a FRESH
 * PGlite — migrate.ts resolves `db` through the alias, and alertLogger's
 * query-builder calls ride the same instance — and the FULL boot
 * reconcile runs twice against it.
 *
 * Pins:
 *   1. the body COMPLETES on a fresh database (339-statement class —
 *      any stage regression, batch-parse failure, or ordering bug throws
 *      here);
 *   2. the second run is a clean idempotent no-op (boot-resilience's
 *      transient retry re-runs from the top — that path must converge);
 *   3. the end shape matches the lane-L9 boot dry-run: 41 tables /
 *      29 CHECKs / 39 FKs / 139 indexes (pg_trgm degrades exactly like
 *      ensurePgTrgmExtension does on this engine);
 *   4. Stage C applied (users.password_hash gone) and the money guards
 *      the M1–M15 invariants depend on exist.
 */

vi.mock("../../test/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../test/db")>();
  const { drizzle } = await import("drizzle-orm/pglite");
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const schema = await import("@workspace/db/schema");

  const mockClient = new PGlite();
  const mockDb = drizzle(mockClient, { schema }) as unknown as typeof actual.db;

  const dialect = new PgDialect();
  let mockExecuteCalls = 0;

  /**
   * Route a drizzle SQL template through PGlite's simple-query protocol.
   * Parameterized statements ride `client.query` (prepared path, single
   * statement); parameter-free SQL rides `client.exec` (multi-statement
   * safe — the exact 42601 bypass the shared harness documents on
   * execTestSql). migrate.ts's extractRows accepts both `.rows` objects
   * and bare arrays, so the single-statement exec result is unwrapped to
   * its QueryResult shape.
   */
  const executeViaPglite = async (query: SQL): Promise<unknown> => {
    const rendered = dialect.sqlToQuery(query);
    mockExecuteCalls += 1;
    if (rendered.params.length > 0) {
      return await mockClient.query(rendered.sql, rendered.params as unknown[]);
    }
    const results = await mockClient.exec(rendered.sql);
    if (Array.isArray(results) && results.length === 1) return results[0];
    return results;
  };

  // Shadow the prototype method: migrate.ts calls `db.execute(...)` at
  // call time (defaultExecutor + the body's direct calls), so the own
  // property covers every path.
  Object.assign(mockDb, { execute: executeViaPglite });

  return {
    ...actual,
    db: mockDb,
    __mockClient: mockClient,
    __mockExecuteCalls: (): number => mockExecuteCalls,
  };
});

// The mocked module carries two test-only handles the real harness does
// not export — reach them through a cast so tsc stays honest about the
// underlying module's public surface.
import * as testDb from "../../test/db";
import { runMigrations } from "../../migrate";

const bootDb = (testDb as unknown as { __mockClient: PGlite }).__mockClient;
const executeCalls = (testDb as unknown as { __mockExecuteCalls: () => number }).__mockExecuteCalls;

async function scalar(query: string): Promise<number> {
  const res = await bootDb.query<{ c: string | number }>(query);
  return Number(res.rows[0]?.c ?? 0);
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const res = await bootDb.query<{ present: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
     ) AS present`,
    [table, column],
  );
  return res.rows[0]!.present;
}

async function indexDef(name: string): Promise<string | undefined> {
  const res = await bootDb.query<{ def: string }>(
    `SELECT indexdef AS def FROM pg_indexes WHERE indexname = $1`,
    [name],
  );
  return res.rows[0]?.def;
}

async function constraintByName(name: string): Promise<string | undefined> {
  const res = await bootDb.query<{ contype: string; confdeltype: string | null }>(
    `SELECT contype, confdeltype FROM pg_constraint WHERE conname = $1 LIMIT 1`,
    [name],
  );
  const row = res.rows[0];
  return row ? `${row.contype}:${row.confdeltype ?? ""}` : undefined;
}

describe("R143 (L9-2): the full runMigrations() body boots a fresh database", () => {
  it("the first full reconcile completes without error", { timeout: 120_000 }, async () => {
    delete process.env.MIGRATIONS_FORCE_RECONCILE;
    await expect(runMigrations()).resolves.toBeUndefined();
    // The L9 dry-run executed 339 statements; a number far below that
    // means the body silently short-circuited (the fast-path must be
    // inert in tests — no build-time define).
    expect(executeCalls()).toBeGreaterThan(300);
  });

  it(
    "the second run is an idempotent no-op (transient-retry convergence)",
    { timeout: 120_000 },
    async () => {
      const before = executeCalls();
      await expect(runMigrations()).resolves.toBeUndefined();
      expect(executeCalls()).toBeGreaterThan(before);
    },
  );

  it("the documented end shape holds (41 tables / 29 CHECKs / 39 FKs / 139 indexes)", async () => {
    const tables = await scalar("SELECT count(*) AS c FROM pg_tables WHERE schemaname = 'public'");
    expect(tables).toBe(41);
    expect(await scalar("SELECT count(*) AS c FROM pg_constraint WHERE contype = 'c'")).toBe(29);
    expect(await scalar("SELECT count(*) AS c FROM pg_constraint WHERE contype = 'f'")).toBe(39);
    expect(await scalar("SELECT count(*) AS c FROM pg_indexes WHERE schemaname = 'public'")).toBe(
      139,
    );
  });

  it("Stage C applied — the legacy password infrastructure is gone", async () => {
    expect(await columnExists("users", "password_hash")).toBe(false);
    expect(await columnExists("users", "github_id")).toBe(false);
    expect(await columnExists("users", "facebook_id")).toBe(false);
  });

  it("the money guards exist with their authoritative definitions", async () => {
    // M9/M15: the CHECK battery.
    expect(await constraintByName("chk_users_wallet_balance_nonneg")).toMatch(/^c:/);
    expect(await constraintByName("chk_ledger_amount_nonzero")).toMatch(/^c:/);
    expect(await constraintByName("chk_points_ledger_arithmetic")).toMatch(/^c:/);
    // M1/M2: idempotent topup approval.
    const topupRefIdx = await indexDef("uniq_wallet_topups_payment_reference");
    expect(topupRefIdx).toContain("UNIQUE INDEX uniq_wallet_topups_payment_reference");
    expect(topupRefIdx).toContain("payment_reference IS NOT NULL");
    // M15: money-history FKs are RESTRICT (never cascade-delete a ledger row).
    expect(await constraintByName("fk_orders_user")).toMatch(/^f:r$/);
    expect(await constraintByName("fk_wallet_ledger_user")).toMatch(/^f:r$/);
    // Keyset pagination composite (R142-era money-read shape).
    expect(await indexDef("idx_orders_user_created")).toContain("ON public.orders");
  });
});
