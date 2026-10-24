/**
 * Admin enrichment routes (012-arabic-catalog-enrichment, T016).
 *
 *   GET  /api/admin/enrichment/list           — paged drafts list
 *   GET  /api/admin/enrichment/status         — pipeline readiness + last run (R182)
 *   POST /api/admin/enrichment/:id/publish    — apply a draft
 *   POST /api/admin/enrichment/:id/reject     — reject + 14d suppression
 *
 * All gated by `requireAdmin` + `requirePermission("inventory")` at the
 * parent mount in `routes/admin/index.ts`.
 */

import { Router, type Request, type Response } from "express";
import { ErrorCode, createErrorResponse } from "../../lib/errors";
// E-F2 (R186): digit-exact :id parsing — every sibling admin route already
// rides intParam (lib/http); see the route bodies for why parseInt was wrong.
import { intParam } from "../../lib/http";
import { requireAdmin, type AdminAuthenticatedRequest } from "../../middlewares/requireAdmin";
import {
  listByState,
  pendingCount,
  type DraftRow,
  type DraftState,
} from "../../services/enrichment/draft-store";
import { latestRun } from "../../services/enrichment/run-store";
import { publishDraft, rejectDraftHandler } from "../../services/enrichment/publish";
import { llmAvailable } from "../../services/llm/llm-client";

const router = Router();

// AUD103-4-F13 (r103): no-store parity with the 98-F3 pattern —
// this surface carries enrichment drafts carry catalog/ops context; an intermediary must never
// serve it from cache.
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

const VALID_STATES = new Set<DraftState>(["drafted", "published", "rejected", "draft_invalid"]);

/**
 * R120-B6/A6-F12: hard cap on the admin-supplied `final_text` override.
 * The publish flow lands it verbatim in products.description /
 * description_long / faq — PUBLIC catalog surfaces — so an unbounded
 * override (the old check only required "non-empty after trim") let a
 * single admin POST park up to the 1 MB body limit into the public
 * product page, the catalog cache, and every SEO render. 16,000 chars is
 * ~2× the longest legit generated draft; measured AFTER trim because
 * publish.ts trims before persisting (the cap guards exactly the text
 * that lands, mirroring that trim).
 */
const FINAL_TEXT_MAX_CHARS = 16_000;

// Mirrors jobs/enrichment-runner.ts's module-local default (50,000) so the
// status contract reports the cap the runner would actually apply — the
// runner no-ops at cap ≤ 0 (FR-RUN-002), which is a diagnosable state.
const DEFAULT_DAILY_TOKEN_CAP = 50_000;

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

// ── GET /enrichment/status ────────────────────────────────────────────────
// R182 (§4 operational truth): the read-only diagnostic contract that lets
// the admin panel distinguish the five states its empty queue used to
// conflate into one "set ENRICHMENT_RUNNER_ENABLED=true" hint whose
// prescribed action cannot even succeed in the current deployment (no
// worker tier exists — the WORKER_TIER gate fires FIRST and nothing
// tells the admin). Modeled on the forecast router's pipeline_state
// contract. Readiness booleans mirror the runner's own gate order
// (jobs/enrichment-runner.ts: WORKER_TIER → ENRICHMENT_RUNNER_ENABLED →
// in-service cap/llm checks); the LLM probe is llmAvailable() — the
// non-throwing hasLlmProvider() path (never getLlmProvider(), which
// throws in production when the key is missing). No secret ever leaves
// this handler: booleans + the run row only.
router.get("/enrichment/status", requireAdmin, async (_req: Request, res: Response) => {
  const dailyTokenCap = Number.parseInt(
    process.env.ENRICHMENT_DAILY_TOKEN_CAP ?? String(DEFAULT_DAILY_TOKEN_CAP),
    10,
  );
  const lastRun = await latestRun();
  res.json({
    worker_tier: process.env.WORKER_TIER === "true",
    runner_enabled: process.env.ENRICHMENT_RUNNER_ENABLED === "true",
    llm_configured: llmAvailable(),
    daily_token_cap: Number.isFinite(dailyTokenCap) ? dailyTokenCap : DEFAULT_DAILY_TOKEN_CAP,
    last_run: lastRun
      ? {
          outcome: lastRun.outcome,
          started_at: lastRun.startedAt.toISOString(),
          completed_at: lastRun.completedAt?.toISOString() ?? null,
          drafts_generated: lastRun.draftsGenerated,
          failure_reason: lastRun.failureReason,
        }
      : null,
  });
});

router.post("/enrichment/:id/publish", requireAdmin, async (req: Request, res: Response) => {
  const adminReq = req as AdminAuthenticatedRequest;
  // E-F2 (R186): Number.parseInt silently truncated "12abc" → 12 and
  // published the WRONG draft; intParam is digit-exact (null → the same
  // 400 envelope as every other malformed input above).
  const id = intParam(req, "id");
  if (id === null) {
    res.status(400).json(createErrorResponse("معرّف غير صالح", ErrorCode.INVALID_DATA));
    return;
  }
  const body = (req.body ?? {}) as { final_text?: string };
  const finalTextOverride =
    typeof body.final_text === "string" && body.final_text.trim().length > 0
      ? body.final_text
      : null;
  // R120-B6/A6-F12: reject BEFORE the publish flow runs — the draft must
  // stay `drafted` and the product row untouched (400, same shape as the
  // id/state guards above). Trim-first so the check measures the exact
  // text publish.ts would persist.
  if (finalTextOverride !== null && finalTextOverride.trim().length > FINAL_TEXT_MAX_CHARS) {
    res
      .status(400)
      .json(
        createErrorResponse(
          `النص المرسل أطول من الحد المسموح (${FINAL_TEXT_MAX_CHARS} حرفاً)`,
          ErrorCode.INVALID_DATA,
        ),
      );
    return;
  }

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
  // E-F2 (R186): same digit-exact swap as /publish above — "12abc" must
  // 400, never act on draft 12.
  const id = intParam(req, "id");
  if (id === null) {
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
