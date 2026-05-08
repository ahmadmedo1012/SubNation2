import { db, notificationsTable } from "@workspace/db";

type NotifType = "wallet" | "order" | "system" | "support" | "loyalty";

export async function createNotification(
  userId: number,
  type: NotifType,
  title: string,
  message?: string,
  link?: string,
) {
  try {
    await db.insert(notificationsTable).values({ userId, type, title, message, link });
  } catch {}
}
