import { adminUsersTable, db } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { ErrorCode, createErrorResponse } from "../lib/errors";
import { verifyAdminTokenDetailed } from "../lib/jwt";

export interface AdminAuthenticatedRequest extends Request {
  adminId: number;
  role: string;
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

  // Look up the row to (a) confirm the admin still exists, (b) check
  // is_active so soft-disabled admins lose access in real time, and
  // (c) read the latest permissions array. One indexed PK lookup —
  // negligible vs the JWT verify above on the same request.
  const [admin] = await db
    .select({
      id: adminUsersTable.id,
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
