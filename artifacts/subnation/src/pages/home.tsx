import { useState, useEffect, useRef } from "react";
import { useListProducts, useGetCatalogStats, useGetFlashSale, useGetMe } from "@workspace/api-client-react";
import { getListProductsQueryKey, getGetCatalogStatsQueryKey, getGetFlashSaleQueryKey, getGetMeQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { ProductCard } from "@/components/ProductCard";
import { formatCurrency, categoryLabel } from "@/lib/utils";
import { Search, Zap, Clock, Wallet, Star, PackageSearch, ChevronDown, SlidersHorizontal, Package, TrendingUp } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

const CATEGORIES = [
  { value: "", label: "الكل" },
  { value: "streaming", label: "بث مباشر" },
  { value: "music", label: "موسيقى" },
  { value: "gaming", label: "ألعاب" },
  { value: "productivity", label: "إنتاجية" },
];

const SORTS = [
  { value: "", label: "الأحدث" },
  { value: "popular", label: "الأكثر مبيعاً" },
  { value: "price_asc", label: "السعر: الأقل" },
  { value: "price_desc", label: "السعر: الأعلى" },
];

function ProductSkeleton() {
  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <div className="aspect-video bg-muted skeleton-shimmer" />
      <div className="p-4 space-y-2.5">
        <div className="flex justify-between gap-2">
          <div className="h-4 bg-muted skeleton-shimmer rounded w-3/5" />
          <div className="h-4 bg-muted skeleton-shimmer rounded w-1/5" />
        </div>
        <div className="h-3 bg-muted skeleton-shimmer rounded w-full" />
        <div className="h-3 bg-muted skeleton-shimmer rounded w-3/4" />
        <div className="pt-2 flex justify-between items-center border-t border-border/30 mt-1">
          <div className="h-5 bg-muted skeleton-shimmer rounded w-1/4" />
          <div className="h-6 w-6 bg-muted skeleton-shimmer rounded-lg" />
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  const { token } = useAuth();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState("");
  const [availableOnly, setAvailableOnly] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  const params: Record<string, string> = {};
  if (search) params.search = search;
  if (category) params.category = category;
  if (sort) params.sort = sort;
  if (availableOnly) params.available_only = "true";

  const { data: products = [], isLoading } = useListProducts(params, {
    query: { queryKey: getListProductsQueryKey(params) },
  });

  const { data: stats } = useGetCatalogStats({
    query: { queryKey: getGetCatalogStatsQueryKey() },
  });

  const { data: flashSaleData } = useGetFlashSale({
    query: { queryKey: getGetFlashSaleQueryKey() },
  });

  const { data: user } = useGetMe({
    query: { enabled: !!token, retry: false, queryKey: getGetMeQueryKey() },
    request: { headers: { Authorization: token ? `Bearer ${token}` : "" } },
  });

  const flashSale = flashSaleData?.flash_sale;
  const [flashTimeLeft, setFlashTimeLeft] = useState("");
  const [flashUrgent, setFlashUrgent] = useState(false);

  useEffect(() => {
    if (!flashSale) return;
    const update = () => {
      const diff = new Date(flashSale.ends_at).getTime() - Date.now();
      if (diff <= 0) { setFlashTimeLeft("انتهى العرض"); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setFlashTimeLeft(`${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`);
      setFlashUrgent(diff < 3600000); // urgent if less than 1 hour
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [flashSale?.ends_at]);

  return (
    <div className="min-h-screen">
      {/* ── Flash Sale Banner ─────────────────────────────────────────────── */}
      {flashSale && (
        <div className="relative overflow-hidden bg-gradient-to-l from-primary/25 via-primary/12 to-primary/5 border-b border-primary/25 py-3 px-4">
          {/* Animated background sweep */}
          <div className="absolute inset-0 flash-banner-glow opacity-60 pointer-events-none" />
          <div className="relative max-w-6xl mx-auto flex flex-col sm:flex-row items-center gap-3 sm:gap-6">
            <div className="flex items-center gap-2 text-primary font-black shrink-0">
              <Zap className="w-4 h-4 fill-current animate-pulse" />
              <span className="text-sm">فلاش سيل</span>
            </div>
            <div className="flex-1 text-center sm:text-right text-sm">
              <span className="font-bold text-foreground">{flashSale.title}</span>
              <span className="text-primary font-black mr-2">— خصم {flashSale.discount_percent}%</span>
            </div>
            <div className={`flex items-center gap-1.5 text-sm font-mono px-3 py-1.5 rounded-lg shrink-0 border transition-all ${
              flashUrgent
                ? "bg-primary/15 border-primary/40 text-primary animate-pulse"
                : "bg-card border-border"
            }`}>
              <Clock className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="font-black tabular-nums">{flashTimeLeft || "..."}</span>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto px-4 py-6 sm:py-8">
        {/* ── Hero / Header ─────────────────────────────────────────────────── */}
        {token && user ? (
          <div className="flex flex-wrap items-start gap-3 mb-7">
            <div className="flex-1 min-w-0">
              <h1 className="text-xl sm:text-2xl font-black mb-1 leading-snug">أهلاً بك في SubNation</h1>
              <p className="text-muted-foreground text-sm">اشترك بأفضل الخدمات الرقمية بأسعار مناسبة</p>
            </div>
            <div className="flex gap-2 shrink-0">
              <Link href="/wallet">
                <div className="bg-card border border-border hover:border-primary/40 rounded-xl px-4 py-3 flex items-center gap-2.5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary/8 cursor-pointer active:scale-95">
                  <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Wallet className="w-3.5 h-3.5 text-primary" />
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground leading-none mb-0.5">رصيد المحفظة</div>
                    <div className="font-black text-sm">{formatCurrency(user.wallet_balance ?? 0)}</div>
                  </div>
                </div>
              </Link>
              <Link href="/loyalty">
                <div className="bg-card border border-border hover:border-yellow-400/40 rounded-xl px-4 py-3 flex items-center gap-2.5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-yellow-400/8 cursor-pointer active:scale-95">
                  <div className="w-7 h-7 rounded-lg bg-yellow-400/10 flex items-center justify-center shrink-0">
                    <Star className="w-3.5 h-3.5 text-yellow-400" />
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground leading-none mb-0.5">نقاط الولاء</div>
                    <div className="font-black text-sm">{user.loyalty_points ?? 0}</div>
                  </div>
                </div>
              </Link>
            </div>
          </div>
        ) : (
          <div className="relative overflow-hidden flex flex-wrap items-center justify-between gap-4 mb-7 px-6 py-7 bg-gradient-to-l from-primary/12 via-primary/6 to-transparent border border-primary/20 rounded-2xl">
            {/* Decorative glow */}
            <div className="absolute -left-8 -top-8 w-40 h-40 bg-primary/8 rounded-full blur-2xl pointer-events-none" />
            <div>
              <h1 className="text-xl sm:text-2xl font-black mb-1.5 leading-snug">سوق الاشتراكات الرقمية</h1>
              <p className="text-muted-foreground text-sm">Netflix · Spotify · Disney+ · PS Plus وأكثر — بالدينار الليبي</p>
            </div>
            <div className="flex gap-2 shrink-0">
              <Link href="/login">
                <Button variant="outline" className="active:scale-95 transition-transform">تسجيل الدخول</Button>
              </Link>
              <Link href="/register">
                <Button className="bg-primary hover:bg-primary/90 shadow-lg shadow-primary/25 active:scale-95 transition-transform">إنشاء حساب مجاني</Button>
              </Link>
            </div>
          </div>
        )}

        {/* ── Stats ─────────────────────────────────────────────────────────── */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-7">
            {[
              { label: "منتج متاح", value: stats.available_products, color: "text-emerald-400", bg: "bg-emerald-500/8 border-emerald-500/15", icon: Package },
              { label: "وحدة في المخزون", value: stats.total_units, color: "text-blue-400", bg: "bg-blue-500/8 border-blue-500/15", icon: Package },
              { label: "أقل سعر", value: stats.lowest_price ? formatCurrency(stats.lowest_price) : "—", color: "text-primary", bg: "bg-primary/8 border-primary/15", icon: TrendingUp },
              { label: "منتج إجمالي", value: stats.total_products, color: "text-muted-foreground", bg: "bg-muted/50 border-border", icon: Package },
            ].map((s) => (
              <div key={s.label} className={`${s.bg} border rounded-xl p-3.5 text-center transition-all duration-200 hover:-translate-y-0.5`}>
                <div className={`text-xl font-black mb-0.5 ${s.color}`}>{s.value}</div>
                <div className="text-xs text-muted-foreground">{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* ── Filters — sticky on mobile ─────────────────────────────────── */}
        <div
          ref={filterRef}
          className="sticky top-14 z-30 -mx-4 px-4 py-3 bg-background/90 backdrop-blur-md border-b border-border/40 mb-5 sm:static sm:mx-0 sm:px-0 sm:py-0 sm:bg-transparent sm:backdrop-blur-none sm:border-0 sm:mb-6"
        >
          <div className="flex gap-2 mb-2.5 sm:mb-3">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                type="search"
                placeholder="ابحث عن منتج..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pr-9 h-9 text-sm"
              />
            </div>

            <div className="relative">
              <select
                value={sort}
                onChange={e => setSort(e.target.value)}
                className="h-9 appearance-none bg-secondary border border-border rounded-lg pr-3 pl-7 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer transition-colors hover:bg-secondary/80"
              >
                {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
              <ChevronDown className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {CATEGORIES.map(c => (
              <button
                key={c.value}
                onClick={() => setCategory(c.value)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 active:scale-95 min-h-[36px] ${
                  category === c.value
                    ? "bg-primary text-white shadow-sm shadow-primary/30"
                    : "bg-secondary text-muted-foreground hover:text-foreground hover:bg-secondary/70"
                }`}
              >
                {c.label}
              </button>
            ))}
            <button
              onClick={() => setAvailableOnly(v => !v)}
              className={`px-3 py-1.5 min-h-[36px] rounded-lg text-sm font-medium transition-all duration-150 active:scale-95 flex items-center gap-1.5 ${
                availableOnly
                  ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                  : "bg-secondary text-muted-foreground hover:text-foreground hover:bg-secondary/70"
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              متوفر فقط
            </button>
          </div>
        </div>

        {/* ── Products Grid ─────────────────────────────────────────────────── */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <ProductSkeleton key={i} />
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground bg-card border border-border rounded-2xl">
            <PackageSearch className="w-12 h-12 mx-auto mb-3 opacity-25" />
            <p className="font-bold text-base">لا توجد منتجات تطابق بحثك</p>
            <p className="text-sm mt-1 text-muted-foreground/70">جرب تغيير الفلتر أو كلمة البحث</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {products.map(product => (
              <ProductCard key={product.id} product={product as any} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
