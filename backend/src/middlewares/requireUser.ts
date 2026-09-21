import type { NextFunction, Request, Response } from "express";
import { ErrorCode, createErrorResponse } from "../lib/errors";
import { verifyUserTokenDetailed } from "../lib/jwt";
import { logger } from "../lib/logger";
// 93-A1 S1/S2 (round-93): the 60 s-cached `isSessionRowLive` probe moved to
// lib/session-liveness.ts so the Socket.IO handshake gate and /api/auth/probe
// share the exact same revocation semantics as this middleware.
import { isSessionRowLive } from "../lib/session-liveness";

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
 * The probe itself (with its 60 s in-process cache) lives in
 * lib/session-liveness.ts — shared with the socket handshake gate and
 * /api/auth/probe (93-A1 S1/S2) so revocation is enforced uniformly
 * across the HTTP and WS surfaces.
 */

export async function requireUser(req: Request, res: Response, next: NextFunction): Promise<void> {
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
          .json(
            createErrorResponse(
              "جلسة منتهية. يرجى تسجيل الدخول مرة أخرى",
              ErrorCode.SESSION_EXPIRED,
            ),
          );
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
    // Legacy token without sessionId (pre-unification). Production now
    // REJECTS these (AUD103-3-F5, r103 — mirroring requireAdmin's A8-01
    // posture): a sid-less token is UNREVOKABLE — logout, logout-all and
    // user deletion could never kill it — so it stayed valid for its full
    // 30-day life regardless of any revocation. Fail-closed: affected
    // users (tokens minted before session unification) re-login once;
    // every mint since unification carries a sid. Non-production keeps
    // accepting them so pglite fixtures that sign tokens directly keep
    // passing without minting session rows.
    if (process.env.NODE_ENV === "production") {
      logger.info(
        { userId: result.payload.userId, category: "auth.session" },
        "[auth] rejected legacy sid-less user token (production fail-closed)",
      );
      res
        .status(401)
        .json(createErrorResponse("جلسة قديمة — أعد تسجيل الدخول", ErrorCode.SESSION_EXPIRED));
      return;
    }
    logger.debug(
      { userId: result.payload.userId },
      "[auth] legacy token without sessionId — skipping row check (non-production)",
    );
  }

  next();
}
