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
// 96-F1 (R96-A4 §1.3A): ready-since mirror — Redis shares the settle-gate
// observation across restarts and sibling instances. Reuses the same
// resilient singleton + bounded-command helpers as idempotency.ts.
import { getRedisClient, withRedisCommandTimeout } from "../lib/redis-client";

interface GatewayAuthConfig {
  baseUrl: string;
  apiKey: string;
}

interface GatewayConfig extends GatewayAuthConfig {
  /** Either an existing session id (`sess_…`) or a session name. */
  sessionRef: string;
  autoCreate: boolean;
}

function readGatewayAuthConfig(): GatewayAuthConfig | null {
  const baseUrl = (process.env.WHATSAPP_OTP_BASE_URL ?? "").trim().replace(/\/+$/, "");
  const apiKey = (process.env.WHATSAPP_OTP_API_KEY ?? "").trim();
  if (!baseUrl || !apiKey) return null;

  return { baseUrl, apiKey };
}

function readGatewayConfig(): GatewayConfig | null {
  const auth = readGatewayAuthConfig();
  const sessionRef = (process.env.WHATSAPP_OTP_SESSION ?? "").trim();
  if (!auth || !sessionRef) return null;

  const autoCreateRaw = (process.env.WHATSAPP_OTP_AUTO_CREATE_SESSION ?? "").trim().toLowerCase();
  // Default ON. Only disable when the operator explicitly opts out.
  const autoCreate = !["0", "false", "no", "off"].includes(autoCreateRaw);

  return { ...auth, sessionRef, autoCreate };
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
        // 96-F1 (R96-A4 §1.3A): the session reports `ready` but is still
        // inside the post-link settle / warm-up window — dispatch is
        // gated, the caller should retry after `readyInMs`.
        | "session_settling"
        | "recipient_not_on_whatsapp"
        | "request_failed"
        | "non_ok_status";
      /** HTTP status when `reason === "non_ok_status"`. */
      status?: number;
      /** OpenWA session lifecycle state when `reason === "session_not_ready"`. */
      sessionStatus?: string;
      /** 96-F1: ms until the settle/warm-up window elapses (`reason === "session_settling"`). */
      readyInMs?: number;
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

// ─────────────────────────────────────────────────────────────────────────────
// 96-F1 (R96-A4 §1.3 A+B): post-link settle gate + warm-up self-check
// ─────────────────────────────────────────────────────────────────────────────
//
// The production "Waiting for this message" incident: OpenWA flips a
// session to `ready` the moment the companion device authenticates —
// BEFORE WhatsApp's multi-device key distribution (sender-keys, prekeys,
// app-state sync) has propagated to peers. An OTP dispatched in that
// window is encrypted under keys the receiving phone cannot resolve and
// renders as "Waiting for this message. This may take a while."
// (openwa.service used to treat `ready` as immediately sendable — the
// race was confirmed in code at r96-A4 §1.2.)
//
//   A. Settle gate: the first time a session is observed `ready`, record
//      the timestamp (in-memory Map + Redis mirror
//      `openwa:ready-since:{sessionId}` so restarts and sibling
//      instances share the observation). No dispatch until
//      POST_LINK_SETTLE_MS has elapsed since that first observation.
//
//   B. Warm-up self-check: after the settle window, send a benign Arabic
//      message to the operator's own linked number
//      (WHATSAPP_OTP_OPERATOR_E164). A successful self-chat send forces
//      LID resolution + sender-key distribution on a harmless chat
//      BEFORE any OTP flows, and repeats every 6 h to keep keys fresh
//      (and the free-tier gateway warm). When the env is unset the
//      warm-up is skipped silently and dispatch relies on the settle
//      gate alone; when set, dispatch additionally requires warmup-ok.

const POST_LINK_SETTLE_DEFAULT_MS = 45_000;
const POST_LINK_SETTLE_MAX_MS = 300_000;

/**
 * Env-tunable settle window (WHATSAPP_OTP_SETTLE_MS, default 45 s,
 * clamped 0–300 s). Pair-code linking typically completes key
 * propagation in 10–30 s; QR (device-list rebuild) can take longer —
 * 45 s covers both while staying under the 60 s resend cooldown.
 */
function readPostLinkSettleMs(): number {
  const raw = Number(process.env.WHATSAPP_OTP_SETTLE_MS);
  if (!Number.isFinite(raw)) return POST_LINK_SETTLE_DEFAULT_MS;
  return Math.min(Math.max(Math.trunc(raw), 0), POST_LINK_SETTLE_MAX_MS);
}
export const POST_LINK_SETTLE_MS = readPostLinkSettleMs();

/** Bounded in-request wait inside the OTP send path (§1.3A): one honest
 *  spinner beats a 503 round-trip, but no request may hang for the whole
 *  window. */
const SETTLE_WAIT_CAP_MS = 20_000;

/** Warm-up cadence (§1.3B). */
const WARMUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Conservative "channel becomes ready" estimate while the warm-up
 *  self-check send is still in flight (used as readyInMs so the route
 *  can emit a sane Retry-After). */
const WARMUP_PENDING_ESTIMATE_MS = 10_000;

/** Benign self-check text — Arabic, no code, no PII (§1.3B). */
const WARMUP_TEXT = "قناة SubNation جاهزة ✓ (رسالة تهيئة)";

/** Redis mirror TTL — 7 days, long outlives any settle window. */
const READY_SINCE_TTL_SEC = 7 * 24 * 60 * 60;

/** E164 shape for the operator env (digits, optional leading +). */
const OPERATOR_E164_RE = /^\d{10,15}$/;

/**
 * The operator's own linked number (WHATSAPP_OTP_OPERATOR_E164) — the
 * warm-up self-check destination. Digits only (leading `+` tolerated).
 * null when unset/invalid → warm-up disabled, silently skipped.
 */
function readOperatorNumber(): string | null {
  const raw = (process.env.WHATSAPP_OTP_OPERATOR_E164 ?? "").trim().replace(/^\+/, "");
  if (!raw) return null;
  return OPERATOR_E164_RE.test(raw) ? raw : null;
}

/** First-observation timestamps per session id (epoch ms). */
const sessionReadySince = new Map<string, number>();
/** Warm-up-ok flag per session id — only meaningful when the operator env is set. */
const dispatchReady = new Map<string, boolean>();
/** Session ids with a pending one-shot initial warm-up scheduled. */
const pendingInitialWarmups = new Set<string>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** ms remaining in the settle window (0 once settled). */
function settleRemainingMs(readySince: number): number {
  return Math.max(0, readySince + POST_LINK_SETTLE_MS - Date.now());
}

/** Warm-up gate — applies ONLY when the operator number is configured. */
function isWarmupOk(sessionId: string): boolean {
  if (!readOperatorNumber()) return true;
  return dispatchReady.get(sessionId) === true;
}

/**
 * Record (or adopt) the first `ready` observation for a session.
 *
 * In-memory first; on a miss, the Redis mirror is checked so a cold
 * start / sibling instance ADOPTS the shared timestamp instead of
 * re-opening the window. When neither exists, now is recorded locally
 * AND via SETNX in Redis (TTL 7 d). Any freshly-recorded observation
 * also busts the readiness cache — a session must never be cached as
 * `ready` from a probe that predates its pairing.
 */
async function recordReadySince(session: SessionRecord): Promise<number> {
  const known = sessionReadySince.get(session.id);
  if (known !== undefined) return known;

  const redis = getRedisClient();
  if (redis) {
    try {
      const key = `openwa:ready-since:${session.id}`;
      const raw = await withRedisCommandTimeout("openwa_ready_since_get", () => redis.get(key));
      if (raw) {
        const ts = Number(raw);
        if (Number.isFinite(ts) && ts > 0) {
          sessionReadySince.set(session.id, ts);
          scheduleInitialWarmup(session.id, ts);
          return ts;
        }
      }
      // Claim the observation for the fleet (NX: a sibling that raced
      // us keeps its own value — ms-level divergence, harmless).
      await withRedisCommandTimeout("openwa_ready_since_setnx", () =>
        redis.set(key, String(Date.now()), { NX: true, EX: READY_SINCE_TTL_SEC }),
      );
    } catch {
      // Redis degraded/absent — in-memory only (single-instance shape).
    }
  }

  const now = Date.now();
  sessionReadySince.set(session.id, now);
  readinessCache = null; // never cache a pre-gate `ready` verdict
  logger.info(
    { category: "whatsapp.gateway", sessionId: session.id, settleMs: POST_LINK_SETTLE_MS },
    "[whatsapp-otp] session observed ready — post-link settle window started",
  );
  scheduleInitialWarmup(session.id, now);
  return now;
}

/**
 * One-shot initial warm-up: the FIRST observation of a ready session
 * schedules the self-check for right after the settle window elapses
 * (delay 0 when the window already passed — e.g. a cold start adopting
 * an old Redis timestamp) instead of waiting for the 6 h loop tick.
 */
function scheduleInitialWarmup(sessionId: string, readySince: number): void {
  const operator = readOperatorNumber();
  if (!operator) return; // warm-up disabled — skip silently (§1.3B)
  if (dispatchReady.get(sessionId)) return;
  if (pendingInitialWarmups.has(sessionId)) return;
  pendingInitialWarmups.add(sessionId);
  const delay = Math.max(0, readySince + POST_LINK_SETTLE_MS - Date.now());
  const timer = setTimeout(() => {
    pendingInitialWarmups.delete(sessionId);
    void runWarmupCycle().catch((err) =>
      logger.warn(
        { category: "whatsapp.gateway", err: err instanceof Error ? err.message : String(err) },
        "[whatsapp-otp] initial warm-up failed (non-fatal)",
      ),
    );
  }, delay);
  timer.unref?.();
}

/**
 * The warm-up cycle (shared by the one-shot initial warm-up and the 6 h
 * loop): resolve the session, and when it is ready + settled + not yet
 * warm, send the benign self-check to the operator's own number and —
 * only on a delivered send — flip dispatchReady for this process.
 * Never throws (scheduler contract); every failure is logged and
 * retried by the next tick.
 */
async function runWarmupCycle(): Promise<void> {
  const config = readGatewayConfig();
  if (!config) return;
  const operator = readOperatorNumber();
  if (!operator) return;

  let session: SessionRecord | null;
  try {
    session = await findSession(config);
  } catch (err) {
    logger.warn(
      { category: "whatsapp.gateway", err: err instanceof Error ? err.message : String(err) },
      "[whatsapp-otp] warm-up session lookup failed (non-fatal)",
    );
    return;
  }
  if (!session || session.status !== "ready") return;

  const readySince = await recordReadySince(session);
  if (settleRemainingMs(readySince) > 0) return; // still settling — the one-shot will fire
  if (dispatchReady.get(session.id)) return; // already warm

  // The self-check intentionally bypasses the warm-up gate (chicken-and-
  // egg) and the OTP preflight (the operator's own number is on the
  // session by definition) — it keeps the network/5xx retry resilience.
  const result = await sendTextWithRetry(config, session.id, `${operator}@c.us`, WARMUP_TEXT, {
    skipWarmupGate: true,
  });
  if (result.ok) {
    dispatchReady.set(session.id, true);
    logger.info(
      { category: "whatsapp.gateway", sessionId: session.id },
      "[whatsapp-otp] warm-up self-check delivered — OTP dispatch enabled for this session",
    );
  } else {
    logger.warn(
      { category: "whatsapp.gateway", sessionId: session.id, reason: result.reason },
      "[whatsapp-otp] warm-up self-check failed — dispatch stays gated until the next cycle",
    );
  }
}

/**
 * 96-F1 (R96-A4 §1.3B): start the periodic warm-up self-check loop.
 *
 * Every 6 h, when the configured session is ready + settled, send the
 * benign Arabic self-check to WHATSAPP_OTP_OPERATOR_E164 so sender-key
 * distribution / LID resolution / app-state sync stay warm before any
 * OTP flows. Silently no-ops when the operator number is unset. Errors
 * are swallowed with logging — nothing ever throws across the scheduler.
 */
export function startWhatsAppWarmupLoop(): { stop: () => void } {
  const operator = readOperatorNumber();
  if (!operator) {
    logger.info(
      { category: "whatsapp.gateway" },
      "[whatsapp-otp] WHATSAPP_OTP_OPERATOR_E164 unset — warm-up self-check disabled (settle gate remains active)",
    );
    return { stop: () => {} };
  }

  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      await runWarmupCycle();
    } catch (err) {
      // Never throw across the loop — log and carry on to the next tick.
      logger.warn(
        { category: "whatsapp.gateway", err: err instanceof Error ? err.message : String(err) },
        "[whatsapp-otp] warm-up cycle failed (non-fatal)",
      );
    }
    if (stopped) return;
    timer = setTimeout(() => void tick(), WARMUP_INTERVAL_MS);
    timer.unref?.();
  };

  timer = setTimeout(() => void tick(), WARMUP_INTERVAL_MS);
  timer.unref?.();

  logger.info(
    { category: "whatsapp.gateway", intervalMs: WARMUP_INTERVAL_MS },
    "[whatsapp-otp] warm-up self-check loop scheduled (every 6h)",
  );

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

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

function authHeaders(config: GatewayAuthConfig): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-API-Key": config.apiKey,
  };
}

async function gatewayFetch(
  config: GatewayAuthConfig,
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

async function findSession(config: GatewayConfig): Promise<SessionRecord | null> {
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

async function createAndStartSession(config: GatewayConfig): Promise<SessionRecord> {
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
  const after = await gatewayFetch(config, `/api/sessions/${encodeURIComponent(created.id)}`);
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
 * 96-F1 (R96-A4 §1.3A): a `ready` status additionally requires the
 * post-link settle window to have elapsed AND (when the operator number
 * is configured) a successful warm-up self-check — see the settle-gate
 * block above. `skipWarmupGate` lets the warm-up send itself pass with
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
  const warmed = opts.skipWarmupGate === true || isWarmupOk(session.id);
  if (!settled || !warmed) {
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
  // 5xx from a ready session = transient gateway flap (free-tier cold
  // start included). 4xx (400/404/…) is a definitive rejection.
  return result.reason === "non_ok_status" && (result.status ?? 0) >= 500;
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
        logger.warn(
          { category: "whatsapp.gateway", chatId, status: res.status, attempt },
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
          chatId,
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

  return sendTextWithRetry(config, session.id, chatId, text);
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
    return {
      configured: false,
      ready: false,
      status: null,
      settling: false,
      readyInSec: null,
      probedAt: Date.now(),
    };
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
      // OTP traffic (the /api/auth/providers poll drives it).
      const readySince = await recordReadySince(session);
      const remainingMs = settleRemainingMs(readySince);
      settled = remainingMs === 0;
      readyInSec = settled ? null : Math.max(1, Math.ceil(remainingMs / 1000));
      warmed = isWarmupOk(session.id);
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
    return result;
  }
}

/** Test seam — clears the readiness cache. */
export function __resetWhatsAppReadinessCacheForTests(): void {
  readinessCache = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Operator session management
// ─────────────────────────────────────────────────────────────────────────────
//
// These functions intentionally live behind the backend rather than exposing
// WHATSAPP_OTP_API_KEY to a browser. The admin UI receives only the gateway's
// public session metadata and the rendered QR image/pairing code requested by
// an authenticated administrator.

const ADMIN_SESSION_NAME_RE = /^[A-Za-z0-9-]{3,50}$/;
const E164_PHONE_RE = /^\d{10,15}$/;

/** Safe subset exposed to the admin session-management surface. */
export interface WhatsAppSessionRecord {
  id: string;
  name: string;
  status: string;
}

export class WhatsAppGatewayError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "WhatsAppGatewayError";
  }
}

function requireGatewayAdminConfig(): GatewayAuthConfig {
  const config = readGatewayAuthConfig();
  if (!config) throw new WhatsAppGatewayError("gateway_not_configured", 503);
  return config;
}

function sessionPath(sessionId: string): string {
  return `/api/sessions/${encodeURIComponent(sessionId)}`;
}

function assertSessionId(sessionId: string): string {
  const value = sessionId.trim();
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(value)) {
    throw new WhatsAppGatewayError("invalid_session_id", 400);
  }
  return value;
}

function normalizeSession(value: unknown): WhatsAppSessionRecord {
  if (!value || typeof value !== "object") {
    throw new WhatsAppGatewayError("invalid_gateway_response", 502);
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.name !== "string" ||
    typeof candidate.status !== "string"
  ) {
    throw new WhatsAppGatewayError("invalid_gateway_response", 502);
  }
  return { id: candidate.id, name: candidate.name, status: candidate.status };
}

async function gatewayJson<T>(
  config: GatewayAuthConfig,
  path: string,
  init?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await gatewayFetch(config, path, init);
  } catch {
    throw new WhatsAppGatewayError("gateway_request_failed", 502);
  }
  if (!response.ok) {
    throw new WhatsAppGatewayError("gateway_request_failed", response.status);
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new WhatsAppGatewayError("invalid_gateway_response", 502);
  }
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
  sessionReadySince.clear();
  dispatchReady.clear();
  pendingInitialWarmups.clear();
}

/**
 * Test seams for the 96-F1 settle gate / warm-up self-check. Not part
 * of the public contract.
 *
 * @internal
 */
export const __whatsappSettleGateTest = {
  /** First-observation timestamp recorded for a session (undefined = none). */
  getReadySince(sessionId: string): number | undefined {
    return sessionReadySince.get(sessionId);
  },
  /** Warm-up-ok flag for a session. */
  isDispatchReady(sessionId: string): boolean {
    return dispatchReady.get(sessionId) === true;
  },
  /** Force-mark a session warm (simulates a delivered self-check). */
  markDispatchReady(sessionId: string): void {
    dispatchReady.set(sessionId, true);
  },
  /** Run one warm-up cycle on demand (the 6 h loop body). */
  runWarmupCycle(): Promise<void> {
    return runWarmupCycle();
  },
};
