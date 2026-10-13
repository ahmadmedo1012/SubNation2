import { Search } from "lucide-react";

// R137 (1-f decomposition): extracted verbatim from pages/admin/layout.tsx —
// the top bar's two global-search affordances (the ⌘K pill trigger on ≥sm
// and the icon-only mobile trigger below sm). Presentational: the scope
// gate (canGlobalSearch) and the open callback flow down from the page —
// the palette itself (GlobalSearch.tsx) is mounted by the layout. The move
// only changes its address — zero markup change.

export function SearchTriggers({
  canGlobalSearch,
  onOpenSearch,
}: {
  canGlobalSearch: boolean;
  onOpenSearch: () => void;
}) {
  return (
    <>
      {/* Global search trigger */}
      {canGlobalSearch && (
        <button
          onClick={onOpenSearch}
          className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/40 hover:bg-muted/70 border border-border/60 hover:border-border transition-all duration-150 text-muted-foreground text-xs group"
        >
          <Search className="w-3 h-3" />
          <span>بحث...</span>
          {/* R139 (precision): the ⌘K kbd chip's fill joins the muted-well
              family — bg-muted → bg-muted/60, the exact value the sidebar
              footer's sibling ⌘K chip rides (one shell, one kbd register);
              border-border/50 is untouched. */}
          <kbd className="text-3xs font-mono bg-muted/60 border border-border/50 px-1 py-0.5 rounded group-hover:opacity-100 transition-opacity">
            ⌘K
          </kbd>
        </button>
      )}

      {/* Mobile search icon */}
      {canGlobalSearch && (
        <button
          onClick={onOpenSearch}
          /* R125 (A6 B-11, same 4.1.2 class): the mobile search
             trigger is icon-only with no accessible name. */
          aria-label="بحث سريع"
          /* 96-F7 (R96 M12): p-2 + w-5 icon ≈ 36px (edge-adjacent
             target, was ~28px). */
          className="sm:hidden p-2 rounded-lg hover:bg-secondary transition-colors text-muted-foreground"
        >
          <Search className="w-5 h-5" />
        </button>
      )}
    </>
  );
}
