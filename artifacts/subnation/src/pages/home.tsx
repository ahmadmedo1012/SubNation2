import { useState, useEffect } from "react";
import { useListProducts, useGetCatalogStats, useGetFlashSale, useGetMe } from "@workspace/api-client-react";
import { getListProductsQueryKey, getGetCatalogStatsQueryKey, getGetFlashSaleQueryKey, getGetMeQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { ProductCard } from "@/components/ProductCard";
import { formatCurrency } from "@/lib/utils";
import {
  Search, Zap, Clock, Wallet, Star, PackageSearch,
  ChevronDown, Package, ShieldCheck, Truck, Headphones, ArrowLeft
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

const CATEGORIES = [
  { value: "",              label: "الكل",    emoji: "✦" },
  { value: "streaming",    label: "بث مباشر", emoji: "🎬" },
  { value: "music",        label: "موسيقى",   emoji: "🎵" },
  { value: "gaming",       label: "ألعاب",    emoji: "🎮" },
  { value: "productivity", label: "إنتاجية",  emoji: "💼" },
];

const SORTS = [
  { value: "",           label: "الأحدث" },
  { value: "popular",    label: "الأكثر مبيعاً" },
  { value: "price_asc",  label: "السعر: الأقل" },
  { value: "price_desc", label: "السعر: الأعلى" },
];

const TRUST_ITEMS = [
  { icon: Truck,       label: "تسليم فوري" },
  { icon: ShieldCheck, label: "دفع آمن" },
  { icon: Headphones,  label: "دعم مستمر" },
];

/* Brands that communicate what's sold in the store */
const BRANDS = ["Netflix", "Spotify", "Disney+", "PlayStation", "YouTube", "Canva", "Adobe", "Office 365"];

function ProductSkeleton() {
  return (
    <div className="bg-card border border-border/60 rounded-2xl overflow-hidden">
      <div className="h-[120px] sm:h-[130px] skeleton-shimmer" />
      <div className="p-3.5 space-y-2">
        <div className="flex justify-between gap-2">
          <div className="h-3.5 skeleton-shimmer rounded-lg w-3/5" />
          <div className="h-3.5 skeleton-shimmer rounded-full w-14" />
        </div>
        <div className="h-2.5 skeleton-shimmer rounded w-full" />
        <div className="h-2.5 skeleton-shimmer rounded w-4/5" />
        <div className="pt-2.5 mt-1 flex justify-between items-center border-t border-border/30">
          <div className="h-4 skeleton-shimmer rounded w-20" />
          <div className="h-5 w-10 skeleton-shimmer rounded-full" />
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
  const [flashTimeLeft, setFlashTimeLeft] = useState({ h: 0, m: 0, s: 0 });
  const [flashUrgent, setFlashUrgent] = useState(false);
  const [flashActive, setFlashActive] = useState(true);

  useEffect(() => {
    if (!flashSale) return;
    const update = () => {
      const diff = new Date(flashSale.ends_at).getTime() - Date.now();
      if (diff <= 0) { setFlashActive(false); return; }
      setFlashTimeLeft({
        h: Math.floor(diff / 3600000),
        m: Math.floor((diff % 3600000) / 60000),
        s: Math.floor((diff % 60000) / 1000),
      });
      setFlashUrgent(diff < 3600000);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [flashSale?.ends_at]);

  const activeFilterCount = [search, category, sort, availableOnly ? "1" : ""].filter(Boolean).length;

  return (
    <div className="min-h-screen">

      {/* ── Flash Sale Banner ──────────────────────────────── */}
      {flashSale && flashActive && (
        <div className={`relative overflow-hidden border-b py-2.5 px-4 transition-colors duration-500 ${
          flashUrgent
            ? "bg-gradient-to-l from-primary/22 via-primary/12 to-primary/5 border-primary/30"
            : "bg-gradient-to-l from-primary/14 via-primary/7 to-transparent border-primary/15"
        }`}>
          <div className="absolute inset-0 flash-banner-glow opacity-70 pointer-events-none" />
          <div className="relative max-w-6xl mx-auto flex items-center gap-3 justify-between">
            <div className="flex items-center gap-2 shrink-0">
              <div className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                flashUrgent ? "bg-primary text-white" : "bg-primary/20 border border-primary/30"
              }`}>
                <Zap className={`w-3 h-3 fill-current ${flashUrgent ? "text-white" : "text-primary"}`} />
              </div>
              <span className={`text-xs font-black ${flashUrgent ? "text-primary" : "text-primary/80"}`}>عرض محدود</span>
            </div>
            <div className="flex-1 text-center text-sm font-bold text-foreground/90 truncate px-2">
              {flashSale.title}
              <span className="text-primary font-black"> — {flashSale.discount_percent}% خصم</span>
            </div>
            {/* Countdown */}
            <div className={`flex items-center gap-1 shrink-0 ${flashUrgent ? "text-primary" : "text-muted-foreground"}`}>
              {[
                { val: flashTimeLeft.h, label: "س" },
                { val: flashTimeLeft.m, label: "د" },
                { val: flashTimeLeft.s, label: "ث" },
              ].map((seg, i) => (
                <div key={i} className="flex items-center gap-1">
                  {i > 0 && <span className="font-black opacity-40 text-xs">:</span>}
                  <div className={`flex flex-col items-center min-w-[26px] px-1 py-0.5 rounded-md border transition-colors ${
                    flashUrgent ? "bg-primary/15 border-primary/35" : "bg-card/60 border-border/60"
                  }`}>
                    <span className="font-black tabular-nums text-xs leading-tight">{String(seg.val).padStart(2, "0")}</span>
                    <span className="text-[7px] opacity-50 leading-none">{seg.label}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto px-4 py-5 sm:py-7">

        {/* ── Hero ─────────────────────────────────────────── */}
        {token && user ? (
          /* Logged-in: compact personalized header */
          <div className="mb-5 page-in">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-muted-foreground/70 text-sm mb-0.5">مرحباً بك مجدداً</p>
                <h1 className="text-fluid-2xl font-black leading-tight">اشترِ اشتراكك المفضل اليوم</h1>
              </div>
              <div className="flex gap-2">
                <Link href="/wallet">
                  <div className="bg-card border border-border/55 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/8 rounded-xl px-3.5 py-2.5 flex items-center gap-2.5 transition-all duration-220 card-spring cursor-pointer min-w-[120px]">
                    <div className="w-8 h-8 rounded-lg bg-primary/12 border border-primary/22 flex items-center justify-center shrink-0">
                      <Wallet className="w-3.5 h-3.5 text-primary" />
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground/70 leading-none mb-0.5">المحفظة</div>
                      <div className="font-black text-sm tabular-nums text-foreground">{formatCurrency(user.wallet_balance ?? 0)}</div>
                    </div>
                  </div>
                </Link>
                <Link href="/loyalty">
                  <div className="bg-card border border-border/55 hover:border-yellow-400/40 hover:shadow-lg hover:shadow-yellow-900/10 rounded-xl px-3.5 py-2.5 flex items-center gap-2.5 transition-all duration-220 card-spring cursor-pointer">
                    <div className="w-8 h-8 rounded-lg bg-yellow-400/10 border border-yellow-400/22 flex items-center justify-center shrink-0">
                      <Star className="w-3.5 h-3.5 text-yellow-400" />
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground/70 leading-none mb-0.5">النقاط</div>
                      <div className="font-black text-sm tabular-nums">{user.loyalty_points ?? 0}</div>
                    </div>
                  </div>
                </Link>
              </div>
            </div>
          </div>
        ) : (
          /* Guest: editorial hero */
          <div className="relative overflow-hidden rounded-2xl border border-border/45 mb-6 bg-card page-in">
            {/* Background layers */}
            <div className="absolute inset-0 dot-grid pointer-events-none opacity-70" />
            <div className="absolute inset-0 bg-gradient-to-l from-primary/9 via-transparent to-transparent pointer-events-none" />
            <div className="absolute right-0 top-0 bottom-0 w-[2px] bg-gradient-to-b from-primary/70 via-primary/30 to-transparent" />

            {/* Ambient glow blobs */}
            <div className="absolute top-[-40px] right-[10%] w-64 h-64 bg-primary/7 rounded-full blur-3xl pointer-events-none blob-drift" />
            <div className="absolute bottom-[-30px] left-[20%] w-48 h-48 bg-primary/4 rounded-full blur-3xl pointer-events-none blob-drift-slow" />

            <div className="relative px-5 py-6 sm:px-8 sm:py-9">
              <div className="flex flex-wrap items-start justify-between gap-5">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="inline-flex items-center gap-1 text-[10px] font-black bg-primary/15 text-primary border border-primary/28 px-2.5 py-0.5 rounded-full">
                      ليبيا #1
                    </span>
                    <span className="text-[11px] text-muted-foreground/70">سوق الاشتراكات الرقمية</span>
                  </div>
                  <h1 className="text-fluid-3xl font-black mb-2.5 leading-tight tracking-tight">
                    اشتراكات رقمية
                    <br />
                    <span className="text-gradient-animated">بالدينار الليبي</span>
                  </h1>
                  <p className="text-muted-foreground/80 text-sm leading-relaxed mb-4 max-w-sm">
                    تسليم فوري، دفع آمن، دعم متواصل. كل اشتراكاتك في مكان واحد.
                  </p>

                  {/* Brand chips */}
                  <div className="relative overflow-hidden mb-4">
                    <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none pb-0.5 scroll-fade-rtl-start">
                      {BRANDS.map((brand, i) => (
                        <span key={brand} className={`shrink-0 text-[11px] font-bold bg-muted/50 border border-border/45 text-muted-foreground/80 px-2.5 py-1 rounded-full whitespace-nowrap hover:border-border hover:text-muted-foreground transition-colors duration-150 float-in stagger-${Math.min(i + 1, 8)}`}>
                          {brand}
                        </span>
                      ))}
                      <span className="shrink-0 text-[11px] text-muted-foreground/40 px-1 whitespace-nowrap">وأكثر…</span>
                    </div>
                  </div>

                  {/* Trust pills */}
                  <div className="flex flex-wrap gap-2 mb-5">
                    {TRUST_ITEMS.map(item => (
                      <div key={item.label} className="flex items-center gap-1.5 text-xs text-muted-foreground/75 bg-muted/30 border border-border/35 px-2.5 py-1 rounded-full hover:bg-muted/50 transition-colors">
                        <item.icon className="w-3 h-3" />
                        {item.label}
                      </div>
                    ))}
                  </div>

                  <div className="flex gap-2.5 flex-wrap">
                    <Link href="/register">
                      <Button className="bg-primary hover:bg-primary/90 shadow-xl shadow-primary/25 active:scale-[0.97] h-11 px-7 font-bold transition-all cta-glow text-sm">
                        إنشاء حساب مجاني
                      </Button>
                    </Link>
                    <Link href="/login">
                      <Button variant="outline" className="active:scale-[0.97] h-11 px-4 transition-all text-sm gap-1.5 hover:bg-muted/50">
                        تسجيل الدخول
                        <ArrowLeft className="w-3.5 h-3.5 opacity-45" />
                      </Button>
                    </Link>
                  </div>
                </div>

                {/* Stats column — desktop only */}
                {stats && (
                  <div className="hidden sm:flex flex-col gap-2 shrink-0">
                    {[
                      { label: "منتج متاح",     value: stats.available_products,                                      color: "text-emerald-400", border: "border-emerald-500/18", bg: "bg-emerald-500/7" },
                      { label: "أقل سعر",        value: stats.lowest_price ? formatCurrency(stats.lowest_price) : "—", color: "text-primary",      border: "border-primary/18",    bg: "bg-primary/7"    },
                      { label: "وحدة بالمخزون", value: stats.total_units,                                             color: "text-blue-400",    border: "border-blue-500/18",   bg: "bg-blue-500/7"   },
                    ].map((s, i) => (
                      <div key={s.label} className={`${s.bg} border ${s.border} rounded-xl px-4 py-3 text-right min-w-[112px] float-in stagger-${i + 1} hover:brightness-110 transition-all duration-200`}>
                        <div className={`font-black text-2xl leading-none mb-1 tabular-nums num-pop ${s.color}`}>{s.value}</div>
                        <div className="text-xs text-muted-foreground/70">{s.label}</div>
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
              { label: "منتج",        value: stats.available_products, color: "text-emerald-400" },
              { label: "أقل سعر",    value: stats.lowest_price ? formatCurrency(stats.lowest_price) : "—", color: "text-primary" },
              { label: "بالمخزون",   value: stats.total_units,        color: "text-blue-400" },
            ].map(s => (
              <div key={s.label} className="bg-card border border-border/50 rounded-xl p-2.5 text-center">
                <div className={`font-black text-base leading-none mb-0.5 tabular-nums ${s.color}`}>{s.value}</div>
                <div className="text-[10px] text-muted-foreground">{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* ── Filters ──────────────────────────────────────── */}
        <div className="sticky top-14 z-30 -mx-4 px-4 py-3 bg-background/95 backdrop-blur-xl border-b border-border/20 mb-5 sm:static sm:mx-0 sm:px-0 sm:py-0 sm:bg-transparent sm:backdrop-blur-none sm:border-0 sm:mb-6">

          {/* Search + Sort */}
          <div className="flex gap-2 mb-2.5">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50 pointer-events-none" />
              <Input
                type="search"
                placeholder="ابحث عن اشتراك..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pr-9 h-10 text-sm bg-card border-border/55 focus:border-primary/50 transition-all duration-150"
              />
            </div>
            <div className="relative shrink-0">
              <select
                value={sort}
                onChange={e => setSort(e.target.value)}
                className="h-10 appearance-none bg-card border border-border/55 rounded-lg pr-3 pl-7 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-primary/50 cursor-pointer transition-colors hover:border-border"
              >
                {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
              <ChevronDown className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            </div>
          </div>

          {/* Category chips — scrollable with fade edges */}
          <div className="relative overflow-hidden">
            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none pb-0.5 scroll-fade-rtl">
              {CATEGORIES.map(c => {
                const active = category === c.value;
                return (
                  <button
                    key={c.value}
                    onClick={() => setCategory(c.value)}
                    className={`
                      flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium whitespace-nowrap
                      transition-all duration-150 press-spring min-h-[36px] shrink-0
                      ${active
                        ? "bg-primary text-white shadow-md shadow-primary/25 font-bold"
                        : "bg-card border border-border/55 text-muted-foreground hover:text-foreground hover:border-border"
                      }
                    `}
                  >
                    <span className="text-[12px]">{c.emoji}</span>
                    {c.label}
                  </button>
                );
              })}
              <button
                onClick={() => setAvailableOnly(v => !v)}
                className={`flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] shrink-0 rounded-xl text-sm font-medium whitespace-nowrap transition-all duration-150 press-spring ${
                  availableOnly
                    ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-bold"
                    : "bg-card border border-border/55 text-muted-foreground hover:text-foreground hover:border-border"
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
              <span className="font-bold text-foreground">{products.length}</span>{" "}
              {products.length === 1 ? "منتج" : "منتج"}
              {category && <span className="text-muted-foreground/65"> في هذه الفئة</span>}
            </p>
            {activeFilterCount > 0 && (
              <button
                onClick={() => { setSearch(""); setCategory(""); setSort(""); setAvailableOnly(false); }}
                className="text-xs text-muted-foreground hover:text-primary transition-colors px-2.5 py-1 rounded-lg hover:bg-primary/8 press-spring"
              >
                مسح ({activeFilterCount})
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
          <div className="text-center py-16 text-muted-foreground bg-card border border-border/50 rounded-2xl float-in">
            <div className="w-14 h-14 rounded-2xl bg-muted mx-auto mb-4 flex items-center justify-center">
              <PackageSearch className="w-6 h-6 opacity-30" />
            </div>
            <p className="font-bold text-base mb-1">لا توجد منتجات تطابق بحثك</p>
            <p className="text-sm text-muted-foreground/60 mb-5">جرب تغيير الفلتر أو كلمة البحث</p>
            {activeFilterCount > 0 && (
              <button
                onClick={() => { setSearch(""); setCategory(""); setSort(""); setAvailableOnly(false); }}
                className="text-sm font-bold text-primary border border-primary/25 px-5 py-2 rounded-xl hover:bg-primary/8 transition-colors press-spring"
              >
                مسح جميع الفلاتر
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
            {products.map((product, i) => (
              <ProductCard key={product.id} product={product as any} index={i} />
            ))}
          </div>
        )}

        {/* ── Trust footer — shown when products are visible ─ */}
        {!isLoading && products.length > 0 && (
          <div className="mt-10 pt-8 border-t border-border/30">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                {
                  icon: Zap,
                  color: "text-yellow-400",
                  bg: "bg-yellow-400/8 border-yellow-400/15",
                  title: "تسليم فوري",
                  desc: "تصلك بيانات الاشتراك فور تأكيد الدفع مباشرة"
                },
                {
                  icon: ShieldCheck,
                  color: "text-emerald-400",
                  bg: "bg-emerald-400/8 border-emerald-400/15",
                  title: "دفع آمن",
                  desc: "محفظتك محمية بالكامل وجميع معاملاتك موثقة"
                },
                {
                  icon: Headphones,
                  color: "text-blue-400",
                  bg: "bg-blue-400/8 border-blue-400/15",
                  title: "دعم 24/7",
                  desc: "فريقنا متاح دائماً لمساعدتك في أي وقت"
                },
              ].map(item => (
                <div key={item.title} className={`flex items-start gap-3 p-4 rounded-2xl border ${item.bg}`}>
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 bg-background/40`}>
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

      </div>
    </div>
  );
}
