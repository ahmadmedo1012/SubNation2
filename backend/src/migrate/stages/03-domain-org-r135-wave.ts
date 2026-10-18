// R144-B2: moved verbatim from src/migrate.ts (original lines 1822–2452).
// R144-B2: Only the import block + minimal `export` keywords are new;
// R144-B2: the ONE dynamic-import specifier that moved (`./jobs/alertLogger`
// R144-B2: → `../jobs/alertLogger`, in alertMoneyConstraintIssue) is disclosed
// R144-B2: and machine-verified moved-not-modified (scripts/r144b2_verify_split.py).
import { sql } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { alertMoneyConstraintIssue } from "../alerts";
import { type SqlExecutor, defaultExecutor, extractCount, extractRows } from "../shared";

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

// ── V1-M31 (R127-L3, B7 P2-1 + B8 §2 G1–G7): retention/prune indexes ─────────
//
// The R127 auditors independently flagged the same gap class: the
// retention/prune predicates below ran as UNINDEXED seq scans (each
// ctid batch of ≤1000 rows = one full scan), so any catch-up purge
// degrades to repeated full-table scans — the incident amplifier B7
// worked through on login_attempts (an attacker-grown table: one
// upsert per phone:ip / username:ip pair; IP-rotating stuffing at 10k
// distinct pairs/hour for a week leaves ~1.7M rows → the next prune
// pays ~1,700 consecutive full scans precisely while the DB is under
// attack, keeping the 0.25 CU Neon compute permanently awake).
//
// The merged, deduplicated bundle (names per the house fleet
// convention; see the drizzle 0020 header for the B7/B8 name-variant
// merge note):
//
//   idx_sessions_expires_at          session-prune `expires_at < now()`
//                                    (session-prune.ts, 05:00 + boot)
//   idx_admin_sessions_expires_at    pruneStaleAdminSessions — expired arm
//                                    (admin-session.ts:191-192)
//   idx_admin_sessions_revoked_at    …the revoked arm, PARTIAL on the
//                                    IS NOT NULL minority slice (caps the
//                                    per-insert write cost — B7 directive 2)
//   idx_admin_alerts_unread          countUnreadAlerts + markStaleUnread-
//                                    AlertsRead + the /new drawer (B8 G2 —
//                                    the only REQUEST-path predicate of the
//                                    set, polled by the unread badge),
//                                    PARTIAL WHERE is_read = false
//   idx_idempotency_keys_created     idempotency-retention 48h prune
//                                    (idempotency-retention.ts:53)
//   idx_login_attempts_last_attempt  auth-audit-retention 7d prune
//                                    (auth-audit-retention.ts:51) — THE
//                                    important one (attack-grown table)
//   idx_notifications_created        notifications-retention 90d/180d —
//                                    idx_notifications_user leads with
//                                    user_id, which the sweep never
//                                    filters on (notifications-
//                                    retention.ts:42-43)
//   idx_forecasts_forecast_date      forecast-retention 90d prune
//                                    (forecast-retention.ts; WORKER_TIER-
//                                    gated + dormant — declared so the
//                                    runner family is index-served the
//                                    day it is armed)
//
// whatsapp_otps is deliberately absent: B7 directive 6's predicate
// switch (created_at → the already-indexed expires_at, keeping the
// 24h-created-at deletion semantics a superset via a 23h expires_at
// cutoff) shipped in services/whatsapp-otp.service.ts this round — a
// created_at twin (B8 G6) would be a second write-amplifying index on
// a hot-INSERT table with zero remaining readers.
//
// R128 (B3-F3) — coverage honesty: the bundle indexes the admin_alerts
// family's UNREAD arm only (idx_admin_alerts_unread, WHERE is_read =
// false). The READ-side prune predicates — pruneReadAlerts
// (`is_read = true AND created_at < cutoff`, the daily 00:00 cron) and
// deleteReadAlerts (`is_read = true`, the admin "clear read" action),
// both jobs/alertLogger.ts — run UNINDEXED seq scans. Immaterial today
// (the daily prunes keep admin_alerts ~10² rows; B4's live snapshot:
// 77), but the ~10⁵-row CONCURRENTLY trigger above must ALSO weigh a
// partial WHERE is_read = true twin for admin_alerts when that review
// happens — do not assume the family is fully covered because one arm
// is.
//
// Stage shape: the V1-M24 additive-twin form — unconditional
// CREATE INDEX IF NOT EXISTS covers fresh installs AND the steady
// state (already-migrated boots no-op). No probe gate needed: there is
// no legacy shape to swap or drop, only additive objects.
//
// NOT CONCURRENTLY (B8 F3 decision, on the record): plain CREATE INDEX
// takes a SHARE lock blocking writes for the build duration — a
// non-event at current rowcounts (B8 live snapshot: 148 rows combined
// across the eight target tables; every build sub-millisecond). The
// documented trigger: the day any affected table crosses ~10⁵ rows,
// its build here moves to CREATE INDEX CONCURRENTLY (db.execute is
// auto-commit, not tx-wrapped, so it CAN) and the drizzle 0020 twin is
// reworked to match.
//
// Drizzle mirror: shared/db/src/schema/*.ts declarations (this round)
// + chain 0020.
export async function applyRetentionPruneIndexesStage(
  execute: SqlExecutor = defaultExecutor,
): Promise<void> {
  await execute(sql`
    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at
      ON sessions (expires_at);
  `);
  await execute(sql`
    CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at
      ON admin_sessions (expires_at);
  `);
  await execute(sql`
    CREATE INDEX IF NOT EXISTS idx_admin_sessions_revoked_at
      ON admin_sessions (revoked_at) WHERE revoked_at IS NOT NULL;
  `);
  await execute(sql`
    CREATE INDEX IF NOT EXISTS idx_admin_alerts_unread
      ON admin_alerts (created_at DESC) WHERE is_read = false;
  `);
  await execute(sql`
    CREATE INDEX IF NOT EXISTS idx_idempotency_keys_created
      ON idempotency_keys (created_at);
  `);
  await execute(sql`
    CREATE INDEX IF NOT EXISTS idx_login_attempts_last_attempt
      ON login_attempts (last_attempt);
  `);
  await execute(sql`
    CREATE INDEX IF NOT EXISTS idx_notifications_created
      ON notifications (created_at);
  `);
  await execute(sql`
    CREATE INDEX IF NOT EXISTS idx_forecasts_forecast_date
      ON inventory_forecasts (forecast_date);
  `);
  logger.info({ category: "storage" }, "V1-M31: retention/prune index bundle (idempotent)");
}

// ── V1-M32 (R134, A7-F4): idempotency_keys.body_hash ────────────────────────
//
// The durable idempotency layer stored NO body fingerprint, so the R122
// Redis-layer body-hash defense (409 on same-key-DIFFERENT-body) never
// fired in production — production runs without Redis (documented in
// middlewares/idempotency.ts; the middleware passes through), and a
// client reusing one Idempotency-Key with a DIFFERENT body inside the
// 48h retention got the ORIGINAL result replayed (200 +
// Idempotent-Replayed) instead of the designed 409. Money-safe (no
// second charge — scoping + ownership re-checks hold; M5/M6 suites
// prove it), but the client's record diverged from the platform's.
//
// This stage adds the column the durable predicate reads: sha256-hex
// of the request body's canonical JSON (lib/idempotency-body-hash.ts —
// the SAME definition the Redis layer hashes with; hashed at the ROUTE
// layer off req.body so there is exactly one equivalence relation).
//
// Shape: the V1-M19 catalog-probe idiom — probe
// information_schema.columns; ALTER only when absent. Nullable, no
// default, no backfill: NULL = a legacy claim written pre-R134 →
// replay on key-match (today's behavior); the NULL population ages out
// with the 48h retention prune (jobs/idempotency-retention.ts) — the
// transition window is ≤48h by construction. IF NOT EXISTS stays on
// the ALTER as the belt against catalog drift between probe and DDL
// (the V1-M19/M23 house idiom). Steady-state boots issue zero DDL.
//
// Drizzle mirror: shared/db/src/schema/idempotency-keys.ts bodyHash +
// chain 0021.
export async function applyIdempotencyBodyHashStage(
  execute: SqlExecutor = defaultExecutor,
): Promise<void> {
  const probeRows = extractRows(
    await execute(sql`
      SELECT column_name AS column_name
      FROM information_schema.columns
      WHERE table_name = 'idempotency_keys'
    `),
  );
  const present = new Set(probeRows.map((row) => String(row.column_name)));
  if (!present.has("body_hash")) {
    // Belt-on-probe (V1-M19 idiom): every statement idempotent even if
    // the catalog drifted between the probe and the ALTER.
    await execute(
      sql.raw(`ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS body_hash VARCHAR(64)`),
    );
    logger.info(
      { category: "storage" },
      "V1-M32: added idempotency_keys.body_hash (durable reuse predicate, A7-F4)",
    );
  }
}

// ── V1-M33 (R134, A8-F2): drop the zero-consumer wallet_ledger.type ───────
// index — pure write amplification on the money INSERT table.
//
// R130's consumer analysis (grep = 0 — no query touches
// wallet_ledger.type as a predicate; wallet.ts:209 reads e.type as a
// display label only) re-verified at R134: still zero consumers.
// idx_wallet_ledger_type taxed EVERY money ledger INSERT (topups,
// refunds, adjustments, loyalty, checkout) for an index nothing ever
// read. The drizzle declaration (schema/wallet_ledger.ts typeIdx) is
// deleted in the same round — chain 0022 folds the DROP INDEX.
//
// Shape: the V1-M27 probe-gated DROP idiom — pg_indexes probe, drop
// only if genuinely present (steady-state boots send no DDL at all).
export async function applyWalletLedgerTypeIndexDropStage(
  execute: SqlExecutor = defaultExecutor,
): Promise<void> {
  const presentRows = extractRows(
    await execute(sql`
      SELECT indexname AS indexname FROM pg_indexes
      WHERE schemaname = current_schema()
        AND indexname = 'idx_wallet_ledger_type'
    `),
  );
  const present = new Set(presentRows.map((row) => String(row.indexname)));
  if (present.has("idx_wallet_ledger_type")) {
    await execute(sql.raw(`DROP INDEX IF EXISTS idx_wallet_ledger_type`));
    logger.info(
      { category: "storage" },
      "V1-M33: dropped zero-consumer idx_wallet_ledger_type (A8-F2)",
    );
  }
}

// ── V1-M34 (R135, DB-1): the R135 serving-index wave ────────────────────────
//
// Three read-path index gaps, one additive + two same-name shape swaps:
//
//   (a)  idx_coupons_expires_at  — PARTIAL on expires_at IS NOT NULL. The
//        couponWatcher sweep (jobs/couponWatcher.ts checkExpiringCoupons)
//        runs BOTH arms unindexed: the auto-disable UPDATE filters
//        is_active AND expires_at IS NOT NULL AND expires_at < now(), the
//        24h-warning SELECT the same IS NOT NULL arm with
//        expires_at BETWEEN now() AND now()+24h. Every sweep was a seq
//        scan over the whole coupons table — cheap at ~10² rows, but the
//        sweep is OPPORTUNISTIC (fires on the checkout apply-coupon
//        moment + the admin coupons list), so the scan rode the exact
//        money moments that matter. The partial predicate caps the
//        per-INSERT write cost the same way idx_admin_sessions_revoked_at
//        (V1-M31) does: coupons with no expiry (the majority) never touch
//        the index. Additive — the V1-M31 unconditional
//        CREATE INDEX IF NOT EXISTS form (fresh installs AND steady state
//        covered by one guarded statement; zero DDL once present).
//
//   (b)  idx_wallet_ledger_user_created swapped same-name
//        (user_id, created_at) → (user_id, created_at DESC, id DESC) —
//        the FULL keyset-serving shape for the wallet statement's
//        ORDER BY created_at DESC, id DESC (routes/wallet.ts:207 — the
//        id tiebreaker is what makes same-second ledger rows paginate
//        deterministically). The risk_events precedent
//        (idx_risk_events_created_id_desc, round-4 block below) is the
//        house shape for exactly this ORDER BY family. The old
//        (user_id, created_at) twin served the filter + a residual
//        top-N sort on every statement page.
//
//   (c)  idx_orders_user_created — same swap for the user orders list
//        (routes/orders.ts:138, WHERE user_id ORDER BY created_at DESC):
//        the (created_at DESC, id DESC) tail keeps the index keyset-ready
//        the day that list adopts cursor pagination (the risk_events
//        migration path), and drops the residual sort today.
//
// Shape discipline: the two swaps are the V1-M24 same-name idiom —
// catalog probe of the live indexdef, DROP+CREATE only when the
// genuinely legacy (user_id, created_at) shape is present, zero DDL on
// every steady-state boot (a naive unconditional DROP+CREATE would
// rebuild both indexes on EVERY cold start — the exact regression class
// the V1-M24 test pins). The base round-4 block above creates the NEW
// shapes directly, so fresh installs never see the legacy twin. NOT
// CONCURRENTLY (the V1-M31 decision class: sub-millisecond builds at
// current rowcounts; revisit at ~10⁵ rows).
//
// Drizzle mirror: shared/db/src/schema/{coupons,wallet_ledger,orders}.ts
// declarations (raw sql`col DESC` expression columns per the R134-A8-F1
// convention — plain DESC, NOT .desc()'s DESC NULLS LAST) + chain 0023.
export async function applyR135IndexWaveStage(
  execute: SqlExecutor = defaultExecutor,
): Promise<void> {
  // (a) Additive twin (V1-M31 form) — one guarded statement covers both
  // the fresh install and the steady state. One statement per execute:
  // pglite's extended-protocol parser rejects multi-statement batches
  // (42601), and stage tests run against the pglite harness.
  await execute(sql`
    CREATE INDEX IF NOT EXISTS idx_coupons_expires_at
      ON coupons (expires_at) WHERE expires_at IS NOT NULL;
  `);

  // (b) + (c) Same-name swaps (V1-M24 form): probe the live indexdef;
  // only a genuinely legacy (user_id, created_at) shape pays the
  // DROP+CREATE. The probe marker "(user_id, created_at)" — with the
  // closing paren — cannot match the new shape's
  // "(user_id, created_at DESC, id DESC)" rendering, and an absent
  // index (fresh install: the base block already created the new shape)
  // probes as "" → no DDL.
  const swaps: Array<{ name: string; table: string }> = [
    { name: "idx_wallet_ledger_user_created", table: "wallet_ledger" },
    { name: "idx_orders_user_created", table: "orders" },
  ];
  for (const { name, table } of swaps) {
    const idxRows = extractRows(
      await execute(sql`
        SELECT indexdef AS indexdef FROM pg_indexes
        WHERE schemaname = current_schema()
          AND tablename = ${table}
          AND indexname = ${name}
      `),
    );
    const indexdef = String(idxRows[0]?.["indexdef"] ?? "");
    if (indexdef.includes("(user_id, created_at)")) {
      await execute(sql.raw(`DROP INDEX IF EXISTS ${name}`));
      await execute(
        sql.raw(
          `CREATE INDEX IF NOT EXISTS ${name} ON ${table} (user_id, created_at DESC, id DESC)`,
        ),
      );
      logger.info(
        { category: "storage", index: name, table },
        "V1-M34: swapped to (user_id, created_at DESC, id DESC), the keyset tail (R135)",
      );
    }
  }
  logger.info({ category: "storage" }, "V1-M34: R135 serving-index wave (idempotent)");
}

// ── V1-M35 (R165, the R162 ADR): orders.order_group_id ──────────────────────
//
// The multi-order money lane (R165, implementing the R162 ADR
// docs/engineering/R162/adr-order-batch.md §3): an *order group* is the set
// of order rows created by ONE logical checkout attempt — the client mints
// one UUID per confirm intent and reuses it across every unit-order of
// that attempt (including partial-failure retries); the server records it
// verbatim and never mints, validates beyond the length cap, or
// interprets it. INFORMATIONAL ONLY: it never participates in money math,
// idempotency claims, refunds, or inventory (ADR §2).
//
// Shape: the V1-M32 catalog-probe idiom — probe
// information_schema.columns; ALTER only when absent. Nullable, no
// default, NO backfill: NULL = a pre-feature singleton/legacy order
// (backfill could only guess — created_at proximity would fabricate
// groups, ADR §7). IF NOT EXISTS stays on the ALTER as the belt against
// catalog drift between probe and DDL (the V1-M19/M32 house idiom).
// Steady-state boots issue zero DDL.
//
// Index: idx_orders_user_group — PARTIAL on (user_id, order_group_id)
// WHERE order_group_id IS NOT NULL (the V1-M31 partial idiom, same shape
// as idx_coupons_expires_at in V1-M34): composite because every consumer
// query is ownership-scoped (user_id + group), the group ids are random
// UUIDs so the second column is highly selective, and historical NULL
// rows stay out of the index entirely (zero write amplification for the
// legacy majority). Additive CREATE INDEX IF NOT EXISTS — one guarded
// statement covers the fresh install and the steady state.
//
// Drizzle mirror: shared/db/src/schema/orders.ts orderGroupId + chain 0026.
export async function applyOrdersGroupColumnStage(
  execute: SqlExecutor = defaultExecutor,
): Promise<void> {
  const probeRows = extractRows(
    await execute(sql`
      SELECT column_name AS column_name
      FROM information_schema.columns
      WHERE table_name = 'orders'
    `),
  );
  const present = new Set(probeRows.map((row) => String(row.column_name)));
  if (!present.has("order_group_id")) {
    // Belt-on-probe (V1-M19/M32 idiom): every statement idempotent even
    // if the catalog drifted between the probe and the DDL.
    await execute(
      sql.raw(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_group_id VARCHAR(36)`),
    );
    logger.info(
      { category: "storage" },
      "V1-M35: added orders.order_group_id (client-minted checkout-attempt token, R165)",
    );
  }
  // One statement per execute: pglite's extended-protocol parser rejects
  // multi-statement batches (42601), and stage tests run against pglite.
  await execute(sql`
    CREATE INDEX IF NOT EXISTS idx_orders_user_group
      ON orders (user_id, order_group_id) WHERE order_group_id IS NOT NULL;
  `);
}
