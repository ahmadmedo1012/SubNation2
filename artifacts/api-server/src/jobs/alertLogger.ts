import { db, adminAlertsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { logger } from "../lib/logger";

export type AlertType =
  | "coupon_maxed"
  | "coupon_expiring"
  | "low_stock"
  | "no_stock"
  | "system";

export async function logAdminAlert(
  type: AlertType,
  title: string,
  message: string,
): Promise<void> {
  try {
    await db.insert(adminAlertsTable).values({ type, title, message });
  } catch (err) {
    logger.error({ err, type, title }, "Failed to log admin alert");
  }
}

export async function getAdminAlerts(limit = 100) {
  return db
    .select()
    .from(adminAlertsTable)
    .orderBy(desc(adminAlertsTable.createdAt))
    .limit(limit);
}

export async function markAlertRead(id: number) {
  await db
    .update(adminAlertsTable)
    .set({ isRead: true })
    .where(eq(adminAlertsTable.id, id));
}

export async function markAllAlertsRead() {
  await db.update(adminAlertsTable).set({ isRead: true });
}

export async function countUnreadAlerts(): Promise<number> {
  const rows = await db
    .select({ id: adminAlertsTable.id })
    .from(adminAlertsTable)
    .where(eq(adminAlertsTable.isRead, false));
  return rows.length;
}
