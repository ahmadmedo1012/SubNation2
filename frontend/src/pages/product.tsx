import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSeo } from "@/hooks/useSeo";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
import { buildBreadcrumbLd, buildFaqLd, buildProductLd } from "@/lib/seo-builders";
import { categoryLabel, formatCurrency } from "@/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getGetMeQueryKey,
  getGetProductQueryKey,
  getGetProductRecommendationsQueryKey,
  type Product,
  type User,
  useCreateOrder,
  useGetMe,
  useGetProduct,
  useGetProductRecommendations,
} from "@workspace/api-client-react";
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle,
  Copy,
  Headphones,
  Info,
  Loader2,
  Lock,
  Package,
  ShieldCheck,
  ShoppingCart,
  Tag,
  Truck,
  Wallet,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useParams } from "wouter";

const CATEGORY_GRADIENTS: Record<string, string> = {
  streaming: "from-violet-950 via-violet-900/60 to-violet-800/20",
  music: "from-emerald-950 via-emerald-900/60 to-emerald-800/20",
  gaming: "from-blue-950 via-blue-900/60 to-blue-800/20",
  productivity: "from-amber-950 via-amber-900/60 to-amber-800/20",
};

/**
 * Categories that have a dedicated landing page at /category/<slug>.
 * The breadcrumb middle segment links to the category page only when
 * the product's category is in this set; unknown categories fall back
 * to "/" so the breadcrumb never produces a broken link.
 */
const KNOWN_CATEGORIES = new Set(["streaming", "music", "gaming", "productivity"]);

const CATEGORY_INITIAL_COLOR: Record<string, string> = {
  streaming: "text-violet-300",
  music: "text-emerald-300",
  gaming: "text-blue-300",
  productivity: "text-amber-300",
};

const TRUST_SIGNALS = [
  { icon: Truck, label: "تسليم فوري", desc: "حصل عليه فور الدفع" },
  { icon: ShieldCheck, label: "دفع آمن", desc: "من محفظتك المشحونة" },
  { icon: Headphones, label: "دعم متاح", desc: "تواصل معنا أي وقت" },
];

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <span className="text-sm text-muted-foreground shrink-0">{label}</span>
      <button
        onClick={handleCopy}
        className={`flex items-center gap-2 font-mono font-bold text-sm transition-all duration-200 active:scale-95 group ${
          copied ? "text-emerald-400" : "text-foreground hover:text-primary"
        }`}
      >
        <span className="max-w-[160px] truncate">{value}</span>
        <div
          className={`w-5 h-5 rounded-md flex items-center justify-center transition-all duration-200 ${
            copied
              ? "bg-emerald-500/15 text-emerald-400"
              : "bg-muted/60 text-muted-foreground group-hover:bg-primary/12 group-hover:text-primary"
          }`}
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
        </div>
      </button>
    </div>
  );
}

export default function ProductPage() {
  const { slug } = useParams<{ slug: string }>();
  const [, navigate] = useLocation();
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [orderResult, setOrderResult] = useState<any>(null);
  const [error, setError] = useState("");
  const [couponInput, setCouponInput] = useState("");
  const [couponValidating, setCouponValidating] = useState(false);
  const [couponResult, setCouponResult] = useState<null | {
    code: string;
    discount_amount: number;
    final_amount: number;
    type: string;
    value: number;
    description: string | null;
  }>(null);
  const [couponError, setCouponError] = useState("");

  // ── Slug-or-id routing ─────────────────────────────────────────────
  // The route `/product/:slug` accepts both:
  //   - numeric id (legacy URLs, bookmarks, sitemap entries from before
  //     the slug migration ran — fetched by id, then transparently
  //     redirected to the canonical slug URL for SEO)
  //   - URL-safe slug (post-migration canonical form)
  //
  // We detect "numeric" with a strict regex: `/^\d+$/` rather than
  // `parseInt`, because parseInt("12-foo") = 12 which would mismatch
  // a slug that happens to start with digits ("12-month-plan").
  const param = slug ?? "";
  const isLegacyNumeric = /^\d+$/.test(param);
  const numericId = isLegacyNumeric ? parseInt(param, 10) : 0;

  // Path 1: numeric id (legacy). Use the typed orval client.
  const byIdQuery = useGetProduct(numericId, {
    query: {
      queryKey: getGetProductQueryKey(numericId),
      enabled: isLegacyNumeric && numericId > 0,
    },
  });

  // Path 2: slug (canonical). Raw fetch — the new /api/products/by-slug/:slug
  // endpoint isn't in the orval-generated client yet, but the response shape
  // is byte-for-byte identical to the by-id response, so the rest of this
  // page's render code is fully shape-agnostic.
  const bySlugQuery = useQuery({
    queryKey: ["product-by-slug", param],
    enabled: !isLegacyNumeric && !!param,
    queryFn: async () => {
      const res = await fetch(`/api/products/by-slug/${encodeURIComponent(param)}`, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (res.status === 404) {
        const err = new Error("not_found") as Error & { status: number };
        err.status = 404;
        throw err;
      }
      if (!res.ok) throw new Error(`Product fetch failed: ${res.status}`);
      return res.json();
    },
    retry: false,
  });

  const product = (isLegacyNumeric ? byIdQuery.data : bySlugQuery.data) as
    | (typeof byIdQuery.data & { slug?: string | null })
    | undefined;
  const isLoading = isLegacyNumeric ? byIdQuery.isLoading : bySlugQuery.isLoading;

  // After a numeric-id fetch resolves and the product carries a slug,
  // rewrite the URL to the canonical slug form via history.replaceState.
  // We DON'T navigate via wouter — that would unmount the component
  // and refetch. replaceState updates the bar without a route change.
  useEffect(() => {
    if (!isLegacyNumeric) return;
    const productSlug = (byIdQuery.data as { slug?: string | null } | undefined)?.slug;
    if (productSlug && typeof window !== "undefined") {
      window.history.replaceState(null, "", `/product/${productSlug}`);
    }
  }, [isLegacyNumeric, byIdQuery.data]);

  const { data: user } = useGetMe({
    query: { enabled: !!token, retry: false, queryKey: getGetMeQueryKey() },
    request: { headers: { Authorization: token ? `Bearer ${token}` : "" } },
  });

  const createOrderMutation = useCreateOrder({
    request: { headers: { Authorization: token ? `Bearer ${token}` : "" } },
    mutation: {
      onSuccess(data) {
        setOrderResult(data);
        queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      },
      onError(err: unknown) {
        setError(getErrorMessage(err));
      },
    },
  });

  const validateCoupon = async () => {
    if (!couponInput.trim() || !product) return;
    setCouponValidating(true);
    setCouponError("");
    setCouponResult(null);
    try {
      const basePrice = product.sale_price ?? product.price;
      const r = await fetch("/api/coupons/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ code: couponInput.trim().toUpperCase(), order_amount: basePrice }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setCouponResult(data);
    } catch (err: unknown) {
      // Persist the error inline (visible until the user types a new
      // code) AND fire a toast for the immediate "something happened"
      // cue. Inline-only would be invisible if the user looked away;
      // toast-only would disappear in 4s before the user could read it.
      const message = err instanceof Error ? err.message : "فشل التحقق من الكوبون";
      setCouponError(message);
      toast({
        title: "تعذّر تطبيق الكوبون",
        description: message,
        variant: "destructive",
      });
    } finally {
      setCouponValidating(false);
    }
  };

  const clearCoupon = () => {
    setCouponInput("");
    setCouponResult(null);
    setCouponError("");
  };

  const copyField = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => toast({ title: `تم نسخ ${label}` }));
  };

  // SEO — called unconditionally (before the loading/not-found early
  // returns below) so hook order is stable across renders (rules-of-hooks).
  // Falls back to neutral metadata while the product is still loading.
  const seoPrice = product ? (product.sale_price ?? product.price) : 0;
  // Only emit FAQPage JSON-LD when there's a non-empty curated FAQ list
  // on the product. Empty arrays are treated by Google as a thin
  // structured-data block.
  const productAny = product as
    | (typeof product & {
        description_long?: string | null;
        faq?: { question: string; answer: string }[] | null;
      })
    | undefined;
  const productFaqs =
    Array.isArray(productAny?.faq) && productAny!.faq!.length > 0 ? productAny!.faq! : null;
  const seoBlock = useSeo(
    product
      ? {
          title: `${product.name} — ${formatCurrency(seoPrice)}`,
          description: (
            product.description ??
            `${product.name} متوفر بالدينار الليبي على SubNation. تسليم فوري بعد الدفع.`
          ).slice(0, 160),
          image: product.image_url ?? undefined,
          type: "product",
          path: `/product/${product.slug ?? product.id}`,
          locale: "ar",
          jsonLd: [
            buildProductLd({
              id: product.id,
              slug: product.slug,
              name: product.name,
              description: product.description,
              descriptionLong: productAny?.description_long ?? null,
              imageUrl: product.image_url,
              price: seoPrice,
              category: product.category,
              isActive: product.is_active ?? true,
            }),
            buildBreadcrumbLd([
              { name: "الرئيسية", href: "/" },
              {
                name: categoryLabel(product.category ?? "") || "المنتجات",
                href:
                  product.category && KNOWN_CATEGORIES.has(product.category)
                    ? `/category/${product.category}`
                    : "/",
              },
              { name: product.name, href: `/product/${product.slug ?? product.id}` },
            ]),
            ...(productFaqs ? [buildFaqLd(productFaqs)] : []),
          ],
        }
      : {
          title: "SubNation",
          description: "اشتراكات رقمية بالدينار الليبي.",
          path: "/",
          locale: "ar",
        },
  );

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (isLoading)
    return (
      <div className="max-w-xl mx-auto px-4 py-8 sm:py-10">
        <div className="h-4 bg-muted skeleton-shimmer rounded w-28 mb-6" />
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="aspect-[16/9] skeleton-shimmer" />
          <div className="p-6 space-y-4">
            <div className="h-7 bg-muted skeleton-shimmer rounded-lg w-3/5" />
            <div className="space-y-2">
              <div className="h-3.5 bg-muted skeleton-shimmer rounded w-full" />
              <div className="h-3.5 bg-muted skeleton-shimmer rounded w-4/5" />
            </div>
            <div className="h-20 bg-muted skeleton-shimmer rounded-xl" />
            <div className="h-12 bg-muted skeleton-shimmer rounded-xl" />
          </div>
        </div>
      </div>
    );

  if (!product)
    return (
      <div className="max-w-xl mx-auto px-4 py-20 text-center text-muted-foreground">
        <div className="w-16 h-16 rounded-2xl bg-muted mx-auto mb-4 flex items-center justify-center">
          <Package className="w-7 h-7 opacity-40" />
        </div>
        <p className="font-bold mb-1">المنتج غير موجود</p>
        <button
          onClick={() => navigate("/")}
          className="text-sm text-primary hover:underline mt-2 press-spring"
        >
          العودة للكتالوج
        </button>
      </div>
    );

  const displayPrice = product.sale_price ?? product.price;
  const gradientClass =
    CATEGORY_GRADIENTS[product.category ?? "streaming"] ??
    "from-primary/20 via-primary/8 to-transparent";
  const initialColorClass = CATEGORY_INITIAL_COLOR[product.category ?? ""] ?? "text-white/30";

  // ── Order success ─────────────────────────────────────────────────────────
  if (orderResult) {
    return (
      <div className="max-w-xl mx-auto px-4 py-8 sm:py-10">
        <div className="bg-card border border-emerald-500/20 rounded-2xl overflow-hidden float-in">
          {/* Success header */}
          <div className="p-6 text-center border-b border-border/40 bg-gradient-to-b from-emerald-500/8 to-transparent">
            {/* Animated ring */}
            <div className="relative w-20 h-20 mx-auto mb-4">
              <div className="absolute inset-0 rounded-full bg-emerald-500/15 success-ring" />
              <div className="absolute inset-0 rounded-full bg-emerald-500/8" />
              <div className="w-full h-full bg-emerald-500/15 rounded-full flex items-center justify-center ring-4 ring-emerald-500/12">
                <CheckCircle className="w-9 h-9 text-emerald-400" />
              </div>
            </div>
            <h2 className="text-xl font-black mb-1.5">تم الشراء بنجاح!</h2>
            <p className="text-muted-foreground text-sm">
              رقم الطلب:{" "}
              <button
                onClick={() => copyField(orderResult.order_code, "رقم الطلب")}
                className="font-mono font-bold text-foreground hover:text-primary transition-colors inline-flex items-center gap-1 press-spring"
              >
                {orderResult.order_code}
                <Copy className="w-3 h-3 opacity-60" />
              </button>
            </p>
          </div>

          <div className="p-5 space-y-4">
            {/* Credentials box */}
            {(orderResult.delivered_email || orderResult.delivered_password) && (
              <div className="bg-muted/20 border border-border/50 rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 border-b border-border/30 bg-muted/20 flex items-center gap-2">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    بيانات الحساب
                  </h3>
                </div>
                <div className="divide-y divide-border/25">
                  {orderResult.delivered_email && (
                    <CopyField label="البريد الإلكتروني" value={orderResult.delivered_email} />
                  )}
                  {orderResult.delivered_password && (
                    <CopyField label="كلمة المرور" value={orderResult.delivered_password} />
                  )}
                </div>
              </div>
            )}

            {orderResult.delivered_extra_details && (
              <div className="bg-muted/15 border border-border/40 rounded-xl px-4 py-3 text-sm text-muted-foreground leading-relaxed">
                {orderResult.delivered_extra_details}
              </div>
            )}

            {orderResult.delivered_usage_terms && (
              <div className="flex gap-2.5 text-sm bg-yellow-500/8 border border-yellow-500/20 rounded-xl p-3.5">
                <Info className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
                <span className="text-yellow-400 leading-relaxed">
                  {orderResult.delivered_usage_terms}
                </span>
              </div>
            )}

            <div className="flex gap-2.5 pt-1">
              <Button
                onClick={() => navigate("/orders")}
                className="flex-1 h-11 press-spring bg-primary hover:bg-primary/90 shadow-md shadow-primary/20"
              >
                <ShoppingCart className="w-4 h-4 ml-1.5" />
                عرض طلباتي
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setOrderResult(null);
                  setError("");
                }}
                className="flex-1 h-11 press-spring"
              >
                شراء مجدداً
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Product page ──────────────────────────────────────────────────────────
  const mobileContentPad = token ? "mobile-product-pad-auth" : "mobile-product-pad-guest";

  return (
    <div className={`max-w-xl mx-auto px-4 py-6 sm:py-8 sm:pb-8 ${mobileContentPad}`}>
      {seoBlock}
      {/* Back link */}
      <button
        onClick={() => navigate("/")}
        className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground text-sm mb-5 transition-colors press-spring group"
      >
        <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform duration-150" />
        العودة للكتالوج
      </button>

      <div className="bg-card border border-border/55 rounded-2xl overflow-hidden float-in shadow-xl shadow-black/15">
        {/* Image */}
        <div
          className={`aspect-[16/9] bg-gradient-to-b ${gradientClass} flex items-center justify-center relative overflow-hidden group/img`}
        >
          {/* Ambient inner glow */}
          <div className="absolute inset-0 bg-gradient-to-l from-transparent via-transparent to-black/20 pointer-events-none" />

          {product.image_url ? (
            <img
              src={product.image_url}
              alt={(() => {
                const name = (product.name ?? "").trim();
                const cat = categoryLabel(product.category);
                if (!name) return cat ? `اشتراك ${cat}` : "اشتراك رقمي";
                const hasSub = /اشتراك/.test(name);
                return cat && cat !== "عام"
                  ? `${name} — ${hasSub ? "" : "اشتراك "}${cat}`.trim()
                  : name;
              })()}
              width={800}
              height={800}
              fetchPriority="high"
              decoding="async"
              className="w-full h-full object-contain p-6 sm:p-8 transition-transform duration-500 ease-out group-hover/img:scale-[1.04] drop-shadow-2xl"
            />
          ) : (
            <div className="flex items-center justify-center w-24 h-24 sm:w-28 sm:h-28 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-sm shadow-lg">
              <span
                className={`text-5xl sm:text-6xl font-black select-none drop-shadow-lg ${initialColorClass}`}
              >
                {product.name[0]}
              </span>
            </div>
          )}

          {/* Top badges */}
          <div className="absolute top-3 right-3 bg-black/55 backdrop-blur-sm text-white/85 text-[11px] font-bold px-2.5 py-1 rounded-full border border-white/8">
            {categoryLabel(product.category)}
          </div>
          {product.discount_percent && (
            <div className="absolute top-3 left-3 flex items-center gap-1 bg-primary text-white text-xs font-black px-2.5 py-1 rounded-full shadow-lg shadow-primary/40">
              <Tag className="w-3 h-3" />
              خصم {product.discount_percent}%
            </div>
          )}

          {/* Fade into card body */}
          <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-card to-transparent" />
        </div>

        <div className="p-5 space-y-4">
          {/* Title */}
          <div>
            <h1 className="text-fluid-2xl font-black mb-1.5 leading-tight tracking-tight">
              {product.name}
            </h1>
            {product.description && (
              <p className="text-muted-foreground leading-relaxed text-sm">{product.description}</p>
            )}
          </div>

          {/* Long-form description (Phase 2 SEO content) — rendered ONLY
              when an editor has provided one. Mirrors the value embedded
              in the Product JSON-LD so on-page text matches the
              structured data Google ingests. */}
          {productAny?.description_long && (
            <div className="rounded-xl border border-border/45 bg-muted/15 p-4 text-sm text-foreground/85 leading-relaxed whitespace-pre-line">
              {productAny.description_long}
            </div>
          )}

          {/* Price + stock */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 p-4 bg-muted/20 border border-border/45 rounded-xl">
            <div className="flex-1">
              <div className="text-3xl font-black text-primary leading-none tabular-nums">
                {formatCurrency(displayPrice)}
              </div>
              {product.sale_price && (
                <div className="text-muted-foreground text-sm line-through mt-1.5 tabular-nums">
                  {formatCurrency(product.price)}
                </div>
              )}
            </div>
            <div
              role="status"
              aria-live="polite"
              aria-label={
                product.is_available ? `المنتج متوفر، الكمية ${product.stock_count}` : "نفد المخزون"
              }
              className={`flex items-center gap-1.5 self-start text-sm font-bold px-3 py-2 rounded-xl border ${
                product.is_available
                  ? "bg-emerald-500/10 border-emerald-500/22 text-emerald-400"
                  : "bg-muted/50 border-border/50 text-muted-foreground"
              }`}
            >
              {product.is_available ? (
                <>
                  <CheckCircle className="w-3.5 h-3.5" aria-hidden="true" /> متوفر (
                  {product.stock_count})
                </>
              ) : (
                <>
                  <Lock className="w-3.5 h-3.5" aria-hidden="true" /> نفد المخزون
                </>
              )}
            </div>
          </div>

          {/* Usage terms */}
          {product.usage_terms && (
            <div className="flex gap-2.5 text-sm text-yellow-400 bg-yellow-500/8 border border-yellow-500/20 rounded-xl p-3.5">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="leading-relaxed">{product.usage_terms}</span>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/8 border border-destructive/20 px-4 py-3 rounded-xl shake">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Trust signals */}
          <div className="grid grid-cols-3 gap-2">
            {TRUST_SIGNALS.map((item) => (
              <div
                key={item.label}
                className="flex flex-col items-center gap-1 p-2.5 bg-muted/15 border border-border/35 rounded-xl text-center transition-colors hover:bg-muted/25 hover:border-border/55"
              >
                <item.icon className="w-4 h-4 text-muted-foreground mb-0.5" />
                <span className="text-[11px] font-bold text-foreground leading-tight">
                  {item.label}
                </span>
                <span className="text-[10px] text-muted-foreground leading-tight">{item.desc}</span>
              </div>
            ))}
          </div>

          {/* FAQ accordion (Phase 2 SEO content). Renders only when the
              product carries curated FAQ entries. The visible text mirrors
              the FAQPage JSON-LD emitted by useSeo() above — Google
              specifically requires the on-page accordion to match the
              structured data for FAQ rich results to trigger. */}
          {productFaqs && (
            <details className="rounded-xl border border-border/45 bg-muted/10 overflow-hidden group">
              <summary className="flex items-center justify-between px-4 py-3 text-sm font-bold cursor-pointer select-none hover:bg-muted/20 transition-colors">
                <span>الأسئلة الشائعة</span>
                <span className="text-xs text-muted-foreground">{productFaqs.length}</span>
              </summary>
              <div className="border-t border-border/30 divide-y divide-border/30">
                {productFaqs.map((faq, idx) => (
                  <details key={idx} className="group/q">
                    <summary className="flex items-start gap-2 px-4 py-3 text-sm font-bold text-foreground cursor-pointer select-none hover:bg-muted/15 transition-colors">
                      <span className="text-muted-foreground shrink-0">س{idx + 1}.</span>
                      <span className="flex-1">{faq.question}</span>
                    </summary>
                    <div className="px-4 pb-3 pt-1 text-sm text-muted-foreground leading-relaxed">
                      {faq.answer}
                    </div>
                  </details>
                ))}
              </div>
            </details>
          )}

          {/* Mobile coupon entry stays in the scrollable content; the sticky bar remains thumb-sized. */}
          {token && (
            <div className="sm:hidden rounded-xl border border-border/45 bg-muted/10 p-3">
              <CouponField
                token={token}
                couponInput={couponInput}
                couponResult={couponResult}
                couponError={couponError}
                couponValidating={couponValidating}
                onCouponChange={setCouponInput}
                onCouponValidate={validateCoupon}
                onCouponClear={clearCoupon}
              />
            </div>
          )}

          {/* CTA — desktop only (mobile uses sticky bar) */}
          <div className="hidden sm:block">
            <CtaBlock
              token={token}
              product={product}
              user={user}
              displayPrice={couponResult ? couponResult.final_amount : displayPrice}
              canAfford={
                !!(
                  user &&
                  (user.wallet_balance ?? 0) >=
                    (couponResult ? couponResult.final_amount : displayPrice)
                )
              }
              shortfall={
                (couponResult ? couponResult.final_amount : displayPrice) -
                (user?.wallet_balance ?? 0)
              }
              isPending={createOrderMutation.isPending}
              onBuy={() => {
                setError("");
                createOrderMutation.mutate({
                  data: { product_id: product.id, coupon_code: couponResult?.code } as {
                    product_id: number;
                    coupon_code?: string;
                  },
                });
              }}
              onLogin={() =>
                // Pass buy-intent context so /login can render the
                // "complete your purchase of X" banner instead of the
                // cold generic prompt. See login.tsx readLoginIntent().
                navigate(
                  `/login?intent=buy&product=${encodeURIComponent(product.name).slice(0, 200)}`,
                )
              }
              onWallet={() =>
                // Pass the current product as the return target so the
                // user lands back here after a successful top-up — without
                // this, every wallet-detoured purchase forces the user to
                // navigate manually back. WalletPage captures the param
                // and TopupWaitingModal honors it on the approved-state
                // dismiss.
                navigate(
                  `/wallet?return=${encodeURIComponent(`/product/${product.slug ?? product.id}`)}`,
                )
              }
              couponInput={couponInput}
              couponResult={couponResult}
              couponError={couponError}
              couponValidating={couponValidating}
              onCouponChange={setCouponInput}
              onCouponValidate={validateCoupon}
              onCouponClear={clearCoupon}
            />
          </div>
        </div>
      </div>

      {/* Recommendations Section. Pass the resolved product id from
          either fetch path — `numericId` is 0 when the URL is a slug,
          so we MUST use product.id which is filled by both branches. */}
      <RecommendationsSection numericId={product.id} />

      {/* ── Sticky mobile buy bar ─────────────────────────── */}
      <div
        className={`sm:hidden fixed left-0 right-0 z-[45] bg-card/97 backdrop-blur-xl border-t border-border/50 px-4 pt-3 shadow-2xl shadow-black/30 ${
          token ? "mobile-sticky-above-nav pb-3" : "mobile-sticky-bottom-safe"
        }`}
      >
        <CtaBlock
          token={token}
          product={product}
          user={user}
          displayPrice={couponResult ? couponResult.final_amount : displayPrice}
          canAfford={
            !!(
              user &&
              (user.wallet_balance ?? 0) >=
                (couponResult ? couponResult.final_amount : displayPrice)
            )
          }
          shortfall={
            (couponResult ? couponResult.final_amount : displayPrice) - (user?.wallet_balance ?? 0)
          }
          isPending={createOrderMutation.isPending}
          onBuy={() => {
            setError("");
            createOrderMutation.mutate({
              data: { product_id: product.id, coupon_code: couponResult?.code } as {
                product_id: number;
                coupon_code?: string;
              },
            });
          }}
          onLogin={() => navigate("/login")}
          onWallet={() => navigate("/wallet")}
          couponInput={couponInput}
          couponResult={couponResult}
          couponError={couponError}
          couponValidating={couponValidating}
          onCouponChange={setCouponInput}
          onCouponValidate={validateCoupon}
          onCouponClear={clearCoupon}
          compact
        />
      </div>
    </div>
  );
}

interface CouponResult {
  code: string;
  discount_amount: number;
  final_amount: number;
  type: string;
  value: number;
  description: string | null;
}

function CouponField({
  couponInput,
  couponResult,
  couponError,
  couponValidating,
  token,
  onCouponChange,
  onCouponValidate,
  onCouponClear,
}: {
  couponInput: string;
  couponResult: CouponResult | null;
  couponError: string;
  couponValidating: boolean;
  token: string | null;
  onCouponChange: (v: string) => void;
  onCouponValidate: () => void;
  onCouponClear: () => void;
}) {
  if (!token) return null;
  return (
    <div className="space-y-1.5">
      {/* Input row */}
      <div className="flex gap-1.5">
        <div className="relative flex-1">
          <Tag className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={couponInput}
            onChange={(e) => {
              onCouponChange(e.target.value.toUpperCase());
              if (couponResult) onCouponClear();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !couponResult) onCouponValidate();
            }}
            placeholder="رمز الكوبون"
            className="pr-9 h-9 text-sm font-mono uppercase placeholder:normal-case placeholder:font-sans"
            disabled={!!couponResult}
          />
        </div>
        {couponResult ? (
          <button
            onClick={onCouponClear}
            className="h-9 px-3 rounded-lg border border-border/60 text-xs text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-all press-spring"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        ) : (
          <button
            onClick={onCouponValidate}
            disabled={!couponInput.trim() || couponValidating}
            className="h-9 px-3 rounded-lg bg-muted/50 border border-border/60 text-xs font-bold hover:bg-muted hover:border-border transition-all press-spring disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {couponValidating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "تحقق"}
          </button>
        )}
      </div>

      {/* Error */}
      {couponError && (
        <div className="flex items-center gap-1.5 text-xs text-destructive bg-destructive/8 border border-destructive/20 rounded-lg px-3 py-2">
          <AlertCircle className="w-3 h-3 shrink-0" />
          {couponError}
        </div>
      )}

      {/* Success */}
      {couponResult && (
        <div className="flex items-center justify-between gap-2 text-xs bg-emerald-500/8 border border-emerald-500/20 rounded-lg px-3 py-2">
          <div className="flex items-center gap-1.5 text-emerald-400">
            <CheckCircle className="w-3 h-3 shrink-0" />
            <span className="font-mono font-black">{couponResult.code}</span>
            <span>
              —{" "}
              {couponResult.type === "percentage"
                ? `${couponResult.value}%`
                : `${couponResult.value} د.ل`}{" "}
              خصم
            </span>
          </div>
          <span className="font-black text-emerald-400">
            −{formatCurrency(couponResult.discount_amount)}
          </span>
        </div>
      )}
    </div>
  );
}

function CtaBlock({
  token,
  product,
  user,
  displayPrice,
  canAfford,
  shortfall,
  isPending,
  onBuy,
  onLogin,
  onWallet,
  compact,
  couponInput,
  couponResult,
  couponError,
  couponValidating,
  onCouponChange,
  onCouponValidate,
  onCouponClear,
}: {
  token: string | null;
  product: Product;
  user?: User;
  displayPrice: number;
  canAfford: boolean;
  shortfall: number;
  isPending: boolean;
  onBuy: () => void;
  onLogin: () => void;
  onWallet: () => void;
  compact?: boolean;
  couponInput?: string;
  couponResult?: CouponResult | null;
  couponError?: string;
  couponValidating?: boolean;
  onCouponChange?: (v: string) => void;
  onCouponValidate?: () => void;
  onCouponClear?: () => void;
}) {
  if (!token) {
    return (
      <div className={`${compact ? "flex items-center gap-3" : "space-y-2"}`}>
        {compact && (
          <div className="flex-1 text-right">
            <div className="font-black text-primary text-xl tabular-nums">
              {formatCurrency(displayPrice)}
            </div>
            <div className="text-xs text-muted-foreground">سجل الدخول للشراء</div>
          </div>
        )}
        <Button
          onClick={onLogin}
          className={`${compact ? "shrink-0 h-12 min-w-[7.5rem] px-6" : "w-full h-12 text-base"} bg-primary hover:bg-primary/90 font-bold shadow-lg shadow-primary/25 press-spring`}
        >
          {compact ? "دخول" : "تسجيل الدخول للشراء"}
        </Button>
      </div>
    );
  }

  if (!product.is_available) {
    return (
      <div className={compact ? "flex items-center gap-3" : "space-y-2"}>
        {compact && (
          <div className="flex-1 font-black text-xl text-muted-foreground tabular-nums">
            {formatCurrency(displayPrice)}
          </div>
        )}
        <Button
          disabled
          aria-label="نفد المخزون — غير متاح للشراء حالياً"
          className={`${compact ? "shrink-0 h-12 min-w-[7.5rem] px-6" : "w-full h-12 text-base"}`}
        >
          <Lock className="w-4 h-4 ml-2" /> نفد المخزون
        </Button>
        {/*
          Recovery hint — gives the user a reason to come back instead of
          presenting a dead-end. Hidden in compact (sticky-bar) mode so the
          mobile sticky bar stays single-line.
        */}
        {!compact && (
          <p className="text-center text-xs text-muted-foreground">تحقّق لاحقاً، قد يعود قريباً</p>
        )}
      </div>
    );
  }

  const couponField =
    !compact && onCouponChange && onCouponValidate && onCouponClear ? (
      <CouponField
        token={token}
        couponInput={couponInput ?? ""}
        couponResult={couponResult ?? null}
        couponError={couponError ?? ""}
        couponValidating={couponValidating ?? false}
        onCouponChange={onCouponChange}
        onCouponValidate={onCouponValidate}
        onCouponClear={onCouponClear}
      />
    ) : null;

  if (!canAfford) {
    return (
      <div className={compact ? "flex items-center gap-3" : "space-y-3"}>
        {compact ? (
          <>
            <div className="flex-1 text-right">
              <div className="font-black text-primary text-xl tabular-nums">
                {formatCurrency(displayPrice)}
              </div>
              <div className="text-xs text-destructive/75">
                تحتاج {formatCurrency(shortfall)} إضافية
              </div>
            </div>
            <Button
              onClick={onWallet}
              variant="outline"
              className="shrink-0 h-12 min-w-[7.5rem] px-5 press-spring"
            >
              <Wallet className="w-4 h-4 ml-1.5" /> شحن
            </Button>
          </>
        ) : (
          <>
            {couponField}
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="flex items-center justify-between gap-2 px-4 py-3 bg-muted/25 border border-border/50 rounded-xl col-span-2">
                <span className="text-muted-foreground">رصيدك الحالي</span>
                <span className="font-bold tabular-nums">
                  {formatCurrency(user?.wallet_balance ?? 0)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 px-4 py-3 bg-primary/8 border border-primary/20 rounded-xl col-span-2">
                <span className="text-muted-foreground">تحتاج إضافة</span>
                <span className="font-black text-primary tabular-nums">
                  {formatCurrency(shortfall)}
                </span>
              </div>
            </div>
            <Button
              onClick={onWallet}
              variant="outline"
              className="w-full h-12 text-base press-spring"
            >
              <Wallet className="w-5 h-5 ml-2" /> شحن المحفظة
            </Button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className={compact ? "flex items-center gap-3" : "space-y-3"}>
      {!compact && couponField}
      {compact && (
        <div className="flex-1 text-right">
          <div className="font-black text-primary text-xl tabular-nums">
            {formatCurrency(displayPrice)}
          </div>
          <div className="text-xs text-emerald-400">رصيد كافٍ ✓</div>
        </div>
      )}
      <Button
        onClick={onBuy}
        disabled={isPending}
        className={`${compact ? "shrink-0 h-12 min-w-[7.5rem] px-6" : "w-full h-12 text-base"} bg-primary hover:bg-primary/90 font-bold shadow-lg shadow-primary/25 press-spring ${!compact ? "cta-glow" : ""}`}
      >
        <ShoppingCart className={`${compact ? "w-4 h-4" : "w-5 h-5"} ml-2`} />
        {isPending
          ? "جارٍ المعالجة..."
          : compact
            ? "اشترِ"
            : `اشترِ الآن — ${formatCurrency(displayPrice)}`}
      </Button>
      {/* Reassurance: tells the user exactly what will be deducted and
          what's left after — eliminates a hesitation moment where users
          tap and pause to mentally calculate "wait, will I still have
          something for next time?". Desktop-only; the mobile sticky bar
          already shows the balance via the "رصيد كافٍ ✓" line in compact
          mode. */}
      {!compact && user && (
        <p className="text-center text-xs text-muted-foreground -mt-1">
          سيُخصم من رصيدك ({formatCurrency(user.wallet_balance ?? 0)} متاح)
        </p>
      )}
    </div>
  );
}

function RecommendationsSection({ numericId }: { numericId: number }) {
  const [, navigate] = useLocation();
  const { data: recommendations = [], isLoading } = useGetProductRecommendations(numericId, {
    query: {
      queryKey: getGetProductRecommendationsQueryKey(numericId),
      enabled: !!numericId,
      staleTime: 5 * 60 * 1000,
    },
  });

  if (!isLoading && recommendations.length === 0) return null;

  return (
    <div className="mt-8 space-y-4">
      <h3 className="text-lg font-black pr-1">قد يعجبك أيضاً</h3>
      <div className="grid grid-cols-2 gap-3">
        {isLoading
          ? Array.from({ length: 2 }).map((_, i) => (
              <div
                key={i}
                className="bg-card border border-border/50 rounded-xl h-48 skeleton-shimmer"
              />
            ))
          : recommendations.map((r) => (
              <div
                key={r.id}
                onClick={() => {
                  navigate(`/product/${r.id}`);
                  window.scrollTo(0, 0);
                }}
                className="bg-card border border-border/50 rounded-2xl p-3.5 space-y-3 cursor-pointer hover:border-primary/40 transition-all group"
              >
                <div className="aspect-[4/3] bg-muted/30 rounded-xl overflow-hidden relative">
                  {r.image_url ? (
                    <img
                      src={r.image_url}
                      alt={r.name}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-contain p-3 group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-muted/50 border border-border/40">
                        <span className="text-xl font-black text-muted-foreground/55">
                          {r.name[0]}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
                <div>
                  <h4 className="text-sm font-bold truncate mb-1">{r.name}</h4>
                  <div className="text-primary font-black tabular-nums">
                    {formatCurrency(r.price)}
                  </div>
                </div>
              </div>
            ))}
      </div>
    </div>
  );
}
