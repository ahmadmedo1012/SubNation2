import type { NextFunction, Request, Response } from "express";
import { and, eq, gte } from "drizzle-orm";
import { db, sessionsTable } from "@workspace/db";
import { ErrorCode, createErrorResponse } from "../lib/errors";
import { verifyUserTokenDetailed } from "../lib/jwt";
import { logger } from "../lib/logger";

export interface AuthenticatedRequest extends Request {
  userId: number;
  /** Session row id embedded in the JWT (lib/session.ts) — may be absent on
   * legacy tokens minted before session unification. */
  sessionId?: string;
}

/**
 * H1 (deep-audit 2026-09-06): JWT-only verification meant logout /
 * logout-all / soft-block never actually killed a session — a stolen
 * token stayed valid for its full 30-day life. Every authed request now
 * checks that the session ROW still exists and is unexpired.
 *
 * A tiny in-process TTL cache keeps this off the hot path: each session
 * costs at most one DB probe per 60 s per instance. Revocation therefore
 * propagates within ≤ 60 s + cache lifetime — an explicit, documented
 * trade-off vs. per-request queries on a single shared Postgres pool.
 */
const SESSION_CACHE_TTL_MS = 60_000;
const sessionValidityCache = new Map<string, number>();

let cachePruneCounter = 0;
function pruneValidityCache(): void {
  // Cheap opportunistic prune — no interval timer, no unbounded growth.
  if (++cachePruneCounter % 500 !== 0) return;
  const now = Date.now();
  for (const [key, expiry] of sessionValidityCache) {
    if (expiry < now) sessionValidityCache.delete(key);
  }
}

async function isSessionRowLive(sessionId: string): Promise<boolean> {
  const now = Date.now();
  const cachedUntil = sessionValidityCache.get(sessionId);
  if (cachedUntil !== undefined && cachedUntil > now) return true;

  const rows = await db
    .select({ id: sessionsTable.id })
    .from(sessionsTable)
    .where(
      and(eq(sessionsTable.id, sessionId), gte(sessionsTable.expiresAt, new Date(now))),
    )
    .limit(1);

  if (rows.length > 0) {
    sessionValidityCache.set(sessionId, now + SESSION_CACHE_TTL_MS);
    pruneValidityCache();
    return true;
  }
  return false;
}

export async function requireUser(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // Try cookie first, fallback to Authorization header
  const token = req.cookies?.auth_token || req.headers.authorization?.replace("Bearer ", "");

  if (!token) {
    res.status(401).json(createErrorResponse("غير مصرح", ErrorCode.UNAUTHORIZED));
    return;
  }

  const result = verifyUserTokenDetailed(token);
  if (!result.ok) {
    if (result.reason === "expired") {
      res.status(401).json(createErrorResponse("جلسة منتهية", ErrorCode.SESSION_EXPIRED));
    } else {
      res.status(401).json(createErrorResponse("رمز الجلسة غير صالح", ErrorCode.INVALID_TOKEN));
    }
    return;
  }

  const authReq = req as AuthenticatedRequest;
  authReq.userId = result.payload.userId;
  authReq.sessionId = result.payload.sessionId;

  if (result.payload.sessionId) {
    try {
      const live = await isSessionRowLive(result.payload.sessionId);
      if (!live) {
        // Row deleted (logout / logout-all / user deletion) or expired.
        logger.info(
          { userId: result.payload.userId, sessionId: result.payload.sessionId },
          "[auth] rejected token whose session row is gone",
        );
        res
          .status(401)
          .json(createErrorResponse("جلسة منتهية. يرجى تسجيل الدخول مرة أخرى", ErrorCode.SESSION_EXPIRED));
        return;
      }
    } catch (err) {
      // DB probe failure: fail OPEN for the signature-valid token (the
      // JWT is still cryptographically sound) but log loudly — this is
      // the same posture the rest of the auth stack takes on infra
      // errors, and hard-failing every request during a Postgres blip
      // would take the whole site down.
      logger.warn(
        { err, userId: result.payload.userId, category: "auth.session" },
        "[auth] session row probe failed — allowing on JWT strength",
      );
    }
  } else {
    // Legacy token without sessionId (pre-unification). Still valid for
    // its signed lifetime; these age out within 30 days of the token.
    logger.debug(
      { userId: result.payload.userId },
      "[auth] legacy token without sessionId — skipping row check",
    );
  }

  next();
}
