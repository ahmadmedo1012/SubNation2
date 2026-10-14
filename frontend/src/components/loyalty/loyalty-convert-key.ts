import { clearIntentKey, loadIntentKey, persistIntentKey } from "@/lib/intent-envelope";

// R137 (FE decomposition): extracted verbatim from pages/loyalty.tsx —
// the durable conversion-intent key (the checkout unit-key module's
// loyalty twin). Pure storage lifecycle: no React, no lucide, no
// fetches — the page's handleConvert owns the mint/replay/clear
// threading (the 99-M4 + AUD103-2-F3 money path), this module only
// persists and revalidates the envelope. The slot name and TTL are the
// values loyalty-convert-journey.test.tsx pins at the localStorage
// level ("subnation_convert_key"); the move changes neither.
// R146 (components audit F3): the {k,t,f} envelope mechanics moved to
// lib/intent-envelope.ts — this module keeps the slot, TTL and the
// page-owned fingerprint convention.

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

export function loadStoredConvertKey(fingerprint: string): string | null {
  return loadIntentKey(localStorage, CONVERT_KEY, CONVERT_KEY_TTL_MS, fingerprint);
}

export function persistStoredConvertKey(fingerprint: string, key: string): void {
  persistIntentKey(localStorage, CONVERT_KEY, fingerprint, key);
}

export function clearStoredConvertKey(): void {
  clearIntentKey(localStorage, CONVERT_KEY);
}
