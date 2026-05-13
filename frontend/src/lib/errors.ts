// Error code enum (must match backend)
export enum ErrorCode {
  // Validation errors
  INVALID_DATA = "INVALID_DATA",
  INVALID_PHONE = "INVALID_PHONE",
  INVALID_PASSWORD_LENGTH = "INVALID_PASSWORD_LENGTH",
  INVALID_PASSWORD_WEAK = "INVALID_PASSWORD_WEAK",
  INVALID_OTP = "INVALID_OTP",
  INVALID_CREDENTIAL = "INVALID_CREDENTIAL",

  // Authentication errors
  UNAUTHORIZED = "UNAUTHORIZED",
  SESSION_EXPIRED = "SESSION_EXPIRED",
  ACCOUNT_LOCKED = "ACCOUNT_LOCKED",
  ACCOUNT_NOT_FOUND = "ACCOUNT_NOT_FOUND",
  PHONE_ALREADY_REGISTERED = "PHONE_ALREADY_REGISTERED",

  // Authorization errors
  FORBIDDEN = "FORBIDDEN",
  INSUFFICIENT_PERMISSIONS = "INSUFFICIENT_PERMISSIONS",

  // Resource errors
  NOT_FOUND = "NOT_FOUND",
  ALREADY_EXISTS = "ALREADY_EXISTS",
  OUT_OF_STOCK = "OUT_OF_STOCK",
  PRODUCT_UNAVAILABLE = "PRODUCT_UNAVAILABLE",

  // Wallet errors
  INSUFFICIENT_BALANCE = "INSUFFICIENT_BALANCE",
  INVALID_AMOUNT = "INVALID_AMOUNT",
  TOPUP_LIMIT_EXCEEDED = "TOPUP_LIMIT_EXCEEDED",

  // Order errors
  ORDER_NOT_FOUND = "ORDER_NOT_FOUND",
  ORDER_ALREADY_COMPLETED = "ORDER_ALREADY_COMPLETED",
  ORDER_CANNOT_CANCEL = "ORDER_CANNOT_CANCEL",

  // Google OAuth errors
  GOOGLE_TOKEN_INVALID = "GOOGLE_TOKEN_INVALID",
  GOOGLE_VERIFICATION_FAILED = "GOOGLE_VERIFICATION_FAILED",

  // Server errors
  INTERNAL_ERROR = "INTERNAL_ERROR",
  SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE",
}

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

  if (typeof err.message === "string" && err.message.trim()) {
    return err.message;
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
