import { db, authActivityTable } from "@workspace/db";
import type { Request } from "express";

export interface AuthActivityParams {
  userId?: number;
  identifier: string;
  action:
    | "login"
    | "register"
    | "logout"
    | "logout_all"
    | "provider_link"
    | "provider_unlink"
    | "password_change";
  provider?: string;
  success: boolean;
  failureReason?: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Log authentication activity to the auth_activity table
 * This provides security monitoring and audit trail for all auth events
 */
export async function logAuthActivity(params: AuthActivityParams): Promise<void> {
  await db.insert(authActivityTable).values({
    userId: params.userId,
    identifier: params.identifier,
    action: params.action,
    provider: params.provider,
    success: params.success,
    failureReason: params.failureReason,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    createdAt: new Date(),
  });
}

/**
 * Extract client information (IP address and user agent) from request
 */
export function getClientInfo(req: Request): { ipAddress: string; userAgent: string } {
  return {
    ipAddress: req.ip || req.socket.remoteAddress || "unknown",
    userAgent: req.get("user-agent") || "unknown",
  };
}
