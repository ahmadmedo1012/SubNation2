import { db } from "@workspace/db";
import { sql, type SQL } from "drizzle-orm";
import { hashPassword } from "./lib/crypto";
import { encrypt, isEncrypted } from "./lib/encryption";
import { logger } from "./lib/logger";

/**
 * R104 (AG5-1 / AG6-1 — cold-start fast-path): build-time fingerprint of
 * the migration corpus, injected by build.mjs as an esbuild `define`.
 * Steady-state cold starts were paying ~141 sequential no-op DB round trips
 * (2-7 s on 0.1 CPU + a cold Neon resume) on EVERY Render free-tier wake —
 * the dominant readiness cost.
 *
 * r110 (109-e P2-2): the marker is now a VERSIONED COMPOSITE —
 * `v2:<codeHash>:<schemaHash>` — computed at build time by build.mjs.
 *   - <codeHash>  = sha256 of src/migrate.ts (the migration engine);
 *   - <schemaHash> = sha256 of shared/db/src/schema/*.ts + the emitted
 *     drizzle chain (shared/db/drizzle/*.sql + meta/*), so OUT-OF-BAND
 *     schema/SQL edits (a schema TS tweak, a regenerated chain, a hand
 *     edit to a chain file) also invalidate the fast-path, not just
 *     migrate.ts edits.
 * Markers written by older builds (bare 64-hex, no schema component)
 * naturally FAIL the strict-equality compare → exactly one full
 * reconcile → the v2 marker is written. No legacy marker is ever
 * parsed, so the upgrade path cannot crash.
 *
 * When the marker matches the value persisted in system_settings after
 * the last successful full reconcile, runMigrations() skips the entire
 * replay. Any edit to the corpus changes the hash → one full reconcile
 * on the next boot → new hash persisted. Tests/dev (no define) see
 * `undefined` → always full run, semantics unchanged.
 * `MIGRATIONS_FORCE_RECONCILE` (true/1/yes — R108 accepts all three)
 * bypasses the fast-path; deleting the system_settings row forces a
 * full reconcile too.
 *
 * r110 (109-e P2-1): the marker is persisted ONLY when the run fully
 * reconciled — a run that took any constraint-skip alert path (probe →
 * alert instead of ALTER) leaves the stored marker UNTOUCHED so the
 * next boot re-runs the reconcile and actually applies what was
 * skipped ("reboot to apply" must not silently no-op on the fast-path).
 */
declare const __MIGRATIONS_FINGERPRINT__: string | undefined;

let MIGRATIONS_FINGERPRINT: string | undefined =
  typeof __MIGRATIONS_FINGERPRINT__ === "string" && __MIGRATIONS_FINGERPRINT__.length > 0
    ? __MIGRATIONS_FINGERPRINT__
    : undefined;

/** Test-only: simulate the build-time define (null = unset). */
export function __setMigrationsFingerprintForTests(fp: string | null): void {
  MIGRATIONS_FINGERPRINT = fp ?? undefined;
}

/** system_settings key holding the last fully-reconciled fingerprint. */
const MIGRATIONS_FINGERPRINT_KEY = "migrations.fingerprint";

export async function readStoredMigrationFingerprint(): Promise<string | null> {
  try {
    const rows = extractRows(
      await db.execute(
        sql`SELECT value FROM system_settings WHERE key = ${MIGRATIONS_FINGERPRINT_KEY} LIMIT 1`,
      ),
    );
    const value = rows[0]?.["value"];
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch {
    // Table not created yet (true first boot) or transient — either way:
    // fall through to the full reconcile. Never let the fast-path
    // PROBE break boot.
    return null;
  }
}

export async function writeStoredMigrationFingerprint(fingerprint: string): Promise<void> {
  try {
    await db.execute(
      sql`INSERT INTO system_settings (key, value, updated_at)
          VALUES (${MIGRATIONS_FINGERPRINT_KEY}, ${fingerprint}, NOW())
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    );
  } catch (err) {
    // Persisting the marker is best-effort: a failure here must never
    // fail an otherwise-successful migration run — the next boot simply
    // reconciles again (idempotent).
    logger.warn({ err }, "migrations.fingerprint write skipped (non-fatal)");
  }
}

// ── r110 (109-e P2-1): constraint-skip tracking ────────────────────────────
//
// Every probe→alert skip path in the V1-M9/M10/M17 stages records its
// dedupe key here. runMigrations() resets the list at the top of each
// invocation (boot-migrations.ts transient retries re-run from the top)
// and refuses to persist the fast-path marker while it is non-empty —
// a skipped constraint means the reconcile did NOT fully converge, so
// the next boot must re-run it instead of fast-pathing over the gap
// (the old behavior: marker persisted → "reboot to apply" silently
// no-opped forever). Tests reset via the seam between stage runs.
let constraintSkipKeys: string[] = [];

/** Test-only: clear the per-run constraint-skip state. */
export function __resetConstraintSkipStateForTests(): void {
  constraintSkipKeys = [];
}

/** Skip paths recorded during the current/last reconcile run (dedupe keys). */
export function getConstraintSkipAlerts(): string[] {
  return [...constraintSkipKeys];
}

/** r110 (109-e P2-1): record a constraint-skip (called by every skip path). */
function recordConstraintSkip(dedupeKey: string): void {
  constraintSkipKeys.push(dedupeKey);
}

/**
 * r110 (109-e P2-1): the marker-persist gate runMigrations() ends with.
 *
 * Persists the build fingerprint ONLY when the run fully reconciled
 * (zero constraint-skip alert paths). A skip leaves the stored marker
 * untouched — whatever it was — so the next boot's compare fails and
 * the full reconcile re-runs (and re-alerts, deduped 24h) until the
 * operator fixes the data. No-op when the fingerprint is undefined
 * (tests/dev — no build-time define).
 */
export async function persistMigrationFingerprintAfterRun(): Promise<void> {
  if (!MIGRATIONS_FINGERPRINT) return;
  if (constraintSkipKeys.length > 0) {
    logger.warn(
      { category: "storage", skipped: [...constraintSkipKeys] },
      "[migrations] constraint-skip alert path fired — fingerprint NOT persisted; the next boot re-runs the full reconcile (r110)",
    );
    return;
  }
  await writeStoredMigrationFingerprint(MIGRATIONS_FINGERPRINT);
}

// ── r110 (109-e P2-2): v2 composite marker diagnostics ─────────────────────
//
// The marker format is `v2:<codeHash>:<schemaHash>` (see build.mjs). The
// fast-path compare stays strict string equality — old bare-hex markers
// simply never match — but on mismatch we can tell ops WHICH component
// moved. Pure function over opaque strings; never throws.
function describeMarkerMismatch(stored: string, current: string): string {
  const parts = (m: string): [string, string, string] | null => {
    const segs = m.split(":");
    return segs.length === 3 && segs[0] === "v2" ? (segs as [string, string, string]) : null;
  };
  const s = parts(stored);
  const c = parts(current);
  if (s && c) {
    if (s[1] === c[1]) return "schema component changed (out-of-band schema/chain edit detected)";
    if (s[2] === c[2]) return "migration engine code changed";
  }
  return "marker format/components changed (legacy or diverged marker)";
}

/** Minimal executor signature so boot-critical SQL helpers stay unit-testable. */
type SqlExecutor = (query: SQL) => Promise<unknown>;

const defaultExecutor: SqlExecutor = (query) => db.execute(query);

/** Node-postgres and pglite drizzle drivers both return `.rows`; accept either. */
function extractRows(result: unknown): Array<Record<string, unknown>> {
  const withRows = result as { rows?: Array<Record<string, unknown>> } | null | undefined;
  if (withRows && Array.isArray(withRows.rows)) return withRows.rows;
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  return [];
}

function extractCount(result: unknown): number {
  const row = extractRows(result)[0] as { c?: number | string } | undefined;
  return Number(row?.c ?? 0);
}

/**
 * Ensure the pg_trgm extension exists WITHOUT issuing DDL when it already
 * does (B7-P0-1, round-92 audit).
 *
 * `CREATE EXTENSION` is rejected by Postgres in a read-only window even
 * when the extension is already installed — the command-class check fires
 * before the no-op effect is evaluated, and that exact statement killed
 * deploy dep-daf0rt8n74is73fraih0. A pg_extension catalog read is permitted
 * on a read-only standby, so we probe first and only CREATE when genuinely
 * absent. Steady-state boots execute zero extension DDL.
 *
 * Returns true when the extension is usable; callers skip the trigram GIN
 * indexes otherwise (fuzzy search falls back to a seq scan — slower, never
 * broken). If the CREATE itself is rejected as read-only (SQLSTATE 25006),
 * the error is re-thrown so boot-migrations.ts classifies it transient and
 * retries the whole run once the failover window clears. Other failures
 * (extension unavailable in this environment — e.g. the pglite test
 * harness) are logged and downgraded to "not available".
 */
export async function ensurePgTrgmExtension(
  execute: SqlExecutor = defaultExecutor,
): Promise<boolean> {
  const probeRows = extractRows(
    await execute(sql`SELECT 1 AS present FROM pg_extension WHERE extname = 'pg_trgm'`),
  );
  if (probeRows.length > 0) return true;
  try {
    await execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    return true;
  } catch (err) {
    const code = (err as { code?: string }).code;
    const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
    if (
      code === "25006" ||
      msg.includes("read-only transaction") ||
      msg.includes("read-only mode")
    ) {
      // Read-only window — surface it so the transient retry machinery engages.
      throw err;
    }
    logger.warn(
      { err, code },
      "pg_trgm not available in this environment — trigram indexes will be skipped (fuzzy search falls back to seq scan)",
    );
    return false;
  }
}

async function alertMoneyConstraintIssue(title: string, message: string, dedupeKey: string) {
  // r110 (109-e P2-1): a skip path is being taken — record it BEFORE the
  // alert dispatch (a dispatch failure must not un-record the skip; the
  // operator fix + reboot still has to re-run the reconcile).
  recordConstraintSkip(dedupeKey);
  logger.error({ category: "monitoring", dedupeKey }, message);
  try {
    // Lazy import — same circular-load avoidance as the V1-M8 block below
    // (alertLogger imports socket dynamically, which reads env at connect
    // time; migration boot must not pay that cost).
    const { logAdminAlert } = await import("./jobs/alertLogger");
    await logAdminAlert("system", title, message, {
      dedupeKey,
      dedupeWindowMs: 24 * 60 * 60 * 1000,
    });
  } catch (err) {
    logger.warn({ err }, "[migrations] V1-M9 admin alert dispatch failed");
  }
}

/**
 * V1-M9 (round-92 B8 audit — B8-01/02/03/10): bring the money tables'
 * constraints up to what the Drizzle schema always declared.
 *
 * The live DB is built by THIS boot SQL (the drizzle-kit chain was never
 * applied), and it drifted: no unique index on wallet_topups.payment_reference,
 * no wallet_ledger→users FK, zero CHECK constraints on any money table, and
 * four indexes missing vs the schema TS. All are additive and each is
 * self-validating:
 *
 *   - every CHECK/FK/unique is preceded by a violation/orphan/duplicate
 *     COUNT probe (plain SELECT); violations short-circuit to a CRITICAL
 *     log + deduped admin alert instead of a failed ALTER (the operator
 *     fixes data, the next boot applies the constraint);
 *   - re-runs are no-ops (IF NOT EXISTS / DROP CONSTRAINT IF EXISTS +
 *     duplicate_object swallow);
 *   - every statement is single (no multi-statement batches) so the stage
 *     also runs on the pglite test harness.
 *
 * Exported with an injectable executor for unit tests.
 */
export async function applyMoneyConstraintStage(
  execute: SqlExecutor = defaultExecutor,
): Promise<void> {
  // B8-01: duplicate-receipt guard on approved topups. Partial (NULL refs
  // and non-approved rows are exempt — history rows were never captured).
  const duplicateReferences = extractCount(
    await execute(sql`
      SELECT count(*) AS c FROM (
        SELECT payment_reference
        FROM wallet_topups
        WHERE payment_reference IS NOT NULL
          AND btrim(payment_reference) <> ''
          AND status = 'approved'
        GROUP BY payment_reference
        HAVING count(*) > 1
      ) dupes
    `),
  );
  if (duplicateReferences > 0) {
    await alertMoneyConstraintIssue(
      "تعارض مراجع الدفع (V1-M9)",
      `Found ${duplicateReferences} duplicated approved payment_reference value(s) in wallet_topups — uniq_wallet_topups_payment_reference NOT created. Deduplicate the rows, then reboot to apply the index.`,
      "db:constraint:uniq_wallet_topups_payment_reference",
    );
  } else {
    await execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_wallet_topups_payment_reference
        ON wallet_topups(payment_reference)
        WHERE payment_reference IS NOT NULL AND btrim(payment_reference) <> '' AND status='approved'
    `);
  }

  // B8-02: the schema-declared wallet_ledger→users FK (ON DELETE CASCADE)
  // never made it into the boot SQL. Orphan check first — adding an FK over
  // orphaned rows fails the whole boot; alerting beats crashing.
  const ledgerOrphans = extractCount(
    await execute(sql`
      SELECT count(*) AS c
      FROM wallet_ledger wl
      LEFT JOIN users u ON wl.user_id = u.id
      WHERE u.id IS NULL
    `),
  );
  if (ledgerOrphans > 0) {
    await alertMoneyConstraintIssue(
      "صفوف دفتر مالية يتيمة (V1-M9)",
      `Found ${ledgerOrphans} wallet_ledger row(s) with a user_id that no longer exists — fk_wallet_ledger_user NOT added. Re-link or delete the orphaned rows, then reboot to apply the FK.`,
      "db:constraint:fk_wallet_ledger_user",
    );
  } else {
    // Drop-if-exists keeps this idempotent for environments that already
    // carry the constraint under this name; the DO block swallows the
    // duplicate_object raised when a DIFFERENT-named FK already covers it.
    await execute(sql`ALTER TABLE wallet_ledger DROP CONSTRAINT IF EXISTS fk_wallet_ledger_user`);
    await execute(sql`
      DO $$ BEGIN
        ALTER TABLE wallet_ledger ADD CONSTRAINT fk_wallet_ledger_user
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
  }

  // B8-03: money invariants as CHECK constraints (count-then-add each).
  const checkConstraints: Array<{
    name: string;
    table: string;
    check: string;
    violation: string;
  }> = [
    {
      name: "chk_users_wallet_balance_nonneg",
      table: "users",
      check: "wallet_balance >= 0",
      violation: "wallet_balance < 0",
    },
    {
      name: "chk_coupons_used_le_max",
      table: "coupons",
      check: "max_uses IS NULL OR used_count <= max_uses",
      violation: "max_uses IS NOT NULL AND used_count > max_uses",
    },
    {
      name: "chk_topups_amount_pos",
      table: "wallet_topups",
      check: "amount > 0",
      violation: "amount <= 0",
    },
    {
      // V1-M10 (round-93 A2 finding #1 + A7 §2 P1, live-DB confirmed):
      // the stage originally shipped `amount > 0` as
      // chk_ledger_amount_pos, but adjustments store SIGNED deltas
      // (adjustment.service.ts: amount = balanceAfter - balanceBefore),
      // so the first admin debit (-30) would abort the whole tx with
      // 23514 → generic 500 on PATCH /admin/users/:id (fail-closed, but
      // the only fraud/mistake correction tool was dead). Replaced by a
      // sign-free nonzero invariant — magnitude conventions stay enforced
      // at the service layer where the type-specific semantics live, and
      // the balance reconstruction (balanceAfter - balanceBefore) keeps
      // working exactly. V1-M10 below drops the legacy-named constraint
      // on databases that already carry it.
      name: "chk_ledger_amount_nonzero",
      table: "wallet_ledger",
      check: "amount <> 0",
      violation: "amount = 0",
    },
  ];
  for (const { name, table, check, violation } of checkConstraints) {
    const violations = extractCount(
      await execute(sql.raw(`SELECT count(*) AS c FROM ${table} WHERE ${violation}`)),
    );
    if (violations > 0) {
      await alertMoneyConstraintIssue(
        `بيانات تخالف قيد ${name} (V1-M9)`,
        `Found ${violations} existing row(s) violating ${name} on ${table} — constraint NOT added. Fix the data, then reboot to apply it.`,
        `db:constraint:${name}`,
      );
      continue;
    }
    await execute(
      sql.raw(`
        DO $$ BEGIN
          ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${check});
        EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
      `),
    );
  }

  // B8-10: four indexes declared by the schema TS (and drizzle 0000) that
  // the boot SQL never created. Trivial on current row counts; covering
  // composites for the admin "status + newest-first" lists as they grow.
  await execute(
    sql`CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status, created_at)`,
  );
  await execute(
    sql`CREATE INDEX IF NOT EXISTS idx_topups_status_created ON wallet_topups(status, created_at)`,
  );
  await execute(
    sql`CREATE INDEX IF NOT EXISTS idx_inventory_product_sold ON inventory(product_id, is_sold)`,
  );
  await execute(sql`CREATE INDEX IF NOT EXISTS idx_cart_items_user ON cart_items(user_id)`);
}

/**
 * V1-M10 (round-93 A2 finding #1 + A7 §2 P1 — live-DB confirmed): replace
 * the V1-M9 `chk_ledger_amount_pos` (amount > 0) with `amount <> 0`.
 *
 * wallet_ledger's two writer conventions collide under the old CHECK:
 * purchases/refunds/topups store POSITIVE magnitudes with the sign carried
 * by `type`, while adjustment rows store SIGNED deltas
 * (adjustment.service.ts: `amount = balanceAfter - balanceBefore`). The
 * first admin debit (or setBalance lowering the balance) wrote a negative
 * amount → SQLSTATE 23514 → the whole atomic tx rolled back (money stayed
 * consistent — Principle I held) → generic 500 on the admin users endpoint.
 * A7 verified the live DB at 1998c22: `chk_ledger_amount_pos` live, zero
 * adjustment rows written yet — an armed time bomb, not an incident.
 *
 * Stage shape mirrors V1-M9 exactly (probe → alert instead of a failed
 * ALTER; idempotent re-runs; single statements so the pglite harness can
 * run it):
 *   1. If any row already carries amount = 0 (nothing in the codebase
 *      writes those — ZERO_DELTA is rejected before the DB), alert and
 *      skip: the operator fixes the data, the next boot applies the
 *      constraint.
 *   2. DROP the legacy-named constraint (no-op where it never existed —
 *      fresh installs, pglite harness).
 *   3. ADD chk_ledger_amount_nonzero via the duplicate_object-swallowing
 *      DO block (applyMoneyConstraintStage's array owns the fresh-install
 *      creation; this re-add is the belt for environments that somehow ran
 *      a partial boot between the two).
 *
 * chk_users_wallet_balance_nonneg (negative-balance protection) is
 * untouched: V1-M9 still applies it every boot before this stage runs,
 * and no statement here touches users.
 *
 * Exported with an injectable executor for unit tests (migrate-v1m10).
 */
export async function applyLedgerAmountNonzeroStage(
  execute: SqlExecutor = defaultExecutor,
): Promise<void> {
  const zeroAmountRows = extractCount(
    await execute(sql`SELECT count(*) AS c FROM wallet_ledger WHERE amount = 0`),
  );
  if (zeroAmountRows > 0) {
    await alertMoneyConstraintIssue(
      "قيود دفتر مالية V1-M10",
      `Found ${zeroAmountRows} wallet_ledger row(s) with amount = 0 — chk_ledger_amount_nonzero NOT added and the legacy chk_ledger_amount_pos NOT dropped. Fix the data, then reboot to apply the migration.`,
      "db:constraint:chk_ledger_amount_nonzero",
    );
    return;
  }

  // The rename itself. DROP IF EXISTS keeps it idempotent: databases that
  // already carry the legacy name (the live Neon DB) transition on the
  // first boot; every later boot is a no-op.
  await execute(sql`ALTER TABLE wallet_ledger DROP CONSTRAINT IF EXISTS chk_ledger_amount_pos`);

  // Belt for the ADD (the V1-M9 stage's array adds it on the same boot,
  // just before this runs) — duplicate_object swallow = idempotent.
  await execute(sql`
    DO $$ BEGIN
      ALTER TABLE wallet_ledger ADD CONSTRAINT chk_ledger_amount_nonzero
        CHECK (amount <> 0);
    EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
  `);
}

// ── users column reconcile (F1, round-94 A6) ──────────────────────────────
//
// The old block here was one bare `ALTER TABLE users ADD COLUMN IF NOT
// EXISTS github_id, …, ADD COLUMN IF NOT EXISTS last_auth_at` issued
// unconditionally on EVERY boot, followed (same boot!) by Stage C dropping
// the legacy subset again — 8 ALTER TABLEs on `users` per cold start
// forever, each taking a momentary AccessExclusiveLock on the table behind
// every login, and each widening the read-only-window 25006 retry surface
// for zero schema change (the B7-P0-1 class of failure).
//
// Fix shape mirrors ensurePgTrgmExtension: ONE information_schema probe
// decides what is genuinely missing; the ALTER is issued ONLY then. On a
// steady-state boot (all final columns present, Stage C already applied)
// this stage executes ZERO DDL statements against `users` — the probe is a
// catalog read, permitted even on a read-only standby.
//
// Column split:
//   - FINAL columns (survive Stage C): reconciled whenever missing.
//   - TRANSIENT columns (dropped by Stage C: github_id / facebook_id /
//     password_login_enabled / legacy_password_disabled_at): only ever
//     (re-)created while `password_hash` still exists — the "Stage C has
//     not run yet" marker. After Stage C drops them they must never be
//     resurrected; that resurrection+redrop churn is exactly the bug.
export async function applyUsersColumnReconcileStage(
  execute: SqlExecutor = defaultExecutor,
): Promise<void> {
  const probeRows = extractRows(
    await execute(sql`
      SELECT column_name AS column_name
      FROM information_schema.columns
      WHERE table_name = 'users'
    `),
  );
  const present = new Set(probeRows.map((row) => String(row.column_name)));

  const toAdd: string[] = [];
  for (const [name, definition] of USERS_FINAL_COLUMN_DDL) {
    if (!present.has(name)) toAdd.push(`ADD COLUMN IF NOT EXISTS ${name} ${definition}`);
  }
  if (present.has("password_hash")) {
    // Pre-Stage-C database: the transient provider/password columns are
    // still legitimate (the legacy-data migration below reads them).
    for (const [name, definition] of USERS_TRANSIENT_COLUMN_DDL) {
      if (!present.has(name)) toAdd.push(`ADD COLUMN IF NOT EXISTS ${name} ${definition}`);
    }
  }
  if (toAdd.length > 0) {
    // IF NOT EXISTS kept even after the probe — belt against a catalog
    // drift between probe and ALTER (every statement idempotent).
    await execute(sql.raw(`ALTER TABLE users ${toAdd.join(", ")}`));
  }
}

/** Columns the FINAL (post-Stage-C) users schema carries. */
const USERS_FINAL_COLUMN_DDL: Array<[name: string, definition: string]> = [
  ["telegram_id", "VARCHAR(255) UNIQUE"],
  ["firebase_uid", "VARCHAR(255)"],
  ["email", "VARCHAR(255)"],
  ["email_verified", "BOOLEAN NOT NULL DEFAULT FALSE"],
  ["phone_verified", "BOOLEAN NOT NULL DEFAULT FALSE"],
  ["display_name", "VARCHAR(255)"],
  ["photo_url", "TEXT"],
  ["auth_provider", "VARCHAR(50) NOT NULL DEFAULT 'legacy_password'"],
  ["last_auth_at", "TIMESTAMPTZ"],
];

/** Transient legacy columns — exist only between CREATE TABLE and Stage C. */
const USERS_TRANSIENT_COLUMN_DDL: Array<[name: string, definition: string]> = [
  ["github_id", "VARCHAR(255) UNIQUE"],
  ["facebook_id", "VARCHAR(255) UNIQUE"],
  ["password_login_enabled", "BOOLEAN NOT NULL DEFAULT TRUE"],
  ["legacy_password_disabled_at", "TIMESTAMPTZ"],
];

/**
 * Stage C (F1, round-94 A6): drop the legacy password infrastructure —
 * same statements as before, but ONLY when at least one of the columns
 * actually exists. Steady-state boots issue zero DDL on `users` (the old
 * five `DROP COLUMN IF EXISTS` were five no-op ALTER TABLE statements —
 * each still an AccessExclusiveLock — on every cold start forever).
 * The legacy `otps` table gets the same catalog-probe treatment.
 */
export async function applyUsersPasswordlessCleanupStage(
  execute: SqlExecutor = defaultExecutor,
): Promise<void> {
  const probeRows = extractRows(
    await execute(sql`
      SELECT column_name AS column_name
      FROM information_schema.columns
      WHERE table_name = 'users'
    `),
  );
  const present = new Set(probeRows.map((row) => String(row.column_name)));

  const toDrop = USERS_TRANSIENT_COLUMN_DDL.map(([name]) => name)
    .concat("password_hash")
    .filter((name) => present.has(name));
  if (toDrop.length > 0) {
    // Single statement: one lock acquisition instead of five, and atomic
    // (mid-statement crash cannot leave a half-cleaned table).
    await execute(sql.raw(`ALTER TABLE users ${toDrop.map((c) => `DROP COLUMN ${c}`).join(", ")}`));
  }

  const otpsRows = extractRows(
    await execute(sql`
      SELECT 1 AS present FROM information_schema.tables
      WHERE table_name = 'otps'
    `),
  );
  if (otpsRows.length > 0) {
    await execute(sql`DROP TABLE otps`);
  }
}

// ── V1-M12 (round-94 A4/C4/C6): durable idempotency for the money path ────
//
// `idempotency_keys` is the transactional backstop for POST /api/orders
// (F10, round-94 A4): the purchase transaction claims the user-scoped key
// atomically with the order + ledger inserts, so a client retry with the
// same key can never create a second order or a second wallet debit —
// regardless of Redis state (the HTTP middleware's 24h-TTL cache is soft).
//
// Column names/types are pinned to shared/db/src/schema/idempotency-keys.ts
// and backend/src/lib/idempotency.ts VERBATIM (key text PK, order_id
// integer NOT NULL → orders(id) ON DELETE CASCADE, created_at timestamptz
// NOT NULL DEFAULT now()); the service tolerates the table's absence
// (SQLSTATE 42P01 → legacy pass-through) so deploy ordering never blocks,
// and a mismatch would break that contract silently — hence the DO-block
// existence probe (idempotent re-runs, pglite-harness compatible) instead
// of a bare CREATE TABLE.
export async function applyIdempotencyKeysStage(
  execute: SqlExecutor = defaultExecutor,
): Promise<void> {
  await execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name = 'idempotency_keys'
      ) THEN
        CREATE TABLE idempotency_keys (
          key        TEXT PRIMARY KEY,
          order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      END IF;
    END $$;
  `);
  await execute(sql`
    CREATE INDEX IF NOT EXISTS idx_idempotency_keys_order ON idempotency_keys(order_id);
  `);
}

// ── V1-M13 (round-94 A8): revocable admin sessions ─────────────────────
//
// A8-01: admin JWTs are now paired with an admin_sessions row; the
// token carries a `sid` and requireAdmin re-validates the row (revoked
// / expired row ⇒ dead token). Logout revokes one row; change-password
// and is_active flips kill them all. Column names/types are pinned to
// shared/db/src/schema/admin-sessions.ts + backend/src/lib/admin-session.ts
// VERBATIM. Same DO-block existence probe as V1-M12 for idempotent
// re-runs + pglite compatibility.
export async function applyAdminSessionsStage(
  execute: SqlExecutor = defaultExecutor,
): Promise<void> {
  await execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name = 'admin_sessions'
      ) THEN
        CREATE TABLE admin_sessions (
          id             VARCHAR(64) PRIMARY KEY,
          admin_id       INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
          created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
          expires_at     TIMESTAMPTZ NOT NULL,
          revoked_at     TIMESTAMPTZ,
          revoked_reason VARCHAR(100),
          last_seen_at   TIMESTAMPTZ,
          user_agent     VARCHAR(255),
          ip_address     VARCHAR(45)
        );
      END IF;
    END $$;
  `);
  await execute(sql`
    CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin ON admin_sessions(admin_id);
  `);
}

// ── V1-M14 (round-97 F7, R97-DB-01/A6): official registration of the two ────
// lazily-created round-97 tables.
//
// 97-F1 (pg-leader-lease.ts) and 97-F2 (account-link-consent.ts) both
// CREATE their backing table lazily with `CREATE TABLE IF NOT EXISTS` at
// first use — self-sufficient on every deploy ordering. This stage makes
// the registration OFFICIAL (the audit's rule: every live table must be
// owned by migrate.ts) with the exact same column shapes, pinned VERBATIM
// to the lazy DDL sources (backend/src/lib/pg-leader-lease.ts
// CREATE_LEASE_TABLE_SQL + backend/src/lib/account-link-consent.ts
// ensurePgConsentTable) and mirrored in shared/db/src/schema/
// scheduler-leader-lease.ts + account-link-consents.ts.
//
// Same DO-block existence probe as V1-M12/M13: idempotent re-runs, no
// bare CREATE TABLE against an already-migrated (or already lazily
// bootstrapped) database, pglite-harness compatible.
//
// NOTE on numbering: the round-97 repair plan called these stages
// "V1-M9/M10", but those labels were already taken by the round-92/93
// money-constraint stages — reusing them would put two different
// migrations under one label. This wave therefore registers as V1-M14 /
// V1-M15 (the next free numbers after V1-M12/M13).
export async function applySchedulerLeaseAndConsentTablesStage(
  execute: SqlExecutor = defaultExecutor,
): Promise<void> {
  await execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name = 'scheduler_leader_lease'
      ) THEN
        CREATE TABLE scheduler_leader_lease (
          id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
          holder text NOT NULL,
          expires_at timestamptz NOT NULL
        );
      END IF;
    END $$;
  `);
  await execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name = 'account_link_consents'
      ) THEN
        CREATE TABLE account_link_consents (
          token text PRIMARY KEY,
          candidate_user_id integer NOT NULL,
          firebase_uid_hash text NOT NULL,
          expires_at timestamptz NOT NULL
        );
      END IF;
    END $$;
  `);
}

// ── V1-M15 (round-97 F7, R97-DB-02 + R97-DB-04): ticket_replies drift ───────
// closure + duplicate users.firebase_uid index cleanup.
//
// R97-DB-02 (D1/D2): shared/db/src/schema/ticket_replies.ts has ALWAYS
// declared `ticket_id → support_tickets(id) ON DELETE CASCADE` +
// `idx_replies_ticket (ticket_id, created_at)`, but the boot SQL here never
// created either (the CREATE TABLE at the top has no inline FK and the
// fkStatements list below ignored the table). Result on the live DB: pkey
// only, Seq Scan on every ticket-replies lookup, and 2 orphaned reply rows
// (round-94 simulation replies whose tickets #2/#3 were later deleted —
// exactly the fate awaiting any future ticket/user delete). Closure:
//   1. count-probe orphans → DELETE + log (data fix BEFORE the constraint
//      so the ALTER's validation scan passes);
//   2. ADD CONSTRAINT fk_replies_ticket via the same DO-block
//      duplicate_object-swallow pattern as the other fkStatements;
//   3. CREATE INDEX IF NOT EXISTS idx_replies_ticket (same statement shape
//      the index block below uses for every other table).
//
// R97-DB-04 (D4): `users` carries THREE firebase_uid indexes — the column
// UNIQUE constraint backing index `users_firebase_uid_key` (kept — it
// enforces the uniqueness the auth layer relies on) plus two structural
// duplicates `idx_users_firebase_uid` (plain) and
// `idx_users_firebase_uid_unique` (partial UNIQUE) that predate the column
// constraint and only add INSERT-time maintenance cost. The duplicate
// CREATEs were removed from the users index block inside runMigrations;
// this stage drops the leftovers on already-migrated databases,
// probe-gated so steady-state boots issue ZERO DDL (same rationale as
// applyUsersColumnReconcileStage).
export async function applyTicketRepliesDriftClosureStage(
  execute: SqlExecutor = defaultExecutor,
): Promise<void> {
  // 1. Orphaned replies — replies whose ticket no longer exists. The
  //    count-probe keeps steady-state boots read-only; the DELETE only
  //    fires when the pre-FK drift actually left rows behind.
  const orphanCount = extractCount(
    await execute(sql`
      SELECT count(*) AS c FROM ticket_replies r
      WHERE NOT EXISTS (SELECT 1 FROM support_tickets t WHERE t.id = r.ticket_id)
    `),
  );
  if (orphanCount > 0) {
    const deletedRows = extractRows(
      await execute(sql`
        DELETE FROM ticket_replies AS r
        WHERE NOT EXISTS (SELECT 1 FROM support_tickets t WHERE t.id = r.ticket_id)
        RETURNING r.id AS id
      `),
    );
    logger.info(
      { category: "storage", deleted: deletedRows.length },
      "V1-M15: deleted orphaned ticket_replies rows before adding fk_replies_ticket",
    );
  }

  // 2. FK — identical guard shape to the fkStatements loop below.
  await execute(sql`
    DO $$ BEGIN
      ALTER TABLE ticket_replies
        ADD CONSTRAINT fk_replies_ticket
        FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);

  // 3. Serving index — mirrors schema TS ticket_replies.ts:19-21 (and the
  //    test harness DDL) exactly: (ticket_id, created_at).
  await execute(sql`
    CREATE INDEX IF NOT EXISTS idx_replies_ticket
      ON ticket_replies(ticket_id, created_at);
  `);

  // 4. R97-DB-04 duplicate firebase_uid index cleanup (probe-gated —
  //    steady-state boots send no DROP statements at all).
  const duplicateIdxRows = extractRows(
    await execute(sql`
      SELECT indexname AS indexname FROM pg_indexes
      WHERE tablename = 'users'
        AND indexname IN ('idx_users_firebase_uid', 'idx_users_firebase_uid_unique')
    `),
  );
  if (duplicateIdxRows.length > 0) {
    await execute(sql`DROP INDEX IF EXISTS idx_users_firebase_uid`);
    await execute(sql`DROP INDEX IF EXISTS idx_users_firebase_uid_unique`);
    logger.info(
      { category: "storage", dropped: duplicateIdxRows.map((r) => String(r.indexname)) },
      "V1-M15: dropped duplicate users.firebase_uid indexes (users_firebase_uid_key stays)",
    );
  }

  // 5. AUD103-1-F4 (r103): drop the redundant partial idx_users_referral_code
  //    — the column's UNIQUE constraint backing index (users_referral_code_key)
  //    already serves every lookup; the partial only added write maintenance
  //    (the last surviving sibling of the R97-DB-04 duplicate pattern).
  //    Probe-gated like the block above: steady-state boots send no DDL.
  const referralIdxRows = extractRows(
    await execute(sql`
      SELECT indexname AS indexname FROM pg_indexes
      WHERE tablename = 'users'
        AND indexname = 'idx_users_referral_code'
    `),
  );
  if (referralIdxRows.length > 0) {
    await execute(sql`DROP INDEX IF EXISTS idx_users_referral_code`);
    logger.info(
      { category: "storage" },
      "r103: dropped redundant idx_users_referral_code (users_referral_code_key stays)",
    );
  }
}

// ── V1-M16 (catalog reconstruction 2026-09-20): product_variants + ──────────
// additive variant wiring across orders/inventory/cart_items + products SEO
// columns. This is the structural backbone of the Retail catalog rebuild:
// the sourcing supplier structures every product as
// Product → Plan → Validity → Price, and mirroring that structure in
// SubNation is the only way to avoid duplicate brand rows (the pre-2026-09-20
// Disney×2 / MS365×2 / PS Plus×3 problem).
//
// Everything here is ADDITIVE and idempotent:
//   1. product_variants table (+ indexes + UNIQUE(product, plan, duration));
//   2. products.seo_title / products.seo_description (nullable overrides);
//   3. orders.variant_id (FK SET NULL) + orders.variant_label — the label is
//      an immutable historical copy, mirroring the delivered_* contract;
//   4. inventory.variant_id (FK SET NULL) — nullable for legacy
//      undifferentiated stock;
//   5. cart_items.variant_id + variant_label (the 2-column UNIQUE
//      (user_id, product_id) is deliberately KEPT — replace-variant
//      semantics in the cart route, no index surgery);
//   6. No backfill: variant-less products keep working through the legacy
//      product-level price path (checkout falls back when variant_id is
//      absent) — zero impact on existing orders/stock.
export async function applyProductVariantsStage(
  execute: SqlExecutor = defaultExecutor,
): Promise<void> {
  // 1. The variants table itself.
  await execute(sql`
    CREATE TABLE IF NOT EXISTS product_variants (
      id             SERIAL PRIMARY KEY,
      product_id     INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      plan_label     VARCHAR(120),
      duration_label VARCHAR(120),
      duration_days  INTEGER,
      cost_price     NUMERIC(10,2) NOT NULL,
      price_lyd      NUMERIC(10,2) NOT NULL,
      sku            VARCHAR(160),
      is_active      BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order     INTEGER NOT NULL DEFAULT 0,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await execute(sql`
    CREATE INDEX IF NOT EXISTS idx_product_variants_product
      ON product_variants (product_id);
  `);
  await execute(sql`
    CREATE INDEX IF NOT EXISTS idx_product_variants_product_active
      ON product_variants (product_id, is_active);
  `);
  await execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_product_variants_plan_duration
      ON product_variants (product_id, plan_label, duration_label);
  `);

  // 2. products SEO overrides + features checklist (nullable — fallback contract unchanged).
  await execute(sql`
    ALTER TABLE products
      ADD COLUMN IF NOT EXISTS seo_title VARCHAR(200),
      ADD COLUMN IF NOT EXISTS seo_description VARCHAR(320),
      ADD COLUMN IF NOT EXISTS features JSONB;
  `);

  // 3. orders: variant reference + immutable historical label.
  await execute(sql`
    ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS variant_id INTEGER,
      ADD COLUMN IF NOT EXISTS variant_label VARCHAR(240);
  `);
  await execute(sql`
    DO $$ BEGIN
      ALTER TABLE orders
        ADD CONSTRAINT fk_orders_variant
        FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);
  await execute(sql`
    CREATE INDEX IF NOT EXISTS idx_orders_variant ON orders (variant_id);
  `);

  // 4. inventory: variant-scoped stock (nullable for legacy units).
  await execute(sql`
    ALTER TABLE inventory
      ADD COLUMN IF NOT EXISTS variant_id INTEGER;
  `);
  await execute(sql`
    DO $$ BEGIN
      ALTER TABLE inventory
        ADD CONSTRAINT fk_inventory_variant
        FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);
  await execute(sql`
    CREATE INDEX IF NOT EXISTS idx_inventory_variant ON inventory (variant_id);
  `);

  // 5. cart_items: variant columns; the existing 2-column UNIQUE stays
  //    (see schema/cart.ts for the replace-variant rationale).
  await execute(sql`
    ALTER TABLE cart_items
      ADD COLUMN IF NOT EXISTS variant_id INTEGER,
      ADD COLUMN IF NOT EXISTS variant_label VARCHAR(240);
  `);
  await execute(sql`
    DO $$ BEGIN
      ALTER TABLE cart_items
        ADD CONSTRAINT fk_cart_items_variant
        FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE CASCADE;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);
}

// ── V1-M17 (round-98 F4, R98-DB-05): uniq_product_variants_plan_duration ────
// NULLS NOT DISTINCT rebuild.
//
// V1-M16 created the unique index WITHOUT nulls-distinctness, and PG
// btree UNIQUE treats NULLs as distinct — two concurrent admin creates
// of (product, 'Family', NULL) both passed the route's pre-tx dupe probe
// (IS NOT DISTINCT FROM, product-variants.ts) and both inserted; the
// schema docstring even claimed an ''-normalization the code never did.
// The live invariant is now owned by the INDEX, not the probe.
//
// Data safety (main-agent verified live, round-98): ZERO exact duplicate
// rows on (product_id, plan_label, duration_label) including NULL-equal
// comparisons, so the DROP + CREATE rebuild cannot fail validation.
//
// Guard shape mirrors V1-M15's duplicate-index cleanup: pg_indexes is
// probed first (indexdef text), and steady-state boots — index already
// carries NULLS NOT DISTINCT — issue ZERO DDL. The DROP/CREATE pair runs
// exactly once per environment (first boot after this deploy). V1-M16's
// own CREATE ... IF NOT EXISTS keeps no-op'ing afterwards: IF NOT EXISTS
// does not compare definitions, so it never re-creates the plain form.
export async function applyProductVariantsNullsNotDistinctStage(
  execute: SqlExecutor = defaultExecutor,
): Promise<void> {
  const indexRows = extractRows(
    await execute(sql`
      SELECT indexdef AS indexdef FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename = 'product_variants'
        AND indexname = 'uniq_product_variants_plan_duration'
    `),
  );
  const indexdef = String(indexRows[0]?.indexdef ?? "");
  if (indexdef.includes("NULLS NOT DISTINCT")) return; // steady state

  // AUD103-1-F5 (r103): pre-probe for NULL-equal duplicates before the
  // rebuild — the CREATE throws on duplicates and a critical migration
  // failure aborts production boot (503 crash-loop) until manual dedup.
  // The V1-M9 house pattern: probe → alert → skip. Standard GROUP BY
  // already treats NULLs as equal, so any hit here is a NULL-equal
  // collision (non-null duplicates are impossible under the live plain
  // UNIQUE). Verified 0 duplicates live at r98/r103 — pure defense
  // against the documented R98-DB-05 API race.
  const dupRows = extractRows(
    await execute(sql`
      SELECT product_id, plan_label, duration_label, COUNT(*) AS n
      FROM product_variants
      GROUP BY product_id, plan_label, duration_label
      HAVING COUNT(*) > 1
    `),
  );
  if (dupRows.length > 0) {
    // r110 (109-e P2-1): same tracker discipline as the alertMoneyConstraint
    // paths — a skipped rebuild must block the fast-path marker for this run.
    recordConstraintSkip("db:constraint:uniq_product_variants_plan_duration");
    logger.error(
      { category: "storage", duplicates: dupRows.length },
      "V1-M17 SKIPPED: NULL-equal duplicate variant rows found — dedupe manually, then reboot to apply NULLS NOT DISTINCT",
    );
    return;
  }

  await execute(sql`DROP INDEX IF EXISTS uniq_product_variants_plan_duration`);
  await execute(sql`
    CREATE UNIQUE INDEX uniq_product_variants_plan_duration
      ON product_variants (product_id, plan_label, duration_label)
      NULLS NOT DISTINCT;
  `);
  logger.info(
    { category: "storage" },
    "V1-M17: rebuilt uniq_product_variants_plan_duration with NULLS NOT DISTINCT",
  );
}

// ── V1-M18 (R102, provider-readiness): provider_fulfillments table ───────
// + the provider-order idempotency index.
//
// The provider abstraction seam (services/providers/): one row per
// fulfillment attempt per order. Records WHO fulfilled WHAT and AGAINST
// WHICH provider order — the durable, auditable relation the external
// provider phase needs. Fully additive: no existing table is touched;
// the manual path writes 'succeeded' rows in the purchase transaction.
//
// The UNIQUE (provider, provider_order_id) index is the provider-level
// idempotency anchor — PLAIN unique semantics (default NULLS DISTINCT,
// deliberately NOT V1-M17's NULLS NOT DISTINCT): the non-null half
// makes one provider order attachable to exactly ONE SubNation order
// (race-proof at the DB level), while distinct NULLs let any number of
// manual rows (which never carry a provider order id) coexist — one per
// order. The first R102 draft shipped NULLS NOT DISTINCT and the
// checkout suite caught it on the second-ever manual purchase:
// (manual, NULL) collided. Own the SEMANTIC, not the idiom.
export async function applyProviderFulfillmentsStage(
  execute: SqlExecutor = defaultExecutor,
): Promise<void> {
  await execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'provider_fulfillment_status') THEN
        CREATE TYPE provider_fulfillment_status AS ENUM ('pending', 'succeeded', 'failed');
      END IF;
    END $$;
  `);
  await execute(sql`
    CREATE TABLE IF NOT EXISTS provider_fulfillments (
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      provider VARCHAR(32) NOT NULL DEFAULT 'manual',
      attempt INTEGER NOT NULL DEFAULT 1,
      status provider_fulfillment_status NOT NULL,
      provider_order_id VARCHAR(255),
      error_code VARCHAR(64),
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await execute(sql`
    CREATE INDEX IF NOT EXISTS idx_provider_fulfillments_order
      ON provider_fulfillments (order_id);
  `);
  await execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_provider_fulfillments_provider_order
      ON provider_fulfillments (provider, provider_order_id);
  `);
  logger.info(
    { category: "storage" },
    "V1-M18: provider_fulfillments table + provider-order idempotency index",
  );
}

// ── V1-M19 (R102, loyalty durable guard): idempotency_keys generalized ────
// for non-order money intents.
//
// order_id becomes NULLABLE and a reference_type discriminator is added
// (default 'order' — every existing row backfills automatically, the
// checkout claim path is byte-identical). The loyalty convert-points
// route claims the same table with (NULL, 'loyalty.convert') so the
// last Redis-only client-money write gains the durable, transactional
// backstop checkout has had since F10: during a Redis outage, a lost
// response + retry can no longer double-convert points.
// Additive + idempotent (ALTER ... DROP NOT NULL and ADD COLUMN IF NOT
// EXISTS are both no-ops on re-runs).
export async function applyIdempotencyReferenceTypeStage(
  execute: SqlExecutor = defaultExecutor,
): Promise<void> {
  await execute(sql`
    ALTER TABLE idempotency_keys
      ALTER COLUMN order_id DROP NOT NULL;
  `);
  await execute(sql`
    ALTER TABLE idempotency_keys
      ADD COLUMN IF NOT EXISTS reference_type VARCHAR(32) NOT NULL DEFAULT 'order';
  `);
  logger.info(
    { category: "storage" },
    "V1-M19: idempotency_keys generalized (nullable order_id + reference_type)",
  );
}

// ── V1-M20 (R108, final-hardening FH-A7 P0): idempotency_keys FK drop ──────
//
// `order_id` became a POLYMORPHIC reference in R102 (discriminated by
// `reference_type`), and R104's wallet topup-create durable claim
// (routes/wallet.ts) writes a `wallet_topups.id` into it — but V1-M12
// created the column with `REFERENCES orders(id) ON DELETE CASCADE` and
// V1-M19 only dropped NOT NULL, never the FK. Any topup whose serial id
// has no matching `orders` row → SQLSTATE 23503 → the entire submission
// transaction (topup INSERT included) rolls back → topup submission 500s.
// The 2026-09-22 deep audit proved this would have fired on the FIRST
// live topup after the Oracle/Coolify cutover (the claim code never ran
// in production — last live build predated r104).
//
// The fix: drop the FK. Referential integrity for the polymorphic column
// is app-owned — each intent's claim site knows its own id space
// (checkout → orders.id, wallet → wallet_topups.id, loyalty → NULL),
// the same contract the loyalty path has used since R102. The drizzle
// declaration (shared/db/src/schema/idempotency-keys.ts) drops
// `.references()` in lockstep so introspection/push cannot re-create it.
//
// Two layers, both idempotent:
//   1. `DROP CONSTRAINT IF EXISTS` for the default constraint name.
//   2. A DO-block probe that drops ANY remaining FK on the column
//      regardless of name (guards against non-default names from
//      hand-provisioned environments).
// No data is touched; the column + its index stay exactly as they are.
export async function applyIdempotencyDropOrderFkStage(
  execute: SqlExecutor = defaultExecutor,
): Promise<void> {
  await execute(sql`
    ALTER TABLE idempotency_keys
      DROP CONSTRAINT IF EXISTS idempotency_keys_order_id_fkey;
  `);
  await execute(sql`
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
          AND con.conrelid = 'idempotency_keys'::regclass
          AND a.attname = 'order_id'
      LOOP
        EXECUTE format('ALTER TABLE idempotency_keys DROP CONSTRAINT %I', fk_name);
      END LOOP;
    END $$;
  `);
  logger.info(
    { category: "storage" },
    "V1-M20: idempotency_keys.order_id FK dropped (polymorphic reference — integrity app-owned)",
  );
}

// ── V1-M21 (R115): points_ledger + users.welcome_bonus_granted ────────────
// + users.loyalty_points >= 0 CHECK.
//
// Loyalty attribution ledger (audit finding A1-P2: 4 of 6 point-mutation
// sites left no durable record; the balance was unauditable). Append-only,
// same-transaction inserts at every writer. Structural guards:
//   points_after = points_before + points_delta (arithmetic integrity)
//   points_delta <> 0, both balances >= 0
//   partial UNIQUE (type, reference_id) WHERE reference_id IS NOT NULL
//     → exactly one purchase_award / refund_reversal per order, one
//     referral_credit per referral_event, one conversion_out per
//     wallet_ledger row (double-grant structurally impossible)
//   reason required for admin_set / correction
//
// users.welcome_bonus_granted: the exactly-once guard for the R115 unified
// welcome-bonus policy (grant on FIRST APPROVED TOPUP, all channels).
// Backfill: referred users whose wallet_ledger already carries a
// referral_signup credit got the bonus pre-R115 → flag them true so the
// topup path never double-pays.
//
// users CHECK loyalty_points >= 0: probe-gated (V1-M9 discipline — alert +
// skip, never break boot on legacy dirt; live recon 2026-09-29: 0 negative
// balances). The CHECK joins the same constraint family V1-M9 built for
// the money tables — points are LYD-convertible at 100:1, so a negative
// balance is money creation.
export async function applyPointsLedgerStage(
  execute: SqlExecutor = defaultExecutor,
): Promise<void> {
  await execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'points_ledger_type') THEN
        CREATE TYPE points_ledger_type AS ENUM (
          'purchase_award', 'refund_reversal', 'referral_credit',
          'conversion_out', 'admin_set', 'correction'
        );
      END IF;
    END $$;
  `);
  await execute(sql`
    CREATE TABLE IF NOT EXISTS points_ledger (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type points_ledger_type NOT NULL,
      points_delta INTEGER NOT NULL,
      points_before INTEGER NOT NULL,
      points_after INTEGER NOT NULL,
      lyd_credited NUMERIC(10,2),
      reference_id INTEGER,
      reference_type VARCHAR(50),
      actor_admin_id INTEGER,
      reason VARCHAR(500),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT chk_points_ledger_arithmetic
        CHECK (points_after = points_before + points_delta),
      CONSTRAINT chk_points_ledger_delta_nonzero
        CHECK (points_delta <> 0),
      CONSTRAINT chk_points_ledger_balances_nonneg
        CHECK (points_before >= 0 AND points_after >= 0),
      CONSTRAINT chk_points_ledger_reason_for_manual
        CHECK (type NOT IN ('admin_set', 'correction') OR reason IS NOT NULL)
    );
  `);
  await execute(sql`
    CREATE INDEX IF NOT EXISTS idx_points_ledger_user ON points_ledger (user_id);
  `);
  await execute(sql`
    CREATE INDEX IF NOT EXISTS idx_points_ledger_type ON points_ledger (type);
  `);
  await execute(sql`
    CREATE INDEX IF NOT EXISTS idx_points_ledger_user_created
      ON points_ledger (user_id, created_at);
  `);
  await execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_points_ledger_type_reference
      ON points_ledger (type, reference_id)
      WHERE reference_id IS NOT NULL;
  `);
  // users.welcome_bonus_granted + backfill from the pre-R115 evidence.
  await execute(sql`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS welcome_bonus_granted
      BOOLEAN NOT NULL DEFAULT false;
  `);
  await execute(sql`
    UPDATE users u
    SET welcome_bonus_granted = true
    WHERE u.referred_by IS NOT NULL
      AND NOT u.welcome_bonus_granted
      AND EXISTS (
        SELECT 1 FROM wallet_ledger l
        WHERE l.user_id = u.id
          AND l.type = 'referral_credit'
          AND l.reference_type = 'referral_signup'
      );
  `);
  // loyalty_points >= 0 — probe-gated (V1-M9 discipline).
  const negRows = extractRows(
    await execute(sql`
      SELECT COUNT(*)::int AS n FROM users WHERE loyalty_points < 0
    `),
  );
  const negCount = Number(negRows[0]?.n ?? 0);
  if (negCount > 0) {
    recordConstraintSkip("db:constraint:chk_users_loyalty_points_nonneg");
    logger.error(
      { category: "storage", negative: negCount },
      "V1-M21 SKIPPED users CHECK: negative loyalty_points rows exist — reconcile manually, then reboot to apply",
    );
  } else {
    await execute(sql`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'users'::regclass
            AND conname = 'chk_users_loyalty_points_nonneg'
        ) THEN
          ALTER TABLE users
            ADD CONSTRAINT chk_users_loyalty_points_nonneg
            CHECK (loyalty_points >= 0);
        END IF;
      END $$;
    `);
  }
  // Opening-balance corrections: one row per user whose balance predates
  // the ledger. NO fabricated history (A11's decision): the opening row
  // anchors Σdeltas = balance; per-event history starts from now.
  // R115-R1 P0 FIX: zero-point users are EXCLUDED — chk_points_ledger_
  // delta_nonzero forbids delta 0, and every never-earned signup would
  // otherwise abort the whole INSERT...SELECT (SQLSTATE 23514 → critical
  // boot failure). Their first earned point writes their first row.
  await execute(sql`
    INSERT INTO points_ledger
      (user_id, type, points_delta, points_before, points_after,
       reference_type, reason)
    SELECT u.id, 'correction', u.loyalty_points, 0, u.loyalty_points,
           'opening_balance',
           'R115 ledger introduction: opening balance (pre-ledger history not reconstructed)'
    FROM users u
    WHERE u.loyalty_points <> 0
      AND NOT EXISTS (SELECT 1 FROM points_ledger pl WHERE pl.user_id = u.id)
  `);
  logger.info(
    { category: "storage" },
    "V1-M21: points_ledger + welcome_bonus_granted + loyalty_points CHECK (idempotent)",
  );
}

// ── V1-M22 (R115): orders refund reconciliation columns ────────────────────
// refunded_at / refund_amount / refunded_by_admin_id, written by
// RefundService in the same transaction as the status flip. Backfills the
// live refunded orders from wallet_ledger (type='refund', reference_id =
// order id) — the evidence that has always existed, now surfaced on the
// row it describes. refunded_by stays NULL for the backfill (pre-R115
// refunds did not record the admin).
export async function applyOrdersRefundColumnsStage(
  execute: SqlExecutor = defaultExecutor,
): Promise<void> {
  await execute(sql`
    ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS refund_amount NUMERIC(10,2),
      ADD COLUMN IF NOT EXISTS refunded_by_admin_id INTEGER;
  `);
  const badRows = extractRows(
    await execute(sql`
      SELECT COUNT(*)::int AS n FROM orders
      WHERE refund_amount IS NOT NULL AND (refund_amount <= 0 OR refund_amount > amount)
    `),
  );
  const badCount = Number(badRows[0]?.n ?? 0);
  if (badCount > 0) {
    recordConstraintSkip("db:constraint:chk_orders_refund_amount_range");
    logger.error(
      { category: "storage", bad: badCount },
      "V1-M22 SKIPPED orders CHECK: refund_amount rows outside (0, amount] — reconcile manually, then reboot to apply",
    );
  } else {
    await execute(sql`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'orders'::regclass
            AND conname = 'chk_orders_refund_amount_range'
        ) THEN
          ALTER TABLE orders
            ADD CONSTRAINT chk_orders_refund_amount_range
            CHECK (refund_amount IS NULL OR (refund_amount > 0 AND refund_amount <= amount));
        END IF;
      END $$;
    `);
  }
  // Backfill from wallet_ledger evidence (idempotent via refunded_at IS NULL).
  await execute(sql`
    UPDATE orders o
    SET refunded_at = l.created_at,
        refund_amount = l.amount
    FROM wallet_ledger l
    WHERE l.type = 'refund'
      AND l.reference_type = 'order'
      AND l.reference_id = o.id
      AND o.status = 'refunded'
      AND o.refunded_at IS NULL
  `);
  logger.info({ category: "storage" }, "V1-M22: orders refund columns + backfill (idempotent)");
}

// ── V1-M23 (R116, A4-04): wallet_topups.reviewed_by ──────────────────────
// Reviewer attribution — who approved/rejected each topup. The audit_logs
// trail already carries actor ids, but the operator-facing queue is the
// wallet_topups row itself: an incident review ("who approved this
// duplicate transfer?") had to join the ledger through the audit log by
// timestamp inference. reviewed_by lands on the row, written by
// TopupService.approve/reject in the same guarded UPDATE as reviewed_at
// (admin username, or the Telegram actor tag for webhook approvals).
// Nullable by design: legacy rows + the automated gateway path
// (createApprovedTopup) have no human reviewer. Purely additive —
// ADD COLUMN IF NOT EXISTS, probe-free (idempotent by construction, the
// V1-M21/M22 discipline with no constraint to gate).
export async function applyTopupReviewedByStage(
  execute: SqlExecutor = defaultExecutor,
): Promise<void> {
  await execute(sql`
    ALTER TABLE wallet_topups
      ADD COLUMN IF NOT EXISTS reviewed_by VARCHAR(100);
  `);
  logger.info({ category: "storage" }, "V1-M23: wallet_topups.reviewed_by (idempotent)");
}

// ── V1-M24 (R120-B6, A6-F3/F4): user/admin list read-path indexes ─────────
// Two serving gaps on high-frequency poll surfaces:
//   A6-F3  the notification bell reads WHERE user_id ORDER BY created_at
//          DESC LIMIT 40 — the legacy idx_notifications_user (user_id,
//          is_read) only served the user_id prefix, forcing a top-N sort
//          on every poll. is_read was never a predicate on that route
//          (grep-verified), so the shape is SWAPPED same-name to
//          (user_id, created_at DESC) — V1-M17's probe-gated rebuild
//          pattern: catalog probe of the live indexdef, DROP+CREATE only
//          when the old shape is genuinely present, zero DDL on every
//          steady-state boot.
//   A6-F4  the admin ticket queue filters status + sorts updated_at DESC
//          — only the user-side idx_tickets_user existed. Purely
//          additive (status, updated_at DESC) twin.
// Plus the R118-A6-F4 leftover: idx_admin_alerts_created was declared in
// schema TS + the 0016 drizzle mirror with a "boot twin: migrate.ts must
// CREATE INDEX IF NOT EXISTS this name" promise that never shipped — the
// live DB never received it (nothing executes the chain at runtime).
// Closing the loop here (R120-B6 gap-closure, verified: no other creator).
// Drizzle mirror for all three: 0017_silent_greymalkin.sql.
export async function applyListReadPathIndexesStage(
  execute: SqlExecutor = defaultExecutor,
): Promise<void> {
  // Additive twins first (V1-M21/B8-10 idiom) — IF NOT EXISTS covers both
  // the fresh-install and the already-swapped steady state. One statement
  // per execute: pglite's extended-protocol parser rejects multi-statement
  // batches (42601), and stage tests run against the pglite harness.
  await execute(sql`
    CREATE INDEX IF NOT EXISTS idx_tickets_status_updated
      ON support_tickets (status, updated_at DESC);
  `);
  await execute(sql`
    CREATE INDEX IF NOT EXISTS idx_admin_alerts_created
      ON admin_alerts (created_at DESC);
  `);

  // A6-F3 same-name swap: probe the live indexdef — only a genuinely
  // legacy (user_id, is_read) shape pays the DROP+CREATE. Fresh installs
  // get the new shape directly from the base missing-indexes block above;
  // steady-state boots send zero DDL on this table.
  const notifIdxRows = extractRows(
    await execute(sql`
      SELECT indexdef AS indexdef FROM pg_indexes
      WHERE tablename = 'notifications'
        AND indexname = 'idx_notifications_user'
    `),
  );
  const notifIndexdef = String(notifIdxRows[0]?.["indexdef"] ?? "");
  if (notifIndexdef.includes("is_read")) {
    await execute(sql`DROP INDEX IF EXISTS idx_notifications_user`);
    await execute(sql`
      CREATE INDEX IF NOT EXISTS idx_notifications_user
        ON notifications (user_id, created_at DESC);
    `);
    logger.info(
      { category: "storage" },
      "V1-M24: swapped idx_notifications_user → (user_id, created_at DESC), the bell sort shape (R120-B6/A6-F3)",
    );
  }
  logger.info({ category: "storage" }, "V1-M24: list read-path indexes (idempotent)");
}

// ── V1-M25 (R122, A4-P1-2): money-ledger user FKs CASCADE → RESTRICT ────────
//
// The four money-history tables' user FKs were created ON DELETE CASCADE
// (fk_wallet_ledger_user here in V1-M9, fk_orders_user / fk_topups_user in
// the fkStatements loop, points_ledger's inline REFERENCES in V1-M21) while
// the documented retention policy for both ledgers is "NEVER delete"
// (points_ledger.ts: "audit trail; excluded from all retention jobs — same
// class as wallet_ledger"). CASCADE + that policy is a latent catastrophe:
// one manual `DELETE FROM users` (GDPR request, cleanup script, SQL-console
// typo) would atomically erase the user's COMPLETE financial record —
// orders, wallet_ledger, points_ledger, topups — with zero alerts,
// defeating the exactly-once/arithmetic CHECKs those tables carry. No
// production code path deletes users; this stage removes the footgun.
//
// The only supported "deletion" story is user ANONYMIZATION (NULL out
// phone/PII, keep every money row) — RESTRICT enforces exactly that
// boundary at the DB level.
//
// Stage shape (V1-M9/M21 discipline — every statement single, probe-gated,
// re-runs no-ops):
//   1. Orphan probe per table (count, plain SELECT): rows whose user_id
//      has no matching users row ALERT (deduped admin alert, nothing is
//      ever deleted by boot) and skip that table's rebuild — the operator
//      re-links the rows, the next boot applies the constraint.
//   2. Definition probe (pg_constraint, the catalog behind
//      information_schema): if the only FK on the column is the canonical
//      boot name with confdeltype 'r' (RESTRICT) → skip, ZERO DDL — the
//      steady-state boot contract.
//   3. Converge: DROP CONSTRAINT IF EXISTS (canonical name) + the V1-M20
//      any-name sweep (drops ANY FK on the column regardless of name —
//      belt for chain-built / hand-provisioned environments) + DO-block
//      ADD CONSTRAINT … ON DELETE RESTRICT (duplicate_object swallow).
//
// Interaction with the earlier creators (they are NOT modified — the
// stage-freeze discipline): after this stage, the fkStatements loop's
// `ADD CONSTRAINT fk_orders_user …` and V1-M9's wallet ADD raise
// duplicate_object and are swallowed on every later boot (the name already
// exists), so orders / wallet_topups / points_ledger keep RESTRICT with
// zero DDL. V1-M9's wallet_ledger block is the one exception: its DROP is
// unconditional, so it re-creates fk_wallet_ledger_user as CASCADE early
// in every boot and this stage re-converges it to RESTRICT at the tail —
// the transient CASCADE window exists only mid-migration (business routes
// are boot-gated to 503 until migrations finish), at the cost of two extra
// brief AccessExclusiveLocks per cold boot on wallet_ledger. When the
// stage freeze is ever lifted, changing V1-M9's ADD to RESTRICT restores
// the zero-DDL steady state for that table too.
//
// Drizzle mirror: wallet_ledger.ts / points_ledger.ts / orders.ts /
// wallet_topups.ts declare onDelete:"restrict" (chain 0018).
export async function applyMoneyLedgerUserFkRestrictStage(
  execute: SqlExecutor = defaultExecutor,
): Promise<void> {
  // R122 (A4-P1-2): canonical boot names — fk_* from the fkStatements
  // family; points_ledger's FK is the Postgres AUTO name its inline
  // `REFERENCES users(id)` CREATE TABLE column gets (V1-M21), kept as-is
  // so the name this stage probes/drops/adds is byte-identical to the one
  // the boot itself created.
  const targets: Array<{ table: string; constraint: string }> = [
    { table: "wallet_ledger", constraint: "fk_wallet_ledger_user" },
    { table: "orders", constraint: "fk_orders_user" },
    { table: "wallet_topups", constraint: "fk_topups_user" },
    { table: "points_ledger", constraint: "points_ledger_user_id_fkey" },
  ];

  for (const { table, constraint } of targets) {
    // 1. Orphan probe — alert, never delete (V1-M9 short-circuit shape).
    const orphans = extractCount(
      await execute(sql`
        SELECT count(*) AS c
        FROM ${sql.raw(table)} t
        LEFT JOIN users u ON u.id = t.user_id
        WHERE u.id IS NULL
      `),
    );
    if (orphans > 0) {
      await alertMoneyConstraintIssue(
        `صفوف يتيمة في ${table} (V1-M25)`,
        `Found ${orphans} ${table} row(s) whose user_id has no matching users row — the ON DELETE RESTRICT rebuild of ${constraint} was SKIPPED and NOTHING was deleted. Re-link the rows manually, then reboot to apply the constraint.`,
        `db:fkrestrict:${constraint}`,
      );
      continue;
    }

    // 2. Definition probe — confdeltype 'r' = ON DELETE RESTRICT.
    const fkRows = extractRows(
      await execute(sql`
        SELECT con.conname AS conname, con.confdeltype AS confdeltype
        FROM pg_constraint con
        JOIN pg_attribute a
          ON a.attrelid = con.conrelid
         AND a.attnum = ANY (con.conkey)
        WHERE con.contype = 'f'
          AND con.conrelid = ${table}::regclass
          AND a.attname = 'user_id'
      `),
    );
    const alreadyRestrict =
      fkRows.length === 1 &&
      String(fkRows[0].conname) === constraint &&
      String(fkRows[0].confdeltype) === "r";
    if (alreadyRestrict) continue; // steady state — zero DDL

    // 3. Converge to the canonical boot-named RESTRICT FK.
    await execute(sql.raw(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${constraint}`));
    await execute(
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
    await execute(
      sql.raw(`
      DO $$ BEGIN
        ALTER TABLE ${table} ADD CONSTRAINT ${constraint}
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `),
    );
    logger.info(
      { category: "storage", table, constraint },
      "V1-M25: money-history user FK rebuilt as ON DELETE RESTRICT (never-delete audit-trail policy)",
    );
  }
}

// ── V1-M26 (R122, A4-P2-5): the two money CHECKs the R118 sweep missed ──────
//
// R118-A3 F3 pinned the ten live money CHECKs into the schema TS + chain
// but stopped short of the money tables' own arithmetic:
//   - orders.amount had no positivity CHECK (only the refund-range twin);
//     checkout's INVALID_PRICE gate enforces finalPrice > 0 at the
//     perimeter, but a bypass writer (cron, SQL console, a future service)
//     could commit a negative/zero charge silently.
//   - wallet_ledger had no arithmetic identity while points_ledger has
//     carried one since V1-M21. The naive uniform identity
//     (balance_after = balance_before + amount) is WRONG here: purchases
//     store POSITIVE magnitudes with the debit sign carried by `type`
//     (checkout: newBalance = balance − finalPrice), while topup / refund
//     / referral_credit rows are plain credits and adjustment rows store
//     SIGNED deltas (amount = balanceAfter − balanceBefore) — the V1-M10
//     documented convention split. The CHECK below encodes exactly that
//     split (verified writer-by-writer: checkout.service, topup.service,
//     refund.service, adjustment.service, routes/loyalty).
//
// Probe-gated count-then-add per constraint, byte-for-byte the V1-M9
// checkConstraints loop: a violation count > 0 → deduped admin alert +
// skip (the operator fixes data, the next boot applies the constraint);
// otherwise the DO-block ADD swallows duplicate_object on re-runs.
//
// Drizzle mirror: orders.ts (chk_orders_amount_pos) + wallet_ledger.ts
// (chk_ledger_arithmetic) — chain 0018.
export async function applyMoneyArithmeticChecksStage(
  execute: SqlExecutor = defaultExecutor,
): Promise<void> {
  // R122 (A4-P2-5): name/expression pinned verbatim to the schema TS
  // declarations (the 0016 MIRROR_CHECKS discipline).
  const checkConstraints: Array<{
    name: string;
    table: string;
    check: string;
    violation: string;
  }> = [
    {
      name: "chk_orders_amount_pos",
      table: "orders",
      check: "amount > 0",
      violation: "amount <= 0",
    },
    {
      name: "chk_ledger_arithmetic",
      table: "wallet_ledger",
      check:
        "(type <> 'purchase' AND balance_after = balance_before + amount) OR (type = 'purchase' AND balance_after = balance_before - amount)",
      violation:
        "(type <> 'purchase' AND balance_after <> balance_before + amount) OR (type = 'purchase' AND balance_after <> balance_before - amount)",
    },
  ];
  for (const { name, table, check, violation } of checkConstraints) {
    const violations = extractCount(
      await execute(sql.raw(`SELECT count(*) AS c FROM ${table} WHERE ${violation}`)),
    );
    if (violations > 0) {
      await alertMoneyConstraintIssue(
        `بيانات تخالف قيد ${name} (V1-M26)`,
        `Found ${violations} existing row(s) violating ${name} on ${table} — constraint NOT added. Fix the data, then reboot to apply it.`,
        `db:constraint:${name}`,
      );
      continue;
    }
    await execute(
      sql.raw(`
        DO $$ BEGIN
          ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${check});
        EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
      `),
    );
  }
  logger.info(
    { category: "storage" },
    "V1-M26: orders.amount>0 + wallet_ledger arithmetic CHECKs (idempotent)",
  );
}

// ── V1-M27 (R123-E5, R123-A7 P2): serving-index consolidation ───────────────
//
// Two halves of one cleanup, both verified safe at a474d8c:
//
//   (a) THREE missing composites for the user-side "my history, newest
//       first" reads that sort a user's whole table share:
//         idx_topups_user_created        (user_id, created_at DESC)
//           — GET /api/wallet/topups WHERE user_id ORDER BY created_at
//             DESC LIMIT 200 (wallet.ts) top-N sorts the user's whole
//             topup history today.
//         idx_referral_referrer_created  (referrer_id, created_at DESC)
//           — the referrals surface (loyalty.ts) + the copilot referral
//             tool read the referrer's events newest-first.
//         idx_tickets_user_created       (user_id, created_at DESC)
//           — GET /api/support tickets WHERE user_id ORDER BY created_at
//             DESC (support.ts).
//
//   (b) SIXTEEN now-redundant indexes dropped: 13 prefix-redundant /
//       zero-reader twins (each is a strict prefix of, a duplicate of,
//       or has zero readers against a covering sibling) plus the 3
//       single-column user FK twins superseded by the composites above:
//         idx_orders_user            prefix of idx_orders_user_created
//         idx_orders_status          prefix of idx_orders_status_created
//         idx_wallet_ledger_user     prefix of idx_wallet_ledger_user_created
//         idx_points_ledger_user     prefix of idx_points_ledger_user_created
//         idx_topups_status          prefix of idx_topups_status_created
//         idx_products_active        prefix of idx_products_active_category
//         idx_products_archived      dropped on SELECTIVITY grounds, not
//                                    leading-predicate absence — R125-I6
//                                    (A8 B-10) corrects the original V1-M27
//                                    rationale here: is_archived IS the
//                                    sole/leading predicate in 3 live queries
//                                    (routes/admin/products.ts:117 no-search
//                                    branch, copilot/tools/read.ts
//                                    status==="archived" filter, jobs/
//                                    stockWatcher.ts orphaned-units sweep) and
//                                    appears as a predicate in ~20 more. The
//                                    drop stays correct because the column is
//                                    an almost-always-false boolean with ~zero
//                                    selectivity — an index on it selects nearly
//                                    the whole table, so a seq scan is never
//                                    worse — but the stated reason is
//                                    selectivity, NOT "never a leading
//                                    predicate".
//         idx_product_variants_product  prefix of idx_product_variants_product_active
//         idx_cart_items_user        prefix of uniq_cart_items_user_product
//         idx_risk_rules_name        duplicate of the risk_rules_name_unique
//                                    UNIQUE constraint backing index
//         idx_risk_events_created    prefix of idx_risk_events_created_id_desc
//         idx_forecasts_product_date prefix of uq_forecast_product_date
//         idx_idempotency_keys_order ZERO readers — pure write
//                                    amplification on the checkout claim
//                                    path (grep-verified; reference lookups
//                                    go through the key PK)
//         idx_topups_user            superseded by idx_topups_user_created
//         idx_referral_referrer      superseded by idx_referral_referrer_created
//         idx_tickets_user           superseded by idx_tickets_user_created
//
// Stage shape (V1-M24 additive twins + V1-M15 duplicate-index cleanup,
// the two established idioms):
//   - the 3 creates are unconditional CREATE INDEX IF NOT EXISTS (V1-M24
//     additive-twin form — covers fresh installs AND the steady state);
//   - the 16 drops are PROBE-GATED (V1-M15 form): one pg_indexes read,
//     then DROP INDEX IF EXISTS only for the names genuinely present —
//     steady-state boots issue ZERO DDL.
//
// Interaction with the earlier creators (the R97-DB-04 / V1-M24
// precedent): the superseded CREATE INDEX statements that lived in the
// runMigrations BODY blocks (products / wallet_ledger / missing-indexes
// / risk / forecast) were REMOVED in the same edit — fresh databases
// never get the redundant twins. The four creators inside FROZEN
// numbered stages (V1-M9's idx_cart_items_user, V1-M12's
// idx_idempotency_keys_order, V1-M16's idx_product_variants_product,
// V1-M21's idx_points_ledger_user) are deliberately NOT modified (the
// V1-M25 stage-freeze discipline): on every FULL reconcile those stages
// re-create their twin and this stage re-drops it a moment later —
// two brief catalog statements per object, the same accepted cost as
// V1-M25's V1-M9 interaction note. The end state always converges, and
// the R104 fingerprint fast-path skips the whole replay on steady-state
// boots regardless.
//
// Drizzle mirror: shared/db/src/schema/*.ts declarations updated +
// chain 0019 (dropped declarations removed, composites added).
export async function applyIndexConsolidationStage(
  execute: SqlExecutor = defaultExecutor,
): Promise<void> {
  // (a) The three composites — one statement per execute (pglite).
  await execute(sql`
    CREATE INDEX IF NOT EXISTS idx_topups_user_created
      ON wallet_topups (user_id, created_at DESC);
  `);
  await execute(sql`
    CREATE INDEX IF NOT EXISTS idx_referral_referrer_created
      ON referral_events (referrer_id, created_at DESC);
  `);
  await execute(sql`
    CREATE INDEX IF NOT EXISTS idx_tickets_user_created
      ON support_tickets (user_id, created_at DESC);
  `);

  // (b) The redundant set — probe first (V1-M15 idiom), drop only what
  // is genuinely present so steady-state boots send no DROP at all.
  const redundant = [
    "idx_orders_user",
    "idx_orders_status",
    "idx_wallet_ledger_user",
    "idx_points_ledger_user",
    "idx_topups_status",
    "idx_products_active",
    "idx_products_archived",
    "idx_product_variants_product",
    "idx_cart_items_user",
    "idx_risk_rules_name",
    "idx_risk_events_created",
    "idx_forecasts_product_date",
    "idx_idempotency_keys_order",
    "idx_topups_user",
    "idx_referral_referrer",
    "idx_tickets_user",
  ];
  const presentRows = extractRows(
    await execute(sql`
      SELECT indexname AS indexname FROM pg_indexes
      WHERE schemaname = current_schema()
        AND indexname IN (${sql.raw(redundant.map((n) => `'${n}'`).join(", "))})
    `),
  );
  if (presentRows.length > 0) {
    for (const row of presentRows) {
      await execute(sql.raw(`DROP INDEX IF EXISTS ${String(row.indexname)}`));
    }
    logger.info(
      { category: "storage", dropped: presentRows.map((r) => String(r.indexname)) },
      "V1-M27: dropped redundant indexes (prefix/zero-reader twins superseded by composites)",
    );
  }
  logger.info({ category: "storage" }, "V1-M27: serving-index consolidation (idempotent)");
}

// ── V1-M28 (R123-E5, R123-A7 P2): referral_events FKs CASCADE → RESTRICT ────
//
// referral_events.referrer_id + referee_id were created ON DELETE
// CASCADE (the fkStatements loop) while referral credits are MONEY-
// ADJACENT ATTRIBUTION: a pending referral_event is the referrer's
// claim to a future credit, and referee_id is one-to-one (UNIQUE).
// CASCADE + the R122 anonymization-keeps-rows policy contradict: a
// manual `DELETE FROM users` for a REFEREE would atomically erase the
// REFERRER's pending credit claim — the exact history-erasure class
// V1-M25 closed for the money ledgers. Same boundary here: deleting
// either user must be refused (RESTRICT) so the operator anonymizes
// instead.
//
// Stage shape is V1-M25 verbatim, per column:
//   1. orphan probe (count; alert + skip, never delete);
//   2. definition probe — already RESTRICT under the canonical boot
//      name → skip, ZERO DDL (the steady-state contract);
//   3. converge — DROP CONSTRAINT IF EXISTS (canonical name) + the
//      V1-M20 any-name sweep + DO-block ADD … RESTRICT.
//
// Interaction with the fkStatements creator (NOT modified — same
// stage-freeze reasoning as V1-M25): the loop's ADD
// fk_referral_referrer / fk_referral_referee raise duplicate_object and
// are swallowed on every later boot (the names this stage re-adds are
// byte-identical to the loop's), so both FKs stay RESTRICT with zero
// DDL after the first post-deploy boot.
//
// Drizzle mirror: referral_events.ts onDelete:"restrict" + chain 0019.
export async function applyReferralFksRestrictStage(
  execute: SqlExecutor = defaultExecutor,
): Promise<void> {
  const targets: Array<{ column: string; constraint: string }> = [
    { column: "referrer_id", constraint: "fk_referral_referrer" },
    { column: "referee_id", constraint: "fk_referral_referee" },
  ];

  for (const { column, constraint } of targets) {
    // 1. Orphan probe — alert, never delete (V1-M25 short-circuit shape).
    const orphans = extractCount(
      await execute(sql`
        SELECT count(*) AS c
        FROM referral_events re
        LEFT JOIN users u ON u.id = re.${sql.raw(column)}
        WHERE u.id IS NULL
      `),
    );
    if (orphans > 0) {
      await alertMoneyConstraintIssue(
        `صفوف إحالات يتيمة (V1-M28)`,
        `Found ${orphans} referral_events row(s) whose ${column} has no matching users row — the ON DELETE RESTRICT rebuild of ${constraint} was SKIPPED and NOTHING was deleted. Re-link the rows manually, then reboot to apply the constraint.`,
        `db:fkrestrict:${constraint}`,
      );
      continue;
    }

    // 2. Definition probe — confdeltype 'r' = ON DELETE RESTRICT.
    const fkRows = extractRows(
      await execute(sql`
        SELECT con.conname AS conname, con.confdeltype AS confdeltype
        FROM pg_constraint con
        JOIN pg_attribute a
          ON a.attrelid = con.conrelid
         AND a.attnum = ANY (con.conkey)
        WHERE con.contype = 'f'
          AND con.conrelid = 'referral_events'::regclass
          AND a.attname = ${column}
      `),
    );
    const alreadyRestrict =
      fkRows.length === 1 &&
      String(fkRows[0].conname) === constraint &&
      String(fkRows[0].confdeltype) === "r";
    if (alreadyRestrict) continue; // steady state — zero DDL

    // 3. Converge to the canonical boot-named RESTRICT FK.
    await execute(sql.raw(`ALTER TABLE referral_events DROP CONSTRAINT IF EXISTS ${constraint}`));
    await execute(
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
            AND con.conrelid = 'referral_events'::regclass
            AND a.attname = '${column}'
        LOOP
          EXECUTE format('ALTER TABLE referral_events DROP CONSTRAINT %I', fk_name);
        END LOOP;
      END $$;
    `),
    );
    await execute(
      sql.raw(`
      DO $$ BEGIN
        ALTER TABLE referral_events ADD CONSTRAINT ${constraint}
          FOREIGN KEY (${column}) REFERENCES users(id) ON DELETE RESTRICT;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `),
    );
    logger.info(
      { category: "storage", column, constraint },
      "V1-M28: referral_events FK rebuilt as ON DELETE RESTRICT (attribution is money-adjacent)",
    );
  }
}

// ── V1-M29 (R123-E5, R123-A7 P3): the domain CHECK batch ────────────────────
//
// Eight CHECKs the R118-A3 F3 sweep stopped short of (it pinned the
// money tables' CHECKs; these are the domain tables' own invariants).
// Every expression is what the zod perimeter already enforces
// (CreateProductBody min 0.01, cart quantity >= 1, run outcomes, risk
// score/confidence bounds) — the CHECK closes the bypass writers (cron,
// SQL console, a future service) the same way chk_orders_amount_pos
// does for checkout:
//   chk_cart_items_quantity_pos   cart_items.quantity >= 1
//   chk_products_price_pos        products.price > 0
//   chk_variant_price_pos         product_variants price_lyd > 0 AND
//                                 cost_price >= 0
//   chk_referral_status           referral_events.status IN
//                                 ('pending','credited')
//   chk_enrichment_runs_outcome   enrichment_runs.outcome IN
//                                 ('in_flight','success','failure')
//   chk_forecast_runs_outcome     inventory_forecast_runs.outcome IN
//                                 (the same set)
//   chk_risk_score_range          risk_events.score 0..100
//   chk_risk_confidence_range     risk_events.confidence 0..1
//
// Stage shape is the V1-M9/V1-M26 checkConstraints loop verbatim:
// violation count-probe → deduped admin alert + skip (the operator
// fixes data, the next boot applies the constraint); otherwise the
// DO-block ADD swallows duplicate_object on re-runs. All tables exist
// by the time the stage tail runs (the runMigrations body creates them
// unconditionally with CREATE TABLE IF NOT EXISTS before the stages).
//
// Drizzle mirror: check() declarations in the schema TS + chain 0019.
export async function applyDomainCheckConstraintsStage(
  execute: SqlExecutor = defaultExecutor,
): Promise<void> {
  const checkConstraints: Array<{
    name: string;
    table: string;
    check: string;
    violation: string;
  }> = [
    {
      name: "chk_cart_items_quantity_pos",
      table: "cart_items",
      check: "quantity >= 1",
      violation: "quantity < 1",
    },
    {
      name: "chk_products_price_pos",
      table: "products",
      check: "price > 0",
      violation: "price <= 0",
    },
    {
      name: "chk_variant_price_pos",
      table: "product_variants",
      check: "price_lyd > 0 AND cost_price >= 0",
      violation: "price_lyd <= 0 OR cost_price < 0",
    },
    {
      name: "chk_referral_status",
      table: "referral_events",
      check: "status IN ('pending','credited')",
      violation: "status NOT IN ('pending','credited')",
    },
    {
      name: "chk_enrichment_runs_outcome",
      table: "enrichment_runs",
      check: "outcome IN ('in_flight','success','failure')",
      violation: "outcome NOT IN ('in_flight','success','failure')",
    },
    {
      name: "chk_forecast_runs_outcome",
      table: "inventory_forecast_runs",
      check: "outcome IN ('in_flight','success','failure')",
      violation: "outcome NOT IN ('in_flight','success','failure')",
    },
    {
      name: "chk_risk_score_range",
      table: "risk_events",
      check: "score >= 0 AND score <= 100",
      violation: "score < 0 OR score > 100",
    },
    {
      name: "chk_risk_confidence_range",
      table: "risk_events",
      check: "confidence >= 0 AND confidence <= 1",
      violation: "confidence < 0 OR confidence > 1",
    },
  ];
  for (const { name, table, check, violation } of checkConstraints) {
    const violations = extractCount(
      await execute(sql.raw(`SELECT count(*) AS c FROM ${table} WHERE ${violation}`)),
    );
    if (violations > 0) {
      await alertMoneyConstraintIssue(
        `بيانات تخالف قيد ${name} (V1-M29)`,
        `Found ${violations} existing row(s) violating ${name} on ${table} — constraint NOT added. Fix the data, then reboot to apply it.`,
        `db:constraint:${name}`,
      );
      continue;
    }
    await execute(
      sql.raw(`
        DO $$ BEGIN
          ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${check});
        EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
      `),
    );
  }
  logger.info({ category: "storage" }, "V1-M29: domain CHECK batch (idempotent)");
}

// ── V1-M30 (R123-E5, R123-A7 P2): organizations table removal ───────────────
//
// organizations is DEAD: zero route/service/job reads or writes, zero
// frontend references, no INSERT anywhere in the repo (full-repo sweep
// re-run at implementation time — the only references were this file's
// own boot DDL, the schema TS, the chain, the pglite fixture, and
// dated audit docs under docs/history/). Live row count 0 (R118-A3).
// users.organization_id is its only ever-declared consumer and is
// equally unreferenced — every users row carries NULL.
//
// The R97-DB-04 precedent (applied to the users firebase-uid duplicates
// in V1-M15): the runMigrations BODY creators were REMOVED in the same
// edit (fresh databases never get the table), and this stage removes
// them from already-migrated databases:
//   1. any-name FK sweep on users.organization_id (V1-M20 idiom — the
//      live FK name is the chain-era users_organization_id_
//      organizations_id_fk here in migrate.ts, but hand-provisioned
//      environments may carry anything);
//   2. DROP COLUMN organization_id (catalog-probed — the column drop
//      is itself the second FK belt, and provably NULL-only);
//   3. DROP TABLE organizations (existence-probed, the V1-M15 otps
//      idiom) — IF EXISTS as the final belt.
// Every step is probe-gated: steady-state boots issue ZERO DDL, and on
// the pglite harness (no organizations table, no organization_id
// column since the R123 harness parity edit) the whole stage no-ops.
//
// Drizzle mirror: organizations.ts deleted, users.ts organizationId
// removed, chain 0019 emits the DROPs.
export async function applyOrganizationsRemovalStage(
  execute: SqlExecutor = defaultExecutor,
): Promise<void> {
  // 1. Any-name FK sweep on users.organization_id (V1-M20 shape),
  //    probe-gated: zero FKs on the column (or the column already gone —
  //    the pg_attribute join yields nothing) → the DO block is not even
  //    sent, keeping the steady-state contract at zero DDL.
  const orgFkCount = extractCount(
    await execute(sql`
      SELECT count(*) AS c
      FROM pg_constraint con
      JOIN pg_attribute a
        ON a.attrelid = con.conrelid
       AND a.attnum = ANY (con.conkey)
      WHERE con.contype = 'f'
        AND con.conrelid = 'users'::regclass
        AND a.attname = 'organization_id'
    `),
  );
  if (orgFkCount > 0) {
    await execute(sql`
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
            AND con.conrelid = 'users'::regclass
            AND a.attname = 'organization_id'
        LOOP
          EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', fk_name);
        END LOOP;
      END $$;
    `);
    logger.info(
      { category: "storage", fks: orgFkCount },
      "V1-M30: swept users.organization_id FK(s) before dropping the dead column",
    );
  }

  // 2. The column — catalog probe first (zero-DDL steady state).
  const orgColumnRows = extractRows(
    await execute(sql`
      SELECT 1 AS present FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'users'
        AND column_name = 'organization_id'
    `),
  );
  if (orgColumnRows.length > 0) {
    await execute(sql`ALTER TABLE users DROP COLUMN organization_id`);
    logger.info(
      { category: "storage" },
      "V1-M30: dropped dead users.organization_id (zero readers, provably NULL-only)",
    );
  }

  // 3. The table — existence probe (V1-M15 otps idiom) + IF EXISTS belt.
  const orgTableRows = extractRows(
    await execute(sql`
      SELECT 1 AS present FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name = 'organizations'
    `),
  );
  if (orgTableRows.length > 0) {
    await execute(sql`DROP TABLE IF EXISTS organizations`);
    logger.info(
      { category: "storage" },
      "V1-M30: dropped dead organizations table (0 rows, zero references)",
    );
  }
}

export async function runMigrations() {
  try {
    // r110 (109-e P2-1): per-run skip state — transient retries in
    // boot-migrations.ts re-run from the top, so each attempt starts clean.
    constraintSkipKeys = [];

    // ── R104 fingerprint fast-path ────────────────────────────────────────
    // One SELECT replaces ~141 no-op round trips when this build's
    // migrate.ts is byte-identical to the last fully-reconciled one.
    // R108 (FH-A5 P2-2): accept the common truthy spellings — the old
    // exact-"true" comparison silently NO-OPPED the documented
    // `=1` recipe (a forced reconcile that didn't force anything).
    // r110 (109-e P2-2): the marker is the v2 composite (codeHash +
    // schemaHash) — a stale/absent schema component (old bare-hex
    // markers, out-of-band schema/chain edits) fails this compare and
    // forces exactly one full reconcile, then the new marker is written.
    const forceReconcile = ["true", "1", "yes"].includes(
      (process.env.MIGRATIONS_FORCE_RECONCILE ?? "").trim().toLowerCase(),
    );
    if (MIGRATIONS_FINGERPRINT && !forceReconcile) {
      const stored = await readStoredMigrationFingerprint();
      if (stored === MIGRATIONS_FINGERPRINT) {
        logger.info(
          { category: "storage" },
          "[migrations] fingerprint match — schema already reconciled for this build (fast-path)",
        );
        return;
      }
      if (stored !== null) {
        logger.info(
          { category: "storage", reason: describeMarkerMismatch(stored, MIGRATIONS_FINGERPRINT) },
          "[migrations] fingerprint changed — running full reconcile",
        );
      }
    }

    // ── Extensions ─────────────────────────────────────────────────────────
    // pg_trgm gives us trigram similarity for fuzzy product name lookup
    // (010-ai-admin-copilot resolve_product tool — Arabic/English/typo
    // tolerant). Idempotent + cheap; safe to leave enabled.
    //
    // B7-P0-1: the extension is PROBED first (catalog read — safe on a
    // read-only standby); the CREATE statement only runs when genuinely
    // absent. pg_trgm already installed (production state) ⇒ zero DDL here.
    const pgTrgmAvailable = await ensurePgTrgmExtension();

    // ── Enums ──────────────────────────────────────────────────────────────
    await db.execute(sql`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status') THEN
          CREATE TYPE order_status AS ENUM ('pending', 'completed', 'failed', 'refunded');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'topup_status') THEN
          CREATE TYPE topup_status AS ENUM ('pending', 'approved', 'rejected');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ticket_status') THEN
          CREATE TYPE ticket_status AS ENUM ('open', 'in_progress', 'closed');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'coupon_type') THEN
          CREATE TYPE coupon_type AS ENUM ('percentage', 'fixed');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'audit_actor_type') THEN
          CREATE TYPE audit_actor_type AS ENUM ('user', 'admin', 'system');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ledger_entry_type') THEN
          CREATE TYPE ledger_entry_type AS ENUM ('topup', 'purchase', 'refund', 'adjustment', 'referral_credit');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'risk_event_type') THEN
          CREATE TYPE risk_event_type AS ENUM ('login_attempt', 'login_success', 'login_failure', 'otp_request', 'otp_verify', 'topup_attempt', 'topup_success', 'order_create', 'order_deliver', 'coupon_apply', 'referral_event', 'admin_force_reauth');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'risk_level') THEN
          CREATE TYPE risk_level AS ENUM ('low', 'medium', 'high', 'critical');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'risk_action_taken') THEN
          CREATE TYPE risk_action_taken AS ENUM ('none', 'log', 'soft_block', 'hard_block', 'alert');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'risk_label_kind') THEN
          CREATE TYPE risk_label_kind AS ENUM ('confirmed_fraud', 'false_positive', 'escalated');
        END IF;
      END $$;
    `);

    // ── Core tables ─────────────────────────────────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS users (
        id             SERIAL PRIMARY KEY,
        phone          VARCHAR(20) NOT NULL UNIQUE,
        password_hash  VARCHAR(255) NOT NULL DEFAULT '',
        google_id      VARCHAR(255) UNIQUE,
        github_id      VARCHAR(255) UNIQUE,
        facebook_id    VARCHAR(255) UNIQUE,
        telegram_id    VARCHAR(255) UNIQUE,
        firebase_uid   VARCHAR(255) UNIQUE,
        email          VARCHAR(255),
        email_verified BOOLEAN NOT NULL DEFAULT FALSE,
        phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
        display_name   VARCHAR(255),
        photo_url      TEXT,
        auth_provider  VARCHAR(50) NOT NULL DEFAULT 'legacy_password',
        password_login_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        legacy_password_disabled_at TIMESTAMPTZ,
        last_auth_at   TIMESTAMPTZ,
        wallet_balance NUMERIC(10,2) NOT NULL DEFAULT 0.00,
        loyalty_points INTEGER NOT NULL DEFAULT 0,
        loyalty_tier   VARCHAR(50) NOT NULL DEFAULT 'bronze',
        lifetime_spend NUMERIC(10,2) NOT NULL DEFAULT 0.00,
        referral_code  VARCHAR(20) UNIQUE,
        referred_by    INTEGER,
        onboarded_at   TIMESTAMPTZ,
        onboarding_step INTEGER NOT NULL DEFAULT 1,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS admin_users (
        id            SERIAL PRIMARY KEY,
        username      VARCHAR(100) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        display_name  VARCHAR(100) NOT NULL DEFAULT 'Admin',
        role          VARCHAR(50) NOT NULL DEFAULT 'admin',
        totp_secret   VARCHAR(255),
        totp_enabled  BOOLEAN NOT NULL DEFAULT FALSE,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS products (
        id           SERIAL PRIMARY KEY,
        name         VARCHAR(255) NOT NULL,
        description  TEXT,
        image_url    VARCHAR(1000),
        price        NUMERIC(10,2) NOT NULL,
        category     VARCHAR(100),
        is_active    BOOLEAN NOT NULL DEFAULT TRUE,
        is_archived  BOOLEAN NOT NULL DEFAULT FALSE,
        usage_terms  TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // product_variants — created early because later boot tables
    // (cart_items, orders, inventory) carry variant FKs. V1-M16's
    // applyProductVariantsStage (tail of runMigrations) adds the
    // indexes + additive columns on already-running databases; this
    // early CREATE keeps fresh-database FK ordering valid. Idempotent.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS product_variants (
        id             SERIAL PRIMARY KEY,
        product_id     INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        plan_label     VARCHAR(120),
        duration_label VARCHAR(120),
        duration_days  INTEGER,
        cost_price     NUMERIC(10,2) NOT NULL,
        price_lyd      NUMERIC(10,2) NOT NULL,
        sku            VARCHAR(160),
        is_active      BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order     INTEGER NOT NULL DEFAULT 0,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Products lookup indexes — mirror the declarations in
    // shared/db/src/schema/products.ts. Without these the catalog
    // filter (is_active=true AND is_archived=false) and the
    // category filter both seq-scan, which is fine at <100 rows but
    // becomes the storefront's hot-path bottleneck above ~1k products.
    // Idempotent — safe to re-run on every cold boot.
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
      -- R123-E5 (V1-M27): idx_products_active + idx_products_archived no
      -- longer created — idx_products_active_category covers every active
      -- predicate (strict-prefix redundancy). is_archived is dropped on
      -- SELECTIVITY grounds (an almost-always-false boolean indexes to
      -- ~zero selectivity — a seq scan is never worse), NOT because it is
      -- never a leading predicate: it IS the leading/sole predicate in 3
      -- live queries (admin/products.ts no-search branch, copilot
      -- search_products status="archived", stockWatcher orphan sweep) —
      -- R125-I6 (A8 B-10) docblock truth-up; the drop itself is unchanged.
      -- V1-M27 drops both on already-migrated databases (R97-DB-04
      -- precedent).
      CREATE INDEX IF NOT EXISTS idx_products_active_category ON products(is_active, category);
    `);

    // Slug column + backfill + unique index — used by /product/<slug>
    // SEO routes. The rich Arabic-aware transliteration lives in
    // backend/src/lib/slugify.ts and runs on insert/update via the
    // admin handlers. The SQL backfill below is best-effort: it only
    // strips non-alphanumerics from Latin names. Rows whose name
    // collapses to empty (Arabic-only, emoji-only, etc.) get the
    // `product-<id>` fallback so the column is never NULL.
    //
    // Idempotent across all four states:
    //   - column missing                 → ADD COLUMN
    //   - column present, slug NULL      → backfill UPDATE
    //   - column present, slug set       → no-op
    //   - unique index missing           → CREATE
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'products' AND column_name = 'slug'
        ) THEN
          ALTER TABLE products ADD COLUMN slug VARCHAR(160);
        END IF;
      END $$;
    `);

    // Best-effort SQL backfill: lowercase, replace anything non-[a-z0-9]
    // with '-', collapse repeated '-', trim. Falls back to product-<id>
    // when the result is empty.
    await db.execute(sql`
      UPDATE products
      SET slug = COALESCE(
        NULLIF(
          trim(BOTH '-' FROM regexp_replace(
            regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'),
            '-+', '-', 'g'
          )),
          ''
        ),
        'product-' || id::text
      )
      WHERE slug IS NULL;
    `);

    // Resolve any backfill-time collisions by suffixing -<id> on the
    // duplicates. Stable: when two rows share a slug, the lower id
    // keeps the bare slug, the higher id gets the suffix.
    await db.execute(sql`
      UPDATE products p
      SET slug = p.slug || '-' || p.id::text
      FROM products other
      WHERE p.slug = other.slug
        AND p.id > other.id;
    `);

    // Unique index — also accelerates /api/products/by-slug/:slug.
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_products_slug_unique ON products(slug);
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS inventory (
        id               SERIAL PRIMARY KEY,
        product_id       INTEGER NOT NULL,
        account_email    VARCHAR(255),
        account_password VARCHAR(255),
        extra_details    TEXT,
        is_sold          BOOLEAN NOT NULL DEFAULT FALSE,
        sold_at          TIMESTAMPTZ,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS orders (
        id                    SERIAL PRIMARY KEY,
        order_code            VARCHAR(50) NOT NULL UNIQUE,
        user_id               INTEGER NOT NULL,
        product_id            INTEGER NOT NULL,
        inventory_id          INTEGER,
        amount                NUMERIC(10,2) NOT NULL,
        wallet_balance_before NUMERIC(10,2) NOT NULL DEFAULT 0.00,
        wallet_balance_after  NUMERIC(10,2) NOT NULL DEFAULT 0.00,
        status                order_status NOT NULL DEFAULT 'pending',
        delivered_email       VARCHAR(255),
        delivered_password    VARCHAR(512),
        delivered_extra_details TEXT,
        delivered_usage_terms TEXT,
        delivered_at          TIMESTAMPTZ,
        coupon_code           VARCHAR(50),
        discount_amount       NUMERIC(10,2) NOT NULL DEFAULT 0.00,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // V1-M6 (red-team 2026-09-06): delivered_password now stores the
    // AES-256-GCM CIPHERTEXT (iv:tag:ct = 58 + 2×len chars). On legacy
    // databases the column is VARCHAR(255) — any inventory password
    // ≥ 99 chars overflows the insert and rolls back the WHOLE purchase
    // transaction with a raw 500. Widen in place (idempotent: a no-op
    // when the column is already 512).
    await db.execute(sql`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='orders' AND column_name='delivered_password'
            AND character_maximum_length = 255
        ) THEN
          ALTER TABLE orders ALTER COLUMN delivered_password TYPE VARCHAR(512);
        END IF;
      END $$;
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS wallet_topups (
        id                SERIAL PRIMARY KEY,
        user_id           INTEGER NOT NULL,
        amount            NUMERIC(10,2) NOT NULL,
        payment_method    VARCHAR(50) NOT NULL DEFAULT 'mobile_transfer',
        payment_network   VARCHAR(50),
        sender_phone      VARCHAR(20),
        sender_account    VARCHAR(255),
        payment_reference VARCHAR(255),
        status            topup_status NOT NULL DEFAULT 'pending',
        admin_note        TEXT,
        reviewed_at       TIMESTAMPTZ,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS notifications (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER NOT NULL,
        type       VARCHAR(20) NOT NULL DEFAULT 'system',
        title      VARCHAR(255) NOT NULL,
        message    TEXT,
        link       VARCHAR(255),
        is_read    BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS support_tickets (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER NOT NULL,
        title      VARCHAR(255) NOT NULL,
        category   VARCHAR(50),
        status     ticket_status NOT NULL DEFAULT 'open',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ticket_replies (
        id          SERIAL PRIMARY KEY,
        ticket_id   INTEGER NOT NULL,
        author_type VARCHAR(10) NOT NULL DEFAULT 'user',
        message     TEXT NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS referral_events (
        id          SERIAL PRIMARY KEY,
        referrer_id INTEGER NOT NULL,
        referee_id  INTEGER NOT NULL UNIQUE,
        status      VARCHAR(20) NOT NULL DEFAULT 'pending',
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        credited_at TIMESTAMPTZ
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS flash_sales (
        id               SERIAL PRIMARY KEY,
        title            VARCHAR(255) NOT NULL DEFAULT 'Flash Sale',
        discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0.00,
        ends_at          TIMESTAMPTZ NOT NULL,
        is_active        BOOLEAN NOT NULL DEFAULT TRUE,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // ── flash_sales: at-most-one-active invariant ──────────────────────
    //
    // Partial unique index on a constant `true` expression, gated by
    // `is_active=true`. Result: any number of inactive rows allowed
    // (history), but only ONE row may be active at a time. Without
    // this, the runtime LIMIT(1) without an ORDER BY makes the served
    // discount non-deterministic when multiple active rows exist.
    //
    // The admin POST/PATCH handlers rely on this index — they catch
    // the unique-violation and return a clean error to the operator
    // ("another flash sale is currently active; deactivate it first").
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_flash_sales_active_singleton
        ON flash_sales ((true)) WHERE is_active = true;
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS coupons (
        id               SERIAL PRIMARY KEY,
        code             VARCHAR(50) NOT NULL UNIQUE,
        type             coupon_type NOT NULL DEFAULT 'percentage',
        value            NUMERIC(10,2) NOT NULL,
        min_order_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00,
        max_uses         INTEGER,
        used_count       INTEGER NOT NULL DEFAULT 0,
        expires_at       TIMESTAMPTZ,
        is_active        BOOLEAN NOT NULL DEFAULT TRUE,
        description      VARCHAR(255),
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS cart_items (
        id            SERIAL PRIMARY KEY,
        user_id       INTEGER NOT NULL,
        product_id    INTEGER NOT NULL,
        variant_id    INTEGER,
        variant_label VARCHAR(240),
        quantity      INTEGER NOT NULL DEFAULT 1,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_cart_items_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_cart_items_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
        CONSTRAINT fk_cart_items_variant FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE CASCADE
      );
    `);

    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_cart_items_user_product
        ON cart_items (user_id, product_id);
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS admin_alerts (
        id          SERIAL PRIMARY KEY,
        type        VARCHAR(30) NOT NULL DEFAULT 'system',
        title       VARCHAR(255) NOT NULL,
        message     TEXT,
        is_read     BOOLEAN NOT NULL DEFAULT FALSE,
        dedupe_key  VARCHAR(100),
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Round-5 (db-audit 2026-09-07): dedupe_key column + serving index.
    // Idempotent on legacy databases that already have the table.
    await db.execute(sql`
      ALTER TABLE admin_alerts ADD COLUMN IF NOT EXISTS dedupe_key VARCHAR(100);
      CREATE INDEX IF NOT EXISTS idx_admin_alerts_dedupe_key
        ON admin_alerts (dedupe_key, created_at);
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id          SERIAL PRIMARY KEY,
        actor_id    INTEGER,
        actor_type  audit_actor_type NOT NULL DEFAULT 'system',
        action      VARCHAR(100) NOT NULL,
        target_type VARCHAR(50),
        target_id   INTEGER,
        metadata    TEXT,
        ip          VARCHAR(45),
        user_agent  VARCHAR(500),
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_id, actor_type);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs(target_type, target_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS system_settings (
        key        VARCHAR(255) PRIMARY KEY,
        value      TEXT NOT NULL DEFAULT '{}',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // ── Legacy OTP table reconcile (B7-P0-2: gated on table existence) ──
    //
    // OTP-based password recovery was removed in the passwordless launch;
    // Stage C below drops the `otps` table. This block used to re-CREATE
    // the table on EVERY cold boot (then Stage C dropped it again in the
    // same run) — guaranteed DDL churn that additionally fails 100% of the
    // time in a Neon read-only/failover window, because Postgres rejects
    // CREATE/ALTER/DROP in read-only transactions by command class, even
    // when the statement would be a no-op.
    //
    // Now the entire block is gated on the table actually existing: it
    // runs ONLY on mid-deploy databases that still carry the legacy table
    // (drift-reconcile of code_hash + attempts). Fresh databases skip it
    // (Stage C drops the never-created table via IF EXISTS), and after one
    // boot post-fix the table stays dropped — steady-state boots execute
    // ZERO DDL here.
    await db.execute(sql`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='otps') THEN
          ALTER TABLE otps
            ADD COLUMN IF NOT EXISTS code_hash VARCHAR(255),
            ADD COLUMN IF NOT EXISTS attempts  INTEGER NOT NULL DEFAULT 0;

          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name='otps' AND column_name='code' AND is_nullable='NO'
          ) THEN
            ALTER TABLE otps ALTER COLUMN code DROP NOT NULL;
          END IF;

          CREATE INDEX IF NOT EXISTS idx_otps_phone ON otps(phone);
          CREATE INDEX IF NOT EXISTS idx_otps_expires ON otps(expires_at);
        END IF;
      END $$;
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS login_attempts (
        id            SERIAL PRIMARY KEY,
        identifier    VARCHAR(100) NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        locked_until  TIMESTAMPTZ,
        last_attempt  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_login_attempts_identifier ON login_attempts(identifier);
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS user_auth_identities (
        id             SERIAL PRIMARY KEY,
        user_id        INTEGER NOT NULL,
        provider       VARCHAR(50) NOT NULL,
        provider_uid   VARCHAR(255) NOT NULL,
        firebase_uid   VARCHAR(255),
        email          VARCHAR(255),
        phone          VARCHAR(20),
        email_verified BOOLEAN NOT NULL DEFAULT FALSE,
        phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
        linked_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS wallet_ledger (
        id              SERIAL PRIMARY KEY,
        user_id         INTEGER NOT NULL,
        type            ledger_entry_type NOT NULL,
        amount          NUMERIC(10,2) NOT NULL,
        balance_before  NUMERIC(10,2) NOT NULL,
        balance_after   NUMERIC(10,2) NOT NULL,
        reference_id    INTEGER,
        reference_type  VARCHAR(50),
        description     VARCHAR(500),
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      -- R123-E5 (V1-M27): idx_wallet_ledger_user no longer created — a
      -- strict prefix of idx_wallet_ledger_user_created (created by the
      -- round-4 block below). V1-M27 drops it on already-migrated
      -- databases (R97-DB-04 precedent).
      CREATE INDEX IF NOT EXISTS idx_wallet_ledger_type ON wallet_ledger(type);
      CREATE INDEX IF NOT EXISTS idx_wallet_ledger_created ON wallet_ledger(created_at DESC);
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS auth_activity (
        id              SERIAL PRIMARY KEY,
        user_id         INTEGER,
        identifier      VARCHAR(255) NOT NULL,
        action          VARCHAR(50) NOT NULL,
        provider        VARCHAR(50),
        success         BOOLEAN NOT NULL,
        ip_address      VARCHAR(45),
        user_agent      TEXT,
        failure_reason  VARCHAR(255),
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_auth_activity_user ON auth_activity(user_id);
      CREATE INDEX IF NOT EXISTS idx_auth_activity_identifier ON auth_activity(identifier);
      CREATE INDEX IF NOT EXISTS idx_auth_activity_action ON auth_activity(action);
      CREATE INDEX IF NOT EXISTS idx_auth_activity_created ON auth_activity(created_at DESC);
    `);

    // ── whatsapp_otps (Phase 1: phone registration via OpenWA) ─────────────
    // Generic OTP store; the `purpose` column separates registration /
    // login / future 2FA so the same table serves all three flows.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS whatsapp_otps (
        id              SERIAL PRIMARY KEY,
        phone           VARCHAR(20) NOT NULL,
        code_hash       VARCHAR(64) NOT NULL,
        purpose         VARCHAR(32) NOT NULL,
        expires_at      TIMESTAMPTZ NOT NULL,
        attempts        INTEGER NOT NULL DEFAULT 0,
        consumed_at     TIMESTAMPTZ,
        ip_address      VARCHAR(45),
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_whatsapp_otps_phone_purpose
        ON whatsapp_otps(phone, purpose, created_at);
      CREATE INDEX IF NOT EXISTS idx_whatsapp_otps_expires_at
        ON whatsapp_otps(expires_at);
    `);

    // ── openwa_sessions (durable OpenWA/Baileys credentials) ───────────────
    // The external OpenWA gateway owns encryption and reads/writes this table
    // through PERSISTENCE_URL. Creating it here keeps a fresh Neon database
    // ready before the gateway is started, while IF NOT EXISTS makes this safe
    // for gateways that already provisioned it on their first boot.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS openwa_sessions (
        name        TEXT PRIMARY KEY,
        creds       BYTEA NOT NULL,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // ── Idempotent column additions (for upgrades on existing DBs) ──────────
    // R123-E5 (V1-M30): the organizations table + users.organization_id +
    // its FK used to be (re-)created here (added by drizzle migration
    // 0001). organizations is DEAD — zero route/service/job/frontend
    // references, no INSERT anywhere, 0 live rows (R118-A3) — so nothing
    // creates it on fresh databases anymore, and applyOrganizations-
    // RemovalStage (V1-M30, the stage tail) drops the table, the column
    // and any FK on it from already-migrated databases (the R97-DB-04
    // precedent applied to V1-M15's firebase-uid duplicates).

    // Sessions table (server-side session tracking, referenced by JWT sessionId)
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS sessions (
        id         VARCHAR(255) PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        user_agent VARCHAR(255),
        ip_address VARCHAR(45),
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    `);

    await db.execute(sql`
      ALTER TABLE orders
        ADD COLUMN IF NOT EXISTS coupon_code     VARCHAR(50),
        ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00;
    `);

    // F1 (round-94 A6): reconciled via catalog probe — see
    // applyUsersColumnReconcileStage. Steady-state boots issue ZERO DDL
    // against `users` here (the old unconditional ADD COLUMN block plus
    // Stage C's drops churned 8 ALTER TABLEs on every cold start).
    await applyUsersColumnReconcileStage();

    // R97-DB-04 (round-97 F7): idx_users_firebase_uid +
    // idx_users_firebase_uid_unique used to be (re-)created here. Both are
    // structural duplicates of the column UNIQUE constraint backing index
    // users_firebase_uid_key (CREATE TABLE users … firebase_uid VARCHAR(255)
    // UNIQUE above) — three btree indexes on the same column tripled the
    // INSERT-time maintenance for zero query benefit. They are no longer
    // created on fresh databases, and applyTicketRepliesDriftClosureStage
    // (V1-M15) drops them on already-migrated ones.
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    `);

    // ── Passwordless cleanup (P1-5) ────────────────────────────────────────
    //
    // The platform is fully passwordless (Phone OTP / Google /
    // Telegram). The legacy `password_hash` column is now write-only
    // for the legacy_password admin path; new user rows should NOT
    // be forced to carry an empty-string placeholder.
    //
    // EXISTING rows are NOT altered — users with a real password_hash
    // keep it. Only the column constraints and DEFAULTS change so
    // new inserts behave correctly going forward.
    //
    // Each ALTER is guarded so the block stays idempotent across
    // every drift state of `users`:
    //   - Fresh DB: all four columns exist; every ALTER fires.
    //   - Mid-migration: password_hash dropped but password_login_enabled
    //     still present; only the still-existing-column ALTERs fire.
    //   - Post-Stage-C (steady state): password_hash +
    //     password_login_enabled both gone and auth_provider already
    //     carries the firebase_phone default → ZERO branches fire.
    //
    // F1 (round-94 A6): the default-reconcile branches additionally
    // compare the CURRENT default — `SET DEFAULT` with an unchanged
    // value is still an ALTER TABLE (AccessExclusiveLock) on `users`,
    // which used to fire on every boot forever. The value comparison
    // is representation-tolerant (LIKE on the pg-rendered default
    // text) so catalog formatting differences can't wedge it.
    //
    // Without these guards a bare `ALTER COLUMN password_hash DROP
    // NOT NULL` raises SQLSTATE 42703 (undefined_column) which
    // boot-migrations.ts classifies as critical, abort the migration,
    // and Stage C below never reaches its DROPs — the exact failure
    // mode this comment is preventing from re-emerging.
    await db.execute(sql`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='users' AND column_name='password_hash'
        ) THEN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name='users' AND column_name='password_hash'
              AND is_nullable = 'NO'
          ) THEN
            ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
          END IF;
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name='users' AND column_name='password_hash'
              AND column_default IS NOT NULL
          ) THEN
            ALTER TABLE users ALTER COLUMN password_hash DROP DEFAULT;
          END IF;
        END IF;

        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='users' AND column_name='auth_provider'
            AND (column_default IS NULL OR column_default NOT LIKE '%firebase_phone%')
        ) THEN
          ALTER TABLE users ALTER COLUMN auth_provider SET DEFAULT 'firebase_phone';
        END IF;

        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='users' AND column_name='password_login_enabled'
            AND (column_default IS NULL OR column_default NOT LIKE '%false%')
        ) THEN
          ALTER TABLE users ALTER COLUMN password_login_enabled SET DEFAULT FALSE;
        END IF;
      END $$;
    `);

    await db.execute(sql`
      ALTER TABLE admin_users
        ADD COLUMN IF NOT EXISTS totp_secret VARCHAR(255),
        ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE;
    `);

    // RBAC permissions + soft-delete flag for admin_users.
    // Idempotent across all four states:
    //   - column missing             → ADD COLUMN with empty default
    //   - column present, populated  → no-op
    //   - is_active column missing   → ADD with TRUE default
    //
    // The ["all"] backfill is strictly ONE-TIME — it fires only in the
    // same statement batch that ADDs the permissions column (pre-RBAC
    // admins must keep full access when requirePermission activates).
    // Previously the UPDATE re-ran on EVERY cold boot, which silently
    // re-granted ["all"] to admins whose permissions had been revoked
    // (permission revocation never stuck).
    const permColExisted = await db.execute(sql`
      SELECT 1 FROM information_schema.columns
      WHERE table_name='admin_users' AND column_name='permissions'
    `);
    const hadPermissionsColumn =
      ((permColExisted as any).rows?.length ?? (permColExisted as any).length ?? 0) > 0;

    await db.execute(sql`
      ALTER TABLE admin_users
        ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
    `);
    if (!hadPermissionsColumn) {
      await db.execute(sql`
        UPDATE admin_users
        SET permissions = '["all"]'::jsonb
        WHERE permissions = '[]'::jsonb OR permissions IS NULL;
      `);
    }

    // (B7-P0-2: the otps attempts ALTER that used to live here was removed —
    // it re-ran on every boot against a table the DO block above had just
    // created (and Stage C drops again), and the DO block already adds the
    // column via ADD COLUMN IF NOT EXISTS.)

    // ── Foreign Key constraints (idempotent — uses IF NOT EXISTS via DO block) ──
    const fkStatements = [
      `ALTER TABLE orders ADD CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`,
      `ALTER TABLE orders ADD CONSTRAINT fk_orders_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT`,
      `ALTER TABLE orders ADD CONSTRAINT fk_orders_inventory FOREIGN KEY (inventory_id) REFERENCES inventory(id) ON DELETE SET NULL`,
      `ALTER TABLE inventory ADD CONSTRAINT fk_inventory_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE`,
      `ALTER TABLE wallet_topups ADD CONSTRAINT fk_topups_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`,
      `ALTER TABLE notifications ADD CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`,
      `ALTER TABLE support_tickets ADD CONSTRAINT fk_tickets_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`,
      `ALTER TABLE referral_events ADD CONSTRAINT fk_referral_referrer FOREIGN KEY (referrer_id) REFERENCES users(id) ON DELETE CASCADE`,
      `ALTER TABLE referral_events ADD CONSTRAINT fk_referral_referee FOREIGN KEY (referee_id) REFERENCES users(id) ON DELETE CASCADE`,
      `ALTER TABLE users ADD CONSTRAINT fk_users_referred_by FOREIGN KEY (referred_by) REFERENCES users(id) ON DELETE SET NULL`,
      `ALTER TABLE user_auth_identities ADD CONSTRAINT fk_user_auth_identities_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`,
    ];
    for (const stmt of fkStatements) {
      await db.execute(
        sql`DO $$ BEGIN ${sql.raw(stmt)}; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
      );
    }

    // ── Missing indexes for common query patterns ───────────────────────────
    // R123-E5 (V1-M27): idx_orders_user / idx_orders_status / idx_topups_user /
    // idx_topups_status / idx_tickets_user / idx_referral_referrer are no
    // longer created — each is a strict prefix of a covering composite
    // (idx_orders_user_created / idx_orders_status_created /
    // idx_topups_user_created / idx_topups_status_created /
    // idx_tickets_user_created / idx_referral_referrer_created, the last
    // three created by V1-M27 itself). V1-M27 drops the six on
    // already-migrated databases (R97-DB-04 precedent).
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_orders_product ON orders(product_id);
      CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_inventory_product ON inventory(product_id);
      CREATE INDEX IF NOT EXISTS idx_inventory_sold ON inventory(is_sold) WHERE is_sold = false;
      -- R120-B6/A6-F3: fresh installs get the bell-sort shape directly
      -- (user_id, created_at DESC). Legacy (user_id, is_read) databases
      -- are converged by the V1-M24 probe-gated swap stage below — same
      -- name, so this IF NOT EXISTS no-ops there.
      CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code) WHERE referral_code IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users(referred_by);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_user_auth_identities_provider_uid ON user_auth_identities(provider, provider_uid);
      CREATE INDEX IF NOT EXISTS idx_user_auth_identities_user ON user_auth_identities(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_auth_identities_firebase_uid ON user_auth_identities(firebase_uid);
    `);

    // ── Encrypt existing plaintext account_passwords ─────────────────────────
    if (process.env.ENCRYPTION_KEY) {
      // F4 (round-94 A6): V1-M6-style length guard — a bare ALTER (even a
      // no-op re-widen to the same 512) is still an AccessExclusiveLock +
      // DDL-class command every boot on the most money-sensitive table.
      // Fires exactly once per legacy-255 database, never again.
      await db.execute(sql`
        DO $$ BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name='inventory' AND column_name='account_password'
              AND character_maximum_length = 255
          ) THEN
            ALTER TABLE inventory ALTER COLUMN account_password TYPE VARCHAR(512);
          END IF;
        END $$;
      `);
      // F4: SQL-side pre-filter — only rows that are NOT already in the
      // `iv:tag:ct` GCM shape are pulled into memory. The JS isEncrypted()
      // check below remains the authoritative gate (format-exact); this
      // predicate merely stops the full-ciphertext scan every boot.
      const result = await db.execute(
        sql`SELECT id, account_password FROM inventory
            WHERE account_password IS NOT NULL
              AND account_password NOT LIKE '%:%:%'`,
      );
      const rows: Array<{ id: number; account_password: string }> = Array.isArray(result)
        ? (result as Array<{ id: number; account_password: string }>)
        : ((result.rows as Array<{ id: number; account_password: string }>) ?? []);
      let reEncrypted = 0;
      for (const row of rows) {
        if (!isEncrypted(row.account_password)) {
          await db.execute(
            sql`UPDATE inventory SET account_password = ${encrypt(row.account_password)} WHERE id = ${row.id}`,
          );
          reEncrypted++;
        }
      }
      if (reEncrypted > 0) {
        logger.info({ reEncrypted }, "Re-encrypted plaintext inventory passwords");
      }
    } else {
      logger.warn("ENCRYPTION_KEY not set — inventory passwords remain plaintext");
    }

    // ── Seed: default auth provider configs (no-op if already set) ──────────
    const providerDefaults = [
      ["auth.google", JSON.stringify({ enabled: false, client_id: "", client_secret: "" })],
      ["auth.github", JSON.stringify({ enabled: false, client_id: "", client_secret: "" })],
      ["auth.facebook", JSON.stringify({ enabled: false, app_id: "", app_secret: "" })],
      ["auth.telegram", JSON.stringify({ enabled: false, bot_username: "", bot_token: "" })],
      [
        "auth.apple",
        JSON.stringify({ enabled: false, client_id: "", team_id: "", key_id: "", private_key: "" }),
      ],
    ];
    for (const [key, value] of providerDefaults) {
      await db.execute(sql`
        INSERT INTO system_settings (key, value)
        VALUES (${key}, ${value})
        ON CONFLICT (key) DO NOTHING
      `);
    }

    // ── Seed: Admin user ────────────────────────────────────────────────────
    const adminCountResult = await db.execute(sql`SELECT COUNT(*) as c FROM admin_users`);
    const adminCount = (adminCountResult as any).rows?.[0] ?? (adminCountResult as any)[0];
    if (Number(adminCount?.c ?? adminCount?.count ?? 0) === 0) {
      const adminUsername = process.env.ADMIN_USERNAME || "admin";
      const adminPassword = process.env.ADMIN_PASSWORD;
      if (!adminPassword && process.env.NODE_ENV === "production") {
        // Never bootstrap a production admin with a known default
        // password — that is a public credential in the repository.
        logger.error(
          "Refusing to seed default-password admin in production: set ADMIN_PASSWORD env",
        );
      } else {
        await db.execute(sql`
          INSERT INTO admin_users (username, password_hash, display_name, role, permissions)
          VALUES (${adminUsername}, ${await hashPassword(adminPassword || "SubNation@2026")}, 'مدير النظام', 'superadmin', '["all"]'::jsonb)
        `);
        logger.info({ username: adminUsername }, "Default admin user created");
      }
    }

    // ── Seed: Products ──────────────────────────────────────────────────────
    // Demo-catalog seeding is for DEV/STAGING ONLY (opt-in for prod via
    // ALLOW_DEMO_SEED=true). The <12 trigger previously could fire in
    // production after archiving, injecting demo Netflix/Spotify rows
    // into the live catalog.
    const demoSeedAllowed =
      process.env.NODE_ENV !== "production" || process.env.ALLOW_DEMO_SEED === "true";
    const productCountResult = await db.execute(sql`SELECT COUNT(*) as c FROM products`);
    const productCount = (productCountResult as any).rows?.[0] ?? (productCountResult as any)[0];
    if (demoSeedAllowed && Number(productCount?.c ?? productCount?.count ?? 0) < 12) {
      const products = [
        {
          name: "Netflix Premium",
          description:
            "استمتع بأفلام ومسلسلات عالمية بجودة 4K UHD على 4 شاشات في نفس الوقت. أفضل تجربة بث في العالم.",
          image_url: null,
          price: "14.99",
          category: "streaming",
          usage_terms: "لا تغيّر كلمة المرور أو البريد الإلكتروني. استخدام الحساب بشكل شخصي فقط.",
        },
        {
          name: "Spotify Premium",
          description:
            "استمع إلى ملايين الأغاني والبودكاست بدون إعلانات وبجودة صوت عالية. مناسب للأجهزة المحمولة والحاسوب.",
          image_url: null,
          price: "5.99",
          category: "music",
          usage_terms: "عدم مشاركة الحساب مع الغير. استخدام على جهاز واحد.",
        },
        {
          name: "Disney+ Standard",
          description:
            "محتوى ديزني وماريل وبيكسار وناشيونال جيوغرافيك وحرب النجوم — كل شيء في مكان واحد.",
          image_url: null,
          price: "9.99",
          category: "streaming",
          usage_terms: "حساب شخصي. لا يسمح بتغيير بيانات الحساب.",
        },
        {
          name: "YouTube Premium",
          description:
            "شاهد يوتيوب بدون إعلانات، حمّل الفيديوهات للمشاهدة بدون إنترنت، واستمتع بـ YouTube Music مجاناً.",
          image_url: null,
          price: "6.99",
          category: "streaming",
          usage_terms: "استخدم بريدك الشخصي للدخول إلى الحساب.",
        },
        {
          name: "PlayStation Plus Essential",
          description:
            "العب أونلاين مع أصدقائك واحصل على ألعاب شهرية مجانية وخصومات حصرية على متجر PlayStation.",
          image_url: null,
          price: "17.99",
          category: "gaming",
          usage_terms: "مفتاح تفعيل رقمي — لا يُرجع بعد الاسترداد.",
        },
        {
          name: "Xbox Game Pass Ultimate",
          description:
            "مكتبة ضخمة من الألعاب لأجهزة Xbox وPC، بالإضافة إلى EA Play وخدمة اللعب السحابي.",
          image_url: null,
          price: "19.99",
          category: "gaming",
          usage_terms: "رمز تفعيل لمدة شهر. لا يُرجع بعد الاستخدام.",
        },
        {
          name: "Canva Pro",
          description:
            "أداة التصميم الاحترافية — قوالب لا محدودة، إزالة الخلفيات، تصدير بجودة عالية، وتعاون مع الفريق.",
          image_url: null,
          price: "7.99",
          category: "productivity",
          usage_terms: "سيتم إرسال دعوة إلى بريدك الإلكتروني. لا تشارك الحساب.",
        },
        {
          name: "Microsoft 365 Personal",
          description: "احصل على Word وExcel وPowerPoint وOneDrive بسعة 1TB. مثالي للعمل والدراسة.",
          image_url: null,
          price: "12.99",
          category: "productivity",
          usage_terms: "مفتاح تفعيل رقمي لسنة كاملة. لجهاز واحد فقط.",
        },
        {
          name: "NordVPN 1 شهر",
          description:
            "حماية كاملة لخصوصيتك على الإنترنت. سرعة فائقة، 6000+ خادم حول العالم، بدون تسجيل بيانات.",
          image_url: null,
          price: "8.99",
          category: "productivity",
          usage_terms: "رمز تفعيل. يُستخدم على جهازين في آن واحد.",
        },
        {
          name: "Apple TV+",
          description: "أفلام ومسلسلات Apple الأصلية الحصرية بجودة 4K HDR. محتوى جديد كل أسبوع.",
          image_url: null,
          price: "4.99",
          category: "streaming",
          usage_terms: "حساب مشترك. لا تغيّر بيانات الدخول.",
        },
        {
          name: "Adobe Creative Cloud",
          description:
            "جميع تطبيقات Adobe — Photoshop وIllustrator وPremiere وAfter Effects وأكثر من 20 تطبيق احترافي.",
          image_url: null,
          price: "24.99",
          category: "productivity",
          usage_terms: "حساب شخصي مؤقت. لا تغيّر كلمة المرور.",
        },
        {
          name: "Crunchyroll Premium",
          description:
            "شاهد أحدث الأنمي فور بثّه في اليابان بدون إعلانات وبجودة 1080p. أكبر مكتبة أنمي في العالم.",
          image_url: null,
          price: "4.49",
          category: "streaming",
          usage_terms: "حساب مشترك. استخدم البروفايل المخصص لك.",
        },
      ];

      for (const p of products) {
        // Insert product only if name doesn't already exist
        const existRes = await db.execute(
          sql`SELECT id FROM products WHERE name = ${p.name} LIMIT 1`,
        );
        const existRow = (existRes as any).rows?.[0] ?? (existRes as any)[0];
        let productId: number;

        if (existRow?.id) {
          productId = existRow.id;
        } else {
          const insertedResult = await db.execute(sql`
            INSERT INTO products (name, description, image_url, price, category, is_active, is_archived, usage_terms)
            VALUES (${p.name}, ${p.description}, ${p.image_url}, ${p.price}, ${p.category}, true, false, ${p.usage_terms})
            RETURNING id
          `);
          const insertedRow = (insertedResult as any).rows?.[0] ?? (insertedResult as any)[0];
          productId = insertedRow.id;
        }

        // Add inventory items if this product has fewer than 5 unsold units
        const invRes = await db.execute(
          sql`SELECT COUNT(*) as c FROM inventory WHERE product_id = ${productId} AND is_sold = false`,
        );
        const invRow = (invRes as any).rows?.[0] ?? (invRes as any)[0];
        const invCount = Number(invRow?.c ?? 0);

        if (invCount < 5) {
          const toAdd = 5 - invCount;
          for (let i = 1; i <= toAdd; i++) {
            const emailNum = String(productId * 100 + invCount + i).padStart(5, "0");
            await db.execute(sql`
              INSERT INTO inventory (product_id, account_email, account_password, extra_details, is_sold)
              VALUES (
                ${productId},
                ${`sub${emailNum}@subnation.ly`},
                ${`SN${emailNum}@Pass`},
                ${"احتفظ ببيانات الدخول في مكان آمن. لا تشاركها مع أحد."},
                false
              )
            `);
          }
        }
      }

      logger.info("Sample products and inventory seeded successfully");

      // Seed a welcome coupon
      await db.execute(sql`
        INSERT INTO coupons (code, type, value, min_order_amount, max_uses, is_active, description)
        VALUES ('WELCOME10', 'percentage', 10.00, 0.00, 100, true, 'خصم 10% للمستخدمين الجدد')
        ON CONFLICT (code) DO NOTHING
      `);

      logger.info("Welcome coupon WELCOME10 created");
    }

    // ── Fix: clear any broken wikimedia image URLs ───────────────────────────
    // AUD103-1-F7 (r103): probe-gated — this used to run the UPDATE
    // unconditionally on EVERY boot (a seq-scan DML with zero matching
    // rows in steady state, and it would silently revert a deliberate
    // operator wikimedia image at the next restart). Same probe-then-act
    // discipline the users backfills use.
    const wikimediaHit = await db.execute(sql`
      SELECT 1 FROM products
      WHERE image_url LIKE '%wikimedia%' OR image_url LIKE '%wikipedia%'
      LIMIT 1
    `);
    const wikimediaRows =
      (wikimediaHit as unknown as { rows?: unknown[] }).rows ??
      (wikimediaHit as unknown as unknown[]) ??
      [];
    if (wikimediaRows.length > 0) {
      await db.execute(sql`
        UPDATE products SET image_url = NULL WHERE image_url LIKE '%wikimedia%' OR image_url LIKE '%wikipedia%'
      `);
      logger.info("Cleared broken wikimedia image URL(s) from products");
    }

    // ── Add onboarding columns to users table if not present ─────────────────
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'onboarded_at'
        ) THEN
          ALTER TABLE users ADD COLUMN onboarded_at TIMESTAMPTZ;
        END IF;
        
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'onboarding_step'
        ) THEN
          ALTER TABLE users ADD COLUMN onboarding_step INTEGER NOT NULL DEFAULT 1;
        END IF;
      END $$;
    `);

    logger.info("Migrations completed");

    // ── Data Migration: Legacy providers to user_auth_identities ───────────
    // 2026-09-20 final audit fix: this loop used to reference github_id /
    // facebook_id unconditionally — columns Stage C deliberately DROPPED
    // (the providers never shipped). Every cold start therefore threw
    // "column github_id does not exist" (level-50 "Data migration failed")
    // AND the exception aborted the loop before telegram_id ever ran.
    // Now each provider is catalog-probed (the same F1 discipline the
    // cleanup stage below uses) and wrapped in its own try/catch so one
    // missing column can never mask another provider's backfill.
    try {
      const providersToMigrate = [
        { column: "google_id", provider: "google.com" },
        { column: "github_id", provider: "github.com" },
        { column: "facebook_id", provider: "facebook.com" },
        { column: "telegram_id", provider: "telegram.org" },
      ];

      // One catalog probe for the users table's column set.
      const usersColumns = new Set(
        extractRows(
          await db.execute(sql`
            SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'users'
          `),
        ).map((r) => String(r.column_name)),
      );

      for (const { column, provider } of providersToMigrate) {
        if (!usersColumns.has(column)) {
          logger.info(
            `Legacy provider backfill skipped — users.${column} no longer exists (provider retired)`,
          );
          continue;
        }
        try {
          await db.execute(sql`
            INSERT INTO user_auth_identities (user_id, provider, provider_uid, firebase_uid, email, phone, email_verified, phone_verified)
            SELECT
              id as user_id,
              ${provider} as provider,
              ${sql.raw(column)} as provider_uid,
              firebase_uid,
              email,
              phone,
              email_verified,
              phone_verified
            FROM users
            WHERE ${sql.raw(column)} IS NOT NULL
            ON CONFLICT (provider, provider_uid) DO NOTHING;
          `);
        } catch (perProviderErr) {
          // Per-provider isolation: a failure here must not abort the
          // remaining providers (the pre-fix bug: github's error starved
          // telegram's backfill forever).
          logger.error(
            { err: perProviderErr, provider, column },
            "Legacy provider backfill failed for one provider — continuing with the rest",
          );
        }
      }
      logger.info("Legacy provider data migrated to user_auth_identities");
    } catch (migErr) {
      logger.error({ err: migErr }, "Data migration failed");
    }
    // ── Stage C: full passwordless cleanup ─────────────────────────────────
    //
    // Pre-launch system with effectively zero legacy users. The previous
    // ALTERs above (DROP NOT NULL, change defaults) were a transitional
    // step; this block now drops the legacy password infrastructure
    // outright. All idempotent — safe to re-run on every cold start.
    //
    //   - password_hash               : column dropped (no production users
    //                                    rely on bcrypt-based login)
    //   - password_login_enabled      : column dropped (UI gating gone)
    //   - legacy_password_disabled_at : column dropped (audit-trail field)
    //   - github_id                   : column dropped (Stage A removed
    //                                    GitHub OAuth provider)
    //   - facebook_id                 : column dropped (Stage A removed
    //                                    Facebook OAuth provider)
    //   - otps table                  : dropped (only legacy
    //                                    /forgot-password + /reset-password
    //                                    used it; both routes removed)
    //
    // F1 (round-94 A6): the drops are now catalog-probed (see
    // applyUsersPasswordlessCleanupStage) — the previous five bare
    // `DROP COLUMN IF EXISTS` statements were five no-op ALTER TABLEs
    // (each an AccessExclusiveLock) on `users` on EVERY boot, forever.
    //
    // The Drizzle schema in shared/db/src/schema/users.ts has been updated
    // to match. Application code that referenced these columns has been
    // removed; the typecheck in CI catches any regression.
    await applyUsersPasswordlessCleanupStage();

    // ── Monetization Increment 1: profit visibility ───────────────────────
    //
    // Adds a per-product `cost_price` column for the admin pricing
    // calculator. Nullable — existing rows have no procurement cost
    // recorded; new products are expected to set it via the admin UI
    // but the backend NEVER enforces it. Pure visibility / no behavior
    // change in the order pipeline.
    //
    // Context: the audit found operators had no margin visibility
    // because product cost was never tracked. This column closes that
    // gap without altering checkout, coupon, flash-sale, or referral
    // logic. See SECURITY_FIXES.md / monetization audit notes.
    await db.execute(sql`
      ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_price NUMERIC(10,2);
    `);

    // ── SEO Phase 2: long-form content + FAQ ──────────────────────────────
    //
    // Adds two additive, nullable columns on `products` for richer SEO
    // surface on product pages:
    //
    //   description_long  TEXT  : long-form description (300–800 words).
    //                              Renders below the short `description`
    //                              on the product page and feeds the
    //                              Product LD `description` field. Pure
    //                              presentational/structured-data — no
    //                              checkout, ledger, or pricing impact.
    //   faq               JSONB : per-product FAQ entries
    //                              ({question, answer}[]). Rendered as
    //                              a visible accordion on the product
    //                              page AND emitted as `FAQPage` JSON-LD.
    //
    // Both NULL by default; existing rows are unaffected. The frontend
    // gracefully omits the section when the field is null/empty. Idempotent
    // — safe to re-run on every cold start.
    await db.execute(sql`
      ALTER TABLE products ADD COLUMN IF NOT EXISTS description_long TEXT;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS faq JSONB;
    `);

    // ── 010-ai-admin-copilot: staleness columns + copilot tables ─────────────
    //
    // The AI Admin Copilot (010-ai-admin-copilot, FR-PREVIEW-004) detects a
    // stale preview by comparing the target entity's `updated_at` between
    // draft and execute. `products` already had the column; `inventory` and
    // `admin_users` did not. Both are writable in Phase 3 (FR-DATA-002), so
    // both must carry the column for the staleness check to be honest.
    //
    // The Drizzle `$onUpdate` hook on the schema only fires on Drizzle calls,
    // not on raw SQL. Existing inline raw-SQL writes against these tables
    // (admin password reset, inventory bulk import) MUST set updated_at
    // explicitly going forward.
    //
    // Idempotent: NOT NULL with DEFAULT now() backfills existing rows on the
    // ADD COLUMN; subsequent boots are no-ops.
    await db.execute(sql`
      ALTER TABLE inventory   ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
      ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    `);

    // Three new tables for the copilot's preview/audit pipeline. Spec lives
    // in specs/010-ai-admin-copilot/data-model.md §1; immutability,
    // single-use enforcement, and reconciliation invariants enforced by
    // application code, not DB constraints (we don't trust DB-level
    // immutability triggers to survive future migrations).
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS copilot_previews (
        id                    VARCHAR(32)  PRIMARY KEY,
        admin_id              INTEGER      NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
        intent_text           TEXT         NOT NULL,
        tool_name             VARCHAR(100) NOT NULL,
        action_class          VARCHAR(50)  NOT NULL,
        risk_tier             VARCHAR(20)  NOT NULL,
        affected_ids          JSONB        NOT NULL,
        affected_entity_type  VARCHAR(50)  NOT NULL,
        record_versions       JSONB        NOT NULL,
        preview_payload       JSONB        NOT NULL,
        model_id              VARCHAR(64)  NOT NULL,
        correlation_id        VARCHAR(64)  NOT NULL,
        created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        expires_at            TIMESTAMPTZ  NOT NULL,
        consumed_at           TIMESTAMPTZ,
        confirmed_once_at     TIMESTAMPTZ,
        cooldown_starts_at    TIMESTAMPTZ,
        confirmed_twice_at    TIMESTAMPTZ
      );

      CREATE INDEX IF NOT EXISTS idx_copilot_previews_admin_created
        ON copilot_previews(admin_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_copilot_previews_expires
        ON copilot_previews(expires_at);
      CREATE INDEX IF NOT EXISTS idx_copilot_previews_action_class
        ON copilot_previews(action_class);

      CREATE TABLE IF NOT EXISTS copilot_actions (
        id                  SERIAL       PRIMARY KEY,
        preview_id          VARCHAR(32)  REFERENCES copilot_previews(id) ON DELETE SET NULL,
        admin_id            INTEGER      NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
        intent_text         TEXT         NOT NULL,
        tool_name           VARCHAR(100),
        action_class        VARCHAR(50)  NOT NULL,
        risk_tier           VARCHAR(20)  NOT NULL,
        outcome             VARCHAR(20)  NOT NULL,
        failure_reason      TEXT,
        before_state        JSONB,
        after_state         JSONB,
        confirmed_once_at   TIMESTAMPTZ,
        confirmed_twice_at  TIMESTAMPTZ,
        executed_at         TIMESTAMPTZ,
        model_id            VARCHAR(64),
        model_input_tokens  INTEGER,
        model_output_tokens INTEGER,
        correlation_id      VARCHAR(64)  NOT NULL,
        created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_copilot_actions_admin_created
        ON copilot_actions(admin_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_copilot_actions_action_class
        ON copilot_actions(action_class);
      CREATE INDEX IF NOT EXISTS idx_copilot_actions_outcome
        ON copilot_actions(outcome);
      CREATE INDEX IF NOT EXISTS idx_copilot_actions_preview
        ON copilot_actions(preview_id);

      CREATE TABLE IF NOT EXISTS copilot_action_items (
        id              SERIAL       PRIMARY KEY,
        action_id       INTEGER      NOT NULL REFERENCES copilot_actions(id) ON DELETE CASCADE,
        entity_type     VARCHAR(50)  NOT NULL,
        entity_id       INTEGER      NOT NULL,
        outcome         VARCHAR(20)  NOT NULL,
        failure_reason  TEXT,
        before_value    JSONB,
        after_value     JSONB
      );

      CREATE INDEX IF NOT EXISTS idx_copilot_action_items_action
        ON copilot_action_items(action_id);
      CREATE INDEX IF NOT EXISTS idx_copilot_action_items_entity
        ON copilot_action_items(entity_type, entity_id);
    `);

    // 010-ai-admin-copilot: trigram index on products.name for fuzzy
    // resolve_product (Arabic/English/typo tolerant). pg_trgm extension
    // is probed/created at the top of this function; when the extension
    // is unavailable in this environment the index is skipped (search
    // falls back to seq scan — correct, just slower).
    if (pgTrgmAvailable) {
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_products_name_trgm
          ON products USING gin (name gin_trgm_ops);
      `);
    }

    // ── 011-inventory-demand-forecast: forecast pipeline tables ──────────────
    //
    // Two new tables for the daily statistical demand-forecasting job
    // (specs/011-inventory-demand-forecast/data-model.md). Read-only
    // surface — never on the customer purchase critical path
    // (FR-FORECAST-005). Both tables are additive; existing flows
    // unaffected.
    //
    //   inventory_forecast_runs : one row per cron execution; powers the
    //                              "last successful run" surface on the
    //                              admin panel + the calibration analysis.
    //   inventory_forecasts     : one row per (product, forecast_date);
    //                              upsert-on-conflict pattern keeps the
    //                              re-run idempotent (FR-FORECAST-006).
    //
    // The admin_alerts.type extension to 'forecast_stockout' is a no-op:
    // the column is varchar(30), not an enum (audit notes-admin-alerts-type.md).
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS inventory_forecast_runs (
        id                 SERIAL       PRIMARY KEY,
        started_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        completed_at       TIMESTAMPTZ,
        outcome            VARCHAR(20)  NOT NULL DEFAULT 'in_flight',
        products_predicted INTEGER      NOT NULL DEFAULT 0,
        products_skipped   JSONB        NOT NULL DEFAULT '{}'::jsonb,
        alerts_emitted     INTEGER      NOT NULL DEFAULT 0,
        alerts_capped      BOOLEAN      NOT NULL DEFAULT false,
        capture_rate_14d   NUMERIC(4,3),
        worker_tier        VARCHAR(50),
        failure_reason     TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_forecast_runs_started_at
        ON inventory_forecast_runs (started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_forecast_runs_outcome
        ON inventory_forecast_runs (outcome, started_at DESC);

      CREATE TABLE IF NOT EXISTS inventory_forecasts (
        id                       SERIAL       PRIMARY KEY,
        run_id                   INTEGER      NOT NULL REFERENCES inventory_forecast_runs(id) ON DELETE CASCADE,
        product_id               INTEGER      NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        forecast_date            DATE         NOT NULL,
        current_stock_on_hand    INTEGER      NOT NULL,
        avg_daily_sales          NUMERIC(8,4),
        dow_blend_7d             NUMERIC(8,4),
        predicted_demand_7d      INTEGER,
        predicted_demand_30d     INTEGER,
        predicted_runout_at      DATE,
        recommended_reorder_qty  INTEGER,
        confidence               VARCHAR(20)  NOT NULL,
        at_risk                  BOOLEAN      NOT NULL DEFAULT false,
        created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        CONSTRAINT chk_forecast_confidence
          CHECK (confidence IN ('high','medium','low','insufficient_data')),
        CONSTRAINT chk_forecast_insufficient_consistency
          CHECK ((confidence = 'insufficient_data') = (avg_daily_sales IS NULL))
      );

      CREATE UNIQUE INDEX IF NOT EXISTS uq_forecast_product_date
        ON inventory_forecasts (product_id, forecast_date);
      CREATE INDEX IF NOT EXISTS idx_forecasts_at_risk_runout
        ON inventory_forecasts (at_risk, predicted_runout_at)
        WHERE at_risk = true;
      -- R123-E5 (V1-M27): idx_forecasts_product_date no longer created —
      -- a strict prefix of uq_forecast_product_date above (a DESC btree
      -- on the same pair is served by the unique index scanned
      -- backwards). V1-M27 drops it on already-migrated databases.
      CREATE INDEX IF NOT EXISTS idx_forecasts_run
        ON inventory_forecasts (run_id);
    `);

    // ── 012-arabic-catalog-enrichment: enrichment pipeline tables ────────────
    //
    // Two new tables for the off-peak Arabic catalog enrichment cron
    // (specs/012-arabic-catalog-enrichment/data-model.md). Read-only at
    // the LLM boundary; admin-in-the-loop on every output (FR-SAFETY-001).
    //
    //   enrichment_runs   — one row per cron execution; powers the
    //                       SC-004 cost-cap accounting + the panel's
    //                       "last run" surface.
    //   enrichment_drafts — one row per (product, field, iteration);
    //                       state machine + admin-edited final_text +
    //                       audit timestamps.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS enrichment_runs (
        id                SERIAL       PRIMARY KEY,
        started_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        completed_at      TIMESTAMPTZ,
        outcome           VARCHAR(20)  NOT NULL DEFAULT 'in_flight',
        drafts_generated  INTEGER      NOT NULL DEFAULT 0,
        drafts_invalid    INTEGER      NOT NULL DEFAULT 0,
        products_skipped  JSONB        NOT NULL DEFAULT '{}'::jsonb,
        tokens_spent      INTEGER      NOT NULL DEFAULT 0,
        daily_token_cap   INTEGER      NOT NULL DEFAULT 0,
        cap_reached       BOOLEAN      NOT NULL DEFAULT false,
        worker_tier       VARCHAR(50),
        failure_reason    TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_enrichment_runs_started_at
        ON enrichment_runs (started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_enrichment_runs_outcome
        ON enrichment_runs (outcome, started_at DESC);

      CREATE TABLE IF NOT EXISTS enrichment_drafts (
        id                  SERIAL       PRIMARY KEY,
        run_id              INTEGER      NOT NULL REFERENCES enrichment_runs(id) ON DELETE CASCADE,
        product_id          INTEGER      NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        field_name          VARCHAR(50)  NOT NULL,
        state               VARCHAR(20)  NOT NULL DEFAULT 'drafted',
        generated_text      TEXT         NOT NULL,
        final_text          TEXT,
        model_id            VARCHAR(64)  NOT NULL,
        input_tokens        INTEGER      NOT NULL DEFAULT 0,
        output_tokens       INTEGER      NOT NULL DEFAULT 0,
        created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        published_at        TIMESTAMPTZ,
        published_by        INTEGER      REFERENCES admin_users(id) ON DELETE SET NULL,
        rejected_at         TIMESTAMPTZ,
        rejected_by         INTEGER      REFERENCES admin_users(id) ON DELETE SET NULL,
        rejection_reason    TEXT,
        validation_errors   JSONB,
        CONSTRAINT chk_enrichment_state
          CHECK (state IN ('drafted','published','rejected','draft_invalid')),
        CONSTRAINT chk_enrichment_field
          CHECK (field_name IN ('description','description_long','faq')),
        CONSTRAINT chk_enrichment_published_consistency
          CHECK ((state = 'published') = (published_at IS NOT NULL)),
        CONSTRAINT chk_enrichment_rejected_consistency
          CHECK ((state = 'rejected') = (rejected_at IS NOT NULL))
      );

      CREATE INDEX IF NOT EXISTS idx_enrichment_drafts_state_created
        ON enrichment_drafts (state, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_enrichment_drafts_product_field_state
        ON enrichment_drafts (product_id, field_name, state, rejected_at);
      CREATE INDEX IF NOT EXISTS idx_enrichment_drafts_run
        ON enrichment_drafts (run_id);
    `);

    // ── 003-anomaly-detection: risk pipeline tables ─────────────────────────
    //
    // Four entities from specs/003-anomaly-detection/data-model.md. The
    // pipeline itself is gated by RISK_PIPELINE_ENABLED (default off) and
    // degrades to rules-only fallback, so these tables were historically
    // absent from this migration — enabling the pipeline on a fresh boot
    // crashed with "relation does not exist". They are now part of the
    // canonical schema so the feature flag is safe to flip anywhere.
    //
    // Mirrors shared/db/src/schema/risk.ts exactly (serial PKs per project
    // convention; enums via pg_type guard above).
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS risk_events (
        id                  SERIAL       PRIMARY KEY,
        user_id             INTEGER      REFERENCES users(id) ON DELETE SET NULL,
        event_type          risk_event_type NOT NULL,
        score               INTEGER      NOT NULL,
        level               risk_level   NOT NULL,
        confidence          NUMERIC(4,3) NOT NULL,
        rule_fired          TEXT[]       NOT NULL DEFAULT '{}',
        statistical_signals JSONB        NOT NULL DEFAULT '{}'::jsonb,
        ml_score            NUMERIC(4,3),
        top_features        JSONB,
        action_taken        risk_action_taken NOT NULL DEFAULT 'log',
        ip_address          VARCHAR(45),
        user_agent          VARCHAR(256),
        created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        shown_at            TIMESTAMPTZ
      );

      CREATE INDEX IF NOT EXISTS idx_risk_events_user_created
        ON risk_events (user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_risk_events_level_created
        ON risk_events (level, created_at);
      -- R123-E5 (V1-M27): idx_risk_events_created no longer created — a
      -- strict prefix of idx_risk_events_created_id_desc (round-4 block
      -- below). V1-M27 drops it on already-migrated databases.
      CREATE INDEX IF NOT EXISTS idx_risk_events_type_created
        ON risk_events (event_type, created_at);

      CREATE TABLE IF NOT EXISTS risk_rules (
        id            SERIAL       PRIMARY KEY,
        name          VARCHAR(100) NOT NULL UNIQUE,
        description   TEXT         NOT NULL,
        expression    JSONB        NOT NULL,
        enabled       BOOLEAN      NOT NULL DEFAULT TRUE,
        version       INTEGER      NOT NULL DEFAULT 1,
        created_by    INTEGER      REFERENCES admin_users(id) ON DELETE SET NULL,
        created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_by    INTEGER      REFERENCES admin_users(id) ON DELETE SET NULL,
        updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );

      -- R123-E5 (V1-M27): idx_risk_rules_name no longer created — the
      -- risk_rules.name UNIQUE constraint backing index
      -- (risk_rules_name_unique) already serves every name lookup; the
      -- plain twin only added INSERT-time maintenance. V1-M27 drops it
      -- on already-migrated databases.
      CREATE INDEX IF NOT EXISTS idx_risk_rules_enabled
        ON risk_rules (enabled);

      CREATE TABLE IF NOT EXISTS risk_config (
        id                       INTEGER  PRIMARY KEY DEFAULT 1,
        thresholds               JSONB    NOT NULL DEFAULT '{"low":0,"medium":30,"high":60,"critical":85}'::jsonb,
        allowlist                JSONB    NOT NULL DEFAULT '{"ips":[],"devices":[],"phones":[]}'::jsonb,
        auto_block_enabled       JSONB    NOT NULL DEFAULT '{"softBlock":true,"hardBlock":false,"alert":true}'::jsonb,
        require_approval_user_ids JSONB   NOT NULL DEFAULT '[]'::jsonb,
        model_enabled            BOOLEAN  NOT NULL DEFAULT FALSE,
        updated_by               INTEGER  REFERENCES admin_users(id) ON DELETE SET NULL,
        updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS risk_labels (
        id             SERIAL       PRIMARY KEY,
        risk_event_id  INTEGER      REFERENCES risk_events(id) ON DELETE SET NULL,
        label          risk_label_kind NOT NULL,
        labeled_by     INTEGER      REFERENCES admin_users(id) ON DELETE SET NULL,
        labeled_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        notes          TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_risk_labels_event
        ON risk_labels (risk_event_id);
      CREATE INDEX IF NOT EXISTS idx_risk_labels_label_labeled_at
        ON risk_labels (label, labeled_at);
      CREATE INDEX IF NOT EXISTS idx_risk_labels_labeled_at
        ON risk_labels (labeled_at);
    `);

    // ── Round-4 (r4 red-team F-2): port the drizzle 0005 indexes into
    // the runtime migration path. Prod schema changes flow exclusively
    // through THIS file (post-merge.sh dropped `drizzle-kit push`), so
    // when 0005 shipped as a drizzle-kit-only migration none of these
    // indexes ever reached production — the perf claims were inert and
    // the drizzle snapshot silently lied about the live schema.
    // Idempotent CREATE INDEX IF NOT EXISTS keeps cold boots safe.
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_orders_user_created
        ON orders (user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_wallet_ledger_user_created
        ON wallet_ledger (user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_users_created
        ON users (created_at);
      CREATE INDEX IF NOT EXISTS idx_risk_events_created_id_desc
        ON risk_events (created_at DESC NULLS LAST, id DESC NULLS LAST);
    `);
    // Admin user search uses LIKE '%x%' on phone — btree can't serve
    // leading-wildcard patterns; pg_trgm + GIN (same pattern as
    // idx_products_name_trgm above). Skipped when the extension is
    // unavailable (see the extensions block at the top).
    if (pgTrgmAvailable) {
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_users_phone_trgm
          ON users USING gin (phone gin_trgm_ops);
      `);
    }

    // ── V1-M7 (Round-5 db-audit 2026-09-07): encrypt legacy plaintext ──
    // delivered_password rows. The H2 fix (checkout.service) stores
    // AES-256-GCM ciphertext for NEW orders, and its comment claimed
    // "no backfill needed, reads keep working" — reads do keep working
    // (safeDecrypt passes plaintext through), but the security goal
    // ("a DB dump / backup leak = every delivered account exposed") is
    // still violated for every pre-fix row. Live production state at
    // audit time: all 3 existing orders stored raw credentials. This
    // migration encrypts any non-encrypted value once, at boot, with
    // the app's real ENCRYPTION_KEY — after it runs the column is
    // uniformly ciphertext and safeDecrypt keeps decrypting it.
    //
    // Format guard, not content sniffing: the app format is
    // `iv:authTag:ciphertext` (three hex segments). Values without two
    // ':' separators with exact segment lengths (24/32 hex) are legacy
    // plaintext. The same predicate is isEncrypted() in lib/encryption.
    {
      const legacyRows = (await db.execute(sql`
        SELECT id, delivered_password FROM orders
        WHERE delivered_password IS NOT NULL
          AND delivered_password NOT LIKE '%:%:%'
      `)) as { rows?: Array<{ id: number; delivered_password: string }> };
      const rows =
        legacyRows.rows ??
        (legacyRows as unknown as Array<{ id: number; delivered_password: string }>);
      let encrypted = 0;
      for (const row of rows) {
        if (isEncrypted(row.delivered_password)) continue;
        const ciphertext = encrypt(row.delivered_password);
        if (ciphertext.length > 512) {
          // V1-M6 widened the column to 512; a value that still cannot
          // fit would abort boot — refuse loudly instead. Passwords
          // this long are test artifacts; the operator should fix the
          // inventory row, not the migration.
          throw new Error(
            `order ${row.id}: delivered_password too long to encrypt (${row.delivered_password.length} chars plaintext)`,
          );
        }
        await db.execute(sql`
          UPDATE orders SET delivered_password = ${ciphertext}, updated_at = NOW()
          WHERE id = ${row.id}
        `);
        encrypted += 1;
      }
      if (encrypted > 0)
        logger.info(
          { category: "security", encrypted },
          "V1-M7: encrypted legacy plaintext delivered_password rows",
        );
    }

    // ── V1-M8 (Round-5 db-audit 2026-09-07): one-time consolidation ──
    // of the stock-alert spam already in production (244 no_stock +
    // 77 low_stock rows for ~6 products — dedupe only stops FUTURE
    // duplicates). Keeps the newest row per (type, title); safe to
    // re-run (no-ops once collapsed). Imported lazily to avoid a
    // circular module-load (alertLogger imports socket dynamically,
    // which reads env at connect time — migration boot must not pay
    // that cost).
    {
      const { consolidateStockAlertSpam } = await import("./jobs/alertLogger");
      const removed = await consolidateStockAlertSpam();
      if (removed > 0)
        logger.info(
          { category: "alerts.retention", removed },
          "V1-M8: consolidated duplicate stock alerts (kept newest per product)",
        );
    }

    // ── V1-M9 (round-92 B8 audit): money-table constraint backfill ──
    // See applyMoneyConstraintStage() above for the full design. Runs on
    // every boot; every statement inside is guarded (IF NOT EXISTS /
    // count-probe + alert) so steady-state boots are no-ops.
    await applyMoneyConstraintStage();

    // ── V1-M10 (round-93 A2/A7): wallet_ledger amount <> 0 ──
    // Replaces the V1-M9 chk_ledger_amount_pos (amount > 0) that breaks
    // signed debit adjustments. Must run AFTER applyMoneyConstraintStage:
    // the stage first guarantees chk_ledger_amount_nonzero exists (fresh
    // installs), then this drops the legacy-named twin on already-migrated
    // databases — both constraints coexist for the microseconds in between,
    // and no live row violates either (probe above). Same guards, same
    // write-gate, same no-op steady state as V1-M9.
    await applyLedgerAmountNonzeroStage();

    // ── V1-M12 (round-94 A4/C4/C6): idempotency_keys ──
    // Durable, transactional dedup backstop for the customer money path
    // (claim-inside-the-purchase-tx). Catalog-probed DO block → re-runs
    // are no-ops; see applyIdempotencyKeysStage for the column pinning
    // against shared/db/src/schema/idempotency-keys.ts + lib/idempotency.ts.
    await applyIdempotencyKeysStage();

    // ── V1-M13 (round-94 A8): admin_sessions ──
    // Revocable admin sessions (sid-bound tokens). See
    // applyAdminSessionsStage for the column pinning against
    // shared/db/src/schema/admin-sessions.ts + lib/admin-session.ts.
    await applyAdminSessionsStage();

    // ── V1-M14 (round-97 F7): official registration of scheduler_leader_lease ──
    // + account_link_consents. Both tables were introduced with lazy
    // CREATE IF NOT EXISTS bootstrap by 97-F1/97-F2 (deploy-order-proof);
    // this registers them in the canonical schema chain so every live
    // table is owned by migrate.ts. DO-block probes → re-runs are no-ops.
    await applySchedulerLeaseAndConsentTablesStage();

    // ── V1-M15 (round-97 F7): ticket_replies drift closure (R97-DB-02) + ──
    // duplicate users.firebase_uid index cleanup (R97-DB-04). Orphan
    // replies are counted + deleted + logged BEFORE the FK lands; the FK
    // and idx_replies_ticket bring the live DB up to what the schema TS
    // has always declared. All branches probe-gated / IF NOT EXISTS →
    // steady-state boots are no-ops.
    await applyTicketRepliesDriftClosureStage();

    // ── V1-M16 (catalog reconstruction 2026-09-20): product_variants + ──
    // variant wiring (orders / inventory / cart_items) + products SEO
    // columns. Fully additive + idempotent — steady-state boots are
    // no-ops after the first run. See applyProductVariantsStage docs.
    await applyProductVariantsStage();

    // ── V1-M17 (round-98 F4, R98-DB-05): NULLS NOT DISTINCT rebuild of ──
    // uniq_product_variants_plan_duration. Runs AFTER V1-M16 (which owns
    // the table + base index); probe-gated → steady-state boots are
    // no-ops. See applyProductVariantsNullsNotDistinctStage docs.
    await applyProductVariantsNullsNotDistinctStage();

    // ── V1-M18 (R102, provider-readiness): provider_fulfillments + the ──
    // provider-order idempotency index. Fully additive; runs last so the
    // orders table it references is guaranteed present. Probe-gated →
    // steady-state boots are no-ops. See applyProviderFulfillmentsStage docs.
    await applyProviderFulfillmentsStage();

    // ── V1-M19 (R102, loyalty durable guard): idempotency_keys ──
    // generalization (nullable order_id + reference_type). Idempotent
    // ALTERs; the checkout path is unchanged. See
    // applyIdempotencyReferenceTypeStage docs.
    await applyIdempotencyReferenceTypeStage();

    // ── V1-M20 (R108, final-hardening FH-A7 P0): drop the V1-M12 ──
    // orders(id) FK from idempotency_keys.order_id — the column is a
    // polymorphic reference now (reference_type-discriminated) and the
    // wallet topup-create claim writes wallet_topups.id into it. Must run
    // BEFORE the first post-cutover topup; idempotent + probe-gated. See
    // applyIdempotencyDropOrderFkStage docs.
    await applyIdempotencyDropOrderFkStage();

    // ── V1-M21 (R115, loyalty economics): points_ledger + ──
    // users.welcome_bonus_granted + users.loyalty_points >= 0 CHECK.
    // Append-only attribution ledger — every point mutation becomes
    // reconstructable; structural exactly-once per source. Probe-gated
    // CHECK follows the V1-M9 discipline. See applyPointsLedgerStage docs.
    await applyPointsLedgerStage();

    // ── V1-M22 (R115, refund reconciliation): orders.refunded_at / ──
    // refund_amount / refunded_by_admin_id + backfill from wallet_ledger.
    // Idempotent + probe-gated. See applyOrdersRefundColumnsStage docs.
    await applyOrdersRefundColumnsStage();

    // ── V1-M23 (R116, A4-04): wallet_topups.reviewed_by — reviewer ──
    // attribution on the operator-facing money queue. Idempotent
    // (ADD COLUMN IF NOT EXISTS). See applyTopupReviewedByStage docs.
    await applyTopupReviewedByStage();

    // ── V1-M24 (R120-B6, A6-F3/F4): list read-path indexes — the ──
    // notification-bell sort shape swap (probe-gated, V1-M17 idiom) +
    // the admin ticket-queue (status, updated_at DESC) twin + the R118
    // idx_admin_alerts_created boot twin that never shipped. Idempotent;
    // steady-state boots are no-ops. See applyListReadPathIndexesStage docs.
    await applyListReadPathIndexesStage();

    // ── V1-M25 (R122, A4-P1-2): rebuild the four money-history user ──
    // FKs (wallet_ledger / orders / wallet_topups / points_ledger) as
    // ON DELETE RESTRICT — the never-delete audit-trail policy, enforced
    // at the DB level. Probe-gated: orphan count → alert + skip; already
    // RESTRICT → zero DDL. See applyMoneyLedgerUserFkRestrictStage docs
    // for the V1-M9 interaction note.
    await applyMoneyLedgerUserFkRestrictStage();

    // ── V1-M26 (R122, A4-P2-5): chk_orders_amount_pos + the type-aware ──
    // chk_ledger_arithmetic — the two money CHECKs the R118-A3 F3 sweep
    // stopped short of. Probe-gated count-then-add (V1-M9 idiom).
    // See applyMoneyArithmeticChecksStage docs.
    await applyMoneyArithmeticChecksStage();

    // ── V1-M27 (R123-E5, R123-A7 P2): serving-index consolidation — the ──
    // three user-history composites (topups / referrals / tickets,
    // (x_id, created_at DESC)) + the sixteen redundant twins dropped,
    // probe-gated. See applyIndexConsolidationStage docs.
    await applyIndexConsolidationStage();

    // ── V1-M28 (R123-E5, R123-A7 P2): referral_events referrer/referee ──
    // FKs rebuilt as ON DELETE RESTRICT — a referee delete must not erase
    // the referrer's pending credit claim (the V1-M25 boundary extended to
    // money-adjacent attribution). Probe-gated per column.
    // See applyReferralFksRestrictStage docs.
    await applyReferralFksRestrictStage();

    // ── V1-M29 (R123-E5, R123-A7 P3): the domain CHECK batch — quantity ──
    // >= 1, price > 0, variant price/cost bounds, referral status, run
    // outcomes ×2, risk score/confidence ranges. Probe-gated count-then-add
    // (V1-M9 idiom). See applyDomainCheckConstraintsStage docs.
    await applyDomainCheckConstraintsStage();

    // ── V1-M30 (R123-E5, R123-A7 P2): organizations removal — the dead ──
    // table + users.organization_id + any FK on it, probe-gated (zero-DDL
    // steady state). See applyOrganizationsRemovalStage docs.
    await applyOrganizationsRemovalStage();

    // ── R104: persist the build fingerprint AFTER a successful full ──
    // reconcile so the next cold start can take the fast-path above.
    // r110 (109-e P2-1): gated by persistMigrationFingerprintAfterRun —
    // a run that skipped a constraint (probe → alert path) leaves the
    // stored marker untouched so the next boot re-runs the reconcile.
    await persistMigrationFingerprintAfterRun();
  } catch (err) {
    logger.error({ err }, "Startup migration failed");
    // P0-4: RE-THROW. boot-migrations.ts classifies the error and
    // server.ts aborts production startup on critical failures — the
    // old swallow starved that net and served traffic on a truncated
    // schema (mid-chain failure skipped every later table).
    throw err;
  }
}
