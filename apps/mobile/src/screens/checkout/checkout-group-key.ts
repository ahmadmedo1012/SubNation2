import AsyncStorage from "@react-native-async-storage/async-storage";

import type { LocalCartItem } from "@/lib/cart";
import { INTENT_TTL_MS, clearIntentKey, persistIntentKey } from "@/lib/idempotency";

/**
 * The per-CONFIRM group token lifecycle — the native port of the web's
 * components/checkout/checkout-group-key.ts (R165, the R162 ADR):
 *
 * ONE UUID per logical checkout attempt, minted at the start of a
 * confirm, REUSED for every unit-order of that attempt and across
 * partial-failure retries of the same basket, cleared ONLY when the
 * live cart fully resolves or by TTL. The token rides
 * CreateOrderBody.order_group_id on every unit; the server records it
 * verbatim (informational grouping only — never money math,
 * idempotency, refunds; see FINAL_MONEY_INVARIANTS' R165 note).
 *
 * The ONE deliberate divergence from the per-unit keys: the LOAD here
 * is subset-tolerant, not exact-fingerprint. A partial failure fully
 * completes one line (removed from the cart) and the retry's remaining
 * lines are a SUBSET of the original basket — exact matching would
 * re-mint and split one attempt into two groups. The overlap check
 * (current lines ∩ stored lines ≠ ∅) keeps the retry in the SAME group
 * while still isolating a genuinely different basket within the TTL.
 */

/** The shared slot — one live confirm attempt at a time. */
const CHECKOUT_GROUP_SLOT = "subnation_checkout_group";

/** The stored intent envelope's shape (lib/idempotency.ts). */
interface StoredIntentKey {
  k: string;
  t: number;
  f: string;
}

function lineKey(line: Pick<LocalCartItem, "productId" | "variantId">): string {
  // The cart lineKey convention (lib/cart.ts / INTENT_SLOTS.checkoutUnit).
  return `${line.productId}:${line.variantId ?? 0}`;
}

/** The basket's line-key SET at confirm time (no quantities, no coupon). */
function checkoutGroupFingerprint(
  lines: Array<Pick<LocalCartItem, "productId" | "variantId">>,
): string {
  return [...new Set(lines.map(lineKey))].sort().join("|");
}

/**
 * Load the live group token for THIS basket, or null (mint a fresh one).
 * TTL + envelope-shape guards mirror loadIntentKey verbatim; the
 * fingerprint check is the overlap form (see the module docblock).
 */
export async function loadCheckoutGroupKey(
  lines: Array<Pick<LocalCartItem, "productId" | "variantId">>,
): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(CHECKOUT_GROUP_SLOT);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredIntentKey>;
    if (typeof parsed.k !== "string" || !parsed.k) return null;
    if (typeof parsed.t !== "number" || Number.isNaN(parsed.t)) return null;
    if (Date.now() - parsed.t > INTENT_TTL_MS) return null;
    if (typeof parsed.f !== "string") return null;
    if (parsed.f === "") return null; // never-persisted-by-us shape
    const stored = new Set(parsed.f.split("|"));
    const overlap = lines.some((l) => stored.has(lineKey(l)));
    if (!overlap) return null; // a genuinely different basket → fresh group
    return parsed.k;
  } catch {
    return null; // corrupted entry → treated as absent (fresh mint)
  }
}

/** Persist (or re-anchor on a retry) the group token for this basket. */
export async function persistCheckoutGroupKey(
  lines: Array<Pick<LocalCartItem, "productId" | "variantId">>,
  key: string,
): Promise<void> {
  await persistIntentKey(CHECKOUT_GROUP_SLOT, checkoutGroupFingerprint(lines), key);
}

/**
 * Clear the group token — ONLY at a definitive full resolution of the
 * live cart (the loop's live-cart-empty check). Partial failures keep
 * it: the retry completes the remainder under the same group.
 */
export async function clearCheckoutGroupKey(): Promise<void> {
  await clearIntentKey(CHECKOUT_GROUP_SLOT);
}
