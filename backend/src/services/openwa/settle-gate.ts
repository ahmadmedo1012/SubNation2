/**
 * 96-F1 (R96-A4 §1.3 A+B): post-link settle gate + warm-up self-check —
 * the dispatch-gating half of the services/openwa/ package (R136 BE-2
 * decomposition of services/openwa.service.ts).
 *
 * The production "Waiting for this message" incident: OpenWA flips a
 * session to `ready` the moment the companion device authenticates —
 * BEFORE WhatsApp's multi-device key distribution (sender-keys, prekeys,
 * app-state sync) has propagated to peers. An OTP dispatched in that
 * window is encrypted under keys the receiving phone cannot resolve and
 * renders as "Waiting for this message. This may take a while."
 * (openwa.service used to treat `ready` as immediately sendable — the
 * race was confirmed in code at r96-A4 §1.2.)
 *
 *   A. Settle gate: the first time a session is observed `ready`, record
 *      the timestamp (in-memory Map + Redis mirror
 *      `openwa:ready-since:{gateKey}` so restarts and sibling
 *      instances share the observation). No dispatch until
 *      POST_LINK_SETTLE_MS has elapsed since that first observation.
 *      97-F3 (R97-WA-01): the gate key is COMPOSITE — (sessionId +
 *      pairing-epoch token). The gateway keeps the SAME session id
 *      across a loggedOut + re-pair cycle (the live production
 *      incident), so a session-id-keyed gate NEVER re-arms and the
 *      whole 3-layer defense is bypassed unless the backend restarts.
 *      The gateway exposes `lastReadyAt` (fallback `connectedAt`) on
 *      the wire; a `ready` observation whose token DIFFERS from the
 *      last observed one means a new pairing happened → the window
 *      fully re-arms, dispatchReady drops, warm-up re-schedules, and
 *      both caches bust. Tokens are compared as OPAQUE STRINGS (never
 *      a time-diff) so gateway/backend clock skew can neither mask
 *      nor fabricate a re-pair.
 *
 *   B. Warm-up self-check (INTENT-DRIVEN since the 2026-09-20
 *      free-infrastructure round — the 6-hour periodic loop was
 *      removed): after the settle window, a benign Arabic message is
 *      sent to the operator's own linked number
 *      (WHATSAPP_OTP_OPERATOR_E164). A successful self-chat send forces
 *      LID resolution + sender-key distribution on a harmless chat
 *      BEFORE any OTP flows. It is scheduled ONE-SHOT per pairing
 *      epoch (scheduleInitialWarmup) from the first `ready`
 *      observation — which only ever happens on real traffic (a
 *      readiness probe or an OTP attempt). When the env is unset the
 *      warm-up is skipped silently and dispatch relies on the settle
 *      gate alone; when set, dispatch additionally requires warmup-ok.
 *
 * FACADE WIRING (R136): the warm-up cycle's SEND CORE and the
 * ready-session/readiness CACHE BUSTING live in the openwa.service.ts
 * facade (the send path owns them; importing them here would cycle).
 * The facade binds both at module load:
 *   - bindWarmupSendFn(sendTextWithRetry-with-skipWarmupGate)
 *   - registerGatewayCacheBuster(() => bust readySession + readiness)
 */
import { logger } from "../../lib/logger";
import { readEnvNumber } from "../../lib/env";
// 96-F1 (R96-A4 §1.3A): ready-since mirror — Redis shares the settle-gate
// observation across restarts and sibling instances. Reuses the same
// resilient singleton + bounded-command helpers as idempotency.ts.
import { getRedisClient, withRedisCommandTimeout } from "../../lib/redis-client";
import { readEpochMarker, writeEpochMarker } from "../../lib/whatsapp-epoch-store";
// 2026-09-20 free-infrastructure round: the channel-death watch is fed
// by REAL observations (readiness probes + OTP send attempts) instead
// of a 60 s interval timer. One-way dependency — whatsapp-watch imports
// nothing from this package, so no cycle.
import { observeWhatsAppChannel, observeWhatsAppSendFailure } from "../whatsapp-watch";
import {
  findSession,
  readGatewayConfig,
  type GatewayConfig,
  type SendResult,
  type SessionRecord,
} from "./gateway-client";

const POST_LINK_SETTLE_DEFAULT_MS = 45_000;
const POST_LINK_SETTLE_MAX_MS = 300_000;

/**
 * Env-tunable settle window (WHATSAPP_OTP_SETTLE_MS, default 45 s,
 * clamped 0–300 s). Pair-code linking typically completes key
 * propagation in 10–30 s; QR (device-list rebuild) can take longer —
 * 45 s covers both while staying under the 60 s resend cooldown.
 */
function readPostLinkSettleMs(): number {
  // R158 (B#7): the shared reader — the clamp stays HERE (it is this
  // module's range contract), the reader adds the set-but-malformed warn.
  const raw = readEnvNumber("WHATSAPP_OTP_SETTLE_MS", POST_LINK_SETTLE_DEFAULT_MS);
  return Math.min(Math.max(Math.trunc(raw), 0), POST_LINK_SETTLE_MAX_MS);
}
export const POST_LINK_SETTLE_MS = readPostLinkSettleMs();

/** R104 (AG4-2): minimum settle that still applies to an ADOPTED
 * (restored, marker-proven) pairing epoch — the gateway socket just
 * reconnected; cheap insurance against dispatching in the very first
 * seconds of a fresh engine boot even though key propagation is not in
 * question on a restore. */
const RESTORE_RESIDUAL_SETTLE_MS = 5_000;

/** Warm-up cadence note (§1.3B): the periodic 6 h loop was REMOVED in
 * the 2026-09-20 free-infrastructure round — periodic self-messages
 * were artificial keep-alive traffic. The warm-up survives as a
 * one-shot per pairing epoch, scheduled by the first `ready`
 * observation (real traffic), via scheduleInitialWarmup(). */

/** Conservative "channel becomes ready" estimate while the warm-up
 * self-check send is still in flight (used as readyInMs so the route
 * can emit a sane Retry-After). */
export const WARMUP_PENDING_ESTIMATE_MS = 10_000;

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

/** ms remaining in the settle window (0 once settled). */
export function settleRemainingMs(readySince: number): number {
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

// ─────────────────────────────────────────────────────────────────────────────
// Facade wiring (R136): injected send core + cache buster
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The warm-up cycle's send core. Injected by the facade at module load
 * (sendTextWithRetry with `{ skipWarmupGate: true }` — the self-check
 * intentionally bypasses the warm-up gate, chicken-and-egg) so this
 * module never imports the send path back (no dependency cycle).
 */
export type WarmupSendFn = (
  config: GatewayConfig,
  sessionId: string,
  chatId: string,
  text: string,
) => Promise<SendResult>;

let warmupSendFn: WarmupSendFn | null = null;

/** Facade wiring — bind the retrying send core used by the warm-up
 * self-check. Called once at openwa.service.ts module evaluation. */
export function bindWarmupSendFn(fn: WarmupSendFn): void {
  warmupSendFn = fn;
}

/** Facade wiring — the gate busts the send-path ready-session cache and
 * the readiness probe cache on a re-pair / fresh ready observation.
 * Registered once at openwa.service.ts module evaluation (default
 * no-op keeps this module independently importable). */
export function registerGatewayCacheBuster(bust: () => void): void {
  bustGatewayCaches = bust;
}

let bustGatewayCaches: () => void = () => {};

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
  // probe cache (public status surface) and the send-path ready cache
  // (facade-owned; busted through the registered hook).
  bustGatewayCaches();
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
export function isWarmupOk(session: SessionRecord): boolean {
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
export async function recordReadySince(session: SessionRecord): Promise<number> {
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
      // B5-3 (R111): CLAMPED to now. An operator-tuned SETTLE_MS below
      // the 5 s residual used to make the floor arithmetic
      // (now - (SETTLE - 5000)) compute a FUTURE readySince — the gate
      // then counted the window down from a timestamp that had not
      // happened yet.
      const residualFloorMs = Math.max(0, POST_LINK_SETTLE_MS - RESTORE_RESIDUAL_SETTLE_MS);
      const adoptedReadySince = Math.min(
        Date.now(),
        Math.max(marker.readySince, Date.now() - residualFloorMs),
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
      bustGatewayCaches();
      return adoptedReadySince;
    }
  }

  const now = Date.now();
  sessionReadySince.set(gateKey, now);
  bustGatewayCaches(); // never cache a pre-gate `ready` verdict
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

/** Exported for the facade's ensureSession (B5-1 idempotent re-arm on
 * the send path) — resolves a ready session's composite gate key. */
export function gateKeyForSession(session: SessionRecord): string {
  return sessionGateKey(session);
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
export function scheduleInitialWarmup(gateKey: string, readySince: number): void {
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
  const send = warmupSendFn;
  if (!send) return; // facade send core not bound (see bindWarmupSendFn)

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
  const result = await send(config, session.id, `${operator}@c.us`, WARMUP_TEXT);
  if (result.ok) {
    dispatchReady.set(gateKey, true);
    // R104 (AG4-2): persist the warmed flag so the next cold start of the
    // SAME epoch (routine restore) adopts the proven state.
    const epoch = sessionPairingEpoch(session);
    if (epoch) {
      writeEpochMarker(session.id, { epoch, readySince, warmed: true });
    }
    // B5-5 (R111): a delivered self-check is a real send through the
    // full path — feed the watch a healthy observation (resets any
    // stale unhealthy streak from the settling window).
    observeWhatsAppChannel({ configured: true, status: "ready" });
    logger.info(
      { category: "whatsapp.gateway", sessionId: session.id, gateKey },
      "[whatsapp-otp] warm-up self-check delivered — OTP dispatch enabled for this session",
    );
  } else {
    logger.warn(
      { category: "whatsapp.gateway", sessionId: session.id, reason: result.reason },
      "[whatsapp-otp] warm-up self-check failed — dispatch stays gated until the next cycle",
    );
    // B5-5 (R111): a failing warm-up self-check is the sharpest
    // "ready-for-probe, dead-for-send" signal there is — the session
    // reports ready (probes look healthy) yet nothing can be delivered.
    // Feed the watch so a persistently failing warm-up escalates on the
    // same 15-minute streak as any other channel death.
    observeWhatsAppChannel({ configured: true, status: sendFailureWatchStatus(result) });
    // A9-2 (R116): the warm-up self-check IS a send attempt — it also
    // counts toward the rolling send-failure window.
    observeSendFailure(result);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// B5-5 (R111) / A9-2 (R116): send-failure → channel-watch taxonomy
// ─────────────────────────────────────────────────────────────────────────────
// Shared by the warm-up cycle above and the facade's send path.

/**
 * B5-5 (R111): map a send-path failure onto the channel-watch status.
 * Same taxonomy the pre-send ensureSession branch has always fed
 * (settling is HEALTHY — a working channel inside its post-link window;
 * the raw lifecycle status names not-ready; not_found is its own token;
 * null = gateway unreachable), extended for wire-level send failures the
 * gateway answers AFTER the session was already resolved ready — the
 * "ready for probe, dead for send" shape — which name the HTTP verdict
 * (send_5xx / send_409 / …) so the alert token is honest.
 */
export function sendFailureWatchStatus(result: Extract<SendResult, { ok: false }>): string | null {
  switch (result.reason) {
    case "session_settling":
      return "settling";
    case "session_not_ready":
      return result.sessionStatus ?? null;
    case "session_not_found":
      return "not_found";
    case "request_failed":
      return null; // gateway unreachable
    case "non_ok_status":
      return `send_${result.status ?? 0}`;
    default:
      return null;
  }
}

/**
 * A9-2 (R116): feed the rolling send-failure counter — every OTP / warm-up
 * send attempt that exhausted its retries and was NOT the expected
 * post-pairing settle window (settling is a WORKING channel inside its
 * gate; counting it would alert on routine pairing). null status maps to
 * the watch's "unreachable" token.
 */
export function observeSendFailure(result: Extract<SendResult, { ok: false }>): void {
  const status = sendFailureWatchStatus(result);
  if (status === "settling") return;
  observeWhatsAppSendFailure(status ?? "unreachable");
}

// ─────────────────────────────────────────────────────────────────────────────
// Test seams
// ─────────────────────────────────────────────────────────────────────────────

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
