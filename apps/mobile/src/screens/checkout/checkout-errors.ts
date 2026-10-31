/**
 * Money-path error classification — the native port of the web's
 * components/checkout/checkout-errors.ts: the ApiError-vs-network
 * distinction, the backend error-envelope reader, and the coupon-family
 * message test. Pure functions, zero React.
 */

/**
 * customFetch throws `ApiError` (an Error subclass with
 * `name: "ApiError"`) for EVERY non-2xx HTTP response, and a TypeError
 * for network-level failures (request never delivered / timeout). The
 * distinction is the money-path contract: an HTTP failure means the
 * server DEFINITIVELY rejected this unit (safe to shrink the cart to
 * the un-bought remainder); a network failure means the server state
 * is UNKNOWN (the request may have landed and charged the wallet) —
 * the cart must be left untouched so a retry replays the same intent.
 */
export function readApiError(
  error: unknown,
): { status?: number; data?: Record<string, unknown> } | null {
  if (!(error instanceof Error) || error.name !== "ApiError") return null;
  const status = (error as { status?: unknown }).status;
  const data = (error as { data?: unknown }).data;
  return {
    status: typeof status === "number" ? status : undefined,
    data: data && typeof data === "object" ? (data as Record<string, unknown>) : undefined,
  };
}

export function isHttpApiError(error: unknown): boolean {
  return readApiError(error) !== null;
}

/**
 * The backend error envelope ({error, code}) carried by an ApiError.
 * Coupon failures map to the generic INVALID_DATA code in getErrorMessage,
 * so this path prefers the backend's specific Arabic sentence.
 */
export function apiErrorData(error: unknown): { error?: string; code?: string } | null {
  return (readApiError(error)?.data as { error?: string; code?: string } | undefined) ?? null;
}

/** Coupon-family failures — every backend coupon message carries «كوبون». */
export function isCouponFailureMessage(message: string | undefined): boolean {
  return typeof message === "string" && message.includes("كوبون");
}
