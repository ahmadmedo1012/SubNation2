import type { LocalCartItem } from "@/lib/cart";
import { clearIntentKey, persistIntentKey } from "@/lib/intent-envelope";

// R165 (the R162 ADR §2.1.1): the checkout page's per-CONFIRM group token
// lifecycle. One UUID per logical checkout attempt — minted at the start
// of a confirm, REUSED for every unit-order of that attempt and across
// partial-failure retries of the same basket, cleared ONLY when the live
// cart fully resolves (the same liveAfterSync empty check as the cart's
// clear() guard) or by TTL expiry. The token rides CreateOrderBody's
// order_group_id on every unit; the server records it verbatim
// (informational only — never money math, idempotency, refunds).
//
// The ONE deliberate divergence from the unit keys (checkout-unit-key.ts):
// the LOAD here is subset-tolerant, not exact-fingerprint. The unit keys
// exist to stop double charges, so an exact match is the money-safe
// discipline. The group token is informational: an exact basket match
// would FRAGMENT the exact scenario the ADR designed it for — a partial
// failure fully completes one line (removed from the cart) and the retry's
// remaining lines are a subset of the original basket, so exact matching
// would re-mint and split one attempt into two groups. The overlap check
// below (current lines ∩ stored lines ≠ ∅) keeps the retry in the SAME
// group while still isolating a genuinely DIFFERENT basket (and other
// tabs' baskets) within the TTL window. A coupon removed mid-retry does
// not re-mint (deliberately NOT part of the fingerprint — ADR §2.1.1:
// same purchase intent); a >10-min-late retry mints a fresh group
// alongside the fresh unit keys (the documented 98-F2 trade-off, applied
// consistently).

/** The shared (cross-tab) slot — one live confirm attempt at a time. */
const CHECKOUT_GROUP_SLOT = "subnation_checkout_group";
/** Mirrors CHECKOUT_KEY_TTL_MS (checkout-unit-key.ts) — the 98-F2 window. */
const CHECKOUT_GROUP_TTL_MS = 10 * 60 * 1000;

/** The stored intent envelope's shape (lib/intent-envelope.ts). */
interface StoredIntentKey {
  k: string;
  t: number;
  f: string;
}

function lineKey(line: Pick<LocalCartItem, "productId" | "variantId">): string {
  // The cart lineKey convention (lib/cart.tsx / checkout-unit-key.ts).
  return `${line.productId}:${line.variantId ?? 0}`;
}

/** The basket's line-key SET at confirm time (no quantities, no coupon —
 * the group binds to WHAT lines the attempt covers, not how many units
 * each still holds mid-retry). */
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
export function loadCheckoutGroupKey(
  lines: Array<Pick<LocalCartItem, "productId" | "variantId">>,
): string | null {
  try {
    const raw = localStorage.getItem(CHECKOUT_GROUP_SLOT);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredIntentKey>;
    if (typeof parsed.k !== "string" || !parsed.k) return null;
    if (typeof parsed.t !== "number" || Number.isNaN(parsed.t)) return null;
    if (Date.now() - parsed.t > CHECKOUT_GROUP_TTL_MS) return null;
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
export function persistCheckoutGroupKey(
  lines: Array<Pick<LocalCartItem, "productId" | "variantId">>,
  key: string,
): void {
  persistIntentKey(localStorage, CHECKOUT_GROUP_SLOT, checkoutGroupFingerprint(lines), key);
}

/** Clear the group token — ONLY at a definitive full resolution of the
 * live cart (checkout.tsx's liveAfterSync empty check) or on demand in
 * tests. Partial failures keep it (the retry completes the remainder
 * under the same group). */
export function clearCheckoutGroupKey(): void {
  clearIntentKey(localStorage, CHECKOUT_GROUP_SLOT);
}
