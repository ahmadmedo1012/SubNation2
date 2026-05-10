import type { NextFunction, Request, Response } from "express";
import { ErrorCode, createErrorResponse } from "../lib/errors";
import { verifyAdminTokenDetailed } from "../lib/jwt";

export interface AdminAuthenticatedRequest extends Request {
  adminId: number;
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json(createErrorResponse("غير مصرح", ErrorCode.UNAUTHORIZED));
    return;
  }
  const result = verifyAdminTokenDetailed(auth.slice(7));
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
  next();
}
