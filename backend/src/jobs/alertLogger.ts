import { adminAlertsTable, db } from "@workspace/db";
import { and, count, desc, eq, gt, inArray, lt, notInArray, sql } from "drizzle-orm";
import { logger } from "../lib/logger";

/**
 * Closed TS union over `admin_alerts.type` (a free varchar(30) column —
 * unknown strings still insert; the alerts drawer falls back to the
 * "system" badge for types it has no metadata for).
 *
 * Round-93 additions (jobs audit 93-A6):
 *  - `forecast_stockout` — A6-P2-3: forecast alerts now route through
 *    logAdminAlert instead of a raw table insert.
 *  - `coupon_expired` — A6-P3 (§3): couponWatcher's auto-disable step.
 *  - `refunded_live_credentials` — emitted by refund.service since B2-03
 *    via an `as unknown as AlertType` cast; declared here so the union
 *    matches what actually flows through the column.
 */
export type AlertType =
  | "coupon_expired"
  | "inventory_corrupt"
  | "coupon_maxed"
  | "coupon_expiring"
  | "flash_sale_expired"
  | "forecast_stockout"
  | "low_stock"
  | "no_stock"
  | "refunded_live_credentials"
  | "system";

export interface AlertDedupeOpts {
  /**
   * Stable identity of the repeating condition (e.g. `stock:zero:18`).
   * While an alert with this key exists inside the dedupe window, new
   * inserts are skipped — the drawer must show a state, not a history.
   */
  dedupeKey: string;
  /** How long a previous insert suppresses re-inserts. Default 24h. */
  dedupeWindowMs?: number;
}

/**
 * Suppression state of a logAdminAlert call (A6-P2-1, round-93).
 *
 * Callers that fan an alert out to side channels (Telegram, the
 * alerting service) MUST gate those sends on `suppressed` — the DB
 * dedupe is the only guard that survives process restarts, and before
 * this contract existed stockWatcher sent its Telegram notification
 * BEFORE consulting the dedupe, so every Render deploy re-pinged the
 * operator's phone for each permanently-out-of-stock product even
 * while the drawer insert was correctly suppressed.
 */
export interface AdminAlertOutcome {
  /** True when a recent same-key alert suppressed the insert. */
  suppressed: boolean;
  /** Inserted row id (or the pre-existing row's id on suppression). */
  id: number | null;
}

// ── F9 (round-94 A6): DB-failure side-channel throttle ─────────────────────
//
// logAdminAlert's catch deliberately does NOT suppress side channels —
// the underlying condition (zero stock, an expiring coupon) is real
// regardless of whether the row landed. But with stockWatcher's 30-min
// cadence, an EXTENDED DB outage turned that into ~48 Telegram messages
// per out-of-stock product per day — the operator's phone is the last
// thing that needs spamming while the alert drawer itself is down.
//
// The insert keeps retrying every cycle; only the side-channel green
// light is throttled: one per identity per hour (env-tunable for tests).
// In-memory by design — restart resets it, which is fine (a restart is
// a fresh operator-visible event anyway) and the DB dedupe resumes the
// moment the database recovers.
const DB_FAILURE_NOTIFY_THROTTLE_KEYS_MAX = 500;
const dbFailureNotifiedAt = new Map<string, number>();

/** Throttle window (ms) for side-channel green lights during DB failures. */
function dbFailureThrottleWindowMs(): number {
  const raw = Number(process.env.ALERT_DB_FAILURE_THROTTLE_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 60 * 60 * 1000;
}

/** Test-only: clear the DB-failure throttle map between scenarios. */
export function __resetAlertDbFailureThrottleForTests(): void {
  dbFailureNotifiedAt.clear();
}

/** True when this identity may light the side channels despite the DB failure. */
function shouldNotifyOnDbFailure(identity: string): boolean {
  const now = Date.now();
  const last = dbFailureNotifiedAt.get(identity);
  if (last !== undefined && now - last < dbFailureThrottleWindowMs()) return false;
  // Memory hygiene (same cap pattern as couponWatcher's alertedExpiring):
  // identities are bounded by the catalog size in practice; the clear is
  // a coarse backstop, not precise eviction.
  if (dbFailureNotifiedAt.size >= DB_FAILURE_NOTIFY_THROTTLE_KEYS_MAX) {
    dbFailureNotifiedAt.clear();
  }
  dbFailureNotifiedAt.set(identity, now);
  return true;
}

export async function logAdminAlert(
  type: AlertType,
  title: string,
  message: string,
  opts?: AlertDedupeOpts,
): Promise<AdminAlertOutcome> {
  try {
    // Round-5 (db-audit 2026-09-07): DB-level dedupe. The in-memory Sets
    // in stockWatcher were the only guard before — they reset on every
    // process restart, and Render free tier restarts constantly, so the
    // same 6 out-of-stock products re-alerted on every cold start
    // (321 unread alerts, 244 of them no_stock, in 12 days). A keyed
    // lookup against the table itself survives restarts and scale-out.
    //
    // 99-R3 (R99-A1 P3): the lookup used to be a bare SELECT-then-INSERT
    // — two concurrent same-key writers (the documented dual-leader drain
    // window, or an unguarded worker) both passed the check and inserted
    // twin rows the non-unique index cannot merge. The advisory-xact-lock
    // pattern from TopupService serializes same-key writers; the tx also
    // makes the check+insert atomic for every caller.
    let insertedId: number | null = null;
    if (opts?.dedupeKey) {
      const windowMs = opts.dedupeWindowMs ?? 24 * 60 * 60 * 1000;
      const cutoff = new Date(Date.now() - windowMs);
      const outcome = await db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${opts.dedupeKey}, 0))`,
        );
        const existing = await tx
          .select({ id: adminAlertsTable.id })
          .from(adminAlertsTable)
          .where(
            and(
              eq(adminAlertsTable.dedupeKey, opts.dedupeKey),
              gt(adminAlertsTable.createdAt, cutoff),
            ),
          )
          .limit(1);
        if (existing.length > 0) {
          return { suppressed: true as const, id: existing[0].id };
        }
        const [row] = await tx
          .insert(adminAlertsTable)
          .values({ type, title, message, dedupeKey: opts.dedupeKey })
          .returning({ id: adminAlertsTable.id });
        return { suppressed: false as const, id: row?.id ?? null };
      });
      if (outcome.suppressed) {
        logger.debug(
          { category: "alerts.dedupe", dedupeKey: opts.dedupeKey, existingId: outcome.id },
          "logAdminAlert: duplicate suppressed",
        );
        return { suppressed: true, id: outcome.id };
      }
      insertedId = outcome.id;
    } else {
      const [row] = await db
        .insert(adminAlertsTable)
        .values({ type, title, message, dedupeKey: null })
        .returning({ id: adminAlertsTable.id });
      insertedId = row?.id ?? null;
    }

    // Round-4 (perf P1-5): fan the alert out to connected admins the
    // moment it's inserted so the alert drawer/badge + toast land at
    // alert time instead of up to 5 minutes later (the demoted poll
    // fallback). Fire-and-forget: a socket failure must never fail the
    // caller (cron watchers, checkout.service). Dynamic import — same
    // lazy-socket pattern the admin order routes use — keeps socket.io
    // and its import-time env reads out of the job/service test graph.
    import("../lib/socket")
      .then(({ emitToAdmins }) => {
        emitToAdmins("admin-alert-new", { id: insertedId, type, title, message });
      })
      .catch((err) =>
        logger.warn({ err, type, title }, "logAdminAlert: socket emit failed (non-fatal)"),
      );

    // A6-P2-1: on success the alert is fresh — side channels may fire.
    return { suppressed: false, id: insertedId };
  } catch (err) {
    logger.error({ err, type, title }, "Failed to log admin alert");
    // Deliberately NOT suppressed on the FIRST failure: a DB failure must
    // not also silence the side channels — the underlying condition (zero
    // stock, an expiring coupon) is real regardless of whether the row
    // landed. F9 (round-94 A6): but an EXTENDED outage must not become a
    // phone-spam channel either — the green light repeats at most once per
    // hour per identity while the insert keeps retrying every cycle.
    const throttleIdentity = opts?.dedupeKey ?? `${type}:${title}`;
    if (!shouldNotifyOnDbFailure(throttleIdentity)) {
      return { suppressed: true, id: null };
    }
    return { suppressed: false, id: null };
  }
}

export async function getAdminAlerts(limit = 100, offset = 0) {
  return db
    .select()
    .from(adminAlertsTable)
    .orderBy(desc(adminAlertsTable.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function countAllAlerts(): Promise<number> {
  const [row] = await db.select({ count: count() }).from(adminAlertsTable);
  return Number(row?.count ?? 0);
}

export async function markAlertRead(id: number) {
  await db.update(adminAlertsTable).set({ isRead: true }).where(eq(adminAlertsTable.id, id));
}

export async function markAllAlertsRead() {
  await db.update(adminAlertsTable).set({ isRead: true });
}

export async function countUnreadAlerts(): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(adminAlertsTable)
    .where(eq(adminAlertsTable.isRead, false));
  return Number(row?.count ?? 0);
}

/**
 * A6 P3#14 (round-93): resolve-by-key — auto-mark every UNREAD alert
 * carrying `dedupeKey` as read. The counterpart to logAdminAlert's
 * dedupe: when the *condition* an advisory asserts goes away (e.g. the
 * last powerful admin enables TOTP), the drawer must stop asserting a
 * gap that no longer exists instead of waiting up to 14 days for the
 * stale-marking retention sweep. Idempotent; returns the resolved count.
 */
export async function resolveAlertsByDedupeKey(dedupeKey: string): Promise<number> {
  const resolved = await db
    .update(adminAlertsTable)
    .set({ isRead: true })
    .where(and(eq(adminAlertsTable.dedupeKey, dedupeKey), eq(adminAlertsTable.isRead, false)))
    .returning({ id: adminAlertsTable.id });
  return resolved.length;
}

export async function deleteReadAlerts(): Promise<number> {
  // .returning() (not result.rowCount) — pglite's driver result doesn't
  // carry rowCount, and the test harness runs on pglite.
  const deleted = await db
    .delete(adminAlertsTable)
    .where(eq(adminAlertsTable.isRead, true))
    .returning({ id: adminAlertsTable.id });
  return deleted.length;
}

export async function deleteAllAlerts(): Promise<void> {
  await db.delete(adminAlertsTable);
}

// ── Round-5 (db-audit 2026-09-07): retention + one-time consolidation ────
//
// Two policies, both running in the daily 00:00 cron slot:
//
//   1. markStaleUnreadAlertsRead(14): unread older than 14 days is
//      operationally dead — nobody acted on it for two weeks; keeping
//      the unread badge pinned destroys its signal value. Auto-read
//      (not delete) keeps the row inspectable.
//   2. pruneReadAlerts(30): read rows older than 30 days are deleted.
//      admin_alerts is an operations surface, not an audit ledger —
//      audit_logs is the immutable trail; this table just needs to
//      stay small enough that the drawer renders instantly.

export async function markStaleUnreadAlertsRead(olderThanDays = 14): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const updated = await db
    .update(adminAlertsTable)
    .set({ isRead: true })
    .where(and(eq(adminAlertsTable.isRead, false), lt(adminAlertsTable.createdAt, cutoff)))
    .returning({ id: adminAlertsTable.id });
  return updated.length;
}

export async function pruneReadAlerts(olderThanDays = 30): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  // B7-P2-5 (round-92): bounded ctid batches instead of one unbounded
  // DELETE — keeps lock footprint per statement tiny on Neon's pooler.
  // .returning() rows (not result.rowCount) — pglite's driver result
  // doesn't carry rowCount, and the test harness runs on pglite.
  const BATCH = 1000;
  let deleted = 0;
  for (;;) {
    const result = await db.execute(sql`
      DELETE FROM admin_alerts
      WHERE ctid IN (
        SELECT ctid FROM admin_alerts
        WHERE is_read = true AND created_at < ${cutoff}
        LIMIT ${BATCH}
      )
      RETURNING id
    `);
    const rows =
      (result as unknown as { rows?: Array<{ id: number }> }).rows ??
      (result as unknown as Array<{ id: number }>) ??
      [];
    deleted += rows.length;
    if (rows.length < BATCH) break;
  }
  return deleted;
}

/**
 * One-time (idempotent) cleanup of the alert spam already sitting in
 * production: for the watcher-driven types (no_stock / low_stock), keep
 * only the newest row per (type, title) — the title embeds the product
 * name, so this collapses 244 no_stock rows for 6 products down to 6.
 * Runs from the boot migration (migrate.ts V1-M8) so it executes
 * exactly once per environment on the next deploy, then no-ops.
 */
export async function consolidateStockAlertSpam(): Promise<number> {
  // Newest id per (type, title) among the spam-prone types.
  const keepRows = await db
    .select({ keepId: sql<number>`max(${adminAlertsTable.id})`.as("keep_id") })
    .from(adminAlertsTable)
    .where(inArray(adminAlertsTable.type, ["no_stock", "low_stock"]))
    .groupBy(adminAlertsTable.type, adminAlertsTable.title);
  const keepIds = keepRows.map((r) => Number(r.keepId)).filter((n) => Number.isFinite(n));
  if (keepIds.length === 0) return 0;

  const result = await db
    .delete(adminAlertsTable)
    .where(
      and(
        inArray(adminAlertsTable.type, ["no_stock", "low_stock"]),
        // SQL NULL-safe: rows that are not in keepIds get deleted.
        notInArray(adminAlertsTable.id, keepIds),
      ),
    )
    .returning({ id: adminAlertsTable.id });
  return result.length;
}
