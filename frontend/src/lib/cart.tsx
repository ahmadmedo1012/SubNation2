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
  removeItem: (productId: number) => void;
  updateQuantity: (productId: number, quantity: number) => void;
  clear: () => void;
  isLoaded: boolean;
}

const STORAGE_KEY = "subnation_cart_v1";

// Mirror of the backend quantity cap — an uncapped value (1e9 was
// accepted) turned the per-unit checkout loop into a self-DoS.
export const MAX_LINE_QUANTITY = 99;

const CartContext = createContext<CartContextValue | null>(null);

function effectivePrice(item: LocalCartItem): number {
  return item.salePriceLYD ?? item.priceLYD;
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<LocalCartItem[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as LocalCartItem[];
        if (Array.isArray(parsed)) setItems(parsed);
      }
    } catch {
      // ignore corrupt storage
    }
    setIsLoaded(true);
  }, []);

  function persist(nextItems: LocalCartItem[]) {
    setItems(nextItems);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextItems));
    } catch {
      // ignore quota errors
    }
  }

  const addItem = useCallback(
    (incoming: Omit<LocalCartItem, "quantity"> & { quantity?: number }) => {
      const qty = Math.min(incoming.quantity ?? 1, MAX_LINE_QUANTITY);
      setItems((prev) => {
        const existing = prev.find((i) => i.productId === incoming.productId);
        let next: LocalCartItem[];
        if (existing) {
          next = prev.map((i) =>
            i.productId === incoming.productId
              ? { ...i, quantity: Math.min(i.quantity + qty, MAX_LINE_QUANTITY) }
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

  const removeItem = useCallback((productId: number) => {
    setItems((prev) => {
      const next = prev.filter((i) => i.productId !== productId);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const updateQuantity = useCallback((productId: number, quantity: number) => {
    if (quantity < 1) return;
    const safeQty = Math.min(quantity, MAX_LINE_QUANTITY);
    setItems((prev) => {
      const next = prev.map((i) => (i.productId === productId ? { ...i, quantity: safeQty } : i));
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setItems([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  const totalLYD = items.reduce((sum, i) => sum + effectivePrice(i) * i.quantity, 0);
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
