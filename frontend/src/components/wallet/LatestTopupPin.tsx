import { formatCurrency, formatRelativeTime } from "@/lib/utils";
import { STATUS_TONE, StatusBadge, UNKNOWN_STATUS_TONE } from "@/components/ui/status-badge";
import { topupStatusIcon, topupStatusLabel } from "@/components/wallet/topup-meta";

// R136 (FE-1 decomposition): extracted verbatim from pages/wallet.tsx —
// the mobile-only latest-topup pin. The latest-topup derivation (the
// useListTopups sort + the !isLoading mount guard) stays centralized in
// the page; the row flows down as a value. The move only changes its
// address; DOM, classes and aria are byte-identical.

/** The page's latest-topup projection (any status, newest first). */
export interface LatestTopup {
  id: number;
  status: string;
  amount: number;
  created_at: string;
  payment_network?: string;
}

/**
 * Mobile-only latest-topup pin. Wallet history lives in the
 * right-hand column on desktop (sticky), but on mobile it
 * stacks below the form — this small banner gives a quick
 * "last submission" signal at the top of the page so a
 * user who just submitted doesn't have to scroll to know
 * their request is queued.
 */
export function LatestTopupPin({ topup }: { topup: LatestTopup }) {
  return (
    /* R139 (precision): /55 → /60 — the family resting edge. */
    <div className="lg:hidden flex items-center gap-3 p-3 bg-card border border-border/60 rounded-xl">
      {topupStatusIcon(topup.status)}
      <div className="flex-1 min-w-0">
        <div className="text-xs font-bold tabular-nums">
          آخر طلب: {formatCurrency(topup.amount)}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          {/* R116: shared StatusBadge (STATUS_TONE) replaces the
              deprecated statusColor() string-concat — 93-C7
              follow-up, same tokens/pill shape as the rest. */}
          <StatusBadge
            variant={STATUS_TONE[topup.status as keyof typeof STATUS_TONE] ?? UNKNOWN_STATUS_TONE}
            size="xs"
          >
            {topupStatusLabel(topup.status)}
          </StatusBadge>
          <span className="text-3xs text-muted-foreground">
            {formatRelativeTime(topup.created_at)}
          </span>
        </div>
      </div>
    </div>
  );
}
