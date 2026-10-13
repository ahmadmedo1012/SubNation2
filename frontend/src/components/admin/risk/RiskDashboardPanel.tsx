import { FetchErrorCard } from "@/components/ui/fetch-error-card";
import { getErrorMessage } from "@/lib/errors";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { type DashboardResponse } from "@/components/admin/risk/risk-meta";
import { DashCard } from "@/components/admin/risk/DashCard";

// R137 (FE decomposition): extracted verbatim from pages/admin/risk.tsx —
// the dashboard stats panel: the R133 (A3-F2) triad (skeleton → error
// card → stale banner), the four DashCard tiles (including the
// RISK_PIPELINE_ENABLED verdict) and the top-rules strip. Every query
// state (isPending / isError / data / error) is a page value passed DOWN
// and the retry fires through the page-owned onRetry (the dashboard
// query itself stays in the page); the tile derivations are
// value-local and ride along verbatim. The move only changes its
// address; DOM, classes, aria and Arabic copy are byte-identical.

export function RiskDashboardPanel({
  isPending,
  isError,
  data,
  error,
  onRetry,
}: {
  isPending: boolean;
  isError: boolean;
  data: DashboardResponse | undefined;
  error: Error | null;
  onRetry: () => void;
}) {
  return (
    <>
      {/* Dashboard stats — R133 (A3-F2): the tiles had no loading/error/
            stale branch. A first-load failure dropped the whole panel
            (including the RISK_PIPELINE_ENABLED verdict tile) while the
            events list 100px below shipped the full triad, and a refresh
            failure kept stale critical/high counts with no cue. Mirrors
            the events triad below: skeleton → error card → stale banner. */}
      {isPending && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            /* R139 (precision): the skeleton tiles mirror the loaded
               DashCard chrome (border/60 + solid bg-card) so the
               loading→loaded swap never flashes a translucent frame
               (the MetricCard skeleton-mirror rule). */
            <div key={i} className="border border-border/60 rounded-xl p-3 bg-card">
              <div className="h-3 w-20 rounded-md skeleton-shimmer" />
              <div className="h-6 w-12 rounded-md skeleton-shimmer mt-1.5" />
            </div>
          ))}
        </div>
      )}
      {isError && !data && (
        <FetchErrorCard
          size="page"
          retryIcon={RefreshCw}
          title="تعذّر تحميل لوحة المؤشرات"
          description={`${getErrorMessage(error)} — تحقّق من شبكتك ثم أعد المحاولة`}
          onRetry={() => void onRetry()}
        />
      )}
      {/* A refresh of already-rendered tiles failed — keep the stale
            numbers, surface the failure inline (the events stale-banner
            idiom; warning ink because "stale" is a caution, not an error). */}
      {isError && data && (
        <div
          role="alert"
          className="p-3 rounded-xl bg-status-warning/10 border border-status-warning/30 text-status-warning text-xs font-bold flex items-center gap-2"
        >
          <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0">تعذّر تحديث المؤشرات — الأرقام المعروضة قديمة</span>
          <button
            type="button"
            onClick={() => void onRetry()}
            className="ms-auto underline underline-offset-2 hover:opacity-80"
          >
            إعادة المحاولة
          </button>
        </div>
      )}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <DashCard
            label={`إجمالي ${data.window_hours} ساعة`}
            value={String(data.total)}
            hint={
              data.pipeline.enabled
                ? "خط الأنابيب مفعَّل"
                : "خط الأنابيب معطَّل (RISK_PIPELINE_ENABLED=false)"
            }
            tone={data.pipeline.enabled ? "ok" : "warn"}
          />
          <DashCard
            label="حرج"
            value={String(data.by_level.critical ?? 0)}
            tone={(data.by_level.critical ?? 0) > 0 ? "danger" : "ok"}
          />
          <DashCard
            label="عالي"
            value={String(data.by_level.high ?? 0)}
            tone={(data.by_level.high ?? 0) > 0 ? "warn" : "ok"}
          />
          <DashCard
            label="بدون تصنيف"
            value={String(data.unresolved)}
            hint="لم تُصنَّف بعد"
            tone={data.unresolved > 0 ? "warn" : "ok"}
          />
        </div>
      )}
      {data && data.top_rules.length > 0 && (
        /* R139 (precision): the strip solidifies — bg-card/60 → bg-card
           + edge /40 → /60 (the resting family; the r138 translucent
           retirement). */
        <div className="border border-border/60 rounded-2xl bg-card p-3">
          <div className="text-xs text-muted-foreground mb-2 font-bold">
            أكثر القواعد إطلاقاً (24 ساعة)
          </div>
          <div className="flex flex-wrap gap-1.5">
            {data.top_rules.map((r) => (
              <span
                key={r.rule}
                className="text-2xs font-mono bg-muted/40 border border-border/40 rounded-lg px-2 py-1"
              >
                {r.rule}
                <span className="opacity-60 mr-1.5">×{r.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
