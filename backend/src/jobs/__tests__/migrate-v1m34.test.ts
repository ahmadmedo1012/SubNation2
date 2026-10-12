import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { readFile } from "node:fs/promises";
import { sql, type SQL } from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { db, initTestDb, resetTestDb } from "../../test/db";
import { couponsTable, ordersTable, walletLedgerTable } from "@workspace/db/schema";
import { applyR135IndexWaveStage } from "../../migrate";

/**
 * R135 (DB-1) — V1-M34: the R135 serving-index wave.
 *
 *   (a)  idx_coupons_expires_at — additive PARTIAL (expires_at IS NOT
 *        NULL) for the couponWatcher expiry scans (jobs/couponWatcher.ts
 *        filters that arm on BOTH the auto-disable UPDATE and the 24h
 *        warning SELECT). The V1-M31 unconditional IF NOT EXISTS form.
 *   (b)  idx_wallet_ledger_user_created — same-name swap
 *        (user_id, created_at) → (user_id, created_at DESC, id DESC):
 *        the wallet statement's ORDER BY created_at DESC, id DESC tail
 *        (routes/wallet.ts). The V1-M24 probe-gated rebuild idiom.
 *   (c)  idx_orders_user_created — same swap for the user orders list
 *        (routes/orders.ts), keyset-ready the risk_events way.
 *
 * The pglite harness carries NONE of the three objects (its DDL never
 * declared them), so the default run certifies the absent-index path
 * (additive partial created, zero swap DDL — the base round-4 block owns
 * fresh-install creation), the legacy-shape tests restore the round-4
 * (user_id, created_at) twins by hand (the users-ddl pristine-state
 * pattern: raw SQL, never the stage under test), and the re-run pins the
 * forever-boot no-op contract.
 */

/** Resolve a repo path relative to this test file (backend/src/jobs/__tests__). */
function repoPath(rel: string): string {
  return new URL(`../../../../${rel}`, import.meta.url).pathname;
}

interface Recorded {
  statements: string[];
  execute: (query: SQL) => Promise<unknown>;
}

/** Recording executor (same chunk-walking as migrate-users-ddl / v1m24). */
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

/** DDL-class statements touching the two swapped index names. */
const DDL_ON_SWAPS =
  /DROP\s+INDEX.*idx_(wallet_ledger|orders)_user_created|CREATE\s+(UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+idx_(wallet_ledger|orders)_user_created/i;

const SWAPS: Array<{ name: string; table: string }> = [
  { name: "idx_wallet_ledger_user_created", table: "wallet_ledger" },
  { name: "idx_orders_user_created", table: "orders" },
];

async function indexDef(name: string): Promise<string | undefined> {
  const result = await db.execute(
    sql`SELECT indexdef AS def FROM pg_indexes WHERE indexname = ${name}`,
  );
  const rows = (result as unknown as { rows?: Array<{ def: string }> }).rows ?? [];
  return rows[0]?.def;
}

/** Restore the round-4 legacy twins by hand (pristine-state pattern). */
async function restoreLegacySwaps(): Promise<void> {
  // Drop first — the same-name swap means the index may exist in either
  // shape when this runs (the mid-history re-convergence case).
  await db.execute(sql.raw(`DROP INDEX IF EXISTS idx_wallet_ledger_user_created`));
  await db.execute(sql.raw(`DROP INDEX IF EXISTS idx_orders_user_created`));
  await db.execute(
    sql.raw(`CREATE INDEX idx_wallet_ledger_user_created ON wallet_ledger (user_id, created_at)`),
  );
  await db.execute(
    sql.raw(`CREATE INDEX idx_orders_user_created ON orders (user_id, created_at)`),
  );
}

beforeAll(initTestDb, 60_000);

beforeEach(async () => {
  await resetTestDb();
  // Pristine state: the harness DDL carries none of the three objects —
  // drop any index a previous case created so every test starts absent.
  for (const name of [
    "idx_coupons_expires_at",
    ...SWAPS.map((s) => s.name),
  ]) {
    await db.execute(sql.raw(`DROP INDEX IF EXISTS ${name}`));
  }
});

describe("V1-M34 — applyR135IndexWaveStage (R135, DB-1)", () => {
  it("legacy (user_id, created_at) shape: probe-gated swap → (user_id, created_at DESC, id DESC)", async () => {
    await restoreLegacySwaps();
    for (const { name } of SWAPS) {
      expect(await indexDef(name)).toContain("(user_id, created_at)");
    }

    await applyR135IndexWaveStage();

    for (const { name } of SWAPS) {
      const def = await indexDef(name);
      expect(def, `indexdef of ${name}`).toContain("USING btree (user_id, created_at DESC, id DESC)");
      expect(def).not.toContain("(user_id, created_at)");
    }
  });

  it("the additive coupons partial is created with the watcher's predicate", async () => {
    expect(await indexDef("idx_coupons_expires_at")).toBeUndefined();

    await applyR135IndexWaveStage();

    const def = await indexDef("idx_coupons_expires_at");
    expect(def).toContain("ON public.coupons");
    // The partial predicate verbatim (pg wraps it in parens) — both
    // couponWatcher arms filter expires_at IS NOT NULL.
    expect(def).toContain("WHERE (expires_at IS NOT NULL)");
    expect(def).toContain("USING btree (expires_at)");
  });

  it("absent swap targets (fresh-install post-base-block shape) → ZERO swap DDL", async () => {
    // The harness carries neither swap target: the probe answers ""
    // → no DROP/CREATE may be sent on either name (the base round-4
    // block owns fresh-install creation; a swap here would be churn).
    const rec = recorder();
    await applyR135IndexWaveStage(rec.execute);

    expect(rec.statements.filter((s) => DDL_ON_SWAPS.test(s))).toHaveLength(0);
    expect(await indexDef("idx_wallet_ledger_user_created")).toBeUndefined();
    expect(await indexDef("idx_orders_user_created")).toBeUndefined();
  });

  it("steady state (keyset shapes present): the probe answers 'converged' → ZERO swap DDL", async () => {
    await restoreLegacySwaps();
    await applyR135IndexWaveStage(); // converge once
    const defsBefore = [];
    for (const { name } of SWAPS) defsBefore.push(await indexDef(name));

    const rec = recorder();
    await applyR135IndexWaveStage(rec.execute);

    // THE regression pin: a naive unconditional DROP+CREATE would rebuild
    // both money-history indexes on EVERY cold start.
    expect(rec.statements.filter((s) => DDL_ON_SWAPS.test(s))).toHaveLength(0);
    const defsAfter = [];
    for (const { name } of SWAPS) defsAfter.push(await indexDef(name));
    expect(defsAfter).toEqual(defsBefore);
  });

  it("re-running the stage is a clean no-op (the forever-boot contract)", async () => {
    await restoreLegacySwaps();
    await applyR135IndexWaveStage();
    const defsAfterFirst = [];
    for (const name of ["idx_coupons_expires_at", ...SWAPS.map((s) => s.name)]) {
      defsAfterFirst.push(await indexDef(name));
    }

    // Simulate the legacy shape again mid-history: the second run must
    // converge it back exactly like the first (idempotent swap).
    await restoreLegacySwaps();
    await applyR135IndexWaveStage();
    await applyR135IndexWaveStage();

    const defsAfter = [];
    for (const name of ["idx_coupons_expires_at", ...SWAPS.map((s) => s.name)]) {
      defsAfter.push(await indexDef(name));
    }
    expect(defsAfter).toEqual(defsAfterFirst);
  });
});

describe("R135 — the drizzle 0023 mirror (chain follows the schema)", () => {
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

  /**
   * Column spellings an index is declared on. R134 (A8-F1): the DESC-wave
   * convention makes the sort column a raw sql`col DESC` expression — an
   * SQL object whose queryChunks are (StringChunk(["col DESC"])). Both
   * spellings are surfaced: plain columns as their name, expressions as
   * their emitted text ("created_at DESC" — the boot twins' bytes).
   */
  function indexColumns(index: { config: { columns: unknown[] } }): string[] {
    return index.config.columns.map((c) => {
      const col = c as { name?: string; queryChunks?: Array<{ value?: string }> };
      if (col.name !== undefined) return String(col.name);
      if (Array.isArray(col.queryChunks)) {
        return col.queryChunks.map((ch) => ch?.value ?? String(ch)).join("");
      }
      return "unknown";
    });
  }

  /** Render a drizzle sql`` template (the partial predicate) to text. */
  function sqlText(chunk: SQL | undefined): string {
    if (!chunk) return "";
    const chunks = (chunk as unknown as { queryChunks?: Array<{ value: unknown }> }).queryChunks;
    return String(chunks?.map((c) => (Array.isArray(c.value) ? c.value.join("") : c.value)).join(""));
  }

  async function statements(): Promise<string[]> {
    return parseStatements(
      await readFile(repoPath("shared/db/drizzle/0023_conscious_wrecking_crew.sql"), "utf8"),
    );
  }

  it("the journal carries 0022 → 0023 in order", async () => {
    const raw = JSON.parse(
      await readFile(repoPath("shared/db/drizzle/meta/_journal.json"), "utf8"),
    );
    const entries = raw.entries as JournalEntry[];
    const idx22 = entries.findIndex((e) => e.idx === 22);
    const idx23 = entries.findIndex((e) => e.idx === 23);
    expect(idx22).toBeGreaterThanOrEqual(0);
    expect(idx23).toBe(idx22 + 1);
    expect(entries[idx23].tag).toMatch(/^0023_/);
  });

  it("0023 declares exactly the three R135 objects, hardened (r110 idiom)", async () => {
    const stmts = await statements();
    // Nothing smuggled in: two drops + three creates, nothing else.
    expect(stmts).toHaveLength(5);
    for (const stmt of stmts) {
      if (stmt.includes("DROP INDEX")) expect(stmt).toContain("IF EXISTS");
      if (stmt.includes("CREATE INDEX")) expect(stmt).toContain("IF NOT EXISTS");
    }
    const all = stmts.join("\n");
    expect(all).toContain(
      'CREATE INDEX IF NOT EXISTS "idx_coupons_expires_at" ON "coupons" USING btree ("expires_at") WHERE expires_at IS NOT NULL;',
    );
    // Plain DESC — the A8-F1 convention (no NULLS LAST divergence from
    // the boot twins; .desc() would re-create the 0022-closed gap).
    expect(all).toContain(
      'CREATE INDEX IF NOT EXISTS "idx_orders_user_created" ON "orders" USING btree ("user_id",created_at DESC,id DESC);',
    );
    expect(all).toContain(
      'CREATE INDEX IF NOT EXISTS "idx_wallet_ledger_user_created" ON "wallet_ledger" USING btree ("user_id",created_at DESC,id DESC);',
    );
    expect(all).not.toMatch(/NULLS LAST/);
    // Deliberately NOT CONCURRENTLY (the V1-M31 decision class).
    expect(all).not.toContain("CONCURRENTLY");
  });

  it("0023 executes cleanly + idempotently on the runtime shape (live-boot dry-run)", async () => {
    const stmts = await statements();
    const applyChain = async () => {
      for (const stmt of stmts) {
        await db.execute(sql.raw(stmt));
      }
    };
    await applyChain(); // live-boot simulation (chain-built fresh env)
    await applyChain(); // second application: clean no-op

    expect(await indexDef("idx_coupons_expires_at")).toContain("expires_at");
    expect(await indexDef("idx_orders_user_created")).toContain(
      "USING btree (user_id, created_at DESC, id DESC)",
    );
    expect(await indexDef("idx_wallet_ledger_user_created")).toContain(
      "USING btree (user_id, created_at DESC, id DESC)",
    );

    // The runtime stage on top of the chain shape is a no-op (same
    // objects — the chain and the boot twin agree on the bytes).
    await applyR135IndexWaveStage();
    expect(await indexDef("idx_orders_user_created")).toContain(
      "USING btree (user_id, created_at DESC, id DESC)",
    );
    expect(await indexDef("idx_wallet_ledger_user_created")).toContain(
      "USING btree (user_id, created_at DESC, id DESC)",
    );
    expect(await indexDef("idx_coupons_expires_at")).toContain("WHERE (expires_at IS NOT NULL)");
  });

  it("the TS schema declares all three indexes (compile-level mirror)", () => {
    const ledgerIdx = getTableConfig(walletLedgerTable as unknown as PgTable).indexes.find(
      (i) => i.config.name === "idx_wallet_ledger_user_created",
    );
    expect(ledgerIdx).toBeDefined();
    expect(ledgerIdx!.config.unique).toBe(false);
    expect(indexColumns(ledgerIdx!)).toEqual(["user_id", "created_at DESC", "id DESC"]);

    const ordersIdx = getTableConfig(ordersTable as unknown as PgTable).indexes.find(
      (i) => i.config.name === "idx_orders_user_created",
    );
    expect(ordersIdx).toBeDefined();
    expect(ordersIdx!.config.unique).toBe(false);
    expect(indexColumns(ordersIdx!)).toEqual(["user_id", "created_at DESC", "id DESC"]);

    const couponsIdx = getTableConfig(couponsTable as unknown as PgTable).indexes.find(
      (i) => i.config.name === "idx_coupons_expires_at",
    );
    expect(couponsIdx).toBeDefined();
    expect(couponsIdx!.config.unique).toBe(false);
    expect(indexColumns(couponsIdx!)).toEqual(["expires_at"]);
    // Partial predicate verbatim from the boot SQL (V1-M34 stage).
    expect(sqlText(couponsIdx!.config.where)).toBe("expires_at IS NOT NULL");
  });
});
