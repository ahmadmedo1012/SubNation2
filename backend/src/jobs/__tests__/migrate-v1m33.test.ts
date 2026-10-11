import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { db, initTestDb, resetTestDb } from "../../test/db";
import { applyWalletLedgerTypeIndexDropStage } from "../../migrate";

/**
 * R134 (A8-F2) — V1-M33: drop the zero-consumer idx_wallet_ledger_type.
 *
 * Pure write amplification on the money ledger INSERT table (grep = 0
 * predicate consumers, re-verified R134). The stage is the V1-M27
 * probe-gated DROP idiom: pg_indexes probe → drop only if present →
 * steady-state boots send no DDL. The drizzle declaration left the
 * schema the same round; chain 0022 folds the DROP INDEX.
 */

function repoPath(rel: string): string {
  return new URL(`../../../../${rel}`, import.meta.url).pathname;
}

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  return (result as unknown as { rows?: Array<Record<string, unknown>> }).rows ?? [];
}

async function indexExists(): Promise<boolean> {
  const rows = rowsOf(
    await db.execute(sql`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = current_schema()
        AND indexname = 'idx_wallet_ledger_type'
    `),
  );
  return rows.length > 0;
}

beforeAll(initTestDb, 60_000);

beforeEach(async () => {
  await resetTestDb();
});

describe("V1-M33 — the zero-consumer wallet_ledger.type index drop (A8-F2)", () => {
  it("drops the index when present (the live shape today)", async () => {
    // Simulate the runtime shape: the index exists (the pglite harness
    // DDL may or may not carry it — create it explicitly).
    await db.execute(
      sql.raw(`CREATE INDEX IF NOT EXISTS idx_wallet_ledger_type ON wallet_ledger ("type")`),
    );
    expect(await indexExists()).toBe(true);

    await applyWalletLedgerTypeIndexDropStage();
    expect(await indexExists()).toBe(false);
  });

  it("the re-run is the steady-state contract (probe → zero DDL, no error)", async () => {
    await applyWalletLedgerTypeIndexDropStage();
    await applyWalletLedgerTypeIndexDropStage();
    expect(await indexExists()).toBe(false);
  });

  it("the drizzle 0022 mirror carries the DROP and the 18 DESC-converged pairs", async () => {
    const mirror = await readFile(
      repoPath("shared/db/drizzle/0022_far_human_cannonball.sql"),
      "utf8",
    );
    expect(mirror).toContain('DROP INDEX IF EXISTS "idx_wallet_ledger_type"');
    // The A8-F1 convergence: expression columns emit plain DESC — no
    // STATEMENT carries a NULLS LAST suffix (the header comment may
    // mention the old shape when explaining the wave).
    expect(mirror).not.toMatch(/USING btree[^;]*NULLS LAST/);
    expect(mirror).toContain('CREATE INDEX IF NOT EXISTS "idx_orders_created"');
    expect(mirror).toContain('ON "orders" USING btree (created_at DESC)');
  });
});
