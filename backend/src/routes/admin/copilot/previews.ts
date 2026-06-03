/**
 * Preview routes — GET, cancel, confirm (010-ai-admin-copilot, US2 + US3).
 *
 *   GET    /api/admin/copilot/previews/:id          — owner-scoped read
 *   POST   /api/admin/copilot/previews/:id/cancel   — discard, audit cancellation
 *   POST   /api/admin/copilot/previews/:id/confirm  — execute (low-risk only)
 */

import { db, copilotPreviewsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import type { Request, Response } from "express";
import { Router } from "express";
import { logger } from "../../../lib/logger";
import { copilotRateLimit } from "../../../lib/copilot/rate-limit";
import { requireAdmin, type AdminAuthenticatedRequest } from "../../../middlewares/requireAdmin";
import { requireCopilotPhase } from "../../../middlewares/requireCopilotPhase";
import { recordNonExecute } from "../../../services/copilot/audit";
import { executeLowRiskConfirm } from "../../../services/copilot/executor";
import { cancelPreview, getOwnedPreview } from "../../../services/copilot/preview-store";

const previewsRouter = Router();

// ────────────────────────────────────────────────────────────────────────
// GET /previews/:id
// ────────────────────────────────────────────────────────────────────────
previewsRouter.get("/copilot/previews/:id", requireAdmin, async (req: Request, res: Response) => {
  const adminReq = req as AdminAuthenticatedRequest;
  const id = String(req.params.id ?? "");
  const row = await getOwnedPreview(id, adminReq.adminId);
  if (!row) {
    res.status(404).json({ error: "المعاينة غير موجودة", code: "COPILOT_PREVIEW_NOT_FOUND" });
    return;
  }
  if (row.consumedAt) {
    res.status(410).json({ error: "المعاينة استُهلكت بالفعل", code: "COPILOT_PREVIEW_CONSUMED" });
    return;
  }
  if (row.expiresAt < new Date()) {
    res.status(410).json({ error: "انتهت صلاحية المعاينة", code: "COPILOT_PREVIEW_EXPIRED" });
    return;
  }
  res.json({
    id: row.id,
    admin_id: row.adminId,
    intent_text: row.intentText,
    intent_summary:
      (row.previewPayload as { intent_summary?: string } | null)?.intent_summary ?? "",
    action_class: row.actionClass,
    risk_tier: row.riskTier,
    payload: row.previewPayload,
    created_at: row.createdAt.toISOString(),
    expires_at: row.expiresAt.toISOString(),
    confirmed_once_at: row.confirmedOnceAt?.toISOString() ?? null,
    cooldown_starts_at: row.cooldownStartsAt?.toISOString() ?? null,
    confirmed_twice_at: row.confirmedTwiceAt?.toISOString() ?? null,
  });
});

// ────────────────────────────────────────────────────────────────────────
// POST /previews/:id/cancel
// ────────────────────────────────────────────────────────────────────────
previewsRouter.post(
  "/copilot/previews/:id/cancel",
  requireAdmin,
  copilotRateLimit,
  async (req: Request, res: Response) => {
    const adminReq = req as AdminAuthenticatedRequest;
    const id = String(req.params.id ?? "");
    const row = await getOwnedPreview(id, adminReq.adminId);
    if (!row) {
      res.status(404).json({ error: "المعاينة غير موجودة", code: "COPILOT_PREVIEW_NOT_FOUND" });
      return;
    }
    const ok = await cancelPreview(id, adminReq.adminId);
    if (!ok) {
      // Already consumed.
      res
        .status(409)
        .json({ error: "تعذّر إلغاء معاينة مستهلكة", code: "COPILOT_PREVIEW_CONSUMED" });
      return;
    }
    await recordNonExecute({
      previewId: id,
      adminId: adminReq.adminId,
      intentText: row.intentText,
      toolName: row.toolName,
      actionClass: row.actionClass,
      riskTier: row.riskTier,
      outcome: "cancelled",
      modelId: row.modelId,
      correlationId: row.correlationId,
    });
    res.json({ success: true });
  },
);

// ────────────────────────────────────────────────────────────────────────
// POST /previews/:id/confirm
// ────────────────────────────────────────────────────────────────────────
previewsRouter.post(
  "/copilot/previews/:id/confirm",
  requireAdmin,
  requireCopilotPhase("phase3_enabled"),
  copilotRateLimit,
  async (req: Request, res: Response) => {
    const adminReq = req as AdminAuthenticatedRequest;
    const id = String(req.params.id ?? "");

    // Pre-check: distinguish "not found" from "expired/consumed" before
    // claim. Without this we couldn't return the right HTTP code.
    const peek = await getOwnedPreview(id, adminReq.adminId);
    if (!peek) {
      res.status(404).json({ error: "المعاينة غير موجودة", code: "COPILOT_PREVIEW_NOT_FOUND" });
      return;
    }
    if (peek.consumedAt) {
      res.status(409).json({ error: "المعاينة استُهلكت بالفعل", code: "COPILOT_PREVIEW_CONSUMED" });
      return;
    }
    if (peek.expiresAt < new Date()) {
      res.status(410).json({ error: "انتهت صلاحية المعاينة", code: "COPILOT_PREVIEW_EXPIRED" });
      return;
    }
    if (peek.riskTier === "no_execute") {
      // Wallet/refund — handoff URL only.
      res.status(403).json({
        error: "هذا النوع من العمليات لا يُنفَّذ من المساعد.",
        code: "COPILOT_HANDOFF_REQUIRED",
        handoff: {
          target_url: "/admin/topups",
          rationale: "Wallet/refund operations are not executable from the copilot.",
        },
      });
      return;
    }
    if (peek.riskTier === "high") {
      res.status(403).json({
        error: "هذه العملية عالية الخطورة وتتطلب تأكيداً ثانياً (لم يُفعَّل بعد).",
        code: "COPILOT_HIGH_RISK_DISABLED",
      });
      return;
    }

    const outcome = await executeLowRiskConfirm({
      previewId: id,
      adminId: adminReq.adminId,
    });

    switch (outcome.kind) {
      case "success":
        res.json({
          outcome: "success",
          action_id: outcome.actionId,
          result_url: peek.affectedEntityType === "product" ? `/admin/products` : null,
        });
        return;
      case "stale":
        res.status(409).json({
          error: "تم تعديل البيانات بعد إنشاء المعاينة",
          code: "COPILOT_STALE_RECORD",
          stale_ids: outcome.staleIds,
        });
        return;
      case "expired":
        res.status(410).json({ error: "انتهت صلاحية المعاينة", code: "COPILOT_PREVIEW_EXPIRED" });
        return;
      case "consumed":
        res.status(409).json({ error: "المعاينة استُهلكت", code: "COPILOT_PREVIEW_CONSUMED" });
        return;
      case "wrong_tier":
        res.status(403).json({
          error: "هذه العملية تتطلب تأكيداً ثانياً (Phase 4)",
          code: "COPILOT_HIGH_RISK_DISABLED",
        });
        return;
      case "not_found":
        res.status(404).json({ error: "المعاينة غير موجودة", code: "COPILOT_PREVIEW_NOT_FOUND" });
        return;
      case "failure":
        logger.error({ outcome, previewId: id }, "copilot execute failure");
        res
          .status(500)
          .json({ error: "فشل التنفيذ", code: "COPILOT_EXECUTE_FAILED", reason: outcome.reason });
        return;
    }
  },
);

export { previewsRouter as adminCopilotPreviewsRouter };
