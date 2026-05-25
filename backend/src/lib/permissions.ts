import type { NextFunction, Request, Response } from "express";
import { ErrorCode, createErrorResponse } from "./errors";
import type { AdminAuthenticatedRequest } from "../middlewares/requireAdmin";

/**
 * Permission scope catalog. Every privileged admin route guards itself
 * with one of these values via the `requirePermission(scope)` middleware
 * factory below.
 *
 * The wildcard `"all"` grants every scope. Pre-RBAC admins were
 * backfilled with `["all"]` by the migration so they keep current
 * full access. New admins created via the admin-management UI pick
 * a narrower subset.
 */
export const PERMISSION_SCOPES = {
  ALL: "all",
  ORDERS: "orders",
  FINANCE: "finance",
  INVENTORY: "inventory",
  SUPPORT: "support",
  USERS: "users",
  ADMINS: "admins",
  SETTINGS: "settings",
} as const;

export type PermissionScope = (typeof PERMISSION_SCOPES)[keyof typeof PERMISSION_SCOPES];

export const ALL_SCOPES: PermissionScope[] = [
  PERMISSION_SCOPES.ORDERS,
  PERMISSION_SCOPES.FINANCE,
  PERMISSION_SCOPES.INVENTORY,
  PERMISSION_SCOPES.SUPPORT,
  PERMISSION_SCOPES.USERS,
  PERMISSION_SCOPES.ADMINS,
  PERMISSION_SCOPES.SETTINGS,
];

/**
 * Pure check: does this admin's permission array satisfy the requested
 * scope? An "all" entry wins unconditionally; otherwise the exact scope
 * must be present in the array.
 */
export function hasPermission(
  granted: readonly string[] | null | undefined,
  required: PermissionScope,
): boolean {
  if (!Array.isArray(granted)) return false;
  return granted.includes(PERMISSION_SCOPES.ALL) || granted.includes(required);
}

/**
 * Express middleware factory. Returns a middleware that 403s when the
 * authenticated admin lacks the required scope. MUST be mounted AFTER
 * `requireAdmin` so the permissions array is available on req.
 *
 * Usage:
 *
 *   router.post(
 *     "/topups/:id/approve",
 *     requireAdmin,
 *     requirePermission("finance"),
 *     handler,
 *   );
 *
 * Or at the parent-router level:
 *
 *   adminRouter.use("/topups", requireAdmin, requirePermission("finance"), topupsRouter);
 */
export function requirePermission(required: PermissionScope) {
  return function permissionGuard(req: Request, res: Response, next: NextFunction): void {
    const granted = (req as AdminAuthenticatedRequest).adminPermissions;
    if (!hasPermission(granted, required)) {
      res
        .status(403)
        .json(
          createErrorResponse(
            "ليست لديك صلاحية للوصول إلى هذه الصفحة",
            ErrorCode.FORBIDDEN,
          ),
        );
      return;
    }
    next();
  };
}
