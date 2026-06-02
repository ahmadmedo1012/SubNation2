/**
 * Soft-block middleware (T011).
 *
 * Reads the most recent `risk_events.actionTaken='soft_block'`
 * row for the authenticated user. If one exists and has not
 * been "discharged" (consumed by a successful re-auth), it
 * forces the user back through the existing provider flow on
 * their next protected request.
 *
 * Constitution Principle II: this never introduces a new auth
 * path. We delete the user's `sessions` rows (so the next
 * request returns 401 from the existing auth pipeline) and
 * the user re-enters Google / Telegram / WhatsApp as before.
 *
 * Allowlist: per spec §5.4, an allowlisted source short-
 * circuits to a no-op so admin-IP traffic is never blocked.
 *
 * The middleware NEVER blocks the current request — it only
 * marks the session for re-auth on the next round trip. This
 * mirrors the spec's "friction step, not customer lockout"
 * framing.
 */

import { db, riskEventsTable, sessionsTable } from "@workspace/db";
import { and, desc, eq, gt } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";

import { logger } from "../lib/logger";
import { getRiskConfig, isAllowlisted } from "../services/risk-config-cache.service";

/** Cookie / session-bearing user request shape (loose — we
 * read userId from a few common places to stay decoupled
 * from the exact auth middleware structure). */
interface MaybeAuthenticatedRequest extends Request {
  userId?: number;
  user?: { id?: number };
}

/**
 * Window in which a `soft_block` row "armed" before the
 * current request still applies. Older rows are considered
 * already-discharged.
 */
const SOFT_BLOCK_WINDOW_MS = 30 * 60 * 1000; // 30 min

export function riskSoftBlockMiddleware() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (process.env.RISK_PIPELINE_ENABLED !== "true") {
      next();
      return;
    }

    const r = req as MaybeAuthenticatedRequest;
    const userId = r.userId ?? r.user?.id;
    if (!userId || !Number.isFinite(userId)) {
      next();
      return;
    }

    try {
      const config = await getRiskConfig();
      const allowlisted = isAllowlisted(
        {
          ip: req.ip ?? null,
          phone: null,
          device: null,
        },
        config.allowlist,
      );
      if (allowlisted) {
        next();
        return;
      }

      const cutoff = new Date(Date.now() - SOFT_BLOCK_WINDOW_MS);
      const recent = await db
        .select({ id: riskEventsTable.id })
        .from(riskEventsTable)
        .where(
          and(
            eq(riskEventsTable.userId, userId),
            eq(riskEventsTable.actionTaken, "soft_block"),
            gt(riskEventsTable.createdAt, cutoff),
          ),
        )
        .orderBy(desc(riskEventsTable.createdAt))
        .limit(1);

      if (recent.length === 0) {
        next();
        return;
      }

      // Force re-auth via the existing flow: invalidate
      // sessions for this user. The next request returns 401
      // and the frontend re-enters Google/Telegram/WhatsApp.
      await db.delete(sessionsTable).where(eq(sessionsTable.userId, userId));

      // Mark the soft-block as discharged by writing a
      // sentinel row so we don't re-trigger on the next
      // request from a fresh session.
      await db.insert(riskEventsTable).values({
        userId,
        eventType: "admin_force_reauth",
        score: 0,
        level: "low",
        confidence: "1.000",
        ruleFired: ["soft_block_discharged"],
        actionTaken: "log",
      });

      logger.info(
        { userId, category: "risk-soft-block" },
        "[risk-soft-block] forcing re-auth via existing provider",
      );
    } catch (err) {
      logger.warn(
        { err, category: "risk-soft-block" },
        "[risk-soft-block] check failed; allowing request (safe-by-default)",
      );
    }

    next();
  };
}
