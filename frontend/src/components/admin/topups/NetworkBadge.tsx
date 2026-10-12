import { StatusBadge, type StatusBadgeVariant } from "@/components/ui/status-badge";

// R137 (FE decomposition): extracted verbatim from pages/admin/topups.tsx —
// the queue rows' payment-network pill. Pure presentational atom (value via
// props only); rides along inside TopupCard. The move only changes its
// address; DOM, classes and Arabic copy are byte-identical.

/* R128 (A1-D7/F1): the payment-network pills rode raw green/blue.
 * The endgame is a --net-libyana/--net-madar brand pair; until those
 * exist, the status tokens carry the same hue identity (libyana stays
 * green via success, madar stays blue via info) — the exact recipe the
 * storefront wallet's network chips already use for ink+border
 * (wallet.tsx: text-status-success / text-status-info). Both-theme AA
 * replaces the 1.9–2.5:1 light-theme raw pairs. */
export function NetworkBadge({ net }: { net?: string | null }) {
  if (!net) return null;
  const map: Record<string, { label: string; variant: StatusBadgeVariant }> = {
    libyana: { label: "ليبيانا", variant: "success" },
    madar: { label: "مدار", variant: "info" },
  };
  const d = map[net] ?? { label: net, variant: "neutral" as const };
  return (
    <StatusBadge variant={d.variant} size="xs">
      {d.label}
    </StatusBadge>
  );
}
