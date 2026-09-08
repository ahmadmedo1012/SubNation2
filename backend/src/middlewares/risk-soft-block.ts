/**
 * Soft-block middleware (T011).
 *
 * Reads the most recent `risk_events.actionTaken='soft_block'`
 * row for the authenticated user. If one exists and has not
 * been "discharged" (consumed by a successful re-auth), the
 * configured mode decides what happens:
 *
 *   - "reauth-next" (default, T011 spec §5.4): the middleware NEVER
 *     blocks the current request — it deletes the user's `sessions`
 *     rows (so the next request returns 401 from the existing auth
 *     pipeline) and the user re-enters Google / Telegram / WhatsApp
 *     as before. Friction step, not customer lockout.
 *
 *   - "guard" (round-94 F1): money-path mode — the tagged user's
 *     action is REFUSED (423) *and* the re-auth friction is applied
 *     in the same response (sessions invalidated + discharge
 *     sentinel). The NEXT money attempt from a fresh session passes:
 *     soft-block is friction, and the hard_block row family (gated
 *     separately, opt-in via risk_config.autoBlockEnabled.hardBlock +
 *     modelEnabled) is the refusal layer. Constitution Principle I
 *     (money never breaks): any internal error allows the request
 *     through (safe-by-default), mirroring risk-hard-block.
 *
 * Constitution Principle II: this never introduces a new auth
 * path — re-auth goes through the existing provider flows.
 *
 * Allowlist: per spec §5.4, an allowlisted source short-circuits
 * to a no-op so admin-IP traffic is never blocked.
 *
 * Gating (risk_config semantics, round-94 F1):
 *   - RISK_PIPELINE_ENABLED=true is required for any behavior (the
 *     risk pipeline that writes soft_block rows is itself gated on it).
 *   - risk_config.autoBlockEnabled.softBlock (default true) gates the
 *     middleware — parity with hard-block's autoBlockEnabled.hardBlock
 *     gate. modelEnabled is deliberately NOT consulted: the scoring
 *     service only uses it to gate the hard_block *decision*
 *     (risk-scoring.service.ts decideAction), never soft_block.
 *
 * Discharge contract: the sentinel row written on a guard refusal
 * (eventType 'admin_force_reauth', ruleFired ['soft_block_discharged'])
 * is newer than the soft_block row ⇒ any session presented after it
 * was minted post-refusal (the refusal deleted all prior sessions) ⇒
 * the user re-authenticated ⇒ friction served. A NEWER soft_block row
 * re-arms the guard (repeated offender ⇒ repeated friction).
 */

import { db, riskEventsTable, sessionsTable } from "@workspace/db";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";

import { writeAuditLog } from "../lib/audit";
import { ErrorCode, createErrorResponse } from "../lib/errors";
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

export interface RiskSoftBlockOptions {
  mode?: "reauth-next" | "guard";
}

interface LiveSoftBlockRow {
  id: number;
  createdAt: Date;
}

/**
 * The most recent live (within window) `soft_block` row for the user,
 * or null. Shared by both modes.
 */
async function findLiveSoftBlock(userId: number): Promise<LiveSoftBlockRow | null> {
  const cutoff = new Date(Date.now() - SOFT_BLOCK_WINDOW_MS);
  const rows = await db
    .select({ id: riskEventsTable.id, createdAt: riskEventsTable.createdAt })
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
  return rows[0] ?? null;
}

/**
 * F1 discharge check: was a soft_block discharge sentinel written AFTER
 * the given date? (The sentinel is only written together with a session
 * wipe, so a request arriving after it must carry a post-re-auth
 * session — see the module docs.)
 */
async function hasDischargeSentinelAfter(userId: number, date: Date): Promise<boolean> {
  const rows = await db
    .select({ id: riskEventsTable.id })
    .from(riskEventsTable)
    .where(
      and(
        eq(riskEventsTable.userId, userId),
        eq(riskEventsTable.eventType, "admin_force_reauth"),
        eq(riskEventsTable.actionTaken, "log"),
        gt(riskEventsTable.createdAt, date),
        sql`${riskEventsTable.ruleFired} @> ARRAY['soft_block_discharged']::text[]`,
      ),
    )
    .orderBy(desc(riskEventsTable.createdAt))
    .limit(1);
  return rows.length > 0;
}

export function riskSoftBlockMiddleware(options: RiskSoftBlockOptions = {}) {
  const mode = options.mode ?? "reauth-next";
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
      // F1: honor the config switch — soft-block friction is opt-out
      // (default ON) exactly like the scoring side that writes the rows.
      if (!config.autoBlockEnabled.softBlock) {
        next();
        return;
      }

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

      const liveBlock = await findLiveSoftBlock(userId);
      if (!liveBlock) {
        next();
        return;
      }

      // F1 discharge: a sentinel newer than the tag means the friction
      // already served (the refusal wiped sessions; only a post-re-auth
      // session can be presenting now). Pass through.
      if (await hasDischargeSentinelAfter(userId, liveBlock.createdAt)) {
        next();
        return;
      }

      // Force re-auth via the existing flow: invalidate
      // sessions for this user. The next request returns 401
      // and the frontend re-enters Google/Telegram/WhatsApp.
      await db.delete(sessionsTable).where(eq(sessionsTable.userId, userId));

      // Mark the soft-block as discharged by writing a
      // sentinel row so the next request from a fresh
      // (post-re-auth) session passes the guard.
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
        { userId, category: "risk-soft-block", mode, path: req.originalUrl },
        "[risk-soft-block] forcing re-auth via existing provider",
      );

      if (mode === "guard") {
        // F1 money-path refusal: refuse THIS action (purchase/topup
        // submission). The friction (session wipe) above already landed,
        // so the buyer's retry after re-auth flows through normally.
        try {
          await writeAuditLog(req, "risk.soft_block_applied", "user", userId, {
            path: req.originalUrl,
            method: req.method,
            risk_event_id: liveBlock.id,
          });
        } catch {
          // audit failure is logged inside writeAuditLog
        }
        res
          .status(423)
          .json(
            createErrorResponse(
              "تم تعليق هذا الإجراء مؤقتًا لأسباب أمنية — سجّل الدخول مرة أخرى ثم أعد المحاولة، أو تواصل مع الدعم",
              ErrorCode.FORBIDDEN,
            ),
          );
        return;
      }
    } catch (err) {
      logger.warn(
        { err, category: "risk-soft-block" },
        "[risk-soft-block] check failed; allowing request (safe-by-default)",
      );
    }

    next();
  };
}

/**
 * F1 (round-94 A4): guard-mode convenience factory for the money path.
 * Mounted AFTER requireUser (needs userId) and BEFORE the idempotency
 * middleware (a refusal must not consume the caller's idempotency key).
 * Currently wired on POST /api/orders and POST /api/wallet/topups —
 * the two user-initiated money-adjacent writes. risk-hard-block stays
 * OFF these paths by its own documented Constitution Principle I
 * contract.
 */
export function riskSoftBlockGuardMiddleware() {
  return riskSoftBlockMiddleware({ mode: "guard" });
}
