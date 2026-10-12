import { Building2, Smartphone } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";

// R137 (FE decomposition): extracted verbatim from pages/admin/topups.tsx —
// the queue rows' payment-method pill. Pure presentational atom (value via
// props only); rides along inside TopupCard. The move only changes its
// address; DOM, classes and Arabic copy are byte-identical.

/* R128 (A1-D2/F1): both hand-rolled pills were raw-palette twins of
 * the StatusBadge recipes (purple-400 on its tint = 2.34:1 in the light
 * admin theme — the round's AA hole). xs size = the exact
 * text-3xs/px-1.5/icon-2.5 scale these hand-rolled; dark theme is
 * visually near-identical (the tokens' dark values sit within a hair of
 * purple-400/blue-400). */
export function MethodBadge({ method }: { method: string }) {
  if (method === "lypay")
    return (
      <StatusBadge variant="purple" size="xs" icon={Building2}>
        LyPay
      </StatusBadge>
    );
  return (
    <StatusBadge variant="info" size="xs" icon={Smartphone}>
      تحويل رصيد
    </StatusBadge>
  );
}
