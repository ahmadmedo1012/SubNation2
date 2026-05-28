import { Router } from "express";

import { getClientInfo } from "../lib/auth-activity";
import { logger } from "../lib/logger";
import * as Sentry from "@sentry/node";
import { isWhatsAppGatewayConfigured } from "../services/openwa.service";
import { startOtp, verifyOtp } from "../services/whatsapp-otp.service";
import { ErrorCode, createErrorResponse } from "../lib/errors";

/**
 * WhatsApp OTP — public auth router.
 *
 *   POST /api/auth/whatsapp/start
 *   POST /api/auth/whatsapp/verify
 *
 * Phase 1 wires the `registration` purpose. Login + 2FA reuse the
 * same machinery in later phases — the orchestration service already
 * accepts those purposes; only this router needs to be extended when
 * those phases ship.
 *
 * Rate limiting:  applied via `app.use("/api/auth/whatsapp", authLimiter)`
 * Replay/abuse:   in-orchestration (per-phone cooldown + hourly cap +
 *                 per-code attempt cap + post-verify consume).
 */
export const whatsappAuthRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/whatsapp/start
// ─────────────────────────────────────────────────────────────────────────────

whatsappAuthRouter.post("/whatsapp/start", async (req, res) => {
  try {
    if (!isWhatsAppGatewayConfigured()) {
      return res
        .status(503)
        .json(
          createErrorResponse(
            "خدمة WhatsApp غير مفعّلة حالياً",
            ErrorCode.SERVICE_UNAVAILABLE,
            { reason: "gateway_disabled" },
          ),
        );
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const phone = typeof body.phone === "string" ? body.phone : "";
    if (!phone) {
      return res
        .status(400)
        .json(createErrorResponse("رقم الهاتف مطلوب", ErrorCode.INVALID_DATA));
    }

    const client = getClientInfo(req);
    const result = await startOtp({
      rawPhone: phone,
      purpose: "registration",
      ipAddress: client.ipAddress,
      userAgent: client.userAgent,
    });

    if (!result.ok) {
      const messages: Record<string, string> = {
        invalid_phone: "رقم الهاتف غير صالح",
        cooldown: "يرجى الانتظار قبل طلب رمز جديد",
        hourly_limit: "تم تجاوز حد المحاولات، حاول لاحقاً",
        delivery_failed: "تعذّر إرسال الرمز عبر WhatsApp، حاول مجدداً",
        gateway_disabled: "خدمة WhatsApp غير مفعّلة حالياً",
      };
      const status =
        result.reason === "invalid_phone"
          ? 400
          : result.reason === "cooldown" || result.reason === "hourly_limit"
            ? 429
            : result.reason === "gateway_disabled"
              ? 503
              : 502;
      const headers: Record<string, string | number> = {};
      if (result.reason === "cooldown" && result.retryAfterSec) {
        headers["Retry-After"] = result.retryAfterSec;
      }
      res.set(headers as Record<string, string>);
      return res.status(status).json(
        createErrorResponse(messages[result.reason] ?? "تعذّر إرسال الرمز", ErrorCode.INVALID_DATA, {
          reason: result.reason,
          ...(result.reason === "cooldown" && result.retryAfterSec
            ? { retry_after_sec: result.retryAfterSec }
            : {}),
        }),
      );
    }

    return res.json({
      success: true,
      // Expiry is the only piece of OTP-related metadata the client
      // needs — never the code itself.
      expires_at: result.expiresAt.toISOString(),
    });
  } catch (err) {
    Sentry.captureException(err);
    logger.error(
      { category: "auth.whatsapp", err: err instanceof Error ? err.message : String(err) },
      "[whatsapp-otp] start: internal error",
    );
    return res.status(500).json(
      createErrorResponse("حدث خطأ، حاول مجدداً", ErrorCode.INTERNAL_ERROR, {
        reason: "server_error",
      }),
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/whatsapp/verify
// ─────────────────────────────────────────────────────────────────────────────

whatsappAuthRouter.post("/whatsapp/verify", async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const phone = typeof body.phone === "string" ? body.phone : "";
    const code = typeof body.code === "string" ? body.code : "";
    const referralCode =
      typeof body.referralCode === "string"
        ? body.referralCode.trim().toUpperCase().slice(0, 16) || undefined
        : undefined;

    if (!phone || !code) {
      return res
        .status(400)
        .json(createErrorResponse("رقم الهاتف والرمز مطلوبان", ErrorCode.INVALID_DATA));
    }

    const client = getClientInfo(req);
    const result = await verifyOtp({
      rawPhone: phone,
      code,
      purpose: "registration",
      referralCode,
      ipAddress: client.ipAddress,
      userAgent: client.userAgent,
    });

    if (!result.ok) {
      const messages: Record<string, string> = {
        invalid_phone: "رقم الهاتف غير صالح",
        no_active_code: "لا يوجد رمز فعّال لهذا الرقم",
        consumed: "تم استخدام هذا الرمز بالفعل",
        expired: "انتهت صلاحية الرمز",
        exhausted: "عدد كبير من المحاولات الخاطئة، اطلب رمزاً جديداً",
        mismatch: "الرمز غير صحيح",
      };
      const status =
        result.reason === "invalid_phone"
          ? 400
          : result.reason === "exhausted"
            ? 429
            : 401;
      return res.status(status).json(
        createErrorResponse(
          messages[result.reason] ?? "فشل التحقق من الرمز",
          status === 400 ? ErrorCode.INVALID_DATA : ErrorCode.UNAUTHORIZED,
          { reason: result.reason },
        ),
      );
    }

    // Success — set httpOnly cookie + return JWT exactly the same way
    // the Telegram/Firebase paths do. 30-day expiry matches signUserToken.
    res.cookie("auth_token", result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: "/",
    });

    return res.json({
      token: result.token,
      is_new_user: result.isNewUser,
    });
  } catch (err) {
    Sentry.captureException(err);
    logger.error(
      { category: "auth.whatsapp", err: err instanceof Error ? err.message : String(err) },
      "[whatsapp-otp] verify: internal error",
    );
    return res.status(500).json(
      createErrorResponse("حدث خطأ، حاول مجدداً", ErrorCode.INTERNAL_ERROR, {
        reason: "server_error",
      }),
    );
  }
});
