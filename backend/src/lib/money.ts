/**
 * AUD103 (r103, found by the topup-boundary rounding test): LYD money
 * rounding that matches Postgres numeric(10,2) semantics.
 *
 * The R102 fix used `+amount.toFixed(2)` at the topup boundaries — but
 * `toFixed` rounds the BINARY float, and the half-cent case it was built
 * for (10.555) is not representable in IEEE-754: the stored double is
 * 10.5549999999999986…, so toFixed(2) yields "10.55" while Postgres
 * numeric would round the intended decimal 10.555 half-up to 10.56.
 * The epsilon-corrected multiply-round fixes exactly that binary-dust
 * zone (any value within 1e-9 of a half-cent) and changes nothing else:
 *
 *   10.555  → 10.56  (the case the R102 comment documents)
 *   10.5551 → 10.56  (true half-up)
 *   10.5549 → 10.55
 *   10.4999 → 10.50
 */

/** Round a LYD amount to 2 decimals, half-up away from the binary dust. */
export function roundLyd(amount: number): number {
  if (!Number.isFinite(amount)) return amount;
  return Math.round(amount * 100 + 1e-9) / 100;
}

/** The same rounding as a numeric(10,2)-ready string (insert boundary). */
export function roundLydString(amount: number): string {
  return String(roundLyd(amount));
}

// B4-F5 (R128): roundLyd — NOT +x.toFixed(2) — is the idiom for EVERY
// balance-mutation boundary. The five legacy +toFixed(2) sites
// (checkout / topup ×2 / refund / loyalty convert) were safe by
// construction (already-2dp operands), but a future writer computing a
// delta from unrounded percent math at one of them would silently
// reintroduce the AUD103 half-cent class; they now ride roundLyd.

// ── R128 (B8-D3): the ONE backend LYD display formatter ────────────────────
//
// en-US grouping + Western digits + «د.ل» — mirroring the web's
// formatCurrency canon (frontend/src/lib/utils.ts) so the same amount
// renders identically on every surface. Until R128 the Telegram cards,
// the bell titles, and the WhatsApp share card showed raw toFixed
// («1380.00 د.ل») while the web showed «1,380.00 د.ل» — the same money
// diverging by channel. Intl.NumberFormat construction is the expensive
// part, so a module-level formatter is reused (options never vary —
// the same trick as the frontend's CURRENCY_NUMBER_FORMATTER).
const LYD_DISPLAY_FORMATTER = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Grouped plain-number form (no «د.ل» suffix) — for callers that append
 *  their own suffix/context (the share card's «— السعر X د.ل» line). */
export function formatLydNumber(amount: number): string {
  return LYD_DISPLAY_FORMATTER.format(amount);
}

/** LYD display string with the «د.ل» suffix («1,380.00 د.ل»). */
export function formatLyd(amount: number): string {
  return `${formatLydNumber(amount)} د.ل`;
}
