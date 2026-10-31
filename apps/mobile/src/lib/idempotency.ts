import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Idempotency keys for the money path — ported from the web's
 * lib/idempotency.ts + lib/intent-envelope.ts (the {k, t, f} envelope).
 *
 * The backend middleware reads `Idempotency-Key` on money mutations:
 * same key + same body → replayed cached response (no double charge);
 * same key + different body → 409 IDEMPOTENCY_KEY_REUSE; concurrent →
 * 409 IDEMPOTENCY_IN_FLIGHT. The mobile flows mint a key per logical
 * intent BEFORE the POST, keep it across manual retries, and clear it
 * only at accounted success / definitive rejection.
 */

const HEX = "0123456789abcdef";

/** Fresh UUID v4 (Hermes lacks crypto.randomUUID; manual RFC 4122 builder). */
export function generateIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx

  const hex: string[] = [];
  for (const b of bytes) {
    hex.push(HEX[b >> 4]);
    hex.push(HEX[b & 0x0f]);
  }
  return (
    hex.slice(0, 8).join("") +
    "-" +
    hex.slice(8, 12).join("") +
    "-" +
    hex.slice(12, 16).join("") +
    "-" +
    hex.slice(16, 20).join("") +
    "-" +
    hex.slice(20, 32).join("")
  );
}

interface StoredIntentKey {
  /** The Idempotency-Key header value. */
  k: string;
  /** Date.now() at mint time — the TTL stamp. */
  t: number;
  /** Intent fingerprint — flow-specific. */
  f: string;
}

/**
 * The envelope guards (verbatim semantics from the web — this is the
 * code that stops double charges):
 *   • corrupted entry JSON.parse-fails → treated as absent, fresh key;
 *   • TTL expiry (10 min web default) → stale intent, fresh key;
 *   • fingerprint mismatch → NEW intent, never a replay onto changed data;
 *   • every access guarded: storage failures degrade to unstable keys,
 *     never throw on the money path.
 */
export async function loadIntentKey(
  slot: string,
  ttlMs: number,
  fingerprint: string,
): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(slot);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredIntentKey>;
    if (typeof parsed.k !== "string" || !parsed.k) return null;
    if (typeof parsed.t !== "number" || Number.isNaN(parsed.t)) return null;
    if (Date.now() - parsed.t > ttlMs) return null;
    if (parsed.f !== fingerprint) return null;
    return parsed.k;
  } catch {
    return null;
  }
}

export async function persistIntentKey(
  slot: string,
  fingerprint: string,
  key: string,
): Promise<void> {
  try {
    const entry: StoredIntentKey = { k: key, t: Date.now(), f: fingerprint };
    await AsyncStorage.setItem(slot, JSON.stringify(entry));
  } catch {
    // degraded: unstable keys — never throw on the money path
  }
}

export async function clearIntentKey(slot: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(slot);
  } catch {
    // ignore
  }
}

/** Flow slots (same keys as the web where the semantics match). */
export const INTENT_SLOTS = {
  /** Per-unit checkout key: `subnation_checkout_key:{pid}:{variant}:{unitIndex}`. */
  checkoutUnit: (productId: number, variantId: number | null, unitIndex: number) =>
    `subnation_checkout_key:${productId}:${variantId ?? 0}:${unitIndex}`,
  /** PDP single-buy key. */
  buy: (productId: number) => `subnation_buykey:${productId}`,
  /** Wallet topup key. */
  topup: "subnation_topupkey",
  /** Loyalty convert key. */
  convert: "subnation_convert_key",
} as const;

/** The web's 10-minute intent TTL. */
export const INTENT_TTL_MS = 10 * 60 * 1000;
