// R144-B2: moved verbatim from src/migrate.ts (original lines 1085–1821).
// R144-B2: Only the import block + minimal `export` keywords are new;
// R144-B2: the ONE dynamic-import specifier that moved (`./jobs/alertLogger`
// R144-B2: → `../jobs/alertLogger`, in alertMoneyConstraintIssue) is disclosed
// R144-B2: and machine-verified moved-not-modified (scripts/r144b2_verify_split.py).
import { sql } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { alertMoneyConstraintIssue, recordConstraintSkip } from "../alerts";
import { type SqlExecutor, defaultExecutor, extractCount, extractRows } from "../shared";

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
// never get the redundant twins. R142 (F-3) completed the sweep:
// the fifth body creator, missing-indexes' idx_users_referral_code
// (dropped from the chain by 0012 and from the schema by the same r103
// edit, but left creating + re-dropping on every full reconcile), is
// now removed too. The four creators inside FROZEN
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
