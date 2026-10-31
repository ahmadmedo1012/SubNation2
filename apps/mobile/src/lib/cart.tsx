import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * Local cart — ported from the web's lib/cart.tsx: the same
 * LocalCartItem contract, line identity (productId:variantId), the same
 * storage key (`subnation_cart_v2`) and quantity/stock semantics, backed
 * by AsyncStorage instead of localStorage. The server's in-tx stock
 * re-check at checkout stays the charge authority — stockCount here is
 * advisory UI only.
 */

export const CART_STORAGE_KEY = "subnation_cart_v2";
export const MAX_LINE_QUANTITY = 99;
export const LOW_STOCK_THRESHOLD = 3;

export interface LocalCartItem {
  productId: number;
  /** Selected catalog variant (product_variants.id) — null = variant-less product. */
  variantId: number | null;
  /** Joined display label captured when the line was added. */
  variantLabel: string | null;
  slug: string | null;
  name: string;
  imageUrl: string | null;
  priceLYD: number;
  salePriceLYD: number | null;
  discountPercent: number | null;
  quantity: number;
  /** Catalog stock snapshot at add-to-cart time — null = unknown. */
  stockCount?: number | null;
}

export type StockVerdict = "unknown" | "ok" | "low" | "insufficient" | "out";

export function stockVerdict(line: LocalCartItem): StockVerdict {
  const stock = line.stockCount;
  if (stock === null || stock === undefined) return "unknown";
  if (stock <= 0) return "out";
  if (stock < line.quantity) return "insufficient";
  if (stock <= LOW_STOCK_THRESHOLD) return "low";
  return "ok";
}

interface CartContextValue {
  items: LocalCartItem[];
  itemCount: number;
  totalLYD: number;
  isLoaded: boolean;
  addItem: (
    item: Omit<LocalCartItem, "quantity" | "stockCount"> & {
      quantity?: number;
      stockCount?: number | null;
    },
  ) => boolean;
  removeItem: (productId: number, variantId?: number | null) => void;
  updateQuantity: (productId: number, quantity: number, variantId?: number | null) => void;
  reconcileLine: (
    productId: number,
    pricing: Pick<LocalCartItem, "priceLYD" | "salePriceLYD" | "discountPercent"> & {
      stockCount?: number | null;
    },
    variantId?: number | null,
  ) => void;
  clear: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

function lineIdentity(productId: number, variantId: number | null): string {
  return `${productId}:${variantId ?? 0}`;
}

function computeTotals(items: LocalCartItem[]): { itemCount: number; totalLYD: number } {
  let itemCount = 0;
  let totalLYD = 0;
  for (const item of items) {
    itemCount += item.quantity;
    const effective = item.salePriceLYD ?? item.priceLYD;
    totalLYD += effective * item.quantity;
  }
  return { itemCount, totalLYD: Math.round(totalLYD * 100) / 100 };
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<LocalCartItem[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const hydrating = useRef(true);

  // Hydrate once from AsyncStorage.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(CART_STORAGE_KEY);
        if (raw && active) {
          const parsed = JSON.parse(raw) as LocalCartItem[];
          if (Array.isArray(parsed)) setItems(parsed);
        }
      } catch {
        // Corrupted cart storage starts fresh (same as the web).
      }
      if (active) {
        hydrating.current = false;
        setIsLoaded(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Persist on every change after hydration.
  useEffect(() => {
    if (hydrating.current) return;
    void AsyncStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items)).catch(() => {
      // Quota failures degrade to an in-memory cart.
    });
  }, [items]);

  const addItem = useCallback<CartContextValue["addItem"]>((item) => {
    const quantity = Math.max(1, Math.min(item.quantity ?? 1, MAX_LINE_QUANTITY));
    let grew = true;
    setItems((prev) => {
      const id = lineIdentity(item.productId, item.variantId ?? null);
      const index = prev.findIndex((line) => lineIdentity(line.productId, line.variantId) === id);
      if (index === -1) {
        return [...prev, { ...item, quantity, stockCount: item.stockCount ?? null }];
      }
      const existing = prev[index]!;
      // Stock-aware raise cap (R130: honest refusal instead of lying success).
      const stock = item.stockCount ?? existing.stockCount ?? null;
      const ceiling =
        stock !== null && stock > 0 ? Math.min(stock, MAX_LINE_QUANTITY) : MAX_LINE_QUANTITY;
      const nextQty = existing.quantity + quantity;
      if (nextQty > ceiling) {
        grew = false;
        const capped = prev.map((line, i) =>
          i === index
            ? {
                ...line,
                quantity: Math.max(existing.quantity, Math.min(ceiling, nextQty)),
                stockCount: item.stockCount ?? existing.stockCount ?? null,
              }
            : line,
        );
        return capped;
      }
      return prev.map((line, i) =>
        i === index
          ? {
              ...line,
              quantity: nextQty,
              // A re-add refreshes the stock snapshot when the caller knows it.
              stockCount: item.stockCount ?? existing.stockCount ?? null,
            }
          : line,
      );
    });
    return grew;
  }, []);

  const removeItem = useCallback((productId: number, variantId?: number | null) => {
    const id = lineIdentity(productId, variantId ?? null);
    setItems((prev) => prev.filter((line) => lineIdentity(line.productId, line.variantId) !== id));
  }, []);

  const updateQuantity = useCallback(
    (productId: number, quantity: number, variantId?: number | null) => {
      const id = lineIdentity(productId, variantId ?? null);
      setItems((prev) => {
        if (quantity <= 0) {
          return prev.filter((line) => lineIdentity(line.productId, line.variantId) !== id);
        }
        return prev.map((line) =>
          lineIdentity(line.productId, line.variantId) === id
            ? { ...line, quantity: Math.min(quantity, MAX_LINE_QUANTITY) }
            : line,
        );
      });
    },
    [],
  );

  const reconcileLine = useCallback<CartContextValue["reconcileLine"]>(
    (productId, pricing, variantId) => {
      const id = lineIdentity(productId, variantId ?? null);
      setItems((prev) =>
        prev.map((line) =>
          lineIdentity(line.productId, line.variantId) === id
            ? {
                ...line,
                priceLYD: pricing.priceLYD,
                salePriceLYD: pricing.salePriceLYD,
                discountPercent: pricing.discountPercent,
                // key-present semantics: omit = keep snapshot, null = unknown
                ...(pricing.stockCount !== undefined ? { stockCount: pricing.stockCount } : {}),
              }
            : line,
        ),
      );
    },
    [],
  );

  const clear = useCallback(() => {
    setItems([]);
  }, []);

  const value = useMemo<CartContextValue>(() => {
    const { itemCount, totalLYD } = computeTotals(items);
    return {
      items,
      itemCount,
      totalLYD,
      isLoaded,
      addItem,
      removeItem,
      updateQuantity,
      reconcileLine,
      clear,
    };
  }, [items, isLoaded, addItem, removeItem, updateQuantity, reconcileLine, clear]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside <CartProvider>");
  return ctx;
}
