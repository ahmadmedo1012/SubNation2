import type { NextFunction, Request, Response } from "express";
import { ErrorCode, createErrorResponse } from "../lib/errors";
import { verifyAdminTokenDetailed } from "../lib/jwt";

export interface AdminAuthenticatedRequest extends Request {
  adminId: number;
  role: string;
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
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
  (req as AdminAuthenticatedRequest).adminId = result.payload.adminId;
  (req as AdminAuthenticatedRequest).role = result.payload.role;
  next();
}

export function requireRole(allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    requireAdmin(req, res, () => {
      const adminReq = req as AdminAuthenticatedRequest;
      if (adminReq.role === "super_admin" || allowedRoles.includes(adminReq.role)) {
        return next();
      }
      res.status(403).json(createErrorResponse("صلاحيات غير كافية", ErrorCode.FORBIDDEN));
    });
  };
}
