import { Clock, TrendingUp } from "lucide-react";
import { FetchErrorCard } from "@/components/ui/fetch-error-card";
import { STATUS_TONE, StatusBadge, UNKNOWN_STATUS_TONE } from "@/components/ui/status-badge";
import { ORDER_COUNT_FORMS_SUBJECT, formatCount, formatCurrency, formatDate } from "@/lib/utils";
import type { Topup } from "@workspace/api-client-react";
import { networkLabel, topupStatusIcon, topupStatusLabel } from "@/components/wallet/topup-meta";

// R136 (FE-1 decomposition): extracted verbatim from pages/wallet.tsx —
// the right column's topup REQUESTS history (the sticky card). The
// useListTopups query stays centralized in the page (the pending gate
// and the latest-topup pin also key off it); rows/loading/error/refetch
// flow down as values + one retry callback. The move only changes its
// address; DOM, classes and aria are byte-identical.

/**
 * R157-IMPL-B #1: the topup row's CHANNEL label, derived from the DTO's
 * payment_method. lypay rows carry payment_network=null, so the old
 * `payment_network && …` guard rendered NO channel at all for bank
 * transfers — the method the DTO always names is the honest source.
 * mobile_transfer keeps the network vocabulary (with a plain
 * «تحويل موبايل» fallback for a null network); lypay names its channel
 * the way the method tab does. Unknown/absent method → no label (the
 * pre-R157 shape for legacy rows).
 */
export function topupChannelLabel(
  paymentMethod?: string | null,
  paymentNetwork?: string | null,
): string | null {
  if (paymentMethod === "lypay") return "LyPay";
  if (paymentMethod === "mobile_transfer") return networkLabel(paymentNetwork) || "تحويل موبايل";
  return null;
}

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
      {/* R139 (precision): /55 → /60 — the family resting edge. */}
      <div className="bg-card border border-border/60 rounded-2xl p-5 lg:sticky lg:top-20">
        <div className="flex items-center gap-2.5 mb-4">
          <TrendingUp className="w-4 h-4 text-muted-foreground" />
          <h2 className="font-bold text-sm">سجل الشحن</h2>
          {topups.length > 0 && (
            <span className="mr-auto text-xs text-muted-foreground font-semibold">
              {/* R94-A1 #11 (P3): Arabic pluralization via formatCount
                  (line 680 in this file already uses it for the pending
                  counter). R166-A (F16): standalone count chip → the
                  shared SUBJECT registry form («طلبان»); rendered bytes
                  unchanged. R187 (B-F4): the backend caps the list at
                  200 rows — a full page is a TRUNCATED window, not the
                  user's total topups. The caption states what's shown
                  (the WalletStatementCard honesty idiom). */}
              {topups.length >= 200
                ? "عرض آخر 200 طلب شحن"
                : formatCount(topups.length, ORDER_COUNT_FORMS_SUBJECT)}
            </span>
          )}
        </div>

        {loading ? (
          /* Ledger skeleton — prevents the "no topups yet" empty state
             from flashing during the initial fetch. Mirrors the loaded
             queue rows' boxed-chip register (bg-muted/20 + border/30 —
             the 139-a loading→loaded parity discipline). */
          <div className="space-y-2.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="bg-muted/20 border border-border/30 rounded-xl p-4 flex items-center gap-4"
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
            {/* R139 (precision): the empty stage joins the r138-h icon
                stage values (muted/60 tile + /35 edge + /35 glyph +
                /85 title). */}
            <div className="w-16 h-16 rounded-2xl bg-muted/60 border border-border/35 flex items-center justify-center mx-auto mb-4">
              <Clock className="w-7 h-7 opacity-35" />
            </div>
            <p className="font-bold text-base mb-1.5 text-foreground/85">لا توجد طلبات شحن بعد</p>
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
                payment_method: string;
                payment_network: string;
                admin_note?: string | null;
                created_at: string;
              }>
            ).map((t, i: number) => {
              const channel = topupChannelLabel(t.payment_method, t.payment_network);
              return (
                <div
                  key={t.id}
                  /* R139 (precision): the queue rows keep their boxed-chip
                     register (they are the topup QUEUE, not the statement —
                     status icons + badges live here); only the nonstandard
                     /18 fill joins the family's /20 value. */
                  className={`float-in stagger-${Math.min(i, 8)} flex items-center gap-3 p-3 bg-muted/20 border border-border/30 rounded-xl hover:bg-muted/30 transition-colors group`}
                >
                  <div className="shrink-0">{topupStatusIcon(t.status)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-xs font-bold tabular-nums">
                        {formatCurrency(t.amount)}
                      </span>
                      {/* R157-IMPL-B #1: the channel span now derives from
                          payment_method — lypay rows used to render NO
                          channel (payment_network null ⇒ the ·-label
                          vanished). */}
                      {channel && (
                        <span className="text-3xs text-muted-foreground font-semibold">
                          · {channel}
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
                    {/* R157-IMPL-B #2: the rejection reason used to live
                        ONLY in TopupWaitingModal and vanished the moment
                        it closed — the row that permanently says «مرفوض»
                        now carries the admin's note (clamped to 2 lines;
                        null/empty notes keep the row unchanged). */}
                    {t.status === "rejected" && t.admin_note && (
                      <div className="mt-1.5 pt-1.5 border-t border-border/20 text-3xs text-muted-foreground leading-relaxed line-clamp-2">
                        {t.admin_note}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
