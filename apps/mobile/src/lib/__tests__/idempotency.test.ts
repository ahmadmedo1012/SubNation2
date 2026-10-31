import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearIntentKey,
  generateIdempotencyKey,
  INTENT_SLOTS,
  INTENT_TTL_MS,
  loadIntentKey,
  persistIntentKey,
} from "@/lib/idempotency";
import { __resetMobileStores } from "@/test/setup";

/**
 * The {k, t, f} envelope guards — the client half of the M5/M6
 * double-charge stoppers. These mirror the web's intent-envelope
 * semantics exactly; a regression here re-opens the manual-retry
 * double-charge window.
 */
describe("intent-key envelope", () => {
  beforeEach(() => {
    __resetMobileStores();
  });
  afterEach(() => {
    __resetMobileStores();
  });

  it("round-trips a persisted intent", async () => {
    await persistIntentKey("slot", "fp", "key-1");
    expect(await loadIntentKey("slot", INTENT_TTL_MS, "fp")).toBe("key-1");
  });

  it("missing slot → null (fresh key minted by caller)", async () => {
    expect(await loadIntentKey("absent", INTENT_TTL_MS, "fp")).toBeNull();
  });

  it("corrupted entry → treated as absent", async () => {
    const { default: AsyncStorage } = await import("@react-native-async-storage/async-storage");
    await AsyncStorage.setItem("slot", "{not json");
    expect(await loadIntentKey("slot", INTENT_TTL_MS, "fp")).toBeNull();
  });

  it("fingerprint mismatch → NEW intent, never a replay onto changed data", async () => {
    await persistIntentKey("slot", "fingerprint-A", "key-1");
    expect(await loadIntentKey("slot", INTENT_TTL_MS, "fingerprint-B")).toBeNull();
  });

  it("TTL expiry → stale intent, fresh key", async () => {
    const { default: AsyncStorage } = await import("@react-native-async-storage/async-storage");
    await AsyncStorage.setItem(
      "slot",
      JSON.stringify({ k: "key-1", t: Date.now() - INTENT_TTL_MS - 1, f: "fp" }),
    );
    expect(await loadIntentKey("slot", INTENT_TTL_MS, "fp")).toBeNull();
    // Just-inside the window still replays.
    await AsyncStorage.setItem(
      "slot",
      JSON.stringify({ k: "key-2", t: Date.now() - INTENT_TTL_MS + 1000, f: "fp" }),
    );
    expect(await loadIntentKey("slot", INTENT_TTL_MS, "fp")).toBe("key-2");
  });

  it("clear removes the slot", async () => {
    await persistIntentKey("slot", "fp", "key-1");
    await clearIntentKey("slot");
    expect(await loadIntentKey("slot", INTENT_TTL_MS, "fp")).toBeNull();
  });

  it("slots follow the web's naming contract", () => {
    expect(INTENT_SLOTS.checkoutUnit(7, 3, 0)).toBe("subnation_checkout_key:7:3:0");
    expect(INTENT_SLOTS.checkoutUnit(7, null, 2)).toBe("subnation_checkout_key:7:0:2");
    expect(INTENT_SLOTS.buy(9)).toBe("subnation_buykey:9");
    expect(INTENT_SLOTS.topup).toBe("subnation_topupkey");
    expect(INTENT_SLOTS.convert).toBe("subnation_convert_key");
  });
});

describe("generateIdempotencyKey", () => {
  it("produces RFC 4122 v4 UUIDs", () => {
    const key = generateIdempotencyKey();
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("produces unique keys", () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateIdempotencyKey()));
    expect(seen.size).toBe(500);
  });
});
