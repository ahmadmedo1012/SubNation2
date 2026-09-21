import { timingSafeEqual } from "node:crypto";
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { eq } from "drizzle-orm";
import { adminUsersTable, db } from "@workspace/db";
import { verifyAdminTokenDetailed } from "../lib/jwt";
import { isValidAdminSession } from "../lib/admin-session";
import { logger } from "../lib/logger";
import { getMetrics } from "../lib/metrics";
import { ErrorCode, createErrorResponse } from "../lib/errors";

const router: IRouter = Router();

/**
 * Constant-time string compare. Returns false on length mismatch.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

/**
 * Auth gate for /api/metrics:
 *
 *   - Admin JWT (cookie or Authorization: Bearer <jwt>) OR
 *   - Authorization: Bearer ${METRICS_ADMIN_TOKEN} (compared in constant time)
 *
 * Both paths fail closed within 1 s and never reveal which path failed.
 */
async function requireMetricsAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const headerAuth = req.headers.authorization;
  const expectedToken = process.env.METRICS_ADMIN_TOKEN;
  const presentedToken =
    typeof headerAuth === "string" && headerAuth.startsWith("Bearer ")
      ? headerAuth.slice("Bearer ".length).trim()
      : "";

  // 1) Static admin token path — MUST stay first: it exists for the
  // Prometheus scraper, which has no admin row and no session. It is
  // compared in constant time and never touches the DB.
  if (expectedToken && presentedToken && constantTimeEqual(presentedToken, expectedToken)) {
    next();
    return;
  }

  // 2) Admin JWT path (cookie or bearer)
  const jwt = req.cookies?.admin_token || presentedToken;
  if (jwt) {
    const result = verifyAdminTokenDetailed(jwt);
    // SEC-92-02 (round-92 B1 audit): reject the 2FA TEMP token exactly
    // like requireAdmin does (middlewares/requireAdmin.ts V1-CRITICAL
    // block). The temp token is minted by POST /api/admin/login when TOTP
    // is enabled — a password-only attacker holds it mid-challenge, and
    // previously this route was one of two verifiers that accepted it as
    // a FULL session (full Prometheus operational telemetry). isTemp →
    // fall through to the 401 below.
    if (result.ok && result.payload.isTemp !== true) {
      // 98-F3 (R98-A1 P2-2): the JWT branch used to accept ANY non-temp
      // admin token and stop there — bypassing the exact revocation
      // posture requireAdmin enforces on every other admin route
      // (A8-01). A logged-out, password-changed or soft-disabled admin
      // kept full Prometheus telemetry access for up to the 8h JWT TTL,
      // and pre-migration sid-less tokens that requireAdmin rejects in
      // production passed here. The branch now mirrors requireAdmin:
      // row-backed sid validation + the admin_users is_active re-check.
      // (No session-liveness 60s cache here: /api/metrics is scraped on
      // a slow cadence, so the per-poll indexed PK lookups are cheap.)
      const sid = result.payload.sid;
      if (typeof sid !== "string" || sid.length === 0) {
        // Fail-closed on sid-less tokens in production, same as
        // requireAdmin (pre-migration tokens die once; the operator
        // re-logs in). Non-production accepts them so pglite test
        // fixtures that call signAdminToken({adminId, role}) directly
        // keep passing without minting rows.
        if (process.env.NODE_ENV === "production") {
          res
            .status(401)
            .json(createErrorResponse("جلسة قديمة — أعد تسجيل الدخول", ErrorCode.SESSION_EXPIRED));
          return;
        }
      } else {
        const sessionValid = await isValidAdminSession(sid, result.payload.adminId);
        if (!sessionValid) {
          res
            .status(401)
            .json(
              createErrorResponse("تم إبطال الجلسة — أعد تسجيل الدخول", ErrorCode.SESSION_EXPIRED),
            );
          return;
        }
      }

      // is_active re-check: soft-disabled admins must lose telemetry
      // access in real time, exactly like the rest of the admin surface.
      const [admin] = await db
        .select({ id: adminUsersTable.id, isActive: adminUsersTable.isActive })
        .from(adminUsersTable)
        .where(eq(adminUsersTable.id, result.payload.adminId))
        .limit(1);
      if (!admin || !admin.isActive) {
        res.status(401).json(createErrorResponse("غير مصرح", ErrorCode.UNAUTHORIZED));
        return;
      }
      next();
      return;
    }
  }

  res.status(401).json(createErrorResponse("غير مصرح", ErrorCode.UNAUTHORIZED));
}

router.get("/metrics", requireMetricsAuth, async (_req, res) => {
  try {
    const body = await getMetrics();
    res.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    res.send(body);
  } catch (err) {
    logger.error({ err, category: "monitoring" }, "Failed to render Prometheus metrics");
    // AUD103-4-F16 (r103): Arabic like every other user-facing message —
    // this string is operator-visible, not an internal identifier.
    res.status(500).json(createErrorResponse("تعذّر جلب المقاييس", ErrorCode.INTERNAL_ERROR));
  }
});

export default router;
