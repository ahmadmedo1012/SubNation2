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
}

interface CartCommandsValue {
  addItem: (item: Omit<LocalCartItem, "quantity"> & { quantity?: number }) => void;
  removeItem: (productId: number, variantId?: number | null) => void;
  updateQuantity: (productId: number, quantity: number, variantId?: number | null) => void;
  /** 98-F2 (R98-A3 F5 — P2): refresh a line's PRICE snapshot (never its
   * quantity) from the live catalog. Used by checkout's mount-time
   * re-quote so the confirmed label can never diverge from the charged
   * amount when a flash sale ends (or a price changes) between
   * add-to-cart and confirm. No-op (same array identity) when the line
   * no longer exists. */
  reconcileLine: (
    productId: number,
    pricing: Pick<LocalCartItem, "priceLYD" | "salePriceLYD" | "discountPercent">,
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
    (incoming: Omit<LocalCartItem, "quantity"> & { quantity?: number }) => {
      const qty = Math.min(incoming.quantity ?? 1, MAX_LINE_QUANTITY);
      const key = lineKey(incoming);
      setItems((prev) => {
        const existing = prev.find((i) => lineKey(i) === key);
        let next: LocalCartItem[];
        if (existing) {
          next = prev.map((i) =>
            lineKey(i) === key
              ? {
                  ...i,
                  // refresh the price snapshot for the SAME variant on
                  // re-add (a flash sale may have started since).
                  priceLYD: incoming.priceLYD,
                  salePriceLYD: incoming.salePriceLYD,
                  discountPercent: incoming.discountPercent,
                  quantity: Math.min(i.quantity + qty, MAX_LINE_QUANTITY),
                }
              : i,
          );
        } else {
          next = [...prev, { ...incoming, quantity: qty }];
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
      const safeQty = Math.min(quantity, MAX_LINE_QUANTITY);
      const key = lineKey({ productId, variantId: variantId ?? null });
      setItems((prev) => {
        const next = prev.map((i) => (lineKey(i) === key ? { ...i, quantity: safeQty } : i));
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
      pricing: Pick<LocalCartItem, "priceLYD" | "salePriceLYD" | "discountPercent">,
      variantId?: number | null,
    ) => {
      const key = lineKey({ productId, variantId: variantId ?? null });
      setItems((prev) => {
        let changed = false;
        const next = prev.map((i) => {
          if (lineKey(i) !== key) return i;
          changed = true;
          return { ...i, ...pricing };
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
