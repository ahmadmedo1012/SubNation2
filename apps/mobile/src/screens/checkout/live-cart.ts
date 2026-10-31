import AsyncStorage from "@react-native-async-storage/async-storage";

import { CART_STORAGE_KEY, type LocalCartItem } from "@/lib/cart";

/**
 * Live-cart reads for the money path — the native port of the web's
 * readLiveCartItems (lib/cart.tsx): a raw storage read that bypasses
 * React state, used by the per-unit purchase loop to re-check the cart
 * BEFORE every unit POST and by the post-flight cart sync.
 *
 * Semantics mirror the web exactly: null = the read is inconclusive
 * (storage unavailable / corrupted payload) and the caller's guard is
 * SKIPPED (pre-fix behavior — never a false "line gone"); an array
 * (including the empty one) is a valid live snapshot.
 */
function looksLikeCartItem(value: unknown): value is LocalCartItem {
  if (typeof value !== "object" || value === null) return false;
  const line = value as Partial<LocalCartItem>;
  return typeof line.productId === "number" && typeof line.quantity === "number";
}

export async function readLiveCartItems(): Promise<LocalCartItem[] | null> {
  try {
    const raw = await AsyncStorage.getItem(CART_STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(looksLikeCartItem)) return null;
    return parsed as LocalCartItem[];
  } catch {
    return null;
  }
}
