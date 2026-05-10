import type { NextFunction, Request, Response } from "express";
import { ErrorCode, createErrorResponse } from "../lib/errors";
import { verifyUserTokenDetailed } from "../lib/jwt";

export interface AuthenticatedRequest extends Request {
  userId: number;
}

export function requireUser(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json(createErrorResponse("غير مصرح", ErrorCode.UNAUTHORIZED));
    return;
  }
  const result = verifyUserTokenDetailed(auth.slice(7));
  if (!result.ok) {
    if (result.reason === "expired") {
      res.status(401).json(createErrorResponse("جلسة منتهية", ErrorCode.SESSION_EXPIRED));
    } else {
      res.status(401).json(createErrorResponse("رمز الجلسة غير صالح", ErrorCode.INVALID_TOKEN));
    }
    return;
  }
  (req as AuthenticatedRequest).userId = result.payload.userId;
  next();
}
