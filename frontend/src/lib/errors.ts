// Error code enum (must match backend)
// Round-3 (8-a §1D): the enum moved to @workspace/error-codes (shared
// with the backend) so the two sides can never drift again — the
// CONFLICT/INVALID_TOKEN lag incident was exactly this class of bug.
import { ErrorCode } from "@workspace/error-codes";

export { ErrorCode };

// Arabic error messages for each error code
const errorMessages: Record<ErrorCode, string> = {
  // Validation errors
  [ErrorCode.INVALID_DATA]: "بيانات غير صالحة",
  [ErrorCode.INVALID_PHONE]: "رقم الهاتف غير صالح. يجب أن يبدأ بـ 091 أو 092 أو 093 أو 094",
  [ErrorCode.INVALID_PASSWORD_LENGTH]: "كلمة المرور يجب أن تكون 8 أحرف على الأقل",
  [ErrorCode.INVALID_PASSWORD_WEAK]: "كلمة المرور ضعيفة جداً. يرجى استخدام كلمة مرور أقوى",
  [ErrorCode.INVALID_OTP]: "كود التحقق غير صحيح أو منتهي الصلاحية",
  [ErrorCode.INVALID_CREDENTIAL]: "رقم الهاتف أو كلمة المرور غير صحيحة",

  // Authentication errors
  [ErrorCode.UNAUTHORIZED]: "غير مصرح",
  [ErrorCode.SESSION_EXPIRED]: "جلسة منتهية. يرجى تسجيل الدخول مرة أخرى",
  [ErrorCode.ACCOUNT_LOCKED]: "الحساب مقفل بسبب محاولات فاشلة. حاول لاحقاً",
  [ErrorCode.ACCOUNT_NOT_FOUND]: "المستخدم غير موجود",
  [ErrorCode.PHONE_ALREADY_REGISTERED]: "رقم الهاتف مسجل مسبقاً",

  // Authorization errors
  [ErrorCode.FORBIDDEN]: "ليس لديك صلاحية للوصول إلى هذا المورد",
  [ErrorCode.INSUFFICIENT_PERMISSIONS]: "صلاحياتك غير كافية",

  // Resource errors
  [ErrorCode.NOT_FOUND]: "المورد المطلوب غير موجود",
  [ErrorCode.ALREADY_EXISTS]: "هذا العنصر موجود بالفعل",
  [ErrorCode.OUT_OF_STOCK]: "المنتج غير متوفر حالياً. حاول لاحقاً",
  [ErrorCode.PRODUCT_UNAVAILABLE]: "المنتج غير متاح حالياً",

  // Wallet errors
  [ErrorCode.INSUFFICIENT_BALANCE]: "رصيد المحفظة غير كافٍ. يرجى شحن المحفظة أولاً",
  [ErrorCode.INVALID_AMOUNT]: "المبلغ غير صالح",
  [ErrorCode.TOPUP_LIMIT_EXCEEDED]: "تجاوزت الحد الأقصى لطلبات الشحن المعلقة",

  // Order errors
  [ErrorCode.ORDER_NOT_FOUND]: "الطلب غير موجود",
  [ErrorCode.ORDER_ALREADY_COMPLETED]: "الطلب مكتمل بالفعل",
  [ErrorCode.ORDER_CANNOT_CANCEL]: "لا يمكن إلغاء هذا الطلب",

  // Google OAuth errors
  [ErrorCode.GOOGLE_TOKEN_INVALID]: "رمز Google غير صالح",
  [ErrorCode.GOOGLE_VERIFICATION_FAILED]: "فشل التحقق من Google. حاول مرة أخرى",

  // Server errors
  [ErrorCode.INTERNAL_ERROR]: "حدث خطأ في الخادم. حاول مرة أخرى",
  [ErrorCode.SERVICE_UNAVAILABLE]: "الخدمة غير متاحة حالياً. حاول لاحقاً",

  // P2 (deep-audit 2026-09-06): catch up with the backend enum
  [ErrorCode.CONFLICT]: "تعارض في العملية. أعد المحاولة بعد لحظات",
  [ErrorCode.INVALID_TOKEN]: "رمز الجلسة غير صالح. سجّل الدخول مرة أخرى",
  [ErrorCode.FEATURE_DISABLED]: "هذه الميزة معطّلة حالياً",
  [ErrorCode.RATE_LIMITED]: "تم تجاوز الحد الأقصى للطلبات. حاول مرة أخرى بعد دقيقة",
  [ErrorCode.COPILOT_INVALID_INPUT]: "طلب غير صالح للمساعد الذكي",
  [ErrorCode.COPILOT_LLM_ERROR]: "تعذر الوصول إلى المساعد الذكي. حاول مرة أخرى",
  [ErrorCode.COPILOT_NO_ADMIN_SESSION]: "جلسة المسؤول مطلوبة لاستخدام المساعد الذكي",
  [ErrorCode.COPILOT_BAD_METHOD]: "طريقة طلب غير مدعومة",
  [ErrorCode.IDEMPOTENCY_IN_FLIGHT]: "طلب سابق بنفس المعرف لا يزال قيد المعالجة. حاول بعد قليل",
  [ErrorCode.IDEMPOTENCY_KEY_REUSE]: "تمت إعادة استخدام معرف العملية مع طلب مختلف",

  // Round-92 (B3 F-05): copilot preview/execution family — the enum
  // contract previously omitted these codes; the map must stay
  // exhaustive over Record<ErrorCode, string>.
  [ErrorCode.COPILOT_PREVIEW_NOT_FOUND]: "المعاينة غير موجودة",
  [ErrorCode.COPILOT_PREVIEW_CONSUMED]: "المعاينة استُهلكت بالفعل",
  [ErrorCode.COPILOT_PREVIEW_EXPIRED]: "انتهت صلاحية المعاينة",
  [ErrorCode.COPILOT_HANDOFF_REQUIRED]: "هذا الإجراء يتطلب تنفيذاً يدوياً من صفحة الإدارة",
  [ErrorCode.COPILOT_HIGH_RISK_DISABLED]: "تنفيذ الإجراءات عالية الخطورة معطّل حالياً",
  [ErrorCode.COPILOT_STALE_RECORD]: "تغيّرت حالة المعاينة. أعد المحاولة",
  [ErrorCode.COPILOT_UNEXPECTED_STATE]: "حالة غير متوقعة للمعاينة. أعد المحاولة",
  [ErrorCode.COPILOT_EXECUTE_FAILED]: "فشل تنفيذ الإجراء. حاول مرة أخرى",
  [ErrorCode.COPILOT_NOT_HIGH_RISK]: "هذا الإجراء لا يتطلب تأكيداً ثانياً",
  [ErrorCode.COPILOT_FIRST_CONFIRM_MISSING]: "التأكيد الأول مطلوب قبل التأكيد الثاني",
  [ErrorCode.COPILOT_COOLDOWN_NOT_ELAPSED]: "لم تنتهِ مهلة الانتظار بعد. حاول بعد لحظات",
  [ErrorCode.COPILOT_LLM_UNAVAILABLE]: "خدمة المساعد الذكي غير متاحة حالياً",
  [ErrorCode.COPILOT_OUT_OF_SCOPE]: "ليست لديك صلاحية لاستخدام هذه الميزة",
  [ErrorCode.COPILOT_INVALID_FLAGS]: "إعدادات مراحل المساعد غير صالحة",
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

// Helper function to get error message from error code
export function getErrorMessage(error: unknown): string {
  const err = asErrorLike(error);
  if (!err) return "حدث خطأ. حاول مرة أخرى";

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
  if (err.error) {
    return err.error;
  }

  if (err.data && typeof err.data === "object" && "error" in err.data) {
    const d = (err.data as { error?: string }).error;
    if (typeof d === "string" && d) return d;
  }

  // Check if error is from axios with response data
  if (err.response?.data?.error) {
    return err.response.data.error;
  }

  // Round-3 (8-e §1/§7): network-level failures surfaced as English —
  // browser TypeError("Failed to fetch") and customFetch's
  // "HTTP 502 Bad Gateway: …" prefix landed verbatim in Arabic toasts.
  // Detect the known network-failure shapes and speak Arabic.
  const message = typeof err.message === "string" ? err.message.trim() : "";
  if (message) {
    if (
      message === "Failed to fetch" ||
      message === "NetworkError when attempting to fetch resource." ||
      message === "Load failed" ||
      /^HTTP 5\d\d/.test(message)
    ) {
      return "تعذّر الاتصال بالخدمة. تحقق من اتصالك وحاول مرة أخرى.";
    }
    return message;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  // Fallback to generic error
  return "حدث خطأ. حاول مرة أخرى";
}

// Helper function to check if error is a specific type
export function isErrorCode(error: unknown, code: ErrorCode): boolean {
  const err = asErrorLike(error);
  if (!err) return false;
  return err.code === code || err.response?.data?.code === code || err.data?.code === code;
}
