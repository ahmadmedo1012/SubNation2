import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Calculator,
  AlertTriangle,
  TrendingDown,
  TrendingUp,
  Tag,
  Sparkles,
  Info,
} from "lucide-react";
import {
  useListAdminProducts,
  getListAdminProductsQueryKey,
} from "@workspace/api-client-react";
import { AdminLayout } from "./layout";

/**
 * Admin Pricing Calculator
 *
 * Read-only profit/margin simulator. Talks to POST /api/admin/pricing/calculate
 * which mirrors the live order pipeline (flash sale → coupon → final price).
 * NEVER mutates anything; safe to run anywhere.
 *
 * Inputs:
 *   - Existing product (picker) OR custom price + cost
 *   - Optional coupon code
 *   - "Simulate referred buyer" toggle (subtracts welcome bonus + referrer points)
 *
 * Outputs:
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

  const headers = { Authorization: adminToken ? `Bearer ${adminToken}` : "" };

  const { data: products = [] } = useListAdminProducts({
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
    () => (productId === "custom" ? null : products.find((p) => p.id === productId) ?? null),
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
        toast({ title: "خطأ", description: data.error ?? "فشل الحساب", variant: "destructive" });
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

  // Auto-recalculate when any input changes (debounced via React batching)
  useEffect(() => {
    if (canCalculate) calculate();
  }, [productId, customPrice, customCost, couponCode, simulateReferred]);

  if (!adminToken) return null;

  return (
    <AdminLayout onRefresh={canCalculate ? calculate : undefined}>
      <div className="max-w-4xl mx-auto space-y-5">
        {/* Page-section header (kept narrow — global admin chrome
            comes from AdminLayout above). */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Calculator className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="font-black text-lg">حاسبة الأسعار والأرباح</h1>
            <p className="text-xs text-muted-foreground">
              للقراءة فقط — لا يُغيّر أي سعر أو كوبون. يحاكي منطق نظام الطلبات الفعلي.
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
            <Label className="text-xs font-bold text-muted-foreground mb-1.5 block">
              المنتج
            </Label>
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
                    {p.name} — {p.price.toFixed(2)} د.ل
                    {cp != null ? ` (تكلفة ${cp.toFixed(2)})` : " (تكلفة غير محددة)"}
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
              كود الكوبون (اختياري)
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
                    <span className="tabular-nums">−{fmt(result.pricing.discount_amount)} د.ل</span>
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
    </AdminLayout>
  );
}
