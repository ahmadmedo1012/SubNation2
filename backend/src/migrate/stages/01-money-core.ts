// R144-B2: moved verbatim from src/migrate.ts (original lines 259–1084).
// R144-B2: Only the import block + minimal `export` keywords are new;
// R144-B2: the ONE dynamic-import specifier that moved (`./jobs/alertLogger`
// R144-B2: → `../jobs/alertLogger`, in alertMoneyConstraintIssue) is disclosed
// R144-B2: and machine-verified moved-not-modified (scripts/r144b2_verify_split.py).
import { sql } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { alertMoneyConstraintIssue, recordConstraintSkip } from "../alerts";
import { type SqlExecutor, defaultExecutor, extractCount, extractRows } from "../shared";

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
  // R154 (P3-C): nullable Telegram @username — display-only, never a
  // linkage key (the telegram_id above stays authoritative).
  ["telegram_username", "VARCHAR(255)"],
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
