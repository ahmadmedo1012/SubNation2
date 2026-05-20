import { ProductCard } from "@/components/ProductCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSeo } from "@/hooks/useSeo";
import { useAuth } from "@/lib/auth";
import { buildItemListLd, buildOrganizationLd, buildWebsiteLd } from "@/lib/seo-builders";
import { formatCurrency, statusColor, statusLabel } from "@/lib/utils";
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
  ArrowLeft,
  Briefcase,
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  Clock,
  Gamepad2,
  Headphones,
  LayoutGrid,
  Music2,
  Package,
  PackageSearch,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  Truck,
  Tv2,
  Wallet,
  XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";

const CATEGORIES = [
  { value: "", label: "الكل", Icon: LayoutGrid },
  { value: "streaming", label: "بث مباشر", Icon: Tv2 },
  { value: "music", label: "موسيقى", Icon: Music2 },
  { value: "gaming", label: "ألعاب", Icon: Gamepad2 },
  { value: "productivity", label: "إنتاجية", Icon: Briefcase },
];

const SORTS = [
  { value: "", label: "الأحدث" },
  { value: "popular", label: "الأكثر مبيعاً" },
  { value: "price_asc", label: "السعر: الأقل" },
  { value: "price_desc", label: "السعر: الأعلى" },
];

const BRANDS = [
  "Netflix",
  "Spotify",
  "Disney+",
  "PlayStation",
  "YouTube",
  "Canva",
  "Adobe",
  "Office 365",
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
  return (
    <div className="bg-card border border-border/50 rounded-2xl overflow-hidden">
      <div className="h-[130px] sm:h-[148px] skeleton-shimmer" />
      <div className="p-3.5 space-y-2.5">
        <div className="flex justify-between gap-2">
          <div className="h-3.5 skeleton-shimmer rounded-lg w-3/5" />
          <div className="h-3.5 skeleton-shimmer rounded-full w-14" />
        </div>
        <div className="h-2.5 skeleton-shimmer rounded w-full" />
        <div className="h-2.5 skeleton-shimmer rounded w-4/5" />
        <div className="pt-2.5 mt-1 flex justify-between items-center border-t border-border/25">
          <div className="h-4 skeleton-shimmer rounded w-20" />
          <div className="h-5 w-10 skeleton-shimmer rounded-full" />
        </div>
      </div>
    </div>
  );
}

function OrderStatusIcon({ status }: { status: string }) {
  if (status === "completed") return <CheckCircle className="w-3 h-3 text-emerald-400" />;
  if (status === "failed" || status === "refunded")
    return <XCircle className="w-3 h-3 text-red-400" />;
  return <Clock className="w-3 h-3 text-yellow-400" />;
}

export default function HomePage() {
  const { token } = useAuth();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState("");
  const [availableOnly, setAvailableOnly] = useState(false);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [showSearchHistory, setShowSearchHistory] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load search history on mount
  useEffect(() => {
    setSearchHistory(getSearchHistory());
  }, []);

  const handleSearchChange = (val: string) => {
    setSearchInput(val);
    setShowSearchHistory(val.length > 0 && searchHistory.length > 0);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearch(val);
      if (val.trim()) {
        saveSearchHistory(val);
        setSearchHistory(getSearchHistory());
      }
    }, 320);
  };

  const handleSearchHistoryClick = (query: string) => {
    setSearchInput(query);
    setSearch(query);
    setShowSearchHistory(false);
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

  const { data: products = [], isLoading } = useListProducts(params, {
    query: {
      queryKey: getListProductsQueryKey(params),
      staleTime: 3 * 60 * 1000, // 3 minutes for products
    },
  });

  const { data: stats } = useGetCatalogStats({
    query: {
      queryKey: getGetCatalogStatsQueryKey(),
      staleTime: 10 * 60 * 1000, // 10 minutes for stats
    },
  });

  const { data: user } = useGetMe({
    query: { enabled: !!token, retry: false, queryKey: getGetMeQueryKey() },
    request: { headers: { Authorization: token ? `Bearer ${token}` : "" } },
  });

  const { data: recentOrders = [] } = useListOrders({
    query: { enabled: !!token, queryKey: getListOrdersQueryKey() },
    request: { headers: { Authorization: token ? `Bearer ${token}` : "" } },
  });
  const latestOrders = recentOrders.slice(0, 4);

  const activeFilterCount = [searchInput, category, sort, availableOnly ? "1" : ""].filter(
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
    title: "SubNation — سوق الاشتراكات الرقمية في ليبيا",
    description:
      "اشترك في Netflix وSpotify وPS Plus وDisney+ والمزيد بالدينار الليبي. تسليم فوري ودفع آمن.",
    path: "/",
    locale: "ar",
    type: "website",
    jsonLd: [
      buildOrganizationLd(),
      buildWebsiteLd(),
      // Emit ItemList only when products are loaded — an empty list LD
      // is treated by Google as a thin/low-quality structured-data block.
      ...(products.length > 0
        ? [buildItemListLd(products.slice(0, 50).map((p) => ({ id: p.id, name: p.name })))]
        : []),
    ],
  });

  return (
    <div className="min-h-screen">
      {seoBlock}
      <div className="max-w-6xl mx-auto px-4 py-5 sm:py-7">
        {/* ── Hero ─────────────────────────────────────────── */}
        {token && !user ? (
          <div className="mb-5 page-in">
            <div className="relative overflow-hidden rounded-2xl border border-border/40 bg-card mb-4 shadow-lg shadow-black/15 h-[100px] sm:h-[120px] skeleton-shimmer" />
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
                  <p className="text-muted-foreground text-xs mb-0.5 font-medium">
                    مرحباً بك مجدداً
                  </p>
                  <h1 className="text-fluid-2xl font-black leading-tight text-gradient-animated">
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
                        <div className="text-[10px] text-muted-foreground leading-none mb-0.5 font-medium">
                          المحفظة
                        </div>
                        <div className="font-black text-sm tabular-nums text-foreground">
                          {formatCurrency(user.wallet_balance ?? 0)}
                        </div>
                      </div>
                    </div>
                  </Link>
                  <Link href="/loyalty">
                    <div className="bg-background/50 border border-border/50 hover:border-yellow-400/40 hover:shadow-lg hover:shadow-yellow-900/12 rounded-2xl px-3.5 py-2.5 flex items-center gap-2.5 transition-all duration-250 card-spring cursor-pointer">
                      <div className="w-8 h-8 rounded-xl bg-yellow-400/10 border border-yellow-400/20 flex items-center justify-center shrink-0">
                        <Star className="w-3.5 h-3.5 text-yellow-400" />
                      </div>
                      <div>
                        <div className="text-[10px] text-muted-foreground leading-none mb-0.5 font-medium">
                          النقاط
                        </div>
                        <div className="font-black text-sm tabular-nums">
                          {user.loyalty_points ?? 0}
                        </div>
                      </div>
                    </div>
                  </Link>
                </div>
              </div>
            </div>

            {/* Recent orders strip */}
            {latestOrders.length > 0 && (
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
                              className={`text-[10px] font-bold ${statusColor(order.status).split(" ")[0]}`}
                            >
                              {statusLabel(order.status)}
                            </span>
                          </div>
                        </div>
                        <div className="text-xs font-black tabular-nums shrink-0">
                          {formatCurrency(order.amount)}
                        </div>
                        <ChevronLeft className="w-3 h-3 text-muted-foreground group-hover:text-primary-text transition-colors shrink-0" />
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Guest: editorial hero */
          <div className="relative overflow-hidden rounded-3xl border border-border/40 mb-6 bg-card page-in shadow-xl shadow-black/20">
            {/* Background layers */}
            <div className="absolute inset-0 dot-grid pointer-events-none opacity-60" />
            <div className="absolute inset-0 bg-gradient-to-l from-primary/10 via-transparent to-transparent pointer-events-none" />
            <div className="absolute right-0 top-0 bottom-0 w-[2.5px] bg-gradient-to-b from-primary/80 via-primary/30 to-transparent" />

            {/* Ambient glow blobs */}
            <div className="absolute top-[-50px] right-[8%] w-72 h-72 bg-primary/8 rounded-full blur-3xl pointer-events-none blob-drift" />
            <div className="absolute bottom-[-40px] left-[15%] w-56 h-56 bg-primary/5 rounded-full blur-3xl pointer-events-none blob-drift-slow" />

            <div className="relative px-5 py-7 sm:px-9 sm:py-10">
              <div className="flex flex-wrap items-start justify-between gap-5">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-3.5">
                    <span className="inline-flex items-center gap-1 text-[10px] font-black bg-primary/12 text-primary-text border border-primary/25 px-2.5 py-1 rounded-full">
                      ليبيا #1
                    </span>
                    <span className="text-[11px] text-muted-foreground font-medium">
                      سوق الاشتراكات الرقمية
                    </span>
                  </div>
                  <h1 className="text-fluid-3xl font-black mb-3 leading-[1.15] tracking-tight">
                    اشتراكات رقمية
                    <br />
                    <span className="text-gradient-animated">بالدينار الليبي</span>
                  </h1>
                  <p className="text-muted-foreground text-sm leading-relaxed mb-4 max-w-xs">
                    تسليم فوري، دفع آمن، دعم متواصل. كل اشتراكاتك في مكان واحد.
                  </p>

                  {/* Brand chips */}
                  <div className="relative overflow-hidden mb-5">
                    <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none pb-0.5 scroll-fade-rtl-start">
                      {BRANDS.map((brand, i) => (
                        <span
                          key={brand}
                          className={`shrink-0 text-[11px] font-bold bg-muted/40 border border-border/40 text-muted-foreground px-2.5 py-1 rounded-full whitespace-nowrap hover:border-border/70 hover:text-muted-foreground transition-all duration-150 float-in stagger-${Math.min(i + 1, 8)}`}
                        >
                          {brand}
                        </span>
                      ))}
                      <span className="shrink-0 text-[11px] text-muted-foreground px-1 whitespace-nowrap">
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

                {/* Stats column — desktop only */}
                {stats && (
                  <div className="hidden sm:flex flex-col gap-2 shrink-0">
                    {[
                      {
                        label: "منتج متاح",
                        value: stats.available_products,
                        color: "text-emerald-400",
                        border: "border-emerald-500/18",
                        bg: "bg-emerald-500/7",
                      },
                      {
                        label: "أقل سعر",
                        value: stats.lowest_price ? formatCurrency(stats.lowest_price) : "—",
                        color: "text-primary-text",
                        border: "border-primary/18",
                        bg: "bg-primary/7",
                      },
                      {
                        label: "وحدة بالمخزون",
                        value: stats.total_units,
                        color: "text-blue-400",
                        border: "border-blue-500/18",
                        bg: "bg-blue-500/7",
                      },
                    ].map((s, i) => (
                      <div
                        key={s.label}
                        className={`${s.bg} border ${s.border} rounded-2xl px-4 py-3 text-right min-w-[116px] float-in stagger-${i + 1} hover:brightness-105 transition-all duration-200`}
                      >
                        <div
                          className={`font-black text-2xl leading-none mb-1 tabular-nums num-pop ${s.color}`}
                        >
                          {s.value}
                        </div>
                        <div className="text-xs text-muted-foreground">{s.label}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Mobile stats strip (guest) */}
        {!token && stats && (
          <div className="sm:hidden grid grid-cols-3 gap-2 mb-5">
            {[
              { label: "منتج", value: stats.available_products, color: "text-emerald-400" },
              {
                label: "أقل سعر",
                value: stats.lowest_price ? formatCurrency(stats.lowest_price) : "—",
                color: "text-primary-text",
              },
              { label: "بالمخزون", value: stats.total_units, color: "text-blue-400" },
            ].map((s) => (
              <div
                key={s.label}
                className="bg-card border border-border/45 rounded-2xl p-3 text-center"
              >
                <div className={`font-black text-base leading-none mb-0.5 tabular-nums ${s.color}`}>
                  {s.value}
                </div>
                <div className="text-[10px] text-muted-foreground">{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* ── Filters ──────────────────────────────────────── */}
        <div className="sticky top-14 z-30 -mx-4 px-4 py-3 bg-background/96 backdrop-blur-2xl border-b border-border/15 mb-5 sm:static sm:mx-0 sm:px-0 sm:py-0 sm:bg-transparent sm:backdrop-blur-none sm:border-0 sm:mb-6">
          {/* Search + Sort */}
          <div className="flex gap-2 mb-2.5">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                type="search"
                placeholder="ابحث عن اشتراك..."
                value={searchInput}
                onChange={(e) => handleSearchChange(e.target.value)}
                onFocus={() =>
                  setShowSearchHistory(searchInput.length === 0 && searchHistory.length > 0)
                }
                onBlur={() => setTimeout(() => setShowSearchHistory(false), 200)}
                className="pr-9 h-10 text-sm bg-card border-border/50 focus:border-primary/45 transition-all duration-200 rounded-xl"
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
                        className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                      >
                        مسح
                      </button>
                    </div>
                    {searchHistory.map((query) => (
                      <button
                        key={query}
                        onClick={() => handleSearchHistoryClick(query)}
                        className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground hover:bg-secondary/40 rounded-lg transition-colors text-right"
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
                className="h-10 appearance-none bg-card border border-border/50 rounded-xl pr-8 pl-7 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 cursor-pointer transition-all hover:border-border/80"
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
            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none pb-0.5 scroll-fade-rtl">
              {CATEGORIES.map((c) => {
                const active = category === c.value;
                return (
                  <button
                    key={c.value}
                    onClick={() => setCategory(c.value)}
                    className={`
                      flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-sm font-medium whitespace-nowrap
                      transition-all duration-180 press-spring min-h-[38px] shrink-0
                      ${
                        active
                          ? "bg-primary text-white shadow-md shadow-primary/30 font-bold"
                          : "bg-card border border-border/50 text-muted-foreground hover:text-foreground hover:border-border/80 hover:bg-secondary/40"
                      }
                    `}
                  >
                    <c.Icon className="w-3.5 h-3.5" />
                    {c.label}
                  </button>
                );
              })}
              <button
                onClick={() => setAvailableOnly((v) => !v)}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 min-h-[38px] shrink-0 rounded-xl text-sm font-medium whitespace-nowrap transition-all duration-180 press-spring ${
                  availableOnly
                    ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-bold"
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
              <span className="font-bold text-foreground">{products.length}</span> منتج
              {category && <span className="text-muted-foreground"> في هذه الفئة</span>}
            </p>
            {activeFilterCount > 0 && (
              <button
                onClick={clearFilters}
                className="text-xs text-muted-foreground hover:text-primary-text transition-colors px-2.5 py-1 rounded-lg hover:bg-primary/8 press-spring font-medium"
              >
                مسح ({activeFilterCount})
              </button>
            )}
          </div>
        )}

        {/* ── Products Grid ─────────────────────────────────── */}
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <ProductSkeleton key={i} />
            ))}
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
              {[
                {
                  icon: Truck,
                  color: "text-yellow-400",
                  bg: "bg-yellow-400/8 border-yellow-400/15",
                  title: "تسليم فوري",
                  desc: "تصلك بيانات الاشتراك فور تأكيد الدفع مباشرة",
                },
                {
                  icon: ShieldCheck,
                  color: "text-emerald-400",
                  bg: "bg-emerald-400/8 border-emerald-400/15",
                  title: "دفع آمن",
                  desc: "محفظتك محمية بالكامل وجميع معاملاتك موثقة",
                },
                {
                  icon: Headphones,
                  color: "text-blue-400",
                  bg: "bg-blue-400/8 border-blue-400/15",
                  title: "دعم 24/7",
                  desc: "فريقنا متاح دائماً لمساعدتك في أي وقت",
                },
              ].map((item) => (
                <div
                  key={item.title}
                  className={`flex items-start gap-3 p-4 rounded-2xl border ${item.bg}`}
                >
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 bg-background/35">
                    <item.icon className={`w-4 h-4 ${item.color}`} />
                  </div>
                  <div>
                    <p className="font-bold text-sm mb-0.5">{item.title}</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Bottom padding for mobile nav */}
        <div className={`md:h-0 ${token ? "mobile-nav-safe-pad" : "h-6"}`} />
      </div>
    </div>
  );
}
