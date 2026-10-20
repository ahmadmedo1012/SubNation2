import { formatCurrency } from "@/lib/utils";

// R136 (FE-2 decomposition): extracted verbatim from pages/checkout.tsx —
// the money-path error-classification helpers (the HTTP-vs-network
// ApiError distinction, the backend error-envelope reader, the
// coupon-failure message test) + the balance chip's formatter. Pure
// functions; ZERO React, zero behavior change (the page and
// PaymentMethodCard import them by name — every call site is
// byte-identical).

// `/api/auth/me` returns the user FLAT ({...formatUser(user), linked_identities})
// — there is no `user` wrapper. The old `data?.user?.wallet_balance` read
// always evaluated to undefined -> balance 0 -> the confirm button was
// permanently disabled for every authed visitor (P0-1, live-confirmed).
// 98-F9: the local MeResponse interface is gone — the balance field is
// typed straight off the generated User contract.

export function formatBalance(value: number | null | undefined): string {
  // R177: no `?? 0` — an absent balance reads «— د.ل» (formatCurrency's
  // R157 honesty contract), never a fabricated «0.00 د.ل».
  return formatCurrency(value);
}

/**
 * R146 (components audit F4): THE ApiError reader — the single
 * classification point for "the server definitively answered (HTTP
 * ApiError, parsed envelope on `.data`)" vs "server state unknown
 * (network failure / unparseable body)". customFetch throws ApiError
 * (an Error subclass with `name: "ApiError"`) for EVERY non-2xx HTTP
 * response, a browser TypeError for network-level failures and
 * ResponseParseError for a garbage 200 body — only the first reads as
 * non-null here. Grew out of the isHttpApiError/apiData pair below
 * (which now delegate to it) and replaces the former per-site
 * duck-typed copies (coupon-quote, WhatsAppPhoneSignIn, product.tsx,
 * telegram-callback.tsx). `status` is undefined only for a non-ApiError;
 * `data` is undefined when the error body was empty or not an object.
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

/**
 * customFetch throws `ApiError` (an Error subclass with `name: "ApiError"`)
 * for EVERY non-2xx HTTP response, and a browser `TypeError` for network-level
 * failures (DNS/offline/request never delivered). The distinction matters for
 * the partial-failure bookkeeping below: an HTTP failure means the server
 * DEFINITIVELY rejected this unit (safe to shrink the cart to the remainder),
 * while a network failure means the server state is UNKNOWN (the request may
 * have landed and charged the wallet) — the cart must be left untouched.
 */
export function isHttpApiError(error: unknown): boolean {
  return readApiError(error) !== null;
}

/**
 * The backend error envelope ({error, code}) carried by an ApiError.
 * 93-C5 / F-15 (A4 #9): the orders route maps several coupon failures to
 * the generic INVALID_DATA code, which getErrorMessage() flattens to
 * "بيانات غير صالحة" — a confusing money-looking error. Prefer the
 * backend's specific Arabic sentence on this path.
 */
export function apiErrorData(error: unknown): { error?: string; code?: string } | null {
  return (readApiError(error)?.data as { error?: string; code?: string } | undefined) ?? null;
}

/**
 * Coupon-family failures (invalid / inactive / expired / maxed / exhausted)
 * — every one of the backend's coupon messages carries the word "كوبون".
 * 93-C5 / F-15 (A4 #9): used to special-case the recovery guidance.
 */
export function isCouponFailureMessage(message: string | undefined): boolean {
  return typeof message === "string" && message.includes("كوبون");
}
