/**
 * GA4 ecommerce event layer (R168).
 *
 * Module contract:
 *   - Typed, self-contained GA4 ecommerce events following Google's
 *     current GA4 ecommerce spec (view_item / view_item_list /
 *     select_item / search / add_to_cart / begin_checkout / purchase).
 *   - EVERY exported function is a no-op unless `window.gtag` is a
 *     function — the R164 loader (lib/analytics.ts) sets it ONLY when
 *     the build carried a valid VITE_GA_TRACKING_ID, so local dev, CI
 *     and unconfigured deployments stay out of the production property
 *     by construction. We never touch that loader here (no second tag,
 *     no manual config).
 *   - Amounts are LYD major units as plain numbers (2dp) — the app's
 *     money law (M17). NEVER a formatted «د.ل» string; gtag gets
 *     `currency: "LYD"` + numeric `value` only.
 *   - PII prohibition (absolute): no delivered_* credential fields, no
 *     user ids/emails/phones/wallet balances ever enter a payload.
 *
 * SPA page_views ride GA4 Enhanced Measurement (history-based,
 * default-on, verified live in the production dataLayer): this module
 * NEVER pushes a manual page_view — the app pushing one would CREATE a
 * DUPLICATE next to EM's own. `select_item`/link navigation is what the
 * funnel measures; page_view stays gtag-owned.
 *
 * Purchase mapping decision (the R165 multi-order contract): one GA4
 * transaction per server-confirmed UNIT order; `transaction_id` is the
 * order_code — the stable server-minted identity that survives
 * idempotent replay. A multi-order checkout therefore emits N purchase
 * events (one per order, each with its own amount): revenue is never
 * missed on partial failure and never double-counted across
 * tabs/retries/refreshes (see the dedup guard below).
 * `order_group_id` is informational-only per R165 and is deliberately
 * NOT used as a transaction id.
 *
 * Purchase dedup (ANALYTICS guard only): one purchase event per
 * order_code EVER — an in-memory Set fast-path plus a
 * localStorage-backed sent-set under `subnation_ga4_sent`
 * (JSON array of the most recent 100 codes; corrupt JSON resets it).
 * localStorage — not sessionStorage — so other tabs and later sessions
 * cannot double-count a replayed order. This slot NEVER participates
 * in money or idempotency claims: the server owns those (M4/M5/M6 are
 * untouched — analytics is observation-only, never a second money
 * path). Eligibility fires ONLY on a confirmed createOrder response
 * whose status is "pending" or "completed" — never "failed" or
 * "refunded".
 *
 * Storage slot note: `subnation_ga4_sent` is analytics-only
 * and shares nothing with the money-path intent-envelope slots
 * (see lib/idempotency.ts's R-140-o map — that registry is strictly
 * money-mutation Idempotency-Key minters, which is why this module is
 * not listed there).
 */

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

/** One GA4 `items[]` entry. Money fields are LYD major units, numbers. */
export interface EcommerceItem {
  item_id: string;
  item_name: string;
  item_category?: string;
  item_variant?: string;
  price: number;
  quantity: number;
  discount?: number;
}

/**
 * The minimal structural slice of the orval `Order` DTO that
 * `trackPurchase` reads. The generated Order satisfies it structurally
 * (OrderStatus is a string union); keeping the module free of a
 * generated-client import also keeps it unit-testable in isolation.
 * The delivered_* fields are deliberately NOT on this type — the PII
 * guard is enforced by what the mapper can even name.
 */
export interface PurchaseOrderInput {
  order_code: string;
  amount: number;
  status: string;
  product_id: number;
  product_name: string;
  variant_label?: string | null;
  coupon_code?: string | null;
  discount_amount?: number;
}

/** The one-line guard: fire only when the R164 loader armed gtag. */
function push(event: string, payload: Record<string, unknown>): void {
  if (typeof window.gtag !== "function") return;
  window.gtag("event", event, payload);
}

// ── Mappers (product/variant → item) ────────────────────────────────────────

/** The product/variant slices the catalog surfaces actually carry. */
interface ProductLike {
  id: number;
  name: string;
  category?: string | null;
  price: number;
  sale_price?: number | null;
}

interface VariantLike {
  label: string;
  price: number;
  sale_price?: number | null;
}

/** Effective LYD price: sale price when present, base otherwise. */
function effectivePrice(p: { price: number; sale_price?: number | null }): number {
  return p.sale_price ?? p.price;
}

/**
 * Catalog product (optionally at a selected variant) → EcommerceItem.
 * `item_id` is the PRODUCT id (the same id a purchase event reports —
 * the funnel stays joinable end-to-end); the variant rides
 * `item_variant` as its display label.
 */
export function productToItem(product: ProductLike, variant?: VariantLike | null): EcommerceItem {
  const item: EcommerceItem = {
    item_id: String(product.id),
    item_name: product.name,
    price: variant ? effectivePrice(variant) : effectivePrice(product),
    quantity: 1,
  };
  if (product.category) item.item_category = product.category;
  if (variant) item.item_variant = variant.label;
  return item;
}

/** Cart line (lib/cart.tsx LocalCartItem) → EcommerceItem. */
export function cartLineToItem(line: {
  productId: number;
  name: string;
  variantLabel: string | null;
  priceLYD: number;
  salePriceLYD: number | null;
  quantity: number;
}): EcommerceItem {
  const item: EcommerceItem = {
    item_id: String(line.productId),
    item_name: line.name,
    price: line.salePriceLYD ?? line.priceLYD,
    quantity: line.quantity,
  };
  if (line.variantLabel) item.item_variant = line.variantLabel;
  return item;
}

/** Confirmed order → EcommerceItem. The Order DTO carries no category
 * slug, so no `item_category` is fabricated for purchases. */
function orderToItem(order: PurchaseOrderInput): EcommerceItem {
  const item: EcommerceItem = {
    item_id: String(order.product_id),
    item_name: order.product_name,
    price: order.amount,
    quantity: 1,
  };
  if (order.variant_label) item.item_variant = order.variant_label;
  if (typeof order.discount_amount === "number" && order.discount_amount > 0) {
    item.discount = order.discount_amount;
  }
  return item;
}

// ── Events (GA4 ecommerce spec names + payloads) ────────────────────────────

export function trackViewItem(item: EcommerceItem): void {
  push("view_item", { currency: "LYD", value: item.price * item.quantity, items: [item] });
}

export function trackViewItemList(items: EcommerceItem[], itemListId: string): void {
  // No value — impressions are not transactions.
  push("view_item_list", { item_list_id: itemListId, items });
}

export function trackSelectItem(item: EcommerceItem, itemListId?: string): void {
  const payload: Record<string, unknown> = { items: [item] };
  if (itemListId) payload.item_list_id = itemListId;
  push("select_item", payload);
}

let lastSearchTerm = "";

export function trackSearch(term: string): void {
  const trimmed = term.trim();
  // Consecutive-dedupe + empty skip: one search event per committed,
  // non-empty term — the debounce/Enter double-commit stays one event.
  if (!trimmed || trimmed === lastSearchTerm) return;
  lastSearchTerm = trimmed;
  push("search", { search_term: trimmed });
}

export function trackAddToCart(item: EcommerceItem): void {
  push("add_to_cart", { currency: "LYD", value: item.price * item.quantity, items: [item] });
}

/**
 * `value` comes pre-rounded by the caller (cart roundToCents) — the
 * number the buyer pays, coupon-adjusted when applied.
 */
export function trackBeginCheckout(
  items: EcommerceItem[],
  value: number,
  couponCode?: string,
): void {
  const payload: Record<string, unknown> = { currency: "LYD", value, items };
  if (couponCode) payload.coupon_code = couponCode;
  push("begin_checkout", payload);
}

// ── purchase: eligibility + one-fire-per-order_code ─────────────────────────

const PURCHASE_SENT_STORAGE_KEY = "subnation_ga4_sent";
const PURCHASE_SENT_BOUND = 100;

const purchaseSent = new Set<string>();
let purchaseSentLoaded = false;

/** Lazy-load the durable sent-set (corrupt payload → reset). */
function isPurchaseSent(code: string): boolean {
  if (!purchaseSentLoaded) {
    purchaseSentLoaded = true;
    try {
      const raw = localStorage.getItem(PURCHASE_SENT_STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const c of parsed) if (typeof c === "string") purchaseSent.add(c);
        }
      }
    } catch {
      // corrupt JSON — treat as never sent (reset)
    }
  }
  return purchaseSent.has(code);
}

/** Persist the sent-set, bounded to the most recent codes. */
function markPurchaseSent(code: string): void {
  purchaseSent.add(code);
  try {
    const codes = [...purchaseSent];
    localStorage.setItem(
      PURCHASE_SENT_STORAGE_KEY,
      JSON.stringify(codes.slice(Math.max(0, codes.length - PURCHASE_SENT_BOUND))),
    );
  } catch {
    // storage unavailable — in-session dedup only
  }
}

/**
 * The GA4 purchase event. Fires ONLY for a server-confirmed order
 * (pending/completed money, never failed/refunded) whose order_code
 * has never been reported before — eligibility + dedup are the
 * no-double-count contract; the server stays the money authority.
 */
export function trackPurchase(order: PurchaseOrderInput): void {
  // Nothing can fire without the loader — do not burn the code in the
  // sent-set (dev/CI builds must not suppress a later production fire).
  if (typeof window.gtag !== "function") return;
  if (typeof order.order_code !== "string" || order.order_code.trim() === "") return;
  if (typeof order.amount !== "number" || !Number.isFinite(order.amount) || order.amount < 0) {
    return;
  }
  if (order.status !== "pending" && order.status !== "completed") return;
  if (isPurchaseSent(order.order_code)) return;
  markPurchaseSent(order.order_code);

  const payload: Record<string, unknown> = {
    transaction_id: order.order_code,
    currency: "LYD",
    value: order.amount,
    items: [orderToItem(order)],
  };
  if (order.coupon_code) payload.coupon_code = order.coupon_code;
  push("purchase", payload);
}
