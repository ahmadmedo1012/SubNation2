import { db, notificationsTable } from "@workspace/db";
import { logger } from "./lib/logger";
import { captureSubsystemException } from "./lib/sentry";

type NotifType = "wallet" | "order" | "system" | "support" | "loyalty";

/**
 * Insert a row in `notifications` for a user. Non-critical — failures
 * here MUST NOT crash the originating request (wallet credit, order
 * placement, ticket reply, etc) because the notification is a UX
 * convenience, not a transactional invariant.
 *
 * Failure surface: logged at warn level + captured to Sentry under
 * `subsystem=notifications`. Operators can grep `category: "notifications"`
 * in pino logs to spot persistent breakage that the previous bare
 * `catch {}` was hiding.
 */
export async function createNotification(
  userId: number,
  type: NotifType,
  title: string,
  message?: string,
  link?: string,
) {
  try {
    await db.insert(notificationsTable).values({ userId, type, title, message, link });
  } catch (err) {
    logger.warn(
      {
        category: "notifications",
        err: err instanceof Error ? err.message : String(err),
        userId,
        type,
      },
      "createNotification: insert failed (non-fatal — request continues)",
    );
    captureSubsystemException("notifications", err, { userId, type, title });
  }
}
