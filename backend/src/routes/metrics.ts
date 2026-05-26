import { timingSafeEqual } from "node:crypto";
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { verifyAdminTokenDetailed } from "../lib/jwt";
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
function requireMetricsAuth(req: Request, res: Response, next: NextFunction): void {
  const headerAuth = req.headers.authorization;
  const expectedToken = process.env.METRICS_ADMIN_TOKEN;
  const presentedToken =
    typeof headerAuth === "string" && headerAuth.startsWith("Bearer ")
      ? headerAuth.slice("Bearer ".length).trim()
      : "";

  // 1) Static admin token path
  if (expectedToken && presentedToken && constantTimeEqual(presentedToken, expectedToken)) {
    next();
    return;
  }

  // 2) Admin JWT path (cookie or bearer)
  const jwt = req.cookies?.admin_token || presentedToken;
  if (jwt) {
    const result = verifyAdminTokenDetailed(jwt);
    if (result.ok) {
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
    res.status(500).json(createErrorResponse("metrics_unavailable", ErrorCode.INTERNAL_ERROR));
  }
});

export default router;
