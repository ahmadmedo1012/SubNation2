import { ErrorCode } from "./errors";

/**
 * Map a service-layer `ServiceError` (statusCode + Arabic message, no code)
 * to the documented `{error, code}` envelope ErrorCode.
 *
 * Round-3 audit (M3 / envelope drift): the topup approve/reject routes
 * returned `{error}` without `code`, and several other service-error
 * catch blocks across admin routes did the same. This helper gives every
 * one of them a deterministic, typed code derived from the HTTP status —
 * the status is already the semantic the service chose (404 = not found,
 * 409 = concurrency/state conflict, 400 = invalid state/input).
 *
 * Services that carry their own typed code (AdjustmentError,
 * RefundError) keep their dedicated mappers; this is for the plain
 * `ServiceError` class family.
 */
export function mapServiceErrorToCode(err: { statusCode: number }): ErrorCode {
  switch (err.statusCode) {
    case 400:
      return ErrorCode.INVALID_DATA;
    case 401:
      return ErrorCode.UNAUTHORIZED;
    case 403:
      return ErrorCode.FORBIDDEN;
    case 404:
      return ErrorCode.NOT_FOUND;
    case 409:
      // The topup service uses 409 for both "already processed" state
      // conflicts and optimistic-lock races — both are retry-signals,
      // and CONFLICT is the code the frontend maps to a retry hint.
      return ErrorCode.CONFLICT;
    case 429:
      return ErrorCode.RATE_LIMITED;
    default:
      return ErrorCode.INTERNAL_ERROR;
  }
}
