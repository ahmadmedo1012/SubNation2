/**
 * GET /api/admin/copilot/history — paged audit view of an admin's own
 * copilot actions (010-ai-admin-copilot, US6).
 *
 * Owner-scoped: admin only sees their own rows. Cursor-paginated by
 * (createdAt, id) descending. Filters: action_class, outcome, since.
 */

import { copilotActionsTable, db } from "@workspace/db";
import { and, desc, eq, lt, or, sql, type SQL } from "drizzle-orm";
import type { Request, Response } from "express";
import { Router } from "express";
import { requireAdmin, type AdminAuthenticatedRequest } from "../../../middlewares/requireAdmin";

const historyRouter = Router();

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

historyRouter.get("/copilot/history", requireAdmin, async (req: Request, res: Response) => {
  const adminReq = req as AdminAuthenticatedRequest;

  const limit = Math.min(
    Math.max(Number.parseInt(String(req.query.limit ?? DEFAULT_LIMIT), 10) || DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  );

  const filters: SQL[] = [eq(copilotActionsTable.adminId, adminReq.adminId)];

  const actionClass = typeof req.query.action_class === "string" ? req.query.action_class : null;
  if (actionClass) filters.push(eq(copilotActionsTable.actionClass, actionClass));

  const outcome = typeof req.query.outcome === "string" ? req.query.outcome : null;
  if (outcome) filters.push(eq(copilotActionsTable.outcome, outcome));

  const sinceRaw = typeof req.query.since === "string" ? req.query.since : null;
  if (sinceRaw) {
    const since = new Date(sinceRaw);
    if (!Number.isNaN(since.getTime())) {
      filters.push(sql`${copilotActionsTable.createdAt} >= ${since.toISOString()}::timestamptz`);
    }
  }

  // Cursor: opaque "<isoCreatedAt>:<id>" — both fields needed because
  // multiple actions can share a millisecond.
  const cursorRaw = typeof req.query.cursor === "string" ? req.query.cursor : null;
  if (cursorRaw) {
    const [iso, idStr] = cursorRaw.split(":");
    const id = Number.parseInt(idStr ?? "", 10);
    if (iso && Number.isFinite(id)) {
      const cursorDate = new Date(iso);
      if (!Number.isNaN(cursorDate.getTime())) {
        filters.push(
          or(
            lt(copilotActionsTable.createdAt, cursorDate),
            and(eq(copilotActionsTable.createdAt, cursorDate), lt(copilotActionsTable.id, id))!,
          )!,
        );
      }
    }
  }

  const rows = await db
    .select({
      id: copilotActionsTable.id,
      previewId: copilotActionsTable.previewId,
      intentText: copilotActionsTable.intentText,
      toolName: copilotActionsTable.toolName,
      actionClass: copilotActionsTable.actionClass,
      riskTier: copilotActionsTable.riskTier,
      outcome: copilotActionsTable.outcome,
      failureReason: copilotActionsTable.failureReason,
      beforeState: copilotActionsTable.beforeState,
      afterState: copilotActionsTable.afterState,
      executedAt: copilotActionsTable.executedAt,
      createdAt: copilotActionsTable.createdAt,
    })
    .from(copilotActionsTable)
    .where(and(...filters))
    .orderBy(desc(copilotActionsTable.createdAt), desc(copilotActionsTable.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last ? `${last.createdAt.toISOString()}:${last.id}` : null;

  res.json({
    entries: page.map((r) => ({
      id: r.id,
      preview_id: r.previewId,
      intent_text: r.intentText,
      tool_name: r.toolName,
      action_class: r.actionClass,
      risk_tier: r.riskTier,
      outcome: r.outcome,
      failure_reason: r.failureReason,
      before_state: r.beforeState,
      after_state: r.afterState,
      executed_at: r.executedAt?.toISOString() ?? null,
      created_at: r.createdAt.toISOString(),
    })),
    next_cursor: nextCursor,
  });
});

export { historyRouter as adminCopilotHistoryRouter };
