/**
 * Hard-block middleware (T011a).
 *
 * Refuses the triggering action with HTTP 423 Locked when:
 *   - the user has a recent `risk_events.actionTaken='hard_block'`
 *   - AND `risk_config.modelEnabled=true`
 *   - AND `risk_config.autoBlockEnabled.hardBlock=true`
 *   - AND the source is not allowlisted
 *
 * Constitution Principle I: this middleware is NEVER installed
 * on the purchase critical path (`/api/wallet/purchase`,
 * `/api/orders/create`). The route registrar in
 * `backend/src/routes/index.ts` is responsible for keeping it
 * off those paths; this file documents the contract.
 *
 * Per spec §1 Edge Cases: the check is conservative — any
 * internal error allows the request through (safe-by-default).
 */

import { db, riskEventsTable } from "@workspace/db";
import { and, desc, eq, gt } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";

import { writeAuditLog } from "../lib/audit";
import { ErrorCode, createErrorResponse } from "../lib/errors";
import { logger } from "../lib/logger";
import { getRiskConfig, isAllowlisted } from "../services/risk-config-cache.service";

interface MaybeAuthenticatedRequest extends Request {
  userId?: number;
  user?: { id?: number };
}

const HARD_BLOCK_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export function riskHardBlockMiddleware() {
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
      // Phase-3 gate: hard-block is opt-in AND requires the
      // model to be enabled (per data-model §3 invariant).
      if (!config.modelEnabled || !config.autoBlockEnabled.hardBlock) {
        next();
        return;
      }

      const allowlisted = isAllowlisted(
        { ip: req.ip ?? null, phone: null, device: null },
        config.allowlist,
      );
      if (allowlisted) {
        next();
        return;
      }

      const cutoff = new Date(Date.now() - HARD_BLOCK_WINDOW_MS);
      const recent = await db
        .select({ id: riskEventsTable.id })
        .from(riskEventsTable)
        .where(
          and(
            eq(riskEventsTable.userId, userId),
            eq(riskEventsTable.actionTaken, "hard_block"),
            gt(riskEventsTable.createdAt, cutoff),
          ),
        )
        .orderBy(desc(riskEventsTable.createdAt))
        .limit(1);

      if (recent.length === 0) {
        next();
        return;
      }

      try {
        await writeAuditLog(req, "risk.hard_block_applied", "user", userId, {
          path: req.originalUrl,
          method: req.method,
        });
      } catch {
        // audit failure is logged inside writeAuditLog
      }

      logger.warn(
        { userId, path: req.originalUrl, category: "risk-hard-block" },
        "[risk-hard-block] refusing action — recent hard_block in window",
      );

      res
        .status(423)
        .json(
          createErrorResponse(
            "تم تعليق هذا الإجراء مؤقتًا — يرجى التواصل مع الدعم",
            ErrorCode.FORBIDDEN,
          ),
        );
      return;
    } catch (err) {
      logger.warn(
        { err, category: "risk-hard-block" },
        "[risk-hard-block] check failed; allowing request (safe-by-default)",
      );
    }
    next();
  };
}
