import { loadIntentKey, persistIntentKey, clearIntentKey } from "@/lib/intent-envelope";

// R135 (FE-3 decomposition): extracted verbatim from pages/product.tsx —
// the money-page's single-purchase intent-key helpers moved to their own
// module so the page file shrinks to orchestration. Pure functions over
// localStorage; ZERO React, zero behavior change (the page imports them
// by name — every call site, TTL and fingerprint stays byte-identical).
// R146 (components audit F3): the {k,t,f} envelope mechanics (parse +
// TTL + fingerprint validation, guarded persist/clear) moved to
// lib/intent-envelope.ts — this module keeps the slot scheme, TTL and
// fingerprint builder.

// ── 97-F5 (R97-A4 §2 / F-02 — money P2): stable single-purchase intent key ──
//
// The buy-intent Idempotency-Key used to live in a useRef — it died with
// the component, so a refresh / back-navigation / PWA cold-resume after
// a NETWORK-level failure (response lost, wallet already charged) minted
// a FRESH key on the re-tap → a second order and a second deduction (the
// exact window 96-F4 closed for checkout, which stores its keys in
// sessionStorage — this page now mirrors that pattern exactly).
//
// Lifecycle (lazy — minted on the intent's first attempt):
//   • read:   a stored key is REUSED verbatim when still valid → the retry
//             of an unresolved intent replays the server's cached response
//             instead of charging again (this is the double-charge fix).
//   • write:  BEFORE the request, under subnation_buykey:{productId},
//             stamped with the mint time + the intent fingerprint
//             (productId × effective price × coupon code).
//   • delete: ONLY at a definitive resolution —
//       - 2xx success (the order was created and shown);
//       - an HTTP-level ApiError rejection (the server definitively
//         refused — a re-tap is a NEW intent and must not be answered
//         forever by the cached rejection).
//     A network-level failure (server state unknown) deliberately KEEPS
//     the stored key — the retry must replay, not re-charge.
//   • staleness guards (F-07's lesson, applied here at birth — the
//     envelope's TTL + fingerprint checks, see lib/intent-envelope.ts):
//       - TTL: a key older than 10 minutes no longer represents the
//         user's live intent and is ignored (minted fresh instead) — a
//         stale key must not swallow a NEW purchase hours later via the
//         server's 24 h replay window;
//       - fingerprint: a price/coupon change invalidates the stored key
//         so a stale intent is never replayed onto changed data (and the
//         backend's same-key-different-body 409 branch stays unreachable).
//
// localStorage (durable) rather than sessionStorage (per-tab) — R102
// (R102-A1 F1 / P1, mirroring checkout.tsx): the retry token must
// outlive the tab exactly as long as the user's intent can — a network-
// level loss (server committed, response lost) followed by tab death
// used to mint a FRESH key on the next visit and charge twice. The
// TTL + fingerprint guards minted at birth (97-F5) already make stale
// keys inert, so durability costs nothing.
const BUY_KEY_PREFIX = "subnation_buykey:";
/** 97-F5 (F-02): retry-token TTL — mirrors the inspection's 10 min guidance. */
const BUY_KEY_TTL_MS = 10 * 60 * 1000;

function buyIntentKeyId(productId: number): string {
  return `${BUY_KEY_PREFIX}${productId}`;
}

/** Binds the stored key to WHAT the user is buying right now — a replay
 * must only answer the intent it was minted for. */
export function buyIntentFingerprint(
  productId: number,
  effectivePrice: number | null | undefined,
  couponCode?: string | null,
  variantId?: number | null,
): string {
  return `${productId}|${effectivePrice ?? ""}|${(couponCode ?? "").trim().toUpperCase()}|${variantId ?? ""}`;
}

/** R115-I1 (A7 P2-2): cent-exact price equality for the pre-buy
 * re-quote — floating-point sums must never turn an unchanged price
 * into a spurious "price changed" abort. */
export function toCents(value: number): number {
  return Math.round(value * 100);
}

export function loadBuyIntentKey(productId: number, fingerprint: string): string | null {
  return loadIntentKey(localStorage, buyIntentKeyId(productId), BUY_KEY_TTL_MS, fingerprint);
}

export function persistBuyIntentKey(productId: number, fingerprint: string, key: string): void {
  persistIntentKey(localStorage, buyIntentKeyId(productId), fingerprint, key);
}

export function clearBuyIntentKey(productId: number): void {
  clearIntentKey(localStorage, buyIntentKeyId(productId));
}
