/**
 * WhatsApp channel-death watch (97-F3 / R97-WA-06) — OBSERVATION-DRIVEN
 * since the 2026-09-20 free-infrastructure round (was: a 60 s interval
 * timer probing the OpenWA gateway).
 *
 * WHY: the 3am production incident — the WhatsApp OTP pairing was
 * revoked (loggedOut) and the session sat in `failed` for HOURS with
 * nobody noticing. Users saw the soft "قيد الربط مؤقتاً" hint and got
 * 503s; the alerting layer (ALERT_RULES) had no WhatsApp rule at all,
 * and `getWhatsAppGatewayReadiness` was only ever consulted when a user
 * happened to load /api/auth/providers. The watch closes that gap: real
 * readiness observations escalate a channel that stays outside
 * {ready, settling} for more than 15 minutes.
 *
 * WHERE OBSERVATIONS COME FROM (no timer, no artificial traffic):
 *   - `getWhatsAppGatewayReadiness()` — every real probe (login page
 *     providers surface, admin WhatsApp panel) feeds the watch;
 *   - the OTP send path (`sendWhatsAppMessage`) — an attempt against a
 *     dead/unreachable channel is the strongest possible signal that
 *     the operator needs to know.
 * The old 60 s ticker additionally kept the OpenWA gateway Render
 * service awake 24/7 (each probe reset its 15-minute idle timer) —
 * exactly the artificial drain this round removes. When there is no
 * traffic there are no observations and nothing to alert about; the
 * first REAL user intent wakes the chain and feeds the state machine.
 *
 * Semantics (unchanged from the ticker era):
 *   - "Healthy" = status ∈ {"ready", "settling"} (settling is the
 *     post-link settle/warm-up window — a WORKING channel). Everything
 *     else — failed, disconnected, qr_ready, created, initializing,
 *     null (gateway unreachable) — is "unhealthy".
 *     qr_ready is normal DURING pairing; counting it as unhealthy only
 *     after 15 continuous minutes is the point: it then means nobody
 *     scanned the QR / entered the pair-code.
 *   - Continuously unhealthy for > 15 min → ONE admin alert via
 *     logAdminAlert, dedupe key `whatsapp:channel:{status}` with the
 *     existing 24 h window (same pattern as stockWatcher's
 *     `stock:zero:{id}`). The 15-minute budget is measured on the
 *     unhealthy STREAK (any unhealthy status), not per-status — a
 *     channel flapping failed↔disconnected must not dodge the alert by
 *     restarting the clock. The CURRENT status names the alert; if the
 *     status degrades mid-episode AFTER its token already alerted
 *     (qr_ready → failed), the new token gets its own alert — genuinely
 *     new, worse information. A repeat of the same token stays deduped
 *     both within the episode and across 24 h.
 *   - Recovery: the first healthy observation after an episode THAT
 *     ALERTED emits a one-time info alert (`whatsapp:channel:recovered`,
 *     24 h dedupe). Short blips that never alerted also never announce
 *     a recovery — no noise for nothing.
 *   - When the gateway env is not configured at all (configured:false)
 *     there is no channel to watch — the episode state simply resets;
 *     an unconfigured deployment must not page anyone.
 *   - Status transitions are logged at info level with category
 *     "whatsapp.gateway" (the existing category for this surface).
 *   - NEVER throws across the caller: every observation is try/catch'd
 *     and a failure is a warn + carry on (scheduler contract, same as
 *     the warm-up cycle). Re-entry guard: a hung tick cannot stack
 *     concurrent observations (same pattern as the old ticker).
 *
 * NOTE (import shape): logAdminAlert is imported LAZILY inside the emit
 * helpers — same defensive pattern as web-scheduler.ts. A static named
 * import would break link-time for any test that mocks
 * jobs/alertLogger with a partial surface.
 */

import { logger } from "../lib/logger";

/** Minimal observation shape — a subset of WhatsAppGatewayReadiness. */
export interface WhatsAppChannelObservation {
  /** Env config present (BASE_URL + API_KEY + SESSION). */
  configured: boolean;
  /**
   * Current session lifecycle status ("ready" | "settling" | OpenWA
   * lifecycle value), null when the gateway is unreachable.
   */
  status: string | null;
}

const UNHEALTHY_ALERT_AFTER_MS = 15 * 60_000;

/** States in which the channel can serve OTP traffic (now or within the
 *  bounded settle window). Everything else is unhealthy. */
function isHealthyStatus(status: string | null): status is "ready" | "settling" {
  return status === "ready" || status === "settling";
}

/** Dedupe token for an unhealthy status — `null` (gateway unreachable)
 *  renders as "unreachable" so the key stays readable + stable. */
function statusToken(status: string | null): string {
  return status ?? "unreachable";
}

// Re-entry guard — a hung emission must not stack concurrent ticks.
let observeInFlight = false;

// ── Episode state (module-scoped: one watched channel by design — the
// OTP routing itself is single-session, R97-WA-11) ──────────────────────────
/** Timestamp of the first observation of the CURRENT unhealthy streak
 *  (null = currently healthy). */
let unhealthySince: number | null = null;
/** Tokens already alerted for the CURRENT episode (one alert per token —
 *  a mid-episode degradation is a new fact, a repeat is not). */
const alertedTokens = new Set<string>();
/** Last status seen (any) — for transition logging. */
let lastSeenStatus: string | null | undefined;

function resetEpisode(): void {
  unhealthySince = null;
  alertedTokens.clear();
}

/** Test seam — wipe the episode state to simulate a cold process. */
export function resetWhatsAppWatchForTests(): void {
  resetEpisode();
  lastSeenStatus = undefined;
  sendFailureTimestamps = [];
}

async function emitChannelAlert(status: string | null, sinceMs: number): Promise<void> {
  // Lazy import — see the import-shape NOTE at the top of the file.
  const { logAdminAlert } = await import("../jobs/alertLogger");
  const token = statusToken(status);
  const minutes = Math.max(1, Math.round((Date.now() - sinceMs) / 60_000));
  const isUnreachable = status === null;
  const title = isUnreachable
    ? "قناة WhatsApp OTP غير قابلة للوصول"
    : `قناة WhatsApp OTP غير جاهزة (${token})`;
  const message = isUnreachable
    ? `تعذّر الوصول إلى بوابة WhatsApp (probe فشل) منذ ~${minutes} دقيقة — لا يمكن تحديد حالة الجلسة. افحص خدمة البوابة على Render ثم لوحة الأدمن (قسم WhatsApp).`
    : `حالة القناة "${token}" مستمرة منذ ~${minutes} دقيقة (ليست ready/settling). ${token === "qr_ready" ? "لم يُكمَل الاقتران — لم يُدخَل رمز QR/رمز الربط خلال هذه المدة." : "الاقتران الحالي غير صالح — القناة تحتاج إعادة ربط من لوحة الأدمن (قسم WhatsApp)."} مستخدمو الدخول عبر WhatsApp يحصلون على فشل إرسال الرمز.`;
  const outcome = await logAdminAlert(
    // A9-4 (R116): "whatsapp_channel" is a declared member of the
    // AlertType union now (jobs/alertLogger.ts) — no cast. The column is
    // a free varchar(30); the union documents what actually flows.
    "whatsapp_channel",
    title,
    message,
    // Same dedupe contract as stockWatcher: {identity} + the 24h default
    // window — the drawer shows a STATE, not a history.
    { dedupeKey: `whatsapp:channel:${token}` },
  );
  logger.info(
    { category: "whatsapp.gateway", status: token, minutes, suppressed: outcome.suppressed },
    "[whatsapp-watch] channel unhealthy alert emitted",
  );
}

async function emitRecoveryAlert(status: string): Promise<void> {
  // Lazy import — see the import-shape NOTE at the top of the file.
  const { logAdminAlert } = await import("../jobs/alertLogger");
  const outcome = await logAdminAlert(
    "whatsapp_channel",
    "قناة WhatsApp OTP استعادت الجاهزية",
    `عادت حالة القناة إلى "${status}" — القناة جاهزة لتدفّق رموز OTP من جديد.`,
    // One-time recovery signal per 24 h window (info severity).
    { dedupeKey: "whatsapp:channel:recovered" },
  );
  logger.info(
    { category: "whatsapp.gateway", status, suppressed: outcome.suppressed },
    "[whatsapp-watch] channel recovery alert emitted",
  );
}

async function observe(observation: WhatsAppChannelObservation): Promise<void> {
  if (observeInFlight) {
    logger.warn(
      { category: "whatsapp.gateway" },
      "[whatsapp-watch] previous observation still being processed — skipping",
    );
    return;
  }
  observeInFlight = true;
  try {
    // Unconfigured deployment — no channel to watch, nothing to page on.
    // Reset any stale episode so a later configuration starts clean.
    if (!observation.configured) {
      resetEpisode();
      lastSeenStatus = undefined;
      return;
    }

    const status = observation.status;
    if (status !== lastSeenStatus) {
      logger.info(
        { category: "whatsapp.gateway", from: lastSeenStatus ?? null, to: status },
        "[whatsapp-watch] channel status transition",
      );
      lastSeenStatus = status;
    }

    if (isHealthyStatus(status)) {
      if (unhealthySince !== null) {
        // Healthy again after an unhealthy episode.
        if (alertedTokens.size > 0) {
          await emitRecoveryAlert(status);
        } else {
          logger.info(
            {
              category: "whatsapp.gateway",
              status,
              wasUnhealthyForMs: Date.now() - unhealthySince,
            },
            "[whatsapp-watch] channel recovered before the alert threshold — no alert, no recovery notice",
          );
        }
        resetEpisode();
      }
      return;
    }

    // Unhealthy observation — the streak (not the token) carries the
    // 15-minute budget; the token only names the alert. A token change
    // mid-streak (qr_ready → failed, failed ↔ disconnected) renames the
    // alert but NEVER restarts the clock — flapping must not dodge it.
    const token = statusToken(status);
    if (unhealthySince === null) {
      unhealthySince = Date.now();
      alertedTokens.clear();
      return;
    }

    if (Date.now() - unhealthySince > UNHEALTHY_ALERT_AFTER_MS && !alertedTokens.has(token)) {
      // Marked BEFORE the await — one alert per token per episode even
      // if the emission itself throws (the catch below swallows it).
      alertedTokens.add(token);
      await emitChannelAlert(status, unhealthySince);
    }
  } catch (err) {
    // Never throw across the caller — log and carry on.
    logger.warn(
      {
        category: "whatsapp.gateway",
        err: err instanceof Error ? err.message : String(err),
      },
      "[whatsapp-watch] observation processing failed (non-fatal)",
    );
  } finally {
    observeInFlight = false;
  }
}

/**
 * Feed one REAL readiness observation into the channel-death watch.
 * Synchronous + fire-and-forget: safe to call from any request path
 * (readiness probe, OTP send) with zero latency or failure coupling.
 */
export function observeWhatsAppChannel(observation: WhatsAppChannelObservation): void {
  void observe(observation);
}

// ── A9-2 (R116): rolling SEND-FAILURE watch ──────────────────────────────
//
// The 15-minute streak watch resets on ANY healthy observation, so an
// INTERMITTENT channel — failing every other OTP send while probing
// `ready` in between — never accumulates an unhealthy streak and never
// alerts: users silently get 503s half the time with no operator signal.
// This counter is the complement: it counts SEND failures in a rolling
// 60-minute window REGARDLESS of interleaved successes, and alerts at
// the 3rd failure within the window (dedupe key
// `whatsapp:sendfails:{token}`, the logAdminAlert 24h window — the same
// stockWatcher contract as the streak alerts).
//
// After an emission attempt (suppressed or not) the window is cleared, so
// a persistently flapping channel re-attempts at most once per 3 failures
// while the DB dedupe keeps the drawer to a state, not a history.
const SEND_FAILURE_ALERT_THRESHOLD = 3;
const SEND_FAILURE_WINDOW_MS = 60 * 60_000;
let sendFailureTimestamps: number[] = [];

async function emitSendFailureAlert(token: string, count: number): Promise<void> {
  // Lazy import — see the import-shape NOTE at the top of the file.
  const { logAdminAlert } = await import("../jobs/alertLogger");
  const outcome = await logAdminAlert(
    "whatsapp_channel",
    "فشل إرسال متكرر عبر قناة WhatsApp OTP",
    `فشلت ${count} محاولات إرسال خلال آخر 60 دقيقة (آخر حالة: "${token}") رغم نجاح محاولات أخرى بينها — القناة تعمل بشكل متقطع. افحص بوابة OpenWA وسجلات الجلسة (لوحة الأدمن، قسم WhatsApp).`,
    { dedupeKey: `whatsapp:sendfails:${token}` },
  );
  logger.info(
    {
      category: "whatsapp.gateway",
      token,
      count,
      suppressed: outcome.suppressed,
    },
    "[whatsapp-watch] rolling send-failure alert emitted",
  );
}

async function recordSendFailure(token: string): Promise<void> {
  const now = Date.now();
  sendFailureTimestamps.push(now);
  // Prune to the rolling window (oldest first).
  while (
    sendFailureTimestamps.length > 0 &&
    now - sendFailureTimestamps[0] > SEND_FAILURE_WINDOW_MS
  ) {
    sendFailureTimestamps.shift();
  }
  if (sendFailureTimestamps.length < SEND_FAILURE_ALERT_THRESHOLD) return;
  const count = sendFailureTimestamps.length;
  // Clear BEFORE the await — the next failure starts a fresh window even
  // if this emission throws (the catch below swallows it), mirroring the
  // alertedTokens-before-await discipline of the streak path.
  sendFailureTimestamps = [];
  await emitSendFailureAlert(token, count);
}

/**
 * Feed one send-failure observation (an OTP send attempt — or the
 * operator warm-up self-check — that exhausted its retries). Synchronous
 * + fire-and-forget; never throws across the caller.
 */
export function observeWhatsAppSendFailure(token: string): void {
  void recordSendFailure(token).catch((err) =>
    logger.warn(
      {
        category: "whatsapp.gateway",
        err: err instanceof Error ? err.message : String(err),
      },
      "[whatsapp-watch] send-failure observation processing failed (non-fatal)",
    ),
  );
}

/** Test seam — await one send-failure observation's internal processing. */
export const observeWhatsAppSendFailureForTests = recordSendFailure;

/**
 * Test seam — feed one observation and AWAIT the internal processing so
 * the state machine is pinnable without timers. Errors are swallowed
 * internally exactly like the fire-and-forget path.
 */
export const observeWhatsAppChannelForTests = observe;
