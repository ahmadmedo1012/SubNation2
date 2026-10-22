import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertCircle, ArrowUpLeft, Zap } from "lucide-react";
import { formatCount, formatCurrency } from "@/lib/utils";
import type { LoyaltyData } from "./loyalty-meta";

// R137 (FE decomposition): extracted verbatim from pages/loyalty.tsx —
// the points-conversion card (rate copy + the persistent failure
// banner + the below-minimum branch or the convert form with its live
// validation + preview). Presentational shell only: the money path —
// handleConvert with the min/multiples gates, the durable
// convert-intent key lifecycle (loyalty-convert-key.ts) and the
// post-success cache invalidations — stays IN the page; the draft
// (convertPoints), the in-flight flag, the persistent error text and
// the page-computed convertValidation flow DOWN as values + one
// change/submit callback each. The move only changes its address; DOM,
// classes, Arabic copy and event semantics are byte-identical.

export function ConvertPointsCard({
  data,
  pointsPerLyd,
  convertPoints,
  onConvertPointsChange,
  converting,
  convertError,
  convertValidation,
  onConvert,
}: {
  data: LoyaltyData;
  pointsPerLyd: number;
  convertPoints: string;
  onConvertPointsChange: (value: string) => void;
  converting: boolean;
  convertError: string | null;
  convertValidation: string | null;
  onConvert: (e: React.FormEvent) => void;
}) {
  return (
    <div className="bg-card border border-border/60 rounded-2xl p-5 float-in stagger-4">
      <div className="flex items-center gap-2.5 mb-2">
        <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/15 flex items-center justify-center">
          <Zap className="w-4 h-4 text-primary" />
        </div>
        <h2 className="font-bold">تحويل النقاط إلى رصيد</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-4 me-10">
        كل <span className="font-bold text-foreground">{data.points_rate.points_per_lyd} نقطة</span>{" "}
        = <span className="font-bold text-primary-text">1 د.ل</span>
      </p>

      {/* Persistent conversion failure (B4 P1-7): cleared only when a
          new attempt starts — a 4-second toast lost money-action
          errors on this exact card. */}
      {convertError && (
        <div
          role="alert"
          className="mb-4 flex items-center gap-2.5 p-3.5 bg-status-error/10 border border-status-error/25 rounded-xl text-sm text-status-error font-bold"
        >
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="leading-relaxed">تعذّر التحويل: {convertError}</span>
        </div>
      )}

      {data.points < pointsPerLyd ? (
        <div className="flex items-center gap-3 p-3.5 bg-muted/35 rounded-xl text-sm text-muted-foreground">
          <ArrowUpLeft className="w-4 h-4 shrink-0 text-primary" />
          <span>
            تحتاج إلى{" "}
            {/* R111-F2 C2: tier remainder is ANY number — a frozen
                «نقطة» was wrong for 3-10 (should be «نقاط»). Routed
                through the shared formatCount plural engine like the
                20+ other count sites (utils.ts:49). R115: the
                threshold itself is the API's points_per_lyd. */}
            <span className="font-bold text-foreground">
              {formatCount(pointsPerLyd - data.points, {
                few: "نقاط",
                many: "نقطة",
                other: "نقطة",
              })}
            </span>{" "}
            إضافية للوصول للحد الأدنى ({pointsPerLyd} نقطة)
          </span>
        </div>
      ) : (
        <form onSubmit={onConvert} className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <Input
              /* R124-I1 (A4 P3): the R96 wallet keyboard contract
                 (wallet.tsx's amount field) — the storefront's last
                 type="number" still accepted e/+ on desktop, fired
                 no sensible mobile Enter label and invited browser
                 autofill into a points field. type="text" +
                 inputMode="numeric" + autoComplete="off" +
                 enterKeyHint="done" instead; the min/multiples
                 rules stay enforced by convertValidation +
                 handleConvert's own gates (the numeric attrs are
                 inert on text inputs but kept as the declared
                 domain — the wallet amount field's pattern). */
              type="text"
              inputMode="numeric"
              autoComplete="off"
              enterKeyHint="done"
              min={pointsPerLyd}
              max={Math.floor(data.points / pointsPerLyd) * pointsPerLyd}
              step={pointsPerLyd}
              /* R159 (audit-2): ASCII "..." → «…» — the storefront copy
                  dialect (DESIGN.md Copy dialects); pinned twin updated with
                 the source. */
              placeholder={`عدد النقاط (${pointsPerLyd}، ${pointsPerLyd * 2}، …)`}
              /* R182 (Lane-C D2): placeholder is not a persistent accessible
                 name (disappears as fallback once the user types) — this
                 money-action field converts points → wallet credit and
                 already carries aria-invalid/describedby; only the name was
                 missing (the PaymentReferenceField A4 P3 #37 class). */
              aria-label="عدد النقاط للتحويل"
              value={convertPoints}
              onChange={(e) => onConvertPointsChange(e.target.value)}
              dir="ltr"
              aria-invalid={convertValidation !== null}
              aria-describedby={convertValidation ? "convert-input-validation" : undefined}
              className="text-left h-11"
            />
            {/* R115 (A8 #10): persistent inline WHY-invalid text —
                shown while the value breaks the min/multiples rules,
                not only as a post-submit toast. */}
            {convertValidation && (
              <p
                id="convert-input-validation"
                className="text-xs text-destructive mt-1.5 px-1"
                role="note"
              >
                {convertValidation}
              </p>
            )}
            {convertPoints &&
              !convertValidation &&
              (() => {
                /* R94-A1 #14 (P3): the preview hardcoded /100 AND showed
                 * for non-multiple values the server rejects (150 →
                 * «1.50 د.ل» then 400 «يجب أن تكون النقاط من مضاعفات
                 * 100»). Use the live rate (same field as the gates)
                 * and only preview server-acceptable multiples. */
                const rate = data.points_rate.points_per_lyd;
                const points = parseInt(convertPoints) || 0;
                if (!rate || points < rate || points % rate !== 0) return null;
                return (
                  <p className="text-xs text-status-success mt-1.5 px-1 font-bold tabular-nums">
                    {/* R139 (precision): tabular-nums — money preview
                        (the receipt register; the success ink stays —
                        the gains/discount-reads-positive exception). */}
                    ستحصل على {formatCurrency(points / rate)}
                  </p>
                );
              })()}
          </div>
          <Button
            type="submit"
            disabled={converting || !convertPoints}
            /* R139 (precision): de-hand-rolled — bg-primary/
               hover:bg-primary/90/active:scale-95/transition-all were
               re-implementing buttonVariants on top of Button (the
               R116-S1 ban); the default variant owns fill, hover,
               press-spring and the ONE focus system now. h-11 keeps the
               44px storefront floor. The journey (gates, intent key,
               invalidations) is byte-identical — pinned by
               loyalty-convert-journey. */
            className="shrink-0 h-11 px-5 font-bold"
          >
            {converting ? "جارٍ…" : "تحويل"}
          </Button>
        </form>
      )}
    </div>
  );
}
