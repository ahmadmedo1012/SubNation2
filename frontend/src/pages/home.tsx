import { ProductCard } from "@/components/ProductCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProductCardShell } from "@/components/ui/route-skeleton";
import { TrustCard } from "@/components/ui/trust-card";
import { useSeo } from "@/hooks/useSeo";
import { useAuth } from "@/lib/auth";
import { keepPreviousData } from "@tanstack/react-query";
import { buildItemListLd, buildOrganizationLd, buildWebsiteLd } from "@/lib/seo-builders";
import { categoryLabel, formatCount, formatCurrency, statusColor, statusLabel } from "@/lib/utils";
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
import {
  AppWindow,
  ArrowLeft,
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  Clock,
  GraduationCap,
  Headphones,
  LayoutGrid,
  Music2,
  Package,
  PackageSearch,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  TrendingUp,
  Truck,
  Tv2,
  WifiOff,
  Wallet,
  XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";

// The seven live catalog categories (mirrors products.category values
// verified against production — see lib/categories.ts). Retired chips
// (gaming/productivity) were removed once their products were archived:
// a chip that filters to an empty grid misleads shoppers.
const CATEGORIES = [
  { value: "", label: "الكل", Icon: LayoutGrid },
  { value: "streaming", label: "بث مباشر", Icon: Tv2 },
  { value: "music", label: "موسيقى", Icon: Music2 },
  { value: "software", label: "برامج", Icon: AppWindow },
  { value: "vpn", label: "VPN وشبكات", Icon: ShieldCheck },
  { value: "ai-tools", label: "ذكاء اصطناعي", Icon: Sparkles },
  { value: "seo-tools", label: "أدوات SEO", Icon: TrendingUp },
  { value: "education", label: "تعليم", Icon: GraduationCap },
];

const SORTS = [
  { value: "", label: "الأحدث" },
  { value: "popular", label: "الأكثر مبيعاً" },
  { value: "price_asc", label: "السعر: الأقل" },
  { value: "price_desc", label: "السعر: الأعلى" },
];

// ── R98-04 (A5 §2): catalog filters ↔ querystring ────────────────────────
//
// The four catalog filters (search/category/sort/availableOnly) lived in
// local state only — refresh, back-navigation from a product page, or a
// shared link all landed on a zeroed catalog (admin pages got ?search=
// syncing in 94-C2; the storefront never did). The filters now seed from
// the URL on mount and mirror back via history.replaceState on every
// change (replaceState, not pushState: filtering is the same logical
// page — the Back button must leave the page, not replay every filter
// click — and it is invisible to wouter, so no route re-resolution).
const SORT_VALUES = new Set(SORTS.map((s) => s.value));
const CATEGORY_VALUES = new Set(CATEGORIES.map((c) => c.value));

function readInitialFiltersFromUrl() {
  const params = new URLSearchParams(window.location.search);
  // Whitelist category/sort values — a hand-typed ?sort=bogus must not
  // blank the <select> (an unknown value renders no <option> selected)
  // or arm a phantom filter chip.
  const rawCategory = params.get("category") ?? "";
  const rawSort = params.get("sort") ?? "";
  const search = params.get("search") ?? "";
  return {
    search,
    searchInput: search,
    category: CATEGORY_VALUES.has(rawCategory) ? rawCategory : "",
    sort: SORT_VALUES.has(rawSort) ? rawSort : "",
    availableOnly: params.get("available_only") === "true",
  };
}

/**
 * Featured brand chips on the editorial hero.
 *
 * Each entry has both the canonical Latin name (visible label —
 * preserves brand recognition for users) and the Arabic
 * transliteration (the form Arabic users actually type into Google:
 * "نتفلكس", "بلايستيشن", etc). The Arabic form is exposed to
 * crawlers via `aria-label` + a visually-hidden `.sr-only` span so
 * the chip carries Arabic-keyword weight without changing the visual.
 */
const BRANDS: Array<{ latin: string; ar: string }> = [
  { latin: "Netflix", ar: "نتفلكس" },
  { latin: "Spotify", ar: "سبوتيفاي" },
  { latin: "Disney+", ar: "ديزني+" },
  { latin: "PlayStation", ar: "بلايستيشن" },
  { latin: "YouTube", ar: "يوتيوب" },
  { latin: "Canva", ar: "كانفا" },
  { latin: "Adobe", ar: "أدوبي" },
  { latin: "Office 365", ar: "مايكروسوفت 365" },
];

// Search history localStorage helpers
const SEARCH_HISTORY_KEY = "subnation_search_history";
const MAX_SEARCH_HISTORY = 8;

function getSearchHistory(): string[] {
  try {
    const saved = localStorage.getItem(SEARCH_HISTORY_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

function saveSearchHistory(query: string) {
  if (!query.trim()) return;
  const history = getSearchHistory();
  const filtered = history.filter((h) => h !== query);
  filtered.unshift(query);
  if (filtered.length > MAX_SEARCH_HISTORY) filtered.pop();
  localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(filtered));
}

function clearSearchHistory() {
  localStorage.removeItem(SEARCH_HISTORY_KEY);
}

function ProductSkeleton() {
  return <ProductCardShell />;
}

function OrderStatusIcon({ status }: { status: string }) {
  // R94-A1 #5 (P2, WCAG AA): raw -400 shades measured 1.53–2.54:1 on
  // white cards in the light theme — the shared --status-* tokens are
  // theme-aware and tonally correct on card surfaces.
  if (status === "completed") return <CheckCircle className="w-3 h-3 text-status-success" />;
  if (status === "failed" || status === "refunded")
    return <XCircle className="w-3 h-3 text-status-error" />;
  return <Clock className="w-3 h-3 text-status-warning" />;
}

export default function HomePage() {
  const { token } = useAuth();
  // R98-04: initial values seed from the querystring (see
  // readInitialFiltersFromUrl above) — mount-time only; every later
  // change is user-driven and mirrors back via the effect below.
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
  // were still tabbing INTO it, dropping focus to <body>.
  const searchWrapRef = useRef<HTMLDivElement | null>(null);

  // 96-F5 (R96 F-4b): pause the guest hero's animated blur-3xl blobs when
  // the hero scrolls off-screen — two 9s/13s infinite animations with
  // will-change:transform kept rasterizing big blurred layers on the
  // most-visited page long after anyone could see them. IntersectionObserver
  // toggles animation-play-state via inline style (className/JS-level only;
  // the keyframes live in index.css which is owned by another agent).
  const guestHeroRef = useRef<HTMLDivElement | null>(null);
  const [heroOnScreen, setHeroOnScreen] = useState(true);

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
      setSearch(val.trim());
    }, 320);
  };

  // R94-A1 #16 (P3): history is written ONLY on an explicitly committed
  // search (Enter). The old debounce-saved every intermediate pause —
  // typing «نتف» then «نتفلكس» polluted the history with fragments.
  const commitSearch = (val: string) => {
    const query = val.trim();
    setSearch(query);
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

  const params: Record<string, string> = {};
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

  // 96-F5 (R96 F-4b), continued: the guest hero renders for !token OR a
  // failed /me probe (see the three-branch conditional below) — keying the
  // blob-pause observer on the same flag re-arms it if auth state flips.
  const showGuestHero = !token || !!userError;
  useEffect(() => {
    if (!showGuestHero) return;
    const el = guestHeroRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => setHeroOnScreen(entries[0]?.isIntersecting ?? true),
      { rootMargin: "64px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [showGuestHero]);

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
  const latestOrders = recentOrders.slice(0, 4);

  const activeFilterCount = [searchInput.trim(), category, sort, availableOnly ? "1" : ""].filter(
    Boolean,
  ).length;

  const clearFilters = () => {
    setSearch("");
    setSearchInput("");
    setCategory("");
    setSort("");
    setAvailableOnly(false);
  };

  const seoBlock = useSeo({
    // Keyword-forward title for Arabic SERPs (brand at the end is fine —
    // brand searches resolve on URL/favicon anyway). Stays under 50
    // Arabic characters so it doesn't truncate on mobile SERP.
    title: "سوق الاشتراكات الرقمية في ليبيا | SubNation",
    // Description leads with intent (متجر إلكتروني متخصّص لشراء اشتراكات),
    // includes the locale (في ليبيا) inside the first clause, then the
    // Arabic brand transliterations Arabic users actually type
    // (نتفلكس، سبوتيفاي، بلايستيشن، ديزني+), closing with the three
    // differentiators (دينار، تسليم فوري، دعم محلي). 149 chars / 160 cap.
    description:
      "متجر إلكتروني متخصّص لشراء اشتراكات الخدمات الرقمية في ليبيا — نتفلكس، سبوتيفاي، بلايستيشن، ديزني+ وأكثر. الدفع بالدينار الليبي، تسليم فوري، دعم محلي.",
    path: "/",
    locale: "ar",
    type: "website",
    jsonLd: [
      buildOrganizationLd(),
      buildWebsiteLd(),
      // Emit ItemList only when products are loaded — an empty list LD
      // is treated by Google as a thin/low-quality structured-data block.
      ...(products.length > 0
        ? [
            buildItemListLd(
              products.slice(0, 50).map((p) => ({ id: p.slug ?? p.id, name: p.name })),
            ),
          ]
        : []),
    ],
  });

  return (
    <div className="min-h-screen">
      {seoBlock}
      <div className="max-w-6xl mx-auto px-4 py-5 sm:py-7">
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
            <div className="relative overflow-hidden rounded-2xl border border-border/40 bg-card mb-4 shadow-lg shadow-black/15 min-h-[150px] sm:min-h-[120px] skeleton-shimmer" />
          </div>
        ) : token && user ? (
          <div className="mb-5 page-in">
            {/* Hero banner card */}
            <div className="relative overflow-hidden rounded-2xl border border-border/40 bg-card mb-4 shadow-lg shadow-black/15">
              {/* Background gradient layers */}
              <div className="absolute inset-0 bg-gradient-to-l from-primary/12 via-transparent to-transparent pointer-events-none" />
              <div className="absolute right-0 top-0 bottom-0 w-[2px] bg-gradient-to-b from-primary/60 via-primary/20 to-transparent" />
              <div className="absolute top-[-30px] right-[10%] w-48 h-48 bg-primary/8 rounded-full blur-3xl pointer-events-none" />

              <div className="relative px-4 py-4 sm:px-6 sm:py-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-muted-foreground text-xs mb-0.5 font-semibold">
                    مرحباً بك مجدداً
                  </p>
                  <h1 className="text-fluid-2xl font-bold leading-tight text-gradient-animated">
                    اشترِ اشتراكك المفضل اليوم
                  </h1>
                </div>
                <div className="flex gap-2">
                  <Link href="/wallet">
                    <div className="bg-background/50 border border-border/50 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/10 rounded-2xl px-3.5 py-2.5 flex items-center gap-2.5 transition-all duration-250 card-spring cursor-pointer min-w-[122px]">
                      <div className="w-8 h-8 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                        <Wallet className="w-3.5 h-3.5 text-primary-text" />
                      </div>
                      <div>
                        <div className="text-3xs text-muted-foreground leading-none mb-0.5 font-semibold">
                          المحفظة
                        </div>
                        <div className="font-bold text-sm tabular-nums text-foreground">
                          {formatCurrency(user.wallet_balance ?? 0)}
                        </div>
                      </div>
                    </div>
                  </Link>
                  <Link href="/loyalty">
                    <div className="bg-background/50 border border-border/50 hover:border-status-warning/40 hover:shadow-lg hover:shadow-status-warning/12 rounded-2xl px-3.5 py-2.5 flex items-center gap-2.5 transition-all duration-250 card-spring cursor-pointer">
                      <div className="w-8 h-8 rounded-xl bg-status-warning/10 border border-status-warning/20 flex items-center justify-center shrink-0">
                        <Star className="w-3.5 h-3.5 text-status-warning" />
                      </div>
                      <div>
                        <div className="text-3xs text-muted-foreground leading-none mb-0.5 font-semibold">
                          النقاط
                        </div>
                        <div className="font-bold text-sm tabular-nums">
                          {user.loyalty_points ?? 0}
                        </div>
                      </div>
                    </div>
                  </Link>
                </div>
              </div>
            </div>

            {/* Recent orders strip — R111-F1 G3 (P3): a 4-row
                mini-skeleton while pending (the strip used to pop in
                below the hero with zero loading state — CLS) and an
                honest compact error row with retry on failure (an
                outage no longer reads as "no orders"). */}
            {ordersPending ? (
              <div
                aria-hidden="true"
                className="bg-card border border-border/45 rounded-2xl overflow-hidden shadow-sm shadow-black/10"
              >
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/25">
                  <div className="w-3.5 h-3.5 rounded-full skeleton-shimmer" />
                  <div className="h-3 w-20 skeleton-shimmer rounded" />
                </div>
                <div className="divide-y divide-border/15">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-3 min-h-[52px]">
                      <div className="w-8 h-8 rounded-xl bg-muted/50 skeleton-shimmer shrink-0" />
                      <div className="flex-1 space-y-1.5">
                        <div className="h-3 skeleton-shimmer rounded w-1/3" />
                        <div className="h-2.5 skeleton-shimmer rounded w-1/4" />
                      </div>
                      <div className="h-3 w-12 skeleton-shimmer rounded" />
                    </div>
                  ))}
                </div>
              </div>
            ) : ordersError ? (
              <div className="bg-card border border-status-error/18 rounded-2xl px-4 py-3 flex items-center justify-between gap-3 float-in">
                <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground">
                  <WifiOff className="w-4 h-4 text-status-error/60 shrink-0" />
                  تعذّر تحميل آخر الطلبات
                </div>
                <button
                  onClick={() => refetchOrders()}
                  className="text-xs font-bold text-primary-text border border-primary/25 px-3.5 py-1.5 rounded-lg hover:bg-primary/8 transition-colors press-spring shrink-0"
                >
                  إعادة المحاولة
                </button>
              </div>
            ) : (
              latestOrders.length > 0 && (
                <div className="bg-card border border-border/45 rounded-2xl overflow-hidden float-in stagger-1 shadow-sm shadow-black/10">
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/25">
                    <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground">
                      <Clock className="w-3.5 h-3.5" />
                      آخر الطلبات
                    </div>
                    <Link href="/orders">
                      <button className="flex items-center gap-0.5 text-xs text-primary-text hover:text-primary-text/75 font-bold transition-colors press-spring">
                        عرض الكل
                        <ChevronLeft className="w-3 h-3" />
                      </button>
                    </Link>
                  </div>
                  <div className="divide-y divide-border/15">
                    {latestOrders.map((order) => (
                      <Link key={order.id} href={`/orders/${order.order_code}`}>
                        <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/15 active:bg-muted/25 transition-colors cursor-pointer group min-h-[52px]">
                          <div className="w-8 h-8 rounded-xl bg-muted/50 flex items-center justify-center shrink-0 overflow-hidden border border-border/25">
                            {order.product_image_url ? (
                              <img
                                src={order.product_image_url}
                                alt={order.product_name}
                                loading="lazy"
                                decoding="async"
                                className="w-full h-full object-contain p-1"
                              />
                            ) : (
                              <Package className="w-3.5 h-3.5 text-muted-foreground" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-bold truncate group-hover:text-primary-text transition-colors duration-150">
                              {order.product_name}
                            </div>
                            <div className="flex items-center gap-1 mt-0.5">
                              <OrderStatusIcon status={order.status} />
                              <span
                                className={`text-3xs font-bold ${statusColor(order.status).split(" ")[0]}`}
                              >
                                {statusLabel(order.status)}
                              </span>
                            </div>
                          </div>
                          <div className="text-xs font-bold tabular-nums shrink-0">
                            {formatCurrency(order.amount)}
                          </div>
                          <ChevronLeft className="w-3 h-3 text-muted-foreground group-hover:text-primary-text transition-colors shrink-0" />
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )
            )}
          </div>
        ) : (
          /* Guest: editorial hero */
          <div
            ref={guestHeroRef}
            className="relative overflow-hidden rounded-3xl border border-border/40 mb-6 bg-card page-in shadow-xl shadow-black/20"
          >
            {/* Background layers */}
            <div className="absolute inset-0 dot-grid pointer-events-none opacity-60" />
            <div className="absolute inset-0 bg-gradient-to-l from-primary/10 via-transparent to-transparent pointer-events-none" />
            <div className="absolute right-0 top-0 bottom-0 w-[2.5px] bg-gradient-to-b from-primary/80 via-primary/30 to-transparent" />

            {/* Ambient glow blobs — 96-F5 (R96 F-4b): animation-play-state
                flips to paused when the hero leaves the viewport (IO above);
                prefers-reduced-motion keeps winning via the global kill-switch. */}
            <div
              className="absolute top-[-50px] right-[8%] w-72 h-72 bg-primary/8 rounded-full blur-3xl pointer-events-none blob-drift"
              style={{ animationPlayState: heroOnScreen ? "running" : "paused" }}
            />
            <div
              className="absolute bottom-[-40px] left-[15%] w-56 h-56 bg-primary/5 rounded-full blur-3xl pointer-events-none blob-drift-slow"
              style={{ animationPlayState: heroOnScreen ? "running" : "paused" }}
            />

            <div className="relative px-5 py-7 sm:px-9 sm:py-10">
              <div className="flex flex-wrap items-start justify-between gap-5">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-3.5">
                    <span className="inline-flex items-center gap-1 text-3xs font-bold bg-primary/12 text-primary-text border border-primary/25 px-2.5 py-1 rounded-full">
                      ليبيا #1
                    </span>
                    <span className="text-2xs text-muted-foreground font-semibold">
                      سوق الاشتراكات الرقمية
                    </span>
                  </div>
                  <h1 className="text-fluid-3xl font-bold mb-3 leading-[1.15] tracking-tight">
                    {/*
                      Single contiguous phrase for Google's NLU. Visual
                      two-line split is achieved with `block` + a styled
                      span — NOT a literal <br>, which used to fragment
                      the heading text node and weaken keyword strength.
                      The locale word "في ليبيا" stays attached to the
                      keyword phrase and shifts to its own line on
                      narrow viewports.
                    */}
                    <span className="block">سوق الاشتراكات الرقمية</span>
                    <span className="block text-gradient-animated">في ليبيا</span>
                  </h1>
                  <p className="text-muted-foreground text-sm leading-relaxed mb-4 max-w-md">
                    {/*
                      Editorial intro — the only on-page Arabic prose
                      that gives Google a topic-vector beyond the title.
                      Every target keyword appears EXACTLY ONCE: سوق،
                      اشتراكات، البث المباشر، نتفلكس، ديزني+، شاهد،
                      سبوتيفاي، الألعاب، بلايستيشن بلاس، أدوبي،
                      مايكروسوفت ٣٦٥، الدينار الليبي، تسليم فوري. NOT
                      keyword-stuffing — every term serves the sentence.
                    */}
                    <strong lang="en" className="font-bold text-foreground">
                      SubNation
                    </strong>{" "}
                    سوق إلكتروني متخصّص في بيع الاشتراكات الرقمية للسوق الليبي. تجد على المنصّة
                    اشتراكات البثّ المباشر مثل نتفلكس وديزني+ وشاهد، وخدمات الموسيقى مثل سبوتيفاي،
                    واشتراكات الألعاب مثل بلايستيشن بلاس، وأدوات الإنتاجية مثل أدوبي ومايكروسوفت 365
                    — كلّها بالدينار الليبي مع تسليم فوري بعد الدفع.
                  </p>

                  {/* Brand chips */}
                  <div className="relative overflow-hidden mb-5">
                    <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none pb-0.5 scroll-fade-rtl-start">
                      {BRANDS.map((brand, i) => (
                        <span
                          key={brand.latin}
                          aria-label={brand.ar}
                          className={`shrink-0 text-2xs font-bold bg-muted/40 border border-border/40 text-muted-foreground px-2.5 py-1 rounded-full whitespace-nowrap hover:border-border/70 hover:text-muted-foreground transition-all duration-150 float-in stagger-${Math.min(i + 1, 8)}`}
                        >
                          {/* 96-F5 (R96 A6 #16): lang="en" on the Latin label
                              so screen readers stop spelling brand names with
                              Arabic phonemes («نِتفليكس»); the Arabic sr-only
                              transliteration below already carries the SEO
                              weight. */}
                          <span aria-hidden="true" lang="en">
                            {brand.latin}
                          </span>
                          {/* Visually hidden Arabic transliteration so the
                              crawler indexes "نتفلكس", "بلايستيشن", etc.
                              alongside the Latin form. .sr-only is the
                              standard a11y utility. */}
                          <span className="sr-only">{brand.ar}</span>
                        </span>
                      ))}
                      <span className="shrink-0 text-2xs text-muted-foreground px-1 whitespace-nowrap">
                        وأكثر…
                      </span>
                    </div>
                  </div>

                  {/* CTAs — mobile: stacked with primary dominant; desktop: inline */}
                  <div className="flex flex-col sm:flex-row gap-2.5 sm:flex-wrap">
                    <Link href="/register" className="contents sm:block">
                      <Button className="w-full sm:w-auto bg-primary hover:bg-primary/90 shadow-xl shadow-primary/28 active:scale-[0.97] h-12 sm:h-11 px-7 font-bold transition-all cta-glow text-sm rounded-xl">
                        إنشاء حساب مجاني
                      </Button>
                    </Link>
                    <Link href="/login" className="contents sm:block">
                      <Button
                        variant="ghost"
                        className="w-full sm:w-auto active:scale-[0.97] h-11 sm:h-11 sm:px-4 transition-all text-sm gap-1.5 hover:bg-muted/40 rounded-xl text-muted-foreground hover:text-foreground"
                      >
                        لدي حساب — تسجيل الدخول
                        <ArrowLeft className="w-3.5 h-3.5 opacity-40" />
                      </Button>
                    </Link>
                  </div>
                </div>

                {/* Stats column — desktop only — R111-F1 G2 (P3):
                    chip-shaped skeletons while the first fetch is pending
                    (no pop-in CLS); an error hides the column (decorative
                    data — documented deliberate degrade, see the query). */}
                {stats ? (
                  <div className="hidden sm:flex flex-col gap-2 shrink-0">
                    {[
                      {
                        // R94-A1 #11 (P3): count-aware Arabic labels
                        // («منتجان متاحان / منتجات متاحة / منتجاً متاحاً»)
                        // instead of a frozen singular after every count.
                        label: formatCount(stats.available_products, {
                          one: "منتج متاح",
                          two: "منتجان متاحان",
                          few: "منتجات متاحة",
                          many: "منتجاً متاحاً",
                          other: "منتج متاح",
                        }),
                        value: stats.available_products,
                        color: "text-status-success",
                        border: "border-status-success/18",
                        bg: "bg-status-success/7",
                      },
                      {
                        label: "أقل سعر",
                        value: stats.lowest_price ? formatCurrency(stats.lowest_price) : "—",
                        color: "text-primary-text",
                        border: "border-primary/18",
                        bg: "bg-primary/7",
                      },
                      {
                        label: formatCount(stats.total_units, {
                          one: "وحدة بالمخزون",
                          two: "وحدتان بالمخزون",
                          few: "وحدات بالمخزون",
                          many: "وحدة بالمخزون",
                          other: "وحدة بالمخزون",
                        }),
                        value: stats.total_units,
                        color: "text-status-info",
                        border: "border-status-info/18",
                        bg: "bg-status-info/7",
                      },
                    ].map((s, i) => (
                      <div
                        key={s.label}
                        className={`${s.bg} border ${s.border} rounded-2xl px-4 py-3 text-right min-w-[116px] float-in stagger-${i + 1} hover:brightness-105 transition-all duration-200`}
                      >
                        <div
                          className={`font-bold text-2xl leading-none mb-1 tabular-nums num-pop ${s.color}`}
                        >
                          {s.value}
                        </div>
                        <div className="text-xs text-muted-foreground">{s.label}</div>
                      </div>
                    ))}
                  </div>
                ) : statsPending ? (
                  <div className="hidden sm:flex flex-col gap-2 shrink-0" aria-hidden="true">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div
                        key={i}
                        className="bg-muted/30 border border-border/40 rounded-2xl px-4 py-3 min-w-[116px]"
                      >
                        <div className="h-7 w-14 skeleton-shimmer rounded mb-1.5" />
                        <div className="h-3 w-24 skeleton-shimmer rounded" />
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        )}

        {/* Mobile stats strip (guest) — R111-F1 G2: the same
            skeleton-while-pending / hide-on-error contract as the
            desktop column above (identical geometry, no CLS). */}
        {!token &&
          (stats ? (
            <div className="sm:hidden grid grid-cols-3 gap-2 mb-5">
              {[
                {
                  label: formatCount(stats.available_products, {
                    one: "منتج",
                    two: "منتجان",
                    few: "منتجات",
                    many: "منتجاً",
                    other: "منتج",
                  }),
                  value: stats.available_products,
                  color: "text-status-success",
                },
                {
                  label: "أقل سعر",
                  value: stats.lowest_price ? formatCurrency(stats.lowest_price) : "—",
                  color: "text-primary-text",
                },
                { label: "بالمخزون", value: stats.total_units, color: "text-status-info" },
              ].map((s) => (
                <div
                  key={s.label}
                  className="bg-card border border-border/45 rounded-2xl p-3 text-center"
                >
                  <div
                    className={`font-bold text-base leading-none mb-0.5 tabular-nums ${s.color}`}
                  >
                    {s.value}
                  </div>
                  <div className="text-3xs text-muted-foreground">{s.label}</div>
                </div>
              ))}
            </div>
          ) : statsPending ? (
            <div className="sm:hidden grid grid-cols-3 gap-2 mb-5" aria-hidden="true">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-card border border-border/45 rounded-2xl p-3 text-center"
                >
                  <div className="h-5 w-10 mx-auto skeleton-shimmer rounded mb-1" />
                  <div className="h-2.5 w-14 mx-auto skeleton-shimmer rounded" />
                </div>
              ))}
            </div>
          ) : null)}

        {/* ── Filters ──────────────────────────────────────── */}
        {/* 96-F5 (R96-M08): the sticky offset tracks the Navbar's real
            chrome height — 3.5rem (h-14) + the top safe-area inset the
            header now grows by in installed-PWA mode, so the bar tucks
            UNDER the taller header instead of sliding beneath it. */}
        <div className="sticky top-[calc(3.5rem_+_env(safe-area-inset-top))] z-30 -mx-4 px-4 py-3 bg-background/96 border-b border-border/15 mb-5 sm:static sm:mx-0 sm:px-0 sm:py-0 sm:bg-transparent sm:border-0 sm:mb-6">
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
                className="pr-9 h-10 bg-card border-border/50 focus:border-primary/45 transition-all duration-200 rounded-xl"
                /* 96-F5 (R96-M03): the `text-sm` override is GONE — twMerge
                    let it beat the shared Input's iOS-zoom-safe
                    text-base/md:text-sm baseline, so focusing the catalog
                    search zoomed iOS Safari ~1.14× and never zoomed back.
                    Mobile is 16px again; ≥md keeps the compact 14px look. */
              />
              {/* Search history dropdown */}
              {showSearchHistory && searchHistory.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-card border border-border/50 rounded-xl shadow-lg shadow-black/20 z-50 overflow-hidden">
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
                    {searchHistory.map((query) => (
                      <button
                        key={query}
                        onClick={() => handleSearchHistoryClick(query)}
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
            <div className="relative shrink-0">
              <SlidersHorizontal className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                aria-label="ترتيب المنتجات"
                title="ترتيب المنتجات"
                className="h-10 appearance-none bg-card border border-border/50 rounded-xl pr-8 pl-7 text-base md:text-sm font-semibold focus:border-primary/40 cursor-pointer transition-all hover:border-border/80"
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
            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none pb-0.5 scroll-fade-rtl">
              {CATEGORIES.map((c) => {
                const active = category === c.value;
                return (
                  <button
                    key={c.value}
                    onClick={() => setCategory(c.value)}
                    aria-pressed={active}
                    className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-sm font-semibold whitespace-nowrap transition-all duration-180 press-spring min-h-[38px] shrink-0 ${
                      active
                        ? "bg-primary text-white shadow-md shadow-primary/30 font-bold"
                        : "bg-card border border-border/50 text-muted-foreground hover:text-foreground hover:border-border/80 hover:bg-secondary/40"
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
                className={`flex items-center gap-1.5 px-3.5 py-1.5 min-h-[38px] shrink-0 rounded-xl text-sm font-semibold whitespace-nowrap transition-all duration-180 press-spring ${
                  availableOnly
                    ? "bg-status-success/15 text-status-success border border-status-success/30 font-bold"
                    : "bg-card border border-border/50 text-muted-foreground hover:text-foreground hover:border-border/80"
                }`}
              >
                <Package className="w-3.5 h-3.5" />
                متوفر فقط
              </button>
            </div>
          </div>
        </div>

        {/* Result header */}
        {!isLoading && (products.length > 0 || activeFilterCount > 0) && (
          <div className="flex items-center justify-between mb-3.5">
            <p className="text-sm text-muted-foreground">
              {/* 93-C8 (A11 §3): formatCount carries the Arabic plural
                  paradigm — «منتجان / منتجات / منتجاً» — instead of a
                  bare singular after any count. */}
              <span className="font-bold text-foreground">
                {formatCount(products.length, {
                  two: "منتجان",
                  few: "منتجات",
                  many: "منتجاً",
                  other: "منتج",
                })}
              </span>
              {category && <span className="text-muted-foreground"> في هذه الفئة</span>}
            </p>
            {activeFilterCount > 0 && (
              <button
                onClick={clearFilters}
                className="text-xs text-muted-foreground hover:text-primary-text transition-colors px-2.5 py-1 rounded-lg hover:bg-primary/8 press-spring font-semibold"
              >
                مسح ({activeFilterCount})
              </button>
            )}
          </div>
        )}

        {/* ── Products Grid ─────────────────────────────────── */}
        {/*
          h2 above the product grid. Text reflects the active filter
          so the heading is informative rather than decorative:
            - search active → "نتائج البحث"
            - category selected → category Arabic label
            - sort changed → sort label
            - default → "الاشتراكات المتاحة"
          When idle (no filter active) the heading is sr-only to
          preserve the current visual; with a filter, it becomes
          visible as a small section title.
        */}
        {(() => {
          const hasFilter = !!(searchInput || category || sort || availableOnly);
          let label = "الاشتراكات المتاحة";
          if (searchInput) label = `نتائج البحث: ${searchInput}`;
          else if (category) label = categoryLabel(category);
          else if (sort) label = SORTS.find((s) => s.value === sort)?.label ?? label;
          else if (availableOnly) label = "المنتجات المتوفّرة فقط";
          return hasFilter ? (
            <h2 className="text-sm font-bold text-muted-foreground mb-3 flex items-center gap-2">
              <span className="w-1 h-4 bg-primary rounded-full" />
              {label}
            </h2>
          ) : (
            <h2 className="sr-only">{label}</h2>
          );
        })()}
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <ProductSkeleton key={i} />
            ))}
          </div>
        ) : productsError ? (
          /* Distinct from "no results": a failed products API previously
             rendered the empty-search state — an outage read as "no products
             match your search", which is actively misleading. */
          <div className="text-center py-16 text-muted-foreground bg-card border border-status-error/22 rounded-3xl float-in shadow-sm shadow-black/8">
            <div className="w-14 h-14 rounded-2xl bg-status-error/8 border border-status-error/20 mx-auto mb-4 flex items-center justify-center">
              <WifiOff className="w-6 h-6 text-status-error/70" />
            </div>
            <p className="font-bold text-base mb-1.5 text-foreground">تعذّر تحميل المنتجات</p>
            <p className="text-sm text-muted-foreground mb-5">
              حدث خطأ في الاتصال بالخدمة — تحقّق من شبكتك ثم أعد المحاولة
            </p>
            <button
              onClick={() => refetchProducts()}
              className="text-sm font-bold text-primary-text border border-primary/25 px-5 py-2 rounded-xl hover:bg-primary/8 transition-colors press-spring"
            >
              إعادة المحاولة
            </button>
          </div>
        ) : products.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground bg-card border border-border/40 rounded-3xl float-in shadow-sm shadow-black/8">
            <div className="w-14 h-14 rounded-2xl bg-muted/60 mx-auto mb-4 flex items-center justify-center">
              <PackageSearch className="w-6 h-6 opacity-35" />
            </div>
            <p className="font-bold text-base mb-1.5">لا توجد منتجات تطابق بحثك</p>
            <p className="text-sm text-muted-foreground mb-5">جرب تغيير الفلتر أو كلمة البحث</p>
            {activeFilterCount > 0 && (
              <button
                onClick={clearFilters}
                className="text-sm font-bold text-primary-text border border-primary/25 px-5 py-2 rounded-xl hover:bg-primary/8 transition-colors press-spring"
              >
                مسح جميع الفلاتر
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
            {products.map((product, i) => (
              <div key={product.id} className={i >= 4 ? "cv-card" : undefined}>
                <ProductCard
                  product={
                    product as {
                      id: number;
                      slug?: string | null;
                      name: string;
                      description?: string | null;
                      image_url?: string | null;
                      price: number;
                      category?: string | null;
                      is_available: boolean;
                      stock_count: number;
                      sale_price?: number | null;
                    }
                  }
                  index={i}
                />
              </div>
            ))}
          </div>
        )}

        {/* ── Trust footer ── */}
        {!isLoading && products.length > 0 && (
          <div className="mt-10 pt-8 border-t border-border/25">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <TrustCard
                icon={Truck}
                tone="warning"
                title="تسليم فوري"
                description="في أغلب الحالات تصلك بيانات الاشتراك فور تأكيد الدفع، وخلال 24 ساعة كحد أقصى"
              />
              <TrustCard
                icon={ShieldCheck}
                tone="success"
                title="دفع آمن"
                description="محفظتك محمية بالكامل وجميع معاملاتك موثقة"
              />
              <TrustCard
                icon={Headphones}
                tone="info"
                title="دعم سريع"
                description="فريقنا يرد خلال ساعات العمل — عادةً خلال 15 دقيقة إلى ساعة"
              />
            </div>
          </div>
        )}

        {/* Bottom breathing room for guests. Authed users are covered by
            main's mobile-nav-safe-pad (which reserves the MobileNav
            clearance) — stacking a second mobile-nav-safe-pad here used to
            double the pad on mobile AND leak 72px onto desktop. */}
        {!token && <div className="h-6 md:h-0" />}
      </div>
    </div>
  );
}
