import { useState, useEffect } from "react";
import { useListProducts, useGetCatalogStats, useGetFlashSale, useGetMe } from "@workspace/api-client-react";
import { getListProductsQueryKey, getGetCatalogStatsQueryKey, getGetFlashSaleQueryKey, getGetMeQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { ProductCard } from "@/components/ProductCard";
import { formatCurrency } from "@/lib/utils";
import {
  Search, Zap, Clock, Wallet, Star, PackageSearch,
  ChevronDown, Package, ShieldCheck, Truck, Headphones
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

const CATEGORIES = [
  { value: "",             label: "الكل",        emoji: "" },
  { value: "streaming",   label: "بث مباشر",     emoji: "🎬" },
  { value: "music",       label: "موسيقى",        emoji: "🎵" },
  { value: "gaming",      label: "ألعاب",          emoji: "🎮" },
  { value: "productivity",label: "إنتاجية",        emoji: "💼" },
];

const SORTS = [
  { value: "",          label: "الأحدث" },
  { value: "popular",   label: "الأكثر مبيعاً" },
  { value: "price_asc", label: "السعر: الأقل" },
  { value: "price_desc",label: "السعر: الأعلى" },
];

const TRUST_ITEMS = [
  { icon: Truck,       label: "تسليم فوري" },
  { icon: ShieldCheck, label: "دفع آمن" },
  { icon: Headphones,  label: "دعم مستمر" },
];

function ProductSkeleton() {
  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <div className="aspect-[4/3] bg-muted skeleton-shimmer" />
      <div className="p-4 space-y-2.5">
        <div className="flex justify-between gap-2">
          <div className="h-4 bg-muted skeleton-shimmer rounded-lg w-3/5" />
          <div className="h-4 bg-muted skeleton-shimmer rounded-full w-14" />
        </div>
        <div className="h-3 bg-muted skeleton-shimmer rounded w-full" />
        <div className="h-3 bg-muted skeleton-shimmer rounded w-4/5" />
        <div className="pt-3 mt-1 flex justify-between items-center border-t border-border/30">
          <div className="h-5 bg-muted skeleton-shimmer rounded w-20" />
          <div className="h-6 w-12 bg-muted skeleton-shimmer rounded-xl" />
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

  const params: Record<string, string> = {};
  if (search)        params.search = search;
  if (category)      params.category = category;
  if (sort)          params.sort = sort;
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
      setFlashUrgent(diff < 3600000);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [flashSale?.ends_at]);

  const activeFilterCount = [search, category, sort, availableOnly ? "1" : ""].filter(Boolean).length;

  return (
    <div className="min-h-screen">

      {/* ── Flash Sale Banner ─────────────────────────────── */}
      {flashSale && (
        <div className="relative overflow-hidden bg-gradient-to-l from-primary/20 via-primary/10 to-primary/5 border-b border-primary/20 py-2.5 px-4">
          <div className="absolute inset-0 flash-banner-glow opacity-60 pointer-events-none" />
          <div className="relative max-w-6xl mx-auto flex items-center gap-3 justify-between">
            <div className="flex items-center gap-2 shrink-0">
              <div className="w-6 h-6 rounded-lg bg-primary/20 border border-primary/30 flex items-center justify-center shrink-0">
                <Zap className="w-3.5 h-3.5 text-primary fill-current" />
              </div>
              <span className="text-xs font-black text-primary">عرض محدود</span>
            </div>
            <div className="flex-1 text-center text-sm font-bold text-foreground truncate px-3">
              {flashSale.title}
              <span className="text-primary font-black"> — {flashSale.discount_percent}% خصم</span>
            </div>
            <div className={`flex items-center gap-1 text-xs font-mono px-2.5 py-1 rounded-lg shrink-0 border transition-all ${
              flashUrgent ? "bg-primary/15 border-primary/40 text-primary" : "bg-card border-border text-muted-foreground"
            }`}>
              <Clock className="w-3 h-3" />
              <span className="font-black tabular-nums">{flashTimeLeft || "..."}</span>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto px-4 py-5 sm:py-8">

        {/* ── Hero ─────────────────────────────────────────── */}
        {token && user ? (
          /* Logged-in: compact personalized header */
          <div className="mb-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-muted-foreground text-sm mb-0.5">مرحباً بك</p>
                <h1 className="text-xl sm:text-2xl font-black leading-tight">اشترِ اشتراكك المفضل اليوم</h1>
              </div>
              <div className="flex gap-2">
                <Link href="/wallet">
                  <div className="bg-card border border-border hover:border-primary/35 rounded-xl px-4 py-3 flex items-center gap-2.5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary/8 cursor-pointer active:scale-[0.97] min-w-[120px]">
                    <div className="w-8 h-8 rounded-lg bg-primary/12 border border-primary/20 flex items-center justify-center shrink-0">
                      <Wallet className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <div className="text-[11px] text-muted-foreground leading-none mb-0.5">المحفظة</div>
                      <div className="font-black text-sm tabular-nums">{formatCurrency(user.wallet_balance ?? 0)}</div>
                    </div>
                  </div>
                </Link>
                <Link href="/loyalty">
                  <div className="bg-card border border-border hover:border-yellow-400/35 rounded-xl px-4 py-3 flex items-center gap-2.5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-yellow-400/8 cursor-pointer active:scale-[0.97]">
                    <div className="w-8 h-8 rounded-lg bg-yellow-400/12 border border-yellow-400/20 flex items-center justify-center shrink-0">
                      <Star className="w-4 h-4 text-yellow-400" />
                    </div>
                    <div>
                      <div className="text-[11px] text-muted-foreground leading-none mb-0.5">النقاط</div>
                      <div className="font-black text-sm tabular-nums">{user.loyalty_points ?? 0}</div>
                    </div>
                  </div>
                </Link>
              </div>
            </div>
          </div>
        ) : (
          /* Guest: editorial hero */
          <div className="relative overflow-hidden rounded-2xl border border-border/60 mb-7 bg-card">
            {/* Background texture */}
            <div className="absolute inset-0 bg-gradient-to-l from-primary/8 via-transparent to-transparent pointer-events-none" />
            <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-primary/60 via-primary/30 to-transparent rounded-r" />

            <div className="relative px-6 py-7 sm:px-8 sm:py-8">
              <div className="flex flex-wrap items-start justify-between gap-6">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-[11px] font-bold bg-primary/15 text-primary border border-primary/25 px-2.5 py-0.5 rounded-full">
                      ليبيا #1
                    </span>
                    <span className="text-[11px] text-muted-foreground">سوق الاشتراكات الرقمية</span>
                  </div>
                  <h1 className="text-2xl sm:text-3xl font-black mb-2 leading-tight tracking-tight">
                    اشتراكات رقمية
                    <br />
                    <span className="text-primary">بالدينار الليبي</span>
                  </h1>
                  <p className="text-muted-foreground text-sm leading-relaxed mb-5 max-w-sm">
                    Netflix · Spotify · Disney+ · PlayStation وأكثر — تسليم فوري، دفع آمن، دعم متواصل
                  </p>

                  {/* Trust pills */}
                  <div className="flex flex-wrap gap-2 mb-5">
                    {TRUST_ITEMS.map(item => (
                      <div key={item.label} className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/50 border border-border/60 px-2.5 py-1 rounded-full">
                        <item.icon className="w-3 h-3" />
                        {item.label}
                      </div>
                    ))}
                  </div>

                  <div className="flex gap-2.5 flex-wrap">
                    <Link href="/register">
                      <Button className="bg-primary hover:bg-primary/90 shadow-xl shadow-primary/20 active:scale-[0.97] h-11 px-6 font-bold transition-all">
                        إنشاء حساب مجاني
                      </Button>
                    </Link>
                    <Link href="/login">
                      <Button variant="outline" className="active:scale-[0.97] h-11 px-5 transition-all">
                        تسجيل الدخول
                      </Button>
                    </Link>
                  </div>
                </div>

                {/* Stats column — hide on small mobile */}
                {stats && (
                  <div className="hidden sm:flex flex-col gap-2 shrink-0">
                    {[
                      { label: "منتج متاح",      value: stats.available_products, color: "text-emerald-400" },
                      { label: "أقل سعر",         value: stats.lowest_price ? formatCurrency(stats.lowest_price) : "—", color: "text-primary" },
                      { label: "وحدة بالمخزون",  value: stats.total_units,        color: "text-blue-400" },
                    ].map(s => (
                      <div key={s.label} className="bg-muted/30 border border-border/50 rounded-xl px-4 py-2.5 text-right min-w-28">
                        <div className={`font-black text-lg leading-none mb-0.5 tabular-nums ${s.color}`}>{s.value}</div>
                        <div className="text-xs text-muted-foreground">{s.label}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Mobile stats strip (guest, small screen) ────── */}
        {!token && stats && (
          <div className="sm:hidden grid grid-cols-3 gap-2 mb-5">
            {[
              { label: "منتج",         value: stats.available_products, color: "text-emerald-400" },
              { label: "أقل سعر",     value: stats.lowest_price ? formatCurrency(stats.lowest_price) : "—", color: "text-primary" },
              { label: "بالمخزون",    value: stats.total_units,        color: "text-blue-400" },
            ].map(s => (
              <div key={s.label} className="bg-card border border-border/50 rounded-xl p-2.5 text-center">
                <div className={`font-black text-base leading-none mb-0.5 tabular-nums ${s.color}`}>{s.value}</div>
                <div className="text-[10px] text-muted-foreground">{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* ── Filters ──────────────────────────────────────── */}
        <div className="sticky top-14 z-30 -mx-4 px-4 py-3 bg-background/92 backdrop-blur-md border-b border-border/30 mb-5 sm:static sm:mx-0 sm:px-0 sm:py-0 sm:bg-transparent sm:backdrop-blur-none sm:border-0 sm:mb-6">

          {/* Search + Sort row */}
          <div className="flex gap-2 mb-2.5">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60 pointer-events-none" />
              <Input
                type="search"
                placeholder="ابحث عن اشتراك..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pr-9 h-10 text-sm bg-card border-border/60 focus:border-primary/50 transition-colors"
              />
            </div>
            <div className="relative shrink-0">
              <select
                value={sort}
                onChange={e => setSort(e.target.value)}
                className="h-10 appearance-none bg-card border border-border/60 rounded-lg pr-3 pl-7 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-primary/50 cursor-pointer transition-colors hover:border-border"
              >
                {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
              <ChevronDown className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            </div>
          </div>

          {/* Category chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none pb-0.5">
            {CATEGORIES.map(c => (
              <button
                key={c.value}
                onClick={() => setCategory(c.value)}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all duration-150 active:scale-[0.96] min-h-[36px] ${
                  category === c.value
                    ? "bg-primary text-white shadow-md shadow-primary/25 font-bold"
                    : "bg-card border border-border/60 text-muted-foreground hover:text-foreground hover:border-border"
                }`}
              >
                {c.emoji && <span className="text-[13px]">{c.emoji}</span>}
                {c.label}
              </button>
            ))}
            <button
              onClick={() => setAvailableOnly(v => !v)}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 min-h-[36px] rounded-xl text-sm font-medium whitespace-nowrap transition-all duration-150 active:scale-[0.96] ${
                availableOnly
                  ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-bold"
                  : "bg-card border border-border/60 text-muted-foreground hover:text-foreground hover:border-border"
              }`}
            >
              <Package className="w-3.5 h-3.5" />
              متوفر فقط
            </button>
          </div>
        </div>

        {/* ── Result header ────────────────────────────────── */}
        {!isLoading && (products.length > 0 || activeFilterCount > 0) && (
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-muted-foreground">
              {products.length} {products.length === 1 ? "منتج" : "منتجات"}
              {category && <span> في هذه الفئة</span>}
            </p>
            {activeFilterCount > 0 && (
              <button
                onClick={() => { setSearch(""); setCategory(""); setSort(""); setAvailableOnly(false); }}
                className="text-xs text-muted-foreground hover:text-primary transition-colors px-2 py-1 rounded-lg hover:bg-primary/8"
              >
                مسح الفلاتر ({activeFilterCount})
              </button>
            )}
          </div>
        )}

        {/* ── Products Grid ─────────────────────────────────── */}
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
            {Array.from({ length: 8 }).map((_, i) => <ProductSkeleton key={i} />)}
          </div>
        ) : products.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground bg-card border border-border/50 rounded-2xl">
            <div className="w-16 h-16 rounded-2xl bg-muted mx-auto mb-4 flex items-center justify-center">
              <PackageSearch className="w-7 h-7 opacity-40" />
            </div>
            <p className="font-bold text-base mb-1">لا توجد منتجات تطابق بحثك</p>
            <p className="text-sm text-muted-foreground/70 mb-5">جرب تغيير الفلتر أو كلمة البحث</p>
            {activeFilterCount > 0 && (
              <button
                onClick={() => { setSearch(""); setCategory(""); setSort(""); setAvailableOnly(false); }}
                className="text-sm font-bold text-primary border border-primary/25 px-4 py-2 rounded-xl hover:bg-primary/8 transition-colors"
              >
                مسح جميع الفلاتر
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
            {products.map(product => (
              <ProductCard key={product.id} product={product as any} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
