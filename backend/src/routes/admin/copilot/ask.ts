/**
 * POST /api/admin/copilot/ask — Phase 1 read-only natural-language query.
 *
 * Pipeline (left-to-right): requireAdmin → requireCopilotPhase("phase1_enabled")
 *   → copilotRateLimit → handler.
 *
 * Handler (010-ai-admin-copilot, T053):
 *   1. Validate request body.
 *   2. Build system prompt + filtered tool catalog from admin's scopes.
 *   3. Call copilotChat which loops tool_use round-trips (max 4 rounds).
 *   4. Run secret-scan over the final text + tool-result trace.
 *   5. If any secret pattern matched → return 502 COPILOT_SECRET_LEAK and
 *      record an audit row; do NOT return the offending text to the admin.
 *   6. Otherwise return JSON: { text, tool_uses, input_tokens, output_tokens }.
 *
 * NOTE: The OpenAPI spec describes this endpoint as SSE. For Phase 1 we ship
 * a non-streaming JSON response — the same payload, just buffered. The
 * frontend renders it identically; switching to SSE is a future enhancement
 * (US8 polish) once we wire Anthropic's streaming API. The OpenAPI contract
 * is source-of-truth elsewhere; this handler is intentionally simpler so
 * pilot admins can use US1 today without an SSE client.
 */

import { db, copilotActionsTable } from "@workspace/db";
import type { Request, Response } from "express";
import { Router } from "express";
import { Counter } from "prom-client";
import { logger } from "../../../lib/logger";
import { copilotRateLimit } from "../../../lib/copilot/rate-limit";
import { scanForSecrets } from "../../../lib/copilot/secret-scan";
import { getRegistry } from "../../../lib/metrics";
import { requireAdmin, type AdminAuthenticatedRequest } from "../../../middlewares/requireAdmin";
import { requireCopilotPhase } from "../../../middlewares/requireCopilotPhase";
import {
  copilotChat,
  copilotLlmAvailable,
  type ToolUseTrace,
} from "../../../services/copilot/llm-client";
import { buildSystemPrompt } from "../../../services/copilot/system-prompt";
import { readToolsForScopes, runReadTool } from "../../../services/copilot/tools/read";

const COMMAND_COUNTER_NAME = "copilot_command_total";
const SAFETY_COUNTER_NAME = "copilot_safety_refusal_total";

let commandCounter: Counter<string> | null = null;
let safetyCounter: Counter<string> | null = null;
function commands(): Counter<string> {
  if (commandCounter) return commandCounter;
  const reg = getRegistry();
  const existing = reg.getSingleMetric(COMMAND_COUNTER_NAME) as Counter<string> | undefined;
  commandCounter =
    existing ??
    new Counter({
      name: COMMAND_COUNTER_NAME,
      help: "Copilot commands by kind and outcome.",
      labelNames: ["kind", "outcome"] as const,
      registers: [reg],
    });
  return commandCounter;
}
function safety(): Counter<string> {
  if (safetyCounter) return safetyCounter;
  const reg = getRegistry();
  const existing = reg.getSingleMetric(SAFETY_COUNTER_NAME) as Counter<string> | undefined;
  safetyCounter =
    existing ??
    new Counter({
      name: SAFETY_COUNTER_NAME,
      help: "Copilot safety refusals by reason.",
      labelNames: ["reason"] as const,
      registers: [reg],
    });
  return safetyCounter;
}

interface AskBody {
  intent_text: string;
  context?: {
    route?: string;
    focus_entity_type?: string;
    focus_entity_id?: number | null;
  };
  locale?: string;
}

async function handleAsk(req: Request, res: Response): Promise<void> {
  const adminReq = req as AdminAuthenticatedRequest;
  const body = (req.body ?? {}) as Partial<AskBody>;
  const intentText = typeof body.intent_text === "string" ? body.intent_text.trim() : "";
  if (!intentText || intentText.length > 4000) {
    res
      .status(400)
      .json({ error: "intent_text required (1–4000 chars)", code: "COPILOT_INVALID_INPUT" });
    return;
  }

  if (!copilotLlmAvailable()) {
    res.status(503).json({
      error: "خدمة المساعد غير متاحة (مفتاح Anthropic غير مضبوط)",
      code: "COPILOT_LLM_UNAVAILABLE",
    });
    return;
  }

  const correlationId =
    (req.headers["x-correlation-id"] as string | undefined) ?? `cp-${Date.now()}-${adminReq.adminId}`;
  const scopes = adminReq.adminPermissions ?? [];
  const tools = readToolsForScopes(scopes).map((t) => t.spec);

  if (tools.length === 0) {
    res.status(403).json({
      error: "ليس لديك أي صلاحية تخوّلك استخدام أدوات القراءة في المساعد",
      code: "COPILOT_OUT_OF_SCOPE",
    });
    return;
  }

  const systemBlocks = buildSystemPrompt({
    locale: body.locale ?? "ar-LY",
    scopes,
    context: body.context,
  });

  let result;
  try {
    result = await copilotChat({
      systemBlocks,
      intentText,
      tools,
      toolHandler: async (name, input) => {
        const r = await runReadTool(name, input, scopes);
        return r.ok ? r.data : { error: r.error };
      },
    });
  } catch (err) {
    logger.error({ err, adminId: adminReq.adminId, correlationId }, "copilot ask: LLM error");
    commands().inc({ kind: "ask", outcome: "failure" });
    res.status(502).json({
      error: "حدث خطأ أثناء التواصل مع نموذج اللغة",
      code: "COPILOT_LLM_ERROR",
    });
    return;
  }

  // Outbound secret scan — text + the JSON-stringified tool trace.
  const scanText = scanForSecrets(result.text);
  const scanTrace = scanForSecrets(result.toolUses);
  if (scanText.hasMatch || scanTrace.hasMatch) {
    safety().inc({ reason: "secret_leak_attempted" });
    commands().inc({ kind: "ask", outcome: "refused" });
    try {
      await db.insert(copilotActionsTable).values({
        adminId: adminReq.adminId,
        intentText,
        actionClass: "refusal",
        riskTier: "low",
        outcome: "refused",
        failureReason: "secret_leak_attempted",
        modelInputTokens: result.inputTokens,
        modelOutputTokens: result.outputTokens,
        correlationId,
      });
    } catch (err) {
      logger.warn({ err }, "copilot refusal-audit insert failed");
    }
    res.status(502).json({
      error:
        "تم إيقاف الرد لأن النموذج حاول إرجاع معلومات حساسة. سُجِّل الحدث للمراجعة.",
      code: "COPILOT_SECRET_LEAK",
    });
    return;
  }

  commands().inc({ kind: "ask", outcome: "success" });
  res.json({
    text: result.text,
    tool_uses: result.toolUses.map((t: ToolUseTrace) => ({
      name: t.name,
      input: t.input,
      // Truncate large results for the response; the model already
      // synthesized them into `text` so the UI doesn't need full data.
      result_preview: typeof t.result === "string"
        ? t.result.slice(0, 2000)
        : JSON.stringify(t.result).slice(0, 2000),
    })),
    input_tokens: result.inputTokens,
    output_tokens: result.outputTokens,
    correlation_id: correlationId,
  });
}

export const adminCopilotRouter = Router();
adminCopilotRouter.post(
  "/copilot/ask",
  requireAdmin,
  requireCopilotPhase("phase1_enabled"),
  copilotRateLimit,
  handleAsk,
);
