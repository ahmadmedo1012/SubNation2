import type { LocalCartItem } from "@/lib/cart";
import {
  INTENT_SLOTS,
  INTENT_TTL_MS,
  clearIntentKey,
  loadIntentKey,
  persistIntentKey,
} from "@/lib/idempotency";

/**
 * Per-unit checkout Idempotency-Key lifecycle — the native port of the
 * web's components/checkout/checkout-unit-key.ts (96-F4, the
 * double-charge guard), rebuilt over AsyncStorage (async storage →
 * async functions; the screen's per-unit loop awaits each step).
 *
 * The slot scheme is byte-identical to the web's —
 * `subnation_checkout_key:{productId}:{variantId ?? 0}:{unitIndex}`
 * (line-scoped per AUD103-2-F1: the slot must not collide across two
 * cart lines of the same product with different variants) — and rides
 * INTENT_SLOTS.checkoutUnit from lib/idempotency, so both platforms
 * speak the same slot vocabulary.
 *
 * Lifecycle (lazy — a key is minted only when its unit is first
 * attempted; the {k, t, f} envelope guards live in lib/idempotency.ts):
 *   • read:   reuse a stored key when one exists → a retry of an
 *             unresolved unit replays the server's cached response
 *             instead of charging again (this is the double-charge fix).
 *   • write:  at mint time, BEFORE the POST leaves the device.
 *   • delete: ONLY at a definitive resolution —
 *       - a per-unit HTTP rejection (ApiError): cleared in the unit's
 *         catch so a retry of that unit isn't answered forever by the
 *         cached error;
 *       - accounted 2xx successes: cleared in the cart-sync step, NOT
 *         at the per-unit 2xx. The network-failure path intentionally
 *         skips the cart-sync, so the cart still contains the
 *         already-charged units on retry — deleting their keys there
 *         would re-charge them under fresh keys.
 *   • survives: 409 IDEMPOTENCY_IN_FLIGHT (a sibling may still be
 *     executing server-side — clearing here would mint a fresh key and
 *     double-charge once the sibling commits) and TTL-fingerprint
 *     mismatches are the envelope's own guards.
 *
 * The web's purgeLegacyCheckoutUnitKeys sweep has NO native twin: the
 * pre-r103 un-scoped slot shape never existed in an app store build
 * (AsyncStorage starts empty on install).
 */

/**
 * The line-level intent fingerprint for a unit's key — binds the stored
 * key to WHAT that unit order buys (product / variant / coupon /
 * effective unit price): the exact body fields the backend's
 * same-key-different-body 409 branch compares, plus the price context
 * (a post-reconcile price change is a NEW intent, never a replay).
 */
export function checkoutUnitFingerprint(
  line: Pick<LocalCartItem, "productId" | "variantId" | "priceLYD" | "salePriceLYD">,
  couponCode: string,
): string {
  const unitPrice = line.salePriceLYD ?? line.priceLYD;
  return `${line.productId}|${line.variantId ?? ""}|${couponCode.trim().toUpperCase()}|${unitPrice}`;
}

export async function loadCheckoutUnitKey(
  productId: number,
  variantId: number | null,
  unitIndex: number,
  fingerprint: string,
): Promise<string | null> {
  return loadIntentKey(
    INTENT_SLOTS.checkoutUnit(productId, variantId, unitIndex),
    INTENT_TTL_MS,
    fingerprint,
  );
}

export async function persistCheckoutUnitKey(
  productId: number,
  variantId: number | null,
  unitIndex: number,
  fingerprint: string,
  key: string,
): Promise<void> {
  await persistIntentKey(
    INTENT_SLOTS.checkoutUnit(productId, variantId, unitIndex),
    fingerprint,
    key,
  );
}

export async function clearCheckoutUnitKey(
  productId: number,
  variantId: number | null,
  unitIndex: number,
): Promise<void> {
  await clearIntentKey(INTENT_SLOTS.checkoutUnit(productId, variantId, unitIndex));
}
