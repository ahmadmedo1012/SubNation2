/**
 * Mobile unit-test setup: in-memory twins for the two native storage
 * modules the money/auth logic reads through (SecureStore for the session
 * JWT, AsyncStorage for cart + idempotency envelopes). No React Native
 * runtime is loaded — the suites under test are the pure-logic modules.
 */
import { vi } from "vitest";

const secureStore = new Map<string, string>();

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async (key: string) => secureStore.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => {
    secureStore.set(key, value);
  }),
  deleteItemAsync: vi.fn(async (key: string) => {
    secureStore.delete(key);
  }),
}));

const asyncStorage = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => asyncStorage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      asyncStorage.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      asyncStorage.delete(key);
    }),
    getAllKeys: vi.fn(async () => [...asyncStorage.keys()]),
    multiRemove: vi.fn(async (keys: string[]) => {
      for (const key of keys) asyncStorage.delete(key);
    }),
  },
}));

export function __resetMobileStores(): void {
  secureStore.clear();
  asyncStorage.clear();
}
