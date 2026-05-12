// Error codes for specific error handling
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
  INVALID_TOKEN = "INVALID_TOKEN",
  SESSION_EXPIRED = "SESSION_EXPIRED",
  ACCOUNT_LOCKED = "ACCOUNT_LOCKED",
  ACCOUNT_NOT_FOUND = "ACCOUNT_NOT_FOUND",
  PHONE_ALREADY_REGISTERED = "PHONE_ALREADY_REGISTERED",
  FEATURE_DISABLED = "FEATURE_DISABLED",

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

// Error response interface
export interface ErrorResponse {
  error: string;
  code?: ErrorCode;
  details?: Record<string, unknown>;
}

// Helper function to create error responses
export function createErrorResponse(
  message: string,
  code: ErrorCode,
  details?: Record<string, unknown>,
): ErrorResponse {
  return { error: message, code, details };
}
