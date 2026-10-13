import { SORT_OPTIONS, TIER_FILTERS } from "@/components/admin/users/user-directory-meta";

// R137 (FE) decomposition: extracted verbatim from pages/admin/users.tsx —
// the ?filters= panel: the tier chip bar, the client-side sort chip bar,
// the reset link and the partial-data honesty hint. The filter atoms and
// the URL sync stay centralized in the page — tierFilter/sortBy/
// hasFilters/knownTotal flow down as values, and every chip flip calls
// a page-owned handler that writes the state AND the ?tier=/?sort=
// params (onTierChange / onSortChange / onReset). The move only changes
// its address; DOM, classes and aria are byte-identical.

export function UsersFilterPanel({
  tierFilter,
  sortBy,
  hasFilters,
  knownTotal,
  onTierChange,
  onSortChange,
  onReset,
}: {
  tierFilter: string;
  sortBy: string;
  hasFilters: boolean;
  knownTotal: boolean;
  onTierChange: (value: string) => void;
  onSortChange: (value: string) => void;
  onReset: () => void;
}) {
  return (
    <div className="bg-card border border-border/60 rounded-2xl p-4 animate-in fade-in slide-in-from-top-1 duration-150">
      <div className="flex flex-wrap gap-6">
        <div>
          <div className="text-3xs font-bold text-muted-foreground mb-2">مستوى الولاء</div>
          {/* R139 (precision): the tier chips leave the segmented-control
              shell (a secondary-tinted tray + borderless resting chips + a
              card-colored active tile with its soft shadow — the R128
              segmented-raised decision) for the r138 calm pill dialect —
              active bg-primary/15 + text-primary-text + border-primary/30 +
              font-bold, resting a bg-muted/30 box with the /30 border BOTH
              states carry (kills the 1px toggle jitter the borderless active
              caused). The ProductsToolbar / RiskFilterChips row shape: each
              pill owns its border box, so the tray wash is gone. aria-pressed
              untouched (the R124-C2 toggle exposure). */}
          <div className="flex gap-1.5 flex-wrap">
            {TIER_FILTERS.map((t) => (
              <button
                key={t.value}
                onClick={() => onTierChange(t.value)}
                /* R124-C2 (A6 F10): the active chip was purely
                   visual — aria-pressed exposes the toggle state
                   (the orders.tsx/topups.tsx chip-bar idiom). */
                aria-pressed={tierFilter === t.value}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                  tierFilter === t.value
                    ? "bg-primary/15 text-primary-text border-primary/30 font-bold"
                    : "bg-muted/30 border-border/30 text-muted-foreground hover:text-foreground hover:border-border/70 hover:bg-muted/60"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="text-3xs font-bold text-muted-foreground mb-2">
            {/* R120-B4 (A2-F8): the sort is CLIENT-side over the
                loaded pages — the label no longer presents it as a
                global ranking (the hint below fires on partial
                data). Server-side sort is a documented follow-up. */}
            الترتيب (ضمن المعروض)
          </div>
          {/* R139 (precision): same calm-pill migration as the tier bar
              above — one chip language per panel (the sort chips ride the
              identical border-boxed pair; the R128 raised-segment shell is
              gone). aria-pressed untouched. */}
          <div className="flex gap-1.5 flex-wrap">
            {SORT_OPTIONS.map((s) => (
              <button
                key={s.value}
                onClick={() => onSortChange(s.value)}
                /* R124-C2 (A6 F10): same toggle-state exposure as
                   the tier chips (single-select radio behavior). */
                aria-pressed={sortBy === s.value}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                  sortBy === s.value
                    ? "bg-primary/15 text-primary-text border-primary/30 font-bold"
                    : "bg-muted/30 border-border/30 text-muted-foreground hover:text-foreground hover:border-border/70 hover:bg-muted/60"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        {hasFilters && (
          <div className="flex items-end">
            <button
              onClick={onReset}
              className="text-xs text-muted-foreground hover:text-destructive transition-colors"
            >
              إعادة ضبط
            </button>
          </div>
        )}
      </div>
      {/* R120-B4 (A2-F8): partial-data honesty — the sort ranks
          only the loaded pages while the directory keeps its
          «عرض N (الأحدث أولاً)» count; the one-line hint mirrors
          the orders honest-count discipline. */}
      {!knownTotal && (
        <p className="text-3xs text-muted-foreground mt-3">
          الترتيب يعمل على المستخدمين المعروضين فقط — حمّل المزيد لتوسيع النطاق
        </p>
      )}
    </div>
  );
}
