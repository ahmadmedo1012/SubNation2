/**
 * OpenWA gateway — thin REST client for sending WhatsApp text messages.
 *
 * Boundaries:
 *   - This module ONLY sends. It does not generate codes, does not
 *     hash, does not touch the DB, does not handle rate-limits.
 *     `services/whatsapp-otp.service.ts` is the orchestrator.
 *   - It reads OpenWA configuration ONLY from env (per the brief —
 *     "Use the provided API key through environment variables or
 *     secure config only. Do not hardcode secrets.").
 *   - When the env is not set, `sendWhatsAppMessage` resolves with
 *     `{ ok: false, reason: "not_configured" }` rather than throwing.
 *     This makes local development & tests safe by default — the
 *     OTP machinery short-circuits at the audit-log layer when the
 *     gateway is offline rather than returning 500s.
 *
 * Env vars (operator sets at deploy time):
 *   WHATSAPP_OTP_BASE_URL    Full base URL of the OpenWA REST API,
 *                            e.g. http://127.0.0.1:8002 or
 *                            https://wa.example.com
 *   WHATSAPP_OTP_API_KEY     The api_key the OpenWA instance was
 *                            launched with. Treated as a secret —
 *                            never logged, never returned to clients,
 *                            never appears in error messages.
 *
 * Wire format (matches the standard OpenWA REST surface):
 *   POST {baseUrl}/sendText
 *     Headers: api_key: <KEY>
 *     Body:    { chatId: "<E164>@c.us", message: "..." }
 *     Returns: 200 with `{ success: true, ... }` on delivery,
 *              non-2xx on failure.
 */

import { logger } from "../lib/logger";

interface GatewayConfig {
  baseUrl: string;
  apiKey: string;
}

function readGatewayConfig(): GatewayConfig | null {
  const baseUrl = (process.env.WHATSAPP_OTP_BASE_URL ?? "").trim().replace(/\/+$/, "");
  const apiKey = (process.env.WHATSAPP_OTP_API_KEY ?? "").trim();
  if (!baseUrl || !apiKey) return null;
  return { baseUrl, apiKey };
}

/**
 * Convert a normalized 9-digit Libyan local phone (e.g. "913456789")
 * into the OpenWA chat-id format (`<E164 without +>@c.us`).
 *
 * Libya country code is 218. The `users.phone` column already stores
 * the 9-digit local form, so we always prepend.
 */
export function buildChatId(normalizedPhone: string): string {
  return `218${normalizedPhone}@c.us`;
}

export type SendResult =
  | { ok: true }
  | { ok: false; reason: "not_configured" | "request_failed" | "non_ok_status"; status?: number };

/**
 * Send a WhatsApp text message via OpenWA.
 *
 * SECURITY:
 *   - The api_key header is set ONLY here, never logged, never echoed.
 *   - The `text` payload may contain the OTP — it is NEVER logged,
 *     even on failure (the logger calls below intentionally omit it).
 *   - On failure, only the chatId + HTTP status are recorded; the
 *     full response body is dropped on the floor for the same reason.
 *
 * The function is defensive: any throw / non-2xx is captured and
 * returned as a typed failure so callers can decide between
 * surface-to-user (rate-limit hit) vs swallow (delivery soft-fail).
 */
export async function sendWhatsAppMessage(
  chatId: string,
  text: string,
): Promise<SendResult> {
  const config = readGatewayConfig();
  if (!config) {
    logger.warn(
      { category: "whatsapp.gateway" },
      "[whatsapp-otp] gateway not configured; OTP not delivered",
    );
    return { ok: false, reason: "not_configured" };
  }

  try {
    const res = await fetch(`${config.baseUrl}/sendText`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        api_key: config.apiKey,
      },
      body: JSON.stringify({ chatId, message: text }),
      // 8 s should be plenty — OpenWA's local instance responds in ~50ms.
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      // NOTE: deliberately NOT reading the body — keeps error log free
      // of any hint of the OTP if the gateway echoes it back.
      logger.warn(
        { category: "whatsapp.gateway", chatId, status: res.status },
        "[whatsapp-otp] gateway non-2xx",
      );
      return { ok: false, reason: "non_ok_status", status: res.status };
    }
    return { ok: true };
  } catch (err) {
    logger.warn(
      {
        category: "whatsapp.gateway",
        chatId,
        err: err instanceof Error ? err.message : String(err),
      },
      "[whatsapp-otp] gateway request failed",
    );
    return { ok: false, reason: "request_failed" };
  }
}

/** Probe used by `/api/auth/providers` and admin diagnostics. */
export function isWhatsAppGatewayConfigured(): boolean {
  return readGatewayConfig() !== null;
}
