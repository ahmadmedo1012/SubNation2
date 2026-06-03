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
import { sql } from "drizzle-orm";
import { logger } from "../../../lib/logger";
import { hasScope } from "../../../middlewares/requireCopilotPermission";
import { requireAdmin, type AdminAuthenticatedRequest } from "../../../middlewares/requireAdmin";
import {
  clearPhaseFlagsCache,
  getPhaseFlags,
  setPhaseFlags,
  type CopilotPhaseFlags,
} from "../../../services/copilot/phase-flags";

const settingsRouter = Router();

settingsRouter.get("/copilot/settings", requireAdmin, async (req, res) => {
  // GET is readable by any authenticated admin — the four booleans are
  // not sensitive and the panel needs them on every load to decide
  // whether to render. PATCH remains restricted to super-admins
  // (`admins` or `settings` scope).

  // Optional ?debug=1 — logs and returns the raw row count + value so
  // a missing/mis-shaped row is diagnosable without server access.
  // Only super-admins may pass debug=1.
  if (req.query.debug === "1") {
    const adminReq = req as AdminAuthenticatedRequest;
    if (!hasScope(adminReq.adminPermissions ?? [], ["admins", "settings"])) {
      res.status(403).json({ error: "غير مصرح", code: "FORBIDDEN" });
      return;
    }
    clearPhaseFlagsCache();
    try {
      const result = await db.execute(
        sql`SELECT key, value FROM system_settings WHERE key = 'copilot.phases' LIMIT 1`,
      );
      const r = result as unknown as { rows?: unknown[] } | unknown[];
      const isArr = Array.isArray(r);
      const rows = isArr ? (r as unknown[]) : ((r as { rows?: unknown[] }).rows ?? []);
      const flags = await getPhaseFlags();

      // Env diagnostics — confirm provider config presence WITHOUT
      // leaking the key value. Only super-admins reach this branch.
      const rawKey = (process.env.COPILOT_API_KEY ?? "").trim();
      const env = {
        copilot_provider: process.env.COPILOT_PROVIDER ?? "(default: openrouter)",
        copilot_api_key_present: rawKey.length > 0,
        copilot_api_key_length: rawKey.length,
        copilot_api_key_prefix: rawKey.slice(0, 8),
        copilot_model: process.env.COPILOT_MODEL ?? "(provider default)",
        copilot_base_url_override: process.env.COPILOT_BASE_URL ?? null,
        node_env: process.env.NODE_ENV ?? null,
        relevant_env_keys_seen: Object.keys(process.env)
          .filter((k) => /COPILOT|NVIDIA|OPENROUTER/i.test(k))
          .sort(),
      };

      logger.warn(
        { row_count: rows.length, parsed_flags: flags, env },
        "copilot phase-flags + env debug",
      );
      res.json({
        flags,
        __debug__: {
          shape_is_array: isArr,
          row_count: rows.length,
          first_row: rows[0],
          env,
        },
      });
      return;
    } catch (err) {
      res.status(500).json({
        error: "debug failed",
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }
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
