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
      /* R139 (precision): /55 → /60 — the family resting edge. The card
         stays FLAT on purpose: the balance hero above owns the page's
         one elevated register (two-layer calm elevation); a long
         scrolling statement reads as paper, not a floating panel. */
      className="bg-card border border-border/60 rounded-2xl p-5 mt-5"
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
        /* Statement skeleton — mirrors the hairline receipt rows it
           previews (divide-y /20 + plain py rows; the old boxed chips
           flashed a different list than the one that landed). */
        <div className="divide-y divide-border/20">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 py-4">
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
          {/* R139 (precision): the empty stage joins the r138-h icon
              stage values (bg-muted/60 tile + /35 edge + /35 glyph +
              /85 title — the shared EmptyState family 139-d aligned). */}
          <div className="w-16 h-16 rounded-2xl bg-muted/60 border border-border/35 flex items-center justify-center mx-auto mb-4">
            <ArrowLeftRight className="w-7 h-7 opacity-35" />
          </div>
          <p className="font-bold text-base mb-1.5 text-foreground/85">لا توجد حركات بعد</p>
          <p className="text-xs text-muted-foreground max-w-[220px] mx-auto leading-relaxed">
            ستظهر هنا عمليات الشحن والشراء والاسترداد في محفظتك
          </p>
        </div>
      ) : (
        /* R139 (precision): THE STATEMENT rides the receipt rhythm — a
           statement IS a receipt (FINAL_UX_SYSTEM §4: every LYD movement
           explainable). divide-y divide-border/20 hairlines replace the
           boxed chip rows (hairlines at row boundaries = the CartSummary
           slip's paper idiom); the row itself loses its hover wash —
           read-only accountability lines promise no interactivity (the
           139-g audit-trail decision). */
        <div className="divide-y divide-border/20 lg:max-h-[480px] overflow-y-auto scrollbar-none">
          {entries.map((e, i: number) => (
            <LedgerEntryRow key={e.id ?? i} entry={e} index={i} />
          ))}
        </div>
      )}
    </section>
  );
}
