import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { db, initTestDb, resetTestDb, ordersTable, productsTable, usersTable } from "../../test/db";
import { applyIdempotencyDropOrderFkStage } from "../../migrate";

/**
 * r110 (109-q P1 / 109-e double-drop guard) — the regenerated drizzle
 * migration 0013 (idempotency_keys FK drop, following 39bedf4's schema
 * change) is DECLARATIVE-ONLY: nothing in the repo executes
 * shared/db/drizzle/*.sql at runtime (prod schema flows exclusively
 * through migrate.ts — V1-M20 performs the same drop live-safe, by any
 * constraint name), and CI only regenerates + diffs. These tests are the
 * belt for the day the chain IS applied (manual `drizzle-kit migrate`,
 * a fresh chain-built environment, or a future wiring):
 *
 *   - the journal actually carries entry 0013 after 0012 (the drift
 *     gate was RED at HEAD because the chain never followed 39bedf4);
 *   - 0013 is exactly ONE statement: DROP CONSTRAINT IF EXISTS of the
 *     0007-era FK name — the IF EXISTS is a hand hardening (r110) so
 *     the file cannot 42704 on a runtime-built database where V1-M20
 *     already dropped the FK (under the PG auto-name
 *     idempotency_keys_order_id_fkey, which drizzle's
 *     idempotency_keys_order_id_orders_id_fk never matches);
 *   - executing 0013 twice on a chain-built shape is a no-op the second
 *     time (chain idempotency);
 *   - executing 0013 on the RUNTIME shape AFTER V1-M20 succeeds (the
 *     pre-hardening file would raise SQLSTATE 42704 here);
 *   - chain and runtime stage COMMUTE: 0013 first (no-op, IF EXISTS) →
 *     V1-M20 drops the auto-named FK → same FK-free end state.
 */

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

/** Fresh runtime-shaped (V1-M12) idempotency_keys with the PG auto-name FK. */
async function createRuntimeShapedTable(): Promise<void> {
  await db.execute(
    sql.raw(`
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      key        TEXT PRIMARY KEY,
      order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `),
  );
}

/**
 * Chain-built shape: a bare order_id column + the 0007-era constraint under
 * the DRIZZLE name (what applying 0000→0012 in order produces — 0007's
 * CREATE TABLE has no inline FK; its ALTER adds the named constraint).
 */
async function createChainShapedTable(): Promise<void> {
  await db.execute(
    sql.raw(`
    CREATE TABLE idempotency_keys (
      key        TEXT PRIMARY KEY,
      order_id   INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `),
  );
  await db.execute(
    sql.raw(`
    ALTER TABLE idempotency_keys
      ADD CONSTRAINT idempotency_keys_order_id_orders_id_fk
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
  `),
  );
}

async function fkCountOnIdempotencyKeys(): Promise<number> {
  const result = await db.execute(sql`
    SELECT count(*) AS c FROM pg_constraint
    WHERE contype = 'f' AND conrelid = 'idempotency_keys'::regclass
  `);
  const rows = (result as unknown as { rows?: Array<{ c: number | string }> }).rows ?? [];
  return Number(rows[0]?.c ?? 0);
}

async function fkExistsByName(name: string): Promise<boolean> {
  const result = await db.execute(
    sql`SELECT 1 AS one FROM pg_constraint WHERE conname = ${name} AND contype = 'f'`,
  );
  const rows = (result as unknown as { rows?: unknown[] }).rows ?? [];
  return rows.length > 0;
}

let journal0013Tag = "";
let statements0013: string[] = [];

beforeAll(async () => {
  await initTestDb();
  const entries = await readJournal();
  const entry13 = entries.find((e) => e.idx === 13);
  expect(entry13).toBeDefined();
  journal0013Tag = entry13!.tag;
  statements0013 = parseStatements(
    await readFile(repoPath(`shared/db/drizzle/${journal0013Tag}.sql`), "utf8"),
  );
}, 60_000);

beforeEach(async () => {
  await resetTestDb();
  await db.execute(sql.raw("DROP TABLE IF EXISTS idempotency_keys"));
});

/** Minimal order row so the runtime FK has a valid referent. */
async function seedOrder(): Promise<void> {
  await db.insert(usersTable).values({ id: 1, phone: "09100000001", walletBalance: "100.00" });
  const [product] = await db
    .insert(productsTable)
    .values({ name: "0013 chain probe product", price: "5.00" })
    .returning({ id: productsTable.id });
  await db.insert(ordersTable).values({
    orderCode: "SN-0013-PROBE",
    userId: 1,
    productId: product.id,
    amount: "5.00",
    walletBalanceBefore: "100.00",
    walletBalanceAfter: "95.00",
    status: "completed",
  });
}

describe("r110: the drizzle chain follows 39bedf4 (journal + 0013 content)", () => {
  it("the journal carries 0012 → 0013 in order (the drift-gate closure 109-q flagged)", async () => {
    const entries = await readJournal();
    const idx12 = entries.findIndex((e) => e.idx === 12);
    const idx13 = entries.findIndex((e) => e.idx === 13);
    expect(idx12).toBeGreaterThanOrEqual(0);
    expect(idx13).toBe(idx12 + 1);
    expect(journal0013Tag).toMatch(/^0013_/);
  });

  it("0013 is exactly one DROP CONSTRAINT IF EXISTS of the 0007-era FK name", () => {
    // THE hardening pin: drizzle-kit emits a plain DROP CONSTRAINT (no
    // IF EXISTS — see 0008's DROP INDEX). The hand-added IF EXISTS is
    // what keeps 0013 safe on runtime-built databases (V1-M20 already
    // dropped the FK there under a different name).
    expect(statements0013).toHaveLength(1);
    expect(statements0013[0]).toBe(
      'ALTER TABLE "idempotency_keys" DROP CONSTRAINT IF EXISTS "idempotency_keys_order_id_orders_id_fk";',
    );
  });
});

describe("r110: 0013 executes idempotently on a chain-built database", () => {
  it("drops the 0007-era FK, and a second application is a clean no-op", async () => {
    await createChainShapedTable();
    expect(await fkExistsByName("idempotency_keys_order_id_orders_id_fk")).toBe(true);

    await applyChain(statements0013); // first application: drops the FK
    expect(await fkCountOnIdempotencyKeys()).toBe(0);

    await applyChain(statements0013); // second application: no-op, no error
    expect(await fkCountOnIdempotencyKeys()).toBe(0);
  });
});

describe("r110: 0013 is safe on the RUNTIME shape (V1-M20 already ran)", () => {
  it("after V1-M20's by-any-name drop, 0013 no-ops instead of raising 42704", async () => {
    await seedOrder();
    await createRuntimeShapedTable();
    // The live shape: V1-M12's inline REFERENCES creates the PG auto-name
    // `idempotency_keys_order_id_fkey`, which V1-M20 then drops by any name.
    expect(await fkExistsByName("idempotency_keys_order_id_fkey")).toBe(true);
    await applyIdempotencyDropOrderFkStage();
    expect(await fkCountOnIdempotencyKeys()).toBe(0);

    // Pre-hardening this raised "constraint ... does not exist" (42704):
    // the drizzle name never existed on a runtime-built database.
    await expect(applyChain(statements0013)).resolves.toBeUndefined();
    expect(await fkCountOnIdempotencyKeys()).toBe(0);
  });

  it("chain and runtime stage commute: 0013 first (no-op), then V1-M20 — FK-free end state", async () => {
    await seedOrder();
    await createRuntimeShapedTable();
    expect(await fkExistsByName("idempotency_keys_order_id_fkey")).toBe(true);

    // 0013 applied BEFORE V1-M20 on the runtime shape: the drizzle-named
    // constraint does not exist → IF EXISTS no-op → the auto-named FK
    // SURVIVES until V1-M20 removes it. Either order converges.
    await applyChain(statements0013);
    expect(await fkExistsByName("idempotency_keys_order_id_fkey")).toBe(true);

    await applyIdempotencyDropOrderFkStage();
    expect(await fkCountOnIdempotencyKeys()).toBe(0);
  });
});
