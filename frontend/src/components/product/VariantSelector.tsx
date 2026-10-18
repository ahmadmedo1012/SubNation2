import { formatCurrency } from "@/lib/utils";

// ── VariantSelector (catalog 2026-09-20) ────────────────────────────────────
// Plan × Duration matrix rendered as two stacked pill rows:
//   1. Plan row (فردي/ثنائي/عائلي…) — only when the product varies by plan.
//   2. Duration row (شهر واحد/3 أشهر…) with the per-option price — always
//      visible so the price comparison is inline (Libyan shoppers compare
//      monthly-equivalent value per option, not just the total). R168-L3
//      (fix 5): multi-month pills now carry the comparison itself — a
//      text-3xs «≈ N د.ل شهريًا» sub-line under the price (see
//      parseDurationMonths for the fail-safe).
//
// Mobile-first: pills wrap, min-height 44px (thumb rule), the selected
// state is the site's tinted pill (R138 below), unavailable options dim
// out. The label text uses the Arabic labels imported with the catalog.
//
// R138 (visual): the two selected states converged on the round's
// active-chip idiom — `bg-primary/15 text-primary-text
// border-primary/30` + the existing font-bold (the CatalogFiltersBar
// chip / MobileNav pill family). Both rows used to speak two dialects
// (the plan pill a SOLID bg-primary fill + colored shadow, the duration
// pill a /12 tint with a FULL-strength border + shadow) — one calm
// language now: the 15% wash + /30 edge + bold primary-text ink reads
// selected at a glance without shouting, and no pill carries a colored
// shadow (glow-halo vocabulary). AA (computed, full composite stack —
// card ⊕ muted/10 container ⊕ primary/15): primary-text 5.19:1 dark /
// 4.54:1 light at 14px bold; the duration label keeps its own
// text-foreground (16.06:1 / 13.66:1) and the price its AA status ink
// (4.97:1 / 4.91:1 at 12px bold — A13-F12).
//
// R135 (FE-3 decomposition): extracted verbatim from pages/product.tsx —
// the selector was already a stateless (props-only) component inside the
// page file; the SELECTION state stays centralized in the page (the
// price block, coupon math and buy-intent all key off it). The move only
// changes its address — DOM, classes, aria and the cheapest-on-plan-switch
// behavior are byte-identical.
export interface SelectableVariant {
  id: number;
  plan_label?: string | null;
  duration_label?: string | null;
  label: string;
  price: number;
  sale_price?: number | null;
  discount_percent?: number | null;
  is_available: boolean;
}

/** R168-L3 (fix 5): parse a catalog duration_label into its month count.
 *  Covers ONLY the well-formed labels the catalog actually uses (the
 *  live set behind the selector: «شهر واحد»، «1 شهر»، «3 أشهر»،
 *  «6 أشهر»، «سنة»، «سنة كاملة» — the label family arabic-search's
 *  duration folding already canonizes). Everything else — «مدى الحياة»،
 *  «بدون مدة»، «شهري»، week/day forms, Arabic-Indic digits — returns null
 *  and the pill renders NO per-month line: never fabricate a duration
 *  the label does not state. Pure + exported for its unit table. */
export function parseDurationMonths(label: string | null | undefined): number | null {
  const s = (label ?? "").trim();
  if (s === "شهر واحد") return 1;
  if (s === "سنة" || s === "سنة كاملة") return 12;
  const m = s.match(/^(\d+)\s*(?:شهر|أشهر)$/);
  const n = m ? Number(m[1]) : Number.NaN;
  return Number.isInteger(n) && n >= 1 ? n : null;
}

export function VariantSelector({
  variants,
  selectedId,
  onSelect,
}: {
  variants: SelectableVariant[];
  selectedId: number | null;
  onSelect: (variantId: number) => void;
}) {
  const plans = Array.from(new Set(variants.map((v) => v.plan_label ?? null)));
  const hasPlanAxis = plans.length > 1;
  const selected = variants.find((v) => v.id === selectedId) ?? variants[0];

  // The duration row always shows the SELECTED plan's options (or all
  // options when the product has no plan axis).
  const visibleDurations = hasPlanAxis
    ? variants.filter((v) => (v.plan_label ?? null) === (selected?.plan_label ?? null))
    : variants;

  return (
    <div
      className="rounded-xl border border-border/45 bg-muted/10 p-3.5 space-y-3"
      /* A4-F2 (R120-B2): role="group" (was "radiogroup") — the pills are
         real <button>s that already implement Space/Enter, but the radiogroup
         role PROMISES arrow-key navigation (WAI-ARIA radio pattern) and
         none was implemented, so arrow keys did nothing. aria-pressed
         toggle buttons only promise what they deliver; the group + label
         keeps the SR context of what the pills choose. */
      role="group"
      aria-label="اختر الباقة"
    >
      {hasPlanAxis && (
        <div>
          <p className="text-xs font-bold text-muted-foreground mb-2">نوع الباقة</p>
          {/* R128-A2 (§4 polish): gap-3 — the page's own card-grid rhythm
              (every card grid is 12px); the selector read one step
              tighter than its page. */}
          <div className="flex flex-wrap gap-3">
            {plans.map((plan) => {
              // A plan pill is enabled when ANY of its options is available;
              // it carries no price (the duration row prices the option).
              const planVariants = variants.filter((v) => (v.plan_label ?? null) === plan);
              const planAvailable = planVariants.some((v) => v.is_available);
              const isPlanSelected = (selected?.plan_label ?? null) === plan;
              return (
                <button
                  key={plan ?? "default"}
                  type="button"
                  aria-pressed={isPlanSelected}
                  aria-disabled={!planAvailable || undefined}
                  disabled={!planAvailable}
                  onClick={() => {
                    // Switching plan selects that plan's cheapest option.
                    const cheapest = [...planVariants]
                      .filter((v) => v.is_available)
                      .sort((a, b) => a.price - b.price)[0];
                    if (cheapest) onSelect(cheapest.id);
                  }}
                  className={`min-h-11 px-4 rounded-xl border text-sm font-bold transition-all press-spring ${
                    /* R138 (visual): solid bg-primary + text-primary-foreground
                       + shadow-md shadow-primary/25 → the tinted pill — the
                       plan row's selected state now speaks the same language
                       as the duration row below (one component, one dialect);
                       ink AA in the header note. The colored shadow is gone
                       (no glow vocabulary on a selection state). */
                    isPlanSelected
                      ? "bg-primary/15 text-primary-text border-primary/30"
                      : "bg-card text-foreground/80 border-border/50 hover:border-primary/40 hover:text-primary-text"
                  } ${!planAvailable ? "opacity-40 pointer-events-none" : ""}`}
                >
                  {/* R130 (A2-F3): the page's own «متوفر (N)» badge sits right
                      above — a dead pill with no sold-out signal read as
                      "temporarily unavailable". */}
                  {plan}
                  {!planAvailable && <span className="text-2xs"> — نفد</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <p className="text-xs font-bold text-muted-foreground mb-2">المدة</p>
        {/* R128-A2 (§4 polish): gap-3 — same rhythm lift as the plan row
            above (the card grids' 12px). */}
        <div className="grid grid-cols-2 gap-3">
          {visibleDurations.map((v) => {
            const isSelected = v.id === selectedId;
            const eff = v.sale_price ?? v.price;
            // R168-L3 (fix 5): the monthly equivalent — the docblock's own
            // mental model, now rendered. Guarded: only when the label
            // parses AND months > 1 (a 1-month pill's per-month IS the
            // displayed price — duplication, not information) and the
            // effective price is positive (no «≈ 0.00 د.ل شهريًا» noise).
            const months = parseDurationMonths(v.duration_label);
            const perMonth = months && months > 1 && eff > 0 ? +(eff / months).toFixed(2) : null;
            return (
              <button
                key={v.id}
                type="button"
                aria-pressed={isSelected}
                aria-label={`${v.label} — ${formatCurrency(eff)}${!v.is_available ? " — نفد" : ""}`}
                aria-disabled={!v.is_available || undefined}
                disabled={!v.is_available}
                onClick={() => onSelect(v.id)}
                className={`min-h-11 flex flex-col items-start justify-center gap-0.5 px-3 py-2 rounded-xl border text-start transition-all press-spring ${
                  /* R138 (visual): /12 tint + full-strength border-primary +
                     shadow-md shadow-primary/15 → the round's chip trio
                     (/15 wash + /30 edge + bold primary-text ink, matched
                     to the plan row above). The price keeps the A13-F12
                     both-theme-safe status ink — on the /15 composite it
                     measures 4.97:1 dark / 4.91:1 light at 12px bold. */
                  isSelected
                    ? "bg-primary/15 border-primary/30 text-primary-text"
                    : "bg-card border-border/50 hover:border-primary/40"
                } ${!v.is_available ? "opacity-40 pointer-events-none" : ""}`}
              >
                <span className="text-sm font-bold text-foreground leading-tight">
                  {v.duration_label ?? v.plan_label ?? v.label}
                  {!v.is_available && <span className="text-2xs"> — نفد</span>}
                </span>
                {/* R123-E4b (P3-h): text-xs — the type-scale token (12px)
                    nearest the one-off 13px; the pill's label above is
                    text-sm so the price keeps its subordinate step.
                    A13-F12 (R126-L6): the SELECTED pill's price rode
                    text-primary — --primary (dark: hsl(348 80% 48%) =
                    rgb(220,24,64)) measured 3.76:1 on the dark card at
                    12px bold (below the 4.5:1 AA floor; 12px bold is not
                    "large"), and 3.66:1 on the pill's own primary/12
                    tint. --status-error is the both-theme-safe red sale
                    ink: dark rgb(236,81,81) = 5.20:1 on the card /
                    5.05:1 on the composited pill tint; light
                    rgb(187,27,27) = 6.39:1 on the white card (the
                    R116-S1 measured value for this exact token) /
                    4.76:1 on the tint. --primary-text was rejected:
                    identical to --primary in light mode (3.95:1 on the
                    tint) — it fixes dark only; --destructive fails
                    light (3.73:1 on the tint). */}
                <span
                  className={`text-xs font-bold tabular-nums leading-none ${
                    isSelected ? "text-status-error" : "text-foreground/75"
                  }`}
                >
                  {formatCurrency(eff)}
                  {v.sale_price != null && (
                    <span className="ms-1.5 text-3xs font-normal text-muted-foreground line-through">
                      {formatCurrency(v.price)}
                    </span>
                  )}
                </span>
                {/* R168-L3 (fix 5): the monthly-equivalent sub-line — the
                    strike-through's own quiet register (text-3xs muted),
                    cents-rounded via the repo idiom. The pill keeps its
                    single-button a11y contract: the aria-label above
                    names label + price; this line is visible-only
                    comparison context. */}
                {perMonth != null && (
                  <span className="text-3xs font-normal text-muted-foreground tabular-nums leading-none">
                    ≈ {formatCurrency(perMonth)} شهريًا
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
