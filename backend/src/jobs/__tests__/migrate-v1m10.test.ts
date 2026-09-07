/**
 * V1-M10 (round-93 A2 finding #1 + A7 §2 P1 — live-DB confirmed):
 * `chk_ledger_amount_pos` (amount > 0) vs signed adjustment deltas.
 *
 * The original V1-M9 CHECK broke every admin wallet debit: adjustments
 * store `amount = balanceAfter - balanceBefore` (SIGNED), so the first
 * `adjust(userId, -30)` hit SQLSTATE 23514 and the whole atomic tx rolled
 * back into a generic 500. A7 verified the live DB: constraint live,
 * 0 adjustment rows written (armed, not fired).
 *
 * Fix under test (applyLedgerAmountNonzeroStage, following V1-M9's exact
 * stage shape):
 *   - fresh state: stage sequence (V1-M9 stage → V1-M10 stage) creates
 *     chk_ledger_amount_nonzero with the DEFINITION `CHECK ((amount <> 0))`
 *     (definitions pinned, not just names — A10 §2 P1);
 *   - legacy state (the live Neon DB shape): pre-existing
 *     chk_ledger_amount_pos is DROPPED and replaced;
 *   - re-runs are no-ops;
 *   - A7's recommended end-to-end regression: apply the stages, then run a
 *     debit adjustment — balance drops, ledger row amount = -30 commits;
 *   - amount = 0 stays forbidden (the nonzero invariant);
 *   - violation pre-check: existing zero rows alert the operator instead
 *     of failing the boot ALTER.
 *
 * Runs on the pglite harness; every stage statement is single-statement
 * SQL for exactly this reason (see applyMoneyConstraintStage's doc).
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  db,
  initTestDb,
  resetTestDb,
  adminAlertsTable,
  usersTable,
  walletLedgerTable,
} from "../../test/db";
import { AdjustmentService } from "../../services/adjustment.service";
import { applyLedgerAmountNonzeroStage, applyMoneyConstraintStage } from "../../migrate";

// The harness DDL (test/db.ts) ships chk_ledger_amount_nonzero directly
// (A10 DDL-truth fix), so each test starts by stripping it back to the
// pre-stage state the migration is supposed to build.
const V1_M10_DROP_STATEMENTS = [
  "ALTER TABLE wallet_ledger DROP CONSTRAINT IF EXISTS chk_ledger_amount_nonzero",
  "ALTER TABLE wallet_ledger DROP CONSTRAINT IF EXISTS chk_ledger_amount_pos",
];

beforeAll(initTestDb, 60_000);
beforeEach(async () => {
  await resetTestDb();
  for (const stmt of V1_M10_DROP_STATEMENTS) {
    await db.execute(sql.raw(stmt));
  }
});

async function seedUser(id: number, walletBalance = "0.00"): Promise<void> {
  await db.insert(usersTable).values({ id, phone: `092${id}00000`, walletBalance });
}

async function constraintDef(name: string): Promise<string | undefined> {
  const result = await db.execute(
    sql`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ${name}`,
  );
  const rows = (result as unknown as { rows?: Array<{ def: string }> }).rows ?? [];
  return rows[0]?.def;
}

async function constraintExists(name: string): Promise<boolean> {
  return (await constraintDef(name)) !== undefined;
}

async function countAlerts(dedupeKey: string): Promise<number> {
  const result = await db.execute(
    sql`SELECT count(*) AS c FROM admin_alerts WHERE dedupe_key = ${dedupeKey}`,
  );
  const rows = (result as unknown as { rows?: Array<{ c: number | string }> }).rows ?? [];
  return Number(rows[0]?.c ?? 0);
}

/** Unwrap drizzle's error cause to pin the exact constraint that rejected. */
async function constraintViolationName(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (err) {
    const cause = (err as { cause?: { constraint?: string } }).cause;
    return cause?.constraint ?? (err as { constraint?: string }).constraint;
  }
}

describe("V1-M10 applyLedgerAmountNonzeroStage — fresh-install application", () => {
  it("boot stage sequence creates the nonzero constraint with the exact definition", async () => {
    await applyMoneyConstraintStage();
    await applyLedgerAmountNonzeroStage();

    expect(await constraintExists("chk_ledger_amount_nonzero")).toBe(true);
    // A10 §2 P1: pin the DEFINITION, not just the name — reverting
    // `amount <> 0` back to `amount > 0` (same name) must fail here.
    expect(await constraintDef("chk_ledger_amount_nonzero")).toBe(
      "CHECK ((amount <> (0)::numeric))",
    );
    // The legacy name is gone — it is the constraint that 500'd debits.
    expect(await constraintExists("chk_ledger_amount_pos")).toBe(false);
  });

  it("re-running the stage sequence is a no-op (idempotency)", async () => {
    await applyMoneyConstraintStage();
    await applyLedgerAmountNonzeroStage();
    await applyMoneyConstraintStage();
    await applyLedgerAmountNonzeroStage();

    expect(await constraintDef("chk_ledger_amount_nonzero")).toBe(
      "CHECK ((amount <> (0)::numeric))",
    );
    expect(await constraintExists("chk_ledger_amount_pos")).toBe(false);
  });

  it("V1-M9's negative-balance protection survives V1-M10 (no regression)", async () => {
    await applyMoneyConstraintStage();
    await applyLedgerAmountNonzeroStage();

    expect(await constraintExists("chk_users_wallet_balance_nonneg")).toBe(true);
    expect(
      await constraintViolationName(
        db.insert(usersTable).values({ phone: "09299900000", walletBalance: "-5.00" }),
      ),
    ).toBe("chk_users_wallet_balance_nonneg");
  });
});

describe("V1-M10 applyLedgerAmountNonzeroStage — legacy-database transition (live Neon shape)", () => {
  it("drops a pre-existing chk_ledger_amount_pos and replaces it with the nonzero form", async () => {
    // Simulate the live DB: V1-M9 already applied the old constraint.
    await db.execute(
      sql.raw(`ALTER TABLE wallet_ledger ADD CONSTRAINT chk_ledger_amount_pos CHECK (amount > 0)`),
    );
    expect(await constraintExists("chk_ledger_amount_pos")).toBe(true);

    await applyMoneyConstraintStage();
    await applyLedgerAmountNonzeroStage();

    expect(await constraintExists("chk_ledger_amount_pos")).toBe(false);
    expect(await constraintDef("chk_ledger_amount_nonzero")).toBe(
      "CHECK ((amount <> (0)::numeric))",
    );
  });
});

describe("V1-M10 — the debit the old constraint killed (A7's end-to-end regression)", () => {
  it("adjust(userId, -30) commits after the stage sequence: balance drops, ledger row is -30", async () => {
    await seedUser(1, "100.00");
    await applyMoneyConstraintStage();
    await applyLedgerAmountNonzeroStage();

    const result = await AdjustmentService.adjust(1, -30, {
      adminId: 42,
      note: "credit reversal (V1-M10 regression)",
    });

    expect(result.walletBalance).toBe(70);
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, 1));
    expect(parseFloat(String(u.walletBalance))).toBe(70);
    const ledger = await db.select().from(walletLedgerTable).where(eq(walletLedgerTable.userId, 1));
    expect(ledger).toHaveLength(1);
    expect(parseFloat(String(ledger[0].amount))).toBe(-30);
    expect(parseFloat(String(ledger[0].balanceAfter))).toBe(70);
  });

  it("amount = 0 ledger rows are rejected (nonzero, not merely positive)", async () => {
    await seedUser(1);
    await applyMoneyConstraintStage();
    await applyLedgerAmountNonzeroStage();

    expect(
      await constraintViolationName(
        db.insert(walletLedgerTable).values({
          userId: 1,
          type: "adjustment",
          amount: "0.00",
          balanceBefore: "0.00",
          balanceAfter: "0.00",
        }),
      ),
    ).toBe("chk_ledger_amount_nonzero");
  });
});

describe("V1-M10 applyLedgerAmountNonzeroStage — violation pre-check", () => {
  it("existing amount=0 rows alert instead of failing the boot ALTER", async () => {
    await seedUser(1);
    // (An amount=0 row cannot coexist with the legacy amount>0 constraint —
    // the old form forbids zeros too — so this scenario implies the ledger
    // is unconstrained: a database that skipped V1-M9's check.)
    await db.execute(
      sql`INSERT INTO wallet_ledger (user_id, type, amount, balance_before, balance_after)
          VALUES (1, 'adjustment', 0, 5, 5)`,
    );

    await applyLedgerAmountNonzeroStage();

    expect(await constraintExists("chk_ledger_amount_nonzero")).toBe(false);
    expect(await countAlerts("db:constraint:chk_ledger_amount_nonzero")).toBe(1);
  });

  it("the alert rides the standard admin-alert surface (typed system, dedupe key)", async () => {
    await seedUser(1);
    await db.execute(
      sql`INSERT INTO wallet_ledger (user_id, type, amount, balance_before, balance_after)
          VALUES (1, 'adjustment', 0, 5, 5)`,
    );
    await applyLedgerAmountNonzeroStage();

    const alerts = await db
      .select()
      .from(adminAlertsTable)
      .where(sql`${adminAlertsTable.dedupeKey} = 'db:constraint:chk_ledger_amount_nonzero'`);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe("system");
  });
});
