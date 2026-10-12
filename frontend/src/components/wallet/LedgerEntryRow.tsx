import { memo } from "react";
import type { GetWalletLedger200Item } from "@workspace/api-client-react";
import { formatCurrency, formatDate } from "@/lib/utils";

// R136 (FE-1 decomposition): extracted verbatim from pages/wallet.tsx —
// the memoized wallet_ledger row + its display helpers (the signed,
// directional amount + the attribution label). Pure display over the
// entry (no callbacks, no state); the move only changes its address.

/** One wallet_ledger row as served by GET /api/wallet/ledger (R115). */
export type LedgerEntry = GetWalletLedger200Item;

/**
 * R115 (A8 P2): signed, directional display amount for a ledger row.
 *
 * The wallet_ledger writers store the ABSOLUTE amount for the fixed
 * types (topup / purchase / refund / referral_credit — the direction IS
 * the type; checkout writes String(finalPrice), refunds and topups their
 * positive values), while `adjustment` rows carry their own sign
 * (balanceAfter − balanceBefore, see AdjustmentService). This helper
 * derives the display sign from the type so the statement reads as a
 * movement list: credits with a leading «+», debits with a leading «-».
 * The amount span renders dir="ltr" so the sign always leads the number
 * inside the RTL layout.
 */
function ledgerAmountDisplay(entry: LedgerEntry): { text: string; credit: boolean } {
  const amount = entry.amount ?? 0;
  const abs = Math.abs(amount);
  if (entry.type === "adjustment") {
    return {
      text: `${amount < 0 ? "-" : "+"}${formatCurrency(abs)}`,
      credit: amount >= 0,
    };
  }
  // Purchases are the only fixed-type debit; everything else credits
  // the wallet (topups, refunds, referral/welcome credits).
  const debit = entry.type === "purchase";
  return { text: `${debit ? "-" : "+"}${formatCurrency(abs)}`, credit: !debit };
}

/**
 * R116-S2 (P3): attribution label for a statement row.
 *
 * `adjustment` rows are the generic bucket — a loyalty conversion
 * lands there with reference_type "loyalty_conversion" and an Arabic
 * description («تحويل N نقطة ولاء إلى رصيد»). Without this mapping the
 * credit rendered as the generic «تسوية رصيد», unattributable to the
 * loyalty action that produced it. Priority: the writer's own
 * description → the loyalty_conversion mapping → the served
 * type_label → the raw type.
 */
function ledgerEntryLabel(entry: LedgerEntry): string {
  const description = entry.description?.trim();
  if (description) return description;
  if (entry.reference_type === "loyalty_conversion") return "تحويل نقاط";
  return entry.type_label ?? entry.type ?? "حركة";
}

/* R118-B2 (A6 F-8): memoized ledger row. The wallet page re-renders on
 * every keystroke of the topup amount input — the statement card's up
 * to 100 rows were re-rendered inline each time for nothing. The row is
 * pure display (entry + index drive everything; no callbacks), so a
 * shallow-compare memo bails every row on unrelated parent state.
 * Same pattern as the admin orders rows extracted this round. */
export const LedgerEntryRow = memo(function LedgerEntryRow({
  entry,
  index,
}: {
  entry: LedgerEntry;
  index: number;
}) {
  const { text, credit } = ledgerAmountDisplay(entry);
  return (
    <div
      className={`float-in stagger-${Math.min(index, 8)} flex items-center gap-3 p-3 bg-muted/18 border border-border/30 rounded-xl hover:bg-muted/30 transition-colors`}
    >
      <div className="flex-1 min-w-0">
        <div className="text-xs font-bold mb-0.5">{ledgerEntryLabel(entry)}</div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {typeof entry.balance_after === "number" && (
            <span className="text-3xs text-muted-foreground tabular-nums">
              الرصيد بعدها: {formatCurrency(entry.balance_after)}
            </span>
          )}
          {entry.created_at && (
            <span className="text-3xs text-muted-foreground">· {formatDate(entry.created_at)}</span>
          )}
        </div>
      </div>
      {/* dir="ltr": the sign must lead the number inside the RTL
          layout; tabular-nums aligns the column of amounts. */}
      <span
        dir="ltr"
        className={`text-xs font-bold tabular-nums shrink-0 ${
          credit ? "text-status-success" : "text-foreground/85"
        }`}
      >
        {text}
      </span>
    </div>
  );
});
