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
  return formatCurrency(value ?? 0);
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
  return error instanceof Error && error.name === "ApiError";
}

/**
 * The backend error envelope ({error, code}) carried by an ApiError.
 * 93-C5 / F-15 (A4 #9): the orders route maps several coupon failures to
 * the generic INVALID_DATA code, which getErrorMessage() flattens to
 * "بيانات غير صالحة" — a confusing money-looking error. Prefer the
 * backend's specific Arabic sentence on this path.
 */
export function apiErrorData(error: unknown): { error?: string; code?: string } | null {
  if (!isHttpApiError(error)) return null;
  const data = (error as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  return data as { error?: string; code?: string };
}

/**
 * Coupon-family failures (invalid / inactive / expired / maxed / exhausted)
 * — every one of the backend's coupon messages carries the word "كوبون".
 * 93-C5 / F-15 (A4 #9): used to special-case the recovery guidance.
 */
export function isCouponFailureMessage(message: string | undefined): boolean {
  return typeof message === "string" && message.includes("كوبون");
}
