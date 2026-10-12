import { ArrowLeftRight } from "lucide-react";
import { FetchErrorCard } from "@/components/ui/fetch-error-card";
import { formatCount } from "@/lib/utils";
import { LedgerEntryRow, type LedgerEntry } from "@/components/wallet/LedgerEntryRow";

// R136 (FE-1 decomposition): extracted verbatim from pages/wallet.tsx —
// the user-facing wallet STATEMENT card. It was already a self-contained
// (props-only) component inside the page file; the ledger query stays
// centralized in the page (entries/loading/error/refetch flow down as
// values + one retry callback). The move only changes its address —
// DOM, classes and aria are byte-identical.

/**
 * R115 (A8 P2): the user-facing wallet STATEMENT — every LYD movement
 * from wallet_ledger (topups, purchases, refunds, loyalty conversions,
 * referral/welcome credits), newest first.
 *
 * Until R115 the wallet page showed only topup REQUESTS: a refund
 * credit, a welcome bonus or a loyalty conversion was invisible as a
 * transaction — "where did my balance come from?" was unanswerable in
 * the UI. This card is purely additive (the topup requests list above is
 * untouched). Distinct LOADING / ERROR / EMPTY / ROWS branches follow
 * the 93-C5/F-05 idiom: an outage is NEVER the «لا توجد حركات بعد»
 * empty state.
 */
export function WalletStatementCard({
  entries,
  loading,
  error,
  onRetry,
}: {
  entries: LedgerEntry[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  return (
    <section
      aria-labelledby="wallet-statement-heading"
      className="bg-card border border-border/55 rounded-2xl p-5 mt-5"
    >
      <div className="flex items-center gap-2.5 mb-4">
        <ArrowLeftRight className="w-4 h-4 text-muted-foreground" />
        <h2 id="wallet-statement-heading" className="font-bold text-sm">
          سجل الحركات
        </h2>
        {entries.length > 0 && (
          <span className="mr-auto text-xs text-muted-foreground font-semibold">
            {/* R116-S2 (P3): the backend caps the ledger at 100 rows —
                a full page is a TRUNCATED window, not the user's total
                history. Saying «100 حركة» implied "exactly 100 ever";
                the caption states what's actually shown. */}
            {entries.length >= 100
              ? "عرض آخر 100 حركة"
              : formatCount(entries.length, {
                  one: "حركة",
                  two: "حركتان",
                  few: "حركات",
                  many: "حركة",
                  other: "حركة",
                })}
          </span>
        )}
      </div>

      {loading ? (
        /* Statement skeleton — same shape as the topup list's, so the
           two right-column lists feel like one family. */
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
        /* 93-C5 / F-05: outage ≠ "no movements yet" — a failed ledger
           fetch must not read as an empty wallet history. */
        <FetchErrorCard
          size="compact"
          title="تعذّر تحميل سجل الحركات"
          description="حدث خطأ في الاتصال — حاول مجدداً لعرض حركات محفظتك"
          onRetry={onRetry}
        />
      ) : entries.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground">
          <div className="w-16 h-16 rounded-2xl bg-muted/70 border border-border/40 flex items-center justify-center mx-auto mb-4">
            <ArrowLeftRight className="w-7 h-7 opacity-25" />
          </div>
          <p className="font-bold text-base mb-1.5 text-foreground/80">لا توجد حركات بعد</p>
          <p className="text-xs text-muted-foreground max-w-[220px] mx-auto leading-relaxed">
            ستظهر هنا عمليات الشحن والشراء والاسترداد في محفظتك
          </p>
        </div>
      ) : (
        <div className="space-y-2.5 lg:max-h-[480px] overflow-y-auto scrollbar-none">
          {entries.map((e, i: number) => (
            <LedgerEntryRow key={e.id ?? i} entry={e} index={i} />
          ))}
        </div>
      )}
    </section>
  );
}
