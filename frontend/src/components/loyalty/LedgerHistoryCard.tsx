import { History, Star } from "lucide-react";
import { FetchErrorCard } from "@/components/ui/fetch-error-card";
import { arabicCountWord, formatCount, formatCurrency, formatDate } from "@/lib/utils";
import type { PointsLedgerEntry } from "./loyalty-meta";

// R137 (FE decomposition): extracted verbatim from pages/loyalty.tsx —
// the points-history card (the ledger rows / loading skeleton / honest
// error-with-retry / empty state). Presentational only: the ledger
// query stays in the page — history/historyLoading/historyError flow
// down as values and the retry resolves through the page-owned onRetry
// callback (ledgerQ.refetch). The move only changes its address; DOM,
// classes, Arabic copy and the R134 (A2-F2) plural-noun deltas are
// byte-identical.

export function LedgerHistoryCard({
  history,
  historyLoading,
  historyError,
  onRetry,
}: {
  history: PointsLedgerEntry[];
  historyLoading: boolean;
  historyError: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="bg-card border border-border/60 rounded-2xl p-5 float-in stagger-6">
      <div className="flex items-center gap-2.5 mb-4">
        <History className="w-4 h-4 text-muted-foreground" />
        <h2 className="font-bold text-sm">سجل النقاط</h2>
        {history.length > 0 && (
          <span className="mr-auto text-xs text-muted-foreground font-semibold">
            {formatCount(history.length, {
              one: "حركة",
              two: "حركتان",
              few: "حركات",
              many: "حركة",
              other: "حركة",
            })}
          </span>
        )}
      </div>

      {historyLoading ? (
        /* R139 (precision): the skeleton mirrors the hairline receipt
           rows it previews (divide-y /20 + plain py rows). */
        <div className="divide-y divide-border/20">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 py-3">
              <div className="w-7 h-7 rounded-lg bg-muted skeleton-shimmer shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 bg-muted skeleton-shimmer rounded-full w-2/5" />
                <div className="h-2.5 bg-muted/70 skeleton-shimmer rounded-full w-1/3" />
              </div>
              <div className="h-5 w-14 bg-muted skeleton-shimmer rounded-full shrink-0" />
            </div>
          ))}
        </div>
      ) : historyError ? (
        /* Same idiom as the page-level error branch: an outage is
           NOT «لا توجد حركات» — retry offered, stats above stay. */
        <FetchErrorCard
          size="compact"
          title="تعذّر تحميل سجل النقاط"
          description="حدث خطأ في الاتصال — أعد المحاولة لعرض حركات نقاطك"
          onRetry={onRetry}
        />
      ) : history.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground">
          {/* R139 (precision): the empty stage joins the r138-h icon
              stage values (muted/60 tile + /35 edge + /35 glyph +
              /85 title). */}
          <div className="w-14 h-14 rounded-2xl bg-muted/60 border border-border/35 flex items-center justify-center mx-auto mb-3.5">
            <Star className="w-6 h-6 opacity-35" />
          </div>
          <p className="font-bold text-sm mb-1 text-foreground/85">لا توجد حركات نقاط بعد</p>
          <p className="text-xs text-muted-foreground max-w-[220px] mx-auto leading-relaxed">
            ستظهر هنا نقاط الشراء والإحالة والتحويل
          </p>
        </div>
      ) : (
        /* R139 (precision): the POINTS HISTORY rides the receipt
           rhythm — the wallet statement's twin (§4: the loyalty page
           shows the points history; balances stay explainable).
           divide-y /20 hairlines replace the boxed chip rows; the row
           drops its hover wash (read-only accountability lines). */
        <div className="divide-y divide-border/20 lg:max-h-[420px] overflow-y-auto scrollbar-none">
          {history.map((e, i) => {
            const delta = e.points_delta ?? 0;
            const gain = delta >= 0;
            return (
              <div
                key={e.id ?? i}
                className={`float-in stagger-${Math.min(i, 8)} flex items-center gap-3 py-3`}
              >
                <div className="flex-1 min-w-0">
                  {/* R139 (precision): receipt ladder — the identifier
                      drops to 600 so the signed points datum (700 + the
                      size step below) leads; emphasis by weight+size. */}
                  <div className="text-xs font-semibold mb-0.5">
                    {e.type_label ?? e.type ?? "حركة"}
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {typeof e.points_after === "number" && (
                      <span className="text-3xs text-muted-foreground tabular-nums">
                        الرصيد: {e.points_after}
                      </span>
                    )}
                    {/* conversion rows pin the LYD they yielded
                        (lyd_credited) — the rate snapshot in the
                        ledger row itself. */}
                    {typeof e.lyd_credited === "number" && (
                      <span
                        dir="ltr"
                        className="text-3xs text-status-success font-bold tabular-nums"
                      >
                        +{formatCurrency(e.lyd_credited)}
                      </span>
                    )}
                    {e.created_at && (
                      <span className="text-3xs text-muted-foreground">
                        · {formatDate(e.created_at)}
                      </span>
                    )}
                  </div>
                </div>
                <span className="flex items-center gap-1 shrink-0">
                  {/* dir="ltr": the sign must lead the number inside
                      the RTL layout; the unit sits in the RTL flow.
                      R139 (precision): the delta joins the statement's
                      ink ladder (gains full foreground / losses one
                      step quieter — weight+size, never hue; the signed
                      run + the plural noun carry the direction). The
                      points BALANCE tile above keeps its warning tint
                      (the loyalty identity the mission sanctions). */}
                  <span
                    dir="ltr"
                    className={`text-sm font-bold tabular-nums ${
                      gain ? "text-foreground" : "text-foreground/80"
                    }`}
                  >
                    {gain ? "+" : "-"}
                    {Math.abs(delta)}
                  </span>
                  {/* R134 (A2-F2): the delta noun agrees with its
                      magnitude (±2 → نقطتان، ±3–10 → نقاط، ±11+ →
                      نقطة) — the frozen «نقطة» was the twin of the
                      wallet card's straggler. Word-only form so the
                      dir="ltr" signed number span keeps its shape. */}
                  <span className="text-3xs text-muted-foreground">
                    {arabicCountWord(Math.abs(delta), {
                      one: "نقطة",
                      two: "نقطتان",
                      few: "نقاط",
                      many: "نقطة",
                      other: "نقطة",
                    })}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
