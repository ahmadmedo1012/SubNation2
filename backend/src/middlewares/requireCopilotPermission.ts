/**
 * Copilot permission gate (010-ai-admin-copilot, T027 + T146).
 *
 * The admin must already be authenticated via `requireAdmin`. This middleware
 * checks that the admin has at least one of the required scopes. On denial it
 * writes a `copilot_actions` row with `outcome="refused"` (audit-trail per
 * FR-AUDIT-002 + remediation C2) BEFORE returning 403 — so refused intents
 * are forensically reconcilable.
 */
import type { NextFunction, Request, Response } from "express";
import { db } from "@workspace/db";
import { copilotActionsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import type { AdminAuthenticatedRequest } from "./requireAdmin";

const SUPER = "all";

export function hasScope(perms: string[], scope: string | string[]): boolean {
  if (perms.includes(SUPER)) return true;
  const need = Array.isArray(scope) ? scope : [scope];
  return need.some((s) => perms.includes(s));
}

export function requireCopilotPermission(scope: string | string[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const adminReq = req as AdminAuthenticatedRequest;
    const perms = adminReq.adminPermissions ?? [];
    if (hasScope(perms, scope)) {
      return next();
    }

    const need = Array.isArray(scope) ? scope.join("|") : scope;
    const intentText =
      typeof req.body === "object" &&
      req.body &&
      typeof (req.body as { intent_text?: unknown }).intent_text === "string"
        ? (req.body as { intent_text: string }).intent_text.slice(0, 4000)
        : "";

    try {
      await db.insert(copilotActionsTable).values({
        adminId: adminReq.adminId,
        intentText,
        actionClass: "refusal",
        riskTier: "low",
        outcome: "refused",
        failureReason: `out_of_scope: missing scope ${need}`,
        correlationId: (req.headers["x-correlation-id"] as string | undefined) ?? "no-corr",
      });
    } catch (err) {
      logger.warn({ err, adminId: adminReq.adminId }, "copilot refusal-audit write failed");
    }

    res.status(403).json({
      error: "ليس لديك الصلاحية لاستخدام هذا الجزء من المساعد",
      code: "COPILOT_OUT_OF_SCOPE",
      missing_scope: need,
    });
  };
}
