import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export interface LocalCartItem {
  productId: number;
  /** Selected catalog variant (product_variants.id) — null = variant-less product. */
  variantId: number | null;
  /** Joined display label ("فردي — 3 أشهر") captured when the line was added. */
  variantLabel: string | null;
  slug: string | null;
  name: string;
  imageUrl: string | null;
  priceLYD: number;
  salePriceLYD: number | null;
  discountPercent: number | null;
  quantity: number;
  /**
   * B-11 (R128-IMP-5 / B13 §3): catalog stock snapshot captured at
   * add-to-cart time (the list/detail payload's `stock_count`), refreshed
   * on re-add and by checkout's mount-time re-quote (reconcileLine).
   * Optional + null-normalized: pre-B-11 stored lines and callers that
   * don't know stock read null = UNKNOWN — every verdict built on it is
   * advisory UI only; the server's in-tx stock re-check
   * (checkout.service) stays the charge authority.
   */
  stockCount?: number | null;
}

interface CartCommandsValue {
  addItem: (
    item: Omit<LocalCartItem, "quantity" | "stockCount"> & {
      quantity?: number;
      /** B-11: pass the catalog row's stock_count when the caller knows
       * it (ProductCard / the PDP do); omit to keep an existing line's
       * snapshot. */
      stockCount?: number | null;
    },
  ) => void;
  removeItem: (productId: number, variantId?: number | null) => void;
  updateQuantity: (productId: number, quantity: number, variantId?: number | null) => void;
  /** 98-F2 (R98-A3 F5 — P2): refresh a line's PRICE snapshot (never its
   * quantity) from the live catalog. Used by checkout's mount-time
   * re-quote so the confirmed label can never diverge from the charged
   * amount when a flash sale ends (or a price changes) between
   * add-to-cart and confirm. No-op (same array identity) when the line
   * no longer exists.
   *
   * B-11 (R128-IMP-5): the pricing patch may now ALSO carry a fresh
   * `stockCount` (key-present semantics: omit the key = leave the
   * stored snapshot untouched; `null` = reset to unknown) so the same
   * re-quote refreshes stock alongside price — the sold-out state can
   * surface on the line BEFORE checkout reaches the charge. */
  reconcileLine: (
    productId: number,
    pricing: Pick<LocalCartItem, "priceLYD" | "salePriceLYD" | "discountPercent"> & {
      stockCount?: number | null;
    },
    variantId?: number | null,
  ) => void;
  clear: () => void;
}

interface CartStateValue {
  items: LocalCartItem[];
  itemCount: number;
  totalLYD: number;
  isLoaded: boolean;
}

/** Legacy combined shape (R98-03 consumers): commands + state in one
 * object. `useCart()` still returns exactly this interface — existing
 * consumers (Navbar, cart, checkout, product pages, all tests) are
 * untouched; only the RENDER SCOPE behind it changed (see the split
 * rationale below). */
interface CartContextValue extends CartCommandsValue, CartStateValue {}

/** Storage key bump: v1 items lack variantId/variantLabel — the loader
 * (CartProvider) migrates them on read so old carts keep working. */
const STORAGE_KEY = "subnation_cart_v2";
const LEGACY_STORAGE_KEY = "subnation_cart_v1";

/** Line identity: productId + variantId. Two variants of the same product
 * coexist as separate lines (unlike the server cart, which keeps one row
 * per product with replace-variant semantics). */
function lineKey(i: Pick<LocalCartItem, "productId" | "variantId">): string {
  return `${i.productId}:${i.variantId ?? 0}`;
}

// Mirror of the backend quantity cap — an uncapped value (1e9 was
// accepted) turned the per-unit checkout loop into a self-DoS.
export const MAX_LINE_QUANTITY = 99;

// ── B-11 (R128-IMP-5 / B13 §3): the stock-snapshot verdicts ────────────────
//
// The cart used to hold NO stock state at all: a sold-out product sat in
// the cart looking buyable, the stepper clamped to [1, 99] with zero
// feedback, and the buyer discovered the truth at CHARGE time (the
// server's in-tx OUT_OF_STOCK 409). These helpers turn the add-time /
// reconciled stockCount snapshot into the honest per-line state the cart
// page renders («نفد المخزون» / «متبقٍ N فقط» — the ProductCard idiom)
// and the client-side checkout gate consumes. ADVISORY ONLY: a snapshot
// can be stale in either direction; the server re-check remains the
// money authority and a 409 backstop is always possible.

/** ProductCard's low-stock badge threshold (`stock_count <= 3` — the
 * storefront's single definition of «متبقٍ N فقط»), reused verbatim for
 * cart lines so both surfaces agree on when to whisper. */
export const LOW_STOCK_THRESHOLD = 3;

export type LineStockStatus =
  /** No snapshot (legacy line / caller without the catalog row). Render
   * nothing, block nothing — the server re-check answers at charge time. */
  | "unknown"
  /** Snapshot covers the line comfortably — nothing to say. */
  | "ok"
  /** Snapshot ≤ 3 but ≥ the line's quantity — «متبقٍ N فقط». */
  | "low"
  /** Snapshot > 0 but < the line's quantity — the cart asks for more
   * than exists; blocks the line at the client-side pre-flight. */
  | "insufficient"
  /** Snapshot 0 — «نفد المخزون»; blocks the line. */
  | "out";

export function lineStockStatus(
  item: Pick<LocalCartItem, "quantity" | "stockCount">,
): LineStockStatus {
  const stock = item.stockCount ?? null;
  if (stock == null) return "unknown";
  if (stock <= 0) return "out";
  if (stock < item.quantity) return "insufficient";
  if (stock <= LOW_STOCK_THRESHOLD) return "low";
  return "ok";
}

/** The per-line states that make the cart UNCHARGEABLE as-is — the
 * client-side pre-flight verdict (B-11: the failure must surface at the
 * cart, not at the charge). Unknown/low lines never block. */
const BLOCKING_STOCK_STATUSES: ReadonlySet<LineStockStatus> = new Set(["out", "insufficient"]);

export function lineStockBlocksCheckout(
  item: Pick<LocalCartItem, "quantity" | "stockCount">,
): boolean {
  return BLOCKING_STOCK_STATUSES.has(lineStockStatus(item));
}

/** true when ANY line is proven unchargeable by its stock snapshot —
 * the gate the cart/checkout CTAs disable on. */
export function cartHasBlockingStock(
  items: Array<Pick<LocalCartItem, "quantity" | "stockCount">>,
): boolean {
  return items.some(lineStockBlocksCheckout);
}

/** The Arabic copy for a line's stock state (the ProductCard strings
 * verbatim for the shared states); null = render nothing. Exported so
 * the cart page and any future surface say the same sentence. */
export function lineStockNotice(
  item: Pick<LocalCartItem, "quantity" | "stockCount">,
): string | null {
  const stock = item.stockCount ?? null;
  switch (lineStockStatus(item)) {
    case "out":
      return "نفد المخزون";
    case "insufficient":
      return `متبقٍ ${stock} فقط — عدّل الكمية`;
    case "low":
      return `متبقٍ ${stock} فقط`;
    default:
      return null;
  }
}

/** Normalize a raw stock value into the stored shape: a non-negative
 * integer passes, everything else (undefined / NaN / fractional /
 * negative / non-number) reads null = UNKNOWN. */
function normalizeStockCount(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/** The per-line quantity ceiling: the 99 mirror cap narrowed by a KNOWN
 * stock snapshot. Floored at 1 — a 0-stock line keeps its quantity-1
 * shape (quantity < 1 is invalid); its honest state is «نفد المخزون»
 * (the status flag blocks it — the quantity is not the messenger). */
function stockAwareCeiling(stockCount: number | null): number {
  if (stockCount == null) return MAX_LINE_QUANTITY;
  return Math.max(1, Math.min(stockCount, MAX_LINE_QUANTITY));
}

/** B-11 raise-cap rule: a quantity RAISE never crosses the known-stock
 * ceiling — and never silently SHRINKS a line that is already above a
 * snapshot that refreshed DOWN (a reconciled line with qty 5 / stock 2
 * keeps its 5, flags insufficient, and blocks checkout; a silent
 * quantity edit on the money path is not ours to make). Decreases
 * always apply untouched. */
function capRaise(requested: number, current: number, ceiling: number): number {
  return requested > current ? Math.min(requested, Math.max(ceiling, current)) : requested;
}

// ── R111-F4-F1 (P2): context split — commands vs state ────────────────────
//
// The single wide context (even memoized, R98-03) changed identity on
// EVERY cart mutation, so every subscriber re-rendered on every tap.
// The money-critical add-to-cart tap on the home grid re-rendered ALL
// 45 ProductCards + the Navbar (80-200ms INP on low-end Android) even
// though a card reads NO cart state — only the addItem command.
//
// Split into TWO contexts sharing one provider:
//   • CartCommandsContext — the mutation callbacks. Every callback is
//     useCallback([])-stable, so the memoized commands value keeps its
//     identity FOR THE LIFETIME OF THE PROVIDER: subscribing to it
//     never re-renders anything on a cart mutation. ProductCard (and
//     any other command-only consumer) rides this one.
//   • CartStateContext — items/itemCount/totalLYD/isLoaded. Changes
//     identity exactly when the cart data (or load phase) changes —
//     same trigger as the old single context value.
//
// Render scope, before → after (an add-to-cart tap on the catalog):
//   45 ProductCards + Navbar  →  Navbar only. The badge count (a
//   state read) still updates live; the cards' buttons still work —
//   commands never change identity.
//
// Semantics preserved EXACTLY: same localStorage persistence, same
// cross-tab re-sync, same v1→v2 migration, same {}-key behavior, and
// `useCart()` keeps returning the SAME combined interface with the
// SAME identity contract pinned by cart-sync-hardening (stable across
// data-less re-renders, new identity on data change) — it is now the
// memoized merge of the two values.
const CartCommandsContext = createContext<CartCommandsValue | null>(null);
const CartStateContext = createContext<CartStateValue | null>(null);

function effectivePrice(item: LocalCartItem): number {
  return item.salePriceLYD ?? item.priceLYD;
}

/**
 * Parse + shape a raw cart JSON payload with the LOAD-time guards
 * (finite productId, quantity clamped to [1, 99], defaults for the
 * optional display fields). Shared by the initial localStorage load,
 * the v1→v2 migration and the cross-tab `storage` listener (98-F2:
 * r97 F-09) so every entry point applies EXACTLY the same validation —
 * a listener that trusted event.newValue verbatim would be a
 * cross-tab injection path into the money path.
 * Returns null for null/invalid payloads (caller decides what to do).
 */
function parseCartItems(raw: string | null): LocalCartItem[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Array<Partial<LocalCartItem>>;
    if (!Array.isArray(parsed)) return null;
    const items = parsed
      .filter((i) => i && typeof i.productId === "number")
      .map((i) => ({
        productId: i.productId as number,
        variantId: i.variantId ?? null,
        variantLabel: i.variantLabel ?? null,
        slug: i.slug ?? null,
        name: i.name ?? "",
        imageUrl: i.imageUrl ?? null,
        priceLYD: Number(i.priceLYD ?? 0),
        salePriceLYD: i.salePriceLYD ?? null,
        discountPercent: i.discountPercent ?? null,
        // B-11: same load-time-guard treatment as every other field — a
        // corrupt stock value (fractional/negative/string) reads as
        // unknown, never as a fake verdict.
        stockCount: normalizeStockCount(i.stockCount),
        quantity: Math.max(1, Math.min(Number(i.quantity ?? 1), MAX_LINE_QUANTITY)),
      }));
    return items;
  } catch {
    // corrupt storage — treat as absent
    return null;
  }
}

/** AUD103-2-F2 (r103): read the CURRENT cart straight from localStorage
 * with the same load-time guards (parseCartItems). Used by the checkout
 * per-unit loop to detect another tab completing/removing lines while
 * this tab iterates a stale snapshot. Returns null when storage is
 * unavailable/corrupt — callers treat null as "cannot verify" and skip
 * the guard (the pre-fix behavior), never as an empty cart. */
export function readLiveCartItems(): LocalCartItem[] | null {
  try {
    return parseCartItems(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

/**
 * Round a money amount to 2 decimal places (Math.round(x*100)/100 — the
 * banker-safe idiom this codebase already uses elsewhere, e.g. wallet's
 * 0.5-step rounding). R94-A1 #1: un-rounded sums let floating-point dust
 * (49.980000000000004) leak into balance comparisons and "الناقص" labels.
 */
export function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<LocalCartItem[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    // v1 → v2 migration: legacy lines (no variant fields) are re-shaped
    // with variantId=null so the rest of the app can assume the field
    // exists. Content is otherwise preserved.
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    const migrated = parseCartItems(raw);
    if (migrated) setItems(migrated);
    // R98-10a (r98 frontend-deep §2 / R98-10): the legacy key has done
    // its job the moment it is read — its content was just migrated
    // (or it was superseded by a v2 entry, or it was unreadable junk).
    // Leaving it in place kept a 2015-style key living forever in every
    // pre-migration browser; remove it once, right here.
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // ignore — storage unavailable, nothing to clean
    }
    setIsLoaded(true);
  }, []);

  // r97 F-09 / 98-F2: cross-tab re-sync. Another tab mutating
  // `subnation_cart_v2` fires a `storage` event in THIS tab — without
  // a listener each tab kept its own divergent copy and the LAST writer
  // silently won on the next localStorage read (a lost-update between
  // the cart page and a product page opened in a second tab). The
  // handler re-parses event.newValue with the same load-time guards
  // (parseCartItems) and ignores null (another tab cleared the key —
  // per the fix contract, we do not wipe this tab's view) and invalid
  // payloads (a foreign/corrupt write must not blank the cart).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      const next = parseCartItems(e.newValue);
      if (next) setItems(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const addItem = useCallback(
    (
      incoming: Omit<LocalCartItem, "quantity" | "stockCount"> & {
        quantity?: number;
        stockCount?: number | null;
      },
    ) => {
      const qty = Math.min(incoming.quantity ?? 1, MAX_LINE_QUANTITY);
      const key = lineKey(incoming);
      // B-11: the caller's snapshot wins when present; a stock-less
      // re-add PRESERVES the line's existing snapshot (clobbering it
      // with unknown would silently disarm the stale-stock verdicts).
      const incomingStock =
        incoming.stockCount !== undefined ? normalizeStockCount(incoming.stockCount) : null;
      setItems((prev) => {
        const existing = prev.find((i) => lineKey(i) === key);
        let next: LocalCartItem[];
        if (existing) {
          const mergedStock =
            incoming.stockCount !== undefined ? incomingStock : (existing.stockCount ?? null);
          next = prev.map((i) =>
            lineKey(i) === key
              ? {
                  ...i,
                  // refresh the price snapshot for the SAME variant on
                  // re-add (a flash sale may have started since).
                  priceLYD: incoming.priceLYD,
                  salePriceLYD: incoming.salePriceLYD,
                  discountPercent: incoming.discountPercent,
                  stockCount: mergedStock,
                  // B-11: the re-add's quantity bump rides the stock-aware
                  // raise cap (identical to the old 99 clamp when the
                  // snapshot is unknown).
                  quantity: capRaise(
                    Math.min(i.quantity + qty, MAX_LINE_QUANTITY),
                    i.quantity,
                    stockAwareCeiling(mergedStock),
                  ),
                }
              : i,
          );
        } else {
          next = [...prev, { ...incoming, stockCount: incomingStock, quantity: qty }];
        }
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
    },
    [],
  );

  const removeItem = useCallback((productId: number, variantId?: number | null) => {
    const key = lineKey({ productId, variantId: variantId ?? null });
    setItems((prev) => {
      const next = prev.filter((i) => lineKey(i) !== key);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const updateQuantity = useCallback(
    (productId: number, quantity: number, variantId?: number | null) => {
      if (quantity < 1) return;
      const key = lineKey({ productId, variantId: variantId ?? null });
      setItems((prev) => {
        // B-11: raises ride the stock-aware ceiling (the stepper cap —
        // identical to the old 99 clamp when the snapshot is unknown);
        // decreases always apply; a line already above a snapshot that
        // refreshed DOWN keeps its quantity (see capRaise).
        const next = prev.map((i) =>
          lineKey(i) === key
            ? {
                ...i,
                quantity: capRaise(
                  Math.min(quantity, MAX_LINE_QUANTITY),
                  i.quantity,
                  stockAwareCeiling(i.stockCount ?? null),
                ),
              }
            : i,
        );
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
    },
    [],
  );

  // 98-F2 (R98-A3 F5 — P2): live-catalog price refresh for ONE line —
  // quantity is deliberately NOT touched (the unit loop and the cart
  // badges keep their counts; only the price snapshot is a lie after a
  // flash sale ends). Identity-stable when the line is absent or the
  // pricing is unchanged so unrelated consumers (checkout's [items]
  // coupon-void effect) are not spuriously invalidated.
  const reconcileLine = useCallback(
    (
      productId: number,
      pricing: Pick<LocalCartItem, "priceLYD" | "salePriceLYD" | "discountPercent"> & {
        stockCount?: number | null;
      },
      variantId?: number | null,
    ) => {
      const key = lineKey({ productId, variantId: variantId ?? null });
      // B-11 key-present semantics: omit `stockCount` (the pre-B-11
      // caller shape) and the stored snapshot is untouched; pass a value
      // (or null) and it is normalized + refreshed with the price.
      const { stockCount, ...priceOnly } = pricing;
      const hasStockPatch = "stockCount" in pricing;
      const normalizedStock = normalizeStockCount(stockCount);
      setItems((prev) => {
        let changed = false;
        const next = prev.map((i) => {
          if (lineKey(i) !== key) return i;
          changed = true;
          return hasStockPatch
            ? { ...i, ...priceOnly, stockCount: normalizedStock }
            : { ...i, ...priceOnly };
        });
        if (!changed) return prev;
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
    },
    [],
  );

  const clear = useCallback(() => {
    setItems([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  // A1 (r94 #1, FP gate): money totals are rounded to 2 decimals at the
  // source. Fractional prices (relative discounts like 8.33 × 6) produce
  // 49.980000000000004 — checkout's `balance < totalLYD` gate then blocked
  // a user whose balance was EXACTLY 49.98 with a nonsensical "الناقص 0.00
  // د.ل" banner. cart.tsx:56 already rounded its own copy (toFixed(2));
  // every consumer of the context now gets the same cent-accurate value.
  const totalLYD = roundToCents(items.reduce((sum, i) => sum + effectivePrice(i) * i.quantity, 0));
  const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);

  // R98-03 (r98 frontend-deep §2 — P3) + R111-F4-F1: both context values
  // are memoized. All action callbacks are useCallback-stable (deps []),
  // so the COMMANDS value keeps one identity for the provider's entire
  // lifetime — a commands-only subscriber (ProductCard) is immune to
  // cart mutations. The STATE value mints a new identity exactly when
  // items/counts/totals or the load phase change (the same moments the
  // old single value changed).
  const commandsValue = useMemo(
    () => ({ addItem, removeItem, updateQuantity, reconcileLine, clear }),
    [addItem, removeItem, updateQuantity, reconcileLine, clear],
  );

  const stateValue = useMemo(
    () => ({ items, itemCount, totalLYD, isLoaded }),
    [items, itemCount, totalLYD, isLoaded],
  );

  return (
    <CartCommandsContext.Provider value={commandsValue}>
      <CartStateContext.Provider value={stateValue}>{children}</CartStateContext.Provider>
    </CartCommandsContext.Provider>
  );
}

/** Commands-only subscription (R111-F4-F1). For components whose cart
 * interaction is purely mutational — ProductCard's «أضف للسلة» never
 * reads live cart state, so riding the commands context means an
 * add-to-cart tap anywhere on the page costs ZERO card re-renders.
 * Identity is provider-lifetime-stable, so this hook NEVER causes a
 * re-render on its own. */
export function useCartCommands(): CartCommandsValue {
  const ctx = useContext(CartCommandsContext);
  if (!ctx) throw new Error("useCart must be used within <CartProvider>");
  return ctx;
}

/** State-only subscription (R111-F4-F1) — items/count/totals/isLoaded
 * without pulling the commands into the dependency shape. Re-renders
 * exactly when cart data changes. */
export function useCartState(): CartStateValue {
  const ctx = useContext(CartStateContext);
  if (!ctx) throw new Error("useCart must be used within <CartProvider>");
  return ctx;
}

/** Combined subscription (legacy + still the default for page-level
 * consumers): the R98-03 interface, now assembled from the two split
 * contexts. The merge is memoized per consumer, so the pinned identity
 * contract holds — stable across data-less re-renders, a new identity
 * exactly when the cart data changes (commands never change). */
export function useCart(): CartContextValue {
  const commands = useCartCommands();
  const state = useCartState();
  return useMemo(() => ({ ...state, ...commands }), [state, commands]);
}
