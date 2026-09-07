import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import {
  db,
  initTestDb,
  resetTestDb,
  adminAlertsTable,
  usersTable,
  walletTopupsTable,
} from "../../test/db";
import { applyMoneyConstraintStage, ensurePgTrgmExtension } from "../../migrate";

/**
 * B7-P0-1 Layer 3 + V1-M9 (round-92 B8 audit) tests.
 *
 * Layer 3: the pg_extension pre-check — `CREATE EXTENSION` must NEVER be
 * issued when the extension row already exists (that exact no-op DDL
 * statement, rejected by the command-class check in a read-only window,
 * killed deploy dep-daf0rt8n74is73fraih0). Verified with a recording
 * executor injected into ensurePgTrgmExtension().
 *
 * V1-M9: money constraints (B8-01/02/03/10) applied idempotently —
 * run the stage twice, assert the catalog state; then the violation
 * pre-check paths (seed bad data → alert instead of constraint).
 *
 * Runs on the pglite harness — every V1-M9 statement is single-statement
 * SQL for exactly this reason (see applyMoneyConstraintStage's doc).
 */

// Explicit hook timeout: the pglite WASM boot + DDL runs under heavy
// parallel-suite CPU contention on the 2-CPU CI sandbox — the 10 s
// default produced flaky beforeAll timeouts in full-suite runs.
beforeAll(initTestDb, 60_000);

// resetTestDb truncates ROWS only — the constraints/indexes V1-M9 adds
// to the harness tables persist across tests, so every test starts by
// stripping them back to the pristine harness DDL state (each statement
// must be single: the pglite driver rejects multi-statement prepares).
const V1_M9_DROP_STATEMENTS = [
  "ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_wallet_balance_nonneg",
  "ALTER TABLE coupons DROP CONSTRAINT IF EXISTS chk_coupons_used_le_max",
  "ALTER TABLE wallet_topups DROP CONSTRAINT IF EXISTS chk_topups_amount_pos",
  "ALTER TABLE wallet_ledger DROP CONSTRAINT IF EXISTS chk_ledger_amount_pos",
  // V1-M10 (round-93 C1): the harness DDL now ships the replacement
  // constraint directly, so the pristine-restore list must strip it too.
  "ALTER TABLE wallet_ledger DROP CONSTRAINT IF EXISTS chk_ledger_amount_nonzero",
  "ALTER TABLE wallet_ledger DROP CONSTRAINT IF EXISTS fk_wallet_ledger_user",
  "DROP INDEX IF EXISTS uniq_wallet_topups_payment_reference",
  "DROP INDEX IF EXISTS idx_orders_status_created",
  "DROP INDEX IF EXISTS idx_topups_status_created",
  "DROP INDEX IF EXISTS idx_inventory_product_sold",
  "DROP INDEX IF EXISTS idx_cart_items_user",
];

beforeEach(async () => {
  await resetTestDb();
  for (const stmt of V1_M9_DROP_STATEMENTS) {
    await db.execute(sql.raw(stmt));
  }
});

async function seedUser(id: number, walletBalance = "0.00"): Promise<void> {
  await db.insert(usersTable).values({ id, phone: `091${id}00000`, walletBalance });
}

async function constraintExists(name: string): Promise<boolean> {
  const result = await db.execute(sql`SELECT 1 AS one FROM pg_constraint WHERE conname = ${name}`);
  const rows = (result as unknown as { rows?: unknown[] }).rows ?? [];
  return rows.length > 0;
}

async function indexExists(name: string): Promise<boolean> {
  const result = await db.execute(sql`SELECT 1 AS one FROM pg_indexes WHERE indexname = ${name}`);
  const rows = (result as unknown as { rows?: unknown[] }).rows ?? [];
  return rows.length > 0;
}

async function countAlerts(dedupeKey: string): Promise<number> {
  const result = await db.execute(
    sql`SELECT count(*) AS c FROM admin_alerts WHERE dedupe_key = ${dedupeKey}`,
  );
  const rows = (result as unknown as { rows?: Array<{ c: number | string }> }).rows ?? [];
  return Number(rows[0]?.c ?? 0);
}

/**
 * Drizzle wraps driver errors ("Failed query: …") and hides the Postgres
 * constraint name in `cause` — unwrap it so assertions can pin the exact
 * constraint that rejected the write.
 */
async function constraintViolationName(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (err) {
    const cause = (err as { cause?: { constraint?: string } }).cause;
    return cause?.constraint ?? (err as { constraint?: string }).constraint;
  }
}

describe("ensurePgTrgmExtension — catalog pre-check (B7-P0-1 Layer 3)", () => {
  type Recorded = Array<string>;

  function recorder(
    probeRows: Array<Record<string, unknown>>,
    onCreate?: () => void,
  ): { execute: (query: SQL) => Promise<unknown>; statements: Recorded } {
    const statements: Recorded = [];
    return {
      statements,
      execute: async (query) => {
        const text = (query as unknown as { queryChunks?: Array<{ value: unknown }> })
          ? String(
              (query as unknown as { queryChunks?: Array<{ value: unknown }> }).queryChunks
                ?.map((c) => c.value)
                .join(""),
            )
          : String(query);
        statements.push(text);
        if (text.includes("FROM pg_extension")) return { rows: probeRows };
        if (text.includes("CREATE EXTENSION")) {
          onCreate?.();
          return { rows: [] };
        }
        return { rows: [] };
      },
    };
  }

  it("skips CREATE EXTENSION entirely when pg_extension already lists pg_trgm", async () => {
    const rec = recorder([{ present: 1 }]);
    const available = await ensurePgTrgmExtension(rec.execute);
    expect(available).toBe(true);
    expect(rec.statements).toHaveLength(1);
    expect(rec.statements[0]).toContain("pg_extension");
    // THE regression pin: zero CREATE EXTENSION statements on a
    // steady-state boot (extension already installed = production state).
    expect(rec.statements.some((s) => s.includes("CREATE EXTENSION"))).toBe(false);
  });

  it("issues CREATE EXTENSION exactly once when the extension is absent", async () => {
    let createRan = 0;
    const rec = recorder([], () => {
      createRan += 1;
    });
    const available = await ensurePgTrgmExtension(rec.execute);
    expect(available).toBe(true);
    expect(createRan).toBe(1);
    expect(rec.statements.filter((s) => s.includes("CREATE EXTENSION"))).toHaveLength(1);
  });

  it("downgrades a generic CREATE failure to unavailable (no throw)", async () => {
    const statements: string[] = [];
    const execute = async (query: SQL) => {
      const text = String(
        (query as unknown as { queryChunks?: Array<{ value: string }> }).queryChunks
          ?.map((c) => c.value)
          .join(""),
      );
      statements.push(text);
      if (text.includes("CREATE EXTENSION")) {
        // The pglite reality: the extension is not compiled in.
        throw new Error("Failed query: CREATE EXTENSION IF NOT EXISTS pg_trgm");
      }
      return { rows: [] };
    };
    const available = await ensurePgTrgmExtension(execute);
    expect(available).toBe(false);
    expect(statements.some((s) => s.includes("CREATE EXTENSION"))).toBe(true);
  });

  it("re-throws a read-only (25006) CREATE rejection so the retry machinery engages", async () => {
    const execute = async (query: SQL) => {
      const text = String(
        (query as unknown as { queryChunks?: Array<{ value: string }> }).queryChunks
          ?.map((c) => c.value)
          .join(""),
      );
      if (text.includes("CREATE EXTENSION")) {
        const err = new Error(
          "cannot execute CREATE EXTENSION in a read-only transaction",
        ) as Error & { code: string };
        err.code = "25006";
        throw err;
      }
      return { rows: [] };
    };
    await expect(ensurePgTrgmExtension(execute)).rejects.toThrow(/read-only transaction/);
  });
});

describe("V1-M9 applyMoneyConstraintStage — idempotent application", () => {
  it("creates every constraint and index, and a second run is a clean no-op", async () => {
    await seedUser(1);
    await applyMoneyConstraintStage();
    await applyMoneyConstraintStage(); // idempotency: no error, same state

    // B8-01
    expect(await indexExists("uniq_wallet_topups_payment_reference")).toBe(true);
    // B8-02
    expect(await constraintExists("fk_wallet_ledger_user")).toBe(true);
    // B8-03
    expect(await constraintExists("chk_users_wallet_balance_nonneg")).toBe(true);
    expect(await constraintExists("chk_coupons_used_le_max")).toBe(true);
    expect(await constraintExists("chk_topups_amount_pos")).toBe(true);
    // B8-03 (V1-M10 form since round-93): the ledger constraint is the
    // sign-free nonzero variant — see applyLedgerAmountNonzeroStage.
    expect(await constraintExists("chk_ledger_amount_nonzero")).toBe(true);
    // B8-10
    expect(await indexExists("idx_orders_status_created")).toBe(true);
    expect(await indexExists("idx_topups_status_created")).toBe(true);
    expect(await indexExists("idx_inventory_product_sold")).toBe(true);
    expect(await indexExists("idx_cart_items_user")).toBe(true);
  });

  it("the applied CHECK constraint actually rejects new bad data", async () => {
    await applyMoneyConstraintStage();
    expect(
      await constraintViolationName(
        db.insert(usersTable).values({ phone: "09199900000", walletBalance: "-5.00" }),
      ),
    ).toBe("chk_users_wallet_balance_nonneg");
  });

  it("the partial unique index rejects a duplicate approved payment reference", async () => {
    await seedUser(1);
    await applyMoneyConstraintStage();
    await db.insert(walletTopupsTable).values({
      userId: 1,
      amount: "10.00",
      paymentReference: "TRX-1",
      status: "approved",
    });
    expect(
      await constraintViolationName(
        db
          .insert(walletTopupsTable)
          .values({ userId: 1, amount: "10.00", paymentReference: "TRX-1", status: "approved" }),
      ),
    ).toBe("uniq_wallet_topups_payment_reference");
    // NULL references and non-approved rows stay exempt (partial predicate).
    await db.insert(walletTopupsTable).values([
      { userId: 1, amount: "10.00", status: "approved" },
      { userId: 1, amount: "10.00", paymentReference: "TRX-1", status: "pending" },
    ]);
    const surviving = await db.select().from(walletTopupsTable);
    expect(surviving.length).toBe(3);
  });
});

describe("V1-M9 applyMoneyConstraintStage — violation pre-check paths", () => {
  it("skips a CHECK constraint when existing data violates it, and alerts instead", async () => {
    await seedUser(1, "-5.00"); // the violating row
    await applyMoneyConstraintStage();

    // Constraint NOT added (alert, not a failed ALTER).
    expect(await constraintExists("chk_users_wallet_balance_nonneg")).toBe(false);
    // A deduped admin alert was logged for the operator.
    expect(await countAlerts("db:constraint:chk_users_wallet_balance_nonneg")).toBe(1);
    // The other constraints still applied (per-constraint short-circuit).
    expect(await constraintExists("chk_topups_amount_pos")).toBe(true);
  });

  it("re-running the violation path dedupes the admin alert (24h window)", async () => {
    await seedUser(1, "-5.00");
    await applyMoneyConstraintStage();
    await applyMoneyConstraintStage();
    expect(await countAlerts("db:constraint:chk_users_wallet_balance_nonneg")).toBe(1);
  });

  it("applies the previously-skipped constraint once the data is fixed", async () => {
    await seedUser(1, "-5.00");
    await applyMoneyConstraintStage();
    await db
      .update(usersTable)
      .set({ walletBalance: "5.00" })
      .where(sql`${usersTable.id} = 1`);
    await applyMoneyConstraintStage();
    expect(await constraintExists("chk_users_wallet_balance_nonneg")).toBe(true);
  });

  it("skips the wallet_ledger FK when orphan rows exist, and alerts instead", async () => {
    await seedUser(1);
    // Drop the harness's FK (named fk_wallet_ledger_user since the round-93
    // A10 DDL-truth fix) so an orphan can be inserted.
    await db.execute(
      sql`ALTER TABLE wallet_ledger DROP CONSTRAINT IF EXISTS fk_wallet_ledger_user`,
    );
    await db.execute(
      sql`INSERT INTO wallet_ledger (user_id, type, amount, balance_before, balance_after) VALUES (424242, 'topup', 5, 0, 5)`,
    );
    await applyMoneyConstraintStage();
    expect(await constraintExists("fk_wallet_ledger_user")).toBe(false);
    expect(await countAlerts("db:constraint:fk_wallet_ledger_user")).toBe(1);
  });

  it("skips the payment_reference unique index when duplicates already exist", async () => {
    await seedUser(1);
    // Bypass any pre-existing index (fresh reset DB → none yet).
    await db.insert(walletTopupsTable).values([
      { userId: 1, amount: "10.00", paymentReference: "DUP", status: "approved" },
      { userId: 1, amount: "10.00", paymentReference: "DUP", status: "approved" },
    ]);
    await applyMoneyConstraintStage();
    expect(await indexExists("uniq_wallet_topups_payment_reference")).toBe(false);
    expect(await countAlerts("db:constraint:uniq_wallet_topups_payment_reference")).toBe(1);
  });
});

describe("V1-M9 alert fan-out uses the standard admin-alert surface", () => {
  it("violation alerts are typed system and carry the dedupe key", async () => {
    await seedUser(1, "-1.00");
    await applyMoneyConstraintStage();
    const alerts = await db
      .select()
      .from(adminAlertsTable)
      .where(sql`${adminAlertsTable.dedupeKey} = 'db:constraint:chk_users_wallet_balance_nonneg'`);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe("system");
  });
});
