/**
 * Hard-block middleware (T011a — mounted round-98 wave B, task 98-B3).
 *
 * Refuses the triggering action with HTTP 423 Locked when:
 *   - the user has a recent `risk_events.actionTaken='hard_block'`
 *     (written by the scoring side only for level=critical events
 *     with both config gates on — risk-scoring.service decideAction)
 *   - AND `risk_config.modelEnabled=true`
 *   - AND `risk_config.autoBlockEnabled.hardBlock=true`
 *   - AND the source is not allowlisted
 *
 * Mount contract (R98 dead-code audit §1 [P2] "orphan file" +
 * backend-routes-api P3-3 — supersedes the pre-round-98
 * "implemented but mounted nowhere" posture, which referenced the
 * long-gone `/api/wallet/purchase` + `/api/orders/create` paths):
 * wired on the two user-initiated money-submission routes —
 * POST /api/orders (routes/orders.ts) and POST /api/wallet/topups
 * (routes/wallet.ts) — AFTER requireUser (needs userId), BEFORE the
 * soft-block guard and the idempotency middleware:
 *   - before idempotency: a refusal must not consume the caller's
 *     Idempotency-Key (the retry once the block clears must be able
 *     to claim it);
 *   - before the soft guard: severity ordering — soft-block's own
 *     docs call the hard_block family "the refusal layer"; it is the
 *     non-dischargeable, critical-tier verdict, so it answers FIRST.
 *     A buyer tagged both must get the honest "contact support" 423,
 *     not the soft guard's "re-login and retry" message plus
 *     session-wipe side effects for a refusal that re-auth cannot
 *     discharge.
 *
 * Dormant-by-default (mount changes nothing until opted in):
 *   - `RISK_PIPELINE_ENABLED` unset (current production shape —
 *     env.example default false, absent from render.yaml) → immediate
 *     next(); zero DB reads, zero side effects;
 *   - `risk_config.modelEnabled` and `autoBlockEnabled.hardBlock`
 *     both default false → a double config gate on top of the env
 *     flag;
 *   - free-tier constraints: no timers, no Redis, one scoped
 *     `risk_events` lookup (userId + actionTaken + window) that only
 *     runs on the two money-submission routes.
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
