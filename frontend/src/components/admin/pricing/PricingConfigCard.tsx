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
    /* R139 (precision): the WRITABLE rule card is the pricing page's one
       prominent surface — the brand-tinted border-primary/25 edge joins the
       resting border/60 family and the card adopts the r138 two-layer calm
       elevation at rest (the ProductEditorCard / MetricCard recipe,
       neutral black — a primary-tinted shadow reads as color on .light).
       The read-only calculator cards below stay flat: one elevated
       register per page. */
    <div className="bg-card border border-border/60 rounded-2xl p-5 space-y-4 shadow-[0_1px_2px_rgb(0_0_0/0.3),0_10px_28px_-14px_rgb(0_0_0/0.4)]">
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
            /* R139 (precision): text-destructive → text-status-error — the
               page's red vocabulary is the --status-error family (the
               configLoadError alert below already rode it); severity ink
               stays, the raw channel goes. */
            className="text-xs text-status-error underline underline-offset-2 shrink-0"
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
            <p className="text-3xs text-status-error font-bold mt-1" role="alert">
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
            <p className="text-3xs text-status-error font-bold mt-1" role="alert">
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
            <p className="text-3xs text-status-error font-bold mt-1" role="alert">
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
      {/* R139 (precision): bg-muted/20 → /60 — the explainer joins the
          r138 well family (quiet inset on the now-solid card, the
          enrichment copy-well register). */}
      <div className="flex items-start gap-2.5 p-3 bg-muted/60 border border-border/40 rounded-xl">
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
          /* R139 (precision): canonical — the hand-rolled bg-primary +
             hover:bg-primary/90 + active:scale override is dropped so the
             CTA rides buttonVariants verbatim (the R116-S1 canonical
             route: gradient fill, shadow-md shadow-primary/25,
             press-spring, ONE focus system). Handler/disabled/spinner
             byte-identical. */
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
        {/* R139 (precision): canonical — the resting warning ink + tinted
            border (step-1 is a SAFE zero-write action, not a status) is
            dropped for the plain outline Button register; the two-step
            severity lives in the preview card + the destructive confirm,
            not on this trigger. */}
        <Button
          variant="outline"
          onClick={onPreviewRecompute}
          disabled={dryRunLoading || recomputePending}
        >
          {dryRunLoading ? (
            <Loader2 className="w-4 h-4 ml-1.5 animate-spin" />
          ) : (
            <Eye className="w-4 h-4 ml-1.5" />
          )}
          {dryRunLoading ? "جارٍ المعاينة…" : "معاينة التغييرات"}
        </Button>
        {/* R139 (precision): quiet danger at rest — the APPLY step (the
           destructive POST /recompute behind its confirm gate) drops its
           resting primary ink/tint for the neutral family
           (border-border/60 + muted ink); the error ink surfaces on
           hover only, and the severity itself lives in the confirm
           dialog's destructive:true (the topups bulk-reject recipe).
           Handler/disabled/spinner byte-identical. */}
        <Button
          variant="outline"
          onClick={onRecomputeCatalog}
          disabled={recomputePending || dryRunLoading}
          className="border-border/60 text-muted-foreground hover:text-status-error hover:border-status-error/30 hover:bg-status-error/10"
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
