/**
 * GET /api/admin/copilot/history — paged audit view of an admin's own
 * copilot actions (010-ai-admin-copilot, US6).
 *
 * Owner-scoped: admin only sees their own rows. Cursor-paginated by
 * (createdAt, id) descending. Filters: action_class, outcome, since_iso.
 *
 * A5-02 / A5-06 (round-94): the contract required `admin_id` in every
 * CopilotHistoryEntry but the response never emitted it — any orval-
 * generated client failed parsing on EVERY history response. The select
 * + mapper now carry it (the column was always loaded by the table).
 * `since_iso` is the contract name; the legacy `since` alias is still
 * accepted for pre-94 callers, and an unparseable value for EITHER name
 * now 400s (documented) instead of being silently ignored.
 * `entity_type` / `entity_id` are documented deprecated no-ops — the
 * history table has no entity columns (entity data lives on preview
 * rows), so they are deliberately not read.
 */

import { copilotActionsTable, db } from "@workspace/db";
import { and, desc, eq, lt, or, sql, type SQL } from "drizzle-orm";
import type { Request, Response } from "express";
import { Router } from "express";
import { requireAdmin, type AdminAuthenticatedRequest } from "../../../middlewares/requireAdmin";
import { ErrorCode, createErrorResponse } from "../../../lib/errors";

const historyRouter = Router();

// R123-E5 (A6 P3): no-store parity with the 98-F3 pattern — the
// history feed carries an admin's own action audit (prompts, outcomes);
// an intermediary must never serve it from cache.
historyRouter.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

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

  // A5-06: contract name is `since_iso`; the legacy `since` alias is
  // kept for pre-94 callers. An unparseable value for either name is a
  // documented 400 — the old silent-ignore made "?since_iso=…" (what
  // the contract documents) a complete no-op while looking filtered.
  const sinceQuery =
    typeof req.query.since_iso === "string"
      ? req.query.since_iso
      : typeof req.query.since === "string"
        ? req.query.since
        : null;
  if (sinceQuery !== null) {
    const since = new Date(sinceQuery);
    if (Number.isNaN(since.getTime())) {
      return res
        .status(400)
        .json(
          createErrorResponse("قيمة التاريخ غير صالحة لمعامل since_iso", ErrorCode.INVALID_DATA),
        );
    }
    filters.push(sql`${copilotActionsTable.createdAt} >= ${since.toISOString()}::timestamptz`);
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
      adminId: copilotActionsTable.adminId,
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
  const nextCursor = hasMore && last ? `${last.createdAt.toISOString()}:${last.id}` : null;

  return res.json({
    entries: page.map((r) => ({
      id: r.id,
      admin_id: r.adminId,
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
