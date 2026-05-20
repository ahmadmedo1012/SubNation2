/**
 * Telegram business-notification client.
 *
 * Sends transactional messages (orders, signups, topups, stock alerts)
 * to a single operator chat via the Bot API. NOT to be confused with
 * `services/alerting.service.ts` which uses the same env vars but is
 * an SRE rule-engine for ops alerts.
 *
 * ── Reliability contract ────────────────────────────────────────────
 *
 *  - Reads TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID at CALL time, never at
 *    module load. Defends against env-injection ordering issues during
 *    bootstrap and supports operator-side rotation without restart.
 *
 *  - 5-second timeout per attempt via AbortSignal.timeout() so a slow
 *    Telegram API never hangs the request handler that called us.
 *
 *  - Inspects both HTTP status AND the Telegram API body. Telegram
 *    returns `{ok: false, error_code, description}` on 200 in some
 *    cases (e.g. "message is too long"); the previous version missed
 *    those entirely.
 *
 *  - One retry on transient failures (5xx, 429). Honours `retry_after`
 *    from the API body when present, clamped to 5s. Permanent failures
 *    (4xx with bad token / chat_not_found) do NOT retry.
 *
 *  - Every outcome is observable:
 *      • `telegram_sends_total{event, outcome}` counter
 *      • Pino log at debug (success) / warn (transient) / error (final)
 *      • Sentry capture only on permanent failure (post-retry)
 *
 *  - Helpers are self-guarding — when env is unset, dispatchWithDetails
 *    increments `outcome=skip` and returns silently. Callers should NOT
 *    wrap notify*() calls in `if (isTelegramConfigured())` — the helper
 *    handles it. The exported isTelegramConfigured is for status
 *    reporting (admin/settings status, frontend display) only.
 *
 * ── Adding a new notification ───────────────────────────────────────
 *
 *  1. Add a new helper at the bottom of this file using `dispatch()`.
 *  2. Pass an event label string from the EventLabel union below so the
 *     counter cardinality stays bounded.
 *  3. Build the HTML message with the existing helpers (escapeHtml,
 *     formatLyd).
 */

import { logger } from "./lib/logger";
import { safeInc, telegramSendsTotal } from "./lib/metrics";
import { captureSubsystemException } from "./lib/sentry";

// ── Configuration ──────────────────────────────────────────────────────────

const TELEGRAM_API = "https://api.telegram.org";
const HTTP_TIMEOUT_MS = 5_000;
const MAX_ATTEMPTS = 2; // one initial + one retry on transient errors
// Clamp Telegram's retry_after hint. The single retry budget is small
// and the request handler should not block the user-visible code path
// for >5s waiting for a flood-wait. If Telegram demands more, we let
// the second attempt fail and log it — operator-visible signal.
const MAX_RETRY_BACKOFF_MS = 5_000;

/**
 * Bounded set of event labels. Each helper passes its own label when
 * calling `dispatch()` so the metric cardinality stays bounded.
 */
type EventLabel =
  | "order_new"
  | "user_new"
  | "topup_new"
  | "topup_approved"
  | "topup_rejected"
  | "coupon_maxed"
  | "coupon_expiring"
  | "low_stock"
  | "diagnostic";

interface TelegramApiResponse {
  ok: boolean;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
}

// ── Public surface ─────────────────────────────────────────────────────────

/**
 * Whether the bot is configured. Returns false when either env is
 * unset or empty. Read at call time — never cached.
 *
 * Use this for STATUS REPORTING (admin/settings panel, frontend
 * display). Do NOT use it to gate notify*() calls — those are already
 * self-guarding.
 */
export function isTelegramConfigured(): boolean {
  return !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

/**
 * Boot-time configuration probe. Called once from server.ts during
 * startup so the operator sees Telegram readiness in the boot logs
 * without needing to open the admin panel. Never throws.
 */
export function logTelegramBootStatus(): void {
  const configured = isTelegramConfigured();
  logger.info(
    { configured, category: "telegram" },
    configured
      ? "telegram boot: configured (delivery active)"
      : "telegram boot: NOT configured — TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID unset; notifications will be skipped",
  );
}

// ── Notification helpers ───────────────────────────────────────────────────
//
// Each helper formats its specific event and dispatches via the
// shared internal pipeline. All return void by convention
// (fire-and-forget) — failures surface via the metric, log, and
// Sentry, not via the return value. The diagnostic helper is the
// only one that returns a structured result, because the operator
// needs to see what happened.

export function notifyNewUser(phone: string, hadReferral: boolean): void {
  const msg = [
    `🆕 <b>مستخدم جديد</b>`,
    `رقم الهاتف: <code>${escapeHtml(phone)}</code>`,
    hadReferral ? `✅ سجّل عبر إحالة` : null,
  ]
    .filter(Boolean)
    .join("\n");
  void dispatch("user_new", msg);
}

export function notifyNewTopup(phone: string, amount: number, network: string): void {
  const netLabel = network === "madar" ? "مدار" : "ليبيانا";
  const msg = [
    `💰 <b>طلب شحن جديد</b>`,
    `المستخدم: <code>${escapeHtml(phone)}</code>`,
    `المبلغ: <b>${formatLyd(amount)}</b>`,
    `الشبكة: ${netLabel}`,
    ``,
    `⏳ بانتظار الموافقة`,
  ].join("\n");
  void dispatch("topup_new", msg);
}

export function notifyTopupApproved(phone: string, amount: number): void {
  const msg = [
    `✅ <b>شحن موافق عليه</b>`,
    `المستخدم: <code>${escapeHtml(phone)}</code>`,
    `المبلغ: <b>${formatLyd(amount)}</b>`,
  ].join("\n");
  void dispatch("topup_approved", msg);
}

export function notifyTopupRejected(phone: string, amount: number): void {
  const msg = [
    `❌ <b>شحن مرفوض</b>`,
    `المستخدم: <code>${escapeHtml(phone)}</code>`,
    `المبلغ: <b>${formatLyd(amount)}</b>`,
  ].join("\n");
  void dispatch("topup_rejected", msg);
}

export function notifyNewOrder(phone: string, productName: string, amount: number): void {
  const msg = [
    `🛒 <b>طلب جديد</b>`,
    `المستخدم: <code>${escapeHtml(phone)}</code>`,
    `المنتج: <b>${escapeHtml(productName)}</b>`,
    `المبلغ: <b>${formatLyd(amount)}</b>`,
  ].join("\n");
  void dispatch("order_new", msg);
}

export function notifyCouponMaxedOut(code: string, maxUses: number): void {
  const msg = [
    `🎟️ <b>كوبون استُنفد بالكامل</b>`,
    ``,
    `الرمز: <code>${escapeHtml(code)}</code>`,
    `تم استخدامه <b>${maxUses} مرة</b> (الحد الأقصى)`,
    ``,
    `ℹ️ الكوبون لا يزال نشطاً ولكنه لن يقبل استخدامات جديدة.`,
  ].join("\n");
  void dispatch("coupon_maxed", msg);
}

export function notifyCouponExpiringSoon(
  code: string,
  expiresAt: Date,
  hoursLeft: number,
): void {
  const timeLabel = hoursLeft <= 1 ? "أقل من ساعة" : `${Math.floor(hoursLeft)} ساعة`;
  const dateStr = expiresAt.toLocaleDateString("ar-LY", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const msg = [
    `⏰ <b>كوبون يوشك على الانتهاء</b>`,
    ``,
    `الرمز: <code>${escapeHtml(code)}</code>`,
    `ينتهي خلال: <b>${timeLabel}</b>`,
    `وقت الانتهاء: ${dateStr}`,
    ``,
    `يمكنك تمديده أو إيقافه من لوحة الإدارة.`,
  ].join("\n");
  void dispatch("coupon_expiring", msg);
}

export function notifyLowStock(productName: string, stockCount: number): void {
  const urgency = stockCount === 0 ? "🚨 <b>نفاد المخزون</b>" : "⚠️ <b>مخزون منخفض</b>";
  const countStr = stockCount === 0 ? "لا توجد وحدات متبقية" : `${stockCount} وحدة فقط`;
  const msg = [
    urgency,
    ``,
    `المنتج: <b>${escapeHtml(productName)}</b>`,
    `المتوفر: ${countStr}`,
    ``,
    `يرجى إضافة مخزون جديد في أقرب وقت.`,
  ].join("\n");
  void dispatch("low_stock", msg);
}

/**
 * Operator-triggered diagnostic ping. Resolves to a structured result
 * the admin diagnostic endpoint can return verbatim — gives the
 * operator one-click "is the bot reachable?" verification.
 *
 * `hint` is a human-readable, Arabic next-step the admin UI can show
 * verbatim when delivery fails or the system isn't configured.
 */
export async function diagnosticPing(): Promise<{
  configured: boolean;
  delivered: boolean;
  attempts: number;
  errorMessage: string | null;
  hint: string | null;
}> {
  if (!isTelegramConfigured()) {
    return {
      configured: false,
      delivered: false,
      attempts: 0,
      errorMessage: null,
      hint: "اضبط TELEGRAM_BOT_TOKEN و TELEGRAM_CHAT_ID في إعدادات Render، ثم أعد النشر.",
    };
  }
  const text = [
    `🔧 <b>اختبار الإشعارات</b>`,
    ``,
    `هذه رسالة اختبار من لوحة الإدارة لتأكيد قابلية وصول البوت.`,
    `الوقت: <code>${new Date().toISOString()}</code>`,
  ].join("\n");
  const result = await dispatchWithDetails("diagnostic", text);
  return {
    configured: true,
    delivered: result.outcome === "ok",
    attempts: result.attempts,
    errorMessage: result.errorMessage,
    hint:
      result.outcome === "ok"
        ? null
        : hintForError(result.errorMessage),
  };
}

// ── Internals ──────────────────────────────────────────────────────────────

/**
 * Fire-and-forget wrapper around dispatchWithDetails. Returns true on
 * delivery, false on skip-or-failure. Used by every notify*() helper.
 */
async function dispatch(event: EventLabel, text: string): Promise<boolean> {
  const result = await dispatchWithDetails(event, text);
  return result.outcome === "ok";
}

/**
 * Final outcome of a single dispatch call. Note: `outcome="retry"` is
 * NOT reachable here — retries are loop-internal. The metric counter
 * (`telegram_sends_total`) tracks the broader 4-state {ok|skip|retry|
 * failure} space; this type tracks only what the caller observes.
 */
interface DispatchResult {
  outcome: "ok" | "skip" | "failure";
  attempts: number;
  errorMessage: string | null;
}

async function dispatchWithDetails(event: EventLabel, text: string): Promise<DispatchResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    safeInc(telegramSendsTotal, { event, outcome: "skip" });
    logger.debug({ event, category: "telegram" }, "telegram dispatch: skip (env not configured)");
    return { outcome: "skip", attempts: 0, errorMessage: null };
  }

  let attempts = 0;
  let lastError: string | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    attempts = attempt;
    try {
      const response = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });

      const body = (await response.json().catch(() => null)) as TelegramApiResponse | null;

      if (response.ok && body?.ok) {
        safeInc(telegramSendsTotal, { event, outcome: "ok" });
        logger.debug(
          { event, status: response.status, category: "telegram" },
          "telegram dispatch: ok",
        );
        return { outcome: "ok", attempts, errorMessage: null };
      }

      // Non-ok: distinguish transient (retryable) from permanent.
      const errorCode = body?.error_code ?? response.status;
      const description = body?.description ?? response.statusText ?? "unknown";
      const transient =
        response.status >= 500 || response.status === 429 || errorCode === 429;

      lastError = `Telegram ${errorCode}: ${description}`;

      if (transient && attempt < MAX_ATTEMPTS) {
        const retryAfterMs = (body?.parameters?.retry_after ?? 1) * 1000;
        safeInc(telegramSendsTotal, { event, outcome: "retry" });
        logger.warn(
          {
            event,
            status: response.status,
            errorCode,
            description,
            retryAfterMs,
            category: "telegram",
          },
          "telegram dispatch: transient — retrying",
        );
        await sleep(Math.min(retryAfterMs, MAX_RETRY_BACKOFF_MS));
        continue;
      }

      // Permanent failure (4xx with bad token / chat_not_found / etc.).
      safeInc(telegramSendsTotal, { event, outcome: "failure" });
      logger.error(
        { event, status: response.status, errorCode, description, category: "telegram" },
        "telegram dispatch: failure (permanent)",
      );
      captureSubsystemException("telegram", new Error(lastError), {
        event,
        status: response.status,
        errorCode,
      });
      return { outcome: "failure", attempts, errorMessage: lastError };
    } catch (err) {
      // Network / DNS / TLS / timeout. Treat first occurrence as
      // transient so we get one retry; retain final error if both fail.
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < MAX_ATTEMPTS) {
        safeInc(telegramSendsTotal, { event, outcome: "retry" });
        logger.warn(
          { event, err: lastError, category: "telegram" },
          "telegram dispatch: network — retrying",
        );
        await sleep(500);
        continue;
      }
      safeInc(telegramSendsTotal, { event, outcome: "failure" });
      logger.error(
        { event, err: lastError, category: "telegram" },
        "telegram dispatch: failure (network)",
      );
      captureSubsystemException("telegram", err, { event });
      return { outcome: "failure", attempts, errorMessage: lastError };
    }
  }

  // Exhausted retries — defensive bookkeeping; the loop above always
  // returns before reaching here, but TypeScript can't see that.
  safeInc(telegramSendsTotal, { event, outcome: "failure" });
  return { outcome: "failure", attempts, errorMessage: lastError ?? "exhausted" };
}

/**
 * Map a raw Telegram error string to a short, Arabic, operator-actionable
 * hint. Best-effort — the diagnostic UI shows both the raw error and
 * this hint, so a generic fallback is fine.
 */
function hintForError(errorMessage: string | null): string | null {
  if (!errorMessage) return null;
  const lower = errorMessage.toLowerCase();
  if (lower.includes("chat not found")) {
    return "أضف البوت إلى المحادثة وحدّث TELEGRAM_CHAT_ID بمعرّف المحادثة الصحيح.";
  }
  if (lower.includes("unauthorized") || lower.includes("401")) {
    return "التوكن غير صالح. ولّد توكن جديداً عبر @BotFather وحدّث TELEGRAM_BOT_TOKEN.";
  }
  if (lower.includes("forbidden") || lower.includes("bot was blocked")) {
    return "البوت محظور أو مُزال من المحادثة. أعد إضافته كمسؤول.";
  }
  if (lower.includes("timeout") || lower.includes("aborted")) {
    return "انتهت مهلة الاتصال بـ api.telegram.org. تحقق من شبكة الخادم.";
  }
  return "راجع لوحة Sentry والسجل لمعرفة التفاصيل.";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Minimal HTML escape sufficient for Telegram's parse_mode=HTML.
 * Telegram only honours a specific tag set — escaping &, <, > prevents
 * a user-supplied product name (or coupon code, or any external input
 * we splice into the message) from breaking the message render or
 * being interpreted as markup.
 */
function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatLyd(amount: number): string {
  return `${amount.toFixed(2)} د.ل`;
}
