import { loadIntentKey, persistIntentKey } from "@/lib/intent-envelope";

// R136 (FE-1 decomposition): extracted verbatim from pages/wallet.tsx —
// the money-page's durable topup intent-key helpers moved to their own
// module so the page file shrinks to orchestration. Pure functions over
// sessionStorage; ZERO React, zero behavior change (the page imports them
// by name — every call site, TTL and fingerprint stays byte-identical).
// R146 (components audit F3): the {k,t,f} envelope mechanics moved to
// lib/intent-envelope.ts — this module keeps the slot, TTL and
// fingerprint builder. NO clear exists here on purpose (rotation-only,
// the 96-F6 reset points in the page own every rotation) — the shared
// envelope's clear is simply not imported.

// ── 98-F2 (R98-09 / r98 frontend-deep §2 — P3): durable topup intent key ─────
//
// The topup Idempotency-Key used to live in a useRef ONLY — it died with
// the component, so a refresh / back-navigation after a NETWORK-level
// failure (response lost, topup possibly created server-side) minted a
// FRESH key on the re-submit: the header became useless exactly when it
// was needed (the backend still holds the second line of defense — the
// uniq_wallet_topups_payment_reference constraint + composite dedup —
// so this is defense-in-depth parity with the buy-key/checkout-key
// patterns from 96-F4 / 97-F5).
//
// Storage contract (mirrors product.tsx's subnation_buykey, 97-F5 — the
// envelope guards live in lib/intent-envelope.ts):
//   • slot:   sessionStorage "subnation_topupkey" — per-tab retry token,
//     never durable state; every access try/catch-guarded (quota/
//     private-mode degrades to the in-memory 96-F6 behavior);
//   • TTL:    a key older than 10 minutes is a stale intent → ignored;
//   • fingerprint: amount | method | phone — binds the key to WHAT is
//     being topped up so a stale intent is never replayed onto changed
//     data (the full body also carries network/account/reference — those
//     still ROTATE the key via the 96-F6 field-change points below,
//     which keeps the backend's 409 same-key-different-body branch
//     unreachable);
//   • restore: on mount, AFTER the saved preferences are applied — a
//     stored entry still inside its TTL whose fingerprint matches the
//     restored state (prefs amount/method + empty phone) is reused so
//     the re-submit replays the server's cached response instead of
//     creating a second pending topup. An intent whose phone was typed
//     (never restored from prefs by design) simply re-mints — the
//     payment_reference dedup covers that residual.
const TOPUP_KEY_SLOT = "subnation_topupkey";
/** 98-F2 (R98-09): retry-token TTL — mirrors the buy-key guidance. */
const TOPUP_KEY_TTL_MS = 10 * 60 * 1000;

export function topupIntentFingerprint(amount: string, method: string, phone: string): string {
  return `${amount}|${method}|${phone.trim()}`;
}

export function loadTopupIntentKey(fingerprint: string): string | null {
  return loadIntentKey(sessionStorage, TOPUP_KEY_SLOT, TOPUP_KEY_TTL_MS, fingerprint);
}

export function persistTopupIntentKey(fingerprint: string, key: string): void {
  persistIntentKey(sessionStorage, TOPUP_KEY_SLOT, fingerprint, key);
}
