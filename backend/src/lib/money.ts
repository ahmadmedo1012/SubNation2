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
