import { useState, useEffect } from "react";
import { useListProducts, useGetCatalogStats, useGetFlashSale, useGetMe } from "@workspace/api-client-react";
import { getListProductsQueryKey, getGetCatalogStatsQueryKey, getGetFlashSaleQueryKey, getGetMeQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { ProductCard } from "@/components/ProductCard";
import { formatCurrency, categoryLabel } from "@/lib/utils";
import { Search, Zap, Clock, Wallet, ShoppingBag, TrendingUp } from "lucide-react";
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

export default function HomePage() {
  const { token } = useAuth();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState("");
  const [availableOnly, setAvailableOnly] = useState(false);

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

  useEffect(() => {
    if (!flashSale) return;
    const update = () => {
      const diff = new Date(flashSale.ends_at).getTime() - Date.now();
      if (diff <= 0) { setFlashTimeLeft("انتهى العرض"); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setFlashTimeLeft(`${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [flashSale?.ends_at]);

  return (
    <div className="min-h-screen">
      {/* Hero / Flash Sale Banner */}
      {flashSale && (
        <div className="bg-gradient-to-l from-primary/20 via-primary/10 to-transparent border-b border-primary/20 py-4 px-4">
          <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center gap-3 sm:gap-6">
            <div className="flex items-center gap-2 text-primary font-black text-lg">
              <Zap className="w-5 h-5 fill-current animate-pulse" />
              <span>فلاش سيل</span>
            </div>
            <div className="flex-1 text-center sm:text-right">
              <span className="font-bold text-foreground">{flashSale.title}</span>
              <span className="text-primary font-black mr-2">— خصم {flashSale.discount_percent}%</span>
            </div>
            <div className="flex items-center gap-1.5 text-sm font-mono bg-card border border-border px-3 py-1.5 rounded-lg">
              <Clock className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="font-bold tabular-nums">{flashTimeLeft || "..."}</span>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Welcome + Stats */}
        <div className="mb-8">
          {token && user ? (
            <div className="flex flex-wrap items-start gap-4 mb-6">
              <div className="flex-1">
                <h1 className="text-2xl font-black mb-1">مرحباً بك في سبنيشن</h1>
                <p className="text-muted-foreground text-sm">اشترك بأفضل الخدمات الرقمية بأسعار مناسبة</p>
              </div>
              <div className="flex gap-3">
                <Link href="/wallet">
                  <div className="bg-card border border-border rounded-xl px-4 py-3 flex items-center gap-2 hover:border-primary/50 transition-colors cursor-pointer">
                    <Wallet className="w-4 h-4 text-primary" />
                    <div>
                      <div className="text-xs text-muted-foreground">رصيد المحفظة</div>
                      <div className="font-black text-sm">{formatCurrency(user.wallet_balance ?? 0)}</div>
                    </div>
                  </div>
                </Link>
                <Link href="/orders">
                  <div className="bg-card border border-border rounded-xl px-4 py-3 flex items-center gap-2 hover:border-primary/50 transition-colors cursor-pointer">
                    <ShoppingBag className="w-4 h-4 text-primary" />
                    <div>
                      <div className="text-xs text-muted-foreground">نقاط الولاء</div>
                      <div className="font-black text-sm">{user.loyalty_points ?? 0}</div>
                    </div>
                  </div>
                </Link>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6 p-6 bg-gradient-to-l from-primary/10 to-transparent border border-primary/20 rounded-2xl">
              <div>
                <h1 className="text-2xl font-black mb-1">سوق الاشتراكات الرقمية</h1>
                <p className="text-muted-foreground">Netflix • Spotify • Disney+ • PS Plus وأكثر — بالدينار الليبي</p>
              </div>
              <div className="flex gap-2">
                <Link href="/login"><Button variant="outline">تسجيل الدخول</Button></Link>
                <Link href="/register"><Button className="bg-primary hover:bg-primary/90">إنشاء حساب مجاني</Button></Link>
              </div>
            </div>
          )}

          {stats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              {[
                { label: "منتج متاح", value: stats.available_products },
                { label: "وحدة في المخزون", value: stats.total_units },
                { label: "أقل سعر", value: stats.lowest_price ? formatCurrency(stats.lowest_price) : "—" },
                { label: "منتج إجمالي", value: stats.total_products },
              ].map((s) => (
                <div key={s.label} className="bg-card border border-border rounded-xl p-3 text-center">
                  <div className="text-xl font-black text-primary">{s.value}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-6">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="ابحث عن منتج..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pr-9"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map(c => (
              <button
                key={c.value}
                onClick={() => setCategory(c.value)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${category === c.value ? "bg-primary text-white" : "bg-secondary text-muted-foreground hover:text-foreground"}`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <select
              value={sort}
              onChange={e => setSort(e.target.value)}
              className="bg-secondary border border-border rounded-lg px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <button
              onClick={() => setAvailableOnly(v => !v)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${availableOnly ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-secondary text-muted-foreground hover:text-foreground"}`}
            >
              متوفر فقط
            </button>
          </div>
        </div>

        {/* Products Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="bg-card border border-border rounded-xl overflow-hidden animate-pulse">
                <div className="aspect-video bg-muted" />
                <div className="p-4 space-y-2">
                  <div className="h-4 bg-muted rounded w-3/4" />
                  <div className="h-3 bg-muted rounded w-full" />
                  <div className="h-3 bg-muted rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <TrendingUp className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">لا توجد منتجات تطابق بحثك</p>
            <p className="text-sm mt-1">جرب تغيير الفلتر أو كلمة البحث</p>
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
