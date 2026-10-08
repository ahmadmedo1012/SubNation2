import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { readFile } from "node:fs/promises";
import { sql, type SQL } from "drizzle-orm";
import { db, initTestDb, resetTestDb } from "../../test/db";
import { applyIndexConsolidationStage } from "../../migrate";

/**
 * R123-E5 (R123-A7 P2) — V1-M27: serving-index consolidation.
 *
 * The pglite harness carries the POST-V1-M27 shape (the three composites
 * present, the sixteen redundant twins absent — parity with the post-boot
 * live DB), so the default run certifies the zero-drop steady state, and
 * the legacy-shape tests restore the pre-V1-M27 twins BY HAND (raw SQL,
 * never the stage under test — the v1m25 pristine-state pattern). Four of
 * the sixteen span tables the shared harness DDL does not carry
 * (risk_rules / risk_events / inventory_forecasts / idempotency_keys);
 * they are provisioned locally per-file (the retention-batching/
 * auth-activity convention). The drizzle 0019 mirror rides along like
 * 0018 did in migrate-v1m25.test.ts.
 */

/** Resolve a repo path relative to this test file (backend/src/jobs/__tests__). */
function repoPath(rel: string): string {
  return new URL(`../../../../${rel}`, import.meta.url).pathname;
}

// The stage's own target list, mirrored for the legacy-state restore.
const REDUNDANT_INDEXES = [
  // Tables present in the shared harness DDL.
  { table: "orders", name: "idx_orders_user", columns: "(user_id)" },
  { table: "orders", name: "idx_orders_status", columns: "(status)" },
  { table: "wallet_ledger", name: "idx_wallet_ledger_user", columns: "(user_id)" },
  { table: "points_ledger", name: "idx_points_ledger_user", columns: "(user_id)" },
  { table: "wallet_topups", name: "idx_topups_status", columns: "(status)" },
  { table: "wallet_topups", name: "idx_topups_user", columns: "(user_id)" },
  { table: "products", name: "idx_products_active", columns: "(is_active)" },
  { table: "products", name: "idx_products_archived", columns: "(is_archived)" },
  { table: "product_variants", name: "idx_product_variants_product", columns: "(product_id)" },
  { table: "cart_items", name: "idx_cart_items_user", columns: "(user_id)" },
  { table: "referral_events", name: "idx_referral_referrer", columns: "(referrer_id)" },
  { table: "support_tickets", name: "idx_tickets_user", columns: "(user_id)" },
  // Tables provisioned per-file below.
  { table: "risk_rules", name: "idx_risk_rules_name", columns: "(name)" },
  { table: "risk_events", name: "idx_risk_events_created", columns: "(created_at)" },
  {
    table: "inventory_forecasts",
    name: "idx_forecasts_product_date",
    columns: "(product_id, forecast_date DESC)",
  },
  { table: "idempotency_keys", name: "idx_idempotency_keys_order", columns: "(order_id)" },
] as const;

// The three composites the stage creates.
const COMPOSITE_INDEXES: Array<{ table: string; name: string; columns: string }> = [
  {
    table: "wallet_topups",
    name: "idx_topups_user_created",
    columns: "(user_id, created_at DESC)",
  },
  {
    table: "referral_events",
    name: "idx_referral_referrer_created",
    columns: "(referrer_id, created_at DESC)",
  },
  { table: "support_tickets", name: "idx_tickets_user_created", columns: "(user_id, created_at DESC)" },
];

interface Recorded {
  statements: string[];
  execute: (query: SQL) => Promise<unknown>;
}

/** Recording executor (same chunk-walking as migrate-v1m25). */
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

async function indexExists(name: string): Promise<boolean> {
  const result = await db.execute(
    sql`SELECT 1 AS one FROM pg_indexes WHERE indexname = ${name}`,
  );
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

/** The per-file tables for the index targets not in the shared DDL (plus
 *  the 0019 dry-run's CHECK targets: enrichment_runs /
 *  inventory_forecast_runs / the score+confidence columns on risk_events). */
const PER_FILE_DDL = [
  `CREATE TABLE IF NOT EXISTS risk_rules (
    id serial PRIMARY KEY,
    name varchar(100) NOT NULL UNIQUE,
    enabled boolean NOT NULL DEFAULT true
  )`,
  `CREATE TABLE IF NOT EXISTS risk_events (
    id serial PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now(),
    score integer NOT NULL,
    confidence numeric(4,3) NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS inventory_forecasts (
    id serial PRIMARY KEY,
    product_id integer NOT NULL,
    forecast_date date NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS idempotency_keys (
    key text PRIMARY KEY,
    order_id integer,
    reference_type varchar(32) NOT NULL DEFAULT 'order',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  // The 0019 mirror dry-run below also ADDs chk_enrichment_runs_outcome /
  // chk_forecast_runs_outcome — those tables are not in the shared harness
  // DDL either (the migrate-v1m29 sibling provisions them the same way).
  `CREATE TABLE IF NOT EXISTS enrichment_runs (
    id serial PRIMARY KEY,
    outcome varchar(20) NOT NULL DEFAULT 'in_flight'
  )`,
  `CREATE TABLE IF NOT EXISTS inventory_forecast_runs (
    id serial PRIMARY KEY,
    outcome varchar(20) NOT NULL DEFAULT 'in_flight'
  )`,
];

const PER_FILE_TABLES = [
  "risk_rules",
  "risk_events",
  "inventory_forecasts",
  "idempotency_keys",
  "enrichment_runs",
  "inventory_forecast_runs",
];

beforeAll(async () => {
  await initTestDb();
  // Explicit hook timeout — the 2-CPU full-suite contention rationale
  // (migrate-v1m9.test.ts).
}, 60_000);

beforeEach(async () => {
  await resetTestDb();
  // (Re-)provision the per-file tables (drop first so a legacy-shape test
  // from the previous case cannot leak its indexes forward; one statement
  // per execute — pglite rejects multi-command prepared statements).
  for (const table of PER_FILE_TABLES) {
    await db.execute(sql.raw(`DROP TABLE IF EXISTS ${table} CASCADE`));
  }
  for (const stmt of PER_FILE_DDL) {
    await db.execute(sql.raw(stmt));
  }
});

describe("V1-M27 — applyIndexConsolidationStage (R123-A7 P2)", () => {
  it("steady state: composites present, twins absent → probe answers nothing to drop (ZERO DROP DDL)", async () => {
    // The harness boots in the post-V1-M27 shape — exactly every steady-
    // state boot after the first post-R123 deploy.
    for (const { name } of COMPOSITE_INDEXES) {
      expect(await indexExists(name)).toBe(true);
    }
    for (const { name } of REDUNDANT_INDEXES) {
      expect(await indexExists(name)).toBe(false);
    }

    const rec = recorder();
    await applyIndexConsolidationStage(rec.execute);

    // THE regression pin: the probe found none of the 16 → no DROP at all.
    // (The 3 composites re-assert with CREATE INDEX IF NOT EXISTS — the
    // V1-M24 unconditional additive-twin form — which is a no-op here.)
    expect(rec.statements.filter((s) => /DROP\s+INDEX/i.test(s))).toHaveLength(0);
  });

  it("legacy shape (the pre-R123 live DB): all sixteen twins dropped, composites ensured", async () => {
    // Recreate every redundant twin by hand (raw SQL — never the stage).
    for (const { table, name, columns } of REDUNDANT_INDEXES) {
      await db.execute(sql.raw(`CREATE INDEX ${name} ON ${table} ${columns}`));
      expect(await indexExists(name)).toBe(true);
    }

    await applyIndexConsolidationStage();

    for (const { name } of REDUNDANT_INDEXES) {
      expect(await indexExists(name)).toBe(false);
    }
    for (const { name } of COMPOSITE_INDEXES) {
      expect(await indexExists(name)).toBe(true);
    }

    // Re-run with a recorder: pure no-op (the forever-boot contract —
    // probe-gated drops send nothing once converged).
    const rec = recorder();
    await applyIndexConsolidationStage(rec.execute);
    expect(rec.statements.filter((s) => /DROP\s+INDEX/i.test(s))).toHaveLength(0);
  });

  it("the composites carry the (x_id, created_at DESC) serving shape", async () => {
    await applyIndexConsolidationStage();
    // pg renders DESC explicitly in indexdef — pin the sort direction the
    // user-history queries (wallet.ts / loyalty.ts / support.ts) rely on.
    expect(await indexDef("idx_topups_user_created")).toContain("user_id, created_at DESC");
    expect(await indexDef("idx_referral_referrer_created")).toContain(
      "referrer_id, created_at DESC",
    );
    expect(await indexDef("idx_tickets_user_created")).toContain("user_id, created_at DESC");
  });

  it("a partial legacy set converges too (probe drops only what is present)", async () => {
    // Only three of the sixteen exist — the probe must find exactly those.
    for (const name of ["idx_orders_user", "idx_products_archived", "idx_risk_rules_name"]) {
      const target = REDUNDANT_INDEXES.find((r) => r.name === name)!;
      await db.execute(sql.raw(`CREATE INDEX ${name} ON ${target.table} ${target.columns}`));
    }

    await applyIndexConsolidationStage();

    for (const name of ["idx_orders_user", "idx_products_archived", "idx_risk_rules_name"]) {
      expect(await indexExists(name)).toBe(false);
    }
  });
});

describe("R123 — the drizzle 0019 mirror (chain follows the schema)", () => {
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

  it("the journal carries 0018 → 0019 in order", async () => {
    const raw = JSON.parse(
      await readFile(repoPath("shared/db/drizzle/meta/_journal.json"), "utf8"),
    );
    const entries = raw.entries as JournalEntry[];
    const idx18 = entries.findIndex((e) => e.idx === 18);
    const idx19 = entries.findIndex((e) => e.idx === 19);
    expect(idx18).toBeGreaterThanOrEqual(0);
    expect(idx19).toBe(idx18 + 1);
    expect(entries[idx19].tag).toMatch(/^0019_/);
  });

  it("0019 declares the V1-M27..M30 objects, hardened (r110/0018 idiom)", async () => {
    const statements = parseStatements(
      await readFile(repoPath("shared/db/drizzle/0019_sturdy_omega_red.sql"), "utf8"),
    );
    const all = statements.join("\n");
    // The sixteen drops.
    for (const { name } of REDUNDANT_INDEXES) {
      expect(all).toContain(`DROP INDEX IF EXISTS "${name}"`);
    }
    // The three composites.
    for (const { name } of COMPOSITE_INDEXES) {
      expect(all).toContain(`CREATE INDEX IF NOT EXISTS "${name}"`);
    }
    // The referral FK rebuilds under the BOOT names + both-worlds drops.
    expect(all).toContain('"fk_referral_referrer"');
    expect(all).toContain('"fk_referral_referee"');
    expect(all).toContain("ON DELETE restrict");
    // The organizations removal.
    expect(all).toContain('DROP COLUMN IF EXISTS "organization_id"');
    expect(all).toContain('DROP TABLE IF EXISTS "organizations"');
    // Hardening: every DROP carries IF EXISTS; every ADD CONSTRAINT is
    // the duplicate_object-swallowing DO block.
    for (const stmt of statements) {
      if (/^DROP (INDEX|TABLE)/i.test(stmt) || stmt.includes("DROP CONSTRAINT")) {
        expect(stmt).toContain("IF EXISTS");
      }
      if (stmt.includes("ADD CONSTRAINT")) {
        expect(stmt.startsWith("DO $$")).toBe(true);
        expect(stmt).toContain("EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;");
      }
    }
  });

  it("0019 executes cleanly + idempotently on the runtime shape (live-boot dry-run)", async () => {
    const statements = parseStatements(
      await readFile(repoPath("shared/db/drizzle/0019_sturdy_omega_red.sql"), "utf8"),
    );
    const applyChain = async () => {
      for (const stmt of statements) {
        await db.execute(sql.raw(stmt));
      }
    };
    await applyChain(); // live-boot simulation
    await applyChain(); // second application: clean no-op

    // The runtime shape after the chain: composites present, twins gone,
    // referral FKs RESTRICT under the boot names.
    for (const { name } of COMPOSITE_INDEXES) {
      expect(await indexExists(name)).toBe(true);
    }
    for (const { name } of REDUNDANT_INDEXES) {
      expect(await indexExists(name)).toBe(false);
    }
    for (const fk of ["fk_referral_referrer", "fk_referral_referee"]) {
      const result = await db.execute(
        sql`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ${fk}`,
      );
      const rows = (result as unknown as { rows?: Array<{ def: string }> }).rows ?? [];
      expect(rows[0]?.def).toContain("ON DELETE RESTRICT");
    }
  });
});
