// R137 (FE decomposition): extracted verbatim from pages/admin/pricing.tsx —
// the pricing settings screen's pure money formatters moved to their own
// module so the page file shrinks to orchestration. ZERO React, zero
// behavior change (the page + the presentational extracts import them by
// name — every call site, the per-decimals formatter cache and the
// cent-rounding convention stay byte-identical).

// R125-I3 (A2-10b): grouped money formatting — fmt used to render bare
// toFixed(2) ("1250.00 د.ل") while the product picker used
// formatCurrency's grouped "1,250.00 د.ل" on the SAME page, so
// ≥1000-dinar values read with inconsistent digit grouping. Same en-US
// grouping convention as utils.ts CURRENCY_NUMBER_FORMATTER, cached per
// decimals value (Intl construction is the expensive part).
const FMT_FORMATTERS = new Map<number, Intl.NumberFormat>();

export function fmt(n: number | null | undefined, decimals = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  let f = FMT_FORMATTERS.get(decimals);
  if (!f) {
    f = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    FMT_FORMATTERS.set(decimals, f);
  }
  return f.format(n);
}

/** Same cent-rounding the backend pricing engine applies (round2). */
export const round2 = (v: number): number => Math.round(v * 100) / 100;

/** Trim trailing zeros for the formula's factor/rate (2, not 2.00). */
export function fmtFactor(n: number): string {
  return String(Number(n.toFixed(2)));
}
