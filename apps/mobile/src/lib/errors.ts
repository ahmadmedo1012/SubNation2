// Arabic error-message mapping — ported 1:1 from the web
// (frontend/src/lib/errors.ts, rounds 93-C8 / 96-F7 / R126-L2 / R167-E)
// so the native app shows the exact same user language for every
// backend ErrorCode, with the same Arabic-script trust filter.
import { ErrorCode } from "@workspace/error-codes";

export { ErrorCode };

const errorMessages: Record<ErrorCode, string> = {
  [ErrorCode.INVALID_DATA]: "بيانات غير صالحة",
  [ErrorCode.INVALID_PASSWORD_LENGTH]: "كلمة المرور يجب أن تكون 8 أحرف على الأقل",
  [ErrorCode.UNAUTHORIZED]: "غير مصرح — سجّل دخولك مرة أخرى وحاول",
  [ErrorCode.SESSION_EXPIRED]: "جلسة منتهية. يرجى تسجيل الدخول مرة أخرى",
  [ErrorCode.ACCOUNT_LOCKED]: "الحساب مقفل مؤقتاً بسبب محاولات فاشلة. حاول مرة أخرى بعد قليل",
  [ErrorCode.ACCOUNT_NOT_FOUND]: "المستخدم غير موجود",
  [ErrorCode.FORBIDDEN]: "لا تملك صلاحية الوصول إلى هذه الصفحة",
  [ErrorCode.INSUFFICIENT_PERMISSIONS]: "صلاحياتك غير كافية",
  [ErrorCode.NOT_FOUND]: "الصفحة أو العنصر المطلوب غير موجود",
  [ErrorCode.ALREADY_EXISTS]: "هذا الحساب أو الطلب موجود بالفعل",
  [ErrorCode.OUT_OF_STOCK]: "المنتج غير متوفر حالياً. حاول مرة أخرى لاحقاً",
  [ErrorCode.INSUFFICIENT_BALANCE]: "رصيد المحفظة غير كافٍ. يرجى شحن المحفظة أولاً",
  [ErrorCode.INVALID_AMOUNT]: "المبلغ غير صالح",
  [ErrorCode.TOPUP_LIMIT_EXCEEDED]: "تجاوزت الحد الأقصى لطلبات الشحن المعلقة",
  [ErrorCode.ORDER_NOT_FOUND]: "الطلب غير موجود",
  [ErrorCode.INTERNAL_ERROR]: "حدث خطأ في الخادم. حاول مرة أخرى",
  [ErrorCode.SERVICE_UNAVAILABLE]: "الخدمة غير متاحة حالياً. حاول مرة أخرى بعد قليل",
  [ErrorCode.CONFLICT]: "تعارض في العملية. حاول مرة أخرى بعد لحظات",
  [ErrorCode.INVALID_TOKEN]: "رمز الجلسة غير صالح. سجّل الدخول مرة أخرى",
  [ErrorCode.FEATURE_DISABLED]: "هذه الميزة معطّلة حالياً",
  [ErrorCode.RATE_LIMITED]: "تم تجاوز الحد الأقصى للطلبات. حاول مرة أخرى بعد دقيقة",
  [ErrorCode.IDEMPOTENCY_IN_FLIGHT]:
    "طلب سابق بنفس المعرف لا يزال قيد المعالجة. حاول مرة أخرى بعد قليل",
  [ErrorCode.IDEMPOTENCY_KEY_REUSE]: "تمت إعادة استخدام معرف العملية مع طلب مختلف",
  [ErrorCode.CSRF_CONFIG]:
    "تعذّر التحقق الأمني من الطلب (خلل في إعدادات الخادم) — يرجى إبلاغ الدعم",
  [ErrorCode.PRODUCT_STALE]: "تغيّر سعر المنتج أو تفاصيله — راجع السلة ثم أعد المحاولة",
  [ErrorCode.VARIANT_STALE]: "تغيّر تفاصيل الخيار المحدد — راجع السلة ثم أعد المحاولة",
};

type ErrorLike = {
  code?: string;
  error?: string;
  message?: string;
  data?: { error?: string; code?: string } | null;
};

function asErrorLike(error: unknown): ErrorLike | null {
  if (typeof error !== "object" || error === null) return null;
  return error as ErrorLike;
}

const ARABIC_SCRIPT_RE = /[\u0600-\u06FF]/;

const GENERIC_SERVER_ERROR_AR = "تعذّر الاتصال بالخدمة. تحقق من اتصالك وحاول مرة أخرى.";

export const NETWORK_ERROR_DESCRIPTION = "حدث خطأ في الاتصال — تحقّق من شبكتك ثم أعد المحاولة";

function trustedServerMessage(raw: string): string {
  return ARABIC_SCRIPT_RE.test(raw) ? raw : GENERIC_SERVER_ERROR_AR;
}

function arabicServerMessage(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed && ARABIC_SCRIPT_RE.test(trimmed) ? trimmed : null;
}

export function getErrorMessage(error: unknown): string {
  const err = asErrorLike(error);
  if (!err) return "حدث خطأ. حاول مرة أخرى";

  // Specific Arabic server wording outranks the per-code map (R126-L2).
  const specificServerMessage =
    arabicServerMessage(err.error) ?? arabicServerMessage(err.data?.error);
  if (specificServerMessage) return specificServerMessage;

  if (err.code && errorMessages[err.code as ErrorCode]) {
    return errorMessages[err.code as ErrorCode];
  }

  if (err.data?.code && errorMessages[err.data.code as ErrorCode]) {
    return errorMessages[err.data.code as ErrorCode];
  }

  if (err.error) {
    return trustedServerMessage(err.error);
  }

  if (err.data && typeof err.data === "object" && "error" in err.data) {
    const d = (err.data as { error?: string }).error;
    if (typeof d === "string" && d) return trustedServerMessage(d);
  }

  // Network-level failures (TypeError("Failed to fetch")) — Arabic copy.
  if (error instanceof TypeError) {
    return NETWORK_ERROR_DESCRIPTION;
  }

  return GENERIC_SERVER_ERROR_AR;
}
