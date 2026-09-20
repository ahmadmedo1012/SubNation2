import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { db, initTestDb, resetTestDb, productsTable, productVariantsTable } from "../../test/db";
import { applyProductVariantsNullsNotDistinctStage } from "../../migrate";

/**
 * V1-M17 (round-98 F4, R98-DB-05) — uniq_product_variants_plan_duration
 * NULLS NOT DISTINCT rebuild.
 *
 * V1-M16 created the unique index WITHOUT nulls-distinctness, so PG's
 * NULLs-are-distinct btree semantics let two concurrent creates of
 * (product, 'Family', NULL) both insert. The live DB was verified to
 * carry ZERO exact duplicates (round-98 main agent), making the
 * DROP + CREATE rebuild data-safe.
 *
 * The harness DDL (test/db.ts) ships the POST-V1-M17 shape (NULLS NOT
 * DISTINCT); each test starts by stripping the index back to the live
 * production drift state (plain unique index, V1-M16 form) before
 * running the stage — same technique as migrate-v1m15.test.ts.
 */

// Explicit hook timeout: the pglite WASM boot + DDL runs under heavy
// parallel-suite CPU contention (same rationale as migrate-v1m9/v1m10/v1m12).
beforeAll(initTestDb, 60_000);

beforeEach(async () => {
  await resetTestDb();
  await stripIndexToV1M16Form();
});

/** Reproduce the live drift state: the plain V1-M16 unique index. */
async function stripIndexToV1M16Form(): Promise<void> {
  await db.execute(sql.raw("DROP INDEX IF EXISTS uniq_product_variants_plan_duration"));
  await db.execute(
    sql.raw(
      "CREATE UNIQUE INDEX uniq_product_variants_plan_duration " +
        "ON product_variants (product_id, plan_label, duration_label)",
    ),
  );
}

async function indexDef(name: string): Promise<string | undefined> {
  const result = await db.execute(
    sql`SELECT indexdef AS def FROM pg_indexes WHERE indexname = ${name}`,
  );
  const rows = (result as unknown as { rows?: Array<{ def: string }> }).rows ?? [];
  return rows[0]?.def;
}

async function indexExists(name: string): Promise<boolean> {
  const result = await db.execute(sql`SELECT 1 AS one FROM pg_indexes WHERE indexname = ${name}`);
  const rows = (result as unknown as { rows?: unknown[] }).rows ?? [];
  return rows.length > 0;
}

async function seedProduct(name: string): Promise<number> {
  const [product] = await db
    .insert(productsTable)
    .values({ name, price: "10.00" })
    .returning({ id: productsTable.id });
  return product.id;
}

async function insertVariant(
  productId: number,
  planLabel: string | null,
  durationLabel: string | null,
): Promise<unknown> {
  return db.insert(productVariantsTable).values({
    productId,
    planLabel,
    durationLabel,
    costPrice: "5.00",
    priceLyd: "100.00",
  });
}

describe("V1-M17 applyProductVariantsNullsNotDistinctStage — rebuild", () => {
  it("rebuilds the V1-M16 plain index with NULLS NOT DISTINCT, same columns", async () => {
    // Pre-state (beforeEach): the plain V1-M16 form.
    expect(await indexDef("uniq_product_variants_plan_duration")).not.toContain(
      "NULLS NOT DISTINCT",
    );

    await applyProductVariantsNullsNotDistinctStage();

    const def = await indexDef("uniq_product_variants_plan_duration");
    expect(def).toContain("UNIQUE INDEX uniq_product_variants_plan_duration");
    expect(def).toContain("ON public.product_variants");
    expect(def).toContain("(product_id, plan_label, duration_label)");
    expect(def).toContain("NULLS NOT DISTINCT");
  });

  it("preserves rows across the rebuild and then dedups NULL axes", async () => {
    const productId = await seedProduct("v1m17-keep-rows");
    await insertVariant(productId, "Family", null);
    await insertVariant(productId, "Duo", "1 Month");

    await applyProductVariantsNullsNotDistinctStage();

    const rows = await db.select().from(productVariantsTable);
    expect(rows).toHaveLength(2); // nothing lost in the DROP + CREATE

    // The new guard: a second (Family, NULL) is now rejected by the INDEX
    // (the pre-V1-M17 form accepted it — NULLs distinct).
    await expect(insertVariant(productId, "Family", null)).rejects.toBeDefined();
    // A genuinely distinct triple still inserts.
    await insertVariant(productId, "Family", "3 Months");
    const after = await db.select().from(productVariantsTable);
    expect(after).toHaveLength(3);
  });

  it("recreates the index when it is missing entirely (fresh-boot belt)", async () => {
    await db.execute(sql.raw("DROP INDEX uniq_product_variants_plan_duration"));
    expect(await indexExists("uniq_product_variants_plan_duration")).toBe(false);

    await applyProductVariantsNullsNotDistinctStage();

    expect(await indexDef("uniq_product_variants_plan_duration")).toContain("NULLS NOT DISTINCT");
  });
});

describe("V1-M17 — idempotent re-runs", () => {
  it("second apply issues no DROP/CREATE (recording executor, steady state)", async () => {
    await applyProductVariantsNullsNotDistinctStage();

    const statements: string[] = [];
    const recording = async (query: SQL) => {
      const text = String(
        (query as unknown as { queryChunks?: Array<{ value: unknown }> }).queryChunks
          ?.map((c) => (Array.isArray(c.value) ? c.value.join("") : c.value))
          .join(""),
      );
      statements.push(text);
      return db.execute(query);
    };
    await applyProductVariantsNullsNotDistinctStage(recording);

    // Steady state: only the pg_indexes probe (SELECT) runs — no DROP
    // INDEX, no CREATE [UNIQUE] INDEX.
    expect(statements.some((s) => /^\s*DROP INDEX/i.test(s))).toBe(false);
    expect(statements.some((s) => /^\s*CREATE UNIQUE INDEX/i.test(s))).toBe(false);
    // The probe DID run (guard engaged, not skipped).
    expect(statements.some((s) => s.includes("pg_indexes"))).toBe(true);
    expect(statements.some((s) => s.includes("uniq_product_variants_plan_duration"))).toBe(true);
  });
});
