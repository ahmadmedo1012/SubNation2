import { Clock, TrendingUp } from "lucide-react";
import { FetchErrorCard } from "@/components/ui/fetch-error-card";
import { STATUS_TONE, StatusBadge, UNKNOWN_STATUS_TONE } from "@/components/ui/status-badge";
import { formatCount, formatCurrency, formatDate } from "@/lib/utils";
import type { Topup } from "@workspace/api-client-react";
import { networkLabel, topupStatusIcon, topupStatusLabel } from "@/components/wallet/topup-meta";

// R136 (FE-1 decomposition): extracted verbatim from pages/wallet.tsx —
// the right column's topup REQUESTS history (the sticky card). The
// useListTopups query stays centralized in the page (the pending gate
// and the latest-topup pin also key off it); rows/loading/error/refetch
// flow down as values + one retry callback. The move only changes its
// address; DOM, classes and aria are byte-identical.

export function TopupHistoryCard({
  topups,
  loading,
  error,
  onRetry,
}: {
  topups: Topup[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="lg:col-span-2">
      <div className="bg-card border border-border/55 rounded-2xl p-5 lg:sticky lg:top-20">
        <div className="flex items-center gap-2.5 mb-4">
          <TrendingUp className="w-4 h-4 text-muted-foreground" />
          <h2 className="font-bold text-sm">سجل الشحن</h2>
          {topups.length > 0 && (
            <span className="mr-auto text-xs text-muted-foreground font-semibold">
              {/* R94-A1 #11 (P3): Arabic pluralization via formatCount
                  (line 680 in this file already uses it for the pending
                  counter). */}
              {formatCount(topups.length, {
                one: "طلب",
                two: "طلبان",
                few: "طلبات",
                many: "طلباً",
                other: "طلب",
              })}
            </span>
          )}
        </div>

        {loading ? (
          /* Ledger skeleton — prevents the "no topups yet" empty state
             from flashing during the initial fetch. */
          <div className="space-y-2.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                /* R125-I7 (A7 B-12 / R124-A3 #12): 2px border-l accent
               stripe → the plain 1px border (craft-floor cap). */
                className="bg-card border border-border rounded-xl p-4 flex items-center gap-4"
              >
                <div className="w-10 h-10 rounded-xl bg-muted skeleton-shimmer shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-muted skeleton-shimmer rounded-lg w-2/5" />
                  <div className="h-3 bg-muted skeleton-shimmer rounded w-1/3" />
                </div>
                <div className="h-5 bg-muted skeleton-shimmer rounded-full w-16 shrink-0" />
              </div>
            ))}
          </div>
        ) : error ? (
          /* 93-C5 / F-05 (A4 #7): a failed ledger fetch used to render
             the "لا توجد طلبات شحن بعد" empty state — an outage read as
             "you never topped up" on the money page. Distinct error
             branch with retry. */
          <FetchErrorCard
            size="compact"
            descriptionClassName="max-w-[220px]"
            title="تعذّر تحميل سجل الشحن"
            description="حدث خطأ في الاتصال — حاول مجدداً لعرض طلبات الشحن السابقة"
            onRetry={onRetry}
          />
        ) : topups.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground">
            <div className="w-16 h-16 rounded-2xl bg-muted/70 border border-border/40 flex items-center justify-center mx-auto mb-4">
              <Clock className="w-7 h-7 opacity-25" />
            </div>
            <p className="font-bold text-base mb-1.5 text-foreground/80">لا توجد طلبات شحن بعد</p>
            <p className="text-xs text-muted-foreground max-w-[200px] mx-auto leading-relaxed">
              ابدأ بشحن محفظتك لشراء اشتراكاتك المفضلة
            </p>
          </div>
        ) : (
          <div className="space-y-2.5 lg:max-h-[480px] overflow-y-auto scrollbar-none">
            {(
              topups as Array<{
                id: number;
                status: string;
                amount: number;
                payment_network: string;
                created_at: string;
              }>
            ).map((t, i: number) => (
              <div
                key={t.id}
                className={`float-in stagger-${Math.min(i, 8)} flex items-center gap-3 p-3 bg-muted/18 border border-border/30 rounded-xl hover:bg-muted/30 transition-colors group`}
              >
                <div className="shrink-0">{topupStatusIcon(t.status)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-xs font-bold tabular-nums">
                      {formatCurrency(t.amount)}
                    </span>
                    {t.payment_network && (
                      <span className="text-3xs text-muted-foreground font-semibold">
                        · {networkLabel(t.payment_network)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {/* R116: shared StatusBadge (STATUS_TONE) replaces
                        the deprecated statusColor() — 93-C7 follow-up. */}
                    <StatusBadge
                      variant={
                        STATUS_TONE[t.status as keyof typeof STATUS_TONE] ?? UNKNOWN_STATUS_TONE
                      }
                      size="xs"
                    >
                      {topupStatusLabel(t.status)}
                    </StatusBadge>
                    <span className="text-3xs text-muted-foreground">
                      {formatDate(t.created_at)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
