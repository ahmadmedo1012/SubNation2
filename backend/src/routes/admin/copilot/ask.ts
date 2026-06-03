/**
 * POST /api/admin/copilot/ask — natural-language admin query.
 *
 * Pipeline: requireAdmin → requireCopilotPhase("phase1_enabled")
 *   → copilotRateLimit → handler.
 *
 * Behavior depends on the admin's scope:
 *   - Regular admin scopes (inventory/orders/etc): read-only tool catalog.
 *     The model can describe and explain but cannot mutate. Change requests
 *     should go through /draft (preview/confirm flow).
 *   - Super-admin (`all` scope): the model ALSO gets resolve_product /
 *     update_product / update_stock direct-execute tools. Mutations apply
 *     immediately, with audit trail intact, and no preview step.
 *
 * Wallet/balance/refund operations are NEVER directly executable. The
 * model is instructed to hand off to /admin/topups instead.
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
import { getCopilotProvider } from "../../../services/copilot/provider-config";
import { buildSystemPrompt } from "../../../services/copilot/system-prompt";
import { readToolsForScopes, runReadTool } from "../../../services/copilot/tools/read";
import {
  directToolsForScopes,
  executeUpdateProduct,
  executeUpdateStock,
  isDirectExecuteToolName,
  resolveProduct,
} from "../../../services/copilot/admin-direct";

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
  context?: { route?: string; focus_entity_type?: string; focus_entity_id?: number | null };
  locale?: string;
  /** Prior conversation turns (capped to last 12 messages by the route). */
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}

const MAX_HISTORY_MESSAGES = 12;
const MAX_HISTORY_CHARS = 8000;

function sanitizeHistory(raw: unknown): Array<{ role: "user" | "assistant"; content: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ role: "user" | "assistant"; content: string }> = [];
  let totalChars = 0;
  // Walk newest → oldest so we keep the most recent context if we hit the cap.
  for (let i = raw.length - 1; i >= 0; i--) {
    const item = raw[i] as { role?: unknown; content?: unknown };
    if (!item || (item.role !== "user" && item.role !== "assistant")) continue;
    const content = typeof item.content === "string" ? item.content.slice(0, 4000) : "";
    if (!content) continue;
    if (totalChars + content.length > MAX_HISTORY_CHARS) break;
    out.push({ role: item.role, content });
    totalChars += content.length;
    if (out.length >= MAX_HISTORY_MESSAGES) break;
  }
  return out.reverse();
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
  const history = sanitizeHistory(body.history);

  if (!copilotLlmAvailable()) {
    res.status(503).json({
      error: "خدمة المساعد غير متاحة (مفتاح المزوّد غير مضبوط)",
      code: "COPILOT_LLM_UNAVAILABLE",
    });
    return;
  }

  const correlationId =
    (req.headers["x-correlation-id"] as string | undefined) ??
    `cp-${Date.now()}-${adminReq.adminId}`;
  const scopes = adminReq.adminPermissions ?? [];
  const isSuperAdmin = scopes.includes("all");

  const reads = readToolsForScopes(scopes);
  const directs = directToolsForScopes(scopes);
  const tools = [...reads.map((t) => t.spec), ...directs.map((t) => t.spec)];

  if (tools.length === 0) {
    res.status(403).json({
      error: "ليس لديك أي صلاحية تخوّلك استخدام المساعد",
      code: "COPILOT_OUT_OF_SCOPE",
    });
    return;
  }

  const systemText = buildSystemPrompt({
    locale: body.locale ?? "ar-LY",
    scopes,
    context: body.context,
    superAdminMode: isSuperAdmin,
  });

  interface DirectExecution {
    tool: string;
    success: boolean;
    summary: string;
    data: unknown;
  }
  const directExecutions: DirectExecution[] = [];
  const provider = getCopilotProvider();

  let result;
  try {
    result = await copilotChat({
      systemText,
      intentText,
      tools,
      history,
      toolHandler: async (name, input) => {
        if (isSuperAdmin && isDirectExecuteToolName(name)) {
          if (name === "resolve_product") {
            return resolveProduct.handler(input);
          }
          const ctx = {
            adminId: adminReq.adminId,
            intentText,
            modelId: provider.model,
            correlationId,
          };
          if (name === "update_product") {
            const r = await executeUpdateProduct(input, ctx);
            const success = r.ok;
            const summary = success
              ? `update_product ok (#${(r.data as { productId?: number }).productId})`
              : `update_product failed: ${r.error}`;
            directExecutions.push({
              tool: name,
              success,
              summary,
              data: r.ok ? r.data : { error: r.error },
            });
            return r.ok ? r.data : { error: r.error };
          }
          if (name === "update_stock") {
            const r = await executeUpdateStock(input, ctx);
            const success = r.ok;
            const summary = success
              ? `update_stock ok (#${(r.data as { productId?: number }).productId})`
              : `update_stock failed: ${r.error}`;
            directExecutions.push({
              tool: name,
              success,
              summary,
              data: r.ok ? r.data : { error: r.error },
            });
            return r.ok ? r.data : { error: r.error };
          }
        }

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
      error: "تم إيقاف الرد لأن النموذج حاول إرجاع معلومات حساسة. سُجِّل الحدث للمراجعة.",
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
      result_preview:
        typeof t.result === "string"
          ? t.result.slice(0, 2000)
          : JSON.stringify(t.result).slice(0, 2000),
    })),
    direct_executions: directExecutions,
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
