import { describe, expect, it, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { sql, type SQL } from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { db, initTestDb } from "../../test/db";
import {
  adminAlertsTable,
  couponsTable,
  ordersTable,
  pointsLedgerTable,
  productVariantsTable,
  usersTable,
  walletLedgerTable,
  walletTopupsTable,
} from "@workspace/db/schema";

/**
 * R118-B3 (A3 F2/F3/F4 + A6 F-4) — mirror-integrity regression test for
 * the drizzle 0016 re-emit.
 *
 * The live DB is built by migrate.ts boot SQL, never by the drizzle chain
 * (r110's 0013 header documents the invariant); the chain is the mirror
 * CI regenerates + diffs. Three regressions this file pins shut:
 *
 *   F2  uniq_points_ledger_type_reference was declared a PLAIN index in
 *       TS/snapshot while live (V1-M21) is a partial UNIQUE — a push would
 *       have silently stripped the points exactly-once guard. The TS must
 *       declare uniqueIndex (same name + predicate).
 *   F3  the 10 live money CHECK constraints (V1-M9/M10/M21/M22) were
 *       absent from the snapshot — a push would have dropped them. The TS
 *       must declare check() with the exact live constraint NAMES.
 *   F4  uniq_product_variants_plan_duration is NULLS NOT DISTINCT live,
 *       which drizzle-orm 0.45.2 cannot express on uniqueIndex() — the
 *       object is BOOT-OWNED (V1-M17 is the authoritative DDL) and 0016
 *       must not attempt to drop/recreate it.
 *
 * Plus the A6 F-4 read-path index idx_admin_alerts_created (the one
 * genuinely additive object in 0016) and the r110/0013 hardening: every
 * 0016 statement is guarded so the file is a no-op (not a 42710/42P07
 * error) on the runtime shape — the pglite harness ships exactly that
 * shape (V1-M9/M10/M21/M22 constraints verbatim), so executing the chain
 * here is a literal live-boot dry-run.
 */

/**
 * Catalog objects whose LIVE shape cannot be expressed by the drizzle
 * TS/snapshot (R118-A3 F4): drizzle-orm 0.45.2 has nullsNotDistinct() only
 * on unique() constraints, not uniqueIndex(). The boot migration remains
 * the authoritative DDL for these names; the snapshot carries the closest
 * expressible mirror (plain unique index on the same columns under the
 * same name). A future drizzle-orm upgrade should remove the entry,
 * express the flag, and regenerate — this test will remind whoever does.
 */
const BOOT_OWNED_OBJECTS = ["uniq_product_variants_plan_duration"] as const;

/** The 10 live CHECK constraints (exact live names → declaring table). */
const MIRROR_CHECKS: Record<string, string> = {
  chk_users_wallet_balance_nonneg: "users",
  chk_users_loyalty_points_nonneg: "users",
  chk_ledger_amount_nonzero: "wallet_ledger",
  chk_topups_amount_pos: "wallet_topups",
  chk_coupons_used_le_max: "coupons",
  chk_orders_refund_amount_range: "orders",
  chk_points_ledger_arithmetic: "points_ledger",
  chk_points_ledger_delta_nonzero: "points_ledger",
  chk_points_ledger_balances_nonneg: "points_ledger",
  chk_points_ledger_reason_for_manual: "points_ledger",
};

/** Resolve a repo path relative to this test file (backend/src/jobs/__tests__). */
function repoPath(rel: string): string {
  return new URL(`../../../../${rel}`, import.meta.url).pathname;
}

interface JournalEntry {
  idx: number;
  tag: string;
}

async function readJournal(): Promise<JournalEntry[]> {
  const raw = JSON.parse(await readFile(repoPath("shared/db/drizzle/meta/_journal.json"), "utf8"));
  return raw.entries as JournalEntry[];
}

/** Strip `--` comment lines, split on drizzle's breakpoint marker, drop blanks. */
function parseStatements(fileSql: string): string[] {
  return fileSql
    .replace(/^\s*--.*$/gm, "")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Run the parsed chain statements in order against the harness. */
async function applyChain(statements: string[]): Promise<void> {
  for (const stmt of statements) {
    await db.execute(sql.raw(stmt));
  }
}

/** Render a drizzle sql`` template (predicate / check expression) to text. */
function sqlText(chunk: SQL | undefined): string {
  if (!chunk) return "";
  const chunks = (chunk as unknown as { queryChunks?: Array<{ value: unknown }> }).queryChunks;
  return String(chunks?.map((c) => (Array.isArray(c.value) ? c.value.join("") : c.value)).join(""));
}

/** Column names an index is declared on (drizzle IndexedColumn.name). */
function indexColumns(index: { config: { columns: unknown[] } }): string[] {
  return index.config.columns.map((c) => String((c as { name?: string }).name));
}

async function constraintCount(name: string): Promise<number> {
  const result = await db.execute(
    sql`SELECT count(*)::int AS c FROM pg_constraint WHERE conname = ${name}`,
  );
  const rows = (result as unknown as { rows?: Array<{ c: number }> }).rows ?? [];
  return Number(rows[0]?.c ?? 0);
}

async function indexDef(name: string): Promise<string | undefined> {
  const result = await db.execute(
    sql`SELECT indexdef AS def FROM pg_indexes WHERE indexname = ${name}`,
  );
  const rows = (result as unknown as { rows?: Array<{ def: string }> }).rows ?? [];
  return rows[0]?.def;
}

/** All check() declarations of a table, keyed by constraint name. */
function tableChecks(table: PgTable): Map<string, string> {
  const checks = getTableConfig(table).checks;
  return new Map(checks.map((c) => [c.name as string, sqlText(c.value)]));
}

let journal0016Tag = "";
let statements0016: string[] = [];

beforeAll(async () => {
  await initTestDb();
  const entries = await readJournal();
  const entry16 = entries.find((e) => e.idx === 16);
  expect(entry16).toBeDefined();
  journal0016Tag = entry16!.tag;
  statements0016 = parseStatements(
    await readFile(repoPath(`shared/db/drizzle/${journal0016Tag}.sql`), "utf8"),
  );
}, 60_000);

describe("R118-B3: the chain follows the corrected schema (journal + 0016)", () => {
  it("the journal carries 0015 → 0016 in order", async () => {
    const entries = await readJournal();
    const idx15 = entries.findIndex((e) => e.idx === 15);
    const idx16 = entries.findIndex((e) => e.idx === 16);
    expect(idx15).toBeGreaterThanOrEqual(0);
    expect(idx16).toBe(idx15 + 1);
    expect(journal0016Tag).toMatch(/^0016_/);
  });

  it("0016 declares exactly the F2/F3/A6-F4 objects and nothing else", () => {
    expect(statements0016).toHaveLength(13);
    const all = statements0016.join("\n");
    // F2: the points exactly-once guard re-declared UNIQUE.
    expect(all).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "uniq_points_ledger_type_reference" ON "points_ledger" USING btree ("type","reference_id") WHERE reference_id IS NOT NULL;',
    );
    // A6 F-4: the genuinely additive read-path index.
    expect(all).toContain(
      'CREATE INDEX IF NOT EXISTS "idx_admin_alerts_created" ON "admin_alerts" USING btree ("created_at" DESC NULLS LAST);',
    );
    // F3: all ten live CHECK names carried.
    for (const name of Object.keys(MIRROR_CHECKS)) {
      expect(all).toContain(`"${name}"`);
    }
  });

  it("0016 is hardened (r110/0013 idiom) — no statement can error on the runtime shape", () => {
    for (const stmt of statements0016) {
      if (stmt.includes("CREATE INDEX") || stmt.includes("CREATE UNIQUE INDEX")) {
        expect(stmt).toContain("IF NOT EXISTS");
      }
      if (stmt.includes("DROP INDEX")) {
        expect(stmt).toContain("IF EXISTS");
      }
      // Postgres has no ADD CONSTRAINT IF NOT EXISTS — the guard must be
      // the migrate.ts duplicate_object-swallowing DO block.
      if (stmt.includes("ADD CONSTRAINT")) {
        expect(stmt.startsWith("DO $$")).toBe(true);
        expect(stmt).toContain("EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;");
      }
    }
  });

  it("F4: 0016 never touches the boot-owned NULLS NOT DISTINCT object", () => {
    // drizzle-kit cannot express nullsNotDistinct on uniqueIndex(), so a
    // regenerate must not emit any drop/recreate for it — V1-M17 stays
    // authoritative (BOOT_OWNED_OBJECTS above).
    for (const name of BOOT_OWNED_OBJECTS) {
      expect(statements0016.some((s) => s.includes(name))).toBe(false);
    }
  });
});

describe("R118-B3: the TS schema declares the mirror (compile-level)", () => {
  it("all 10 live CHECK constraints are declared with their exact names", () => {
    const byTable: Record<string, PgTable> = {
      users: usersTable,
      wallet_ledger: walletLedgerTable,
      wallet_topups: walletTopupsTable,
      coupons: couponsTable,
      orders: ordersTable,
      points_ledger: pointsLedgerTable,
    };
    for (const [name, tableName] of Object.entries(MIRROR_CHECKS)) {
      const checks = tableChecks(byTable[tableName]);
      expect(checks.has(name), `${tableName}.${name} missing from the TS schema`).toBe(true);
    }
  });

  it("the check expressions are pinned verbatim to the boot SQL", () => {
    expect(tableChecks(usersTable).get("chk_users_wallet_balance_nonneg")).toBe(
      "wallet_balance >= 0",
    );
    expect(tableChecks(usersTable).get("chk_users_loyalty_points_nonneg")).toBe(
      "loyalty_points >= 0",
    );
    expect(tableChecks(walletLedgerTable).get("chk_ledger_amount_nonzero")).toBe("amount <> 0");
    expect(tableChecks(walletTopupsTable).get("chk_topups_amount_pos")).toBe("amount > 0");
    expect(tableChecks(couponsTable).get("chk_coupons_used_le_max")).toBe(
      "max_uses IS NULL OR used_count <= max_uses",
    );
    expect(tableChecks(ordersTable).get("chk_orders_refund_amount_range")).toBe(
      "refund_amount IS NULL OR (refund_amount > 0 AND refund_amount <= amount)",
    );
    const points = tableChecks(pointsLedgerTable);
    expect(points.get("chk_points_ledger_arithmetic")).toBe(
      "points_after = points_before + points_delta",
    );
    expect(points.get("chk_points_ledger_delta_nonzero")).toBe("points_delta <> 0");
    expect(points.get("chk_points_ledger_balances_nonneg")).toBe(
      "points_before >= 0 AND points_after >= 0",
    );
    expect(points.get("chk_points_ledger_reason_for_manual")).toBe(
      "type NOT IN ('admin_set', 'correction') OR reason IS NOT NULL",
    );
  });

  it("F2: uniq_points_ledger_type_reference is declared a partial UNIQUE index", () => {
    const idx = getTableConfig(pointsLedgerTable).indexes.find(
      (i) => i.config.name === "uniq_points_ledger_type_reference",
    );
    expect(idx).toBeDefined();
    expect(idx!.config.unique).toBe(true); // the F2 regression: was false
    expect(indexColumns(idx!)).toEqual(["type", "reference_id"]);
    expect(sqlText(idx!.config.where)).toBe("reference_id IS NOT NULL");
  });

  it("A6 F-4: idx_admin_alerts_created is declared (plain, created_at)", () => {
    const idx = getTableConfig(adminAlertsTable).indexes.find(
      (i) => i.config.name === "idx_admin_alerts_created",
    );
    expect(idx).toBeDefined();
    expect(idx!.config.unique).toBe(false);
    expect(indexColumns(idx!)).toEqual(["created_at"]);
  });

  it("F4: the boot-owned NND object stays declared under its live name + columns", () => {
    // The closest expressible mirror (plain unique index) must stay so a
    // push cannot drop the guard entirely; the NULLS NOT DISTINCT flag
    // itself is boot-owned (V1-M17) — see BOOT_OWNED_OBJECTS.
    const idx = getTableConfig(productVariantsTable).indexes.find(
      (i) => i.config.name === "uniq_product_variants_plan_duration",
    );
    expect(idx).toBeDefined();
    expect(idx!.config.unique).toBe(true);
    expect(indexColumns(idx!)).toEqual(["product_id", "plan_label", "duration_label"]);
  });
});

describe("R118-B3: 0016 executes cleanly on the runtime shape (live-boot dry-run)", () => {
  it("the harness pre-carries the live shape: all 10 checks, UNIQUE points index, no created-idx", async () => {
    for (const name of Object.keys(MIRROR_CHECKS)) {
      expect(await constraintCount(name)).toBe(1);
    }
    const pointsIdx = await indexDef("uniq_points_ledger_type_reference");
    expect(pointsIdx).toContain("UNIQUE INDEX uniq_points_ledger_type_reference");
    expect(pointsIdx).toContain("reference_id IS NOT NULL");
    expect(await indexDef("idx_admin_alerts_created")).toBeUndefined();
  });

  it("applying 0016 once, then again, is error-free and idempotent (r110 belt)", async () => {
    await applyChain(statements0016); // live-boot simulation
    await applyChain(statements0016); // second application: clean no-op

    // The 10 checks were NOT duplicated (guards no-op'd, not re-added).
    for (const name of Object.keys(MIRROR_CHECKS)) {
      expect(await constraintCount(name)).toBe(1);
    }
    // F2: the drop+create pair converged back to the same partial UNIQUE.
    const pointsIdx = await indexDef("uniq_points_ledger_type_reference");
    expect(pointsIdx).toContain("UNIQUE INDEX uniq_points_ledger_type_reference");
    expect(pointsIdx).toContain("reference_id IS NOT NULL");
    // A6 F-4: the one genuinely additive object now exists.
    const alertsIdx = await indexDef("idx_admin_alerts_created");
    expect(alertsIdx).toContain("INDEX idx_admin_alerts_created");
    expect(alertsIdx).toContain("ON public.admin_alerts");
    expect(alertsIdx).toContain("created_at");
  });
});
