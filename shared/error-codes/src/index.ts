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
  INVALID_PASSWORD_LENGTH: "INVALID_PASSWORD_LENGTH",

  // Authentication errors
  UNAUTHORIZED: "UNAUTHORIZED",
  INVALID_TOKEN: "INVALID_TOKEN",
  SESSION_EXPIRED: "SESSION_EXPIRED",
  ACCOUNT_LOCKED: "ACCOUNT_LOCKED",
  ACCOUNT_NOT_FOUND: "ACCOUNT_NOT_FOUND",
  FEATURE_DISABLED: "FEATURE_DISABLED",

  // Authorization errors
  FORBIDDEN: "FORBIDDEN",
  INSUFFICIENT_PERMISSIONS: "INSUFFICIENT_PERMISSIONS",

  // Resource errors
  NOT_FOUND: "NOT_FOUND",
  ALREADY_EXISTS: "ALREADY_EXISTS",
  CONFLICT: "CONFLICT",
  OUT_OF_STOCK: "OUT_OF_STOCK",

  // Wallet errors
  INSUFFICIENT_BALANCE: "INSUFFICIENT_BALANCE",
  INVALID_AMOUNT: "INVALID_AMOUNT",
  TOPUP_LIMIT_EXCEEDED: "TOPUP_LIMIT_EXCEEDED",

  // Order errors
  ORDER_NOT_FOUND: "ORDER_NOT_FOUND",

  // Server errors
  INTERNAL_ERROR: "INTERNAL_ERROR",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",

  // Rate limiting (round-3: promoted from literal strings in limiter
  // messages so every throttled response shares the typed code).
  RATE_LIMITED: "RATE_LIMITED",

  // Idempotency middleware codes (round-3 envelope standardization).
  IDEMPOTENCY_IN_FLIGHT: "IDEMPOTENCY_IN_FLIGHT",
  IDEMPOTENCY_KEY_REUSE: "IDEMPOTENCY_KEY_REUSE",

  // Round-93 (93-A8 F-15): emitted by the CSRF gate's fail-closed
  // misconfiguration branch (app.ts) when the allow-list is empty at
  // runtime. Rare/ops-facing, but the enum-exhaustiveness guarantee
  // applies to it too.
  CSRF_CONFIG: "CSRF_CONFIG",

  // Round-R166 (B10+B11): the error-code truth reconciliation.
  // ADDED (B11): PRODUCT_STALE / VARIANT_STALE (the checkout in-tx
  // product/variant freshness re-checks riding the retryable
  // CONCURRENCY_ERROR envelope; backend/src/services/checkout.service.ts,
  // shaped at backend/src/routes/orders.ts). The copilot admin-request
  // tool loop trio that landed here the same round left with the
  // copilot feature in R181.
  // RETIRED (B10): ten registered codes with ZERO backend emission
  // (verified per-code grep of both `ErrorCode.<NAME>` and string
  // literal sites): INVALID_PHONE, INVALID_PASSWORD_WEAK,
  // INVALID_OTP, INVALID_CREDENTIAL, PHONE_ALREADY_REGISTERED,
  // ORDER_ALREADY_COMPLETED, ORDER_CANNOT_CANCEL,
  // PRODUCT_UNAVAILABLE, GOOGLE_TOKEN_INVALID,
  // GOOGLE_VERIFICATION_FAILED.
  PRODUCT_STALE: "PRODUCT_STALE",
  VARIANT_STALE: "VARIANT_STALE",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
