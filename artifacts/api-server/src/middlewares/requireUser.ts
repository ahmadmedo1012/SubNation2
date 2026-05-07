import type { Request, Response, NextFunction } from "express";
import { verifyUserToken } from "../lib/jwt";

export interface AuthenticatedRequest extends Request {
  userId: number;
}

export function requireUser(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "غير مصرح" });
    return;
  }
  const payload = verifyUserToken(auth.slice(7));
  if (!payload) {
    res.status(401).json({ error: "جلسة منتهية" });
    return;
  }
  (req as AuthenticatedRequest).userId = payload.userId;
  next();
}
