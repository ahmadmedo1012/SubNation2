import { adminAlertsTable, db } from "@workspace/db";
import { count, desc, eq } from "drizzle-orm";
import { logger } from "../lib/logger";

export type AlertType =
  | "coupon_maxed"
  | "coupon_expiring"
  | "low_stock"
  | "no_stock"
  | "flash_sale_expired"
  | "system";

export async function logAdminAlert(
  type: AlertType,
  title: string,
  message: string,
): Promise<void> {
  try {
    const [inserted] = await db
      .insert(adminAlertsTable)
      .values({ type, title, message })
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
  const result = await db.delete(adminAlertsTable).where(eq(adminAlertsTable.isRead, true));
  return (result as any).rowCount ?? 0;
}

export async function deleteAllAlerts(): Promise<void> {
  await db.delete(adminAlertsTable);
}
