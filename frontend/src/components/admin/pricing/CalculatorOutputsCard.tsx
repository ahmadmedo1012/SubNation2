import { AlertTriangle, Info, Shield, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import { MarginRow } from "@/components/admin/pricing/MarginRow";
import { fmt, fmtFactor } from "@/components/admin/pricing/pricing-format";
import {
  RISK_STATE_LABEL,
  RISK_STATE_TONE,
  riskExplanation,
} from "@/components/admin/pricing/pricing-risk";
import type { CalculatorResponse } from "@/components/admin/pricing/pricing-types";

// R137 (FE decomposition): extracted verbatim from pages/admin/pricing.tsx —
// the read-only simulator's OUTPUTS card: the R126-L3 (A2-9) stale-keep
// error banner, the R115 (Part 15) risk-state badge (WITH its WHY text —
// never a bare color), the pricing waterfall, the three margin tiers
// (MarginRow rides along here), the worst-case block, the guardrails
// block, the applied-config line and the warnings list. The result atom +
// calcError banner state stay centralized in the page — this extract
// renders them as plain values. The move only changes its address; DOM,
// classes, Arabic copy, data-risk-state and aria are byte-identical.

export function CalculatorOutputsCard({
  result,
  calcError,
}: {
  result: CalculatorResponse | null;
  calcError: string | null;
}) {
  return (
    <div className="bg-card border border-border/55 rounded-2xl p-5 space-y-3">
      <h2 className="font-bold text-sm flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-primary" /> النتائج
      </h2>

      {/* R126-L3 (A2-9): the persistent error surface — the toast
          above is transient, but a failed recalc must leave a
          STANDING marker that the numbers below are stale (or,
          before any result, that the calculator itself failed).
          role="alert" so screen readers hear it too. */}
      {calcError && (
        <div
          role="alert"
          className="flex items-start gap-2.5 p-3 border border-destructive/25 bg-destructive/5 rounded-xl text-destructive"
        >
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="min-w-0 text-xs leading-relaxed">
            <span className="font-bold">
              {result
                ? "فشل تحديث الحاسبة — النتيجة أدناه من آخر حساب ناجح وقد لا تطابق المدخلات الحالية."
                : "تعذّر تشغيل الحاسبة — حاول مجدداً أو حدّث الصفحة."}
            </span>{" "}
            <span className="opacity-80">{calcError}</span>
          </div>
        </div>
      )}

      {!result ? (
        /* R126-L3 (A2-9): with a failed FIRST calculation the bare
           «أدخل سعراً…» guidance is a false claim — the error
           banner above owns the card until a calculation lands. */
        !calcError && (
          <p className="text-xs text-muted-foreground py-8 text-center">
            أدخل سعراً أو اختر منتجاً لرؤية الحساب.
          </p>
        )
      ) : (
        <>
          {/* R115 (Part 15): the risk state badge — NEVER a bare
              color: the state tone carries the color and the WHY
              text (backend warning when one matches, threshold
              explainer otherwise) rides right under it. */}
          <div
            className={`flex items-start gap-2.5 p-3 border rounded-xl ${RISK_STATE_TONE[result.risk_state]}`}
            data-risk-state={result.risk_state}
          >
            {result.risk_state === "LOSS" || result.risk_state === "THIN" ? (
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            ) : result.risk_state === "WATCH" ? (
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
            ) : (
              <TrendingUp className="w-4 h-4 shrink-0 mt-0.5" />
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm">{RISK_STATE_LABEL[result.risk_state]}</span>
                {result.inputs.variant_label && (
                  <span className="text-3xs font-semibold opacity-80 truncate">
                    {result.inputs.variant_label}
                  </span>
                )}
              </div>
              <p className="text-2xs leading-relaxed mt-0.5">{riskExplanation(result)}</p>
            </div>
          </div>

          {/* Pricing waterfall */}
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between py-1">
              <span className="text-muted-foreground">السعر المعروض</span>
              <span className="tabular-nums font-bold">{fmt(result.pricing.list_price)} د.ل</span>
            </div>
            {result.flash_sale && (
              <div className="flex justify-between py-1 text-status-warning">
                <span>↳ تخفيضات الموقع ({result.flash_sale.discount_percent}%)</span>
                <span className="tabular-nums">{fmt(result.pricing.base_price)} د.ل</span>
              </div>
            )}
            {result.coupon && result.coupon.valid && (
              <div className="flex justify-between py-1 text-status-purple">
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
              <div className="flex justify-between items-center gap-2 py-1 text-destructive text-3xs">
                {/* R125-I3 (A2-10c): the ⚠️ emoji is gone — lucide
                    icon, the R124 promotions-toast convention. */}
                <span className="flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3 shrink-0" /> كوبون غير صالح
                </span>
                <span>{result.coupon.reason_invalid}</span>
              </div>
            )}
            <div className="flex justify-between py-2 border-t border-border/40 mt-2">
              <span className="font-bold">السعر النهائي</span>
              {/* R126-L5 (A1-18): the headline money number rode raw
                  text-primary — 3.76:1 on the dark card (A6-B6's
                  measured figure), text-base is not large text, and
                  dark is the admin DEFAULT. text-primary-text is the
                  B-6 sweep class (AA both themes). */}
              <span className="tabular-nums font-bold text-primary-text text-base">
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

          {/* R115 (Part 15): the worst-case block — the deepest
              discount stack the CURRENT config allows (active
              flash + a coupon up to the remaining cap headroom) on
              the same cost base. Answers "how bad can an allowed
              combination get?" before the operator ever creates
              one. */}
          <div className="border-t border-border/40 pt-3">
            <div className="flex items-center gap-1.5 mb-2">
              <TrendingDown className="w-3.5 h-3.5 text-status-warning shrink-0" />
              <h3 className="text-xs font-bold">
                أسوأ حالة — أعمق خصم مسموح ({result.worst_case.combined_discount_pct}%)
              </h3>
            </div>
            <div className="space-y-1 text-2xs">
              <div className="flex justify-between py-1">
                <span className="text-muted-foreground">السعر عند السقف</span>
                <span className="tabular-nums font-bold" dir="ltr">
                  {fmt(result.worst_case.price)} د.ل
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-muted-foreground">الربح الإجمالي</span>
                <span
                  className={`tabular-nums font-bold ${
                    result.worst_case.gross_lyd == null
                      ? "text-muted-foreground"
                      : result.worst_case.gross_lyd < 0
                        ? "text-destructive"
                        : ""
                  }`}
                  dir="ltr"
                >
                  {result.worst_case.gross_lyd == null
                    ? "—"
                    : `${result.worst_case.gross_lyd >= 0 ? "+" : ""}${fmt(result.worst_case.gross_lyd)} د.ل`}
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-muted-foreground">المساهمة بعد نقاط الولاء</span>
                <span
                  className={`tabular-nums font-bold ${
                    result.worst_case.contribution_lyd == null
                      ? "text-muted-foreground"
                      : result.worst_case.contribution_lyd < 0
                        ? "text-destructive"
                        : ""
                  }`}
                  dir="ltr"
                >
                  {result.worst_case.contribution_lyd == null
                    ? "—"
                    : `${result.worst_case.contribution_lyd >= 0 ? "+" : ""}${fmt(result.worst_case.contribution_lyd)} د.ل`}
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-muted-foreground">المساهمة بعد تكلفة الإحالة</span>
                <span
                  className={`tabular-nums font-bold ${
                    result.worst_case.referred_contribution_lyd == null
                      ? "text-muted-foreground"
                      : result.worst_case.referred_contribution_lyd < 0
                        ? "text-destructive"
                        : ""
                  }`}
                  dir="ltr"
                >
                  {result.worst_case.referred_contribution_lyd == null
                    ? "—"
                    : `${result.worst_case.referred_contribution_lyd >= 0 ? "+" : ""}${fmt(result.worst_case.referred_contribution_lyd)} د.ل`}
                </span>
              </div>
            </div>
          </div>

          {/* R115 (Part 15): the guardrails block — break-even,
              the program-inclusive safe minimum, and the max safe
              discount at the current price. */}
          <div className="border-t border-border/40 pt-3">
            <div className="flex items-center gap-1.5 mb-2">
              <Shield className="w-3.5 h-3.5 text-primary shrink-0" />
              <h3 className="text-xs font-bold">حدود الأمان</h3>
            </div>
            <div className="space-y-1 text-2xs">
              <div className="flex justify-between py-1">
                <span className="text-muted-foreground">سعر التعادل (التكلفة)</span>
                <span className="tabular-nums font-bold" dir="ltr">
                  {result.guardrails.break_even_price == null
                    ? "—"
                    : `${fmt(result.guardrails.break_even_price)} د.ل`}
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-muted-foreground">
                  الحد الأدنى الآمن (شامل الولاء والإحالة)
                </span>
                <span className="tabular-nums font-bold" dir="ltr">
                  {result.guardrails.safe_min_price_incl_program == null
                    ? "—"
                    : `${fmt(result.guardrails.safe_min_price_incl_program)} د.ل`}
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-muted-foreground">أقصى خصم آمن على السعر الحالي</span>
                <span className="tabular-nums font-bold" dir="ltr">
                  {result.guardrails.max_safe_discount_pct == null
                    ? "—"
                    : `${fmt(result.guardrails.max_safe_discount_pct, 1)}%`}
                </span>
              </div>
            </div>
          </div>

          {/* R115: the applied config line — the operator sees
              WHICH rule produced these numbers (incl. the discount
              cap that bounds the worst-case above). */}
          <p className="text-3xs text-muted-foreground border-t border-border/40 pt-2 leading-relaxed">
            القاعدة المطبَّقة: 1$ = {fmt(result.config.usd_to_lyd)} د.ل · هامش{" "}
            {fmtFactor(result.config.markup_percent)}% · سقف الخصم المجمّع{" "}
            {result.config.max_total_discount_pct}%
          </p>

          {/* Warnings */}
          {result.warnings.length > 0 && (
            <div className="border-t border-border/40 pt-3 space-y-2">
              {result.warnings.map((w, i) => {
                const tone =
                  w.severity === "loss"
                    ? "border-destructive/40 bg-destructive/10 text-destructive"
                    : w.severity === "low_margin"
                      ? "border-status-warning/40 bg-status-warning/10 text-status-warning"
                      : w.severity === "cap"
                        ? "border-status-purple/40 bg-status-purple/10 text-status-purple"
                        : "border-status-info/40 bg-status-info/10 text-status-info";
                return (
                  <div
                    key={i}
                    className={`flex items-start gap-2 p-2.5 border rounded-lg text-2xs ${tone}`}
                  >
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span className="font-semibold">{w.message_ar}</span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
