import { useAdminHeaders } from "@/hooks/use-admin-headers";
import { useConfirm } from "@/hooks/use-confirm";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
import { formatCurrency } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetAdminPricingConfigQueryKey,
  getListAdminProductsQueryKey,
  useGetAdminPricingConfig,
  useListAdminProducts,
  useRecomputeCatalogPrices,
  useUpdateAdminPricingConfig,
} from "@workspace/api-client-react";
import {
  Calculator,
  AlertTriangle,
  Loader2,
  RefreshCw,
  Save,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
  Tag,
  Sparkles,
  Info,
} from "lucide-react";
import { AdminLayout } from "./layout";

/**
 * Admin Pricing Calculator + global pricing rule
 *
 * catalog-recon (2026-09-20): the page gained a WRITABLE section on top —
 * «إعدادات التسعير العامة» (GET/PUT /api/admin/pricing/config + POST
 * /api/admin/pricing/recompute). Everything below it stays the read-only
 * profit/margin simulator. Talks to POST /api/admin/pricing/calculate
 * which mirrors the live order pipeline (flash sale → coupon → final
 * price) — that part NEVER mutates anything.
 *
 * Inputs (calculator):
 *   - Existing product (picker) OR custom price + cost
 *   - Optional coupon code
 *   - "Simulate referred buyer" toggle (subtracts welcome bonus + referrer points)
 *
 * Outputs (calculator):
 *   - Pricing waterfall (list → flash sale → coupon → final)
 *   - Three margin tiers: gross / net (after loyalty) / referral-adjusted
 *   - Loss + low-margin warnings
 */

interface CalculatorResponse {
  inputs: {
    product_id: number | null;
    product_name: string | null;
    list_price: number;
    cost_price: number | null;
    coupon_code: string | null;
    simulate_referred: boolean;
  };
  flash_sale: { discount_percent: number; title: string } | null;
  coupon: {
    code: string;
    type: "percentage" | "fixed";
    value: number;
    valid: boolean;
    reason_invalid: string | null;
  } | null;
  pricing: {
    list_price: number;
    base_price: number;
    discount_amount: number;
    final_price: number;
  };
  loyalty: {
    points_earned: number;
    lyd_accrued: number;
    points_per_lyd: number;
  };
  referral_cost: {
    welcome_bonus_lyd: number;
    referrer_points: number;
    referrer_lyd_value: number;
    total_referral_cost_lyd: number;
  };
  margins: {
    gross_lyd: number | null;
    gross_pct: number | null;
    net_lyd: number | null;
    net_pct: number | null;
    referral_adjusted_lyd: number | null;
    referral_adjusted_pct: number | null;
  };
  warnings: Array<{
    severity: "loss" | "low_margin" | "info";
    code: string;
    message_ar: string;
  }>;
}

function fmt(n: number | null | undefined, decimals = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(decimals);
}

/** Same cent-rounding the backend pricing engine applies (round2). */
const round2 = (v: number): number => Math.round(v * 100) / 100;

/** Trim trailing zeros for the formula's factor/rate (2, not 2.00). */
function fmtFactor(n: number): string {
  return String(Number(n.toFixed(2)));
}

// catalog-recon: orval/customFetch rejections carry ApiError { data: { error,
// code } }. getErrorMessage() resolves the shared CODE map first (INVALID_DATA
// → generic), which would bury the route's own Arabic wording (e.g. the
// out-of-range PUT message). Prefer the backend's message, then fall back.
const ARABIC_SCRIPT_RE = /[\u0600-\u06FF]/;

function describeError(err: unknown): string {
  const data = (err as { data?: { error?: string; message?: string } | null }).data;
  const raw = data?.error ?? data?.message;
  if (typeof raw === "string" && raw.trim() && ARABIC_SCRIPT_RE.test(raw)) return raw;
  return getErrorMessage(err);
}

function MarginRow({
  label,
  lyd,
  pct,
  hint,
}: {
  label: string;
  lyd: number | null;
  pct: number | null;
  hint?: string;
}) {
  const tone =
    lyd == null
      ? "text-muted-foreground"
      : lyd < 0
        ? "text-destructive"
        : pct != null && pct < 5
          ? "text-amber-500"
          : "text-emerald-500";
  const Icon = lyd == null ? Info : lyd < 0 ? TrendingDown : TrendingUp;
  return (
    <div className="flex items-center justify-between py-2.5 px-3 bg-muted/20 border border-border/40 rounded-lg">
      <div className="flex items-center gap-2">
        <Icon className={`w-4 h-4 ${tone}`} />
        <div>
          <div className="text-xs font-bold">{label}</div>
          {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
        </div>
      </div>
      <div className={`tabular-nums text-sm font-black ${tone}`}>
        {lyd == null ? "—" : `${lyd >= 0 ? "+" : ""}${fmt(lyd)} د.ل`}
        {pct != null && (
          <span className="text-[10px] font-normal opacity-75 ml-1">({fmt(pct, 1)}%)</span>
        )}
      </div>
    </div>
  );
}

export default function AdminPricingPage() {
  const { adminToken } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [productId, setProductId] = useState<number | "custom">("custom");
  const [customPrice, setCustomPrice] = useState("");
  const [customCost, setCustomCost] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [simulateReferred, setSimulateReferred] = useState(false);
  const [result, setResult] = useState<CalculatorResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const headers = useAdminHeaders();

  // ── catalog-recon: global pricing rule (rate + markup) — READ + WRITE ──
  const queryClient = useQueryClient();
  const { confirm, ConfirmDialog } = useConfirm();

  const {
    data: pricingConfig,
    isLoading: configLoading,
    isError: configLoadError,
    refetch: refetchConfig,
  } = useGetAdminPricingConfig({
    query: { queryKey: getGetAdminPricingConfigQueryKey(), enabled: !!adminToken },
    request: { headers },
  });

  const [rateInput, setRateInput] = useState("");
  const [markupInput, setMarkupInput] = useState("");

  // Seed the inputs once from the effective rule (later refetches keep the
  // same data identity via structural sharing, so operator edits survive).
  const configSeededRef = useRef(false);
  useEffect(() => {
    if (configSeededRef.current || !pricingConfig) return;
    configSeededRef.current = true;
    setRateInput(String(pricingConfig.usd_to_lyd));
    setMarkupInput(String(pricingConfig.markup_percent));
  }, [pricingConfig]);

  const rateNum = parseFloat(rateInput);
  const markupNum = parseFloat(markupInput);
  const rateValid = Number.isFinite(rateNum) && rateNum >= 0.1 && rateNum <= 1000;
  const markupValid = Number.isFinite(markupNum) && markupNum >= 0 && markupNum <= 10_000;
  const configDirty =
    pricingConfig != null &&
    (rateNum !== pricingConfig.usd_to_lyd || markupNum !== pricingConfig.markup_percent);
  const canSaveConfig = configDirty && rateValid && markupValid;

  // Live formula example — falls back to the loaded rule while a field is
  // empty/invalid so the explainer never shows nonsense numbers.
  const exampleFactor = markupValid
    ? 1 + markupNum / 100
    : pricingConfig
      ? 1 + pricingConfig.markup_percent / 100
      : 2;
  const exampleRate = rateValid ? rateNum : (pricingConfig?.usd_to_lyd ?? 10);
  const examplePrice = round2(5 * exampleFactor * exampleRate);

  const saveConfigMutation = useUpdateAdminPricingConfig({
    request: { headers },
    mutation: {
      onSuccess(config) {
        // Re-seed to the SERVER-rounded values (e.g. 10.999 → 11) and
        // refresh the rule for every other consumer (products page,
        // variant dialog previews) — the config is cached in TanStack.
        setRateInput(String(config.usd_to_lyd));
        setMarkupInput(String(config.markup_percent));
        void queryClient.invalidateQueries({ queryKey: getGetAdminPricingConfigQueryKey() });
        toast({ title: "تم حفظ إعدادات التسعير", variant: "success" });
      },
      onError(err: unknown) {
        toast({
          title: "تعذّر حفظ الإعدادات",
          description: describeError(err),
          variant: "destructive",
        });
      },
    },
  });

  const recomputeMutation = useRecomputeCatalogPrices({
    request: { headers },
    mutation: {
      onSuccess(result) {
        // Display prices (MIN of active variants) moved on the server —
        // refresh the admin products list this page already holds.
        void queryClient.invalidateQueries({ queryKey: getListAdminProductsQueryKey() });
        if (result.variants_updated > 0) {
          toast({
            title: "أُعيد احتساب أسعار الكتالوج",
            description: `حُدّثت أسعار ${result.variants_updated} باقة عبر ${result.products_updated} ${
              result.products_updated === 1 ? "منتج" : "منتجات"
            }`,
            variant: "success",
          });
        } else {
          toast({
            title: "لا تغييرات",
            description: "كل الأسعار مطابقة للقاعدة الحالية",
            variant: "info",
          });
        }
      },
      onError(err: unknown) {
        toast({
          title: "تعذّر إعادة الاحتساب",
          description: describeError(err),
          variant: "destructive",
        });
      },
    },
  });

  const saveConfig = () => {
    if (!canSaveConfig) return;
    saveConfigMutation.mutate({
      data: { usd_to_lyd: round2(rateNum), markup_percent: round2(markupNum) },
    });
  };

  const recomputeCatalog = async () => {
    const confirmed = await confirm({
      title: "إعادة احتساب أسعار الكتالوج؟",
      description:
        "سيُعاد حساب سعر كل باقة نشطة من تكلفتها بالقاعدة الحالية — بما فيها الأسعار المخصّصة يدويًا — وتُحدّث أسعار العرض تلقائيًا.",
      confirmLabel: "إعادة الاحتساب",
      destructive: true,
    });
    if (!confirmed) return;
    recomputeMutation.mutate(undefined);
  };

  const { data: products = [] } = useListAdminProducts(undefined, {
    query: {
      queryKey: getListAdminProductsQueryKey(),
      enabled: !!adminToken,
      refetchIntervalInBackground: false,
    },
    request: { headers },
  });

  useEffect(() => {
    if (!adminToken) navigate("/admin/login");
  }, [adminToken, navigate]);

  const selectedProduct = useMemo(
    () => (productId === "custom" ? null : (products.find((p) => p.id === productId) ?? null)),
    [productId, products],
  );

  const canCalculate = useMemo(() => {
    if (productId !== "custom") return selectedProduct != null;
    return Number.isFinite(parseFloat(customPrice)) && parseFloat(customPrice) >= 0;
  }, [productId, selectedProduct, customPrice]);

  async function calculate() {
    if (!canCalculate) return;
    setLoading(true);
    try {
      const body: Record<string, unknown> = {
        coupon_code: couponCode.trim() || undefined,
        simulate_referred: simulateReferred,
      };
      if (productId === "custom") {
        body.price = parseFloat(customPrice);
        body.cost_price = customCost ? parseFloat(customCost) : null;
      } else {
        body.product_id = productId;
      }
      const res = await fetch("/api/admin/pricing/calculate", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        // Round-4 (org §6a): getErrorMessage maps the backend `code`
        // (INVALID_PRICE bounds, NOT_FOUND…) to Arabic.
        toast({
          title: "خطأ",
          description: getErrorMessage(data) || "فشل الحساب",
          variant: "destructive",
        });
        setResult(null);
        return;
      }
      setResult(data);
    } catch (err) {
      toast({
        title: "خطأ",
        description: err instanceof Error ? err.message : "تعذّر الاتصال بالخادم",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  // Auto-recalculate when any input changes — ACTUALLY debounced.
  // The previous comment claimed React batching debounced this effect,
  // but batching only coalesces renders, not effect runs: every keystroke
  // fired a full POST /api/admin/pricing/calculate. 300ms of quiet is
  // the standard feel for type-ahead server calls.
  const calculateRef = useRef(calculate);
  calculateRef.current = calculate;
  useEffect(() => {
    if (!canCalculate) return;
    const t = setTimeout(() => calculateRef.current(), 300);
    return () => clearTimeout(t);
  }, [productId, customPrice, customCost, couponCode, simulateReferred, canCalculate]);

  if (!adminToken) return null;

  return (
    <AdminLayout
      onRefresh={() => {
        void refetchConfig();
        if (canCalculate) void calculate();
      }}
    >
      <div className="max-w-4xl mx-auto space-y-5">
        {/* Page-section header (kept narrow — global admin chrome
            comes from AdminLayout above). */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Calculator className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="font-black text-lg">التسعير</h1>
            <p className="text-xs text-muted-foreground">
              إعدادات القاعدة العامة + حاسبة أرباح للقراءة فقط تحاكي نظام الطلبات الفعلي.
            </p>
          </div>
        </div>

        {/* ── إعدادات التسعير العامة (WRITES — unlike the calculator) ──
            catalog-recon: the single source of truth for variant pricing:
            cost × (1 + markup%) × rate. Saving the rule does NOT touch
            stored prices — the explicit recompute action below does. */}
        <div className="bg-card border border-primary/25 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                <SlidersHorizontal className="w-4 h-4 text-primary" />
              </div>
              <div className="min-w-0">
                <h2 className="font-black text-sm">إعدادات التسعير العامة</h2>
                <p className="text-[10px] text-muted-foreground truncate">
                  القاعدة الموحّدة التي تُشتق منها أسعار الباقات من تكلفتها.
                </p>
              </div>
            </div>
            {configLoading ? (
              <Loader2
                className="w-4 h-4 animate-spin text-muted-foreground shrink-0"
                aria-label="جارٍ تحميل الإعدادات"
              />
            ) : configLoadError ? (
              <button
                type="button"
                onClick={() => void refetchConfig()}
                className="text-xs text-destructive underline underline-offset-2 shrink-0"
              >
                إعادة المحاولة
              </button>
            ) : null}
          </div>

          {configLoadError && (
            <div
              role="alert"
              className="p-3 rounded-xl bg-status-error/10 border border-status-error/25 text-status-error text-xs font-bold flex items-center gap-2"
            >
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              تعذّر تحميل إعدادات التسعير الحالية
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs font-bold text-muted-foreground mb-1.5 block">
                سعر الصرف — دينار لكل دولار ($1 =)
              </Label>
              <Input
                type="number"
                min="0.1"
                max="1000"
                step="0.01"
                value={rateInput}
                onChange={(e) => setRateInput(e.target.value)}
                dir="ltr"
                placeholder="10"
                disabled={configLoading}
              />
              {rateInput !== "" && !rateValid && (
                <p className="text-[10px] text-destructive font-bold mt-1" role="alert">
                  سعر الصرف يجب أن يكون بين 0.1 و 1000
                </p>
              )}
            </div>
            <div>
              <Label className="text-xs font-bold text-muted-foreground mb-1.5 block">
                الهامش على التكلفة (%)
              </Label>
              <Input
                type="number"
                min="0"
                max="10000"
                step="1"
                value={markupInput}
                onChange={(e) => setMarkupInput(e.target.value)}
                dir="ltr"
                placeholder="100"
                disabled={configLoading}
              />
              {markupInput !== "" && !markupValid && (
                <p className="text-[10px] text-destructive font-bold mt-1" role="alert">
                  الهامش يجب أن يكون بين 0 و 10000
                </p>
              )}
            </div>
          </div>

          {/* Formula explainer — live numbers so the operator sees the
              effect BEFORE saving (defaults: $5 × 2 × 10 = 100 د.ل). */}
          <div className="flex items-start gap-2.5 p-3 bg-muted/20 border border-border/40 rounded-xl">
            <Info className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
            <p className="text-[11px] leading-relaxed">
              <span className="font-bold">السعر = التكلفة × (1 + الهامش٪) × سعر الصرف</span>
              <span className="text-muted-foreground">
                {" "}
                — مثال: $5 × {fmtFactor(exampleFactor)} × {fmtFactor(exampleRate)} ={" "}
                {formatCurrency(examplePrice)}
              </span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={saveConfig}
              disabled={!canSaveConfig || saveConfigMutation.isPending}
              className="bg-primary hover:bg-primary/90 active:scale-[0.97] transition-transform"
            >
              {saveConfigMutation.isPending ? (
                <Loader2 className="w-4 h-4 ml-1.5 animate-spin" />
              ) : (
                <Save className="w-4 h-4 ml-1.5" />
              )}
              {saveConfigMutation.isPending ? "جارٍ الحفظ…" : "حفظ الإعدادات"}
            </Button>
            <Button
              variant="outline"
              onClick={() => void recomputeCatalog()}
              disabled={recomputeMutation.isPending}
              className="text-primary border-primary/25 hover:bg-primary/10 active:scale-[0.97] transition-transform"
            >
              {recomputeMutation.isPending ? (
                <Loader2 className="w-4 h-4 ml-1.5 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 ml-1.5" />
              )}
              {recomputeMutation.isPending ? "جارٍ الاحتساب…" : "إعادة احتساب أسعار الكتالوج"}
            </Button>
            <p className="basis-full text-[10px] text-muted-foreground">
              حفظ الإعدادات لا يغيّر الأسعار المخزّنة — «إعادة احتساب أسعار الكتالوج» هي التي تعيد
              تسعير كل الباقات من تكاليفها بالقاعدة الحالية وتُحدّث أسعار العرض.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* ── INPUTS ─────────────────────────────────────────────── */}
          <div className="bg-card border border-border/55 rounded-2xl p-5 space-y-4">
            <h2 className="font-black text-sm flex items-center gap-2">
              <Tag className="w-4 h-4 text-primary" /> المدخلات
            </h2>

            {/* Product picker */}
            <div>
              <Label className="text-xs font-bold text-muted-foreground mb-1.5 block">المنتج</Label>
              <select
                value={productId === "custom" ? "custom" : String(productId)}
                onChange={(e) =>
                  setProductId(e.target.value === "custom" ? "custom" : Number(e.target.value))
                }
                className="w-full bg-muted/20 border border-border/55 rounded-xl px-3 py-2 text-sm"
              >
                <option value="custom">— سعر مخصّص (للاختبار) —</option>
                {products.map((p) => {
                  const cp = (p as { cost_price?: number | null }).cost_price;
                  return (
                    <option key={p.id} value={p.id}>
                      {/* 96-F7 (R96 A6 #18): formatCurrency — the manual
                          toFixed(2) skipped thousands grouping (the
                          established money convention, see utils.ts). */}
                      {p.name} — {formatCurrency(p.price)}
                      {cp != null ? ` (تكلفة ${formatCurrency(cp)})` : " (تكلفة غير محددة)"}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Custom price + cost (only when "custom") */}
            {productId === "custom" && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs font-bold text-muted-foreground mb-1.5 block">
                    السعر (د.ل)
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={customPrice}
                    onChange={(e) => setCustomPrice(e.target.value)}
                    placeholder="0.00"
                    dir="ltr"
                  />
                </div>
                <div>
                  <Label className="text-xs font-bold text-muted-foreground mb-1.5 block">
                    التكلفة (د.ل)
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={customCost}
                    onChange={(e) => setCustomCost(e.target.value)}
                    placeholder="0.00"
                    dir="ltr"
                  />
                </div>
              </div>
            )}

            {/* Coupon code */}
            <div>
              <Label className="text-xs font-bold text-muted-foreground mb-1.5 block">
                {/* 93-C7 / C-UX5 (A11 top-20 #5): كود/رمز unification —
                    "رمز" is the canonical word for the coupon field
                    (matches admin/coupons.tsx + the backend message). */}
                رمز الكوبون (اختياري)
              </Label>
              <Input
                value={couponCode}
                onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                placeholder="WELCOME10"
                dir="ltr"
              />
            </div>

            {/* Simulate referred */}
            <div className="flex items-center justify-between p-3 bg-muted/20 border border-border/40 rounded-lg">
              <div>
                <div className="text-xs font-bold">محاكاة مشتري مُحال</div>
                <div className="text-[10px] text-muted-foreground">
                  يحسم 5 د.ل مكافأة الترحيب + 0.50 د.ل نقاط المُحيل
                </div>
              </div>
              <Switch checked={simulateReferred} onCheckedChange={setSimulateReferred} />
            </div>

            <Button onClick={calculate} disabled={!canCalculate || loading} className="w-full">
              {loading ? "جارٍ الحساب…" : "إعادة الحساب"}
            </Button>
          </div>

          {/* ── OUTPUTS ────────────────────────────────────────────── */}
          <div className="bg-card border border-border/55 rounded-2xl p-5 space-y-3">
            <h2 className="font-black text-sm flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" /> النتائج
            </h2>

            {!result ? (
              <p className="text-xs text-muted-foreground py-8 text-center">
                أدخل سعراً أو اختر منتجاً لرؤية الحساب.
              </p>
            ) : (
              <>
                {/* Pricing waterfall */}
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between py-1">
                    <span className="text-muted-foreground">السعر المعروض</span>
                    <span className="tabular-nums font-bold">
                      {fmt(result.pricing.list_price)} د.ل
                    </span>
                  </div>
                  {result.flash_sale && (
                    <div className="flex justify-between py-1 text-amber-500">
                      <span>↳ تخفيضات الموقع ({result.flash_sale.discount_percent}%)</span>
                      <span className="tabular-nums">{fmt(result.pricing.base_price)} د.ل</span>
                    </div>
                  )}
                  {result.coupon && result.coupon.valid && (
                    <div className="flex justify-between py-1 text-violet-500">
                      <span>
                        ↳ كوبون {result.coupon.code} (
                        {result.coupon.type === "percentage"
                          ? `${result.coupon.value}%`
                          : `−${fmt(result.coupon.value)}`}
                        )
                      </span>
                      <span className="tabular-nums">
                        −{fmt(result.pricing.discount_amount)} د.ل
                      </span>
                    </div>
                  )}
                  {result.coupon && !result.coupon.valid && (
                    <div className="flex justify-between py-1 text-destructive text-[10px]">
                      <span>⚠️ كوبون غير صالح</span>
                      <span>{result.coupon.reason_invalid}</span>
                    </div>
                  )}
                  <div className="flex justify-between py-2 border-t border-border/40 mt-2">
                    <span className="font-bold">السعر النهائي</span>
                    <span className="tabular-nums font-black text-primary text-base">
                      {fmt(result.pricing.final_price)} د.ل
                    </span>
                  </div>
                </div>

                <div className="border-t border-border/40 pt-3 space-y-2">
                  <MarginRow
                    label="الربح الإجمالي"
                    hint="السعر النهائي ناقص التكلفة"
                    lyd={result.margins.gross_lyd}
                    pct={result.margins.gross_pct}
                  />
                  <MarginRow
                    label="الربح الصافي"
                    hint={`بعد ${result.loyalty.points_earned} نقطة ولاء (~${fmt(result.loyalty.lyd_accrued)} د.ل)`}
                    lyd={result.margins.net_lyd}
                    pct={result.margins.net_pct}
                  />
                  {result.inputs.simulate_referred && (
                    <MarginRow
                      label="الربح بعد تكلفة الإحالة"
                      hint={`بعد ${fmt(result.referral_cost.total_referral_cost_lyd)} د.ل (مكافأة ترحيب + نقاط مُحيل)`}
                      lyd={result.margins.referral_adjusted_lyd}
                      pct={result.margins.referral_adjusted_pct}
                    />
                  )}
                </div>

                {/* Warnings */}
                {result.warnings.length > 0 && (
                  <div className="border-t border-border/40 pt-3 space-y-2">
                    {result.warnings.map((w, i) => {
                      const tone =
                        w.severity === "loss"
                          ? "border-destructive/40 bg-destructive/10 text-destructive"
                          : w.severity === "low_margin"
                            ? "border-amber-500/40 bg-amber-500/10 text-amber-500"
                            : "border-blue-500/40 bg-blue-500/10 text-blue-400";
                      return (
                        <div
                          key={i}
                          className={`flex items-start gap-2 p-2.5 border rounded-lg text-[11px] ${tone}`}
                        >
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          <span className="font-medium">{w.message_ar}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Footer note */}
        <div className="text-[10px] text-muted-foreground text-center pt-2">
          تستخدم الحاسبة منطق نظام الطلبات الفعلي (تخفيضات + كوبونات + ولاء + إحالات). أي تغيير في
          النظام الفعلي يجب أن ينعكس هنا.
        </div>
      </div>

      {/* catalog-recon: styled confirm for the bulk recompute action */}
      <ConfirmDialog />
    </AdminLayout>
  );
}
