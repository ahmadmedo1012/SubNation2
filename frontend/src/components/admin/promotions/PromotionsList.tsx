import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/utils";
import { AlertCircle, CheckCircle, Clock, Pause, Play, RefreshCw, Trash2, Zap } from "lucide-react";
import { type FlashSale } from "@/components/admin/promotions/promotions-meta";

// R137 (FE decomposition): extracted verbatim from pages/admin/promotions.tsx —
// the sales history section: the «السجل» header with its honest count,
// the loading skeleton, the 94-C2 error card with retry, the empty
// state, and the sale rows (active/expired/stopped pills + the
// activate/stop/delete actions). The activate PATCH (money-gated confirm
// in the page), the confirm-gated stop-and-archive DELETE and the reload stay
// in the page — this shell takes the rows + the loading/error values
// down and reports taps through onToggleActive/onDelete (page-owned
// handlers); the per-row endsAt/expired derivations are row-local and
// ride along verbatim. The move only changes its address; DOM, classes,
// aria and Arabic copy are byte-identical.

export function PromotionsList({
  sales,
  loading,
  loadError,
  onRetry,
  busyIds,
  onToggleActive,
  onDelete,
}: {
  sales: FlashSale[];
  loading: boolean;
  loadError: string | null;
  onRetry: () => void;
  /** R147 (2-c D3) + R187 (D-F5): the page's per-row busy Set — the
   *  in-flight rows' activate/stop/delete buttons disable + spin (the
   *  CouponsTable toggling/archiving idiom), and overlapping actions
   *  on different rows no longer clear each other's busy state. */
  busyIds: Set<number>;
  onToggleActive: (sale: FlashSale, next: boolean) => void;
  /** R187 (D-F2): the stop-and-archive DELETE (backend soft-deactivates) — confirm-gated in the page. */
  onDelete: (sale: FlashSale) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-bold">السجل</h2>
        <span className="text-3xs text-muted-foreground">
          {sales.length} {sales.length === 1 ? "عرض" : "عروض"}
        </span>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 rounded-2xl skeleton-shimmer" />
          ))}
        </div>
      ) : (
        <>
          {/* R187 (D-F6): the load-failure banner rides ABOVE whatever
              rows already exist (the coupons.tsx:394 idiom) — the old
              `loadError && sales.length === 0` gate made a failed
              background refetch SILENT while stale rows stayed rendered.
              94-C2 (A2 P2-9) keeps its truth: a failed first load is an
              error surface with retry — NOT the "no promotions yet"
              empty state; role="alert" announces the async failure. */}
          {loadError && (
            <div
              role="alert"
              className="mb-2 p-4 rounded-2xl bg-card border border-border/60 flex items-center gap-3"
            >
              <div className="w-9 h-9 rounded-xl bg-status-error/8 border border-status-error/22 flex items-center justify-center shrink-0">
                <AlertCircle className="w-4 h-4 text-status-error" />
              </div>
              <span className="min-w-0 text-sm font-bold text-foreground/80">{loadError}</span>
              <button
                type="button"
                onClick={() => void onRetry()}
                className="ms-auto shrink-0 text-xs font-bold text-status-error underline underline-offset-2 hover:opacity-80"
              >
                إعادة المحاولة
              </button>
            </div>
          )}
          {sales.length === 0 && !loadError ? (
            <div className="bg-card border border-border/60 rounded-2xl p-8 text-center">
              <Zap className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm font-bold mb-1">لا توجد عروض بعد</p>
              <p className="text-xs text-muted-foreground">
                اضغط "إنشاء عرض" لإطلاق أول حملة تخفيضات.
              </p>
            </div>
          ) : sales.length > 0 ? (
            sales.map((s) => {
              const endsAt = new Date(s.ends_at);
              const expired = endsAt.getTime() < Date.now();
              return (
                <div
                  key={s.id}
                  /* R139 (precision): the active sale drops the ring — the calm
                 tinted-selected register (border-status-success/30 + a
                 bg-status-success/5 wash, the ProductCard selected recipe):
                 no ring, no colored shadow; the «نشط» pill + the border
                 carry the active read. Resting rows join the /60 edge. */
                  className={`bg-card border rounded-2xl p-4 ${
                    s.is_currently_active
                      ? "border-status-success/30 bg-status-success/5"
                      : "border-border/60"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-bold text-sm truncate">{s.title}</h3>
                        {s.is_currently_active && (
                          <span className="text-3xs font-bold bg-status-success/15 text-status-success border border-status-success/25 px-1.5 py-0.5 rounded-full flex items-center gap-1">
                            <CheckCircle className="w-2.5 h-2.5" /> نشط
                          </span>
                        )}
                        {expired && s.is_active && (
                          <span className="text-3xs font-bold bg-status-warning/15 text-status-warning border border-status-warning/25 px-1.5 py-0.5 rounded-full">
                            منتهٍ — في انتظار التنظيف التلقائي
                          </span>
                        )}
                        {!s.is_active && (
                          /* R139 (precision): the stopped pill's full-strength
                         border-border edge joins the neutral StatusBadge
                         register (border-border/50 on bg-muted/45 — the
                         value every neutral pill in the family rides). */
                          <span className="text-3xs font-bold bg-muted/40 text-muted-foreground border border-border/50 px-1.5 py-0.5 rounded-full">
                            متوقف
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                        {/* R139 (precision): receipt register on the discount
                        number — weight (700) + tabular-nums carry it, not
                        the brand tint (a % is not a status; the
                        OrdersHeader revenue-chip rule); font-mono drops
                        with the tint — tabular-nums is the money-digit
                        convention. */}
                        <span className="font-bold tabular-nums">{s.discount_percent}% خصم</span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {/* 93-C6 / F-06 (PR-1): formatRelativeTime now
                              carries its own direction wording —
                              «ينتهي خلال ساعتين» for a live sale,
                              «انتهى قبل 5 دقائق» for a finished one.
                              The old hand-prefixed `قبل ${…}` produced
                              «ينتهي الآن» for every ACTIVE sale (future
                              dates hit the now-branch) and the
                              ungrammatical «قبل منذ …» for past ones. */}
                          {expired
                            ? `انتهى ${formatRelativeTime(s.ends_at)}`
                            : `ينتهي ${formatRelativeTime(s.ends_at)}`}
                        </span>
                        <span className="text-3xs opacity-60">#{s.id}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {/* R147 (2-c D3): the in-flight row's buttons disable +
                      swap to the RefreshCw spinner (the CouponsTable
                      per-row busy idiom) — a double-click cannot re-fire
                      the store-repricing PATCH / the archive DELETE. */}
                      {s.is_active ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onToggleActive(s, false)}
                          disabled={busyIds.has(s.id)}
                          className="gap-1.5"
                        >
                          {busyIds.has(s.id) ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Pause className="w-3.5 h-3.5" />
                          )}{" "}
                          إيقاف
                        </Button>
                      ) : (
                        !expired && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onToggleActive(s, true)}
                            disabled={busyIds.has(s.id)}
                            className="gap-1.5"
                          >
                            {busyIds.has(s.id) ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Play className="w-3.5 h-3.5" />
                            )}{" "}
                            تفعيل
                          </Button>
                        )
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onDelete(s)}
                        disabled={busyIds.has(s.id)}
                        /* R187 (D-F2): the row action names the honest verb —
                           the backend DELETE soft-deactivates (the row
                           يبقى في السجل; التفعيل restores it), so the
                           «حذف نهائي» over-promise is gone. Sits beside
                           the plain «إيقاف» with the archive word
                           distinguishing the two. */
                        /* R139 (precision): quiet danger at rest — the trash
                       trigger drops its resting error ink for muted ink;
                       the error ink surfaces on hover, and the severity
                       lives in the page's destructive confirm (the
                       topups single-card reject recipe). aria/title
                       byte-identical to the honest verb. */
                        aria-label={`إيقاف وأرشفة العرض «${s.title}»`}
                        title="إيقاف وأرشفة"
                        className="gap-1.5 text-muted-foreground hover:text-status-error hover:bg-status-error/10"
                      >
                        {busyIds.has(s.id) ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })
          ) : null}
        </>
      )}
    </div>
  );
}
