/**
 * Canonical machine-readable error codes for the {error, code} envelope.
 *
 * Round-3 (8-a §1D — the ErrorCode enum was maintained TWICE, in
 * backend/src/lib/errors.ts and frontend/src/lib/errors.ts, and had
 * already drifted once: the CONFLICT/INVALID_TOKEN/FEATURE_DISABLED
 * lag incident). This module is now the SINGLE source both sides
 * re-export. Only the Arabic message map stays frontend-specific; only
 * express-specific helpers stay backend-specific.
 *
 * A const object (not a TS `enum`) so the value list is iterable and
 * tree-shakeable across bundlers; the type alias keeps exhaustive
 * Record<> checks working exactly like the old enums.
 */
export const ErrorCode = {
  // Validation errors
  INVALID_DATA: "INVALID_DATA",
  INVALID_PHONE: "INVALID_PHONE",
  INVALID_PASSWORD_LENGTH: "INVALID_PASSWORD_LENGTH",
  INVALID_PASSWORD_WEAK: "INVALID_PASSWORD_WEAK",
  INVALID_OTP: "INVALID_OTP",
  INVALID_CREDENTIAL: "INVALID_CREDENTIAL",

  // Authentication errors
  UNAUTHORIZED: "UNAUTHORIZED",
  INVALID_TOKEN: "INVALID_TOKEN",
  SESSION_EXPIRED: "SESSION_EXPIRED",
  ACCOUNT_LOCKED: "ACCOUNT_LOCKED",
  ACCOUNT_NOT_FOUND: "ACCOUNT_NOT_FOUND",
  PHONE_ALREADY_REGISTERED: "PHONE_ALREADY_REGISTERED",
  FEATURE_DISABLED: "FEATURE_DISABLED",

  // Authorization errors
  FORBIDDEN: "FORBIDDEN",
  INSUFFICIENT_PERMISSIONS: "INSUFFICIENT_PERMISSIONS",

  // Resource errors
  NOT_FOUND: "NOT_FOUND",
  ALREADY_EXISTS: "ALREADY_EXISTS",
  CONFLICT: "CONFLICT",
  OUT_OF_STOCK: "OUT_OF_STOCK",
  PRODUCT_UNAVAILABLE: "PRODUCT_UNAVAILABLE",

  // Wallet errors
  INSUFFICIENT_BALANCE: "INSUFFICIENT_BALANCE",
  INVALID_AMOUNT: "INVALID_AMOUNT",
  TOPUP_LIMIT_EXCEEDED: "TOPUP_LIMIT_EXCEEDED",

  // Order errors
  ORDER_NOT_FOUND: "ORDER_NOT_FOUND",
  ORDER_ALREADY_COMPLETED: "ORDER_ALREADY_COMPLETED",
  ORDER_CANNOT_CANCEL: "ORDER_CANNOT_CANCEL",

  // Google OAuth errors
  GOOGLE_TOKEN_INVALID: "GOOGLE_TOKEN_INVALID",
  GOOGLE_VERIFICATION_FAILED: "GOOGLE_VERIFICATION_FAILED",

  // Server errors
  INTERNAL_ERROR: "INTERNAL_ERROR",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",

  // Rate limiting (round-3: promoted from literal strings in limiter
  // messages so every throttled response shares the typed code).
  RATE_LIMITED: "RATE_LIMITED",

  // Idempotency middleware codes (round-3 envelope standardization).
  IDEMPOTENCY_IN_FLIGHT: "IDEMPOTENCY_IN_FLIGHT",
  IDEMPOTENCY_KEY_REUSE: "IDEMPOTENCY_KEY_REUSE",

  // Admin AI copilot family (round-3: previously unmapped in the
  // frontend, surfacing raw English in Arabic toasts).
  COPILOT_INVALID_INPUT: "COPILOT_INVALID_INPUT",
  COPILOT_LLM_ERROR: "COPILOT_LLM_ERROR",
  COPILOT_NO_ADMIN_SESSION: "COPILOT_NO_ADMIN_SESSION",
  COPILOT_BAD_METHOD: "COPILOT_BAD_METHOD",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Every code as a plain array — CI guards and tooling iterate this. */
export const ALL_ERROR_CODES: readonly ErrorCode[] = Object.values(ErrorCode);
