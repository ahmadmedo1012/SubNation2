/**
 * Operator session management over the OpenWA admin REST surface — the
 * admin half of the services/openwa/ package (R136 BE-2 decomposition
 * of services/openwa.service.ts; re-exported through the
 * openwa.service.ts facade for routes/admin/diagnostics.ts).
 *
 * These functions intentionally live behind the backend rather than
 * exposing WHATSAPP_OTP_API_KEY to a browser. The admin UI receives
 * only the gateway's public session metadata and the rendered QR
 * image/pairing code requested by an authenticated administrator.
 */
import {
  assertSessionId,
  gatewayJson,
  normalizeSession,
  readGatewayAuthConfig,
  sessionPath,
  WhatsAppGatewayError,
  type GatewayAuthConfig,
  type WhatsAppSessionRecord,
} from "./gateway-client";

// Re-exported for the facade's admin surface (the class + record shape
// physically live in gateway-client.ts, which owns the shared wire
// validators that throw them).
export { WhatsAppGatewayError, type WhatsAppSessionRecord } from "./gateway-client";

const ADMIN_SESSION_NAME_RE = /^[A-Za-z0-9-]{3,50}$/;
const E164_PHONE_RE = /^\d{10,15}$/;

function requireGatewayAdminConfig(): GatewayAuthConfig {
  const config = readGatewayAuthConfig();
  if (!config) throw new WhatsAppGatewayError("gateway_not_configured", 503);
  return config;
}

export async function listWhatsAppSessions(): Promise<WhatsAppSessionRecord[]> {
  const config = requireGatewayAdminConfig();
  const payload = await gatewayJson<unknown>(config, "/api/sessions");
  if (!Array.isArray(payload)) {
    throw new WhatsAppGatewayError("invalid_gateway_response", 502);
  }
  return payload.map(normalizeSession);
}

export async function createWhatsAppSession(name: string): Promise<WhatsAppSessionRecord> {
  const normalizedName = name.trim();
  if (!ADMIN_SESSION_NAME_RE.test(normalizedName)) {
    throw new WhatsAppGatewayError("invalid_session_name", 400);
  }
  const config = requireGatewayAdminConfig();
  const payload = await gatewayJson<unknown>(config, "/api/sessions", {
    method: "POST",
    body: JSON.stringify({ name: normalizedName }),
  });
  return normalizeSession(payload);
}

export async function startWhatsAppSession(sessionId: string): Promise<WhatsAppSessionRecord> {
  const config = requireGatewayAdminConfig();
  const id = assertSessionId(sessionId);
  const payload = await gatewayJson<unknown>(config, `${sessionPath(id)}/start`, {
    method: "POST",
  });
  return normalizeSession(payload);
}

export async function requestWhatsAppPairCode(
  sessionId: string,
  phone: string,
): Promise<{ session: WhatsAppSessionRecord; code: string }> {
  const normalizedPhone = phone.trim().replace(/^\+/, "");
  if (!E164_PHONE_RE.test(normalizedPhone)) {
    throw new WhatsAppGatewayError("invalid_phone", 400);
  }
  const config = requireGatewayAdminConfig();
  const id = assertSessionId(sessionId);
  const payload = await gatewayJson<unknown>(config, `${sessionPath(id)}/pair-code`, {
    method: "POST",
    body: JSON.stringify({ phone: normalizedPhone }),
  });
  if (!payload || typeof payload !== "object") {
    throw new WhatsAppGatewayError("invalid_gateway_response", 502);
  }
  const candidate = payload as Record<string, unknown>;
  if (typeof candidate.code !== "string") {
    throw new WhatsAppGatewayError("invalid_gateway_response", 502);
  }
  return { session: normalizeSession(payload), code: candidate.code };
}

export async function getWhatsAppSessionQr(
  sessionId: string,
): Promise<{ session: WhatsAppSessionRecord; qrImage: string | null }> {
  const config = requireGatewayAdminConfig();
  const id = assertSessionId(sessionId);
  const payload = await gatewayJson<unknown>(config, `${sessionPath(id)}/qr`, {
    headers: { Accept: "application/json" },
  });
  if (!payload || typeof payload !== "object") {
    throw new WhatsAppGatewayError("invalid_gateway_response", 502);
  }
  const candidate = payload as Record<string, unknown>;
  return {
    session: normalizeSession(payload),
    qrImage: typeof candidate.qrImage === "string" ? candidate.qrImage : null,
  };
}

export async function deleteWhatsAppSession(
  sessionId: string,
): Promise<{ deleted: true; id: string }> {
  const config = requireGatewayAdminConfig();
  const id = assertSessionId(sessionId);
  const payload = await gatewayJson<unknown>(config, sessionPath(id), { method: "DELETE" });
  if (
    !payload ||
    typeof payload !== "object" ||
    (payload as Record<string, unknown>).deleted !== true
  ) {
    throw new WhatsAppGatewayError("invalid_gateway_response", 502);
  }
  return { deleted: true, id };
}
