// R136 (FE-3 decomposition): the storefront home page's self-contained
// subcomponents and pure tables moved to @/components/home/* (verbatim
// moves — every query, the filter quartet state + setters, the search
// commit/debounce lifecycle, every memo (displayProducts/
// categoryHasStock/heroBrands), the URL-mirror effect, useSeo and
// clearFilters stay HERE; the extracts render the byte-identical DOM
// they rendered inline yesterday and take values + callbacks as
// props). Import surface:
//   • catalog-filters / search-history — the page's pure modules
//   • primitives — the skeleton/status-icon leaf (consumed by the
//     ProductsGrid + RecentOrdersStrip extracts)
//   • AuthedHero/RecentOrdersStrip/GuestHero/StatsWidgets — the hero
//     trio's branch markup + the secondary stats widgets
//   • CatalogFiltersBar/ProductsGrid/TrustFooter — this round's
//     section extractions
import { AuthedHero } from "@/components/home/AuthedHero";
import { BRANDS, readInitialFiltersFromUrl } from "@/components/home/catalog-filters";
import { CatalogFiltersBar } from "@/components/home/CatalogFiltersBar";
import { GuestHero } from "@/components/home/GuestHero";
import { ProductsGrid } from "@/components/home/ProductsGrid";
import { RecentOrdersStrip } from "@/components/home/RecentOrdersStrip";
import { MobileStatsStrip } from "@/components/home/StatsWidgets";
import { TrustFooter } from "@/components/home/TrustFooter";
import {
  clearSearchHistory,
  getSearchHistory,
  saveSearchHistory,
} from "@/components/home/search-history";
import { useSeo } from "@/hooks/useSeo";
import { useAuth } from "@/lib/auth";
import { keepPreviousData } from "@tanstack/react-query";
import { buildItemListLd, buildOrganizationLd, buildWebsiteLd } from "@/lib/seo-builders";
import {
  getGetCatalogStatsQueryKey,
  getGetMeQueryKey,
  getListOrdersQueryKey,
  getListProductsQueryKey,
  useGetCatalogStats,
  useGetMe,
  useListOrders,
  useListProducts,
} from "@workspace/api-client-react";
import type { ComponentProps } from "react";
import {
  memo,
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/* ── R140-d (runtime perf): typing-isolation wrappers ────────────────────
 * The search input's state lives at this page root by CONTRACT (R136's
 * single-owner decomposition — the URL mirror, the query params and
 * clearFilters all key off the same quartet, pinned by
 * home-decomposition-r136), so every keystroke re-rendered the ENTIRE
 * page: hero + stats strip + filter bar + the 50-card grid. Three of
 * those sections are pure functions of props that typing never touches,
 * so they ride React.memo at the usage site and skip the keystroke
 * render entirely. Zero visual change: memo is transparent — same props
 * in, same DOM out; only the render WORK is skipped (the old WebCheck
 * budget story: 911 main-thread tasks / 684.7ms total, the most-visited
 * page paying it on every keystroke).
 *
 * The cleaner long-term idiom is React.memo in each extract's own file;
 * those files are owned by other lanes this round, so the wrappers live
 * HERE at the orchestration site (flagged for the orchestrator to fold
 * into the components later — GuestHero got its own-file memo because
 * it IS in this round's lane). */
const MemoAuthedHero = memo(AuthedHero);
const MemoRecentOrdersStrip = memo(RecentOrdersStrip);

/* R140-d: value-props-only equality for the grid. clearFilters and
 * refetchProducts are deliberately EXEMPT from the compare, by
 * documented invariant: clearFilters closes over stable useState
 * setters only (every recreated version behaves identically) and
 * refetchProducts is TanStack Query's stable ref — so skipping them
 * cannot hide a behavior change, and it lets the grid bail on keystroke
 * re-renders without useCallback-ing clearFilters (whose
 * `const clearFilters = () => {` shape is frozen by the R136
 * decomposition pin). Every prop that carries RENDERED VALUE is
 * compared. */
const gridPropsEqual = (
  a: ComponentProps<typeof ProductsGrid>,
  b: ComponentProps<typeof ProductsGrid>,
) =>
  a.isLoading === b.isLoading &&
  a.productsError === b.productsError &&
  a.products === b.products &&
  a.displayProducts === b.displayProducts &&
  a.activeFilterCount === b.activeFilterCount &&
  a.searchInput === b.searchInput &&
  a.category === b.category &&
  a.sort === b.sort &&
  a.availableOnly === b.availableOnly;

const MemoProductsGrid = memo(ProductsGrid, gridPropsEqual);

export default function HomePage() {
  const { token } = useAuth();
  // R98-04: initial values seed from the querystring (see
  // readInitialFiltersFromUrl in components/home/catalog-filters.ts) —
  // mount-time only; every later change is user-driven and mirrors
  // back via the effect below.
  const [initialFilters] = useState(readInitialFiltersFromUrl);
  const [searchInput, setSearchInput] = useState(initialFilters.searchInput);
  const [search, setSearch] = useState(initialFilters.search);
  const [category, setCategory] = useState(initialFilters.category);
  const [sort, setSort] = useState(initialFilters.sort);
  const [availableOnly, setAvailableOnly] = useState(initialFilters.availableOnly);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [showSearchHistory, setShowSearchHistory] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // R94-A1 #16 (P3): the history dropdown wrapper — blur closes the list
  // ONLY when focus actually leaves the whole search control. The old
  // unconditional 200ms timeout unmounted the list while keyboard users
  // were still tabbing INTO it, dropping focus to <body>. The ref is
  // handed to CatalogFiltersBar, which owns the control's markup.
  const searchWrapRef = useRef<HTMLDivElement | null>(null);

  // Load search history on mount
  useEffect(() => {
    setSearchHistory(getSearchHistory());
  }, []);

  const handleSearchChange = (val: string) => {
    setSearchInput(val);
    setShowSearchHistory(val.length > 0 && searchHistory.length > 0);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      // R94-A1 #16 (P3): the committed filter value is trimmed — a lone
      // space used to become params.search=" " (the backend ignores it
      // but the UI labeled it an active search over a full result set).
      // R140-d (e): the commit rides a transition — the visible text is
      // ALREADY in the input (rendered urgently), so the query kickoff,
      // the heading/count swap and the URL mirror are exactly the
      // non-urgent work transitions exist for. keepPreviousData keeps
      // the grid's content continuous across the fetch either way.
      startTransition(() => {
        setSearch(val.trim());
      });
    }, 320);
  };

  // R94-A1 #16 (P3): history is written ONLY on an explicitly committed
  // search (Enter). The old debounce-saved every intermediate pause —
  // typing «نتف» then «نتفلكس» polluted the history with fragments.
  const commitSearch = (val: string) => {
    const query = val.trim();
    // R140-d (e): same rationale as the debounce commit above — the
    // input already shows the query; the search state's downstream
    // re-render (heading, queryKey, URL mirror) is transition work.
    // setShowSearchHistory stays URGENT: the dropdown closing is the
    // primary feedback of pressing Enter.
    startTransition(() => {
      setSearch(query);
    });
    setShowSearchHistory(false);
    if (query) {
      saveSearchHistory(query);
      setSearchHistory(getSearchHistory());
    }
  };

  // Clear the pending debounce on unmount — navigating away mid-debounce
  // used to fire setSearch + a localStorage write for a page already gone.
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  const handleSearchHistoryClick = (query: string) => {
    setSearchInput(query);
    commitSearch(query);
  };

  const handleClearHistory = () => {
    clearSearchHistory();
    setSearchHistory([]);
  };

  const params: Record<string, string> = { fields: "list" };
  if (search) params.search = search;
  if (category) params.category = category;
  if (sort) params.sort = sort;
  if (availableOnly) params.available_only = "true";

  const {
    data: products = [],
    isLoading,
    isError: productsError,
    refetch: refetchProducts,
  } = useListProducts(params, {
    query: {
      queryKey: getListProductsQueryKey(params),
      // 98-F7 (r97 F-16): keep the PREVIOUS page's products as placeholder
      // while the next filtered query loads — every filter change used to
      // flash the 8-skeleton grid (data=[], isLoading=true on the new
      // queryKey) even though the previous result was one render old.
      // TanStack v5 idiom: isLoading stays true only for the very FIRST
      // load; later key changes render isPlaceholderData (grid stays).
      placeholderData: keepPreviousData,
      staleTime: 3 * 60 * 1000, // 3 minutes for products
    },
  });

  // R98-04: mirror the committed filters into the querystring. Runs once
  // on mount too (no-op rewrite of the identical URL) — deliberately NOT
  // wouter's useSearch: replaceState must stay invisible to the router.
  useEffect(() => {
    const qs = new URLSearchParams();
    if (search) qs.set("search", search);
    if (category) qs.set("category", category);
    if (sort) qs.set("sort", sort);
    if (availableOnly) qs.set("available_only", "true");
    const query = qs.toString();
    try {
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${query ? `?${query}` : ""}`,
      );
    } catch {
      // Exotic embedding contexts without history API — filters still
      // work in-memory; only the URL reflection is lost.
    }
  }, [search, category, sort, availableOnly]);

  // R111-F1 G2 (P3): the stats widgets (hero side column + mobile strip)
  // had NO loading state — a late /catalog-stats success popped the
  // chips into the hero (CLS) and a failure removed them silently.
  // `isPending` now renders chip-shaped skeletons; an error hides the
  // strip DELIBERATELY (decorative secondary data — an error card
  // inside the hero would be noise; the catalog below carries the
  // page's honest error + retry).
  const { data: stats, isPending: statsPending } = useGetCatalogStats({
    query: {
      queryKey: getGetCatalogStatsQueryKey(),
      staleTime: 10 * 60 * 1000, // 10 minutes for stats
    },
  });

  const { data: user, isError: userError } = useGetMe({
    query: { enabled: !!token, retry: false, queryKey: getGetMeQueryKey() },
    request: { headers: { Authorization: token ? `Bearer ${token}` : "" } },
  });

  // Round-3 (8-c §2.4): fetched up to 200 orders (each row with a
  // safeDecrypt'd credential payload server-side) just to render 4 rows.
  // The orders route now supports ?limit= — ask for exactly what we show.
  // The params object is part of the query key, so the profile/orders
  // full list stays cached separately.
  const {
    data: recentOrders = [],
    isPending: ordersPending,
    isError: ordersError,
    refetch: refetchOrders,
  } = useListOrders(
    { limit: 4 },
    {
      query: { enabled: !!token, queryKey: getListOrdersQueryKey({ limit: 4 }) },
      request: { headers: { Authorization: token ? `Bearer ${token}` : "" } },
    },
  );
  // R140-d (b): memoized — the slice allocated a fresh array every
  // render (every keystroke), defeating any downstream memoization of
  // the orders strip; recentOrders only changes when the query
  // refetches, which is exactly when the strip should re-render.
  const latestOrders = useMemo(() => recentOrders.slice(0, 4), [recentOrders]);

  // R140-d (e): the typing stream is DEFERRED for the grid's consumption.
  // The input itself (CatalogFiltersBar's controlled value) stays urgent —
  // the user's own typing must never lag — while everything downstream
  // that only mirrors the query text (the results h2 label, the «مسح (n)»
  // count, the empty-state escape routes) re-renders at transition
  // priority, interruptible by the next keystroke. Pure scheduling: the
  // committed DOM content is byte-identical, it just stops competing
  // with the input for the main thread mid-typing.
  const deferredSearchInput = useDeferredValue(searchInput);

  const activeFilterCount = [
    deferredSearchInput.trim(),
    category,
    sort,
    availableOnly ? "1" : "",
  ].filter(Boolean).length;

  // R120-B1 (A3-F3/A4-F4): available products lead the DEFAULT view —
  // 6+ dimmed نفد cards used to open the grid, telling shoppers the
  // store is empty-ish before they ever saw a buyable item. The
  // re-order only applies when the user has NOT picked an explicit sort
  // (their ordering intent wins); Array#sort is stable, so within each
  // group the backend's default order (الأحدث) is preserved.
  // L4-3 (R143): the re-sort is now gated on SEARCH results too — it
  // used to key on `sort` alone, so the client-side available-first
  // pass silently overrode the backend's relevance tiers (tier 0
  // compound → tier 1 prefix → tier 2) for every no-explicit-sort
  // SEARCH view: a loosely-matching stocked product (e.g. via the
  // variant-label EXISTS arm) jumped above exact brand matches. The
  // نفد-first UX concern is a BROWSING problem; a searcher's intent
  // ordering is the relevance tiers — sold-out exact matches lead
  // their own queries again (they match the intent; the نفد badge +
  // this re-sort on browse still front stock).
  const displayProducts = useMemo(() => {
    if (sort || search) return products;
    return [...products].sort((a, b) => Number(b.is_available) - Number(a.is_available));
  }, [products, sort, search]);

  // R122 (A11 P0-adjacent): per-category stock map for the hero brand
  // chips, computed from the ALREADY-LOADED products array (presentation
  // only — no new endpoint, no inventory feature). Null whenever the
  // current view is filtered (search/category/available_only change
  // WHICH products the array holds, so per-category counts would lie);
  // sort never changes membership, so it stays truthful under any sort.
  const categoryHasStock = useMemo<Set<string> | null>(() => {
    if (search || category || availableOnly) return null;
    const cats = new Set<string>();
    for (const p of products) {
      if (p.is_available && p.category) cats.add(p.category);
    }
    return cats;
  }, [products, search, category, availableOnly]);

  // R122 (A11-F1/P0-adjacent): chips whose category currently has stock
  // lead the scrollable row (Array#sort is stable — the editorial order
  // survives within each group). No data (filtered view / empty grid) →
  // the editorial order stands unchanged.
  const heroBrands = useMemo(() => {
    if (!categoryHasStock || categoryHasStock.size === 0) return BRANDS;
    return [...BRANDS].sort(
      (a, b) => Number(categoryHasStock.has(b.cat)) - Number(categoryHasStock.has(a.cat)),
    );
  }, [categoryHasStock]);

  const clearFilters = () => {
    setSearch("");
    setSearchInput("");
    setCategory("");
    setSort("");
    setAvailableOnly(false);
  };

  // R140-d (b): the ItemList LD block was rebuilt on EVERY render —
  // products.slice(0, 50).map(...) + buildItemListLd ran per keystroke
  // in the search box (the old WebCheck main-thread story: 911 tasks /
  // 684.7ms). category.tsx already memoizes its twin (itemList, the
  // R136 idiom); home now matches. Zero output change: JsonLd's effect
  // is keyed on the SERIALIZED value, so the DOM <script> payload is
  // byte-identical — only the per-render allocation churn dies.
  const itemListLd = useMemo(
    () =>
      // Emit ItemList only when products are loaded — an empty list LD
      // is treated by Google as a thin/low-quality structured-data block.
      products.length > 0
        ? buildItemListLd(products.slice(0, 50).map((p) => ({ id: p.slug ?? p.id, name: p.name })))
        : null,
    [products],
  );

  // R-140-g (JSON-LD completeness audit): the emitted set is the mature
  // full set — Organization + WebSite (the SearchAction inside it is
  // REAL: `?search=` deep links land here and drive the catalog via
  // readInitialFiltersFromUrl, mirrored back by the URL-mirror effect)
  // + the ItemList above. No BreadcrumbList (single-level page).

  const seoBlock = useSeo({
    // Keyword-forward title for Arabic SERPs (brand at the end is fine —
    // brand searches resolve on URL/favicon anyway). Stays under 50
    // Arabic characters so it doesn't truncate on mobile SERP.
    title: "سوق الاشتراكات الرقمية في ليبيا | SubNation",
    // Description leads with intent (متجر إلكتروني متخصّص لشراء اشتراكات),
    // includes the locale (في ليبيا) inside the first clause, then the
    // Arabic brand transliterations Arabic users actually type
    // (نتفلكس، سبوتيفاي، يوتيوب، ديزني+), closing with the three
    // differentiators (دينار، تسليم فوري، دعم محلي). ~145 chars / 160 cap.
    // R120-B1 (A7-F5): بلايستيشن removed — the gaming category was
    // archived 2026-09-19 and the live catalog returns 0 results; every
    // named brand here is verified against the active catalog
    // (يوتيوب = YouTube Premium, streaming).
    description:
      "متجر إلكتروني متخصّص لشراء اشتراكات الخدمات الرقمية في ليبيا — نتفلكس، سبوتيفاي، يوتيوب، ديزني+ وأكثر. الدفع بالدينار الليبي، تسليم فوري، دعم محلي.",
    path: "/",
    locale: "ar",
    type: "website",
    jsonLd: [
      buildOrganizationLd(),
      buildWebsiteLd(),
      // R140-d (b): rides the itemListLd memo above (see its comment).
      ...(itemListLd ? [itemListLd] : []),
    ],
  });

  // R116-S1 dvh straggler: min-h-screen → the codebase's min-h-[100dvh]
  // convention (login/register/onboarding pattern) — 100vh overscrolls
  // on mobile dynamic-toolbar viewports.
  return (
    <div className="min-h-[100dvh]">
      {seoBlock}
      {/* py-4 on mobile (R120-B1 / A1-F3): one fold-budget notch tighter
          than the old py-5; ≥sm keeps the original rhythm. */}
      <div className="max-w-6xl mx-auto px-4 py-4 sm:py-7">
        {/* ── Hero ─────────────────────────────────────────── */}
        {/* `userError` breaks the infinite skeleton: a failed /me probe
            (expired session, network) previously left the shimmer hero
            on screen forever. Show the guest hero instead — a degraded but
            honest state that still lets the visitor browse the catalog. */}
        {token && !user && !userError ? (
          <div className="mb-5 page-in">
            {/* R115-I1 (A7 P3-6): the skeleton reserves the height the
                REAL wrapped hero occupies on mobile — the wallet/points
                chips wrap onto a second row (~150px: py-4 ×2 + title
                block ~50px + gap-3 + chip row ~53px), while the old
                h-[100px] collapsed on first paint → a CLS pop when /me
                landed. sm+ stays single-row (~120px). Measured by class
                analysis (see A7 P3-6); min-h so a longer name can only
                grow it, never clip. */}
            <div className="relative overflow-hidden rounded-2xl border border-border/40 bg-card mb-4 shadow-lg min-h-[150px] sm:min-h-[120px] skeleton-shimmer" />
          </div>
        ) : token && user ? (
          <div className="mb-5 page-in">
            {/* R140-d (runtime perf): the memo-wrapped hero trio twins —
                see the wrappers' block comment at module top. */}
            <MemoAuthedHero user={user} />
            <MemoRecentOrdersStrip
              pending={ordersPending}
              error={ordersError}
              orders={latestOrders}
              refetch={refetchOrders}
            />
          </div>
        ) : (
          <GuestHero
            heroBrands={heroBrands}
            categoryHasStock={categoryHasStock}
            stats={stats}
            statsPending={statsPending}
          />
        )}

        {/* Mobile stats strip (guest) — R111-F1 G2: the same
            skeleton-while-pending / hide-on-error contract as the
            desktop column above (identical geometry, no CLS).
            R120-B1 (A1-F3/A3-F2): compacted below sm (p-2, tighter gap,
            mb-3) — the strip is secondary data and was spending ~84px
            of the fold budget before the first card. The !token gate
            stays here: pure guests see the strip, while a failed /me
            probe (token set, userError) renders the guest hero WITHOUT
            it — the same three-branch contract the hero trio above
            encodes. */}
        {!token && <MobileStatsStrip stats={stats} statsPending={statsPending} />}

        <CatalogFiltersBar
          searchInput={searchInput}
          category={category}
          sort={sort}
          availableOnly={availableOnly}
          setCategory={setCategory}
          setSort={setSort}
          setAvailableOnly={setAvailableOnly}
          searchHistory={searchHistory}
          showSearchHistory={showSearchHistory}
          setShowSearchHistory={setShowSearchHistory}
          handleSearchChange={handleSearchChange}
          commitSearch={commitSearch}
          handleSearchHistoryClick={handleSearchHistoryClick}
          handleClearHistory={handleClearHistory}
          searchWrapRef={searchWrapRef}
          debounceRef={debounceRef}
        />

        {/* R140-d (runtime perf): the memo-wrapped grid + the deferred
            search stream — see the wrappers' block comment at module top
            and the deferredSearchInput declaration. The filter bar above
            keeps the URGENT searchInput (it renders the input itself);
            only the results section rides the deferred value. */}
        <MemoProductsGrid
          isLoading={isLoading}
          productsError={productsError}
          products={products}
          displayProducts={displayProducts}
          activeFilterCount={activeFilterCount}
          searchInput={deferredSearchInput}
          category={category}
          sort={sort}
          availableOnly={availableOnly}
          clearFilters={clearFilters}
          refetchProducts={refetchProducts}
        />

        {/* ── Trust footer ── */}
        {!isLoading && products.length > 0 && <TrustFooter />}

        {/* Bottom breathing room for guests. Authed users are covered by
            main's mobile-nav-safe-pad (which reserves the MobileNav
            clearance) — stacking a second mobile-nav-safe-pad here used to
            double the pad on mobile AND leak 72px onto desktop. */}
        {!token && <div className="h-6 md:h-0" />}
      </div>
    </div>
  );
}
