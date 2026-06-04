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
import {
  executeHighRiskDoubleConfirm,
  executeLowRiskConfirm,
} from "../../../services/copilot/executor";
import { getPhaseFlags } from "../../../services/copilot/phase-flags";
import {
  cancelPreview,
  getOwnedPreview,
  markFirstConfirmHighRisk,
} from "../../../services/copilot/preview-store";

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
      const flags = await getPhaseFlags();
      if (!flags.phase3_high_risk_enabled) {
        res.status(403).json({
          error: "هذه العملية عالية الخطورة وتتطلب تأكيداً ثانياً (لم يُفعَّل بعد).",
          code: "COPILOT_HIGH_RISK_DISABLED",
        });
        return;
      }
      // Stamp first-confirm + cooldown clock; client must call /double-confirm
      // after 3 seconds elapse on the returned cooldown_starts_at.
      const stamped = await markFirstConfirmHighRisk(id, adminReq.adminId);
      if (!stamped) {
        res.status(409).json({
          error: "تعذّر بدء التأكيد الأول",
          code: "COPILOT_PREVIEW_CONSUMED",
        });
        return;
      }
      res.json({
        outcome: "awaiting_double_confirm",
        preview_id: id,
        cooldown_starts_at: stamped.cooldownStartsAt.toISOString(),
        cooldown_ends_at: new Date(stamped.cooldownStartsAt.getTime() + 3000).toISOString(),
        cooldown_seconds: 3,
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
      case "first_confirm_missing":
      case "cooldown_not_elapsed":
        // Not reachable from the low-risk path, but the shared ExecuteOutcome
        // union covers them — surface a generic 409 instead of falling through.
        res.status(409).json({
          error: "حالة غير متوقعة من منفّذ التأكيد",
          code: "COPILOT_UNEXPECTED_STATE",
        });
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

// ────────────────────────────────────────────────────────────────────────
// POST /previews/:id/double-confirm  — high-risk execute after 3s cooldown
// ────────────────────────────────────────────────────────────────────────
previewsRouter.post(
  "/copilot/previews/:id/double-confirm",
  requireAdmin,
  requireCopilotPhase("phase3_enabled"),
  copilotRateLimit,
  async (req: Request, res: Response) => {
    const adminReq = req as AdminAuthenticatedRequest;
    const id = String(req.params.id ?? "");

    const flags = await getPhaseFlags();
    if (!flags.phase3_high_risk_enabled) {
      res.status(403).json({
        error: "تنفيذ العمليات عالية الخطورة غير مُفعَّل.",
        code: "COPILOT_HIGH_RISK_DISABLED",
      });
      return;
    }

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
    if (peek.riskTier !== "high") {
      res.status(409).json({
        error: "هذه المعاينة لا تتطلب تأكيداً ثانياً.",
        code: "COPILOT_NOT_HIGH_RISK",
      });
      return;
    }

    const outcome = await executeHighRiskDoubleConfirm({
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
      case "first_confirm_missing":
        res.status(409).json({
          error: "يجب تأكيد المعاينة أولاً قبل التأكيد الثاني.",
          code: "COPILOT_FIRST_CONFIRM_MISSING",
        });
        return;
      case "cooldown_not_elapsed": {
        const remainingMs = outcome.cooldownStartsAt.getTime() + 3000 - Date.now();
        res.status(425).json({
          error: "لم تنقضِ مدة الانتظار 3 ثوانٍ بعد.",
          code: "COPILOT_COOLDOWN_NOT_ELAPSED",
          cooldown_starts_at: outcome.cooldownStartsAt.toISOString(),
          remaining_ms: Math.max(0, remainingMs),
        });
        return;
      }
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
        res.status(409).json({
          error: "هذه المعاينة لا تتطلب تأكيداً ثانياً.",
          code: "COPILOT_NOT_HIGH_RISK",
        });
        return;
      case "not_found":
        res.status(404).json({ error: "المعاينة غير موجودة", code: "COPILOT_PREVIEW_NOT_FOUND" });
        return;
      case "failure":
        logger.error({ outcome, previewId: id }, "copilot high-risk execute failure");
        res
          .status(500)
          .json({ error: "فشل التنفيذ", code: "COPILOT_EXECUTE_FAILED", reason: outcome.reason });
        return;
    }
  },
);

export { previewsRouter as adminCopilotPreviewsRouter };