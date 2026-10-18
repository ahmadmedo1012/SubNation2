/**
 * R146 (components audit F3): the ONE durable intent-key envelope — the
 * {k, t, f} load/persist/clear lifecycle the four money-path modules
 * (checkout/checkout-unit-key, product/buy-intent-key,
 * wallet/topup-intent-key, loyalty/loyalty-convert-key) each hand-rolled
 * near-verbatim. Only the storage slot, the TTL and the fingerprint
 * differ per flow: each module keeps those constants (plus its
 * fingerprint builder and its clear-vs-rotate policy — topup is
 * deliberately rotation-only, no clear) and delegates the mechanics
 * here. lib/idempotency.ts's R-140-o map documents the four flows.
 *
 * R165: FIVE consumers now. The fifth — components/checkout/
 * checkout-group-key.ts (the multi-order group token, R162 ADR §2.1.1)
 * — reuses persistIntentKey/clearIntentKey but hand-rolls its LOAD by
 * documented design: the group token is informational (never a
 * double-charge guard), so its fingerprint check is the subset-tolerant
 * overlap form (a partial-failure retry's remaining lines stay in the
 * SAME group) instead of the exact match below; its envelope-shape,
 * TTL and corruption guards mirror loadIntentKey verbatim.
 *
 * Guards preserved from every former copy (they must never diverge
 * again — this is the code that stops double charges):
 *   • a corrupted entry / raw pre-envelope key JSON.parse-fails → the
 *     entry is treated as absent and a fresh key is minted;
 *   • TTL: a key older than the flow's window is a stale intent, not
 *     this retry (the r97 F-07 lesson — it must never swallow a NEW
 *     purchase via the server's 24 h replay window);
 *   • fingerprint mismatch: a NEW intent, never a replay onto changed
 *     data (the backend's same-key-different-body 409 stays unreachable);
 *   • every access is try/catch-guarded: private-mode / quota failures
 *     degrade to unstable keys, never throw on the money path.
 */

interface StoredIntentKey {
  /** The Idempotency-Key header value. */
  k: string;
  /** Date.now() at mint time — the TTL stamp. */
  t: number;
  /** Intent fingerprint — flow-specific. */
  f: string;
}

export function loadIntentKey(
  storage: Pick<Storage, "getItem">,
  slot: string,
  ttlMs: number,
  fingerprint: string,
): string | null {
  try {
    const raw = storage.getItem(slot);
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

export function persistIntentKey(
  storage: Pick<Storage, "setItem">,
  slot: string,
  fingerprint: string,
  key: string,
): void {
  try {
    const entry: StoredIntentKey = { k: key, t: Date.now(), f: fingerprint };
    storage.setItem(slot, JSON.stringify(entry));
  } catch {
    // degraded: unstable keys (pre-fix behavior) — never throw on money path
  }
}

export function clearIntentKey(storage: Pick<Storage, "removeItem">, slot: string): void {
  try {
    storage.removeItem(slot);
  } catch {
    // ignore
  }
}
