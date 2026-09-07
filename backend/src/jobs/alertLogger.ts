import { adminAlertsTable, db } from "@workspace/db";
import { and, count, desc, eq, gt, inArray, lt, notInArray, sql } from "drizzle-orm";
import { logger } from "../lib/logger";

export type AlertType =
  | "coupon_maxed"
  | "coupon_expiring"
  | "low_stock"
  | "no_stock"
  | "flash_sale_expired"
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

export async function logAdminAlert(
  type: AlertType,
  title: string,
  message: string,
  opts?: AlertDedupeOpts,
): Promise<void> {
  try {
    // Round-5 (db-audit 2026-09-07): DB-level dedupe. The in-memory Sets
    // in stockWatcher were the only guard before — they reset on every
    // process restart, and Render free tier restarts constantly, so the
    // same 6 out-of-stock products re-alerted on every cold start
    // (321 unread alerts, 244 of them no_stock, in 12 days). A keyed
    // lookup against the table itself survives restarts and scale-out.
    if (opts?.dedupeKey) {
      const windowMs = opts.dedupeWindowMs ?? 24 * 60 * 60 * 1000;
      const cutoff = new Date(Date.now() - windowMs);
      const existing = await db
        .select({ id: adminAlertsTable.id })
        .from(adminAlertsTable)
        .where(and(eq(adminAlertsTable.dedupeKey, opts.dedupeKey), gt(adminAlertsTable.createdAt, cutoff)))
        .limit(1);
      if (existing.length > 0) {
        logger.debug(
          { category: "alerts.dedupe", dedupeKey: opts.dedupeKey, existingId: existing[0].id },
          "logAdminAlert: duplicate suppressed",
        );
        return;
      }
    }

    const [inserted] = await db
      .insert(adminAlertsTable)
      .values({ type, title, message, dedupeKey: opts?.dedupeKey ?? null })
      .returning({ id: adminAlertsTable.id });

    // Round-4 (perf P1-5): fan the alert out to connected admins the
    // moment it's inserted so the alert drawer/badge + toast land at
    // alert time instead of up to 5 minutes later (the demoted poll
    // fallback). Fire-and-forget: a socket failure must never fail the
    // caller (cron watchers, checkout.service). Dynamic import — same
    // lazy-socket pattern the admin order routes use — keeps socket.io
    // and its import-time env reads out of the job/service test graph.
    import("../lib/socket")
      .then(({ emitToAdmins }) => {
        emitToAdmins("admin-alert-new", { id: inserted?.id, type, title, message });
      })
      .catch((err) =>
        logger.warn({ err, type, title }, "logAdminAlert: socket emit failed (non-fatal)"),
      );
  } catch (err) {
    logger.error({ err, type, title }, "Failed to log admin alert");
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
  const deleted = await db
    .delete(adminAlertsTable)
    .where(and(eq(adminAlertsTable.isRead, true), lt(adminAlertsTable.createdAt, cutoff)))
    .returning({ id: adminAlertsTable.id });
  return deleted.length;
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
