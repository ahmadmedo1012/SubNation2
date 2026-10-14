import { CATEGORIES, SORTS } from "@/components/home/catalog-filters";
import { Input } from "@/components/ui/input";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { ChevronDown, Clock, Package, Search, SlidersHorizontal } from "lucide-react";

// R136 (FE-3 decomposition): extracted verbatim from pages/home.tsx —
// the sticky catalog filter bar (search input + history dropdown, sort
// select, category chips, availableOnly toggle). The page owns the
// filter quartet state + setters, the search-history state and every
// handler (handleSearchChange / commitSearch / history clicks / the
// debounce ref they race); this extract takes them all as props and
// renders. The R134 (A2-F3) disclosure + listbox a11y markup —
// aria-expanded / aria-controls / aria-autocomplete / role="option" —
// and the R94-A1 #16 blur guard are byte-identical (the
// home-search-history-a11y render pin follows this markup).
//
// R138 (visual, the deep-visual round): the live-site audit read this
// bar as "too heavy — high contrast/border weight — feeling like part
// of the hero content rather than functional navigation". The
// softening pass below touches LOOKS ONLY: resting fills drop to
// translucent washes (card/60 fields, muted/30 chips), resting chip
// borders drop one alpha step, the active category chip trades its
// solid bg-primary + colored shadow for the site's tint+border pill
// vocabulary, and the bar's own bottom margins grow so the products
// below breathe. Every handler prop, the blur guard, the aria/
// listbox markup and the URL-mirror lifecycle are untouched — quiet
// premium: functional chrome recedes, content leads.

export function CatalogFiltersBar({
  searchInput,
  category,
  sort,
  availableOnly,
  setCategory,
  setSort,
  setAvailableOnly,
  searchHistory,
  showSearchHistory,
  setShowSearchHistory,
  handleSearchChange,
  commitSearch,
  handleSearchHistoryClick,
  handleClearHistory,
  searchWrapRef,
  debounceRef,
}: {
  searchInput: string;
  category: string;
  sort: string;
  availableOnly: boolean;
  setCategory: Dispatch<SetStateAction<string>>;
  setSort: Dispatch<SetStateAction<string>>;
  setAvailableOnly: Dispatch<SetStateAction<boolean>>;
  searchHistory: string[];
  showSearchHistory: boolean;
  setShowSearchHistory: Dispatch<SetStateAction<boolean>>;
  handleSearchChange: (val: string) => void;
  commitSearch: (val: string) => void;
  handleSearchHistoryClick: (query: string) => void;
  handleClearHistory: () => void;
  searchWrapRef: RefObject<HTMLDivElement | null>;
  debounceRef: RefObject<ReturnType<typeof setTimeout> | null>;
}) {
  return (
    // ── Filters ────────────────────────────────────────
    // 96-F5 (R96-M08): the sticky offset tracks the Navbar's real
    // chrome height — 3.5rem (h-14) + the top safe-area inset the
    // header now grows by in installed-PWA mode, so the bar tucks
    // UNDER the taller header instead of sliding beneath it.
    //
    // R138 (visual): the bar's own bottom margin grows one notch on
    // mobile (mb-4→mb-5, matching the hero's fold-notch rhythm) and
    // one step on desktop (sm:mb-6→sm:mb-8) — the live audit read
    // filter→grid as tight while hero→filter read roomy, so the
    // products section now starts clearly clear of the chrome. ONLY
    // this bar's margin moves; the page's section rhythm above it is
    // page-owned (hero margins belong to the hero agent this round).
    <div className="sticky top-[calc(3.5rem_+_env(safe-area-inset-top))] z-30 -mx-4 px-4 py-2 bg-background/96 border-b border-border/15 mb-5 sm:static sm:mx-0 sm:px-0 sm:py-0 sm:bg-transparent sm:border-0 sm:mb-8">
      {/* Search + Sort */}
      <div className="flex gap-2 mb-2.5">
        <div className="relative flex-1" ref={searchWrapRef}>
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            type="search"
            placeholder="ابحث عن اشتراك…"
            aria-label="البحث في المنتجات"
            value={searchInput}
            onChange={(e) => handleSearchChange(e.target.value)}
            onKeyDown={(e) => {
              // R94-A1 #16 (P3): Enter commits the search — the one
              // moment the query is unambiguously final, and the only
              // place the history is written from typing.
              if (e.key === "Enter") {
                if (debounceRef.current) clearTimeout(debounceRef.current);
                commitSearch(searchInput);
              }
            }}
            onFocus={() =>
              setShowSearchHistory(searchInput.length === 0 && searchHistory.length > 0)
            }
            /* R134 (A2-F3): the history popup now announces itself —
               aria-expanded/aria-controls follow the support.tsx
               disclosure idiom, aria-autocomplete="list" tells SRs
               the field drives a suggestion list (the keyboard
               behavior was already correct — focus guard + min-h-11
               rows; only the announcement was missing). */
            aria-expanded={showSearchHistory && searchHistory.length > 0}
            aria-controls="home-search-history"
            aria-autocomplete="list"
            onBlur={(e) => {
              // R94-A1 #16 (P3): keyboard focus moving INTO the history
              // list must not close it — only a blur that lands outside
              // the search control dismisses the dropdown (the list
              // buttons then close it via their click handlers).
              const next = e.relatedTarget as Node | null;
              if (searchWrapRef.current && next && searchWrapRef.current.contains(next)) {
                return;
              }
              setTimeout(() => setShowSearchHistory(false), 200);
            }}
            /* R138 (visual): resting fill softens solid bg-card → the
               shared Input family's own card/60 wash (the field reads
               as a quiet tool sitting on the page, not a boxed panel
               competing with the hero) — the border stays at the
               audited-quiet border/50; the form family's AA-tuned
               muted-foreground/75 border is for money-path forms,
               this is nav chrome receding so products lead. Presence
               returns transiently, unchanged: the family's
               hover:border-muted-foreground/90 step, this focus tint
               and the one global focus-visible ring. */
            className="pr-9 h-10 bg-card/60 border-border/50 focus:border-primary/45 transition-all duration-200 rounded-xl"
            /* 96-F5 (R96-M03): the `text-sm` override is GONE — twMerge
               let it beat the shared Input's iOS-zoom-safe
               text-base/md:text-sm baseline, so focusing the catalog
               search zoomed iOS Safari ~1.14× and never zoomed back.
               Mobile is 16px again; ≥md keeps the compact 14px look. */
          />
          {/* Search history dropdown */}
          {showSearchHistory && searchHistory.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-card border border-border/50 rounded-xl shadow-lg z-50 overflow-hidden">
              <div className="p-2">
                <div className="flex items-center justify-between px-2 py-1.5 mb-1">
                  <span className="text-xs font-bold text-muted-foreground">
                    عمليات البحث السابقة
                  </span>
                  <button
                    onClick={handleClearHistory}
                    className="min-h-11 px-2 -my-2 text-xs text-muted-foreground hover:text-destructive transition-colors"
                  >
                    مسح
                  </button>
                </div>
                {/* R134 (A2-F3): ONLY the rows live in the listbox —
                    the header + مسح stay siblings so the role's
                    option children are exactly the suggestions. */}
                <div id="home-search-history" role="listbox" aria-label="عمليات البحث السابقة">
                  {searchHistory.map((query) => (
                    <button
                      key={query}
                      onClick={() => handleSearchHistoryClick(query)}
                      /* R134 (A2-F3): option semantics for the history
                         rows — the listbox wrapper carries the popup's
                         id + label so aria-controls resolves. */
                      role="option"
                      aria-selected={false}
                      className="min-h-11 w-full flex items-center gap-2 px-2 text-sm text-muted-foreground hover:bg-secondary/40 rounded-lg transition-colors text-right"
                    >
                      <Clock className="w-3 h-3 text-muted-foreground" />
                      {query}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="relative shrink-0">
          <SlidersHorizontal className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            aria-label="ترتيب المنتجات"
            title="ترتيب المنتجات"
            /* R138 (visual): rhymed with the search field sibling —
               same card/60 wash, same border-border/50 resting alpha;
               the hover step calms one notch (/80→/70) and the focus
               tint matches the field's primary/45. Visual siblings
               share one border family so the row reads as a single
               quiet tool, not two heavy boxes.
               R143 (L3-4): md:text-sm → the A13-F7 pointer:fine guard
               (input.tsx:43 idiom) — a native select never had the
               guard, so an iPad-class ≥768px coarse-pointer viewport
               computed 14px and iOS Safari zoomed the page on every
               focus. Desktop fine-pointer rendering is unchanged. */
            className="h-10 appearance-none bg-card/60 border border-border/50 rounded-xl pr-8 pl-7 text-base [@media(min-width:48rem)_and_(pointer:fine)]:text-sm font-semibold focus:border-primary/45 cursor-pointer transition-all hover:border-border/70"
            /* 96-F5 (R96-M03): same iOS focus-zoom fix as the search
               field — raw select rode text-sm at every breakpoint. */
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        </div>
      </div>

      {/* Category chips — scrollable with fade edges */}
      <div className="relative overflow-hidden">
        {/* sr-only heading for crawlers — the chips themselves are
            a11y-meaningful tabs, but Google's outline algorithm
            wants a heading to bracket the section. Visually
            redundant with the chip labels, so kept screen-reader
            only to avoid changing the design. */}
        <h2 className="sr-only">تصفّح حسب الفئة</h2>
        {/* R138 (visual): gap-1.5→gap-2 — the live audit read the chip
            row as "cramped horizontally"; 2px more air per seam. The
            chips stay whitespace-nowrap + shrink-0 inside this
            overflow-x-auto RTL scroll row, so 320px viewports keep
            scrolling (never wrapping) exactly as before. */}
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-none pb-0.5 scroll-fade-rtl">
          {CATEGORIES.map((c) => {
            const active = category === c.value;
            return (
              <button
                key={c.value}
                onClick={() => setCategory(c.value)}
                aria-pressed={active}
                /* R138 (visual): the active chip drops its solid
                   bg-primary + shadow-primary/30 glow for the site's
                   calm pill vocabulary — 15% tint + /30 border + bold
                   primary-text ink (the متوفر فقط chip beside it, the
                   MobileNav bg-primary/16 tab and RiskFilterChips all
                   speak it). Both states now carry a 1px border, which
                   also kills the 1px content jitter the borderless
                   active state caused on toggle. The quiet resting
                   chip keeps text-muted-foreground — the contract's AA
                   floor — over a muted/30 wash with a /30 edge. */
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-sm font-semibold whitespace-nowrap transition-all duration-180 press-spring min-h-11 shrink-0 ${
                  active
                    ? "bg-primary/15 text-primary-text border border-primary/30 font-bold"
                    : "bg-muted/30 border border-border/30 text-muted-foreground hover:text-foreground hover:border-border/70 hover:bg-muted/60"
                }`}
              >
                <c.Icon className="w-3.5 h-3.5" />
                {c.label}
              </button>
            );
          })}
          <button
            onClick={() => setAvailableOnly((v) => !v)}
            aria-pressed={availableOnly}
            /* R138 (visual): the active state already rode the calm
               tint+border vocabulary — left untouched (never amplify
               an already-clear state); only the inactive branch joins
               the category chips' softened resting treatment so the
               whole row speaks one quiet language. */
            className={`flex items-center gap-1.5 px-3.5 py-1.5 min-h-11 shrink-0 rounded-xl text-sm font-semibold whitespace-nowrap transition-all duration-180 press-spring ${
              availableOnly
                ? "bg-status-success/15 text-status-success border border-status-success/30 font-bold"
                : "bg-muted/30 border border-border/30 text-muted-foreground hover:text-foreground hover:border-border/70 hover:bg-muted/60"
            }`}
          >
            <Package className="w-3.5 h-3.5" />
            متوفر فقط
          </button>
        </div>
      </div>
    </div>
  );
}
