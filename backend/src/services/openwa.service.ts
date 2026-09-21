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
import { readEpochMarker, writeEpochMarker } from "../lib/whatsapp-epoch-store";
// 2026-09-20 free-infrastructure round: the channel-death watch is fed
// by REAL observations (readiness probes + OTP send attempts) instead
// of a 60 s interval timer. One-way dependency — whatsapp-watch imports
// nothing from this module, so no cycle.
import { observeWhatsAppChannel } from "./whatsapp-watch";

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
//      `openwa:ready-since:{gateKey}` so restarts and sibling
//      instances share the observation). No dispatch until
//      POST_LINK_SETTLE_MS has elapsed since that first observation.
//      97-F3 (R97-WA-01): the gate key is COMPOSITE — (sessionId +
//      pairing-epoch token). The gateway keeps the SAME session id
//      across a loggedOut + re-pair cycle (the live production
//      incident), so a session-id-keyed gate NEVER re-arms and the
//      whole 3-layer defense is bypassed unless the backend restarts.
//      The gateway exposes `lastReadyAt` (fallback `connectedAt`) on
//      the wire; a `ready` observation whose token DIFFERS from the
//      last observed one means a new pairing happened → the window
//      fully re-arms, dispatchReady drops, warm-up re-schedules, and
//      both caches bust. Tokens are compared as OPAQUE STRINGS (never
//      a time-diff) so gateway/backend clock skew can neither mask
//      nor fabricate a re-pair.
//
//   B. Warm-up self-check (INTENT-DRIVEN since the 2026-09-20
//      free-infrastructure round — the 6-hour periodic loop was
//      removed): after the settle window, a benign Arabic message is
//      sent to the operator's own linked number
//      (WHATSAPP_OTP_OPERATOR_E164). A successful self-chat send forces
//      LID resolution + sender-key distribution on a harmless chat
//      BEFORE any OTP flows. It is scheduled ONE-SHOT per pairing
//      epoch (scheduleInitialWarmup) from the first `ready`
//      observation — which only ever happens on real traffic (a
//      readiness probe or an OTP attempt). When the env is unset the
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

/** R104 (AG4-2): minimum settle that still applies to an ADOPTED
 * (restored, marker-proven) pairing epoch — the gateway socket just
 * reconnected; cheap insurance against dispatching in the very first
 * seconds of a fresh engine boot even though key propagation is not in
 * question on a restore. */
const RESTORE_RESIDUAL_SETTLE_MS = 5_000;

/** Bounded in-request wait inside the OTP send path (§1.3A): one honest
 *  spinner beats a 503 round-trip, but no request may hang for the whole
 *  window. */
const SETTLE_WAIT_CAP_MS = 20_000;

/** Warm-up cadence note (§1.3B): the periodic 6 h loop was REMOVED in
 *  the 2026-09-20 free-infrastructure round — periodic self-messages
 *  were artificial keep-alive traffic. The warm-up survives as a
 *  one-shot per pairing epoch, scheduled by the first `ready`
 *  observation (real traffic), via scheduleInitialWarmup(). */

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

/** First-observation timestamps per settle-gate key (epoch ms).
 * 97-F3 (WA-01): keyed by the composite (sessionId + pairing epoch),
 * NOT the bare session id — a re-pair with the same id gets a fresh
 * entry (and the old one is deleted) instead of adopting the dead
 * pairing's timestamp. */
const sessionReadySince = new Map<string, number>();
/** Warm-up-ok flag per settle-gate key — only meaningful when the
 * operator env is set. 97-F3 (WA-03 partial): epoch-scoped — the flag
 * from a previous pairing never survives a re-pair. */
const dispatchReady = new Map<string, boolean>();
/** Settle-gate keys with a pending one-shot initial warm-up scheduled. */
const pendingInitialWarmups = new Set<string>();
/** 97-F3 (WA-01): last pairing-epoch token observed `ready` per session
 * id — the memory that lets a new epoch be recognized as a re-pair. */
const sessionObservedEpoch = new Map<string, string>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** ms remaining in the settle window (0 once settled). */
function settleRemainingMs(readySince: number): number {
  return Math.max(0, readySince + POST_LINK_SETTLE_MS - Date.now());
}

// ─────────────────────────────────────────────────────────────────────────────
// 97-F3 (R97-WA-01): pairing-epoch gate keys + re-arm on re-pair
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The pairing-epoch token for a session — the gateway's `lastReadyAt`
 * (ISO string), falling back to `connectedAt`, falling back to "" when
 * the gateway deployment predates both fields (legacy shape: the gate
 * then keys on the bare session id exactly as before — no regression).
 *
 * IMPORTANT: the token is treated as an OPAQUE STRING. It is compared
 * with `!==`, never parsed into a time — clock skew between the gateway
 * and this backend therefore cannot mask a re-pair (or invent one).
 */
function sessionPairingEpoch(session: SessionRecord): string {
  // R104 (AG4-2): prefer the STABLE pairing identity. pairingId survives
  // routine restores (same creds → same registrationId), so a wake after
  // idle no longer masquerades as a re-pair. lastReadyAt stays as the
  // legacy fallback (gateway builds without pairingId).
  return (session.pairingId ?? session.lastReadyAt ?? session.connectedAt ?? "").trim();
}

/**
 * The composite settle-gate key: (sessionId + pairing-epoch token).
 * `sess_…` ids match `^[A-Za-z0-9_-]+$` (see assertSessionId) so the
 * `::` separator can never appear inside the id — the key parses back
 * unambiguously. Empty epoch (legacy gateway / unit fixtures without
 * the field) degrades to the bare session id: the exact pre-97-F3 key,
 * which also keeps the Redis mirror key backward compatible.
 */
function sessionGateKey(session: SessionRecord): string {
  const epoch = sessionPairingEpoch(session);
  return epoch ? `${session.id}::${epoch}` : session.id;
}

/** Test-seam twin of {@link sessionGateKey} for callers holding the
 * pieces separately (the seams accept an optional epoch token). */
function settleGateKey(sessionId: string, epochToken?: string): string {
  const epoch = (epochToken ?? "").trim();
  return epoch ? `${sessionId}::${epoch}` : sessionId;
}

/**
 * 97-F3 (R97-WA-01) — the re-arm core. Called on every FIRST
 * observation of a settle-gate key for a session: when the session id
 * already has a DIFFERENT epoch recorded, a re-pair happened under the
 * same id. The previous epoch's bookkeeping is wiped (ready-since,
 * dispatchReady, pending warm-up) and both caches bust, so the caller
 * then records a FRESH ready-since → the full settle window re-arms and
 * the warm-up self-check must deliver again before dispatch is enabled.
 *
 * Returns true when a re-pair was detected (epoch changed). Purely
 * in-memory side effects — safe to call on every gate miss.
 */
function rearmGateOnEpochChange(session: SessionRecord): boolean {
  const epoch = sessionPairingEpoch(session);
  const previousEpoch = sessionObservedEpoch.get(session.id);
  sessionObservedEpoch.set(session.id, epoch);
  if (previousEpoch === undefined || previousEpoch === epoch) return false;

  const previousGateKey = settleGateKey(session.id, previousEpoch);
  sessionReadySince.delete(previousGateKey);
  dispatchReady.delete(previousGateKey);
  pendingInitialWarmups.delete(previousGateKey);
  // A new pairing invalidates any cached verdict — both the readiness
  // probe cache (public status surface) and the send-path ready cache.
  readinessCache = null;
  readySessionCache = null;
  logger.info(
    {
      category: "whatsapp.gateway",
      sessionId: session.id,
      previousEpoch,
      epoch,
      settleMs: POST_LINK_SETTLE_MS,
    },
    "[whatsapp-otp] pairing epoch changed under the same session id (re-pair detected) — settle window re-armed, dispatch gate dropped",
  );
  return true;
}

/** Warm-up gate — applies ONLY when the operator number is configured.
 * 97-F3 (WA-03 partial): epoch-scoped via the composite gate key — the
 * warm-up verdict is only valid within the pairing epoch that produced
 * it; a re-pair (new epoch) starts from a clean slate. */
function isWarmupOk(session: SessionRecord): boolean {
  if (!readOperatorNumber()) return true;
  return dispatchReady.get(sessionGateKey(session)) === true;
}

/**
 * Record (or adopt) the first `ready` observation for a session's
 * CURRENT pairing epoch.
 *
 * In-memory first; on a miss, the Redis mirror is checked so a cold
 * start / sibling instance ADOPTS the shared timestamp instead of
 * re-opening the window. When neither exists, now is recorded locally
 * AND via SETNX in Redis (TTL 7 d). Any freshly-recorded observation
 * also busts the readiness cache — a session must never be cached as
 * `ready` from a probe that predates its pairing.
 *
 * 97-F3 (R97-WA-01): the mirror key is the composite gate key
 * (session id + epoch token), NOT the bare session id. A re-pair with
 * the same id therefore reads a FRESH key: the dead pairing's mirror
 * value can no longer be adopted across a backend restart (the exact
 * bypass the live incident exposed — previously the re-pair survived
 * even a redeploy when Redis was present). Before the Redis lookup,
 * {@link rearmGateOnEpochChange} wipes the previous epoch's
 * bookkeeping so the settle window and the warm-up gate fully re-arm.
 */
async function recordReadySince(session: SessionRecord): Promise<number> {
  const gateKey = sessionGateKey(session);
  const known = sessionReadySince.get(gateKey);
  if (known !== undefined) return known; // steady state within this epoch

  rearmGateOnEpochChange(session);

  const redis = getRedisClient();
  if (redis) {
    try {
      const key = `openwa:ready-since:${gateKey}`;
      const raw = await withRedisCommandTimeout("openwa_ready_since_get", () => redis.get(key));
      if (raw) {
        const ts = Number(raw);
        if (Number.isFinite(ts) && ts > 0) {
          sessionReadySince.set(gateKey, ts);
          scheduleInitialWarmup(gateKey, ts);
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

  // ── R104 (AG4-2): Neon-persisted epoch marker (the no-Redis prod shape)
  // ────────────────────────────────────────────────────────────────────────
  // A cold process (Render free sleeps after 15 idle minutes) checking the
  // SAME stable pairingId as the marker records = a routine RESTORE, not a
  // re-pair: adopt the proven ready-since (+ warmed flag) instead of
  // re-arming the full 45 s settle + warm-up ceremony on every wake.
  const epoch = sessionPairingEpoch(session);
  if (epoch) {
    const marker = await readEpochMarker(session.id);
    if (marker && marker.epoch === epoch) {
      // Residual settle floor: the gateway socket just came up on a
      // restore — never dispatch in the very first seconds even though
      // the pre-sleep epoch was fully settled (cheap insurance; the
      // OTP path's bounded settle-wait rides it out).
      const adoptedReadySince = Math.max(
        marker.readySince,
        Date.now() - (POST_LINK_SETTLE_MS - RESTORE_RESIDUAL_SETTLE_MS),
      );
      sessionReadySince.set(gateKey, adoptedReadySince);
      if (marker.warmed) {
        dispatchReady.set(gateKey, true);
        logger.info(
          { category: "whatsapp.gateway", sessionId: session.id, gateKey },
          "[whatsapp-otp] restored pairing adopted — epoch already settled+warm (marker hit)",
        );
      } else {
        scheduleInitialWarmup(gateKey, adoptedReadySince);
      }
      readinessCache = null;
      return adoptedReadySince;
    }
  }

  const now = Date.now();
  sessionReadySince.set(gateKey, now);
  readinessCache = null; // never cache a pre-gate `ready` verdict
  if (epoch) {
    // Persist the new epoch's marker (fresh window, warm-up pending).
    writeEpochMarker(session.id, { epoch, readySince: now, warmed: false });
  }
  logger.info(
    { category: "whatsapp.gateway", sessionId: session.id, gateKey, settleMs: POST_LINK_SETTLE_MS },
    "[whatsapp-otp] session observed ready — post-link settle window started",
  );
  scheduleInitialWarmup(gateKey, now);
  return now;
}

/**
 * One-shot initial warm-up: the FIRST observation of a ready session
 * (per pairing epoch — 97-F3/WA-01) schedules the self-check for right
 * after the settle window elapses (delay 0 when the window already
 * passed — e.g. a cold start adopting an old Redis timestamp). This is
 * the INTENT-DRIVEN warmup trigger: the observation that arms it is
 * always a real request (readiness probe or OTP attempt), never a
 * timer.
 */
function scheduleInitialWarmup(gateKey: string, readySince: number): void {
  const operator = readOperatorNumber();
  if (!operator) return; // warm-up disabled — skip silently (§1.3B)
  if (dispatchReady.get(gateKey)) return;
  if (pendingInitialWarmups.has(gateKey)) return;
  pendingInitialWarmups.add(gateKey);
  const delay = Math.max(0, readySince + POST_LINK_SETTLE_MS - Date.now());
  const timer = setTimeout(() => {
    pendingInitialWarmups.delete(gateKey);
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
 * The warm-up cycle (scheduled by the one-shot initial warm-up): resolve
 * the session, and when it is ready + settled + not yet warm, send the
 * benign self-check to the operator's own number and — only on a
 * successful send — flip dispatchReady for this process. Never throws
 * (scheduler contract); every failure is logged and retried by the next
 * intent-driven observation.
 *
 * 97-F3 (WA-03 partial — documented strictness): "successful send"
 * here means the gateway answered HTTP 200 to POST send-text, i.e. the
 * engine ACCEPTED + encrypted + handed the message to WhatsApp's
 * server — it is NOT a delivery ack to the handset. The gateway's
 * /delivery-log endpoint (WAProto statuses: 2=SERVER_ACK, 3=DELIVERY_ACK)
 * could strengthen this to an end-to-end proof, but it is not consumed
 * by this backend yet (R97-WA-03 full fix — follow-up). What 97-F3 DOES
 * guarantee: the flag is epoch-scoped (sessionGateKey), so the verdict
 * only counts within the pairing epoch whose self-check produced it —
 * a re-pair forces a fresh self-check before dispatch re-enables.
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

  const gateKey = sessionGateKey(session);
  const readySince = await recordReadySince(session);
  if (settleRemainingMs(readySince) > 0) return; // still settling — the one-shot will fire
  if (dispatchReady.get(gateKey)) return; // already warm (this epoch)

  // The self-check intentionally bypasses the warm-up gate (chicken-and-
  // egg) and the OTP preflight (the operator's own number is on the
  // session by definition) — it keeps the network/5xx retry resilience.
  const result = await sendTextWithRetry(config, session.id, `${operator}@c.us`, WARMUP_TEXT, {
    skipWarmupGate: true,
  });
  if (result.ok) {
    dispatchReady.set(gateKey, true);
    // R104 (AG4-2): persist the warmed flag so the next cold start of the
    // SAME epoch (routine restore) adopts the proven state.
    const epoch = sessionPairingEpoch(session);
    if (epoch) {
      writeEpochMarker(session.id, { epoch, readySince, warmed: true });
    }
    logger.info(
      { category: "whatsapp.gateway", sessionId: session.id, gateKey },
      "[whatsapp-otp] warm-up self-check delivered — OTP dispatch enabled for this session",
    );
  } else {
    logger.warn(
      { category: "whatsapp.gateway", sessionId: session.id, reason: result.reason },
      "[whatsapp-otp] warm-up self-check failed — dispatch stays gated until the next cycle",
    );
  }
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
  /**
   * R104 (AG4-2): STABLE pairing identity (gateway exposes
   * creds.registrationId — minted at pairing, reused by every restore,
   * replaced only by a true re-pair). Preferred over lastReadyAt as the
   * epoch token: lastReadyAt is rewritten on EVERY connection open,
   * which made a routine boot-restore after an idle sleep look like a
   * re-pair and re-arm the full 45 s settle + warm-up gate on every
   * wake. Optional (older gateways omit it — falls back gracefully).
   */
  pairingId?: string;
  /**
   * 97-F3 (R97-WA-01): pairing-epoch token — the timestamp of the
   * CURRENT ready (gateway `publicView.lastReadyAt`). The gateway
   * rewrites it on every new connection open, so the SAME session id
   * (which survives loggedOut + re-pair) carries a NEW token after a
   * re-pair. Treated as an opaque string — see sessionPairingEpoch().
   * R104: used as the epoch ONLY when the gateway does not expose
   * pairingId (legacy shape).
   */
  lastReadyAt?: string;
  /** 97-F3 fallback epoch token when the gateway omits lastReadyAt
   * ("Timestamp of the CURRENT open" in publicView). */
  connectedAt?: string;
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
  const warmed = opts.skipWarmupGate === true || isWarmupOk(session);
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
    const failureStatus =
      session.reason === "session_settling"
        ? "settling"
        : session.reason === "session_not_ready"
          ? (session.sessionStatus ?? null)
          : session.reason === "session_not_found"
            ? "not_found"
            : null;
    observeWhatsAppChannel({ configured: true, status: failureStatus });
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
/**
 * R104 (AG4-2) / RT-3: simulate a COLD PROCESS for the settle-gate
 * state (the in-memory ready-since / dispatch-ready / observed-epoch /
 * pending-warmup maps) WITHOUT re-importing the module — used by the
 * epoch-memory tests to exercise the Neon-marker adoption path exactly
 * as a post-sleep wake would find it.
 */
export function __resetSettleGateStateForTests(): void {
  sessionReadySince.clear();
  dispatchReady.clear();
  pendingInitialWarmups.clear();
  sessionObservedEpoch.clear();
}

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
  sessionObservedEpoch.clear();
}

/**
 * Test seams for the 96-F1 settle gate / warm-up self-check. Not part
 * of the public contract.
 *
 * 97-F3 (WA-01): the read/write seams take an OPTIONAL epoch token —
 * omitting it targets the legacy bare-session-id key (the shape every
 * pre-97-F3 test uses); passing the gateway's lastReadyAt targets the
 * composite (sessionId + epoch) key the gate now books under.
 *
 * @internal
 */
export const __whatsappSettleGateTest = {
  /** First-observation timestamp recorded for a session (undefined = none). */
  getReadySince(sessionId: string, epoch?: string): number | undefined {
    return sessionReadySince.get(settleGateKey(sessionId, epoch));
  },
  /** Warm-up-ok flag for a session's (optionally epoch-scoped) gate key. */
  isDispatchReady(sessionId: string, epoch?: string): boolean {
    return dispatchReady.get(settleGateKey(sessionId, epoch)) === true;
  },
  /** Force-mark a session warm (simulates a delivered self-check). */
  markDispatchReady(sessionId: string, epoch?: string): void {
    dispatchReady.set(settleGateKey(sessionId, epoch), true);
  },
  /** Last pairing-epoch token observed ready for a session (undefined
   * until the first ready observation of the process). */
  getObservedEpoch(sessionId: string): string | undefined {
    return sessionObservedEpoch.get(sessionId);
  },
  /** Run one warm-up cycle on demand (the 6 h loop body). */
  runWarmupCycle(): Promise<void> {
    return runWarmupCycle();
  },
};
