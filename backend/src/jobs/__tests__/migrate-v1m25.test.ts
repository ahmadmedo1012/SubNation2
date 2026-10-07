import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { readFile } from "node:fs/promises";
import { eq, sql, type SQL } from "drizzle-orm";
import {
  db,
  initTestDb,
  resetTestDb,
  adminAlertsTable,
  productsTable,
  usersTable,
  walletLedgerTable,
} from "../../test/db";
import { applyMoneyLedgerUserFkRestrictStage } from "../../migrate";

/**
 * R122 (A4-P1-2) — V1-M25: the four money-history user FKs rebuilt as
 * ON DELETE RESTRICT (the never-delete audit-trail policy).
 *
 * The pglite harness carries the POST-V1-M25 steady state (all four FKs
 * RESTRICT under the boot names — fk_wallet_ledger_user / fk_orders_user /
 * fk_topups_user / the points_ledger auto-name), so the default run
 * certifies the zero-DDL pin, and the legacy-shape tests restore the
 * pre-V1-M25 CASCADE twins by hand (the users-ddl pristine-state pattern:
 * raw SQL, never the stage under test). The drizzle 0018 mirror (journal
 * order + hardening + live-boot dry-run) rides along like 0017 did in
 * migrate-v1m24.test.ts.
 */

/** Resolve a repo path relative to this test file (backend/src/jobs/__tests__). */
function repoPath(rel: string): string {
  return new URL(`../../../../${rel}`, import.meta.url).pathname;
}

// R122 (A4-P1-2): the stage's own target list, mirrored for the
// pristine-state restore (table + canonical boot constraint name).
const FK_TARGETS: Array<{ table: string; constraint: string }> = [
  { table: "wallet_ledger", constraint: "fk_wallet_ledger_user" },
  { table: "orders", constraint: "fk_orders_user" },
  { table: "wallet_topups", constraint: "fk_topups_user" },
  { table: "points_ledger", constraint: "points_ledger_user_id_fkey" },
];

/** Drop EVERY FK on <table>.user_id regardless of name (V1-M20 sweep shape). */
async function dropAllUserFks(table: string): Promise<void> {
  await db.execute(
    sql.raw(`
    DO $$
    DECLARE
      fk_name text;
    BEGIN
      FOR fk_name IN
        SELECT con.conname
        FROM pg_constraint con
        JOIN pg_attribute a
          ON a.attrelid = con.conrelid
         AND a.attnum = ANY (con.conkey)
        WHERE con.contype = 'f'
          AND con.conrelid = '${table}'::regclass
          AND a.attname = 'user_id'
      LOOP
        EXECUTE format('ALTER TABLE ${table} DROP CONSTRAINT %I', fk_name);
      END LOOP;
    END $$;
  `),
  );
}

/** Restore the pristine (post-V1-M25) harness shape: one RESTRICT FK per table. */
async function restorePristineFks(): Promise<void> {
  for (const { table, constraint } of FK_TARGETS) {
    await dropAllUserFks(table);
    await db.execute(
      sql.raw(
        `ALTER TABLE ${table} ADD CONSTRAINT ${constraint} FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT`,
      ),
    );
  }
}

/** Restore the pre-V1-M25 live shape for ONE table: the boot-named CASCADE FK. */
async function restoreLegacyCascadeFk(table: string, constraint: string): Promise<void> {
  await dropAllUserFks(table);
  await db.execute(
    sql.raw(
      `ALTER TABLE ${table} ADD CONSTRAINT ${constraint} FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`,
    ),
  );
}

interface Recorded {
  statements: string[];
  execute: (query: SQL) => Promise<unknown>;
}

/** Recording executor (same chunk-walking as migrate-users-ddl/v1m24). */
function recorder(): Recorded {
  const statements: string[] = [];
  return {
    statements,
    execute: async (query) => {
      const text = String(
        (query as unknown as { queryChunks?: Array<{ value: unknown }> }).queryChunks
          ?.map((c) => (Array.isArray(c.value) ? c.value.join("") : c.value))
          .join(""),
      );
      statements.push(text);
      return db.execute(query);
    },
  };
}

/** DDL-class statements (ALTER TABLE / DROP CONSTRAINT / ADD CONSTRAINT). */
const DDL_RE = /ALTER\s+TABLE|DROP\s+CONSTRAINT|ADD\s+CONSTRAINT/i;

async function constraintDef(name: string): Promise<string | undefined> {
  const result = await db.execute(
    sql`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ${name}`,
  );
  const rows = (result as unknown as { rows?: Array<{ def: string }> }).rows ?? [];
  return rows[0]?.def;
}

/** All FK constraint names on <table>.user_id (any name — the sweep's view). */
async function userFkNames(table: string): Promise<string[]> {
  const result = await db.execute(sql`
    SELECT con.conname AS conname
    FROM pg_constraint con
    JOIN pg_attribute a
      ON a.attrelid = con.conrelid
     AND a.attnum = ANY (con.conkey)
    WHERE con.contype = 'f'
      AND con.conrelid = ${table}::regclass
      AND a.attname = 'user_id'
  `);
  const rows = (result as unknown as { rows?: Array<{ conname: string }> }).rows ?? [];
  return rows.map((r) => String(r.conname));
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

let phoneSeq = 91_700_000;
function nextPhone(): string {
  phoneSeq += 1;
  return String(phoneSeq);
}

beforeAll(initTestDb, 60_000);
beforeEach(async () => {
  await resetTestDb();
  await restorePristineFks();
});

describe("V1-M25 — applyMoneyLedgerUserFkRestrictStage (A4-P1-2)", () => {
  it("steady state: all four FKs already RESTRICT under the boot names → ZERO DDL", async () => {
    // The harness boots in the post-V1-M25 shape — exactly every steady-
    // state boot after the first post-R122 deploy.
    for (const { table, constraint } of FK_TARGETS) {
      expect(await constraintDef(constraint)).toBe(
        "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT",
      );
      expect(await userFkNames(table)).toEqual([constraint]);
    }

    const rec = recorder();
    await applyMoneyLedgerUserFkRestrictStage(rec.execute);

    // THE regression pin: the probes answered RESTRICT → no ALTER at all.
    expect(rec.statements.filter((s) => DDL_RE.test(s))).toHaveLength(0);
  });

  it("legacy CASCADE shape (the pre-R122 live DB): probe-gated conversion → RESTRICT, once", async () => {
    // Every table back to its pre-R122 boot shape: same name, CASCADE.
    for (const { table, constraint } of FK_TARGETS) {
      await restoreLegacyCascadeFk(table, constraint);
      expect(await constraintDef(constraint)).toContain("ON DELETE CASCADE");
    }

    await applyMoneyLedgerUserFkRestrictStage();
    for (const { table, constraint } of FK_TARGETS) {
      expect(await constraintDef(constraint)).toBe(
        "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT",
      );
      // Converged to EXACTLY one FK — no drizzle-named twin left behind.
      expect(await userFkNames(table)).toEqual([constraint]);
    }

    // Re-run with a recorder: pure no-op (the forever-boot contract).
    const rec = recorder();
    await applyMoneyLedgerUserFkRestrictStage(rec.execute);
    expect(rec.statements.filter((s) => DDL_RE.test(s))).toHaveLength(0);
  });

  it("a differently-named CASCADE FK (chain-built shape): the any-name sweep converges it", async () => {
    // A database built by the drizzle chain carries the drizzle-named FK.
    await dropAllUserFks("wallet_ledger");
    await db.execute(
      sql.raw(
        `ALTER TABLE wallet_ledger ADD CONSTRAINT wallet_ledger_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`,
      ),
    );
    expect(await userFkNames("wallet_ledger")).toEqual(["wallet_ledger_user_id_users_id_fk"]);

    await applyMoneyLedgerUserFkRestrictStage();

    // The stray is gone; the single canonical boot-named RESTRICT FK remains.
    expect(await userFkNames("wallet_ledger")).toEqual(["fk_wallet_ledger_user"]);
    expect(await constraintDef("fk_wallet_ledger_user")).toBe(
      "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT",
    );
  });

  it("orphan rows: ALERT + skip, nothing deleted, other tables still converge", async () => {
    // Drop wallet_ledger's FK so an orphan can exist (V1-M9 test pattern).
    await dropAllUserFks("wallet_ledger");
    await db.execute(
      sql`INSERT INTO wallet_ledger (user_id, type, amount, balance_before, balance_after)
          VALUES (424242, 'topup', 5, 0, 5)`,
    );

    await applyMoneyLedgerUserFkRestrictStage();

    // The FK was NOT created and the orphan row was NOT deleted.
    expect(await userFkNames("wallet_ledger")).toEqual([]);
    const orphans = await db.execute(
      sql`SELECT count(*) AS c FROM wallet_ledger WHERE user_id = 424242`,
    );
    const rows = (orphans as unknown as { rows?: Array<{ c: number | string }> }).rows ?? [];
    expect(Number(rows[0]?.c ?? 0)).toBe(1);
    // A deduped admin alert was logged for the operator.
    expect(await countAlerts("db:fkrestrict:fk_wallet_ledger_user")).toBe(1);
    // Per-table short-circuit: the other three still converged.
    expect(await constraintDef("fk_orders_user")).toContain("ON DELETE RESTRICT");
    expect(await constraintDef("fk_topups_user")).toContain("ON DELETE RESTRICT");
    expect(await constraintDef("points_ledger_user_id_fkey")).toContain("ON DELETE RESTRICT");
  });

  it("the rebuilt RESTRICT FK actually blocks a user delete (and money rows survive)", async () => {
    const [user] = await db
      .insert(usersTable)
      .values({ phone: nextPhone(), walletBalance: "100.00" })
      .returning();
    await db.insert(walletLedgerTable).values({
      userId: user.id,
      type: "topup",
      amount: "100.00",
      balanceBefore: "0.00",
      balanceAfter: "100.00",
    });

    // The stage ran in beforeEach's pristine restore — the behavioral pin:
    expect(
      await constraintViolationName(db.delete(usersTable).where(eq(usersTable.id, user.id))),
    ).toBe("fk_wallet_ledger_user");
    const [survivor] = await db.select().from(walletLedgerTable);
    expect(survivor).toBeDefined();
  });

  it("a user with NO money rows still deletes cleanly (RESTRICT is not a blanket block)", async () => {
    const [user] = await db.insert(usersTable).values({ phone: nextPhone() }).returning();
    const [product] = await db
      .insert(productsTable)
      .values({ name: "v1m25-clean-delete-probe", price: "10.00" })
      .returning();
    void product;

    await db.delete(usersTable).where(eq(usersTable.id, user.id));
    const [gone] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(gone).toBeUndefined();
  });
});

describe("R122 — the drizzle 0018 mirror (chain follows the schema)", () => {
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

  it("the journal carries 0017 → 0018 in order", async () => {
    const raw = JSON.parse(
      await readFile(repoPath("shared/db/drizzle/meta/_journal.json"), "utf8"),
    );
    const entries = raw.entries as JournalEntry[];
    const idx17 = entries.findIndex((e) => e.idx === 17);
    const idx18 = entries.findIndex((e) => e.idx === 18);
    expect(idx17).toBeGreaterThanOrEqual(0);
    expect(idx18).toBe(idx17 + 1);
    expect(entries[idx18].tag).toMatch(/^0018_/);
  });

  it("0018 declares the V1-M25 FKs + V1-M26 CHECKs, hardened (r110 idiom)", async () => {
    const tag = "0018_large_speedball";
    const statements = parseStatements(
      await readFile(repoPath(`shared/db/drizzle/${tag}.sql`), "utf8"),
    );
    const all = statements.join("\n");
    // The four boot-named RESTRICT FK rebuilds.
    for (const { constraint } of FK_TARGETS) {
      expect(all).toContain(`ADD CONSTRAINT "${constraint}"`);
    }
    // The two V1-M26 CHECKs.
    expect(all).toContain('"chk_orders_amount_pos"');
    expect(all).toContain('"chk_ledger_arithmetic"');
    // Hardening: every DROP carries IF EXISTS; every ADD is the
    // duplicate_object-swallowing DO block (Postgres has no ADD CONSTRAINT
    // IF NOT EXISTS — the migrate.ts guard is mandatory).
    for (const stmt of statements) {
      if (stmt.includes("DROP CONSTRAINT")) expect(stmt).toContain("IF EXISTS");
      if (stmt.includes("ADD CONSTRAINT")) {
        expect(stmt.startsWith("DO $$")).toBe(true);
        expect(stmt).toContain("EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;");
      }
    }
    // The RESTRICT policy is what the chain mirrors (not CASCADE).
    expect(all).toContain("ON DELETE restrict");
    expect(all).not.toContain("ON DELETE cascade");
  });

  it("0018 executes cleanly + idempotently on the runtime shape (live-boot dry-run)", async () => {
    const statements = parseStatements(
      await readFile(repoPath("shared/db/drizzle/0018_large_speedball.sql"), "utf8"),
    );
    const applyChain = async () => {
      for (const stmt of statements) {
        await db.execute(sql.raw(stmt));
      }
    };
    await applyChain(); // live-boot simulation
    await applyChain(); // second application: clean no-op

    // The runtime shape after the chain: exactly the four boot-named
    // RESTRICT FKs + both CHECKs — nothing duplicated, nothing weakened.
    for (const { table, constraint } of FK_TARGETS) {
      expect(await userFkNames(table)).toEqual([constraint]);
      expect(await constraintDef(constraint)).toBe(
        "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT",
      );
    }
    expect(await constraintDef("chk_orders_amount_pos")).toBe("CHECK ((amount > (0)::numeric))");
    expect(await constraintDef("chk_ledger_arithmetic")).toContain("balance_after");
    // The alert surface is untouched by the chain (no constraint-skip).
    const alerts = await db.select().from(adminAlertsTable);
    expect(alerts).toHaveLength(0);
  });
});
