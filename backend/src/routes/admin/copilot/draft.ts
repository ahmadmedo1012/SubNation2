/**
 * POST /api/admin/copilot/draft — Phase 2 draft + preview.
 *
 * Pipeline: requireAdmin → requireCopilotPhase("phase2_enabled")
 *   → copilotRateLimit → handler.
 *
 * Handler:
 *   1. Validate request body.
 *   2. Build system prompt + filtered DRAFT tool catalog (NOT read tools —
 *      Phase 2 wants the model to propose changes, not just answer).
 *   3. Call copilotChat. The model is expected to call `draft_catalog_edit`.
 *   4. The first tool call is intercepted via the toolHandler closure: we
 *      run the draft validator + persist a copilot_previews row + return
 *      a sentinel back to the model so it stops. This way one /draft call
 *      produces exactly one preview row.
 *   5. Return DraftResponse with preview_id + preview body.
 *
 * If validation rejects, the helper writes a copilot_actions row with
 * outcome='validation_rejected' and returns the appropriate refusal.
 */

import type { Request, Response } from "express";
import { Router } from "express";
import { logger } from "../../../lib/logger";
import { ErrorCode } from "../../../lib/errors";
import { copilotRateLimit } from "../../../lib/copilot/rate-limit";
import { scanForSecrets } from "../../../lib/copilot/secret-scan";
import { requireAdmin, type AdminAuthenticatedRequest } from "../../../middlewares/requireAdmin";
import { requireCopilotPhase } from "../../../middlewares/requireCopilotPhase";
import { recordNonExecute } from "../../../services/copilot/audit";
import { copilotChat, copilotLlmAvailable } from "../../../services/copilot/llm-client";
import { createPreview } from "../../../services/copilot/preview-store";
import { getCopilotProvider } from "../../../services/copilot/provider-config";
import { buildSystemPrompt } from "../../../services/copilot/system-prompt";
import {
  draftToolsForScopes,
  runDraftTool,
  type DraftPlan,
} from "../../../services/copilot/tools/draft";
import { readToolsForScopes, runReadTool } from "../../../services/copilot/tools/read";

interface DraftBody {
  intent_text: string;
  context?: { route?: string; focus_entity_type?: string; focus_entity_id?: number | null };
  locale?: string;
}

const DRAFT_SENTINEL = "[[COPILOT_PREVIEW_PERSISTED]]";

async function handleDraft(req: Request, res: Response): Promise<void> {
  const adminReq = req as AdminAuthenticatedRequest;
  const body = (req.body ?? {}) as Partial<DraftBody>;
  const intentText = typeof body.intent_text === "string" ? body.intent_text.trim() : "";
  if (!intentText || intentText.length > 4000) {
    res
      .status(400)
      .json({
        error: "intent_text required (1–4000 chars)",
        code: ErrorCode.COPILOT_INVALID_INPUT,
      });
    return;
  }
  if (!copilotLlmAvailable()) {
    res.status(503).json({
      error: "خدمة المساعد غير متاحة",
      code: ErrorCode.COPILOT_LLM_UNAVAILABLE,
    });
    return;
  }

  const correlationId =
    (req.headers["x-correlation-id"] as string | undefined) ??
    `cp-${Date.now()}-${adminReq.adminId}`;
  const scopes = adminReq.adminPermissions ?? [];
  const provider = getCopilotProvider();

  // Combine read tools (so the model can verify state before drafting)
  // with draft tools (the actual proposal surface). Draft tool calls are
  // intercepted; read tool calls run normally.
  const reads = readToolsForScopes(scopes);
  const drafts = draftToolsForScopes(scopes);
  if (drafts.length === 0) {
    res.status(403).json({
      error: "ليس لديك صلاحية لطرح تعديلات",
      code: ErrorCode.COPILOT_OUT_OF_SCOPE,
    });
    return;
  }
  const tools = [...reads.map((t) => t.spec), ...drafts.map((t) => t.spec)];

  const systemText =
    buildSystemPrompt({
      locale: body.locale ?? "ar-LY",
      scopes,
      context: body.context,
    }) +
    "\n\n[PHASE 2] You may also call DRAFT tools (names start with `draft_`). " +
    "When the admin requests a change, call exactly one draft tool with the " +
    "complete proposed values. The system will persist a preview and the " +
    "human will approve or cancel it. You do NOT execute changes yourself.";

  // Capture the first successful draft call.
  let captured: { plan: DraftPlan; toolName: string } | null = null;
  let validationError: { status: 409 | 422 | 403 | 404; code: string; message: string } | null =
    null;

  let result;
  try {
    result = await copilotChat({
      systemText,
      intentText,
      tools,
      toolHandler: async (name, input) => {
        if (name.startsWith("draft_")) {
          if (captured) return { error: "preview already drafted; do not call again" };
          const v = await runDraftTool(name, input, scopes);
          if (!v.ok) {
            validationError = { status: v.status, code: v.code, message: v.message };
            return { error: v.code, message: v.message };
          }
          captured = { plan: v.value, toolName: name };
          return {
            ok: true,
            note: DRAFT_SENTINEL,
            summary: v.value.intentSummary,
          };
        }
        const r = await runReadTool(name, input, scopes);
        return r.ok ? r.data : { error: r.error };
      },
    });
  } catch (err) {
    logger.error({ err, adminId: adminReq.adminId, correlationId }, "copilot draft: LLM error");
    res
      .status(502)
      .json({
        error: "حدث خطأ أثناء التواصل مع نموذج اللغة",
        code: ErrorCode.COPILOT_LLM_ERROR,
      });
    return;
  }

  if (validationError && !captured) {
    const err = validationError as { status: 409 | 422 | 403 | 404; code: string; message: string };
    await recordNonExecute({
      adminId: adminReq.adminId,
      intentText,
      actionClass: "validation_rejection",
      riskTier: "low",
      outcome: "validation_rejected",
      failureReason: err.message,
      modelId: provider.model,
      modelInputTokens: result.inputTokens,
      modelOutputTokens: result.outputTokens,
      correlationId,
    });
    res.status(err.status).json({
      code: err.code,
      message: err.message,
      reasons: [err.message],
    });
    return;
  }

  if (!captured) {
    // The model declined to draft (answered as plain text instead of
    // calling a draft tool).
    //
    // A5-07 (round-94): this used to return 200 with `preview_id: null` —
    // a contract violation (CopilotDraftResponse requires a string
    // preview_id; the orval-generated zod fails parsing on every such
    // response). The contract-honest shape is a stable error: 503 +
    // COPILOT_UNEXPECTED_STATE. The admin UI already treats a 503 from
    // /draft as "fall back to /ask" (CopilotPanel runAsk), so the admin
    // still gets the model's answer — through the endpoint whose schema
    // actually allows a text-only reply.
    //
    // Same secret-scan posture as /ask: the model's plain-text reply is
    // user-facing content, so it MUST pass the outbound scanner before
    // we hand it to the admin UI.
    const textScan = scanForSecrets(result.text);
    if (textScan.hasMatch) {
      await recordNonExecute({
        adminId: adminReq.adminId,
        intentText,
        actionClass: "refusal",
        riskTier: "low",
        outcome: "refused",
        failureReason: "secret_leak_attempted",
        modelId: provider.model,
        modelInputTokens: result.inputTokens,
        modelOutputTokens: result.outputTokens,
        correlationId,
      });
      res.status(502).json({
        error: "تم إيقاف الرد لأن النموذج حاول إرجاع معلومات حساسة. سُجِّل الحدث للمراجعة.",
        code: ErrorCode.COPILOT_SECRET_LEAK,
      });
      return;
    }
    res.status(503).json({
      error:
        "لم ينتج المساعد معاينة تعديل لهذا الطلب — أعد صياغته كطلب تعديل واضح، أو استخدم «سؤال» للحصول على إجابة نصية",
      code: ErrorCode.COPILOT_UNEXPECTED_STATE,
    });
    return;
  }

  const plan: DraftPlan = (captured as { plan: DraftPlan; toolName: string }).plan;

  // Outbound secret-scan on the preview payload before persisting.
  const scan = scanForSecrets(plan);
  if (scan.hasMatch) {
    await recordNonExecute({
      adminId: adminReq.adminId,
      intentText,
      actionClass: "refusal",
      riskTier: plan.riskTier,
      outcome: "refused",
      failureReason: "secret_leak_attempted",
      modelId: provider.model,
      modelInputTokens: result.inputTokens,
      modelOutputTokens: result.outputTokens,
      correlationId,
    });
    res.status(502).json({
      error: "تم إيقاف المعاينة لأن المحتوى المقترح يحتوي معلومات حساسة.",
      code: ErrorCode.COPILOT_SECRET_LEAK,
    });
    return;
  }

  const previewPayload = {
    kind: "single" as const,
    intent_summary: plan.intentSummary,
    side_effects: plan.sideEffects,
    validation_warnings: plan.validationWarnings,
    irreversible: plan.irreversible,
    handoff: null,
    entity_type: plan.affectedEntityType,
    entity_id: plan.affectedIds[0],
    changes: plan.changes,
  };

  const { id, expiresAt } = await createPreview({
    adminId: adminReq.adminId,
    intentText,
    toolName: plan.toolName,
    actionClass: plan.actionClass,
    riskTier: plan.riskTier,
    affectedIds: plan.affectedIds,
    affectedEntityType: plan.affectedEntityType,
    recordVersions: plan.recordVersions,
    previewPayload,
    modelId: provider.model,
    correlationId,
  });

  res.json({
    preview_id: id,
    preview: {
      id,
      admin_id: adminReq.adminId,
      intent_text: intentText,
      intent_summary: plan.intentSummary,
      action_class: plan.actionClass,
      risk_tier: plan.riskTier,
      payload: previewPayload,
      created_at: new Date().toISOString(),
      expires_at: expiresAt.toISOString(),
      confirmed_once_at: null,
      cooldown_starts_at: null,
      confirmed_twice_at: null,
    },
    assistant_text: result.text,
    input_tokens: result.inputTokens,
    output_tokens: result.outputTokens,
    correlation_id: correlationId,
  });
}

export const adminCopilotDraftRouter = Router();
adminCopilotDraftRouter.post(
  "/copilot/draft",
  requireAdmin,
  requireCopilotPhase("phase2_enabled"),
  copilotRateLimit,
  handleDraft,
);
