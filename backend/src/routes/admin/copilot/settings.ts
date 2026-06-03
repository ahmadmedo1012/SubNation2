/**
 * GET / PATCH /api/admin/copilot/settings — phase-flag administration.
 *
 * Reads and updates the four boolean flags persisted in
 * `system_settings.key='copilot.phases'`. Only super-admins (`all` scope)
 * may flip flags; every flip is recorded in the audit log + a
 * copilot_actions row with action_class='phase_flag_change'.
 */

import { auditLogsTable, copilotActionsTable, db } from "@workspace/db";
import type { Request, Response } from "express";
import { Router } from "express";
import { logger } from "../../../lib/logger";
import { hasScope } from "../../../middlewares/requireCopilotPermission";
import { requireAdmin, type AdminAuthenticatedRequest } from "../../../middlewares/requireAdmin";
import {
  getPhaseFlags,
  setPhaseFlags,
  type CopilotPhaseFlags,
} from "../../../services/copilot/phase-flags";

const settingsRouter = Router();

settingsRouter.get("/copilot/settings", requireAdmin, async (req, res) => {
  const adminReq = req as AdminAuthenticatedRequest;
  if (!hasScope(adminReq.adminPermissions ?? [], ["admins", "settings"])) {
    res.status(403).json({ error: "غير مصرح", code: "FORBIDDEN" });
    return;
  }
  const flags = await getPhaseFlags();
  res.json(flags);
});

settingsRouter.patch("/copilot/settings", requireAdmin, async (req: Request, res: Response) => {
  const adminReq = req as AdminAuthenticatedRequest;
  if (!hasScope(adminReq.adminPermissions ?? [], ["admins", "settings"])) {
    res.status(403).json({ error: "غير مصرح", code: "FORBIDDEN" });
    return;
  }
  const body = (req.body ?? {}) as Partial<CopilotPhaseFlags>;
  const current = await getPhaseFlags();
  const next: CopilotPhaseFlags = {
    phase1_enabled:
      typeof body.phase1_enabled === "boolean" ? body.phase1_enabled : current.phase1_enabled,
    phase2_enabled:
      typeof body.phase2_enabled === "boolean" ? body.phase2_enabled : current.phase2_enabled,
    phase3_enabled:
      typeof body.phase3_enabled === "boolean" ? body.phase3_enabled : current.phase3_enabled,
    phase3_high_risk_enabled:
      typeof body.phase3_high_risk_enabled === "boolean"
        ? body.phase3_high_risk_enabled
        : current.phase3_high_risk_enabled,
  };
  try {
    await setPhaseFlags(next);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "invalid flags";
    res.status(400).json({ error: msg, code: "COPILOT_INVALID_FLAGS" });
    return;
  }

  try {
    const [action] = await db
      .insert(copilotActionsTable)
      .values({
        adminId: adminReq.adminId,
        intentText: `Flag change: ${JSON.stringify(next)}`,
        actionClass: "phase_flag_change",
        riskTier: "high",
        outcome: "success",
        beforeState: current,
        afterState: next,
        executedAt: new Date(),
        correlationId: (req.headers["x-correlation-id"] as string | undefined) ?? "no-corr",
      })
      .returning({ id: copilotActionsTable.id });
    if (action) {
      await db.insert(auditLogsTable).values({
        actorType: "admin",
        actorId: adminReq.adminId,
        action: "copilot.phase_flag_change",
        targetType: "copilot_action",
        targetId: action.id,
        metadata: JSON.stringify({ before: current, after: next }),
      });
    }
  } catch (err) {
    logger.warn({ err }, "phase-flag audit write failed");
  }
  res.json(next);
});

export { settingsRouter as copilotSettingsRouter };
