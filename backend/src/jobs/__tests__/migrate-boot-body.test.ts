import { describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { getTableColumns, is, type SQL } from "drizzle-orm";
import { getTableConfig, PgDialect, PgTable } from "drizzle-orm/pg-core";
import * as schema from "@workspace/db/schema";
import { decrypt, isEncrypted } from "../../lib/encryption";

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
 *   3. the end shape (re-measured after R181's V1-M36 copilot retirement
 *      AND R191's V1-M37 push_tokens): 39 tables / 30 CHECKs / 36 FKs /
 *      131 indexes (pg_trgm degrades exactly like ensurePgTrgmExtension
 *      does on this engine; R191/V1-M37: 38/29/35/128 → +1 table, +1
 *      CHECK (chk_push_tokens_platform), +1 FK (push_tokens_user_id_
 *      users_id_fk), +3 indexes (idx_push_tokens_user_id + the
 *      expo_push_token UNIQUE + the table PK));
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

  it("the documented end shape holds (39 tables / 30 CHECKs / 36 FKs / 131 indexes)", async () => {
    const tables = await scalar("SELECT count(*) AS c FROM pg_tables WHERE schemaname = 'public'");
    // R191 (V1-M37): 38 → 39 — push_tokens (the Expo push-token
    // registrations) joins the boot end shape; boot and chain converge
    // on the identical count (probe-verified: the table sets are equal).
    expect(tables).toBe(39);
    // R191 (V1-M37): 29 → 30 — chk_push_tokens_platform (android|ios).
    expect(await scalar("SELECT count(*) AS c FROM pg_constraint WHERE contype = 'c'")).toBe(30);
    // R191 (V1-M37): 35 → 36 — push_tokens_user_id_users_id_fk (the
    // sessions-style CASCADE family, NOT the money RESTRICT family).
    expect(await scalar("SELECT count(*) AS c FROM pg_constraint WHERE contype = 'f'")).toBe(36);
    // R165 (V1-M35): 139 → 140 — idx_orders_user_group (the order-group
    // partial lookup, applyOrdersGroupColumnStage).
    // R181 (V1-M36): 140 → 128 — the three copilot tables leave the boot
    // end shape (12 indexes: 9 explicit + the 3 table PKs).
    // R191 (V1-M37): 128 → 131 — push_tokens' three: idx_push_tokens_
    // user_id + the expo_push_token UNIQUE + the table PK.
    expect(await scalar("SELECT count(*) AS c FROM pg_indexes WHERE schemaname = 'public'")).toBe(
      131,
    );
    // R181 (V1-M36): the copilot-exclusive tables are provably absent
    // from a FRESH boot (the retired create block is gone from
    // migrate.ts; nothing recreates them).
    const retired = await scalar(
      `SELECT count(*) AS c FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('copilot_previews','copilot_actions','copilot_action_items')`,
    );
    expect(retired).toBe(0);
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

describe("R146 (audit-shared-migrate): parity + encryption-at-rest gates on the same boot", () => {
  it("F2: every schema-TS column exists in the boot-built database, and vice versa (column census)", async () => {
    const tables = Object.entries(schema).filter(([, value]) => is(value, PgTable));
    // Guards the census against a silent is() regression making the loop
    // vacuous — the schema exports exactly the 39 boot tables, 1:1
    // (R181: the three copilot tables left both sides together; R191:
    // push_tokens joined both sides together — the four-mirror law).
    expect(tables.length).toBe(39);
    for (const [exportName, value] of tables) {
      const table = value as PgTable;
      const tableName = getTableConfig(table).name;
      // getTableColumns is keyed by TS property name — map to SQL names.
      const schemaColumns = Object.values(getTableColumns(table))
        .map((column) => column.name)
        .sort();
      const res = await bootDb.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1`,
        [tableName],
      );
      // Either direction is drift: a schema-only column 42703s in
      // production (migrate.ts never creates it); a boot-only column is
      // invisible to the schema/chain and every drizzle query.
      expect(
        res.rows.map((r) => r.column_name).sort(),
        `${exportName} (${tableName}) column census mismatch`,
      ).toEqual(schemaColumns);
    }
  });

  it(
    "F1: a plaintext credential containing two colons is encrypted on boot",
    { timeout: 120_000 },
    async () => {
      // The exact legacy shape the old `NOT LIKE '%:%:%'` pre-filter
      // silently skipped: operator-pasted `user:pass:2fa` plaintext never
      // reached the authoritative isEncrypted() gate.
      await bootDb.query(`INSERT INTO users (phone) VALUES ('09146000001')`);
      await bootDb.query(
        `INSERT INTO inventory (product_id, account_email, account_password)
         VALUES ((SELECT id FROM products ORDER BY id LIMIT 1), 'r146-f1@subnation.ly', $1)`,
        ["user:pass:2fa"],
      );
      await bootDb.query(
        `INSERT INTO orders (order_code, user_id, product_id, amount, status, delivered_password)
         VALUES ('R146-F1-ORD',
                 (SELECT id FROM users WHERE phone = '09146000001'),
                 (SELECT id FROM products ORDER BY id LIMIT 1),
                 10.00, 'completed', $1)`,
        ["mail:secret:otp"],
      );

      await expect(runMigrations()).resolves.toBeUndefined();

      const inv = await bootDb.query<{ account_password: string }>(
        `SELECT account_password FROM inventory WHERE account_email = 'r146-f1@subnation.ly'`,
      );
      expect(isEncrypted(inv.rows[0]!.account_password)).toBe(true);
      expect(decrypt(inv.rows[0]!.account_password)).toBe("user:pass:2fa");

      const ord = await bootDb.query<{ delivered_password: string }>(
        `SELECT delivered_password FROM orders WHERE order_code = 'R146-F1-ORD'`,
      );
      expect(isEncrypted(ord.rows[0]!.delivered_password)).toBe(true);
      expect(decrypt(ord.rows[0]!.delivered_password)).toBe("mail:secret:otp");
    },
  );

  it(
    "F3: the admin seed INSERT loses a concurrent cold-boot race without aborting",
    { timeout: 120_000 },
    async () => {
      // Fresh-database shape: the COUNT gate sees zero admins, then the
      // peer container's INSERT lands between our COUNT and ours (the PG
      // advisory lock fails OPEN after 90s) — simulated at the exact
      // statement boundary the race window really sits on.
      await bootDb.query(`DELETE FROM admin_users`);
      const racedUsername = process.env.ADMIN_USERNAME || "admin";

      const mockDbObject = testDb.db as unknown as {
        execute: (query: SQL) => Promise<unknown>;
      };
      const originalExecute = mockDbObject.execute.bind(mockDbObject);
      const dialect = new PgDialect();
      let raced = false;
      mockDbObject.execute = async (query: SQL) => {
        if (!raced && dialect.sqlToQuery(query).sql.includes("INSERT INTO admin_users")) {
          raced = true;
          await bootDb.query(
            `INSERT INTO admin_users (username, password_hash, display_name, role, permissions)
             VALUES ($1, 'raced-leader-hash', 'raced leader', 'superadmin', '["all"]'::jsonb)`,
            [racedUsername],
          );
        }
        return originalExecute(query);
      };
      try {
        // Without ON CONFLICT this rejects with 23505 → classified
        // "critical" → process.exit(1) on a blue-green cold start.
        await expect(runMigrations()).resolves.toBeUndefined();
      } finally {
        mockDbObject.execute = originalExecute;
      }

      const admins = await bootDb.query<{ c: string | number }>(
        `SELECT count(*) AS c FROM admin_users WHERE username = $1`,
        [racedUsername],
      );
      expect(Number(admins.rows[0]!.c)).toBe(1); // the leader's row only
    },
  );
});
