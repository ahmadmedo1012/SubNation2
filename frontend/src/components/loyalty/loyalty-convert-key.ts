// R137 (FE decomposition): extracted verbatim from pages/loyalty.tsx —
// the durable conversion-intent key (the checkout unit-key module's
// loyalty twin). Pure storage lifecycle: no React, no lucide, no
// fetches — the page's handleConvert owns the mint/replay/clear
// threading (the 99-M4 + AUD103-2-F3 money path), this module only
// persists and revalidates the envelope. The slot name and TTL are the
// values loyalty-convert-journey.test.tsx pins at the localStorage
// level ("subnation_convert_key"); the move changes neither.

// ── AUD103-2-F3 (r103): durable conversion-intent key ──────────────────────
//
// Same envelope as the checkout unit keys (98-F2): {k, t, f} — key, TTL
// stamp, intent fingerprint (the points amount being converted). A key
// older than the TTL is a stale intent; a different points amount is a
// NEW intent (never replay the old charge onto different data). Every
// access is try/catch-guarded so private-mode/quota failures degrade to
// unstable keys instead of blocking the money path.
const CONVERT_KEY = "subnation_convert_key";
const CONVERT_KEY_TTL_MS = 10 * 60 * 1000;

interface StoredConvertKey {
  /** The Idempotency-Key header value. */
  k: string;
  /** Date.now() at mint time — the TTL stamp. */
  t: number;
  /** Intent fingerprint — `convert|<points>`. */
  f: string;
}

export function loadStoredConvertKey(fingerprint: string): string | null {
  try {
    const raw = localStorage.getItem(CONVERT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredConvertKey>;
    if (typeof parsed.k !== "string" || !parsed.k) return null;
    if (typeof parsed.t !== "number" || Number.isNaN(parsed.t)) return null;
    if (Date.now() - parsed.t > CONVERT_KEY_TTL_MS) return null;
    if (parsed.f !== fingerprint) return null;
    return parsed.k;
  } catch {
    return null;
  }
}

export function persistStoredConvertKey(fingerprint: string, key: string): void {
  try {
    const entry: StoredConvertKey = { k: key, t: Date.now(), f: fingerprint };
    localStorage.setItem(CONVERT_KEY, JSON.stringify(entry));
  } catch {
    // degraded: unstable keys (pre-fix behavior) — never throw on money path
  }
}

export function clearStoredConvertKey(): void {
  try {
    localStorage.removeItem(CONVERT_KEY);
  } catch {
    // ignore
  }
}
