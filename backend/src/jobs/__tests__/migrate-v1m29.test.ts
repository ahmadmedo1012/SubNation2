import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { db, initTestDb, resetTestDb, usersTable } from "../../test/db";
import { applyDomainCheckConstraintsStage } from "../../migrate";

/**
 * R123-E5 (R123-A7 P3) — V1-M29: the eight domain CHECKs
 * (cart quantity >= 1, products price > 0, variant price/cost bounds,
 * referral status lifecycle, run outcomes ×2, risk score/confidence
 * ranges) the R118-A3 F3 sweep stopped short of.
 *
 * Stage shape is the V1-M9/V1-M26 checkConstraints loop verbatim:
 * violation count-probe → deduped admin alert + skip; DO-block ADD with
 * duplicate_object swallow. The harness DDL ships the four CHECKs whose
 * tables it carries (parity with the post-boot shape), so beforeEach
 * strips them back to the pristine pre-stage state (the v1m26 idiom);
 * the three tables the shared harness does not carry
 * (risk_events / enrichment_runs / inventory_forecast_runs) are
 * provisioned locally per-file WITHOUT their CHECKs (the
 * retention-batching/auth-activity convention).
 */

const HARNESS_CARRIED_CHECKS = [
  "chk_cart_items_quantity_pos",
  "chk_products_price_pos",
  "chk_variant_price_pos",
  "chk_referral_status",
] as const;

const ALL_EIGHT_CHECKS = [
  ...HARNESS_CARRIED_CHECKS,
  "chk_enrichment_runs_outcome",
  "chk_forecast_runs_outcome",
  "chk_risk_score_range",
  "chk_risk_confidence_range",
] as const;

/** The per-file tables (no CHECKs — the stage under test adds them). */
const PER_FILE_DDL = [
  `CREATE TABLE IF NOT EXISTS risk_events (
    id serial PRIMARY KEY,
    score integer NOT NULL,
    confidence numeric(4,3) NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS enrichment_runs (
    id serial PRIMARY KEY,
    outcome varchar(20) NOT NULL DEFAULT 'in_flight'
  )`,
  `CREATE TABLE IF NOT EXISTS inventory_forecast_runs (
    id serial PRIMARY KEY,
    outcome varchar(20) NOT NULL DEFAULT 'in_flight'
  )`,
];

const PER_FILE_TABLES = ["risk_events", "enrichment_runs", "inventory_forecast_runs"];

beforeAll(async () => {
  await initTestDb();
}, 60_000);

beforeEach(async () => {
  await resetTestDb();
  // Strip the four harness-carried CHECKs back to the pristine pre-stage
  // state (single statements for pglite — the v1m26 idiom).
  await db.execute(sql.raw("ALTER TABLE cart_items DROP CONSTRAINT IF EXISTS chk_cart_items_quantity_pos"));
  await db.execute(sql.raw("ALTER TABLE products DROP CONSTRAINT IF EXISTS chk_products_price_pos"));
  await db.execute(sql.raw("ALTER TABLE product_variants DROP CONSTRAINT IF EXISTS chk_variant_price_pos"));
  await db.execute(sql.raw("ALTER TABLE referral_events DROP CONSTRAINT IF EXISTS chk_referral_status"));
  // (Re-)provision the per-file tables fresh (no CHECKs; one statement
  // per execute — pglite rejects multi-command prepared statements).
  for (const table of PER_FILE_TABLES) {
    await db.execute(sql.raw(`DROP TABLE IF EXISTS ${table} CASCADE`));
  }
  for (const stmt of PER_FILE_DDL) {
    await db.execute(sql.raw(stmt));
  }
});

async function constraintExists(name: string): Promise<boolean> {
  const result = await db.execute(sql`SELECT 1 AS one FROM pg_constraint WHERE conname = ${name}`);
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

let phoneSeq = 91_720_000;
function nextPhone(): string {
  phoneSeq += 1;
  return String(phoneSeq);
}

describe("V1-M29 — applyDomainCheckConstraintsStage (R123-A7 P3)", () => {
  it("applies all eight constraints, and a second run is a clean no-op", async () => {
    await applyDomainCheckConstraintsStage();
    await applyDomainCheckConstraintsStage(); // idempotency: no error, same state

    for (const name of ALL_EIGHT_CHECKS) {
      expect(await constraintExists(name)).toBe(true);
    }
  });

  it("violation pre-check: dirty cart quantity → ALERT + skip that one, the other seven still apply", async () => {
    const [user] = await db.insert(usersTable).values({ phone: nextPhone() }).returning();
    await db.execute(sql`
      INSERT INTO cart_items (user_id, product_id, quantity)
      VALUES (${user.id}, 1, 0)
    `);

    await applyDomainCheckConstraintsStage();

    // The dirty table's CHECK was skipped…
    expect(await constraintExists("chk_cart_items_quantity_pos")).toBe(false);
    // …nothing was deleted…
    const orphans = await db.execute(
      sql`SELECT count(*) AS c FROM cart_items WHERE quantity = 0`,
    );
    const rows = (orphans as unknown as { rows?: Array<{ c: number | string }> }).rows ?? [];
    expect(Number(rows[0]?.c ?? 0)).toBe(1);
    // …a deduped admin alert fired…
    expect(await countAlerts("db:constraint:chk_cart_items_quantity_pos")).toBe(1);
    // …and every OTHER constraint still landed.
    for (const name of ALL_EIGHT_CHECKS) {
      if (name === "chk_cart_items_quantity_pos") continue;
      expect(await constraintExists(name)).toBe(true);
    }
  });

  it("the applied CHECKs reject bypass-writer dirt", async () => {
    await applyDomainCheckConstraintsStage();
    const [user] = await db.insert(usersTable).values({ phone: nextPhone() }).returning();

    // cart_items: quantity 0 (the handler's >= 1 validation bypassed).
    expect(
      await constraintViolationName(
        db.execute(sql`
          INSERT INTO cart_items (user_id, product_id, quantity)
          VALUES (${user.id}, 1, 0)
        `),
      ),
    ).toBe("chk_cart_items_quantity_pos");

    // products: a zero-price row.
    expect(
      await constraintViolationName(
        db.execute(sql`INSERT INTO products (name, price) VALUES ('v1m29-zero', 0)`),
      ),
    ).toBe("chk_products_price_pos");

    // product_variants: negative cost_price.
    const product = await db
      .execute(sql`INSERT INTO products (name, price) VALUES ('v1m29-host', 10) RETURNING id`)
      .then((r) => (r as unknown as { rows: Array<{ id: number }> }).rows[0]);
    expect(
      await constraintViolationName(
        db.execute(sql`
          INSERT INTO product_variants (product_id, cost_price, price_lyd)
          VALUES (${product.id}, -1, 20)
        `),
      ),
    ).toBe("chk_variant_price_pos");

    // referral_events: a bogus lifecycle status.
    expect(
      await constraintViolationName(
        db.execute(sql`
          INSERT INTO referral_events (referrer_id, referee_id, status)
          VALUES (${user.id}, ${user.id}, 'bogus')
        `),
      ),
    ).toBe("chk_referral_status");

    // risk_events: score out of the 0..100 band + confidence out of 0..1.
    expect(
      await constraintViolationName(
        db.execute(sql`INSERT INTO risk_events (score, confidence) VALUES (150, 0.5)`),
      ),
    ).toBe("chk_risk_score_range");
    expect(
      await constraintViolationName(
        db.execute(sql`INSERT INTO risk_events (score, confidence) VALUES (50, 2)`),
      ),
    ).toBe("chk_risk_confidence_range");

    // the run-outcome twins.
    expect(
      await constraintViolationName(
        db.execute(sql`INSERT INTO enrichment_runs (outcome) VALUES ('bogus')`),
      ),
    ).toBe("chk_enrichment_runs_outcome");
    expect(
      await constraintViolationName(
        db.execute(sql`INSERT INTO inventory_forecast_runs (outcome) VALUES ('bogus')`),
      ),
    ).toBe("chk_forecast_runs_outcome");
  });

  it("legitimate rows pass every CHECK", async () => {
    await applyDomainCheckConstraintsStage();
    const [user] = await db.insert(usersTable).values({ phone: nextPhone() }).returning();
    const product = await db
      .execute(sql`INSERT INTO products (name, price) VALUES ('v1m29-ok', 10) RETURNING id`)
      .then((r) => (r as unknown as { rows: Array<{ id: number }> }).rows[0]);

    // In-bounds writes on every table the batch covers.
    await db.execute(sql`
      INSERT INTO cart_items (user_id, product_id, quantity) VALUES (${user.id}, ${product.id}, 1)
    `);
    await db.execute(sql`
      INSERT INTO product_variants (product_id, cost_price, price_lyd)
      VALUES (${product.id}, 0, 20)
    `);
    await db.execute(sql`
      INSERT INTO referral_events (referrer_id, referee_id, status)
      VALUES (${user.id}, ${user.id}, 'pending')
    `);
    await db.execute(sql`INSERT INTO risk_events (score, confidence) VALUES (85, 0.95)`);
    await db.execute(sql`INSERT INTO enrichment_runs (outcome) VALUES ('success')`);
    await db.execute(sql`INSERT INTO inventory_forecast_runs (outcome) VALUES ('in_flight')`);

    const carts = await db.execute(sql`SELECT count(*) AS c FROM cart_items`);
    const rows = (carts as unknown as { rows?: Array<{ c: number | string }> }).rows ?? [];
    expect(Number(rows[0]?.c ?? 0)).toBe(1);
  });
});
