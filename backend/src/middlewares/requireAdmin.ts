import { adminUsersTable, db } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { ErrorCode, createErrorResponse } from "../lib/errors";
import { verifyAdminTokenDetailed } from "../lib/jwt";
import { isValidAdminSession } from "../lib/admin-session";

export interface AdminAuthenticatedRequest extends Request {
  adminId: number;
  role: string;
  /**
   * A4-04 (R116): the acting admin's username — materialized here (one
   * extra column on the row lookup this middleware already performs) so
   * money-review surfaces can attribute rows without a second query.
   */
  adminUsername: string;
  /**
   * A8-01 (round-94): the admin_sessions row id bound to this token.
   * null for sid-less tokens (only possible outside production — see
   * the strictness note in requireAdmin).
   */
  adminSessionId: string | null;
  /**
   * Permission scopes granted to this admin, materialized once per
   * request from the admin_users row. The `requirePermission(scope)`
   * middleware reads from here. Always populated when this middleware
   * succeeds — even for pre-RBAC tokens that didn't carry permissions
   * in the JWT (we fall back to a DB lookup so existing sessions
   * survive the deploy without forcing re-login).
   */
  adminPermissions: string[];
}

export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // Try cookie first, fallback to Authorization header
  const token = req.cookies?.admin_token || req.headers.authorization?.replace("Bearer ", "");

  if (!token) {
    res.status(401).json(createErrorResponse("غير مصرح", ErrorCode.UNAUTHORIZED));
    return;
  }

  const result = verifyAdminTokenDetailed(token);
  if (!result.ok) {
    if (result.reason === "expired") {
      res.status(401).json(createErrorResponse("جلسة الإدارة منتهية", ErrorCode.SESSION_EXPIRED));
    } else {
      res
        .status(401)
        .json(createErrorResponse("رمز جلسة الإدارة غير صالح", ErrorCode.INVALID_TOKEN));
    }
    return;
  }

  // V1-CRITICAL (red-team 2026-09-06): the 2FA temp token minted by
  // POST /api/admin/login when TOTP is enabled is a HALF session — it
  // exists so /login/verify-2fa can identify the admin mid-challenge.
  // requireAdmin previously never checked the flag, so a password-only
  // attacker could use the temp token as a FULL admin session on every
  // route (finance approvals, refunds, admin creation) — bypassing 2FA
  // entirely. Temp tokens are now rejected at the gate.
  if (result.payload.isTemp === true) {
    res
      .status(401)
      .json(createErrorResponse("جلسة مؤقتة — أكمل التحقق بخطوتين أولاً", ErrorCode.UNAUTHORIZED));
    return;
  }

  // A8-01 (round-94): server-side session enforcement. A token minted
  // after this deploy carries a `sid`; the row is the revocation truth
  // — logout / change-password / disable kill the token regardless of
  // the JWT's own 8h TTL. Production additionally REJECTS sid-less
  // tokens (fail-closed: pre-migration tokens die once, the single
  // operator re-logs in). Non-production accepts them so the pglite
  // fixtures that call signAdminToken({adminId, role}) directly keep
  // passing without minting rows.
  const sid = result.payload.sid;
  if (typeof sid !== "string" || sid.length === 0) {
    if (process.env.NODE_ENV === "production") {
      res
        .status(401)
        .json(
          createErrorResponse(
            "جلسة قديمة — أعد تسجيل الدخول",
            ErrorCode.SESSION_EXPIRED,
          ),
        );
      return;
    }
  } else {
    const sessionValid = await isValidAdminSession(sid, result.payload.adminId);
    if (!sessionValid) {
      res
        .status(401)
        .json(
          createErrorResponse(
            "تم إبطال الجلسة — أعد تسجيل الدخول",
            ErrorCode.SESSION_EXPIRED,
          ),
        );
      return;
    }
  }

  // Look up the row to (a) confirm the admin still exists, (b) check
  // is_active so soft-disabled admins lose access in real time, and
  // (c) read the latest permissions array. One indexed PK lookup —
  // negligible vs the JWT verify above on the same request.
  const [admin] = await db
    .select({
      id: adminUsersTable.id,
      username: adminUsersTable.username,
      role: adminUsersTable.role,
      isActive: adminUsersTable.isActive,
      permissions: adminUsersTable.permissions,
    })
    .from(adminUsersTable)
    .where(eq(adminUsersTable.id, result.payload.adminId))
    .limit(1);

  if (!admin) {
    res.status(401).json(createErrorResponse("جلسة الإدارة غير صالحة", ErrorCode.INVALID_TOKEN));
    return;
  }

  if (!admin.isActive) {
    res
      .status(403)
      .json(createErrorResponse("الحساب معطّل من قبل المسؤول", ErrorCode.FORBIDDEN));
    return;
  }

  const adminReq = req as AdminAuthenticatedRequest;
  adminReq.adminId = admin.id;
  adminReq.role = admin.role;
  adminReq.adminUsername = admin.username;
  adminReq.adminSessionId = typeof sid === "string" && sid.length > 0 ? sid : null;
  adminReq.adminPermissions = Array.isArray(admin.permissions) ? admin.permissions : [];
  next();
}

/**
 * Legacy role-based gate kept for backward compatibility with
 * pre-RBAC callers. New code should use `requirePermission(scope)`
 * from lib/permissions.ts instead. super_admin always wins (matches
 * pre-RBAC behavior).
 */
export function requireRole(allowedRoles: string[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await requireAdmin(req, res, () => {
      const adminReq = req as AdminAuthenticatedRequest;
      if (adminReq.role === "super_admin" || allowedRoles.includes(adminReq.role)) {
        return next();
      }
      res.status(403).json(createErrorResponse("صلاحيات غير كافية", ErrorCode.FORBIDDEN));
    });
  };
}
