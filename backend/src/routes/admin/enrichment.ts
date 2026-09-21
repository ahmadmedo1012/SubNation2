/**
 * Admin enrichment routes (012-arabic-catalog-enrichment, T016).
 *
 *   GET  /api/admin/enrichment/list           — paged drafts list
 *   POST /api/admin/enrichment/:id/publish    — apply a draft
 *   POST /api/admin/enrichment/:id/reject     — reject + 14d suppression
 *
 * All gated by `requireAdmin` + `requirePermission("inventory")` at the
 * parent mount in `routes/admin/index.ts`.
 */

import { Router, type Request, type Response } from "express";
import { ErrorCode, createErrorResponse } from "../../lib/errors";
import { requireAdmin, type AdminAuthenticatedRequest } from "../../middlewares/requireAdmin";
import {
  listByState,
  pendingCount,
  type DraftRow,
  type DraftState,
} from "../../services/enrichment/draft-store";
import { publishDraft, rejectDraftHandler } from "../../services/enrichment/publish";

const router = Router();

// AUD103-4-F13 (r103): no-store parity with the 98-F3 pattern —
// this surface carries enrichment drafts carry catalog/ops context; an intermediary must never
// serve it from cache.
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

const VALID_STATES = new Set<DraftState>(["drafted", "published", "rejected", "draft_invalid"]);

function buildPanelUrl(id: number): string {
  const base = (process.env.APP_ORIGIN ?? "").replace(/\/+$/, "");
  return `${base}/admin/products/enrichment?focus=${id}`;
}

function shape(row: DraftRow): Record<string, unknown> {
  return {
    id: row.id,
    product_id: row.productId,
    product_name: row.productName,
    product_image_url: row.productImageUrl,
    field_name: row.fieldName,
    state: row.state,
    generated_text: row.generatedText,
    final_text: row.finalText,
    model_id: row.modelId,
    input_tokens: row.inputTokens,
    output_tokens: row.outputTokens,
    created_at: row.createdAt.toISOString(),
    published_at: row.publishedAt?.toISOString() ?? null,
    rejected_at: row.rejectedAt?.toISOString() ?? null,
    panel_url: buildPanelUrl(row.id),
  };
}

router.get("/enrichment/list", requireAdmin, async (req: Request, res: Response) => {
  const limit = Math.min(
    Math.max(Number.parseInt(String(req.query.limit ?? "25"), 10) || 25, 1),
    50,
  );
  const stateRaw = typeof req.query.state === "string" ? req.query.state : "drafted";
  if (!VALID_STATES.has(stateRaw as DraftState)) {
    res.status(400).json(createErrorResponse("state غير صالح", ErrorCode.INVALID_DATA));
    return;
  }
  const cursor = typeof req.query.cursor === "string" ? req.query.cursor : null;

  const result = await listByState({
    state: stateRaw as DraftState,
    limit,
    cursor,
  });
  const pending = stateRaw === "drafted" ? await pendingCount() : null;

  res.json({
    drafts: result.rows.map(shape),
    next_cursor: result.nextCursor,
    pending_count: pending,
  });
});

router.post("/enrichment/:id/publish", requireAdmin, async (req: Request, res: Response) => {
  const adminReq = req as AdminAuthenticatedRequest;
  const id = Number.parseInt(String(req.params.id ?? ""), 10);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json(createErrorResponse("معرّف غير صالح", ErrorCode.INVALID_DATA));
    return;
  }
  const body = (req.body ?? {}) as { final_text?: string };
  const finalTextOverride =
    typeof body.final_text === "string" && body.final_text.trim().length > 0
      ? body.final_text
      : null;

  const outcome = await publishDraft({
    draftId: id,
    adminId: adminReq.adminId,
    finalTextOverride,
  });
  switch (outcome.kind) {
    case "success":
      res.json({ success: true, product_id: outcome.productId, field: outcome.field });
      return;
    case "not_found":
      res.status(404).json(createErrorResponse("المسودة غير موجودة", ErrorCode.NOT_FOUND));
      return;
    case "wrong_state":
      res
        .status(409)
        .json(
          createErrorResponse(
            `المسودة في حالة '${outcome.current}' — لا يمكن النشر`,
            ErrorCode.INVALID_DATA,
          ),
        );
      return;
    case "failure":
      res
        .status(500)
        .json(createErrorResponse(`فشل النشر: ${outcome.reason}`, ErrorCode.INTERNAL_ERROR));
      return;
  }
});

router.post("/enrichment/:id/reject", requireAdmin, async (req: Request, res: Response) => {
  const adminReq = req as AdminAuthenticatedRequest;
  const id = Number.parseInt(String(req.params.id ?? ""), 10);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json(createErrorResponse("معرّف غير صالح", ErrorCode.INVALID_DATA));
    return;
  }
  const body = (req.body ?? {}) as { reason?: string };
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 500) : null;

  const outcome = await rejectDraftHandler({
    draftId: id,
    adminId: adminReq.adminId,
    reason,
  });
  switch (outcome.kind) {
    case "success":
      res.json({ success: true });
      return;
    case "not_found":
      res.status(404).json(createErrorResponse("المسودة غير موجودة", ErrorCode.NOT_FOUND));
      return;
    case "wrong_state":
      res
        .status(409)
        .json(
          createErrorResponse(
            `المسودة في حالة '${outcome.current}' — لا يمكن الرفض`,
            ErrorCode.INVALID_DATA,
          ),
        );
      return;
    case "failure":
      res
        .status(500)
        .json(createErrorResponse(`فشل الرفض: ${outcome.reason}`, ErrorCode.INTERNAL_ERROR));
      return;
  }
});

export const adminEnrichmentRouter = router;
