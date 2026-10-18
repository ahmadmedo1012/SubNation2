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

  // Admin AI copilot family (round-3: previously unmapped in the
  // frontend, surfacing raw English in Arabic toasts).
  COPILOT_INVALID_INPUT: "COPILOT_INVALID_INPUT",
  COPILOT_LLM_ERROR: "COPILOT_LLM_ERROR",
  COPILOT_NO_ADMIN_SESSION: "COPILOT_NO_ADMIN_SESSION",
  COPILOT_BAD_METHOD: "COPILOT_BAD_METHOD",

  // Admin AI copilot preview/execution family (round-92 B3/F-05: the
  // copilot routes returned these codes while they existed in neither
  // this enum nor the openapi ErrorCode enum — the enum contract was a
  // lie for that family. Emitted by
  // backend/src/routes/admin/copilot/{previews,ask,draft,settings}.ts).
  COPILOT_PREVIEW_NOT_FOUND: "COPILOT_PREVIEW_NOT_FOUND",
  COPILOT_PREVIEW_CONSUMED: "COPILOT_PREVIEW_CONSUMED",
  COPILOT_PREVIEW_EXPIRED: "COPILOT_PREVIEW_EXPIRED",
  COPILOT_HANDOFF_REQUIRED: "COPILOT_HANDOFF_REQUIRED",
  COPILOT_HIGH_RISK_DISABLED: "COPILOT_HIGH_RISK_DISABLED",
  COPILOT_STALE_RECORD: "COPILOT_STALE_RECORD",
  COPILOT_UNEXPECTED_STATE: "COPILOT_UNEXPECTED_STATE",
  COPILOT_EXECUTE_FAILED: "COPILOT_EXECUTE_FAILED",
  COPILOT_NOT_HIGH_RISK: "COPILOT_NOT_HIGH_RISK",
  COPILOT_FIRST_CONFIRM_MISSING: "COPILOT_FIRST_CONFIRM_MISSING",
  COPILOT_COOLDOWN_NOT_ELAPSED: "COPILOT_COOLDOWN_NOT_ELAPSED",
  COPILOT_LLM_UNAVAILABLE: "COPILOT_LLM_UNAVAILABLE",
  COPILOT_OUT_OF_SCOPE: "COPILOT_OUT_OF_SCOPE",
  COPILOT_INVALID_FLAGS: "COPILOT_INVALID_FLAGS",

  // Round-93 (93-A8 F-8): emitted by the copilot rate limiter
  // (backend/src/lib/copilot/rate-limit.ts) on 429 with
  // retry_after_seconds + window extras — previously outside the
  // enum/spec/map contract ("the enum must stay exhaustive over what
  // the backend actually emits").
  COPILOT_RATE_LIMITED: "COPILOT_RATE_LIMITED",

  // Round-93 (93-A8 F-15): emitted by the CSRF gate's fail-closed
  // misconfiguration branch (app.ts) when the allow-list is empty at
  // runtime. Rare/ops-facing, but the enum-exhaustiveness guarantee
  // applies to it too.
  CSRF_CONFIG: "CSRF_CONFIG",

  // Round-94 (A5-05): the last two codes the copilot routes actually
  // emit that previously lived outside the enum/spec contract — the
  // phase-gate 503 (middlewares/requireCopilotPhase.ts) and the
  // outbound secret-scan 502 abort (routes/admin/copilot/{ask,draft}.ts).
  // Same 93-A8 F-8/F-15 class: the enum must stay exhaustive over what
  // the backend actually emits.
  COPILOT_PHASE_DISABLED: "COPILOT_PHASE_DISABLED",
  COPILOT_SECRET_LEAK: "COPILOT_SECRET_LEAK",

  // Round-R166 (B10+B11): the error-code truth reconciliation.
  // ADDED (B11): five codes the backend actually emits that existed
  // in no registry/spec/map — PRODUCT_STALE / VARIANT_STALE (the
  // checkout in-tx product/variant freshness re-checks riding the
  // retryable CONCURRENCY_ERROR envelope;
  // backend/src/services/checkout.service.ts, shaped at
  // backend/src/routes/orders.ts) and the copilot admin-request tool
  // loop trio (path-allowlist refusal, the SEC-92-03
  // mutation-confirmation gate, loopback fetch failure;
  // backend/src/services/copilot/admin-request-tool.ts).
  // RETIRED (B10): ten registered codes with ZERO backend emission
  // (verified per-code grep of both `ErrorCode.<NAME>` and string
  // literal sites): INVALID_PHONE, INVALID_PASSWORD_WEAK,
  // INVALID_OTP, INVALID_CREDENTIAL, PHONE_ALREADY_REGISTERED,
  // ORDER_ALREADY_COMPLETED, ORDER_CANNOT_CANCEL,
  // PRODUCT_UNAVAILABLE, GOOGLE_TOKEN_INVALID,
  // GOOGLE_VERIFICATION_FAILED.
  PRODUCT_STALE: "PRODUCT_STALE",
  VARIANT_STALE: "VARIANT_STALE",
  COPILOT_PATH_BLOCKED: "COPILOT_PATH_BLOCKED",
  COPILOT_CONFIRMATION_REQUIRED: "COPILOT_CONFIRMATION_REQUIRED",
  COPILOT_LOOPBACK_FAILED: "COPILOT_LOOPBACK_FAILED",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
