/**
 * OpenWA gateway — thin REST client for sending WhatsApp text messages
 * against the real, session-aware OpenWA API.
 *
 * R136 (BE-2) decomposition: this module is now the FACADE of the
 * services/openwa/ package — it owns the send path (LID preflight,
 * the retrying send core, sendWhatsAppMessage), the readiness probe +
 * its 30 s cache, and the gateway cache state; everything else moved
 * to sibling modules re-exported below so existing importers (the
 * whatsapp-otp orchestrator, routes, and the openwa test suites) keep
 * working unedited:
 *
 *   services/openwa/gateway-client.ts  env config readers, session wire
 *                                      types, X-API-Key fetch helpers,
 *                                      session bootstrap, admin-wire
 *                                      validators + WhatsAppGatewayError
 *   services/openwa/settle-gate.ts     96-F1 post-link settle gate +
 *                                      97-F3 epoch re-arm + warm-up
 *                                      self-check (maps + test seams)
 *   services/openwa/admin-sessions.ts  operator session management
 *                                      (list/create/start/pair-code/QR/
 *                                      delete)
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
 *   WHATSAPP_OTP_SETTLE_MS  96-F1 (R96-A4 §1.3A): post-link settle
 *                           window in ms before a freshly-paired
 *                           session may dispatch (default 45 000,
 *                           clamped 0–300 000). Kills the "Waiting
 *                           for this message" race.
 *   WHATSAPP_OTP_OPERATOR_E164  96-F1 (R96-A4 §1.3B): the operator's
 *                           own linked number (E164 digits, optional
 *                           leading `+`). When set, a benign Arabic
 *                           warm-up self-check must DELIVER to this
 *                           number before OTP dispatch is enabled, and
 *                           repeats every 6 h. Unset → warm-up disabled
 *                           (settle gate alone).
 *
 * The function is defensive: any throw / non-2xx is captured and
 * returned as a typed failure so callers can decide between
 * surface-to-user (rate-limit hit) vs swallow (delivery soft-fail).
 */

import { logger } from "../lib/logger";
// 2026-09-20 free-infrastructure round: the channel-death watch is fed
// by REAL observations (readiness probes + OTP send attempts) instead
// of a 60 s interval timer. One-way dependency — whatsapp-watch imports
// nothing from this module, so no cycle.
import { observeWhatsAppChannel } from "./whatsapp-watch";
import {
  createAndStartSession,
  findSession,
  gatewayFetch,
  looksLikeValidSessionName,
  readGatewayConfig,
  type GatewayConfig,
  type SendResult,
  type SessionRecord,
} from "./openwa/gateway-client";
import {
  WARMUP_PENDING_ESTIMATE_MS,
  __resetSettleGateStateForTests,
  bindWarmupSendFn,
  gateKeyForSession,
  isWarmupOk,
  observeSendFailure,
  recordReadySince,
  registerGatewayCacheBuster,
  scheduleInitialWarmup,
  sendFailureWatchStatus,
  settleRemainingMs,
} from "./openwa/settle-gate";

// ── Re-export surface (decomposition contract) ───────────────────────────
// Every symbol the pre-R136 openwa.service.ts exported stays importable
// from this module — routes/admin/diagnostics.ts, the whatsapp-otp
// orchestrator and the openwa/whatsapp test suites keep working unedited.
export { POST_LINK_SETTLE_MS, __whatsappSettleGateTest } from "./openwa/settle-gate";
export { __resetSettleGateStateForTests } from "./openwa/settle-gate";
export { type SendResult } from "./openwa/gateway-client";
export {
  WhatsAppGatewayError,
  createWhatsAppSession,
  deleteWhatsAppSession,
  getWhatsAppSessionQr,
  listWhatsAppSessions,
  requestWhatsAppPairCode,
  startWhatsAppSession,
  type WhatsAppSessionRecord,
} from "./openwa/admin-sessions";

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

// ─────────────────────────────────────────────────────────────────────────────
// Session bootstrap (send-path half)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cached, ready-session id. Cleared as soon as any send call returns a
 * non-2xx; the next call will re-resolve via `ensureSession()`. The TTL
 * also caps how long a stale `ready` cache can hide a now-disconnected
 * session — important if WhatsApp drops the link mid-flight.
 */
const READY_CACHE_TTL_MS = 30_000;
let readySessionCache: { id: string; expiresAt: number } | null = null;

/** Bounded in-request wait inside the OTP send path (§1.3A): one honest
 *  spinner beats a 503 round-trip, but no request may hang for the whole
 *  window. */
const SETTLE_WAIT_CAP_MS = 20_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Facade wiring for the settle-gate module (R136) ────────────────────────
//
// settle-gate.ts owns the epoch bookkeeping but must not import the send
// path (cycle). Two one-way hooks close the loop:
//   1. the warm-up cycle's SEND CORE (sendTextWithRetry with
//      skipWarmupGate — the self-check bypasses the warm-up gate,
//      chicken-and-egg);
//   2. the cache buster — a re-pair / fresh ready observation busts BOTH
//      facade-owned caches (the send-path ready cache above and the
//      readiness probe cache below), exactly as the pre-decomposition
//      rearmGateOnEpochChange / recordReadySince inline code did.
registerGatewayCacheBuster(() => {
  readySessionCache = null;
  readinessCache = null;
});
bindWarmupSendFn((config, sessionId, chatId, text) =>
  sendTextWithRetry(config, sessionId, chatId, text, { skipWarmupGate: true }),
);

/**
 * Resolve the configured session to a `ready` id, bootstrapping or
 * restarting as needed. Returns a typed failure when the session
 * exists but is not yet usable.
 *
 * 96-F1 (R96-A4 §1.3A): a `ready` status additionally requires the
 * post-link settle window to have elapsed AND (when the operator number
 * is configured) a successful warm-up self-check — see the settle-gate
 * module. `skipWarmupGate` lets the warm-up send itself pass with
 * the settle gate alone (chicken-and-egg).
 *
 * Cached for {@link READY_CACHE_TTL_MS} on success.
 */
async function ensureSession(
  config: GatewayConfig,
  opts: { skipWarmupGate?: boolean } = {},
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
      logger.warn({ category: "whatsapp.gateway" }, "[whatsapp-otp] configured session not found");
      return { ok: false, reason: "session_not_found" };
    }
  }

  if (session.status !== "ready") {
    // Try to nudge a disconnected/failed session back to life — but
    // don't block the OTP attempt waiting for the QR scan.
    if (
      session.status === "disconnected" ||
      session.status === "failed" ||
      session.status === "created"
    ) {
      await gatewayFetch(config, `/api/sessions/${encodeURIComponent(session.id)}/start`, {
        method: "POST",
      }).catch(() => undefined);
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

  // 96-F1 (R96-A4 §1.3A): settle gate — `ready` from OpenWA means the
  // companion device authenticated, NOT that multi-device key
  // distribution has propagated. First observation is recorded (memory
  // + Redis mirror) and dispatch is refused until the window elapses;
  // with an operator number configured, a delivered warm-up self-check
  // is additionally required before dispatch.
  const readySince = await recordReadySince(session);
  const remainingMs = settleRemainingMs(readySince);
  const settled = remainingMs === 0;
  const warmed = opts.skipWarmupGate === true || isWarmupOk(session);
  if (!settled || !warmed) {
    // B5-1 (R111): idempotent re-arm of the one-shot warm-up. The ONLY
    // pre-R111 re-schedule site was recordReadySince's first-observation
    // branch, whose `known !== undefined` early-return meant that once
    // the one-shot timer had fired and its self-check transiently
    // failed, NO later attempt could ever re-schedule it — with
    // WHATSAPP_OTP_OPERATOR_E164 set, every subsequent OTP answered
    // session_settling until process restart (permanent on an
    // always-on host; only a Render sleep/self-heal cleared it).
    // scheduleInitialWarmup no-ops while a warm-up is pending or the
    // epoch is already warm, so this is a pure re-arm on the send path.
    scheduleInitialWarmup(gateKeyForSession(session), readySince);
    return {
      ok: false,
      reason: "session_settling",
      readyInMs: settled ? WARMUP_PENDING_ESTIMATE_MS : Math.max(1, remainingMs),
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
    const body = (await res.json().catch(() => null)) as { exists?: boolean } | null;
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

/**
 * F9 (R98-A6, 98-F5): mask a phone-bearing chatId for LOG output only —
 * `218913456789@c.us` → `21891…6789@c.us`. Render's retained log stream
 * accumulated full user phone numbers on every gateway hiccup (the OTP
 * path = every login attempt during channel trouble); pino's redact list
 * has no chatId path. Prefix+suffix keeps entries correlatable across
 * lines. The wire payload and DB writes keep the FULL value — only the
 * log call sites change. Exported for tests (buildChatId precedent).
 */
export function maskChatId(chatId: string): string {
  const at = chatId.indexOf("@");
  const digits = at >= 0 ? chatId.slice(0, at) : chatId;
  const domain = at >= 0 ? chatId.slice(at) : "";
  if (digits.length <= 9) return chatId; // too short to mask meaningfully
  return `${digits.slice(0, 5)}…${digits.slice(-4)}${domain}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public send
// ─────────────────────────────────────────────────────────────────────────────

// 96-F1 (R96-A4 §1.3D): send resilience — POST send-text retried up to
// 3 attempts with 1.5 s → 4 s backoff, ONLY on network errors / 5xx /
// timeout. A 4xx is a real rejection (bad chatId, engine refusal) and is
// never retried; re-running ensureSession() between attempts re-resolves
// a session that flapped (the ready cache is invalidated on every failure).
const SEND_MAX_ATTEMPTS = 3;
const SEND_RETRY_BACKOFF_MS: readonly number[] = [1_500, 4_000];

function isRetryableSendFailure(result: SendResult): boolean {
  if (result.ok) return false;
  if (result.reason === "request_failed") return true; // network error / timeout
  if (result.reason !== "non_ok_status") return false;
  // 5xx from a ready session = transient gateway flap (free-tier cold
  // start included). 4xx (400/404/…) is a definitive rejection.
  if ((result.status ?? 0) >= 500) return true;
  // B5-4 (R111): a 409 is the gateway's "session_not_ready at send
  // time" answer ({ error: "session_not_ready" } — openwa index.ts)
  // when the session flips off `ready` BETWEEN our ensureSession check
  // and the dispatch (cold-boot restore, mid-boot reconnect). It is a
  // flap, not a rejection: the ensureSession re-check between attempts
  // re-resolves/nudges the session, and a persistent flap surfaces the
  // honest not-ready/settling verdict from the recheck itself.
  return result.status === 409;
}

/**
 * The retrying send core shared by the OTP dispatch and the warm-up
 * self-check. `opts.skipWarmupGate` is passed through to the mid-retry
 * ensureSession() re-check (the warm-up send itself must not require
 * warmup-ok — chicken-and-egg).
 */
async function sendTextWithRetry(
  config: GatewayConfig,
  sessionId: string,
  chatId: string,
  text: string,
  opts: { skipWarmupGate?: boolean } = {},
): Promise<SendResult> {
  let currentSessionId = sessionId;
  for (let attempt = 1; ; attempt++) {
    let result: SendResult;
    try {
      const res = await gatewayFetch(
        config,
        `/api/sessions/${encodeURIComponent(currentSessionId)}/messages/send-text`,
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
        // F9: chatId masked in the log — full value never reaches stdout.
        logger.warn(
          { category: "whatsapp.gateway", chatId: maskChatId(chatId), status: res.status, attempt },
          "[whatsapp-otp] gateway non-2xx",
        );
        result = { ok: false, reason: "non_ok_status", status: res.status };
      } else {
        result = { ok: true };
      }
    } catch (err) {
      readySessionCache = null;
      logger.warn(
        {
          category: "whatsapp.gateway",
          chatId: maskChatId(chatId), // F9 — phone PII never reaches stdout
          attempt,
          err: err instanceof Error ? err.message : String(err),
        },
        "[whatsapp-otp] gateway request failed",
      );
      result = { ok: false, reason: "request_failed" };
    }

    if (result.ok || attempt >= SEND_MAX_ATTEMPTS || !isRetryableSendFailure(result)) {
      return result;
    }

    await sleep(
      SEND_RETRY_BACKOFF_MS[attempt - 1] ?? SEND_RETRY_BACKOFF_MS[SEND_RETRY_BACKOFF_MS.length - 1],
    );

    // §1.3D: re-run ensureSession() between attempts — the ready cache was
    // invalidated by the failure above, so this re-resolves the session
    // (and can nudge a flapped one back to life) before the next attempt.
    // A failed re-check is returned as-is (an honest verdict beats a
    // doomed send attempt into a dead session).
    const recheck = await ensureSession(config, opts);
    if (!recheck.ok) return recheck;
    currentSessionId = recheck.id;
  }
}

/**
 * Send a WhatsApp text message via OpenWA.
 *
 * SECURITY:
 *   - The X-API-Key header is set ONLY here, never logged, never echoed.
 *   - The `text` payload may contain the OTP — it is NEVER logged,
 *     even on failure (the logger calls below intentionally omit it).
 *   - On failure, only the chatId + HTTP status are recorded; the
 *     full response body is dropped on the floor for the same reason.
 *
 * 96-F1 (R96-A4 §1.3A bounded wait): when the session is ready but still
 * settling, await the REMAINING settle window capped at 20 s before
 * giving up with `session_settling` — the first OTP after linking then
 * rides out the window inside one request (one honest spinner) instead
 * of a 503 round-trip. Network/5xx failures retry inside
 * {@link sendTextWithRetry}.
 */
export async function sendWhatsAppMessage(chatId: string, text: string): Promise<SendResult> {
  const config = readGatewayConfig();
  if (!config) {
    logger.warn(
      { category: "whatsapp.gateway" },
      "[whatsapp-otp] gateway not configured; OTP not delivered",
    );
    return { ok: false, reason: "not_configured" };
  }

  let session = await ensureSession(config);
  if (!session.ok && session.reason === "session_settling") {
    const waitMs = Math.min(Math.max(session.readyInMs ?? 0, 0), SETTLE_WAIT_CAP_MS);
    if (waitMs > 0) {
      await sleep(waitMs);
      session = await ensureSession(config);
    }
  }
  if (!session.ok) {
    // 2026-09-20: a user's REAL OTP attempt against a
    // dead/unreachable channel is the strongest channel-health
    // observation there is — feed the death watch (this replaces the
    // old 60 s watcher timer). session_settling is healthy (a WORKING
    // channel inside its post-link window); session_not_ready carries
    // the raw lifecycle status; everything else is "unreachable".
    // B5-5 (R111): the inline taxonomy moved into
    // sendFailureWatchStatus (shared with the post-send feed below).
    observeWhatsAppChannel({ configured: true, status: sendFailureWatchStatus(session) });
    // A9-2 (R116): a failed pre-send session resolution is a failed OTP
    // send attempt — count it (settling is excluded inside
    // observeSendFailure).
    observeSendFailure(session);
    return session;
  }

  // Preflight: resolves the recipient's LID in the engine cache (the
  // actual fix for "No LID for user") and gives us a fail-fast signal
  // when the number isn't registered on WhatsApp at all. A failed
  // preflight (HTTP 5xx / network) is not fatal — we proceed to the
  // send and let it surface its own error if any.
  const digits = chatIdToDigits(chatId);
  const preflight = await preflightCheckNumber(config, session.id, digits);
  if (preflight && !preflight.exists) {
    logger.warn(
      // F9: masked — the unregistered number is still PII.
      { category: "whatsapp.gateway", chatId: maskChatId(chatId) },
      "[whatsapp-otp] recipient is not registered on WhatsApp",
    );
    return { ok: false, reason: "recipient_not_on_whatsapp" };
  }

  const result = await sendTextWithRetry(config, session.id, chatId, text);
  // B5-5 (R111): the send-path OUTCOME feeds the channel-death watch.
  // Until now only pre-send ensureSession failures did, so (a) a channel
  // that went unhealthy on probes but kept DELIVERING OTPs sat on a
  // stale unhealthy streak — success never reset it — and (b) a session
  // that probed `ready` but failed every actual send ("ready for probe,
  // dead for send") never alerted. A delivered send is the strongest
  // healthy observation; an exhausted send failure is the sharpest
  // dead-for-send one. recipient_not_on_whatsapp deliberately returns
  // ABOVE this — it is a client-side condition (wrong number), not
  // channel health, and must never start a death-watch streak.
  observeWhatsAppChannel({
    configured: true,
    status: result.ok ? "ready" : sendFailureWatchStatus(result),
  });
  // A9-2 (R116): an exhausted send failure counts toward the rolling
  // send-failure window — interleaved successes must not mask an
  // intermittently dying channel (that gap is exactly what the rolling
  // counter closes vs. the streak-reset-on-success watch above).
  if (!result.ok) {
    observeSendFailure(result);
  }
  return result;
}

/** Probe used by `/api/auth/providers` and admin diagnostics. */
export function isWhatsAppGatewayConfigured(): boolean {
  return readGatewayConfig() !== null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Readiness probe (honest UX)
// ─────────────────────────────────────────────────────────────────────────────

export interface WhatsAppGatewayReadiness {
  /** Env config present (BASE_URL + API_KEY + SESSION). */
  configured: boolean;
  /**
   * The configured session is paired, settled AND warm — OTPs can flow.
   * 96-F1 (R96-A4 §1.3C): `ready:true` now additionally requires the
   * post-link settle window to have elapsed and (when the operator
   * number is configured) a delivered warm-up self-check.
   */
  ready: boolean;
  /** Current session lifecycle status, null when unknown/unresolvable. */
  status: string | null;
  /** 96-F1: the session is paired (`status === "ready"`) but still inside the settle/warm-up window. */
  settling: boolean;
  /** 96-F1: seconds until the channel becomes ready (null once settled / not settling). */
  readyInSec: number | null;
  /** Epoch ms of the probe backing this value. */
  probedAt: number;
}

const READINESS_CACHE_TTL_MS = 30_000;
let readinessCache: WhatsAppGatewayReadiness | null = null;

/**
 * Probe whether the configured OpenWA session is actually paired and
 * ready — the difference between "gateway configured" and "OTP can be
 * delivered right now". Result cached 30s so the public providers
 * endpoint cannot be turned into a free high-frequency gateway probe.
 *
 * 96-F1 (R96-A4 §1.3C honest readiness): a freshly-paired session is
 * NOT reported ready — the probe observation feeds the settle gate
 * (recordReadySince) and `ready` stays false until the window elapses
 * and the warm-up self-check (when configured) has delivered. The cache
 * is never populated with a pre-gate `ready` verdict because a new
 * ready-since observation busts it before this probe caches its result.
 *
 * Failure semantics: a gateway that cannot be reached reports
 * `status: null` (unknown) — never a false `ready`.
 */
export async function getWhatsAppGatewayReadiness(): Promise<WhatsAppGatewayReadiness> {
  const config = readGatewayConfig();
  if (!config) {
    const unconfigured: WhatsAppGatewayReadiness = {
      configured: false,
      ready: false,
      status: null,
      settling: false,
      readyInSec: null,
      probedAt: Date.now(),
    };
    // Feeds the (resetting) observation-driven channel watch — a real
    // probe, not a timer tick (2026-09-20).
    observeWhatsAppChannel({ configured: false, status: null });
    return unconfigured;
  }
  const now = Date.now();
  if (readinessCache && now - readinessCache.probedAt < READINESS_CACHE_TTL_MS) {
    return readinessCache;
  }
  try {
    const session = await findSession(config);
    let settled = false;
    let readyInSec: number | null = null;
    let warmed = false;
    if (session && session.status === "ready") {
      // Probe observation feeds the settle gate — this is also how a
      // freshly-paired session gets its warm-up scheduled without any
      // OTP traffic (the /api/auth/providers mount-fetch drives it).
      const readySince = await recordReadySince(session);
      const remainingMs = settleRemainingMs(readySince);
      settled = remainingMs === 0;
      readyInSec = settled ? null : Math.max(1, Math.ceil(remainingMs / 1000));
      warmed = isWarmupOk(session);
    }
    const result: WhatsAppGatewayReadiness = {
      configured: true,
      ready: settled && warmed,
      status: session?.status ?? null,
      settling: Boolean(session && session.status === "ready" && (!settled || !warmed)),
      readyInSec,
      probedAt: now,
    };
    readinessCache = result;
    // 2026-09-20: every REAL probe feeds the channel-death watch (this
    // replaces the old 60 s watcher timer — no artificial traffic).
    observeWhatsAppChannel({ configured: true, status: result.status });
    return result;
  } catch {
    // Network error / 5xx — report unknown, cache briefly to avoid a
    // probing storm during an outage.
    const result: WhatsAppGatewayReadiness = {
      configured: true,
      ready: false,
      status: null,
      settling: false,
      readyInSec: null,
      probedAt: now,
    };
    readinessCache = result;
    observeWhatsAppChannel({ configured: true, status: null });
    return result;
  }
}

/** Test seam — clears the readiness cache. */
export function __resetWhatsAppReadinessCacheForTests(): void {
  readinessCache = null;
}

/**
 * Test seam — clears the in-memory ready-session cache. Not part of
 * the public contract; exported only so unit tests / hot-reload can
 * force a re-bootstrap.
 *
 * 96-F1: also resets the settle-gate bookkeeping (ready-since map,
 * dispatch-ready map, pending initial warm-ups) so each test observes
 * a pristine first-observation state.
 *
 * @internal
 */
export function __resetWhatsAppGatewayCacheForTests(): void {
  readySessionCache = null;
  __resetSettleGateStateForTests();
}
