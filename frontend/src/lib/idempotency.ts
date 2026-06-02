/**
 * Idempotency-Key generation — F-008 (security audit 004) frontend half.
 *
 * Companion to the backend middleware at
 * `backend/src/middlewares/idempotency.ts`. The middleware reads the
 * `Idempotency-Key` header on state-changing admin endpoints and:
 *
 *   - first call with a key → executes + caches the response for 24h
 *   - retry with the SAME key → replays the cached response
 *   - concurrent retry with the same key → returns 409 (in-flight)
 *   - same key, different body → returns 409 (key reuse with new intent)
 *
 * This module's only job is to produce a unique UUID v4 per logical
 * admin action. We use the WebCrypto `crypto.randomUUID()` API when
 * available (every browser SubNation supports — see
 * caniuse: ≥ Chrome 92, Firefox 95, Safari 15.4, all 2022+).
 *
 * Fallback path: a manual v4 builder using `crypto.getRandomValues()`,
 * which has been universally supported since 2016. The fallback
 * exists so a future browser-version pin doesn't silently break the
 * idempotency contract — it is NOT a hot path today.
 *
 * Usage pattern (per audit guidance):
 *
 *   - "preserved across retries of the same intent" — generate the key
 *     ONCE when the user initiates a logical action (modal submit,
 *     button click). React Query's variables object survives across
 *     internal retries, so passing the key as a mutation variable keeps
 *     it stable.
 *
 *   - "unique per new action" — every NEW initiation calls
 *     generateIdempotencyKey() again. Don't memoise across actions.
 *
 *   - Bulk operations: ONE key per logical bulk (a "Refund 5 orders"
 *     button is one intent), not per item. Per-item retry-safety is
 *     handled server-side by the per-record status guards.
 */

const HEX = "0123456789abcdef";

/**
 * Generate a fresh UUID v4 string (RFC 4122).
 *
 * Returned values are 36 characters (32 hex + 4 dashes), suitable for
 * direct use as the Idempotency-Key HTTP header value.
 *
 * SECURITY NOTE: idempotency keys are NOT secrets — they're collision-
 * resistance tokens, not auth tokens. We still use `crypto.getRandomValues`
 * (CSPRNG) so a user can't trivially guess another admin's keys, which
 * would let them poke at the in-flight cache. Math.random() would be a
 * defense-in-depth gap, not an exploitable hole, but the CSPRNG is
 * cheap and universally available.
 */
export function generateIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  // Manual UUID v4 fallback. Layout: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  // where x is any hex and y is one of 8/9/a/b. Bit-twiddling per RFC 4122.
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    // Last-resort fallback. Should never run in any browser SubNation
    // supports today — kept so the function is total in non-browser
    // contexts (SSR previews, test runners) without throwing.
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
  // 8-4-4-4-12 dashes
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

/**
 * Convenience: build a headers object with the Idempotency-Key set.
 * Accepts an existing headers map (typically the admin-auth headers
 * from `useAdminHeaders({ json: true })`) and returns a NEW object
 * with the key appended. Does not mutate the input.
 */
export function withIdempotencyKey(
  headers: Record<string, string>,
  key: string,
): Record<string, string> {
  return { ...headers, "Idempotency-Key": key };
}
