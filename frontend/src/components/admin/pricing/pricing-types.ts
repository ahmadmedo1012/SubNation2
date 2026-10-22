// R137 (FE decomposition): extracted verbatim from pages/admin/pricing.tsx —
// the recompute dry-run response contract moved to its own React-free
// module so the page and the presentational extracts share ONE typed
// source instead of a page-local interface. Types only, zero behavior
// change. R181: the calculator wire contract (CalculatorResponse) left
// with the retired simulator — this module is the recompute surface only.

/**
 * R115 (Part 15): the recompute dry-run response — POST
 * /api/admin/pricing/recompute?dry_run=true. Counts + a capped
 * BEFORE→AFTER sample per drifted variant, zero writes.
 */
export interface RecomputeDryRun {
  dry_run: true;
  variants_drifted: number;
  products_affected: number;
  sample: Array<{
    variant_id: number;
    product_id: number;
    price_before: number;
    price_after: number;
    delta: number;
  }>;
  usd_to_lyd: number;
  markup_percent: number;
  note: string;
}
