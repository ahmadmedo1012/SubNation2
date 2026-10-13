import { FILTERS, LEVEL_META, TONE_CHIP, type RiskLevel } from "@/components/admin/risk/risk-meta";

// R137 (FE decomposition): extracted verbatim from pages/admin/risk.tsx —
// the filter chip bar (level chips with live counts + the aria-pressed
// toggle state). The filter atom and the level-agnostic counts memo stay
// in the page (the counts source swaps between the accumulated
// all-window pages and the background unfiltered query); chip taps
// report up through the page-owned onFilterChange. The move only
// changes its address; DOM, classes, aria and Arabic copy are
// byte-identical.

export function RiskFilterChips({
  filter,
  counts,
  onFilterChange,
}: {
  filter: "all" | RiskLevel;
  counts: Record<RiskLevel | "all", number>;
  onFilterChange: (value: "all" | RiskLevel) => void;
}) {
  return (
    <>
      {/* Filter chips */}
      {/* R139 (precision): VERIFIED, no change — this bar IS the calm
          dialect's origin family (active = tone-tinted /15 + /40 border +
          font-bold, the "all" chip = the primary trio, inactive =
          bg-muted/30 + border/30 + muted/60 hover wash; both states boxed,
          aria-pressed live). Churn would be regression, not polish. */}
      <div className="flex items-center gap-2 flex-wrap">
        {FILTERS.map((f) => {
          const active = f.value === filter;
          const tone = f.value === "all" ? null : LEVEL_META[f.value as RiskLevel];
          return (
            <button
              key={f.value}
              onClick={() => onFilterChange(f.value)}
              /* R125-I4 (A6 B-10): the active chip was purely visual —
                   aria-pressed exposes the toggle state (the
                   orders/users/tickets chip-bar idiom). */
              aria-pressed={active}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                active
                  ? tone
                    ? `font-bold ${TONE_CHIP[tone.tone]}`
                    : "bg-primary/15 text-primary-text border-primary/40 font-bold"
                  : "bg-muted/30 border-border/30 hover:bg-muted/60"
              }`}
            >
              {f.label}
              <span className="mr-1.5">({counts[f.value]})</span>
            </button>
          );
        })}
      </div>
    </>
  );
}
