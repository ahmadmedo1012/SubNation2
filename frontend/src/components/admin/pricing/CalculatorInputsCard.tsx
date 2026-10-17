import type { Dispatch, SetStateAction } from "react";
import { Tag } from "lucide-react";
import type { AdminProduct, AdminProductVariant } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { formatCurrency } from "@/lib/utils";
import { fmt } from "@/components/admin/pricing/pricing-format";
import type { CalculatorResponse } from "@/components/admin/pricing/pricing-types";

// R137 (FE decomposition): extracted verbatim from pages/admin/pricing.tsx —
// the read-only simulator's INPUTS card (product picker → R115 variant
// selector → custom price/cost sandbox → coupon code → referred-buyer
// toggle → recalc button). Every state atom (productId/variantId/
// customPrice/customCost/couponCode/simulateReferred/result), the
// canCalculate gate and the race-guarded calculate loop stay centralized in
// the page — this extract renders values and invokes the page-owned
// setters/handler passed down as props (the raw setters keep their original
// names so every input's onChange is byte-identical). The move only changes
// its address; DOM, classes, Arabic copy and aria are byte-identical.

export function CalculatorInputsCard({
  productId,
  setProductId,
  products,
  variantId,
  setVariantId,
  selectedVariants,
  customPrice,
  setCustomPrice,
  customCost,
  setCustomCost,
  couponCode,
  setCouponCode,
  simulateReferred,
  setSimulateReferred,
  result,
  onCalculate,
  canCalculate,
  loading,
}: {
  productId: number | "custom";
  setProductId: Dispatch<SetStateAction<number | "custom">>;
  products: AdminProduct[];
  variantId: number | "";
  setVariantId: Dispatch<SetStateAction<number | "">>;
  selectedVariants: AdminProductVariant[];
  customPrice: string;
  setCustomPrice: Dispatch<SetStateAction<string>>;
  customCost: string;
  setCustomCost: Dispatch<SetStateAction<string>>;
  couponCode: string;
  setCouponCode: Dispatch<SetStateAction<string>>;
  simulateReferred: boolean;
  setSimulateReferred: Dispatch<SetStateAction<boolean>>;
  result: CalculatorResponse | null;
  onCalculate: () => void;
  canCalculate: boolean;
  loading: boolean;
}) {
  return (
    /* R139 (precision): border/55 → /60 — the inputs card joins the
       resting one-edge register (bg-card already solid; flat — the
       PricingConfigCard owns the page's elevated register).
       R157-C: the two native selects ride the shared ui/select
       primitive — the /55 muted inset was one of the five divergent
       hand-rolled recipes the audit retired. */
    <div className="bg-card border border-border/60 rounded-2xl p-5 space-y-4">
      <h2 className="font-bold text-sm flex items-center gap-2">
        <Tag className="w-4 h-4 text-primary" /> المدخلات
      </h2>

      {/* Product picker */}
      <div>
        <Label
          htmlFor="pricing-calc-product"
          className="text-xs font-bold text-muted-foreground mb-1.5 block"
        >
          المنتج
        </Label>
        <Select
          id="pricing-calc-product"
          value={productId === "custom" ? "custom" : String(productId)}
          onChange={(e) => {
            setProductId(e.target.value === "custom" ? "custom" : Number(e.target.value));
            // A variant choice belongs to the previous product —
            // always reset to the auto (cheapest-active) mode.
            setVariantId("");
          }}
        >
          <option value="custom">— سعر مخصّص (للاختبار) —</option>
          {products.map((p) => {
            // R125-I3 (A2-20): the generated AdminProduct already
            // declares cost_price — the pre-codegen-era cast is gone.
            const cp = p.cost_price;
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
        </Select>
      </div>

      {/* R115 (Part 13): the variant selector — the sellable unit
          checkout charges (variant.price_lyd). "" keeps the
          product's cheapest ACTIVE variant (the old product-level
          simulation), now labeled as such by the backend. */}
      {productId !== "custom" && (
        <div>
          <Label
            htmlFor="pricing-calc-variant"
            className="text-xs font-bold text-muted-foreground mb-1.5 block"
          >
            الباقة (الخيار الفعلي عند الدفع)
          </Label>
          <Select
            id="pricing-calc-variant"
            value={variantId === "" ? "" : String(variantId)}
            onChange={(e) => setVariantId(e.target.value === "" ? "" : Number(e.target.value))}
            disabled={selectedVariants.length === 0}
          >
            <option value="">تلقائي — أرخص باقة نشطة</option>
            {selectedVariants.map((v) => {
              const label =
                [v.plan_label, v.duration_label].filter(Boolean).join(" — ") || `باقة #${v.id}`;
              return (
                <option key={v.id} value={v.id}>
                  {label} — {formatCurrency(v.price_lyd)}
                  {!v.is_active ? " (غير فعّالة)" : ""}
                </option>
              );
            })}
          </Select>
          {selectedVariants.length === 0 && (
            <p className="text-3xs text-status-warning mt-1">
              لا باقات لهذا المنتج — اختر منتجًا آخر أو استخدم السعر المخصّص.
            </p>
          )}
        </div>
      )}

      {/* Custom price + cost (only when "custom") */}
      {productId === "custom" && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label
              htmlFor="pricing-calc-price"
              className="text-xs font-bold text-muted-foreground mb-1.5 block"
            >
              السعر (د.ل)
            </Label>
            <Input
              id="pricing-calc-price"
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
            <Label
              htmlFor="pricing-calc-cost"
              className="text-xs font-bold text-muted-foreground mb-1.5 block"
            >
              التكلفة (د.ل)
            </Label>
            <Input
              id="pricing-calc-cost"
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
        <Label
          htmlFor="pricing-calc-coupon"
          className="text-xs font-bold text-muted-foreground mb-1.5 block"
        >
          {/* 93-C7 / C-UX5 (A11 top-20 #5): كود/رمز unification —
              "رمز" is the canonical word for the coupon field
              (matches admin/coupons.tsx + the backend message). */}
          رمز الكوبون (اختياري)
        </Label>
        <Input
          id="pricing-calc-coupon"
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
          <div className="text-3xs text-muted-foreground">
            {/* R115: the numbers come from the API response
                (result.referral_cost) — never a frozen «5 د.ل +
                0.50» constant; before the first calculation the
                hint describes the mechanics without inventing
                values. */}
            {result
              ? `يحسم ${fmt(result.referral_cost.welcome_bonus_lyd)} د.ل مكافأة الترحيب + ${fmt(
                  result.referral_cost.referrer_lyd_value,
                )} د.ل قيمة نقاط المُحيل`
              : "تُخصم مكافأة الترحيب للمُحال وقيمة نقاط المُحيل من الربح"}
          </div>
        </div>
        <Switch
          checked={simulateReferred}
          onCheckedChange={setSimulateReferred}
          /* R125-I3 (A2-10a): the Switch had no accessible name — the
             label text sits in a sibling div and switch.tsx forwards
             nothing implicitly. aria-label names the control for
             screen readers + getByRole("switch", { name }). */
          aria-label="محاكاة مشتري مُحال"
        />
      </div>

      <Button onClick={onCalculate} disabled={!canCalculate || loading} className="w-full">
        {loading ? "جارٍ الحساب…" : "إعادة الحساب"}
      </Button>
    </div>
  );
}
