import type { Dispatch, SetStateAction } from "react";
import {
  AlertTriangle,
  Eye,
  Info,
  Loader2,
  RefreshCw,
  Save,
  SlidersHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency } from "@/lib/utils";
import { fmtFactor } from "@/components/admin/pricing/pricing-format";

// R137 (FE decomposition): extracted verbatim from pages/admin/pricing.tsx —
// the WRITABLE «إعدادات التسعير العامة» card (rule inputs + formula
// explainer + save / preview / recompute toolbar). Every state atom
// (rateInput/markupInput/capInput + their validity gates) and every WRITE
// path (saveConfig → PUT /config, previewRecompute → POST /recompute
// ?dry_run=true, recomputeCatalog → the destructive POST /recompute behind
// its confirm gate) stays centralized in the page — this extract renders
// values and calls page-owned callbacks/setters passed down as props. The
// move only changes its address; DOM, classes, Arabic copy and aria are
// byte-identical.

export function PricingConfigCard({
  configLoading,
  configLoadError,
  onRetryConfig,
  rateInput,
  setRateInput,
  rateValid,
  markupInput,
  setMarkupInput,
  markupValid,
  capInput,
  setCapInput,
  capValid,
  exampleFactor,
  exampleRate,
  examplePrice,
  canSaveConfig,
  saveConfigPending,
  onSaveConfig,
  dryRunLoading,
  onPreviewRecompute,
  recomputePending,
  onRecomputeCatalog,
}: {
  configLoading: boolean;
  configLoadError: boolean;
  onRetryConfig: () => void;
  rateInput: string;
  setRateInput: Dispatch<SetStateAction<string>>;
  rateValid: boolean;
  markupInput: string;
  setMarkupInput: Dispatch<SetStateAction<string>>;
  markupValid: boolean;
  capInput: string;
  setCapInput: Dispatch<SetStateAction<string>>;
  capValid: boolean;
  exampleFactor: number;
  exampleRate: number;
  examplePrice: number;
  canSaveConfig: boolean;
  saveConfigPending: boolean;
  onSaveConfig: () => void;
  dryRunLoading: boolean;
  onPreviewRecompute: () => void;
  recomputePending: boolean;
  onRecomputeCatalog: () => void;
}) {
  return (
    <div className="bg-card border border-primary/25 rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
            <SlidersHorizontal className="w-4 h-4 text-primary" />
          </div>
          <div className="min-w-0">
            <h2 className="font-bold text-sm">إعدادات التسعير العامة</h2>
            <p className="text-3xs text-muted-foreground truncate">
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
            onClick={onRetryConfig}
            className="text-xs text-destructive underline underline-offset-2 shrink-0"
          >
            حاول مجدداً
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

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <Label
            htmlFor="pricing-config-rate"
            className="text-xs font-bold text-muted-foreground mb-1.5 block"
          >
            سعر الصرف — دينار لكل دولار ($1 =)
          </Label>
          <Input
            id="pricing-config-rate"
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
            <p className="text-3xs text-destructive font-bold mt-1" role="alert">
              سعر الصرف يجب أن يكون بين 0.1 و 1000
            </p>
          )}
        </div>
        <div>
          <Label
            htmlFor="pricing-config-markup"
            className="text-xs font-bold text-muted-foreground mb-1.5 block"
          >
            الهامش على التكلفة (%)
          </Label>
          <Input
            id="pricing-config-markup"
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
            <p className="text-3xs text-destructive font-bold mt-1" role="alert">
              الهامش يجب أن يكون بين 0 و 10000
            </p>
          )}
        </div>
        <div>
          <Label
            htmlFor="pricing-config-cap"
            className="text-xs font-bold text-muted-foreground mb-1.5 block"
          >
            سقف الخصم المجمّع (%)
          </Label>
          <Input
            id="pricing-config-cap"
            type="number"
            min="10"
            max="95"
            step="1"
            value={capInput}
            onChange={(e) => setCapInput(e.target.value)}
            dir="ltr"
            placeholder="50"
            disabled={configLoading}
          />
          {capInput !== "" && !capValid && (
            <p className="text-3xs text-destructive font-bold mt-1" role="alert">
              سقف الخصم يجب أن يكون بين 10 و 95
            </p>
          )}
          {/* R115 (policy 7): the stacking guardrail explainer — one
              line, the break-even intuition included. */}
          <p className="text-3xs text-muted-foreground mt-1 leading-relaxed">
            سقف الخصم المجمّع (تخفيضات + كوبون) — 50% = خط التعادل عند هامش 100%
          </p>
        </div>
      </div>

      {/* Formula explainer — live numbers so the operator sees the
          effect BEFORE saving (defaults: $5 × 2 × 10 = 100 د.ل). */}
      <div className="flex items-start gap-2.5 p-3 bg-muted/20 border border-border/40 rounded-xl">
        <Info className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
        <p className="text-2xs leading-relaxed">
          <span className="font-bold">السعر = التكلفة × (1 + الهامش %) × سعر الصرف</span>
          <span className="text-muted-foreground">
            {" "}
            — مثال: $5 × {fmtFactor(exampleFactor)} × {fmtFactor(exampleRate)} ={" "}
            {formatCurrency(examplePrice)}
          </span>
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={onSaveConfig}
          disabled={!canSaveConfig || saveConfigPending}
          className="bg-primary hover:bg-primary/90 active:scale-[0.97] transition-transform"
        >
          {saveConfigPending ? (
            <Loader2 className="w-4 h-4 ml-1.5 animate-spin" />
          ) : (
            <Save className="w-4 h-4 ml-1.5" />
          )}
          {saveConfigPending ? "جارٍ الحفظ…" : "حفظ الإعدادات"}
        </Button>
        {/* Step 1 of the two-step recompute (R115): a ZERO-WRITE
            preview — counts + a BEFORE→AFTER sample — before the
            destructive action is even considered. */}
        <Button
          variant="outline"
          onClick={onPreviewRecompute}
          disabled={dryRunLoading || recomputePending}
          className="text-status-warning border-status-warning/25 hover:bg-status-warning/10 active:scale-[0.97] transition-transform"
        >
          {dryRunLoading ? (
            <Loader2 className="w-4 h-4 ml-1.5 animate-spin" />
          ) : (
            <Eye className="w-4 h-4 ml-1.5" />
          )}
          {dryRunLoading ? "جارٍ المعاينة…" : "معاينة التغييرات"}
        </Button>
        <Button
          variant="outline"
          onClick={onRecomputeCatalog}
          disabled={recomputePending || dryRunLoading}
          className="text-primary border-primary/25 hover:bg-primary/10 active:scale-[0.97] transition-transform"
        >
          {recomputePending ? (
            <Loader2 className="w-4 h-4 ml-1.5 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4 ml-1.5" />
          )}
          {recomputePending ? "جارٍ الاحتساب…" : "إعادة احتساب أسعار الكتالوج"}
        </Button>
        <p className="basis-full text-3xs text-muted-foreground">
          حفظ الإعدادات لا يغيّر الأسعار المخزّنة — «معاينة التغييرات» تعرض الأثر المتوقع دون تعديل
          أي سعر، و«إعادة احتساب أسعار الكتالوج» هي التي تعيد تسعير كل الباقات من تكاليفها بالقاعدة
          الحالية وتُحدّث أسعار العرض.
        </p>
      </div>
    </div>
  );
}
