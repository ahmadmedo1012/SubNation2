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

/**
 * Input options for {@link notifyNewUser}.
 *
 * Exported so callers (auth-settings handlers, the auth route, and
 * any future signup pipeline) can pass typed objects through helper
 * functions without re-inlining the shape at every callsite.
 */
export interface NotifyNewUserInput {
  phone: string;
  userId?: number;
  hadReferral: boolean;
  /** Auth provider used for sign-up: "telegram" | "firebase" | "email" | etc. */
  provider?: string | null;
}

export function notifyNewUser(input: NotifyNewUserInput): void {
  const msg = [
    `🆕 <b>مستخدم جديد</b>`,
    `رقم الهاتف: <code>${escapeHtml(input.phone)}</code>`,
    input.provider ? `طريقة التسجيل: <b>${providerLabel(input.provider)}</b>` : null,
    input.hadReferral ? `✅ سجّل عبر إحالة` : null,
    timestampLine(),
  ]
    .filter(Boolean)
    .join("\n");
  void dispatch("user_new", msg, buttonsForUser(input.userId));
}

/** Input options for {@link notifyNewTopup}. */
export interface NotifyNewTopupInput {
  phone: string;
  amount: number;
  network: string;
  topupId?: number;
  provider?: string | null;
}

export function notifyNewTopup(input: NotifyNewTopupInput): void {
  const netLabel = input.network === "madar" ? "مدار" : "ليبيانا";
  const msg = [
    `💰 <b>طلب شحن جديد</b>`,
    `المستخدم: <code>${escapeHtml(input.phone)}</code>`,
    input.provider ? `الحساب: <b>${providerLabel(input.provider)}</b>` : null,
    `المبلغ: <b>${formatLyd(input.amount)}</b>`,
    `الشبكة: ${netLabel}`,
    input.topupId ? `معرّف الطلب: <code>#${input.topupId}</code>` : null,
    timestampLine(),
    ``,
    `⏳ بانتظار الموافقة`,
  ]
    .filter(Boolean)
    .join("\n");
  void dispatch("topup_new", msg, buttonsForTopup());
}

/**
 * Input options for {@link notifyTopupApproved} and
 * {@link notifyTopupRejected}. Both notifications share the same
 * payload shape so they share a single input type.
 */
export interface NotifyTopupOutcomeInput {
  phone: string;
  amount: number;
  topupId?: number;
}

export function notifyTopupApproved(input: NotifyTopupOutcomeInput): void {
  const msg = [
    `✅ <b>شحن موافق عليه</b>`,
    `المستخدم: <code>${escapeHtml(input.phone)}</code>`,
    `المبلغ: <b>${formatLyd(input.amount)}</b>`,
    input.topupId ? `معرّف الطلب: <code>#${input.topupId}</code>` : null,
    timestampLine(),
  ]
    .filter(Boolean)
    .join("\n");
  void dispatch("topup_approved", msg);
}

export function notifyTopupRejected(input: NotifyTopupOutcomeInput): void {
  const msg = [
    `❌ <b>شحن مرفوض</b>`,
    `المستخدم: <code>${escapeHtml(input.phone)}</code>`,
    `المبلغ: <b>${formatLyd(input.amount)}</b>`,
    input.topupId ? `معرّف الطلب: <code>#${input.topupId}</code>` : null,
    timestampLine(),
  ]
    .filter(Boolean)
    .join("\n");
  void dispatch("topup_rejected", msg);
}

/** Input options for {@link notifyNewOrder}. */
export interface NotifyNewOrderInput {
  phone: string;
  productName: string;
  amount: number;
  orderId?: number;
  orderCode?: string | null;
  provider?: string | null;
}

export function notifyNewOrder(input: NotifyNewOrderInput): void {
  const msg = [
    `🛒 <b>طلب جديد</b>`,
    `المستخدم: <code>${escapeHtml(input.phone)}</code>`,
    input.provider ? `الحساب: <b>${providerLabel(input.provider)}</b>` : null,
    `المنتج: <b>${escapeHtml(input.productName)}</b>`,
    `المبلغ: <b>${formatLyd(input.amount)}</b>`,
    input.orderCode ? `الرمز: <code>${escapeHtml(input.orderCode)}</code>` : null,
    timestampLine(),
  ]
    .filter(Boolean)
    .join("\n");
  void dispatch("order_new", msg, buttonsForOrder(input.orderId));
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

/** Input options for {@link notifyLowStock}. */
export interface NotifyLowStockInput {
  productName: string;
  stockCount: number;
  productId?: number;
}

export function notifyLowStock(input: NotifyLowStockInput): void {
  const urgency = input.stockCount === 0 ? "🚨 <b>نفاد المخزون</b>" : "⚠️ <b>مخزون منخفض</b>";
  const countStr =
    input.stockCount === 0 ? "لا توجد وحدات متبقية" : `${input.stockCount} وحدة فقط`;
  const msg = [
    urgency,
    ``,
    `المنتج: <b>${escapeHtml(input.productName)}</b>`,
    `المتوفر: ${countStr}`,
    timestampLine(),
    ``,
    `يرجى إضافة مخزون جديد في أقرب وقت.`,
  ].join("\n");
  void dispatch("low_stock", msg, buttonsForProduct(input.productId));
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
async function dispatch(
  event: EventLabel,
  text: string,
  inlineKeyboard?: InlineKeyboard,
): Promise<boolean> {
  const result = await dispatchWithDetails(event, text, inlineKeyboard);
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

async function dispatchWithDetails(
  event: EventLabel,
  text: string,
  inlineKeyboard?: InlineKeyboard,
): Promise<DispatchResult> {
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
          ...(inlineKeyboard && inlineKeyboard.length > 0
            ? { reply_markup: { inline_keyboard: inlineKeyboard } }
            : {}),
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

// ── Inline-keyboard helpers ────────────────────────────────────────────────
//
// Telegram inline_keyboard buttons let the operator jump straight to
// the relevant admin page from the notification, instead of opening
// the app and navigating. Buttons hit our /admin routes which are
// auth-gated — clicking lands the operator on the admin login if
// they're not already signed in, then bounces them to the requested
// page after auth.

type InlineKeyboardButton = {
  text: string;
  url: string;
};
type InlineKeyboard = InlineKeyboardButton[][];

/**
 * Resolve the canonical app origin for deep links. Reads APP_URL or
 * VITE_APP_ORIGIN env (operator-configured) and falls back to the
 * production host. Trailing slashes stripped.
 *
 * Returns null if no origin is resolvable — callers MUST handle this
 * by skipping the inline_keyboard entirely so we never emit a broken
 * relative-URL button.
 */
function appUrl(): string | null {
  const raw = (process.env.APP_URL || process.env.VITE_APP_ORIGIN || "").trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

function buttonsForOrder(orderId?: number): InlineKeyboard | undefined {
  const origin = appUrl();
  if (!origin || !orderId) return undefined;
  return [[{ text: "📋 فتح الطلب", url: `${origin}/admin/orders` }]];
}

function buttonsForTopup(): InlineKeyboard | undefined {
  const origin = appUrl();
  if (!origin) return undefined;
  return [
    [{ text: "💰 مراجعة طلبات الشحن", url: `${origin}/admin/topups` }],
  ];
}

function buttonsForUser(userId?: number): InlineKeyboard | undefined {
  const origin = appUrl();
  if (!origin || !userId) return undefined;
  return [[{ text: "👤 فتح المستخدمين", url: `${origin}/admin/users` }]];
}

function buttonsForProduct(productId?: number): InlineKeyboard | undefined {
  const origin = appUrl();
  if (!origin || !productId) return undefined;
  return [[{ text: "📦 إدارة المنتج", url: `${origin}/admin/products` }]];
}

/**
 * Map our internal provider tags to a short Arabic label for display
 * in Telegram messages. Keeps the operator-visible vocabulary
 * consistent across notifications and decouples the storage tag from
 * the display string. Unknown providers fall through verbatim.
 */
function providerLabel(provider: string): string {
  const normalized = provider.toLowerCase().trim();
  switch (normalized) {
    case "telegram":
    case "telegram.org":
      return "تيليجرام";
    case "firebase":
    case "google":
    case "google.com":
      return "Google";
    case "phone":
    case "firebase-phone":
      return "هاتف (Firebase)";
    case "email":
    case "password":
      return "بريد إلكتروني";
    default:
      return provider;
  }
}

/**
 * Localized timestamp line ("الوقت: …") rendered in Libya time
 * (Africa/Tripoli, UTC+2). Compact format so the message stays
 * readable on mobile Telegram.
 */
function timestampLine(): string {
  const now = new Date();
  const formatted = now.toLocaleString("ar-LY", {
    timeZone: "Africa/Tripoli",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `الوقت: <code>${escapeHtml(formatted)}</code>`;
}
