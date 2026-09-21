import { Router } from "express";

import { getClientInfo } from "../lib/auth-activity";
import { logger } from "../lib/logger";
import { scoreEventFireAndForget } from "../lib/risk-emit";
import * as Sentry from "@sentry/node";
import { isWhatsAppGatewayConfigured } from "../services/openwa.service";
import { startOtp, verifyOtp } from "../services/whatsapp-otp.service";
import { ErrorCode, createErrorResponse } from "../lib/errors";
import { getAuthCookieOptions } from "../lib/cookie-options";

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
 * Rate limiting (96-F1, R96-A4 §3.4 — app.ts:850-862): split per-path
 *   /start  → whatsappStartAuthLimiter  (20/15 min/IP — CGNAT-friendly)
 *   /verify → authLimiter                (10/15 min/IP — strict)
 *   (Do NOT blanket-mount `app.use("/api/auth/whatsapp", authLimiter)`
 *   — that re-stricts /start and re-creates the exact double-mount
 *   class 98-F3 fixed in app.ts.)
 * Replay/abuse:   in-orchestration (per-phone cooldown + hourly cap +
 *                 per-code attempt cap + post-verify consume).
 */
export const whatsappAuthRouter = Router();

/**
 * 98-F3 (R98-A4 P3-3 — mirror of R97-02): the raw user JWT is no longer
 * returned in the verify response body. The httpOnly `auth_token` cookie
 * set below is the sole session transport (requireUser reads the cookie
 * first); the body `token` field is kept as this SENTINEL so the SPA's
 * success-check (`if (!data.token)`) and `setToken(...)` keep working —
 * the value is truthy but carries no credential, and the frontend's
 * auth-token-holder filters it out of Authorization headers by exact
 * string match. Same value the boot probe and the other mint routes use
 * (routes/auth.ts, routes/auth-settings.ts).
 */
const COOKIE_SESSION_SENTINEL = "__cookie_session__";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/whatsapp/start
// ─────────────────────────────────────────────────────────────────────────────

whatsappAuthRouter.post("/whatsapp/start", async (req, res) => {
  try {
    if (!isWhatsAppGatewayConfigured()) {
      return res.status(503).json(
        createErrorResponse("خدمة WhatsApp غير مفعّلة حالياً", ErrorCode.SERVICE_UNAVAILABLE, {
          reason: "gateway_disabled",
        }),
      );
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const phone = typeof body.phone === "string" ? body.phone : "";
    if (!phone) {
      return res.status(400).json(createErrorResponse("رقم الهاتف مطلوب", ErrorCode.INVALID_DATA));
    }

    const client = getClientInfo(req);
    const result = await startOtp({
      rawPhone: phone,
      purpose: "registration",
      ipAddress: client.ipAddress,
      userAgent: client.userAgent,
    });

    // Risk pipeline (003-anomaly-detection) — fire-and-forget; gated on
    // RISK_PIPELINE_ENABLED inside scoreEvent, so this is a no-op for
    // operators who haven't flipped the flag yet.
    scoreEventFireAndForget({
      eventType: "otp_request",
      ipAddress: client.ipAddress ?? null,
      userAgent: client.userAgent ?? null,
      phone,
      ruleContext: {
        event: {
          eventType: "otp_request",
          ipAddress: client.ipAddress ?? null,
          userAgent: client.userAgent ?? null,
        },
      },
    });

    if (!result.ok) {
      const messages: Record<string, string> = {
        invalid_phone: "رقم الهاتف غير صالح",
        cooldown: "يرجى الانتظار قبل طلب رمز جديد",
        hourly_limit: "تم تجاوز حد المحاولات، حاول لاحقاً",
        delivery_failed: "تعذّر إرسال الرمز عبر WhatsApp، حاول مجدداً",
        recipient_not_on_whatsapp: "هذا الرقم غير مسجَّل في WhatsApp",
        // r95: the gateway is configured but the WhatsApp session is
        // unpaired (or dropped). Honest copy — an operator action is
        // pending on the session, not a client-fixable condition.
        whatsapp_not_paired: "قناة WhatsApp غير مربوطة مؤقتاً، جاري استعادة الخدمة",
        // 96-F1 (R96-A4 §1.3C): the session was JUST linked and is inside
        // the settle/warm-up window (the "Waiting for this message"
        // race). Honest copy + Retry-After so the client auto-retries
        // instead of burning a resend on an undecryptable dispatch.
        whatsapp_settling: "قناة WhatsApp ربطت للتو — تُهيَّأ الآن وتصبح جاهزة خلال أقل من دقيقة",
        // R102 (cold-wake, R102-B F3): the gateway service itself is
        // booting after a Render-Free idle sleep. Honest copy + 503 +
        // Retry-After — the client's settling auto-retry (max 2) rides
        // the wake instead of the user manually re-tapping a hard 502.
        gateway_waking:
          "جاري استيقاظ خدمة WhatsApp من السكون — ستُعاد المحاولة تلقائياً خلال لحظات",
        // 96-F1 (R96-A4 §4.2): the code WAS delivered but storing it
        // failed twice — 500 with a short cooldown instead of an instant
        // re-send that would deliver a SECOND WhatsApp message.
        store_failed: "تم إرسال الرمز لكن تعذّر حفظه، أعد المحاولة بعد قليل",
        gateway_disabled: "خدمة WhatsApp غير مفعّلة حالياً",
      };
      const status =
        result.reason === "invalid_phone" || result.reason === "recipient_not_on_whatsapp"
          ? 400
          : result.reason === "cooldown" || result.reason === "hourly_limit"
            ? 429
            : result.reason === "gateway_disabled" ||
                result.reason === "whatsapp_not_paired" ||
                // 96-F1: settling is a transient server-side state —
                // 503 + Retry-After is the honest mapping.
                result.reason === "whatsapp_settling" ||
                // R102: gateway cold-wake — same honest transient mapping.
                result.reason === "gateway_waking"
              ? 503
              : result.reason === "store_failed"
                ? 500
                : 502;
      // 96-F1: Retry-After (+ details.retry_after_sec) is emitted for every
      // reason that carries retryAfterSec — cooldown (pre-existing),
      // whatsapp_settling (ceil(readyInMs/1000)) and store_failed (30s short
      // cooldown so the client does not instantly re-send).
      const retryAfter = result.retryAfterSec;
      const headers: Record<string, string | number> = {};
      if (retryAfter) {
        headers["Retry-After"] = retryAfter;
      }
      res.set(headers as Record<string, string>);
      // AUD103-4-F5 (r103): the body code now classifies like the status
      // does — a typed client reading only `code` couldn't tell a
      // rate-limit from a gateway-down (everything was INVALID_DATA).
      const codeByReason: Partial<Record<string, ErrorCode>> = {
        cooldown: ErrorCode.RATE_LIMITED,
        hourly_limit: ErrorCode.RATE_LIMITED,
        gateway_disabled: ErrorCode.SERVICE_UNAVAILABLE,
        whatsapp_not_paired: ErrorCode.SERVICE_UNAVAILABLE,
        whatsapp_settling: ErrorCode.SERVICE_UNAVAILABLE,
        gateway_waking: ErrorCode.SERVICE_UNAVAILABLE,
        store_failed: ErrorCode.INTERNAL_ERROR,
      };
      const bodyCode = codeByReason[result.reason] ?? ErrorCode.INVALID_DATA;
      return res.status(status).json(
        createErrorResponse(messages[result.reason] ?? "تعذّر إرسال الرمز", bodyCode, {
          reason: result.reason,
          ...(retryAfter ? { retry_after_sec: retryAfter } : {}),
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

    // Risk pipeline — emit otp_verify whether successful or not. The
    // success path also doubles as login_success for new + returning users.
    const verifyEvent = result.ok ? "otp_verify" : "login_failure";
    scoreEventFireAndForget({
      eventType: verifyEvent,
      userId: result.ok ? (result.user?.id ?? null) : null,
      ipAddress: client.ipAddress ?? null,
      userAgent: client.userAgent ?? null,
      phone,
      ruleContext: {
        event: {
          eventType: verifyEvent,
          ipAddress: client.ipAddress ?? null,
          userAgent: client.userAgent ?? null,
        },
        user: result.ok && result.user ? { id: result.user.id } : undefined,
      },
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
        result.reason === "invalid_phone" ? 400 : result.reason === "exhausted" ? 429 : 401;
      return res
        .status(status)
        .json(
          createErrorResponse(
            messages[result.reason] ?? "فشل التحقق من الرمز",
            status === 400 ? ErrorCode.INVALID_DATA : ErrorCode.UNAUTHORIZED,
            { reason: result.reason },
          ),
        );
    }

    // Success — set httpOnly cookie + return the cookie-session sentinel
    // exactly the same way the Telegram/Firebase paths do. 30-day expiry
    // matches signUserToken. 98-F3 (see COOKIE_SESSION_SENTINEL above):
    // the body `token` is NOT the JWT — the cookie is the sole session
    // transport; the SPA's auth-token-holder filters the sentinel out of
    // Authorization headers.
    res.cookie("auth_token", result.token, {
      ...getAuthCookieOptions(30 * 24 * 60 * 60 * 1000),
    });

    return res.json({
      token: COOKIE_SESSION_SENTINEL,
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
