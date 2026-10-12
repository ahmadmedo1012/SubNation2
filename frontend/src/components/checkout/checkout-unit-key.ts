import type { LocalCartItem } from "@/lib/cart";

// R136 (FE-2 decomposition): extracted verbatim from pages/checkout.tsx —
// the money-page's per-unit Idempotency-Key lifecycle (the 96-F4
// double-charge guard) moved to its own module so the page file shrinks
// to orchestration. Pure functions over localStorage; ZERO React, zero
// behavior change (handleConfirm imports them by name — every call
// site, TTL and fingerprint stays byte-identical).

/**
 * 96-F4 (R96 A4 §2.2 — money P1): stable per-unit Idempotency-Key storage.
 *
 * The unit loop below used to call generateIdempotencyKey() inline on every
 * confirm click, so a manual retry after a NETWORK-level failure (the outer
 * catch deliberately keeps the cart — server state unknown) minted NEW keys
 * for units whose request may already have committed → double charge on
 * flaky mobile links. The backend guard (Redis replay + durable in-tx check,
 * routes/orders.ts) can only dedupe when it sees the SAME key twice — so the
 * key must survive the retry attempt.
 *
 * Lifecycle (lazy — a key is minted only when its unit is first attempted):
 *   • read:   reuse a stored key when one exists → a retry of an unresolved
 *             unit replays the server's cached response instead of charging
 *             again (this is the double-charge fix).
 *   • write:  at generation time, under
 *             subnation_checkout_key:{productId}:{unitIndex}
 *   • delete: ONLY at a definitive resolution —
 *       - a per-unit HTTP rejection (ApiError): cleared in the catch below so
 *         a retry of that unit isn't answered forever by the cached error;
 *       - accounted 2xx successes: cleared in the cart-sync step, NOT at the
 *         per-unit 2xx. The network-failure path intentionally skips the
 *         cart-sync, so the cart still contains the already-charged units on
 *         retry — deleting their keys there would re-charge them under fresh
 *         keys. The sync step (which runs on every definitive flow outcome:
 *         partial HTTP failure AND full success) is the safe deletion point.
 *
 * localStorage (durable) rather than sessionStorage (per-tab) — R102
 * (R102-A1 F1 / P1): the cart itself lives in localStorage and survives
 * tab death, but the retry tokens used to die with the tab. Scenario the
 * sessionStorage choice opened: server commits the purchase → response
 * lost (network) → user closes the tab → cart still holds the charged
 * unit → re-confirm mints a FRESH key → the durable server layer sees a
 * new key → a full second purchase and a second debit.
 *
 * AUD103-2-F7 (r103) — scope honesty: the durability is BOUNDED by the
 * 98-F2 TTL below (10 minutes). A user returning MORE than 10 minutes
 * after a lost response still mints a fresh key (the stored one is
 * treated as a stale intent); that residual window is the documented
 * 98-F2 trade-off — a longer TTL would let ancient keys swallow
 * genuinely new purchases via the 24 h server replay window. Every
 * access is try/catch-guarded: a private-mode / quota failure just
 * degrades to the old unstable-key behavior, it never blocks the money
 * path.
 *
 * 98-F2 (r97 F-07, deferred queue): the raw key gained the 97-F5 buy-key's
 * TWO staleness guards, which the checkout keys never had — a stored key
 * lived until its terminal resolution, so a key minted hours/days earlier
 * in a long-lived tab could swallow a genuinely NEW purchase via the
 * server's 24 h replay window:
 *   • TTL: a key older than 10 minutes no longer represents the user's
 *     live intent and is ignored (minted fresh instead);
 *   • fingerprint: the line's product / variant / coupon / unit price —
 *     the exact body fields the backend's same-key-different-body 409
 *     branch compares, plus the price context (a post-reconcile price
 *     change is a NEW intent, never a replay of the old charge).
 */
const CHECKOUT_KEY_PREFIX = "subnation_checkout_key:";
/** 98-F2 (r97 F-07): retry-token TTL — mirrors the 97-F5 buy-key guidance. */
const CHECKOUT_KEY_TTL_MS = 10 * 60 * 1000;

interface StoredCheckoutUnitKey {
  /** The Idempotency-Key header value. */
  k: string;
  /** Date.now() at mint time — the TTL stamp. */
  t: number;
  /** Intent fingerprint — productId | variantId | coupon | unit price. */
  f: string;
}

function checkoutUnitKeyId(productId: number, variantId: number | null, unitIndex: number): string {
  // AUD103-2-F1 (r103): the slot is LINE-scoped (productId + variantId).
  // The pre-fix `${productId}:${unitIndex}` slot collided across two cart
  // lines of the same product with different variants — the sibling
  // line's persist OVERWROTE an unresolved unit's durable key, so a retry
  // after a network failure minted a fresh key and DOUBLE-CHARGED that
  // unit (the 98-F2 fingerprint prevented wrong-variant replay but could
  // not prevent overwrite). Matches the cart lineKey convention
  // (lib/cart.tsx: `${productId}:${variantId ?? 0}`).
  return `${CHECKOUT_KEY_PREFIX}${productId}:${variantId ?? 0}:${unitIndex}`;
}

/** AUD103-2-F1 (r103): one-time sweep of pre-r103 slots (the un-scoped
 * `${productId}:${unitIndex}` shape — 2 numeric segments). They are inert
 * under the line-scoped reads; removing them keeps storage clean. Runs
 * lazily at the start of a confirm, never inside the money path. */
export function purgeLegacyCheckoutUnitKeys(): void {
  try {
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(CHECKOUT_KEY_PREFIX)) {
        const tail = k.slice(CHECKOUT_KEY_PREFIX.length);
        // New shape: "<pid>:<variant>:<unit>" (3 segments); legacy: 2.
        if (tail.split(":").length === 2) stale.push(k);
      }
    }
    for (const k of stale) localStorage.removeItem(k);
  } catch {
    // ignore — hygiene only
  }
}

/** 98-F2 (r97 F-07): binds a stored unit key to WHAT that unit order buys
 * — mirrors product.tsx's buyIntentFingerprint (97-F5). */
export function checkoutUnitFingerprint(
  line: Pick<LocalCartItem, "productId" | "variantId" | "priceLYD" | "salePriceLYD">,
  couponCode: string,
): string {
  const unitPrice = line.salePriceLYD ?? line.priceLYD;
  return `${line.productId}|${line.variantId ?? ""}|${couponCode.trim().toUpperCase()}|${unitPrice}`;
}

export function loadCheckoutUnitKey(
  productId: number,
  variantId: number | null,
  unitIndex: number,
  fingerprint: string,
): string | null {
  try {
    const raw = localStorage.getItem(checkoutUnitKeyId(productId, variantId, unitIndex));
    if (!raw) return null;
    // Pre-98-F2 entries were raw uuid strings — JSON.parse throws → the
    // entry is treated as absent and a fresh key is minted (the old
    // un-stamped keys carry no TTL/fingerprint contract to honor).
    const parsed = JSON.parse(raw) as Partial<StoredCheckoutUnitKey>;
    if (typeof parsed.k !== "string" || !parsed.k) return null;
    // TTL — a key minted >10 min ago is a stale intent, not this retry.
    if (typeof parsed.t !== "number" || Number.isNaN(parsed.t)) return null;
    if (Date.now() - parsed.t > CHECKOUT_KEY_TTL_MS) return null;
    // Intent binding — the unit body (product/variant/coupon) or the
    // line's effective price changed since the key was minted: replaying
    // it onto the new data would either swallow a genuinely new purchase
    // or trip the backend's same-key-different-body 409.
    if (parsed.f !== fingerprint) return null;
    return parsed.k;
  } catch {
    return null;
  }
}

export function persistCheckoutUnitKey(
  productId: number,
  variantId: number | null,
  unitIndex: number,
  fingerprint: string,
  key: string,
): void {
  try {
    const entry: StoredCheckoutUnitKey = { k: key, t: Date.now(), f: fingerprint };
    localStorage.setItem(checkoutUnitKeyId(productId, variantId, unitIndex), JSON.stringify(entry));
  } catch {
    // degraded: unstable keys (pre-fix behavior) — never throw on money path
  }
}

export function clearCheckoutUnitKey(
  productId: number,
  variantId: number | null,
  unitIndex: number,
): void {
  try {
    localStorage.removeItem(checkoutUnitKeyId(productId, variantId, unitIndex));
  } catch {
    // ignore
  }
}
