/**
 * R162 (Lane D) — catalog-quality price-matrix validator (pure functions).
 *
 * Motivation (live evidence, 2026-10-12): the Ahrefs product sells
 * «قياسي» (Standard) — سنوي and «متقدم» (Advanced) — سنوي at the SAME
 * price (15,980 LYD each) while its own monthly prices order them
 * 3,980 < 5,980 — an internal inconsistency in the variant price matrix
 * that no existing guard catches:
 *   - uniq_product_variants_plan_duration (V1-M17) blocks duplicate
 *     (plan, duration) ROWS, not equal prices across tiers;
 *   - chk_variant_price_pos (V1-M29) only requires price > 0;
 *   - the public routes COMPUTE price/price_from from the variant pool
 *     (displayBaseFromVariants, R130) so the display price can never
 *     drift from the variants — but nothing checks tier-vs-tier
 *     consistency.
 *
 * The rule (pure numeric comparison — no language heuristics): for every
 * pair of distinct plan labels sharing ≥ 2 duration labels, a STRICT price
 * ordering established at one shared duration must hold at EVERY shared
 * duration — both its strictness (equalization = the Ahrefs defect) and
 * its direction (inversion = the mirror data-entry error). Plans priced
 * identically at ALL shared durations are internally consistent and pass
 * by design — that pattern is legitimate: Sling Orange and Sling Blue
 * officially cost the same at the vendor ($45.99/mo), as do the cPanel
 * VPS/Dedicated resales (verified against the live catalog 2026-10-12:
 * the rule flags exactly the Ahrefs pair and nothing else in 45/45
 * products).
 *
 * Deliberate limits (documented, not implemented):
 *   - single-duration products (plan axis with duration_label = null,
 *     e.g. storage tiers / license SKUs) have nothing to cross-check;
 *   - sale_price/discount are ignored — flash discounts are uniform per
 *     product, so they preserve the listed-price ordering anyway;
 *   - wired (R167, audit item B3) into the admin variant write path
 *     (routes/admin/product-variants.ts) as a WARN-FIRST, never-blocking
 *     additive `warnings` response field over the ACTIVE variant matrix —
 *     this test suite remains the rule's behavioral pin;
 *   - a scripts/src live sweep over the whole catalog remains a possible
 *     follow-up (the R162 end-to-end probe lives only in /tmp).
 */

/** The public variant DTO's price-relevant projection. */
export interface CatalogVariantPricePoint {
  id?: number;
  plan_label: string | null;
  duration_label: string | null;
  price: number;
}

export type TierPriceAnomaly =
  | {
      /** Two tiers ordered strictly at one duration collide at equal price here. */
      kind: "equalized";
      planA: string;
      planB: string;
      duration: string | null;
      price: number;
    }
  | {
      /** Two tiers ordered strictly at one duration flip direction here. */
      kind: "inverted";
      planA: string;
      planB: string;
      duration: string | null;
      priceA: number;
      priceB: number;
    };

const EPSILON = 1e-9;

/**
 * Find tier pairs whose price ordering is inconsistent across durations.
 * Pure: same input → same output, no I/O, no clock. Variants without a
 * plan label are skipped (tierless duration-only products have no pairs).
 * The (plan, duration) pair is unique upstream (V1-M17); if a caller
 * nevertheless passes duplicates, the last row wins defensively.
 */
export function findTierPriceAnomalies(
  variants: readonly CatalogVariantPricePoint[],
): TierPriceAnomaly[] {
  const priceByPlan = new Map<string, Map<string | null, number>>();
  for (const v of variants) {
    if (v.plan_label == null) continue;
    const perPlan = priceByPlan.get(v.plan_label) ?? new Map<string | null, number>();
    perPlan.set(v.duration_label, v.price);
    priceByPlan.set(v.plan_label, perPlan);
  }

  const plans = [...priceByPlan.keys()].sort();
  const anomalies: TierPriceAnomaly[] = [];
  for (let i = 0; i < plans.length; i++) {
    for (let j = i + 1; j < plans.length; j++) {
      const pricesA = priceByPlan.get(plans[i])!;
      const pricesB = priceByPlan.get(plans[j])!;
      const shared = [...pricesA.keys()].filter((d) => pricesB.has(d));
      if (shared.length < 2) continue;

      // The strictly-ordered duration that anchors this pair's expected
      // direction; pairs equal at every shared duration are consistent.
      const anchor = shared.find((d) => Math.abs(pricesA.get(d)! - pricesB.get(d)!) > EPSILON);
      if (anchor === undefined) continue;
      const aCheaper = pricesA.get(anchor)! < pricesB.get(anchor)!;

      for (const d of shared) {
        const pa = pricesA.get(d)!;
        const pb = pricesB.get(d)!;
        if (Math.abs(pa - pb) <= EPSILON) {
          anomalies.push({
            kind: "equalized",
            planA: plans[i],
            planB: plans[j],
            duration: d,
            price: pa,
          });
        } else if (aCheaper !== pa < pb) {
          anomalies.push({
            kind: "inverted",
            planA: plans[i],
            planB: plans[j],
            duration: d,
            priceA: pa,
            priceB: pb,
          });
        }
      }
    }
  }
  return anomalies;
}
