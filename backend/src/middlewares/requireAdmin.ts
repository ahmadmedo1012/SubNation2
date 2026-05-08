import type { Request, Response, NextFunction } from "express";
import { verifyAdminToken } from "../lib/jwt";

export interface AdminAuthenticatedRequest extends Request {
  adminId: number;
}

export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "غير مصرح" });
    return;
  }
  const payload = verifyAdminToken(auth.slice(7));
  if (!payload) {
    res.status(401).json({ error: "جلسة الإدارة منتهية" });
    return;
  }
  (req as AdminAuthenticatedRequest).adminId = payload.adminId;
  next();
}
