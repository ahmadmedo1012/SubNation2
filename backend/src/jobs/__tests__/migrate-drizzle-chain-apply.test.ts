import { describe, expect, it, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

/**
 * R143 (L9-2 / F-1+F-2b) — the sequential chain-apply test.
 *
 * The drizzle mirror chain (`shared/db/drizzle/0000…0024`) is the
 * documented provisioning path for fresh installs + the CI drift gate,
 * yet nothing in the tree ever APPLIED it — the CI gate diffs bytes
 * only. That is exactly how L9-1 rode green CI: file 0003 carried
 * `USING btree (true)`, a 42601 syntax error on real Postgres (the
 * index_elem grammar requires a parenthesized constant), so a
 * fresh-install replay died at file 3 of 24 with a half-built schema.
 *
 * This test is the pin: it loops the journal in order and replays EVERY
 * chain file against a fresh PGlite (real Postgres grammar in WASM),
 * skipping only the pg_trgm statements the runtime itself degrades on
 * (`ensurePgTrgmExtension`, migrate.ts — PGlite has no pg_trgm:
 * SQLSTATE 0A000 on CREATE EXTENSION, 42704 on gin_trgm_ops), then
 * asserts the documented end shape. Reintroduce the `(true)` spelling
 * (or any unapplyable statement anywhere in the chain) and this file
 * fails at the replay step — the promise the 0008/0013/0016/0017/0018
 * headers make is finally enforced by CI.
 */

interface JournalEntry {
  idx: number;
  tag: string;
}

/** Resolve a repo path relative to this test file (backend/src/jobs/__tests__). */
function repoPath(rel: string): string {
  return new URL(`../../../../${rel}`, import.meta.url).pathname;
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

/** A fresh, empty PGlite — NOT the shared harness client (which pre-carries the boot shape). */
const chainDb = new PGlite();

let trgmAvailable = false;
let appliedStatements = 0;
let skippedTrgmStatements = 0;
let journal: JournalEntry[] = [];

beforeAll(async () => {
  journal = await readJournal();

  // Mirror ensurePgTrgmExtension's degradation exactly: probe → attempt
  // CREATE EXTENSION → on environmental failure (anything but a read-only
  // window, which would re-throw) mark unavailable and skip every trgm
  // statement downstream. PGlite answers 0A000 here.
  try {
    await chainDb.exec("CREATE EXTENSION IF NOT EXISTS pg_trgm");
    trgmAvailable = true;
  } catch (err) {
    const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
    if (msg.includes("read-only transaction") || msg.includes("read-only mode")) {
      throw err;
    }
    trgmAvailable = false;
  }

  for (const entry of journal) {
    const fileSql = await readFile(repoPath(`shared/db/drizzle/${entry.tag}.sql`), "utf8");
    for (const stmt of parseStatements(fileSql)) {
      const isTrgmStatement = stmt.includes("pg_trgm") || stmt.includes("gin_trgm_ops");
      if (isTrgmStatement && !trgmAvailable) {
        skippedTrgmStatements += 1;
        continue;
      }
      // client.exec — the multi-statement-safe path (drizzle's prepared
      // query path 42601's on batches; see execTestSql in test/db.ts).
      await chainDb.exec(stmt);
      appliedStatements += 1;
    }
  }
}, 120_000);

async function scalar(query: string): Promise<number> {
  const res = await chainDb.query<{ c: string | number }>(query);
  return Number(res.rows[0]?.c ?? 0);
}

async function objectNames(kind: "table" | "index"): Promise<string[]> {
  const res = await chainDb.query<{ name: string }>(
    `SELECT ${kind === "table" ? "tablename" : "indexname"} AS name
       FROM pg_${kind === "table" ? "tables" : "indexes"}
      WHERE schemaname = 'public'
      ORDER BY name`,
  );
  return res.rows.map((r) => r.name);
}

describe("R143 (L9-2): the drizzle chain replays cleanly on a fresh database", () => {
  it("the journal is strictly sequential — the loop covered every file in order", () => {
    expect(journal.length).toBeGreaterThanOrEqual(24);
    expect(journal.map((e) => e.idx)).toEqual(journal.map((_, i) => i));
    expect(journal[0]!.tag).toMatch(/^0000_/);
  });

  it("the replay applied real statements (and degraded trgm exactly like the runtime)", () => {
    // Environmental degradation only: exactly the trgm statements are
    // skipped, everything else applied. If this count collapses, the loop
    // silently stopped applying files.
    expect(appliedStatements).toBeGreaterThan(300);
    expect(skippedTrgmStatements).toBeLessThanOrEqual(6);
    expect(trgmAvailable).toBe(false); // PGlite has no pg_trgm — pinned
  });

  it("L9-1 pin: the flash-sale singleton index actually exists after the replay", async () => {
    // The exact object whose unparenthesized `(true)` spelling killed the
    // chain at file 0003. If 0003 (or the 0024 reshape) regresses, either
    // the replay above threw, or this index is missing/misshapen.
    const indexes = await objectNames("index");
    expect(indexes).toContain("uniq_flash_sales_active_singleton");
    const def = await chainDb.query<{ def: string }>(
      `SELECT indexdef AS def FROM pg_indexes WHERE indexname = 'uniq_flash_sales_active_singleton'`,
    );
    expect(def.rows[0]!.def).toContain("((true))");
    expect(def.rows[0]!.def).toContain("is_active = true");
  });

  it("the documented end shape holds — every core + money table exists", async () => {
    const tables = new Set(await objectNames("table"));
    // Core + money surfaces (migrate.ts Stage A..C + the R142 copilot tables).
    for (const t of [
      "users",
      "sessions",
      "products",
      "product_variants",
      "inventory",
      "orders",
      "wallet_topups",
      "wallet_ledger",
      "points_ledger",
      "coupons",
      "flash_sales",
      "cart_items",
      "notifications",
      "support_tickets",
      "ticket_replies",
      "audit_logs",
      "idempotency_keys",
      "copilot_previews",
      "copilot_actions",
      "system_settings",
    ]) {
      expect(tables.has(t), `chain-built schema is missing table ${t}`).toBe(true);
    }
    // The L9 fresh-replay shape WITH the L9-1 fix applied: 41 tables /
    // 29 CHECKs / 39 FKs / 140 indexes — exactly the boot dry-run's shape
    // (L9's 138 was measured with the singleton statement failing; the
    // two pg_trgm GIN indexes are the one environmental delta vs real
    // Postgres, skipped exactly like ensurePgTrgmExtension degrades;
    // R165/V1-M35 raised 139 → 140 — chain 0026 carries
    // idx_orders_user_group).
    expect(tables.size).toBe(41);
    expect(await scalar("SELECT count(*) AS c FROM pg_constraint WHERE contype = 'c'")).toBe(29);
    expect(await scalar("SELECT count(*) AS c FROM pg_constraint WHERE contype = 'f'")).toBe(39);
    expect((await objectNames("index")).length).toBe(140);
  });

  it("the money guards the invariants depend on are all present", async () => {
    const indexes = new Set(await objectNames("index"));
    // M1/M2: idempotent topup approval.
    expect(indexes.has("uniq_wallet_topups_payment_reference")).toBe(true);
    // M7: points exactly-once reversal.
    expect(indexes.has("uniq_points_ledger_type_reference")).toBe(true);
    // M11: deterministic oldest-first claim pool.
    expect(indexes.has("idx_inventory_product_sold")).toBe(true);

    const checks = await chainDb.query<{ conname: string; table_name: string }>(
      `SELECT conname, rel.relname AS table_name
         FROM pg_constraint con
         JOIN pg_class rel ON rel.oid = con.conrelid
        WHERE con.contype = 'c' AND con.conname LIKE 'chk_%'`,
    );
    const byName = new Map(checks.rows.map((r) => [r.conname, r.table_name]));
    // M9/M15 spot pins — the CHECK battery the wallet suites rely on.
    expect(byName.get("chk_users_wallet_balance_nonneg")).toBe("users");
    expect(byName.get("chk_ledger_amount_nonzero")).toBe("wallet_ledger");
    expect(byName.get("chk_topups_amount_pos")).toBe("wallet_topups");
    expect(byName.get("chk_points_ledger_arithmetic")).toBe("points_ledger");
  });
});
