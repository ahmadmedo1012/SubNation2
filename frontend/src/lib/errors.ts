// Error code enum (must match backend)
// Round-3 (8-a §1D): the enum moved to @workspace/error-codes (shared
// with the backend) so the two sides can never drift again — the
// CONFLICT/INVALID_TOKEN lag incident was exactly this class of bug.
import { ErrorCode } from "@workspace/error-codes";

export { ErrorCode };

// Arabic error messages for each error code
// 93-C8 (A11 §10 + A8 F-8/F-15): wording follows A11 — user-facing
// nouns instead of developer jargon (المورد/العنصر), a next step on
// UNAUTHORIZED, passwordless-honest INVALID_CREDENTIAL (the code itself
// retired R166 — zero backend emission), and CSRF_CONFIG. The
// COPILOT_* family left with the copilot feature in R181.
const errorMessages: Record<ErrorCode, string> = {
  // Validation errors
  [ErrorCode.INVALID_DATA]: "بيانات غير صالحة",
  [ErrorCode.INVALID_PASSWORD_LENGTH]: "كلمة المرور يجب أن تكون 8 أحرف على الأقل",

  // Authentication errors
  // A11 §10: bare «غير مصرح» gave the user no next step.
  [ErrorCode.UNAUTHORIZED]: "غير مصرح — سجّل دخولك مرة أخرى وحاول",
  [ErrorCode.SESSION_EXPIRED]: "جلسة منتهية. يرجى تسجيل الدخول مرة أخرى",
  [ErrorCode.ACCOUNT_LOCKED]: "الحساب مقفل مؤقتاً بسبب محاولات فاشلة. حاول مرة أخرى بعد قليل",
  [ErrorCode.ACCOUNT_NOT_FOUND]: "المستخدم غير موجود",

  // Authorization errors
  // A11 §10: «المورد» is developer jargon — users understand pages.
  [ErrorCode.FORBIDDEN]: "لا تملك صلاحية الوصول إلى هذه الصفحة",
  [ErrorCode.INSUFFICIENT_PERMISSIONS]: "صلاحياتك غير كافية",

  // Resource errors
  [ErrorCode.NOT_FOUND]: "الصفحة أو العنصر المطلوب غير موجود",
  [ErrorCode.ALREADY_EXISTS]: "هذا الحساب أو الطلب موجود بالفعل",
  [ErrorCode.OUT_OF_STOCK]: "المنتج غير متوفر حالياً. حاول مرة أخرى لاحقاً",

  // Wallet errors
  [ErrorCode.INSUFFICIENT_BALANCE]: "رصيد المحفظة غير كافٍ. يرجى شحن المحفظة أولاً",
  [ErrorCode.INVALID_AMOUNT]: "المبلغ غير صالح",
  [ErrorCode.TOPUP_LIMIT_EXCEEDED]: "تجاوزت الحد الأقصى لطلبات الشحن المعلقة",

  // Order errors
  [ErrorCode.ORDER_NOT_FOUND]: "الطلب غير موجود",

  // Server errors
  [ErrorCode.INTERNAL_ERROR]: "حدث خطأ في الخادم. حاول مرة أخرى",
  [ErrorCode.SERVICE_UNAVAILABLE]: "الخدمة غير متاحة حالياً. حاول مرة أخرى بعد قليل",

  // P2 (deep-audit 2026-09-06): catch up with the backend enum
  [ErrorCode.CONFLICT]: "تعارض في العملية. حاول مرة أخرى بعد لحظات",
  [ErrorCode.INVALID_TOKEN]: "رمز الجلسة غير صالح. سجّل الدخول مرة أخرى",
  [ErrorCode.FEATURE_DISABLED]: "هذه الميزة معطّلة حالياً",
  [ErrorCode.RATE_LIMITED]: "تم تجاوز الحد الأقصى للطلبات. حاول مرة أخرى بعد دقيقة",
  [ErrorCode.IDEMPOTENCY_IN_FLIGHT]:
    "طلب سابق بنفس المعرف لا يزال قيد المعالجة. حاول مرة أخرى بعد قليل",
  [ErrorCode.IDEMPOTENCY_KEY_REUSE]: "تمت إعادة استخدام معرف العملية مع طلب مختلف",

  // Round-93 (93-A8 F-15): CSRF gate fail-closed misconfiguration
  // branch — ops-facing, surfaces to admins as a hard 403.
  [ErrorCode.CSRF_CONFIG]:
    "تعذّر التحقق الأمني من الطلب (خلل في إعدادات الخادم) — يرجى إبلاغ الدعم",

  // Round-R166 (B11): codes the backend actually emits that were
  // previously in no registry/spec/map — the map stays exhaustive
  // over the shared enum. The checkout in-tx staleness pair first
  // (user-facing register — the retryable 409 re-price guidance):
  [ErrorCode.PRODUCT_STALE]: "تغيّر سعر المنتج أو تفاصيله — راجع السلة ثم أعد المحاولة",
  [ErrorCode.VARIANT_STALE]: "تغيّر تفاصيل الخيار المحدد — راجع السلة ثم أعد المحاولة",
};

type ErrorLike = {
  code?: string;
  error?: string;
  message?: string;
  response?: { data?: { error?: string; code?: string } };
  data?: { error?: string; code?: string } | null;
};

function asErrorLike(error: unknown): ErrorLike | null {
  if (typeof error !== "object" || error === null) return null;
  return error as ErrorLike;
}

// ── 96-F7 (R96 A6 #14): technical-message leak guard ──────────────────────
// The fallthrough paths below (`err.error`, envelope `error` strings,
// raw `message`) used to pass ANY string to the user verbatim. Every
// message this app's own backend authors is Arabic (the map above +
// the server's `error` bodies), so a string with NO Arabic script is,
// by construction, a technical/English string from a middleware layer
// (customFetch's "HTTP 404 Not Found" prefix, a proxy's "Bad Gateway",
// an HTTP-status line, an enum code). Those collapse to the generic
// Arabic message instead of landing raw inside an Arabic toast.
// Detection is script-based, not an allowlist of exact strings, so new
// Arabic server messages keep flowing through with zero maintenance.
const ARABIC_SCRIPT_RE = /[\u0600-\u06FF]/;

/** The shared Arabic fallback for any message we cannot trust to be
 *  user-language (network-level failures and middleware English). */
const GENERIC_SERVER_ERROR_AR = "تعذّر الاتصال بالخدمة. تحقق من اتصالك وحاول مرة أخرى.";

// R167-E (F15): THE single source for the generic network-error copy —
// page-level fetch-failure descriptions import this constant, never re-type it.
export const NETWORK_ERROR_DESCRIPTION = "حدث خطأ في الاتصال — تحقّق من شبكتك ثم أعد المحاولة";

/** Pass through only messages that visibly carry Arabic script (the
 *  server's own wording); everything else gets the Arabic fallback. */
function trustedServerMessage(raw: string): string {
  return ARABIC_SCRIPT_RE.test(raw) ? raw : GENERIC_SERVER_ERROR_AR;
}

// ── R126-L2 (A3-3): specific-server-message priority ───────────────────────
// The backend pairs a SPECIFIC Arabic message with a generic code on its
// re-auth surfaces (wrong current-password on /change-password,
// /profile and /2fa/setup → 401 «كلمة المرور الحالية غير صحيحة» +
// UNAUTHORIZED). The code map used to win that pairing, rendering the
// map's «غير مصرح — سجّل دخولك مرة أخرى وحاول» — actively misleading:
// the session was valid, the typed password was wrong. The server's own
// wording now outranks the map whenever it is present and Arabic-script
// (the 96-F7 leak guard still gates what counts as "the server's
// wording" — middleware English never passes); the code map stays the
// fallback for message-less and technical (non-Arabic) bodies. Same
// direction the hand-rolled funnels already chose (users.tsx R115
// describeSaveError, WhatsAppPhoneSignIn 96-F2).
function arabicServerMessage(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed && ARABIC_SCRIPT_RE.test(trimmed) ? trimmed : null;
}

// Helper function to get error message from error code
export function getErrorMessage(error: unknown): string {
  const err = asErrorLike(error);
  if (!err) return "حدث خطأ. حاول مرة أخرى";

  // R126-L2 (A3-3): a specific, Arabic-script server message (the
  // route's own wording — body `error`, ApiError `.data.error`, or the
  // axios-style `response.data.error`) outranks the generic per-code
  // map below. The map remains the fallback for message-less bodies,
  // and a non-Arabic (middleware/technical) message falls through to it
  // instead of collapsing to the network-generic copy.
  const specificServerMessage =
    arabicServerMessage(err.error) ??
    arabicServerMessage(err.data?.error) ??
    arabicServerMessage(err.response?.data?.error);
  if (specificServerMessage) return specificServerMessage;

  // If error has a code, map it to Arabic message
  if (err.code && errorMessages[err.code as ErrorCode]) {
    return errorMessages[err.code as ErrorCode];
  }

  // Check if error is from axios with response data
  if (err.response?.data?.code && errorMessages[err.response.data.code as ErrorCode]) {
    return errorMessages[err.response.data.code as ErrorCode];
  }

  // ApiError-style payloads (customFetch)
  if (err.data?.code && errorMessages[err.data.code as ErrorCode]) {
    return errorMessages[err.data.code as ErrorCode];
  }

  // If error has an error field, use it directly (for backward compatibility)
  // 96-F7 (R96 A6 #14): only Arabic-script strings pass through — raw
  // English from middleware layers ("Forbidden", "HTTP 404", enum
  // codes…) falls back to the Arabic generic message.
  if (err.error) {
    return trustedServerMessage(err.error);
  }

  if (err.data && typeof err.data === "object" && "error" in err.data) {
    const d = (err.data as { error?: string }).error;
    if (typeof d === "string" && d) return trustedServerMessage(d);
  }

  // Check if error is from axios with response data
  if (err.response?.data?.error) {
    return trustedServerMessage(err.response.data.error);
  }

  // Round-3 (8-e §1/§7): network-level failures surfaced as English —
  // browser TypeError("Failed to fetch") and customFetch's
  // "HTTP 502 Bad Gateway: …" prefix landed verbatim in Arabic toasts.
  // Detect the known network-failure shapes and speak Arabic.
  // 96-F7 (R96 A6 #14): the HTTP-prefix check now catches EVERY status
  // code (4xx included — "HTTP 404 Not Found" from customFetch used to
  // slip through the 5xx-only regex). customFetch messages look like
  // "HTTP <status> <statusText>" or "HTTP <status> <statusText>: <server
  // message>" — the prefix is technical, so it is stripped; the server
  // suffix survives only when it carries Arabic script (a known Arabic
  // server message). A bare "HTTP 404 Not Found" (no usable suffix)
  // falls back to the generic Arabic message. Any OTHER non-Arabic
  // message (middleware English, HTML fragments, enum codes) collapses
  // the same way.
  const message = typeof err.message === "string" ? err.message.trim() : "";
  if (message) {
    if (/^HTTP \d{3}/.test(message)) {
      const sep = message.indexOf(":");
      const detail = sep >= 0 ? message.slice(sep + 1).trim() : "";
      return detail && ARABIC_SCRIPT_RE.test(detail) ? detail : GENERIC_SERVER_ERROR_AR;
    }
    if (
      message === "Failed to fetch" ||
      message === "NetworkError when attempting to fetch resource." ||
      message === "Load failed"
    ) {
      return GENERIC_SERVER_ERROR_AR;
    }
    return trustedServerMessage(message);
  }

  if (error instanceof Error && error.message) {
    // Same leak guard as above for the direct Error branch.
    return trustedServerMessage(error.message);
  }

  // Fallback to generic error
  return "حدث خطأ. حاول مرة أخرى";
}
