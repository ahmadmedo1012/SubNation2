/**
 * WhatsApp channel-death watch (97-F3 / R97-WA-06).
 *
 * WHY: the 3am production incident — the WhatsApp OTP pairing was revoked
 * (loggedOut) and the session sat in `failed` for HOURS with nobody
 * noticing. Users saw the soft "قيد الربط مؤقتاً" hint and got 503s; the
 * alerting layer (ALERT_RULES) had no WhatsApp rule at all, and
 * `getWhatsAppGatewayReadiness` was only ever consulted when a user
 * happened to load /api/auth/providers. This watcher closes that gap: a
 * periodic ticker that reads the SAME readiness probe and escalates a
 * channel that stays outside {ready, settling} for more than 15 minutes.
 *
 * ── WIRING POINT (main agent — do not miss at integration) ────────────────
 * This module deliberately wires NOTHING into the scheduler on its own
 * (web-scheduler.ts is owned by the main agent this round). Integration
 * is one import + one call inside the LEADER-STARTED branch of
 * backend/src/lib/web-scheduler.ts, right next to the other watchers
 * (see the `startCouponWatcher(), startStockWatcher(), …` push):
 *
 *   import { startWhatsAppChannelWatch } from "../services/whatsapp-watch";
 *   …
 *   watchers.push(startWhatsAppChannelWatch());
 *
 * (server.ts — next to startWhatsAppWarmupLoop() — is an equally valid
 * wiring spot if the main agent prefers keeping both WhatsApp loops
 * together; web-scheduler leadership is the canonical one because it
 * guarantees a single runner under the PG/Redis leader lease.)
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Semantics:
 *   - Tick every 60 s (unref'd interval — never keeps the process alive),
 *     calling getWhatsAppGatewayReadiness(). The probe's own 30 s cache
 *     is ACCEPTED (60 s tick > 30 s TTL → every tick is effectively
 *     fresh, and an occasional cache hit just means one coalesced
 *     observation — the 15-minute escalation budget dwarfs it).
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
 *   - NEVER throws across the timer: every tick is try/catch'd and a
 *     failure is a warn + carry on (scheduler contract, same as the
 *     warm-up loop). Re-entry guard: a hung probe cannot stack
 *     concurrent ticks (same pattern as stockWatcher).
 *
 * NOTE (import shape): logAdminAlert is imported LAZILY inside the emit
 * helpers — same defensive pattern as web-scheduler.ts. A static named
 * import would break link-time for any test that mocks
 * jobs/alertLogger with a partial surface (web-scheduler-demotion.test.ts
 * exports only the two retention helpers); the type-only `AlertType`
 * import is erased at runtime and carries no such risk.
 */

import { logger } from "../lib/logger";
import type { AlertType } from "../jobs/alertLogger";
import { getWhatsAppGatewayReadiness } from "./openwa.service";

/** Handle returned by startWhatsAppChannelWatch (stoppable + idempotent). */
export interface WhatsAppChannelWatchHandle {
  /** Idempotent: stops the interval; an in-flight tick finishes. */
  stop: () => void;
}

const WATCH_INTERVAL_MS = 60_000;
const UNHEALTHY_ALERT_AFTER_MS = 15 * 60_000;

/** States in which the channel can serve OTP traffic (now or within the
 * bounded settle window). Everything else is unhealthy. */
function isHealthyStatus(status: string | null): status is "ready" | "settling" {
  return status === "ready" || status === "settling";
}

/** Dedupe token for an unhealthy status — `null` (gateway unreachable)
 * renders as "unreachable" so the key stays readable + stable. */
function statusToken(status: string | null): string {
  return status ?? "unreachable";
}

// Re-entry guard — a hung probe must not stack concurrent ticks.
let checkInFlight = false;

// ── Episode state (module-scoped: one watched channel by design — the
// OTP routing itself is single-session, R97-WA-11) ──────────────────────────
/** Timestamp of the first observation of the CURRENT unhealthy streak
 * (null = currently healthy). */
let unhealthySince: number | null = null;
/** Tokens already alerted for the CURRENT episode (one alert per token —
 * a mid-episode degradation is a new fact, a repeat is not). */
const alertedTokens = new Set<string>();
/** Last status seen (any) — for transition logging. */
let lastSeenStatus: string | null | undefined;

function resetEpisode(): void {
  unhealthySince = null;
  alertedTokens.clear();
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
    // AlertType is a closed TS union over a free varchar(30) column; the
    // alerts drawer falls back to the "system" badge for unknown types,
    // so a new type string is safe without touching jobs/alertLogger.ts
    // (owned by another agent this round — same cast pattern as
    // refund.service's "refunded_live_credentials").
    "whatsapp_channel" as unknown as AlertType,
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
    "whatsapp_channel" as unknown as AlertType,
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

async function tick(): Promise<void> {
  if (checkInFlight) {
    logger.warn(
      { category: "whatsapp.gateway" },
      "[whatsapp-watch] previous check still in flight — skipping tick",
    );
    return;
  }
  checkInFlight = true;
  try {
    const readiness = await getWhatsAppGatewayReadiness();

    // Unconfigured deployment — no channel to watch, nothing to page on.
    // Reset any stale episode so a later configuration starts clean.
    if (!readiness.configured) {
      resetEpisode();
      lastSeenStatus = undefined;
      return;
    }

    const status = readiness.status;
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
    // Never throw across the timer — log and carry on (probe failures
    // already surface as status:null through the readiness contract, so
    // this is a true unexpected-failure backstop only).
    logger.warn(
      {
        category: "whatsapp.gateway",
        err: err instanceof Error ? err.message : String(err),
      },
      "[whatsapp-watch] tick failed (non-fatal)",
    );
  } finally {
    checkInFlight = false;
  }
}

/**
 * Test seam — run one watch tick on demand (the interval body), so the
 * state machine is pinnable without timers. Errors are swallowed
 * internally exactly like the scheduled path.
 */
export const runWhatsAppChannelWatchTickForTests = (): Promise<void> => tick();

let watchRunning = false;
let stopCurrent: (() => void) | null = null;

export function startWhatsAppChannelWatch(): WhatsAppChannelWatchHandle {
  if (watchRunning) {
    logger.warn(
      { category: "whatsapp.gateway" },
      "[whatsapp-watch] already running — ignoring re-start",
    );
    return { stop: () => stopCurrent?.() };
  }
  watchRunning = true;
  resetEpisode();
  lastSeenStatus = undefined;

  const interval = setInterval(() => void tick(), WATCH_INTERVAL_MS);
  interval.unref?.();
  // Establish the baseline state immediately instead of waiting a full
  // tick — a channel that is ALREADY dead when the watcher boots starts
  // its 15-minute clock right away.
  void tick();

  stopCurrent = () => {
    clearInterval(interval);
    watchRunning = false;
    stopCurrent = null;
    resetEpisode();
    logger.info({ category: "whatsapp.gateway" }, "[whatsapp-watch] stopped");
  };
  const stop = stopCurrent;
  logger.info(
    {
      category: "whatsapp.gateway",
      intervalMs: WATCH_INTERVAL_MS,
      alertAfterMs: UNHEALTHY_ALERT_AFTER_MS,
    },
    "[whatsapp-watch] WhatsApp channel watch started (60s interval, alerts after 15 unhealthy minutes)",
  );
  return { stop: () => stop() };
}
