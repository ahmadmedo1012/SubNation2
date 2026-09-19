import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
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

interface CartContextValue {
  items: LocalCartItem[];
  itemCount: number;
  totalLYD: number;
  addItem: (item: Omit<LocalCartItem, "quantity"> & { quantity?: number }) => void;
  removeItem: (productId: number, variantId?: number | null) => void;
  updateQuantity: (productId: number, quantity: number, variantId?: number | null) => void;
  clear: () => void;
  isLoaded: boolean;
}

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

const CartContext = createContext<CartContextValue | null>(null);

function effectivePrice(item: LocalCartItem): number {
  return item.salePriceLYD ?? item.priceLYD;
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
    try {
      // v1 → v2 migration: legacy lines (no variant fields) are re-shaped
      // with variantId=null so the rest of the app can assume the field
      // exists. Content is otherwise preserved.
      const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Array<Partial<LocalCartItem>>;
        if (Array.isArray(parsed)) {
          setItems(
            parsed
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
              })),
          );
        }
      }
    } catch {
      // ignore corrupt storage
    }
    setIsLoaded(true);
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

  return (
    <CartContext.Provider
      value={{ items, itemCount, totalLYD, addItem, removeItem, updateQuantity, clear, isLoaded }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within <CartProvider>");
  return ctx;
}
