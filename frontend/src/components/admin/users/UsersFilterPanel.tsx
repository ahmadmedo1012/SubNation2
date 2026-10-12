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
          {/* R128 (A3-F1): the tier chips converge on the
              segmented-raised idiom (orders/topups/tickets/products
              chip bars) — the bordered primary-tint was the 4th
              filter-chip shape in the console. The value-neutral
              active state is the raised card chip, not a tint. */}
          <div className="flex gap-1 flex-wrap bg-secondary/40 border border-border/60 rounded-2xl p-1">
            {TIER_FILTERS.map((t) => (
              <button
                key={t.value}
                onClick={() => onTierChange(t.value)}
                /* R124-C2 (A6 F10): the active chip was purely
                   visual — aria-pressed exposes the toggle state
                   (the orders.tsx/topups.tsx chip-bar idiom). */
                aria-pressed={tierFilter === t.value}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  tierFilter === t.value
                    ? "bg-card shadow-sm text-foreground font-bold"
                    : "text-muted-foreground hover:text-foreground"
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
          <div className="flex gap-1 flex-wrap bg-secondary/40 border border-border/60 rounded-2xl p-1">
            {SORT_OPTIONS.map((s) => (
              <button
                key={s.value}
                onClick={() => onSortChange(s.value)}
                /* R124-C2 (A6 F10): same toggle-state exposure as
                   the tier chips (single-select radio behavior). */
                aria-pressed={sortBy === s.value}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  sortBy === s.value
                    ? "bg-card shadow-sm text-foreground font-bold"
                    : "text-muted-foreground hover:text-foreground"
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
