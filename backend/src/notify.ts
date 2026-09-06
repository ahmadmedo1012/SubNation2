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
    const [inserted] = await db
      .insert(notificationsTable)
      .values({ userId, type, title, message, link })
      .returning({ id: notificationsTable.id });

    // Round-4 (perf P1-4): push the new notification to the user's
    // socket room the moment it's inserted, so the NotificationBell
    // refreshes on event instead of waiting for its 60s poll. Fire-and-
    // forget inside the existing try (a socket failure must never fail
    // the originating request). The DYNAMIC import follows the same
    // pattern the admin order routes use (import("../lib/socket")): it
    // keeps socket.io — and the JWT module's import-time SESSION_SECRET
    // read — out of every module that imports notify.ts (tests, cron
    // watchers, services), avoiding both import cycles and test-env
    // env-var explosions.
    import("./lib/socket")
      .then(({ emitToUser }) => {
        emitToUser(userId, "notification-new", { id: inserted?.id, type });
      })
      .catch((err) =>
        logger.warn({ err, userId, type }, "createNotification: socket emit failed (non-fatal)"),
      );
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
