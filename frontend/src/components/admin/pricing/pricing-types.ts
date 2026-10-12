// R137 (FE decomposition): extracted verbatim from pages/admin/pricing.tsx —
// the calculator's wire contracts (POST /api/admin/pricing/calculate + the
// recompute dry-run response) moved to their own React-free module so the
// page and the presentational extracts share ONE typed source instead of a
// page-local interface. Types only, zero behavior change.

export type RiskState = "SAFE" | "WATCH" | "THIN" | "LOSS";

export interface CalculatorResponse {
  inputs: {
    product_id: number | null;
    product_name: string | null;
    variant_id: number | null;
    variant_label: string | null;
    price_source: "variant" | "product_cheapest_variant" | "manual";
    list_price: number;
    cost_price: number | null;
    cost_usd: number | null;
    coupon_code: string | null;
    simulate_referred: boolean;
  };
  config: {
    usd_to_lyd: number;
    markup_percent: number;
    max_total_discount_pct: number;
  };
  flash_sale: { discount_percent: number; title: string } | null;
  coupon: {
    code: string;
    type: "percentage" | "fixed";
    value: number;
    valid: boolean;
    reason_invalid: string | null;
  } | null;
  pricing: {
    list_price: number;
    base_price: number;
    discount_amount: number;
    final_price: number;
  };
  loyalty: {
    points_earned: number;
    lyd_accrued: number;
    points_per_lyd: number;
  };
  referral_cost: {
    welcome_bonus_lyd: number;
    referrer_points: number;
    referrer_lyd_value: number;
    total_referral_cost_lyd: number;
    trigger?: string;
  };
  margins: {
    gross_lyd: number | null;
    gross_pct: number | null;
    net_lyd: number | null;
    net_pct: number | null;
    referral_adjusted_lyd: number | null;
    referral_adjusted_pct: number | null;
  };
  worst_case: {
    combined_discount_pct: number;
    price: number;
    gross_lyd: number | null;
    contribution_lyd: number | null;
    referred_contribution_lyd: number | null;
  };
  guardrails: {
    break_even_price: number | null;
    safe_min_price_incl_program: number | null;
    max_safe_discount_pct: number | null;
  };
  risk_state: RiskState;
  warnings: Array<{
    severity: "loss" | "low_margin" | "info" | "cap";
    code: string;
    message_ar: string;
  }>;
}

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
