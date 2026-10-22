import { CATEGORIES, SORTS } from "@/components/home/catalog-filters";
import { CATEGORY_ACCENT, DEFAULT_ACCENT } from "@/components/ProductCard";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { categoryLabel, formatCurrency } from "@/lib/utils";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useEffect, useState } from "react";
import { Clock, Loader2, Package, Search, SlidersHorizontal } from "lucide-react";
import type { ProductListItem } from "@workspace/api-client-react";
import { useLocation } from "wouter";

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
//
// R161-B (the live-suggestions round): the dropdown gains a data
// half — up to 5 live product rows (name / category chip / price)
// fetched by the PAGE (the R136 single-data-owner contract holds) and
// rendered here above the history section. While the input is empty
// (<2 chars never fetches) the panel is the history exactly as
// before; once a query settles with matches, suggestions REPLACE the
// history; a settled 0-match query falls back to the history again
// (the no-results verdict stays the grid's job on Enter). Keyboard:
// Escape dismisses (R161-F audit defect F#2), ↑/↓ walk an
// aria-activedescendant highlight through the rows + the «عرض كل
// النتائج» affordance, Enter acts on the highlighted row or commits
// the plain search (today's behavior preserved). The panel flips
// ABOVE the field when there is no room below (audit defect F#7).

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
  suggestions,
  suggestionsLoading,
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
  suggestions: ProductListItem[];
  suggestionsLoading: boolean;
}) {
  const [, navigate] = useLocation();
  // R161-B: the keyboard highlight — index over the rendered options
  // (product rows 0..n-1, then the view-all row); -1 = no highlight.
  // Overlay-local interaction state in the GlobalSearch (R137)
  // precedent: nothing outside the dropdown reads it.
  const [activeIndex, setActiveIndex] = useState(-1);
  // R161-B (audit F#7): flip-up flag, measured once per open.
  const [dropUp, setDropUp] = useState(false);

  const query = searchInput.trim();
  const suggestMode = query.length >= 2;
  const arrowsActive = showSearchHistory && suggestMode && suggestions.length > 0;
  const hasSuggestions =
    showSearchHistory && suggestMode && (suggestionsLoading || suggestions.length > 0);
  // The history shows for an empty/1-char input (today's behavior),
  // AND as the honest fallback when a settled query matches nothing —
  // "the history stays"; the grid owns the no-results verdict.
  const showHistory =
    showSearchHistory &&
    searchHistory.length > 0 &&
    !(suggestMode && (suggestionsLoading || suggestions.length > 0));
  const popupOpen = hasSuggestions || showHistory;
  // Clamp against a shrinking list (typing narrows mid-navigation —
  // the GlobalSearch safeActive idiom).
  const optionCount = suggestions.length + 1;
  const safeActive = arrowsActive ? Math.min(activeIndex, optionCount - 1) : -1;
  const activeId =
    safeActive < 0
      ? undefined
      : safeActive < suggestions.length
        ? `home-search-sug-${safeActive}`
        : "home-search-sug-all";

  // The highlight dies with the popup and with every new result set —
  // a stale index over a re-rendered list navigates to the wrong row.
  useEffect(() => {
    setActiveIndex(-1);
  }, [suggestions, showSearchHistory]);

  // R161-B (audit F#7): measure bottom space once per open — with the
  // input near the viewport bottom (the 1280×800 audit geometry: input
  // y=760 of an 800px viewport) the panel opened entirely below the
  // fold. 320px covers the tallest panel (5 rows + view-all + padding);
  // a simple conditional class, no dependency (per the round's brief).
  useEffect(() => {
    if (!showSearchHistory) return;
    const rect = searchWrapRef.current?.getBoundingClientRect();
    setDropUp(!!rect && window.innerHeight - rect.bottom < 320);
  }, [showSearchHistory, searchWrapRef]);

  const goToProduct = (p: ProductListItem) => {
    setShowSearchHistory(false);
    navigate(`/product/${p.slug ?? p.id}`);
  };
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
                // R161-B: Enter on a highlighted row acts on THAT row
                // (the aria-activedescendant contract) — a product row
                // navigates to its PDP, the view-all row commits the
                // search. With no highlight the plain commit stands
                // (today's behavior, preserved).
                if (safeActive >= 0) {
                  const row = suggestions[safeActive];
                  if (row) {
                    goToProduct(row);
                    return;
                  }
                  commitSearch(searchInput);
                  return;
                }
                commitSearch(searchInput);
                return;
              }
              // R161-B (audit defect F#2): Escape dismisses the dropdown
              // — the site's mobile-menu Escape pattern. preventDefault
              // keeps the dismissal deterministic: Chrome/Webkit also
              // quick-clear a type=search input on Escape, and the input
              // keeping its text is the one predictable outcome.
              if (e.key === "Escape") {
                e.preventDefault();
                setShowSearchHistory(false);
                return;
              }
              // R161-B: ↑/↓ walk the highlight through the suggestion
              // rows + the view-all row (no wrap; the caret must not
              // jump to the text ends either). History mode keeps its
              // current keyboard contract (tap/click + Enter commits).
              if (arrowsActive) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  // No wrap: past the view-all row the highlight rests
                  // (the updater clamps both a stale index and the end).
                  setActiveIndex((i) => Math.min(i + 1, optionCount - 1));
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActiveIndex((i) => Math.max(i - 1, -1));
                  return;
                }
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
               rows; only the announcement was missing).
               R161-B: the same contract now covers BOTH panels —
               aria-expanded tracks the popup's real presence and
               aria-controls points at whichever listbox is on screen
               (suggestions while typing, history otherwise); the
               highlight rides aria-activedescendant over rows that
               carry matching ids. */
            aria-expanded={popupOpen}
            aria-controls={hasSuggestions ? "home-search-suggestions" : "home-search-history"}
            aria-autocomplete="list"
            aria-activedescendant={activeId}
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
            className="ps-9 h-11 md:h-10 bg-card/60 border-border/50 focus:border-primary/45 transition-all duration-200 rounded-xl"
            /* 96-F5 (R96-M03): the `text-sm` override is GONE — twMerge
               let it beat the shared Input's iOS-zoom-safe
               text-base/md:text-sm baseline, so focusing the catalog
               search zoomed iOS Safari ~1.14× and never zoomed back.
               Mobile is 16px again; ≥md keeps the compact 14px look. */
          />
          {/* Search dropdown — history | live suggestions (R161-B).
              The container renders only when it has content; the flip
              class (audit F#7) opens it ABOVE the field when there is
              no room below. */}
          {popupOpen && (
            <div
              className={`absolute left-0 right-0 z-50 bg-card border border-border/50 rounded-xl shadow-lg overflow-hidden ${
                dropUp ? "bottom-full mb-2" : "top-full mt-2"
              }`}
            >
              {/* ── Live product suggestions (R161-B) ── */}
              {hasSuggestions && (
                <div className="p-2">
                  {suggestionsLoading && (
                    /* A subtle spinner row — never blocks the input
                       (typing continues while it shows). */
                    <div
                      role="status"
                      className="min-h-11 flex items-center justify-center gap-2 text-xs text-muted-foreground"
                    >
                      <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                      جارٍ البحث…
                    </div>
                  )}
                  {suggestions.length > 0 && (
                    <div id="home-search-suggestions" role="listbox" aria-label="منتجات مطابقة">
                      {suggestions.map((p, i) => {
                        const accent = CATEGORY_ACCENT[p.category ?? ""] ?? DEFAULT_ACCENT;
                        return (
                          <button
                            key={p.id}
                            id={`home-search-sug-${i}`}
                            onClick={() => goToProduct(p)}
                            /* R134 (A2-F3) option semantics, carried to
                               the suggestion rows — aria-selected marks
                               the ↑/↓ highlight (the aria-activedescendant
                               contract); the GlobalSearch calm-active
                               fill (bg-primary/15) renders it. */
                            role="option"
                            aria-selected={safeActive === i}
                            className={`min-h-11 w-full flex items-center gap-2 px-2 rounded-lg transition-colors text-right ${
                              safeActive === i ? "bg-primary/15" : "hover:bg-secondary/40"
                            }`}
                          >
                            <span
                              dir="auto"
                              /* The A9-m2/R143 truncate idiom — a Latin
                                 name must not garble nor overflow the
                                 RTL row. */
                              className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground"
                            >
                              {p.name}
                            </span>
                            <span
                              className={`shrink-0 text-3xs font-semibold px-1.5 py-0.5 rounded-full border ${accent.bg} ${accent.text} ${accent.border}`}
                            >
                              {categoryLabel(p.category)}
                            </span>
                            {/* Money ink: the browsing layer reads
                               text-foreground (R130-A2-F4); tabular-nums
                               + «د.ل» ride formatCurrency. The «تبدأ من»
                               qualifier stays honest for variant
                               products (the ProductCard idiom). */}
                            <span className="shrink-0 flex items-baseline gap-1 text-xs font-bold text-foreground tabular-nums">
                              {p.price_from && (
                                <span className="text-3xs font-semibold text-muted-foreground">
                                  تبدأ من
                                </span>
                              )}
                              {formatCurrency(p.price)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {/* R182 (Lane-C D7): the «عرض كل النتائج» ACTION row
                      moves OUT of the role="listbox" — an action is not
                      a selectable option (options promise selectability),
                      matching the history panel's documented precedent
                      (its header + «مسح» stay siblings "so the role's
                      option children are exactly the suggestions"). The
                      row keeps its id (the input's aria-activedescendant
                      still highlights it), the visual highlight, the
                      click handler and the Enter integration (the
                      safeActive === suggestions.length branch) — only
                      the option role/aria-selected go. */}
                  {suggestions.length > 0 && (
                    <button
                      id="home-search-sug-all"
                      onClick={() => {
                        if (debounceRef.current) clearTimeout(debounceRef.current);
                        commitSearch(searchInput);
                      }}
                      className={`min-h-11 w-full flex items-center justify-center gap-1.5 px-2 mt-1 border-t border-border/30 rounded-none text-xs font-bold text-primary-text hover:bg-secondary/40 transition-colors ${
                        safeActive === suggestions.length ? "bg-primary/15" : ""
                      }`}
                    >
                      {/* Always offered when suggestions exist — the
                          list response carries no total, so the
                          affordance stays simple and honest. */}
                      عرض كل النتائج
                    </button>
                  )}
                </div>
              )}
              {/* ── Search history (the R134/R138 markup, byte-identical) ── */}
              {showHistory && (
                <div className="p-2">
                  <div className="flex items-center justify-between px-2 py-1.5 mb-1">
                    <span className="text-xs font-bold text-muted-foreground">
                      عمليات البحث السابقة
                    </span>
                    <button
                      onClick={handleClearHistory}
                      className="min-h-11 px-2 -my-2 text-xs text-muted-foreground hover:text-status-error transition-colors"
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
              )}
            </div>
          )}
        </div>
        <div className="relative shrink-0">
          <SlidersHorizontal className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          {/* R157-C: the sort control rides the shared ui/select
              primitive (one form-control recipe app-wide). The
              call-site keeps the R138 quiet-nav overrides so the row
              reads as one tool: the /50 resting edge + /70 hover step
              of its search-field sibling (the AA /75 form border is
              for money-path forms — this is nav chrome receding so
              products lead), and the Sliders start-icon keeps the sort
              affordance (ps-9 reserves its slot; the primitive's own
              chevron takes the inline-end). */}
          <Select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            aria-label="ترتيب المنتجات"
            title="ترتيب المنتجات"
            className="ps-9 h-11 md:h-10 font-semibold border-border/50 hover:border-border/70"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
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
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-sm font-semibold whitespace-nowrap transition-all duration-150 press-spring min-h-11 shrink-0 ${
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
            className={`flex items-center gap-1.5 px-3.5 py-1.5 min-h-11 shrink-0 rounded-xl text-sm font-semibold whitespace-nowrap transition-all duration-150 press-spring ${
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
