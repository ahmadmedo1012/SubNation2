/**
 * OpenWA gateway — thin REST client for sending WhatsApp text messages
 * against the real, session-aware OpenWA API.
 *
 * Boundaries (unchanged from the previous transport):
 *   - This module ONLY sends. It does not generate codes, does not
 *     hash, does not touch the DB, does not handle rate-limits.
 *     `services/whatsapp-otp.service.ts` is the orchestrator.
 *   - It reads OpenWA configuration ONLY from env. No secrets in code.
 *   - When the env is not set, `sendWhatsAppMessage` resolves with
 *     `{ ok: false, reason: "not_configured" }` rather than throwing.
 *     This makes local development & tests safe by default.
 *
 * Wire format — matches the real OpenWA REST surface (Swagger:
 *   http://localhost:2785/api/docs):
 *
 *   Auth:  header `X-API-Key: <KEY>` on every request.
 *
 *   Bootstrap (read-only / one-shot):
 *     GET  {baseUrl}/api/sessions
 *     GET  {baseUrl}/api/sessions/{id}                    → 200 | 404
 *     POST {baseUrl}/api/sessions       body: { name }
 *     POST {baseUrl}/api/sessions/{id}/start
 *     GET  {baseUrl}/api/sessions/{id}/qr                 (operator-only)
 *
 *   Send:
 *     POST {baseUrl}/api/sessions/{id}/messages/send-text
 *       body: { chatId: "<E164>@c.us", text: "…" }       maxLength 4096
 *
 *   A session reports one of:
 *     created | initializing | qr_ready | authenticating | ready
 *     | disconnected | failed
 *   Only `ready` is sendable.
 *
 * Env vars:
 *   WHATSAPP_OTP_BASE_URL   Full base URL of the OpenWA REST API,
 *                           e.g. http://127.0.0.1:2785
 *   WHATSAPP_OTP_API_KEY    The X-API-Key the OpenWA instance was
 *                           launched with. Treated as a secret —
 *                           never logged, never returned to clients.
 *   WHATSAPP_OTP_SESSION    Either the session id (`sess_…`) of an
 *                           existing OpenWA session, or a session
 *                           name (3–50 chars, alphanumeric + hyphens).
 *                           When a name is given and the session does
 *                           not exist yet, the gateway will create it
 *                           on first send and start it; an operator
 *                           still has to scan the QR via the OpenWA
 *                           dashboard ({baseUrl}/api/sessions/{id}/qr)
 *                           before the first OTP can flow.
 *   WHATSAPP_OTP_AUTO_CREATE_SESSION  Optional. When "1"/"true"/"yes"
 *                           (default), the gateway will auto-create &
 *                           start a missing session by name. When
 *                           explicitly disabled, missing sessions
 *                           surface as `session_not_found` so they
 *                           can be provisioned out-of-band.
 *
 * The function is defensive: any throw / non-2xx is captured and
 * returned as a typed failure so callers can decide between
 * surface-to-user (rate-limit hit) vs swallow (delivery soft-fail).
 */

import { logger } from "../lib/logger";

interface GatewayConfig {
  baseUrl: string;
  apiKey: string;
  /** Either an existing session id (`sess_…`) or a session name. */
  sessionRef: string;
  autoCreate: boolean;
}

function readGatewayConfig(): GatewayConfig | null {
  const baseUrl = (process.env.WHATSAPP_OTP_BASE_URL ?? "").trim().replace(/\/+$/, "");
  const apiKey = (process.env.WHATSAPP_OTP_API_KEY ?? "").trim();
  const sessionRef = (process.env.WHATSAPP_OTP_SESSION ?? "").trim();
  if (!baseUrl || !apiKey || !sessionRef) return null;

  const autoCreateRaw = (process.env.WHATSAPP_OTP_AUTO_CREATE_SESSION ?? "").trim().toLowerCase();
  // Default ON. Only disable when the operator explicitly opts out.
  const autoCreate = !["0", "false", "no", "off"].includes(autoCreateRaw);

  return { baseUrl, apiKey, sessionRef, autoCreate };
}

/**
 * Convert a normalized 9-digit Libyan local phone (e.g. "913456789")
 * into the OpenWA chat-id format (`<E164 without +>@c.us`).
 *
 * Libya country code is 218. The `users.phone` column already stores
 * the 9-digit local form, so we always prepend.
 *
 * Matches the format the real OpenWA expects (Swagger example
 * "628123456789@c.us" — same shape, just a different country code).
 */
export function buildChatId(normalizedPhone: string): string {
  return `218${normalizedPhone}@c.us`;
}

export type SendResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "not_configured"
        | "session_not_found"
        | "session_not_ready"
        | "recipient_not_on_whatsapp"
        | "request_failed"
        | "non_ok_status";
      /** HTTP status when `reason === "non_ok_status"`. */
      status?: number;
      /** OpenWA session lifecycle state when `reason === "session_not_ready"`. */
      sessionStatus?: string;
    };

// ─────────────────────────────────────────────────────────────────────────────
// Session bootstrap
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cached, ready-session id. Cleared as soon as any send call returns a
 * non-2xx; the next call will re-resolve via `ensureSession()`. The TTL
 * also caps how long a stale `ready` cache can hide a now-disconnected
 * session — important if WhatsApp drops the link mid-flight.
 */
const READY_CACHE_TTL_MS = 30_000;
let readySessionCache: { id: string; expiresAt: number } | null = null;

/** OpenWA session lifecycle states (from Swagger SessionResponseDto). */
type SessionStatus =
  | "created"
  | "initializing"
  | "qr_ready"
  | "authenticating"
  | "ready"
  | "disconnected"
  | "failed";

interface SessionRecord {
  id: string;
  name: string;
  status: SessionStatus;
}

const REQUEST_TIMEOUT_MS = 8_000;

function authHeaders(config: GatewayConfig): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-API-Key": config.apiKey,
  };
}

async function gatewayFetch(
  config: GatewayConfig,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers: { ...authHeaders(config), ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

/**
 * Treat the configured session ref as a session name only when it
 * satisfies the OpenWA `CreateSessionDto.name` constraint
 * (alphanumeric + hyphens, length 3-50). Anything else is either an
 * id we haven't seen before or a misconfiguration — in both cases we
 * refuse to auto-create.
 */
const SESSION_NAME_RE = /^[A-Za-z0-9-]{3,50}$/;
function looksLikeValidSessionName(value: string): boolean {
  return SESSION_NAME_RE.test(value);
}

async function findSession(
  config: GatewayConfig,
): Promise<SessionRecord | null> {
  // 1) Try the configured ref as an id (works for both `sess_…`-prefixed
  //    examples in the docs AND plain UUIDs the live API actually emits).
  const direct = await gatewayFetch(
    config,
    `/api/sessions/${encodeURIComponent(config.sessionRef)}`,
  );
  if (direct.ok) {
    return (await direct.json()) as SessionRecord;
  }
  if (direct.status !== 404) {
    // Read a small slice of the body so the log distinguishes
    // OpenWA JSON errors from Cloudflare HTML challenge / Access
    // block pages. Capped at 200 chars and stripped to printable
    // ASCII to keep the log line bounded and safe.
    const bodyPeek = await direct
      .text()
      .then((t) => t.slice(0, 200).replace(/[^\x20-\x7E]/g, "?"))
      .catch(() => "<unread>");
    logger.warn(
      {
        category: "whatsapp.gateway",
        status: direct.status,
        bodyPeek,
        sessionRef: config.sessionRef,
      },
      "[whatsapp-otp] session lookup non-2xx — body peek",
    );
    throw new Error(`session_lookup_${direct.status}`);
  }

  // 2) Fall back to listing and matching by name. The live API does not
  //    accept names in the {id} path, so this is the only way to resolve
  //    a name-style configuration.
  const list = await gatewayFetch(config, "/api/sessions");
  if (!list.ok) throw new Error(`session_list_${list.status}`);
  const sessions = (await list.json()) as SessionRecord[];
  return sessions.find((s) => s.name === config.sessionRef) ?? null;
}

async function createAndStartSession(
  config: GatewayConfig,
): Promise<SessionRecord> {
  const createRes = await gatewayFetch(config, "/api/sessions", {
    method: "POST",
    body: JSON.stringify({ name: config.sessionRef }),
  });
  if (!createRes.ok) {
    throw new Error(`session_create_${createRes.status}`);
  }
  const created = (await createRes.json()) as SessionRecord;

  // Best-effort start. If the session is already starting from a previous
  // run, the API typically responds 2xx with the current status; we don't
  // hard-fail here.
  await gatewayFetch(config, `/api/sessions/${encodeURIComponent(created.id)}/start`, {
    method: "POST",
  }).catch(() => undefined);

  // Re-fetch to surface the current status (will usually be qr_ready or
  // initializing — operator must scan via the dashboard).
  const after = await gatewayFetch(
    config,
    `/api/sessions/${encodeURIComponent(created.id)}`,
  );
  if (after.ok) {
    return (await after.json()) as SessionRecord;
  }
  return created;
}

/**
 * Resolve the configured session to a `ready` id, bootstrapping or
 * restarting as needed. Returns a typed failure when the session
 * exists but is not yet usable.
 *
 * Cached for {@link READY_CACHE_TTL_MS} on success.
 */
async function ensureSession(
  config: GatewayConfig,
): Promise<{ ok: true; id: string } | Extract<SendResult, { ok: false }>> {
  const now = Date.now();
  if (readySessionCache && readySessionCache.expiresAt > now) {
    return { ok: true, id: readySessionCache.id };
  }

  let session: SessionRecord | null;
  try {
    session = await findSession(config);
  } catch (err) {
    logger.warn(
      {
        category: "whatsapp.gateway",
        err: err instanceof Error ? err.message : String(err),
      },
      "[whatsapp-otp] session lookup failed",
    );
    return { ok: false, reason: "request_failed" };
  }

  if (!session) {
    if (config.autoCreate && looksLikeValidSessionName(config.sessionRef)) {
      try {
        session = await createAndStartSession(config);
        logger.info(
          {
            category: "whatsapp.gateway",
            sessionId: session.id,
            sessionName: session.name,
            status: session.status,
          },
          "[whatsapp-otp] bootstrapped new OpenWA session (operator must scan QR)",
        );
      } catch (err) {
        logger.warn(
          {
            category: "whatsapp.gateway",
            err: err instanceof Error ? err.message : String(err),
          },
          "[whatsapp-otp] session create/start failed",
        );
        return { ok: false, reason: "request_failed" };
      }
    } else {
      logger.warn(
        { category: "whatsapp.gateway" },
        "[whatsapp-otp] configured session not found",
      );
      return { ok: false, reason: "session_not_found" };
    }
  }

  if (session.status !== "ready") {
    // Try to nudge a disconnected/failed session back to life — but
    // don't block the OTP attempt waiting for the QR scan.
    if (session.status === "disconnected" || session.status === "failed" || session.status === "created") {
      await gatewayFetch(
        config,
        `/api/sessions/${encodeURIComponent(session.id)}/start`,
        { method: "POST" },
      ).catch(() => undefined);
    }
    logger.warn(
      {
        category: "whatsapp.gateway",
        sessionId: session.id,
        sessionName: session.name,
        status: session.status,
      },
      "[whatsapp-otp] session not ready (operator must scan QR via dashboard)",
    );
    return {
      ok: false,
      reason: "session_not_ready",
      sessionStatus: session.status,
    };
  }

  readySessionCache = { id: session.id, expiresAt: now + READY_CACHE_TTL_MS };
  return { ok: true, id: session.id };
}

// ─────────────────────────────────────────────────────────────────────────────
// Recipient preflight (LID resolution)
// ─────────────────────────────────────────────────────────────────────────────
//
// whatsapp-web.js — the engine OpenWA wraps — runs WhatsApp's Multi-Device
// protocol, which maps every recipient to a Linked Identity (LID) and
// requires that mapping to exist before `sendMessage()`. For a fresh
// session that has never seen a given phone, the local LID store is empty
// and `sendMessage()` throws "No LID for user". OpenWA surfaces that as
// a 500 from `POST /messages/send-text`.
//
// The fix is the canonical one: call `GET /contacts/check/{number}` first.
// That endpoint hits WhatsApp's "is this number on WhatsApp?" lookup,
// which populates the engine's LID cache as a side effect. The subsequent
// `send-text` then succeeds.
//
// We use this for two purposes:
//   1. LID resolution side-effect (the actual fix).
//   2. Fail-fast UX: when the recipient isn't on WhatsApp at all, return
//      `recipient_not_on_whatsapp` instead of consuming a hash row + a
//      rate-limit slot on a delivery that can never succeed.
//
// Failures of the preflight itself (HTTP 5xx, network) are NOT fatal —
// some networks may transient-fail the check while the actual send still
// works. We log the failure and fall through to the send anyway.

interface PreflightResult {
  /** `true` if WhatsApp confirms the number is registered. */
  exists: boolean;
}

/**
 * Call OpenWA's preflight check. Returns `null` on any HTTP/network
 * failure so callers can fall back to attempting send-text directly.
 */
async function preflightCheckNumber(
  config: GatewayConfig,
  sessionId: string,
  digitsOnly: string,
): Promise<PreflightResult | null> {
  try {
    const res = await gatewayFetch(
      config,
      `/api/sessions/${encodeURIComponent(sessionId)}/contacts/check/${encodeURIComponent(digitsOnly)}`,
    );
    if (!res.ok) {
      logger.warn(
        { category: "whatsapp.gateway", status: res.status },
        "[whatsapp-otp] preflight non-2xx — falling through to send",
      );
      return null;
    }
    const body = (await res.json().catch(() => null)) as
      | { exists?: boolean }
      | null;
    if (!body || typeof body.exists !== "boolean") return null;
    return { exists: body.exists };
  } catch (err) {
    logger.warn(
      {
        category: "whatsapp.gateway",
        err: err instanceof Error ? err.message : String(err),
      },
      "[whatsapp-otp] preflight request failed — falling through to send",
    );
    return null;
  }
}

/**
 * Extract the digits-only form of a chatId for the preflight URL.
 * `218913456789@c.us` → `218913456789`. The preflight endpoint is
 * documented as expecting digits only; passing the full `<num>@c.us`
 * causes the server to double-suffix in its response (observed live).
 */
function chatIdToDigits(chatId: string): string {
  const at = chatId.indexOf("@");
  return at >= 0 ? chatId.slice(0, at) : chatId;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public send
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Send a WhatsApp text message via OpenWA.
 *
 * SECURITY:
 *   - The X-API-Key header is set ONLY here, never logged, never echoed.
 *   - The `text` payload may contain the OTP — it is NEVER logged,
 *     even on failure (the logger calls below intentionally omit it).
 *   - On failure, only the chatId + HTTP status are recorded; the
 *     full response body is dropped on the floor for the same reason.
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

  const session = await ensureSession(config);
  if (!session.ok) return session;

  // Preflight: resolves the recipient's LID in the engine cache (the
  // actual fix for "No LID for user") and gives us a fail-fast signal
  // when the number isn't registered on WhatsApp at all. A failed
  // preflight (HTTP 5xx / network) is not fatal — we proceed to the
  // send and let it surface its own error if any.
  const digits = chatIdToDigits(chatId);
  const preflight = await preflightCheckNumber(config, session.id, digits);
  if (preflight && !preflight.exists) {
    logger.warn(
      { category: "whatsapp.gateway", chatId },
      "[whatsapp-otp] recipient is not registered on WhatsApp",
    );
    return { ok: false, reason: "recipient_not_on_whatsapp" };
  }

  try {
    const res = await gatewayFetch(
      config,
      `/api/sessions/${encodeURIComponent(session.id)}/messages/send-text`,
      {
        method: "POST",
        body: JSON.stringify({ chatId, text }),
      },
    );
    if (!res.ok) {
      // Invalidate the ready cache so a transient session flap forces
      // a re-bootstrap on the next attempt rather than wedging on a
      // stale id.
      readySessionCache = null;
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
    readySessionCache = null;
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

/**
 * Test seam — clears the in-memory ready-session cache. Not part of
 * the public contract; exported only so unit tests / hot-reload can
 * force a re-bootstrap.
 *
 * @internal
 */
export function __resetWhatsAppGatewayCacheForTests(): void {
  readySessionCache = null;
}
