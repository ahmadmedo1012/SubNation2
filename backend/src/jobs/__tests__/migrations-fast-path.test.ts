import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { db, initTestDb, resetTestDb, usersTable, productsTable } from "../../test/db";
import {
  __setMigrationsFingerprintForTests,
  __resetConstraintSkipStateForTests,
  getConstraintSkipAlerts,
  persistMigrationFingerprintAfterRun,
  readStoredMigrationFingerprint,
  writeStoredMigrationFingerprint,
  runMigrations,
  applyMoneyConstraintStage,
  applyProductVariantsNullsNotDistinctStage,
} from "../../migrate";

/**
 * R104 (AG5-1 / AG6-1) — the migration fingerprint fast-path.
 *
 * Steady-state cold starts used to replay ~141 sequential no-op DB
 * statements (2-7 s of readiness delay on every Render free wake). The
 * fast-path persists a build-time sha256 of migrate.ts in
 * system_settings after a successful full reconcile and SKIPS the replay
 * on the next boot of the same build.
 *
 * The full 141-statement chain cannot run under the pglite harness
 * (multi-statement batches — the historical reason every other migrate
 * test pins individual STAGES); these tests pin the marker plumbing the
 * fast-path is built on, against the real SQL surface:
 *
 *   1. read → null when no marker exists (true first boot);
 *   2. write → read round-trips the fingerprint exactly;
 *   3. a second write UPSERTS (overwrites, no duplicate rows);
 *   4. delete the row → read null again (operator force-reconcile path);
 *   5. the gate itself: with the fingerprint UNSET (tests/dev shape —
 *      no build-time define) runMigrations still attempts the full
 *      reconcile (the module contract that keeps dev/test semantics
 *      byte-identical), and MIGRATIONS_FORCE_RECONCILE is honored at
 *      the env layer.
 *
 * r110 (109-e P2-1): the marker-persist gate — a reconcile that took a
 * constraint-skip alert path (probe → alert instead of ALTER) must NOT
 * persist the marker, or the next boot fast-paths over the skipped work
 * and "reboot to apply" silently no-ops. Pinned end-to-end against the
 * real V1-M9 / V1-M17 skip paths + the clean path.
 *
 * r110 (109-e P2-2): the v2 composite marker (v2:<codeHash>:<schemaHash>)
 * — a stored marker with a stale/absent schema component (legacy bare-hex
 * markers, out-of-band schema/chain edits) must fail the compare and take
 * the reconcile path exactly once. On the pglite harness a full reconcile
 * ALWAYS throws (batch parsing), which makes throw-vs-resolve a precise
 * fast-path oracle.
 */

const FP_A = "a".repeat(64);
const FP_B = "b".repeat(64);
/** r110: a v2 composite marker shape (code + schema components). */
const FP_V2 = `v2:${"c".repeat(64)}:${"d".repeat(64)}`;
/** r110: same code component, DIFFERENT schema component (out-of-band drift). */
const FP_V2_STALE_SCHEMA = `v2:${"c".repeat(64)}:${"e".repeat(64)}`;

describe("migrations fingerprint marker plumbing (R104 fast-path)", () => {
  beforeAll(async () => {
    await initTestDb();
    // system_settings is created by the real migration chain; create it
    // directly so the marker surface can be pinned without the full run.
    await db.execute(
      sql`CREATE TABLE IF NOT EXISTS system_settings (
            key VARCHAR(255) PRIMARY KEY,
            value TEXT NOT NULL DEFAULT '{}',
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )`,
    );
  });

  afterAll(async () => {
    __setMigrationsFingerprintForTests(null);
    await resetTestDb();
  });

  it("read → null when no marker exists (true first boot)", async () => {
    await db.execute(sql`DELETE FROM system_settings WHERE key = 'migrations.fingerprint'`);
    expect(await readStoredMigrationFingerprint()).toBeNull();
  });

  it("write → read round-trips the fingerprint exactly", async () => {
    await writeStoredMigrationFingerprint(FP_A);
    expect(await readStoredMigrationFingerprint()).toBe(FP_A);
  });

  it("a second write UPSERTS (overwrites, single row — no duplicates)", async () => {
    await writeStoredMigrationFingerprint(FP_B);
    expect(await readStoredMigrationFingerprint()).toBe(FP_B);
    const rows = (await db.execute(
      sql`SELECT COUNT(*)::int AS c FROM system_settings WHERE key = 'migrations.fingerprint'`,
    )) as unknown as { rows?: Array<{ c?: number }> };
    expect(Number(rows?.rows?.[0]?.c ?? 0)).toBe(1);
  });

  it("deleting the row restores the fresh-reconcile path (operator escape hatch)", async () => {
    await db.execute(sql`DELETE FROM system_settings WHERE key = 'migrations.fingerprint'`);
    expect(await readStoredMigrationFingerprint()).toBeNull();
  });

  it("unset fingerprint (tests/dev shape) → runMigrations does NOT take the fast-path gate", async () => {
    // Dev/test has no build-time define: the fast-path must be inert.
    // The full chain is not pglite-runnable (multi-statement batches),
    // so this pins the GATE only: with the fingerprint unset the module
    // variable is undefined and the early-return cannot trigger
    // (verified by the seam), regardless of the stored marker.
    __setMigrationsFingerprintForTests(null);
    await writeStoredMigrationFingerprint(FP_A); // a marker exists…
    // …but without a build fingerprint the gate is unreachable — the
    // module-level constant is undefined, so runMigrations MUST attempt
    // the full reconcile (here: it will fail on pglite's batch parsing,
    // which PROVES the gate did not short-circuit).
    await expect(runMigrations()).rejects.toThrow();
  });
});

describe("r110 (109-e P2-2): the v2 composite marker gates the fast-path", () => {
  beforeEach(async () => {
    // Per-test isolation: fresh skip state + no stored marker. The pglite
    // oracle: a full reconcile ALWAYS throws on this harness (multi-
    // statement batches), so resolves ⇒ fast-path taken, rejects ⇒ the
    // compare failed and the reconcile path was entered.
    __resetConstraintSkipStateForTests();
    __setMigrationsFingerprintForTests(FP_V2);
    await db.execute(sql`DELETE FROM system_settings WHERE key = 'migrations.fingerprint'`);
  });

  it("a stored v2 marker that matches → early return (fast-path, no reconcile)", async () => {
    await writeStoredMigrationFingerprint(FP_V2);
    await expect(runMigrations()).resolves.toBeUndefined();
  });

  it("a stored marker with a STALE schema component → full reconcile (out-of-band schema drift)", async () => {
    // Same code component, different schema component — the exact shape
    // an out-of-band schema/chain edit produces (109-e P2-2). The strict
    // compare must fail → the reconcile path is entered (throws on pglite).
    await writeStoredMigrationFingerprint(FP_V2_STALE_SCHEMA);
    await expect(runMigrations()).rejects.toThrow();
  });

  it("a LEGACY bare-hex marker (pre-v2 build, no schema component) → full reconcile", async () => {
    // Backward-safety pin: old markers are never parsed — they simply
    // never equal the v2 composite, so the first boot of a v2 build takes
    // the reconcile path exactly once and then writes the new marker.
    await writeStoredMigrationFingerprint(FP_A);
    await expect(runMigrations()).rejects.toThrow();
  });

  it("MIGRATIONS_FORCE_RECONCILE=true overrides even a matching marker", async () => {
    await writeStoredMigrationFingerprint(FP_V2);
    process.env.MIGRATIONS_FORCE_RECONCILE = "true";
    try {
      await expect(runMigrations()).rejects.toThrow();
    } finally {
      delete process.env.MIGRATIONS_FORCE_RECONCILE;
    }
  });
});

describe("r110 (109-e P2-1): fingerprint NOT persisted when a constraint-skip path fires", () => {
  beforeEach(async () => {
    __resetConstraintSkipStateForTests();
    __setMigrationsFingerprintForTests(FP_V2);
    await resetTestDb();
    await db.execute(sql`DELETE FROM system_settings WHERE key = 'migrations.fingerprint'`);
  });

  it("V1-M9 skip path (violating data → alert instead of ALTER) blocks the persist", async () => {
    // Strip the harness-carried constraint so a violating row can exist
    // (same pristine-restore discipline as migrate-v1m9's beforeEach).
    await db.execute(
      sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_wallet_balance_nonneg`,
    );
    await db.insert(usersTable).values({ id: 1, phone: "09100000001", walletBalance: "-5.00" });

    await applyMoneyConstraintStage(); // probe → alert, constraint skipped

    // The skip was recorded for this run…
    expect(getConstraintSkipAlerts()).toContain("db:constraint:chk_users_wallet_balance_nonneg");
    // …and the persist gate therefore leaves the stored marker ABSENT —
    // the next boot re-runs the reconcile instead of fast-pathing.
    await persistMigrationFingerprintAfterRun();
    expect(await readStoredMigrationFingerprint()).toBeNull();
  });

  it("V1-M17 skip path (NULL-equal duplicate variants → no rebuild) blocks the persist", async () => {
    // Recreate the PRE-V1-M17 plain unique index so NULL-equal duplicate
    // rows can exist (the NULLS NOT DISTINCT harness form rejects them).
    await db.execute(sql`DROP INDEX IF EXISTS uniq_product_variants_plan_duration`);
    await db.execute(
      sql`CREATE UNIQUE INDEX uniq_product_variants_plan_duration
          ON product_variants (product_id, plan_label, duration_label)`,
    );
    const [product] = await db
      .insert(productsTable)
      .values({ name: "fast-path-skip-probe", price: "10.00" })
      .returning();
    await db.execute(sql`
      INSERT INTO product_variants (product_id, plan_label, duration_label, cost_price, price_lyd)
      VALUES (${product.id}, 'Family', NULL, '5.00', '100.00'),
             (${product.id}, 'Family', NULL, '5.00', '100.00')
    `);

    await applyProductVariantsNullsNotDistinctStage(); // probe → skip (logger path)

    expect(getConstraintSkipAlerts()).toContain(
      "db:constraint:uniq_product_variants_plan_duration",
    );
    await persistMigrationFingerprintAfterRun();
    expect(await readStoredMigrationFingerprint()).toBeNull();
  });

  it("a fully-reconciled run (no skip paths) persists the marker — steady-state fast-path intact", async () => {
    // Pristine harness: every V1-M9 statement is a guarded no-op, no
    // violations → zero skips → the marker IS written (1-2-query
    // steady-state cold starts stay intact — the point of the fast-path).
    await applyMoneyConstraintStage();
    expect(getConstraintSkipAlerts()).toEqual([]);

    await persistMigrationFingerprintAfterRun();
    expect(await readStoredMigrationFingerprint()).toBe(FP_V2);
  });

  it("after the operator fixes the data, the next reconcile run persists the marker again", async () => {
    // The recovery loop: skip-run (marker withheld) → data fixed → clean
    // re-run → marker written. "Reboot to apply" now actually applies.
    await db.execute(
      sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_wallet_balance_nonneg`,
    );
    await db.insert(usersTable).values({ id: 1, phone: "09100000002", walletBalance: "-5.00" });
    await applyMoneyConstraintStage();
    await persistMigrationFingerprintAfterRun();
    expect(await readStoredMigrationFingerprint()).toBeNull();

    // Operator fixes the row; the next run reconciles cleanly.
    __resetConstraintSkipStateForTests();
    await db
      .update(usersTable)
      .set({ walletBalance: "5.00" })
      .where(sql`${usersTable.id} = 1`);
    await applyMoneyConstraintStage();
    expect(getConstraintSkipAlerts()).toEqual([]);
    await persistMigrationFingerprintAfterRun();
    expect(await readStoredMigrationFingerprint()).toBe(FP_V2);
  });
});
